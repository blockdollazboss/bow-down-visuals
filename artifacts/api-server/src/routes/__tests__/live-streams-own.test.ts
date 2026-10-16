/**
 * Route tests for Go Live on the OWN-SERVER transport
 * (routes/live-streams with LIVE_TRANSPORT=own — the default):
 *   GET  /api/live-streams/status            → transport "own", ready
 *   POST /api/live-streams                   → own-server row + engine slot
 *   POST /api/live-streams/:id/ingest/segment → owner-only chunk ingest
 *   GET  /api/live-streams/:id/hls/:file     → whitelist HLS serving
 *   POST /api/live-streams/:id/end           → engine finalize → replay
 *
 * Same harness style as live-streams.test.ts (fake db over the real
 * table objects), with two differences: auth is header-driven (so the
 * not-owner and signed-out ingest paths are real), and the media
 * engine module is mocked with test-controlled sessions — EXCEPT its
 * filename whitelist, which stays the real implementation.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const AUTH_USER = "00000000-0000-4000-8000-0000000000aa";
const OTHER_USER = "00000000-0000-4000-8000-0000000000bb";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE_SLUG = "live-creator";

/* Pin the transport under test before the router module loads. */
vi.hoisted(() => {
  process.env.LIVE_TRANSPORT = "own";
  delete process.env.LIVE_OWN_SERVER;
});

const h = vi.hoisted(() => ({
  state: {
    profiles: [] as Array<Record<string, unknown>>,
    streams: new Map<string, Record<string, unknown>>(),
    clips: [] as Array<Record<string, unknown>>,
    seq: 0,
    own: {
      activeCount: 0,
      beginOk: true,
      beginCalls: [] as string[],
      sessions: new Set<string>(),
      seqs: new Map<string, Set<number>>(),
      acceptCalls: [] as Array<{ id: string; seq: number; bytes: number; contentType: string }>,
      acceptError: null as string | null,
      endCalls: [] as string[],
      finalizeCalls: [] as string[],
      finalizeResult: null as { vodUrl: string; contentType: string } | null,
      stallHandler: null as ((id: string, reason: string) => void) | null,
    },
    hlsDir: "",
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

function eqPairs(sql: string, params: unknown[]): Array<[string, unknown]> {
  const found: Array<{ col: string; idx: number }> = [];
  for (const col of ["user_id", "profile_id", "status", "slug", "id"]) {
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

/* Header-driven auth: x-test-user carries the user id; absent = 401. */
vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const uid = req.header("x-test-user");
    if (!uid) {
      res.status(401).json({ error: "Sign in required." });
      return;
    }
    req.userId = uid;
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/cloudflare-stream", () => {
  class StreamNotConfiguredError extends Error {
    code = "STREAM_NOT_CONFIGURED";
  }
  class StreamProviderError extends Error {
    status = 502;
  }
  return {
    StreamNotConfiguredError,
    StreamProviderError,
    isStreamConfigured: () => false,
    createLiveInput: async () => {
      throw new Error("cloudflare must not be called on the own transport");
    },
    deleteLiveInput: async () => undefined,
    playbackUrlsFromWhip: () => ({ whep_url: null, hls_url: null }),
  };
});

vi.mock("../../lib/own-server-live", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const own = h.state.own;
  return {
    ...actual,
    initOwnServerLive: (handlers: any) => {
      own.stallHandler = handlers.onStall;
    },
    ownServerConfig: () => ({ ...actual.ownServerConfig(), maxConcurrent: 3 }),
    activeSessionCount: () => own.activeCount,
    beginSession: (id: string) => {
      own.beginCalls.push(id);
      if (!own.beginOk) return { ok: false, code: "CAPACITY" };
      own.sessions.add(id);
      own.activeCount += 1;
      return { ok: true };
    },
    hasSession: (id: string) => own.sessions.has(id),
    acceptChunk: async (id: string, seq: number, data: Buffer, contentType: string) => {
      own.acceptCalls.push({ id, seq, bytes: data.length, contentType });
      if (own.acceptError) throw new actual.LiveIngestError(own.acceptError, "engine refused the chunk");
      const seen = own.seqs.get(id) ?? new Set<number>();
      if (seen.has(seq)) return { duplicate: true };
      seen.add(seq);
      own.seqs.set(id, seen);
      return { duplicate: false };
    },
    endSession: async (id: string) => {
      own.endCalls.push(id);
      own.sessions.delete(id);
    },
    finalizeRecording: async (id: string) => {
      own.finalizeCalls.push(id);
      return own.finalizeResult;
    },
    /* The whitelist stays REAL; only path resolution is the test's. */
    liveFilePath: (id: string, name: string) => {
      if (!actual.isLiveFileName(name)) return null;
      const p = path.join(h.state.hlsDir, id, name);
      return fs.existsSync(p) ? p : null;
    },
  };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { liveStreamsTable, creatorProfilesTable, generatedClipsTable } = actual;

  function matchStream(cond: unknown): Array<Record<string, unknown>> {
    const { sql, params } = render(cond);
    let rows = [...state.streams.values()];
    if (sql.includes(" in (")) {
      const ids = params.map(String);
      return rows.filter((r) => ids.includes(String(r["id"])));
    }
    for (const [col, val] of eqPairs(sql, params)) {
      rows = rows.filter((r) => String(r[col] ?? "") === String(val ?? ""));
    }
    return rows;
  }

  function rowsFor(table: unknown, cond: unknown): Array<Record<string, unknown>> {
    const { sql, params } = render(cond);
    if (table === creatorProfilesTable) {
      if (sql.includes(" in (")) {
        const ids = params.map(String);
        return state.profiles.filter((p) => ids.includes(String(p["id"])));
      }
      const pairs = eqPairs(sql, params);
      let rows = [...state.profiles];
      for (const [col, val] of pairs) {
        const key = col === "user_id" ? "userId" : col;
        rows = rows.filter((p) => String(p[key] ?? "") === String(val ?? ""));
      }
      return rows;
    }
    if (table === liveStreamsTable) return matchStream(cond);
    return [];
  }

  function chain(table: unknown, cond: unknown): any {
    const self: any = {
      limit: (_n: number) => self,
      offset: (_n: number) => self,
      orderBy: (..._args: unknown[]) => self,
      then: (res: any, rej: any) => Promise.resolve(rowsFor(table, cond)).then(res, rej),
    };
    return self;
  }

  function applyUpdate(table: unknown, patch: Record<string, unknown>, cond: unknown) {
    if (table !== liveStreamsTable) return [];
    const { sql, params } = render(cond);
    let targets: Array<Record<string, unknown>>;
    if (sql.includes('"started_at"') && sql.includes("<")) {
      const cutoff = new Date(String(params[params.length - 1]));
      targets = [...state.streams.values()].filter(
        (r) => r["status"] === "live" && new Date(String(r["started_at"])) < cutoff,
      );
    } else {
      targets = matchStream(cond);
    }
    for (const row of targets) Object.assign(row, patch);
    return targets;
  }

  function updateChain(table: unknown, patch: Record<string, unknown>): any {
    return {
      where: (cond: unknown) => {
        const self: any = {
          returning: async () => applyUpdate(table, patch, cond),
          then: (res: any, rej: any) => {
            applyUpdate(table, patch, cond);
            return Promise.resolve([]).then(res, rej);
          },
        };
        return self;
      },
    };
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => chain(table, cond),
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => ({
        returning: async () => {
          state.seq += 1;
          if (table === liveStreamsTable) {
            const row: Record<string, unknown> = {
              id: `stream-${state.seq}`,
              viewer_count: 0,
              peak_viewers: 0,
              vod_url: null,
              vod_clip_id: null,
              ended_at: null,
              started_at: new Date(),
              created_at: new Date(),
              updated_at: new Date(),
              ...v,
            };
            state.streams.set(String(row["id"]), row);
            return [row];
          }
          if (table === generatedClipsTable) {
            const row: Record<string, unknown> = { id: `clip-${state.seq}`, created_at: new Date(), ...v };
            state.clips.push(row);
            return [row];
          }
          return [{ ...v }];
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => updateChain(table, patch),
    }),
    execute: async () => [],
  };

  return { ...actual, db: fakeDb };
});

import router, { __resetViewerTracker } from "../live-streams";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  h.state.hlsDir = await fsp.mkdtemp(path.join(os.tmpdir(), "bdv-hls-test-"));
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await fsp.rm(h.state.hlsDir, { recursive: true, force: true }).catch(() => undefined);
});

beforeEach(() => {
  const s = h.state;
  s.profiles = [
    {
      id: PROFILE_ID,
      userId: AUTH_USER,
      slug: PROFILE_SLUG,
      displayName: "Live Creator",
      avatarUrl: "https://example.com/avatar.png",
      isPublic: true,
    },
  ];
  s.streams = new Map();
  s.clips = [];
  s.seq = 0;
  s.own.activeCount = 0;
  s.own.beginOk = true;
  s.own.beginCalls = [];
  s.own.sessions = new Set();
  s.own.seqs = new Map();
  s.own.acceptCalls = [];
  s.own.acceptError = null;
  s.own.endCalls = [];
  s.own.finalizeCalls = [];
  s.own.finalizeResult = null;
  __resetViewerTracker();
});

async function call(method: string, p: string, body?: unknown, user: string | null = AUTH_USER) {
  const headers: Record<string, string> = {};
  if (user) headers["x-test-user"] = user;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const r = await realFetch(`${baseUrl}${p}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

async function goLive() {
  return call("POST", "/live-streams", { title: "Friday Night Live" });
}

async function postSegment(id: string, seq: number | null, user: string | null = AUTH_USER) {
  const headers: Record<string, string> = { "Content-Type": "video/webm" };
  if (user) headers["x-test-user"] = user;
  if (seq !== null) headers["x-segment-seq"] = String(seq);
  const r = await realFetch(`${baseUrl}/live-streams/${id}/ingest/segment`, {
    method: "POST",
    headers,
    body: Buffer.from("chunk-bytes"),
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

function seedRow(patch: Record<string, unknown>): string {
  const id = `seed-${h.state.streams.size + 1}`;
  h.state.streams.set(id, {
    id,
    user_id: AUTH_USER,
    profile_id: PROFILE_ID,
    title: "Seeded",
    status: "live",
    provider: "own-server",
    provider_input_id: null,
    playback_id: null,
    whip_url: null,
    vod_url: null,
    vod_clip_id: null,
    viewer_count: 0,
    peak_viewers: 0,
    destinations: null,
    started_at: new Date(),
    ended_at: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...patch,
  });
  return id;
}

const flush = () => new Promise((r) => setTimeout(r, 25));

/* ------------------------------------------------------------------ tests */

describe("status + create on the own transport", () => {
  it("status reports the own transport, ready with no external keys", async () => {
    const { status, json } = await call("GET", "/live-streams/status");
    expect(status).toBe(200);
    expect(json).toEqual({ configured: true, transport: "own", live_stream: null });
  });

  it("create opens an own-server row + engine session; DTO carries the HLS playback URL", async () => {
    const { status, json } = await goLive();
    expect(status).toBe(201);
    const dto = json.stream;
    expect(dto.whip_url).toBeNull();
    expect(dto.playback).toEqual({
      whep_url: null,
      hls_url: `/api/live-streams/${dto.id}/hls/playlist.m3u8`,
    });
    const row = h.state.streams.get(dto.id)!;
    expect(row["provider"]).toBe("own-server");
    expect(row["provider_input_id"]).toBeNull();
    expect(h.state.own.beginCalls).toEqual([dto.id]);
  });

  it("create refuses honestly when the stage is at capacity", async () => {
    h.state.own.activeCount = 3;
    const { status, json } = await goLive();
    expect(status).toBe(503);
    expect(json.code).toBe("LIVE_CAPACITY");
    expect(h.state.streams.size).toBe(0);
    expect(h.state.own.beginCalls).toEqual([]);
  });
});

describe("chunk ingest", () => {
  it("accepts ordered chunks from the owner; a re-sent seq reports duplicate", async () => {
    const { json } = await goLive();
    const id = json.stream.id;
    const first = await postSegment(id, 0);
    expect(first.status).toBe(200);
    expect(first.json).toEqual({ ok: true, duplicate: false, seq: 0 });
    const again = await postSegment(id, 0);
    expect(again.json).toEqual({ ok: true, duplicate: true, seq: 0 });
    expect(h.state.own.acceptCalls.map((c) => c.seq)).toEqual([0, 0]);
    expect(h.state.own.acceptCalls[0].contentType).toContain("video/webm");
  });

  it("refuses signed-out publishers and non-owners", async () => {
    const { json } = await goLive();
    const id = json.stream.id;
    expect((await postSegment(id, 0, null)).status).toBe(401);
    expect((await postSegment(id, 0, OTHER_USER)).status).toBe(403);
    expect(h.state.own.acceptCalls).toEqual([]);
  });

  it("refuses streams of the other transport, ended streams, and missing sessions", async () => {
    const cfId = seedRow({ provider: "cloudflare", provider_input_id: "cf-1" });
    const wrong = await postSegment(cfId, 0);
    expect(wrong.status).toBe(400);
    expect(wrong.json.code).toBe("WRONG_TRANSPORT");

    const endedId = seedRow({ status: "ended" });
    h.state.own.sessions.add(endedId);
    const ended = await postSegment(endedId, 0);
    expect(ended.status).toBe(410);
    expect(ended.json.code).toBe("STREAM_ENDED");

    const ghostId = seedRow({});
    const ghost = await postSegment(ghostId, 0);
    expect(ghost.status).toBe(409);
    expect(ghost.json.code).toBe("NO_INGEST_SESSION");

    expect((await postSegment("missing-id", 0)).status).toBe(404);
  });

  it("requires a sequence header and maps engine refusals to honest statuses", async () => {
    const { json } = await goLive();
    const id = json.stream.id;
    expect((await postSegment(id, null)).status).toBe(400);

    h.state.own.acceptError = "UNSUPPORTED_MIME";
    expect((await postSegment(id, 0)).status).toBe(415);
    h.state.own.acceptError = "SESSION_FULL";
    const full = await postSegment(id, 0);
    expect(full.status).toBe(413);
    expect(full.json.code).toBe("SESSION_FULL");
    h.state.own.acceptError = null;
  });
});

describe("HLS serving", () => {
  it("serves the playlist uncached and segments briefly cached, from the whitelist only", async () => {
    const id = seedRow({});
    const dirFor = path.join(h.state.hlsDir, id);
    await fsp.mkdir(dirFor, { recursive: true });
    await fsp.writeFile(path.join(dirFor, "playlist.m3u8"), "#EXTM3U\n#EXT-X-VERSION:7\n");
    await fsp.writeFile(path.join(dirFor, "seg00000.m4s"), "segment-bytes");

    const pl = await realFetch(`${baseUrl}/live-streams/${id}/hls/playlist.m3u8`);
    expect(pl.status).toBe(200);
    expect(pl.headers.get("content-type")).toContain("application/vnd.apple.mpegurl");
    expect(pl.headers.get("cache-control")).toBe("no-cache");
    expect(await pl.text()).toContain("#EXTM3U");

    const seg = await realFetch(`${baseUrl}/live-streams/${id}/hls/seg00000.m4s`);
    expect(seg.status).toBe(200);
    expect(seg.headers.get("cache-control")).toBe("public, max-age=30");
    expect(await seg.text()).toBe("segment-bytes");

    expect((await realFetch(`${baseUrl}/live-streams/${id}/hls/evil.txt`)).status).toBe(404);
    expect((await realFetch(`${baseUrl}/live-streams/${id}/hls/seg999999.m4s`)).status).toBe(404);
    const cfId = seedRow({ provider: "cloudflare" });
    expect((await realFetch(`${baseUrl}/live-streams/${cfId}/hls/playlist.m3u8`)).status).toBe(404);
  });
});

describe("end → engine finalize → replay", () => {
  it("registers the replay when the engine produced a recording", async () => {
    const { json } = await goLive();
    const id = json.stream.id;
    h.state.own.finalizeResult = { vodUrl: `https://media.example/${AUTH_USER}/live/${id}.webm`, contentType: "video/webm" };
    const end = await call("POST", `/live-streams/${id}/end`);
    expect(end.status).toBe(200);
    await flush();
    expect(h.state.own.endCalls).toEqual([id]);
    expect(h.state.own.finalizeCalls).toEqual([id]);
    const row = h.state.streams.get(id)!;
    expect(row["vod_url"]).toBe(`https://media.example/${AUTH_USER}/live/${id}.webm`);
    expect(h.state.clips).toHaveLength(1);
    const site = (row["destinations"] as Array<Record<string, unknown>>).find((d) => d["platform"] === "site");
    expect(site).toMatchObject({ vod_state: "saved" });
  });

  it("marks the replay not_saved — never a fake success — when nothing was recorded", async () => {
    const { json } = await goLive();
    const id = json.stream.id;
    h.state.own.finalizeResult = null;
    await call("POST", `/live-streams/${id}/end`);
    await flush();
    const row = h.state.streams.get(id)!;
    expect(row["vod_url"]).toBeNull();
    const site = (row["destinations"] as Array<Record<string, unknown>>).find((d) => d["platform"] === "site");
    expect(site).toMatchObject({ vod_state: "not_saved" });
  });
});
