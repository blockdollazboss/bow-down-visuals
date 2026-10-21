/**
 * Route tests for the RTMP ingest-key endpoints (migration 0194) on
 * routes/live-streams:
 *   GET   /api/live-streams/ingest-key           → status, NEVER the key
 *   POST  /api/live-streams/ingest-key/reveal    → mints + shows the key ONCE
 *   POST  /api/live-streams/ingest-key/regenerate→ new key, old one dead
 *   POST  /api/live-streams/ingest-key/revoke    → key dead
 *   PATCH /api/live-streams/ingest-key           → standing stream title
 *
 * The discipline being pinned: a key is issued to its owner ONLY —
 * another signed-in member's reveal returns THEIR key, never anyone
 * else's; storage is hash-only, so the plain key is shown exactly
 * once (the minting response) and never again, and it sits nowhere
 * in the stored row; the plain key appears in no status payload; and
 * publish auth (lib/rtmp-ingest resolveIngestKey over the same fake
 * db) follows the HTTP lifecycle exactly — regenerate and revoke
 * kill keys at once.
 *
 * Harness: same fake-db-over-real-tables style as
 * live-streams-own.test.ts, extended with live_ingest_keys.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const AUTH_USER = "00000000-0000-4000-8000-0000000000aa";
const OTHER_USER = "00000000-0000-4000-8000-0000000000bb";
const NO_PROFILE_USER = "00000000-0000-4000-8000-0000000000cc";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_PROFILE_ID = "22222222-2222-4222-8222-222222222222";

/* Pin the transport under test before the router module loads. */
vi.hoisted(() => {
  process.env.LIVE_TRANSPORT = "own";
  delete process.env.LIVE_OWN_SERVER;
  process.env.PUBLIC_SITE_URL = "https://bowdownvisuals.example";
});

const h = vi.hoisted(() => ({
  state: {
    profiles: [] as Array<Record<string, unknown>>,
    streams: new Map<string, Record<string, unknown>>(),
    keys: [] as Array<Record<string, unknown>>,
    seq: 0,
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

function eqPairs(sql: string, params: unknown[]): Array<[string, unknown]> {
  const found: Array<{ col: string; idx: number }> = [];
  for (const col of ["user_id", "profile_id", "key_lookup", "status", "slug", "id"]) {
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
  return {
    ...actual,
    initOwnServerLive: () => undefined,
    ownServerConfig: () => ({ ...actual.ownServerConfig(), maxConcurrent: 3 }),
    activeSessionCount: () => 0,
    beginSession: () => ({ ok: true }),
    hasSession: () => false,
    acceptChunk: async () => ({ duplicate: false }),
    endSession: async () => undefined,
    finalizeRecording: async () => null,
    liveFilePath: () => null,
  };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const { liveStreamsTable, creatorProfilesTable, generatedClipsTable, liveIngestKeysTable } = actual;

  function filterEq(rows: Array<Record<string, unknown>>, cond: unknown, keyOf: (col: string) => string) {
    const { sql, params } = render(cond);
    let out = rows;
    for (const [col, val] of eqPairs(sql, params)) {
      out = out.filter((r) => String(r[keyOf(col)] ?? "") === String(val ?? ""));
    }
    return out;
  }

  function rowsFor(table: unknown, cond: unknown): Array<Record<string, unknown>> {
    if (table === creatorProfilesTable) {
      return filterEq([...state.profiles], cond, (col) => (col === "user_id" ? "userId" : col));
    }
    if (table === liveIngestKeysTable) {
      return filterEq([...state.keys], cond, (col) => col);
    }
    if (table === liveStreamsTable) {
      const { sql, params } = render(cond);
      if (sql.includes(" in (")) {
        const ids = params.map(String);
        return [...state.streams.values()].filter((r) => ids.includes(String(r["id"])));
      }
      return filterEq([...state.streams.values()], cond, (col) => col);
    }
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
    if (table === liveIngestKeysTable) {
      const targets = rowsFor(table, cond);
      for (const row of targets) Object.assign(row, patch);
      return targets;
    }
    if (table === liveStreamsTable) {
      const targets = rowsFor(table, cond);
      for (const row of targets) Object.assign(row, patch);
      return targets;
    }
    return [];
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
          if (table === liveIngestKeysTable) {
            const row: Record<string, unknown> = {
              id: `key-${state.seq}`,
              stream_title: null,
              revoked_at: null,
              created_at: new Date(),
              updated_at: new Date(),
              ...v,
            };
            state.keys.push(row);
            return [row];
          }
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
            return [{ id: `clip-${state.seq}`, created_at: new Date(), ...v }];
          }
          return [{ ...v }];
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
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
      }),
    }),
    execute: async () => [],
  };

  return { ...actual, db: fakeDb };
});

import router, { __resetViewerTracker } from "../live-streams";
import { resolveIngestKey } from "../../lib/rtmp-ingest";

let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  const s = h.state;
  s.profiles = [
    { id: PROFILE_ID, userId: AUTH_USER, slug: "live-creator", displayName: "Live Creator", avatarUrl: null, isPublic: true },
    { id: OTHER_PROFILE_ID, userId: OTHER_USER, slug: "other-creator", displayName: "Other Creator", avatarUrl: null, isPublic: true },
  ];
  s.streams = new Map();
  s.keys = [];
  s.seq = 0;
  __resetViewerTracker();
});

async function call(method: string, path: string, user?: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(user ? { "x-test-user": user } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

describe("ingest-key endpoints", () => {
  it("requires sign-in on every key door", async () => {
    expect((await call("GET", "/live-streams/ingest-key")).status).toBe(401);
    expect((await call("POST", "/live-streams/ingest-key/reveal")).status).toBe(401);
    expect((await call("POST", "/live-streams/ingest-key/regenerate")).status).toBe(401);
    expect((await call("POST", "/live-streams/ingest-key/revoke")).status).toBe(401);
    expect((await call("PATCH", "/live-streams/ingest-key", undefined, { stream_title: "x" })).status).toBe(401);
  });

  it("status starts empty and never carries a key", async () => {
    const { status, json } = await call("GET", "/live-streams/ingest-key", AUTH_USER);
    expect(status).toBe(200);
    expect(json.ingest).toMatchObject({
      enabled: true,
      ingest_url: "rtmp://bowdownvisuals.example/live",
      has_key: false,
      key_hint: null,
      revoked: false,
    });
    expect(JSON.stringify(json)).not.toContain("stream_key");
    expect(JSON.stringify(json)).not.toContain("bdv_");
  });

  it("reveal refuses a member with no creator profile", async () => {
    const { status, json } = await call("POST", "/live-streams/ingest-key/reveal", NO_PROFILE_USER);
    expect(status).toBe(400);
    expect(json.code).toBe("NO_PROFILE");
    expect(h.state.keys).toHaveLength(0);
  });

  it("issues the key to its owner only — a second member gets their own, never the first's", async () => {
    const mine = await call("POST", "/live-streams/ingest-key/reveal", AUTH_USER);
    expect(mine.status).toBe(200);
    expect(mine.json.stream_key).toMatch(/^bdv_[A-Za-z0-9_-]{32}$/);
    expect(mine.json.ingest).toMatchObject({ has_key: true, key_hint: mine.json.stream_key.slice(-4) });

    const theirs = await call("POST", "/live-streams/ingest-key/reveal", OTHER_USER);
    expect(theirs.status).toBe(200);
    expect(theirs.json.stream_key).toMatch(/^bdv_/);
    expect(theirs.json.stream_key).not.toBe(mine.json.stream_key);
    expect(JSON.stringify(theirs.json)).not.toContain(mine.json.stream_key);

    // And status still shows neither key to anyone.
    const status = await call("GET", "/live-streams/ingest-key", AUTH_USER);
    expect(JSON.stringify(status.json)).not.toContain(mine.json.stream_key);
    expect(JSON.stringify(status.json)).not.toContain(theirs.json.stream_key);
  });

  it("shows the key exactly once: a second reveal returns no key, rotates nothing, and the stored row holds no plain key", async () => {
    const first = await call("POST", "/live-streams/ingest-key/reveal", AUTH_USER);
    const key = first.json.stream_key as string;
    expect(key).toMatch(/^bdv_/);

    // Hash-only storage: the row the server keeps contains the plain
    // key in NO field.
    expect(h.state.keys).toHaveLength(1);
    expect(JSON.stringify(h.state.keys)).not.toContain(key);

    const second = await call("POST", "/live-streams/ingest-key/reveal", AUTH_USER);
    expect(second.status).toBe(200);
    expect(second.json.stream_key).toBeNull();
    expect(second.json.code).toBe("KEY_NOT_RESHOWN");
    expect(second.json.ingest).toMatchObject({ has_key: true, key_hint: key.slice(-4) });

    // Asking again did NOT rotate: the original key still publishes.
    expect(await resolveIngestKey(key)).toMatchObject({ userId: AUTH_USER });
    expect(h.state.keys).toHaveLength(1);
  });

  it("regenerate kills the old key for publish auth at once; revoke kills the new one", async () => {
    const first = (await call("POST", "/live-streams/ingest-key/reveal", AUTH_USER)).json.stream_key as string;
    expect(await resolveIngestKey(first)).toMatchObject({ userId: AUTH_USER, profileId: PROFILE_ID });

    const regen = await call("POST", "/live-streams/ingest-key/regenerate", AUTH_USER);
    const second = regen.json.stream_key as string;
    expect(second).not.toBe(first);
    expect(await resolveIngestKey(first)).toBeNull();
    expect(await resolveIngestKey(second)).toMatchObject({ userId: AUTH_USER });

    const revoked = await call("POST", "/live-streams/ingest-key/revoke", AUTH_USER);
    expect(revoked.json.ingest).toMatchObject({ revoked: true, has_key: false, key_hint: null });
    expect(await resolveIngestKey(second)).toBeNull();
  });

  it("the standing title is the owner's to set, and only once a key exists", async () => {
    const noKey = await call("PATCH", "/live-streams/ingest-key", AUTH_USER, { stream_title: "Too soon" });
    expect(noKey.status).toBe(404);
    expect(noKey.json.code).toBe("NO_KEY");

    const key = (await call("POST", "/live-streams/ingest-key/reveal", AUTH_USER)).json.stream_key as string;
    const saved = await call("PATCH", "/live-streams/ingest-key", AUTH_USER, { stream_title: "  Friday Night Set  " });
    expect(saved.status).toBe(200);
    expect(saved.json.ingest.stream_title).toBe("Friday Night Set");
    expect(await resolveIngestKey(key)).toMatchObject({ streamTitle: "Friday Night Set" });

    const tooLong = await call("PATCH", "/live-streams/ingest-key", AUTH_USER, { stream_title: "x".repeat(121) });
    expect(tooLong.status).toBe(400);
  });
});
