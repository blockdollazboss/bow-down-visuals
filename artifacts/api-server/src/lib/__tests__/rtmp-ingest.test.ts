/**
 * rtmp-ingest.test.ts — stream-key ingest for Go Live (migration 0194).
 *
 * Two halves:
 *  1. Key lifecycle against a fake db over the real table object:
 *     a key is issued to its owner, stored HASHED only — a one-way
 *     lookup hash + a last-4 hint, the plain key itself nowhere in
 *     the row; the plain key is handed back only by the call that
 *     mints it (asking again never re-shows it); publish auth
 *     resolves the plain key and NOTHING else; regenerate kills the
 *     old key at once; revoke kills it too; asking again after a
 *     revoke mints a fresh key and never resurrects the dead one.
 *  2. The publish connection over a fake socket (deps injected — the
 *     real handshake/chunk/command path runs): a good key publishes
 *     and its media lands in the engine as FLV; a bad key is refused
 *     without ever reaching the host; a second simultaneous publish
 *     on the same key is refused; dropping the creator's connections
 *     (what revoke/regenerate do) ends the stream.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const USER = "00000000-0000-4000-8000-0000000000aa";
const OTHER = "00000000-0000-4000-8000-0000000000bb";
const PROFILE = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  seq: 0,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { liveIngestKeysTable } = actual;
  const dialect = new PgDialect();

  function condPairs(cond: unknown): Array<[string, unknown]> {
    const q = dialect.sqlToQuery(cond as never);
    const sql = q.sql as string;
    const params = q.params as unknown[];
    const found: Array<{ col: string; idx: number }> = [];
    for (const col of ["user_id", "key_lookup", "id"]) {
      let from = 0;
      for (;;) {
        const idx = sql.indexOf(`"${col}"`, from);
        if (idx === -1) break;
        found.push({ col, idx });
        from = idx + 1;
      }
    }
    found.sort((a, b) => a.idx - b.idx);
    return found.map((f, i) => [f.col, params[i]] as [string, unknown]);
  }

  function match(cond: unknown): Array<Record<string, unknown>> {
    let rows = [...h.rows];
    for (const [col, val] of condPairs(cond)) {
      rows = rows.filter((r) => String(r[col] ?? "") === String(val ?? ""));
    }
    return rows;
  }

  const fakeDb: any = {
    select: () => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const self: any = {
            limit: (_n: number) => self,
            then: (res: any, rej: any) =>
              Promise.resolve(table === liveIngestKeysTable ? match(cond) : []).then(res, rej),
          };
          return self;
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          if (table !== liveIngestKeysTable) return [{ ...v }];
          h.seq += 1;
          const row: Record<string, unknown> = {
            id: `key-${h.seq}`,
            stream_title: null,
            revoked_at: null,
            created_at: new Date(),
            updated_at: new Date(),
            ...v,
          };
          h.rows.push(row);
          return [row];
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: unknown) => ({
          returning: async () => {
            if (table !== liveIngestKeysTable) return [];
            const targets = match(cond);
            for (const row of targets) Object.assign(row, patch);
            return targets;
          },
        }),
      }),
    }),
  };

  return { ...actual, db: fakeDb };
});

import {
  RtmpPublishConnection,
  __resetRtmpIngest,
  activeIngestUserIds,
  dropIngestConnectionsForUser,
  generateStreamKey,
  getIngestKeyRow,
  getOrCreateIngestKey,
  hashStreamKey,
  ingestUrlFor,
  keyHintOf,
  regenerateIngestKey,
  resolveIngestKey,
  revokeIngestKey,
  rtmpIngestConfig,
  setIngestStreamTitle,
  type ResolvedIngestKey,
  type RtmpIngestDeps,
} from "../rtmp-ingest";
import { amfEncode, encodeRtmpMessage, HANDSHAKE_BYTES } from "../rtmp-protocol";

beforeEach(() => {
  h.rows = [];
  h.seq = 0;
});

afterEach(async () => {
  await __resetRtmpIngest();
});

/* ══ Key primitives + config ═══════════════════════════════════════ */

describe("stream key primitives", () => {
  it("generates high-entropy prefixed keys; hash and hint derive as documented", () => {
    const a = generateStreamKey();
    const b = generateStreamKey();
    expect(a).toMatch(/^bdv_[A-Za-z0-9_-]{32}$/);
    expect(a).not.toBe(b);
    expect(hashStreamKey(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashStreamKey(a)).not.toBe(hashStreamKey(b));
    expect(keyHintOf(a)).toBe(a.slice(-4));
  });

  it("config defaults: SHUT until ops opt in, port 1935, app 'live'; only 'on' opens the door", () => {
    expect(rtmpIngestConfig({})).toEqual({ enabled: false, port: 1935, app: "live", publicUrl: null });
    expect(rtmpIngestConfig({ LIVE_RTMP_INGEST: "on" }).enabled).toBe(true);
    expect(rtmpIngestConfig({ LIVE_RTMP_INGEST: " ON " }).enabled).toBe(true);
    expect(rtmpIngestConfig({ LIVE_RTMP_INGEST: "off" }).enabled).toBe(false);
    expect(rtmpIngestConfig({ LIVE_RTMP_INGEST: "yes" }).enabled).toBe(false);
    expect(rtmpIngestConfig({ LIVE_RTMP_PORT: "19350", LIVE_RTMP_APP: "stage" })).toMatchObject({ port: 19350, app: "stage" });
  });

  it("ingest URL: explicit env wins; else derived from the site origin; else null", () => {
    expect(ingestUrlFor({ LIVE_RTMP_PUBLIC_URL: "rtmp://ingest.example.com/live" })).toBe("rtmp://ingest.example.com/live");
    expect(ingestUrlFor({ PUBLIC_SITE_URL: "https://bowdownvisuals.com" })).toBe("rtmp://bowdownvisuals.com/live");
    expect(ingestUrlFor({})).toBeNull();
  });
});

/* ══ Key lifecycle ═════════════════════════════════════════════════ */

describe("ingest key lifecycle", () => {
  it("issues a key to its owner: HASHED at rest — lookup hash + hint only, the plain key nowhere in the row", async () => {
    const { row, plainKey } = await getOrCreateIngestKey(USER, PROFILE);
    expect(plainKey).toMatch(/^bdv_/);
    expect(row.user_id).toBe(USER);
    expect(row.key_lookup).toBe(hashStreamKey(plainKey!));
    expect(row.key_hint).toBe(plainKey!.slice(-4));
    // Hash-only storage: no column holds the plain key (or anything
    // reversible back to it), and the stored row never contains it.
    expect("stream_key" in row).toBe(false);
    expect(JSON.stringify(row)).not.toContain(plainKey!);
    expect(JSON.stringify(h.rows)).not.toContain(plainKey!);
    // The lookup hash alone is not a key: it must not authenticate.
    expect(await resolveIngestKey(row.key_lookup as string)).toBeNull();
  });

  it("the plain key is handed back ONCE: asking again keeps the same live key but never re-shows it", async () => {
    const first = await getOrCreateIngestKey(USER, PROFILE);
    expect(first.plainKey).toMatch(/^bdv_/);
    const second = await getOrCreateIngestKey(USER, PROFILE);
    expect(second.plainKey).toBeNull();
    expect(second.row.id).toBe(first.row.id);
    expect(h.rows).toHaveLength(1);
    // No silent rotation either: the original key still publishes.
    expect(await resolveIngestKey(first.plainKey!)).toMatchObject({ userId: USER });
  });

  it("keys are per-creator: another member's key is a different key", async () => {
    const mine = await getOrCreateIngestKey(USER, PROFILE);
    const theirs = await getOrCreateIngestKey(OTHER, PROFILE);
    expect(theirs.plainKey).not.toBe(mine.plainKey);
    expect(await resolveIngestKey(mine.plainKey)).toMatchObject({ userId: USER });
    expect(await resolveIngestKey(theirs.plainKey)).toMatchObject({ userId: OTHER });
  });

  it("publish auth: the plain key resolves; junk does not", async () => {
    const { plainKey } = await getOrCreateIngestKey(USER, PROFILE);
    expect(await resolveIngestKey(plainKey)).toEqual({ userId: USER, profileId: PROFILE, streamTitle: null });
    expect(await resolveIngestKey("bdv_wrongwrongwrongwrongwrongwrong12")).toBeNull();
    expect(await resolveIngestKey("")).toBeNull();
    expect(await resolveIngestKey("x".repeat(500))).toBeNull();
  });

  it("regenerate kills the old key immediately and the new one works", async () => {
    const first = await getOrCreateIngestKey(USER, PROFILE);
    const second = await regenerateIngestKey(USER, PROFILE);
    expect(second.plainKey).not.toBe(first.plainKey);
    expect(await resolveIngestKey(first.plainKey)).toBeNull();
    expect(await resolveIngestKey(second.plainKey)).toMatchObject({ userId: USER });
    expect(h.rows).toHaveLength(1); // one active key per creator — rotated in place
  });

  it("revoke kills the key; asking again mints a fresh one, never the dead one", async () => {
    const first = await getOrCreateIngestKey(USER, PROFILE);
    await revokeIngestKey(USER);
    expect(await resolveIngestKey(first.plainKey)).toBeNull();
    const row = await getIngestKeyRow(USER);
    expect(row?.revoked_at).toBeTruthy();
    const fresh = await getOrCreateIngestKey(USER, PROFILE);
    expect(fresh.plainKey).not.toBe(first.plainKey);
    expect(await resolveIngestKey(fresh.plainKey)).toMatchObject({ userId: USER });
    expect(await resolveIngestKey(first.plainKey)).toBeNull();
  });

  it("the standing stream title rides the key into publish auth", async () => {
    const { plainKey } = await getOrCreateIngestKey(USER, PROFILE);
    await setIngestStreamTitle(USER, "Friday Night Set");
    expect(await resolveIngestKey(plainKey)).toMatchObject({ streamTitle: "Friday Night Set" });
  });
});

/* ══ Publish connection ════════════════════════════════════════════ */

class FakeSocket {
  writes: Buffer[] = [];
  destroyed = false;
  private handlers = new Map<string, Array<(...args: any[]) => void>>();
  write(data: Buffer): boolean {
    this.writes.push(Buffer.from(data));
    return true;
  }
  destroy(): void {
    this.destroyed = true;
    this.emit("close");
  }
  pause(): void {}
  resume(): void {}
  on(event: string, cb: (...args: any[]) => void): this {
    const arr = this.handlers.get(event) ?? [];
    arr.push(cb);
    this.handlers.set(event, arr);
    return this;
  }
  emit(event: string, ...args: any[]): void {
    for (const cb of this.handlers.get(event) ?? []) cb(...args);
  }
  deliver(data: Buffer): void {
    this.emit("data", data);
  }
  writtenText(): string {
    return Buffer.concat(this.writes).toString("latin1");
  }
}

function makeDeps(resolved: ResolvedIngestKey | null) {
  const calls = {
    start: 0,
    firstMedia: [] as string[],
    end: [] as string[],
    feed: [] as Array<{ id: string; seq: number; bytes: number; mime: string; head: Buffer }>,
  };
  const deps: RtmpIngestDeps = {
    resolveKey: async () => resolved,
    host: {
      startStream: async () => {
        calls.start += 1;
        return { ok: true as const, streamId: "stream-1" };
      },
      firstMedia: (id) => {
        calls.firstMedia.push(id);
      },
      endStream: async (id) => {
        calls.end.push(id);
      },
    },
    feedChunk: async (id, seq, buf, mime) => {
      calls.feed.push({ id, seq, bytes: buf.length, mime, head: Buffer.from(buf.subarray(0, 13)) });
      return { duplicate: false };
    },
    app: "live",
  };
  return { deps, calls };
}

function handshakeAndConnect(sock: FakeSocket): void {
  const c1 = Buffer.alloc(HANDSHAKE_BYTES);
  c1.writeUInt32BE(1, 0);
  sock.deliver(Buffer.concat([Buffer.from([3]), c1]));
  sock.deliver(Buffer.alloc(HANDSHAKE_BYTES)); // C2
  const connect = Buffer.concat([amfEncode("connect"), amfEncode(1), amfEncode({ app: "live", tcUrl: "rtmp://localhost/live" })]);
  sock.deliver(encodeRtmpMessage({ chunkStreamId: 3, messageStreamId: 0, typeId: 20, payload: connect }));
  const create = Buffer.concat([amfEncode("createStream"), amfEncode(2), amfEncode(null)]);
  sock.deliver(encodeRtmpMessage({ chunkStreamId: 3, messageStreamId: 0, typeId: 20, payload: create }));
}

function publishChunk(key: string): Buffer {
  const payload = Buffer.concat([amfEncode("publish"), amfEncode(0), amfEncode(null), amfEncode(key)]);
  return encodeRtmpMessage({ chunkStreamId: 3, messageStreamId: 1, typeId: 20, payload });
}

function setChunkSizeChunk(size: number): Buffer {
  const payload = Buffer.alloc(4);
  payload.writeUInt32BE(size, 0);
  return encodeRtmpMessage({ chunkStreamId: 2, messageStreamId: 0, typeId: 1, payload });
}

const RESOLVED: ResolvedIngestKey = { userId: USER, profileId: PROFILE, streamTitle: "Friday Night Set" };

describe("publish connection", () => {
  it("handshakes, accepts a good key, and feeds media to the engine as FLV", async () => {
    const { deps, calls } = makeDeps(RESOLVED);
    const sock = new FakeSocket();
    new RtmpPublishConnection(sock as never, deps);
    handshakeAndConnect(sock);
    expect(sock.writtenText()).toContain("NetConnection.Connect.Success");

    sock.deliver(publishChunk("bdv_goodkey"));
    await vi.waitFor(() => expect(sock.writtenText()).toContain("NetStream.Publish.Start"));
    expect(calls.start).toBe(1);
    expect(activeIngestUserIds()).toEqual([USER]);

    sock.deliver(setChunkSizeChunk(4096));
    const media = Buffer.alloc(300_000, 0x07);
    sock.deliver(encodeRtmpMessage({ chunkStreamId: 6, messageStreamId: 1, typeId: 9, payload: media }));
    await vi.waitFor(() => expect(calls.feed.length).toBeGreaterThan(0));
    const first = calls.feed[0]!;
    expect(first.id).toBe("stream-1");
    expect(first.mime).toBe("video/x-flv");
    // The engine receives an FLV stream: header first, then the tag bytes.
    expect(first.head.subarray(0, 3).toString("latin1")).toBe("FLV");
    expect(calls.feed.reduce((s, f) => s + f.bytes, 0)).toBeGreaterThan(300_000);
    expect(calls.firstMedia).toEqual(["stream-1"]);
  });

  it("refuses a bad key before the host ever hears about it", async () => {
    const { deps, calls } = makeDeps(null);
    const sock = new FakeSocket();
    new RtmpPublishConnection(sock as never, deps);
    handshakeAndConnect(sock);
    sock.deliver(publishChunk("bdv_wrongkey"));
    await vi.waitFor(() => expect(sock.writtenText()).toContain("NetStream.Publish.BadName"));
    expect(calls.start).toBe(0);
    await vi.waitFor(() => expect(sock.destroyed).toBe(true), { timeout: 3000 });
    expect(activeIngestUserIds()).toEqual([]);
  });

  it("refuses a second simultaneous publish on the same creator's key", async () => {
    const { deps, calls } = makeDeps(RESOLVED);
    const one = new FakeSocket();
    new RtmpPublishConnection(one as never, deps);
    handshakeAndConnect(one);
    one.deliver(publishChunk("bdv_goodkey"));
    await vi.waitFor(() => expect(one.writtenText()).toContain("NetStream.Publish.Start"));

    const two = new FakeSocket();
    new RtmpPublishConnection(two as never, deps);
    handshakeAndConnect(two);
    two.deliver(publishChunk("bdv_goodkey"));
    await vi.waitFor(() => expect(two.writtenText()).toContain("NetStream.Publish.AlreadyPublishing"));
    expect(calls.start).toBe(1);
  });

  it("dropping the creator's connections (revoke/regenerate) ends the stream", async () => {
    const { deps, calls } = makeDeps(RESOLVED);
    const sock = new FakeSocket();
    new RtmpPublishConnection(sock as never, deps);
    handshakeAndConnect(sock);
    sock.deliver(publishChunk("bdv_goodkey"));
    await vi.waitFor(() => expect(sock.writtenText()).toContain("NetStream.Publish.Start"));

    expect(dropIngestConnectionsForUser(USER)).toBe(true);
    expect(sock.destroyed).toBe(true);
    await vi.waitFor(() => expect(calls.end).toEqual(["stream-1"]));
    expect(activeIngestUserIds()).toEqual([]);
    expect(dropIngestConnectionsForUser(USER)).toBe(false);
  });

  it("an encoder disconnect ends the stream exactly once", async () => {
    const { deps, calls } = makeDeps(RESOLVED);
    const sock = new FakeSocket();
    new RtmpPublishConnection(sock as never, deps);
    handshakeAndConnect(sock);
    sock.deliver(publishChunk("bdv_goodkey"));
    await vi.waitFor(() => expect(sock.writtenText()).toContain("NetStream.Publish.Start"));
    sock.destroy();
    await vi.waitFor(() => expect(calls.end).toEqual(["stream-1"]));
    expect(activeIngestUserIds()).toEqual([]);
  });
});
