/**
 * Now-playing feed tests (stack900 lane D3).
 *
 * Three layers, on the real machinery with only the db and the
 * session/rate-limit middleware stubbed (the C2 harness pattern):
 *   1. The TTL + DTO rules (lib/now-playing) as pure functions —
 *      the expiry defence is pinned exactly.
 *   2. The state service against a fake db — start / heartbeat /
 *      track-change / stop / expiry semantics.
 *   3. The REST surface on a real express server: owner-only
 *      reports, the live gate, the token read, and a privacy pin
 *      (nothing an overlay can read carries an id).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { PgDialect } from "drizzle-orm/pg-core";

const CREATOR = "00000000-0000-4000-8000-0000000000d3";
const OTHER = "00000000-0000-4000-8000-0000000000e3";
const STREAM_ID = "33333333-3333-4333-8333-333333333333";
const ENDED_STREAM_ID = "44444444-4444-4444-8444-444444444444";
const TOKEN = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; // 43-char base64url shape
const DEAD_TOKEN = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

const h = vi.hoisted(() => ({
  streams: [] as Array<Record<string, unknown>>,
  nowPlaying: new Map<string, Record<string, unknown>>(),
  tokens: new Map<string, string>(),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) {
      res.status(401).json({ error: "Sign in to do that." });
      return;
    }
    req.userId = user;
    next();
  },
}));
vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const dialect = new PgDialect();

  function paramsOf(cond: unknown): unknown[] {
    try {
      return dialect.sqlToQuery(cond as never).params;
    } catch {
      return [];
    }
  }

  function rowsFor(table: unknown, params: unknown[]): Array<Record<string, unknown>> {
    if (table === actual.liveStreamsTable) {
      return h.streams.filter(
        (s) =>
          s["id"] === params[0] ||
          (s["user_id"] === params[0] && (params.length < 2 || s["status"] === params[1])),
      );
    }
    if (table === actual.liveNowPlayingTable) {
      return [...h.nowPlaying.values()].filter((r) => r["stream_id"] === params[0]);
    }
    return [];
  }

  const db = {
    select: () => {
      let table: unknown;
      let params: unknown[] = [];
      const chain: any = {
        from: (t: unknown) => {
          table = t;
          return chain;
        },
        where: (cond: unknown) => {
          params = paramsOf(cond);
          return chain;
        },
        orderBy: () => chain,
        limit: async (n: number) => rowsFor(table, params).slice(0, n),
        then: (resolve: (rows: Array<Record<string, unknown>>) => unknown, reject: (err: unknown) => unknown) =>
          Promise.resolve(rowsFor(table, params)).then(resolve, reject),
      };
      return chain;
    },
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoUpdate: (_cfg: { set: Record<string, unknown> }) => ({
          returning: async () => {
            if (table === actual.liveNowPlayingTable) {
              h.nowPlaying.set(String(v["stream_id"]), { ...v });
              return [v];
            }
            return [v];
          },
        }),
        returning: async () => [v],
      }),
    }),
    delete: (table: unknown) => ({
      where: async (cond: unknown) => {
        const params = paramsOf(cond);
        if (table === actual.liveNowPlayingTable) h.nowPlaying.delete(String(params[0]));
      },
    }),
    execute: async (query: unknown) => {
      const params = paramsOf(query);
      const token = String(params[0] ?? "");
      const userId = h.tokens.get(token);
      return { rows: userId ? [{ user_id: userId }] : [] };
    },
  };
  return { ...actual, db };
});

import {
  NOW_PLAYING_GRACE_SEC,
  NOW_PLAYING_MAX_HORIZON_SEC,
  NOW_PLAYING_UNKNOWN_TTL_SEC,
  computeNowPlayingExpiry,
  reportNowPlaying,
  clearNowPlaying,
  readNowPlayingForStream,
  readNowPlayingForCreator,
  resolveOverlayTokenForNowPlaying,
  toNowPlayingDto,
} from "../../lib/now-playing";
import router from "../now-playing";

const T0 = new Date("2026-10-30T02:00:00.000Z");

function seedWorld() {
  h.streams = [
    { id: STREAM_ID, user_id: CREATOR, status: "live", title: "Friday Live", created_at: T0 },
    { id: ENDED_STREAM_ID, user_id: CREATOR, status: "ended", title: "Last Week", created_at: T0 },
  ];
  h.nowPlaying.clear();
  h.tokens.clear();
  h.tokens.set(TOKEN, CREATOR);
}

describe("now-playing TTL rules (pure)", () => {
  it("known duration earns duration + grace", () => {
    const exp = computeNowPlayingExpiry(T0, 180);
    expect(exp.getTime() - T0.getTime()).toBe((180 + NOW_PLAYING_GRACE_SEC) * 1000);
  });

  it("unknown duration earns the short window", () => {
    const exp = computeNowPlayingExpiry(T0, null);
    expect(exp.getTime() - T0.getTime()).toBe(NOW_PLAYING_UNKNOWN_TTL_SEC * 1000);
  });

  it("no single report reaches past the horizon", () => {
    const exp = computeNowPlayingExpiry(T0, 10 * 3600);
    expect(exp.getTime() - T0.getTime()).toBe(NOW_PLAYING_MAX_HORIZON_SEC * 1000);
  });

  it("an expired row is not a DTO; a live row carries only public fields", () => {
    const base = {
      stream_id: STREAM_ID,
      creator_user_id: CREATOR,
      title: "Midnight Run",
      artist: "Stage Star",
      duration_sec: 200,
      started_at: T0,
      updated_at: T0,
    } as never;
    expect(toNowPlayingDto({ ...(base as object), expires_at: new Date(T0.getTime() - 1) } as never, T0)).toBeNull();
    const dto = toNowPlayingDto({ ...(base as object), expires_at: new Date(T0.getTime() + 60_000) } as never, T0);
    expect(dto).toEqual({
      title: "Midnight Run",
      artist: "Stage Star",
      durationSec: 200,
      startedAt: T0.toISOString(),
      expiresAt: new Date(T0.getTime() + 60_000).toISOString(),
    });
    expect(Object.keys(dto!).sort()).toEqual(["artist", "durationSec", "expiresAt", "startedAt", "title"]);
  });
});

describe("now-playing state service (fake db)", () => {
  beforeEach(() => seedWorld());

  it("start stores the track; a same-track heartbeat keeps started_at and extends expiry", async () => {
    const first = await reportNowPlaying({
      streamId: STREAM_ID, creatorUserId: CREATOR,
      title: "Midnight Run", artist: "Stage Star", durationSec: 200, now: T0,
    });
    expect(new Date(first.started_at).getTime()).toBe(T0.getTime());
    const later = new Date(T0.getTime() + 30_000);
    const beat = await reportNowPlaying({
      streamId: STREAM_ID, creatorUserId: CREATOR,
      title: "Midnight Run", artist: "Stage Star", durationSec: 200, now: later,
    });
    expect(new Date(beat.started_at).getTime()).toBe(T0.getTime());
    expect(new Date(beat.expires_at).getTime()).toBe(later.getTime() + (200 + NOW_PLAYING_GRACE_SEC) * 1000);
  });

  it("a track change replaces the row and restarts the clock", async () => {
    await reportNowPlaying({
      streamId: STREAM_ID, creatorUserId: CREATOR,
      title: "First Song", artist: "Stage Star", durationSec: 100, now: T0,
    });
    const later = new Date(T0.getTime() + 60_000);
    const next = await reportNowPlaying({
      streamId: STREAM_ID, creatorUserId: CREATOR,
      title: "Second Song", artist: "Stage Star", durationSec: 100, now: later,
    });
    expect(next.title).toBe("Second Song");
    expect(new Date(next.started_at).getTime()).toBe(later.getTime());
    expect(h.nowPlaying.size).toBe(1);
  });

  it("stop clears the state", async () => {
    await reportNowPlaying({
      streamId: STREAM_ID, creatorUserId: CREATOR,
      title: "Midnight Run", artist: "Stage Star", durationSec: 200, now: T0,
    });
    await clearNowPlaying(STREAM_ID);
    await expect(readNowPlayingForStream(STREAM_ID, T0)).resolves.toBeNull();
  });

  it("an expired row reads as nothing playing and is cleared as it is read past", async () => {
    await reportNowPlaying({
      streamId: STREAM_ID, creatorUserId: CREATOR,
      title: "Short One", artist: "Stage Star", durationSec: 10, now: T0,
    });
    const after = new Date(T0.getTime() + (10 + NOW_PLAYING_GRACE_SEC + 1) * 1000);
    await expect(readNowPlayingForStream(STREAM_ID, after)).resolves.toBeNull();
    expect(h.nowPlaying.has(STREAM_ID)).toBe(false);
  });

  it("the creator read follows the LIVE stream only", async () => {
    await reportNowPlaying({
      streamId: ENDED_STREAM_ID, creatorUserId: CREATOR,
      title: "Ghost Track", artist: "Stage Star", durationSec: 200, now: T0,
    });
    await expect(readNowPlayingForCreator(CREATOR, T0)).resolves.toBeNull();
    await reportNowPlaying({
      streamId: STREAM_ID, creatorUserId: CREATOR,
      title: "Live Track", artist: "Stage Star", durationSec: 200, now: T0,
    });
    const dto = await readNowPlayingForCreator(CREATOR, T0);
    expect(dto?.title).toBe("Live Track");
  });

  it("token resolution: junk shape never resolves; unknown well-shaped neither; known resolves", async () => {
    await expect(resolveOverlayTokenForNowPlaying("junk")).resolves.toBeNull();
    await expect(resolveOverlayTokenForNowPlaying("")).resolves.toBeNull();
    await expect(resolveOverlayTokenForNowPlaying(DEAD_TOKEN)).resolves.toBeNull();
    await expect(resolveOverlayTokenForNowPlaying(TOKEN)).resolves.toBe(CREATOR);
  });
});

describe("now-playing REST surface", () => {
  let server: Server;
  let base = "";

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/api", router);
    server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const addr = server.address() as AddressInfo;
    base = `http://127.0.0.1:${addr.port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  beforeEach(() => seedWorld());

  async function call(method: string, path: string, opts: { user?: string; body?: unknown } = {}) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(opts.user ? { "x-test-user": opts.user } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
    const text = await res.text();
    return { status: res.status, text, json: text ? JSON.parse(text) : null };
  }

  it("a report needs a signed-in owner of a live stream", async () => {
    const anon = await call("POST", `/api/live/${STREAM_ID}/now-playing`, { body: { title: "X", artist: "Y" } });
    expect(anon.status).toBe(401);

    const stranger = await call("POST", `/api/live/${STREAM_ID}/now-playing`, {
      user: OTHER, body: { title: "X", artist: "Y" },
    });
    expect(stranger.status).toBe(403);
    expect(stranger.json.code).toBe("NOT_YOUR_STREAM");

    const ended = await call("POST", `/api/live/${ENDED_STREAM_ID}/now-playing`, {
      user: CREATOR, body: { title: "X", artist: "Y" },
    });
    expect(ended.status).toBe(409);
    expect(ended.json.code).toBe("NOT_LIVE");

    const missing = await call("POST", `/api/live/99999999-9999-4999-8999-999999999999/now-playing`, {
      user: CREATOR, body: { title: "X", artist: "Y" },
    });
    expect(missing.status).toBe(404);
  });

  it("a report needs a title and an artist", async () => {
    const bad = await call("POST", `/api/live/${STREAM_ID}/now-playing`, {
      user: CREATOR, body: { title: "Only A Title" },
    });
    expect(bad.status).toBe(400);
    expect(bad.json.code).toBe("BAD_REPORT");
  });

  it("report → overlay read → stop → empty read, with a privacy pin on the raw JSON", async () => {
    const posted = await call("POST", `/api/live/${STREAM_ID}/now-playing`, {
      user: CREATOR,
      body: { title: "Midnight Run", artist: "Stage Star", durationSec: 213 },
    });
    expect(posted.status).toBe(200);
    expect(posted.json.nowPlaying.title).toBe("Midnight Run");
    expect(posted.json.nowPlaying.durationSec).toBe(213);

    const read = await call("GET", `/api/overlay/now-playing?token=${TOKEN}`);
    expect(read.status).toBe(200);
    expect(read.json.nowPlaying.title).toBe("Midnight Run");
    expect(read.json.nowPlaying.artist).toBe("Stage Star");
    // Privacy: the overlay surface carries no ids of any kind.
    expect(read.text).not.toContain(CREATOR);
    expect(read.text).not.toContain(STREAM_ID);
    expect(read.text).not.toContain("user_id");
    expect(read.text).not.toContain("stream_id");

    const strangerClear = await call("DELETE", `/api/live/${STREAM_ID}/now-playing`, { user: OTHER });
    expect(strangerClear.status).toBe(403);

    const cleared = await call("DELETE", `/api/live/${STREAM_ID}/now-playing`, { user: CREATOR });
    expect(cleared.status).toBe(200);
    const after = await call("GET", `/api/overlay/now-playing?token=${TOKEN}`);
    expect(after.json.nowPlaying).toBeNull();
  });

  it("the overlay read refuses junk and dead tokens, and answers an honest null when nothing plays", async () => {
    const junk = await call("GET", `/api/overlay/now-playing?token=nope`);
    expect(junk.status).toBe(401);
    const dead = await call("GET", `/api/overlay/now-playing?token=${DEAD_TOKEN}`);
    expect(dead.status).toBe(401);
    const empty = await call("GET", `/api/overlay/now-playing?token=${TOKEN}`);
    expect(empty.status).toBe(200);
    expect(empty.json).toEqual({ nowPlaying: null });
  });

  it("an expired report never reaches the overlay", async () => {
    h.nowPlaying.set(STREAM_ID, {
      stream_id: STREAM_ID,
      creator_user_id: CREATOR,
      title: "Stale Song",
      artist: "Stage Star",
      duration_sec: 30,
      started_at: new Date(Date.now() - 3_600_000),
      expires_at: new Date(Date.now() - 60_000),
      updated_at: new Date(Date.now() - 60_000),
    });
    const read = await call("GET", `/api/overlay/now-playing?token=${TOKEN}`);
    expect(read.status).toBe(200);
    expect(read.json.nowPlaying).toBeNull();
    expect(h.nowPlaying.has(STREAM_ID)).toBe(false);
  });
});
