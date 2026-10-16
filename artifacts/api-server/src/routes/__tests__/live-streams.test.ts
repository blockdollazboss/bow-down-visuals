/**
 * Route tests for Go Live broadcasts (routes/live-streams):
 *   POST /api/live-streams            (auth) create — WHIP session
 *   POST /api/live-streams/:id/end    (auth, owner) end (idempotent)
 *   POST /api/live-streams/:id/vod    (auth, owner) register the VOD
 *   GET  /api/live-streams/status     (auth) configured? + my live stream
 *   GET  /api/live-streams/live       (public) the Live-now list
 *   GET  /api/live-streams/:id        (public) watch DTO
 *   GET  /api/live-streams/profile/:slug (public) profile LIVE lookup
 *   POST /api/live-streams/:id/heartbeat (public) viewer presence
 *
 * Style mirrors creator-follow-unfollow.test.ts: the real router mounted
 * over a fake db (real table objects via importOriginal; WHERE params read
 * back through PgDialect rendering) whose lookups answer exactly the way
 * Postgres would for the condition shapes this router issues. The
 * Cloudflare client is module-mocked — no real provider calls — and its
 * configured flag is test-controlled, which is what lets the
 * STREAM_NOT_CONFIGURED path (the state the site ships in until the owner
 * sets the env vars) be driven the way the real studio drives it.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const AUTH_USER = "00000000-0000-4000-8000-0000000000aa";
const OTHER_USER = "00000000-0000-4000-8000-0000000000bb";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE_SLUG = "live-creator";
const WHIP = "https://customer-f33z.cloudflarestream.com/cf-input-1/webRTC/publish";
const WHEP = "https://customer-f33z.cloudflarestream.com/cf-input-1/webRTC/play";
const HLS = "https://customer-f33z.cloudflarestream.com/cf-input-1/manifest/video.m3u8";

const h = vi.hoisted(() => ({
  state: {
    configured: true,
    profiles: [] as Array<Record<string, unknown>>,
    streams: new Map<string, Record<string, unknown>>(),
    clips: [] as Array<Record<string, unknown>>,
    deletedInputs: [] as string[],
    createdInputs: [] as string[],
    seq: 0,
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

/** Column → param pairs in the order the conditions were built. */
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
  // inArray renders one column with N params — handled by callers via sql.
  return found.map((f, i) => [f.col, params[i]] as [string, unknown]);
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = AUTH_USER;
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
    isStreamConfigured: () => h.state.configured,
    createLiveInput: async (name: string) => {
      h.state.createdInputs.push(name);
      return {
        providerInputId: "cf-input-1",
        playbackId: "cf-input-1",
        whipUrl: WHIP,
        whepUrl: WHEP,
      };
    },
    deleteLiveInput: async (id: string) => {
      h.state.deletedInputs.push(id);
    },
    playbackUrlsFromWhip: (whipUrl: string | null | undefined) => {
      if (!whipUrl || !/\/webRTC\/publish\/?$/.test(whipUrl)) return { whep_url: null, hls_url: null };
      const base = whipUrl.replace(/\/webRTC\/publish\/?$/, "");
      return { whep_url: `${base}/webRTC/play`, hls_url: `${base}/manifest/video.m3u8` };
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
      // The stale sweep: status = 'live' AND started_at < cutoff.
      // (PgDialect serializes the timestamp param to an ISO string.)
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

import router, { __resetViewerTracker, touchViewer, countViewers, toStreamDto } from "../live-streams";

const realFetch = globalThis.fetch;
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
  s.configured = true;
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
  s.deletedInputs = [];
  s.createdInputs = [];
  __resetViewerTracker();
});

async function call(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

async function goLive(title = "Friday Night Live") {
  return call("POST", "/live-streams", { title });
}

describe("POST /api/live-streams (create)", () => {
  it("answers an honest 503 STREAM_NOT_CONFIGURED before the provider is enabled", async () => {
    h.state.configured = false;
    const { status, json } = await goLive();
    expect(status).toBe(503);
    expect(json.code).toBe("STREAM_NOT_CONFIGURED");
    expect(h.state.createdInputs).toHaveLength(0);
    expect(h.state.streams.size).toBe(0);
  });

  it("requires a creator profile (the stream lives on it)", async () => {
    h.state.profiles = [];
    const { status, json } = await goLive();
    expect(status).toBe(400);
    expect(json.code).toBe("NO_PROFILE");
    expect(h.state.createdInputs).toHaveLength(0);
  });

  it("rejects an empty title", async () => {
    const { status } = await call("POST", "/live-streams", { title: "   " });
    expect(status).toBe(400);
  });

  it("creates the provider input + session and returns the owner DTO with the WHIP url", async () => {
    const { status, json } = await goLive();
    expect(status).toBe(201);
    expect(h.state.createdInputs).toEqual(["Friday Night Live"]);
    const dto = json.stream;
    expect(dto.status).toBe("live");
    expect(dto.title).toBe("Friday Night Live");
    expect(dto.whip_url).toBe(WHIP);
    expect(dto.playback).toEqual({ whep_url: WHEP, hls_url: HLS });
    expect(dto.creator).toEqual({
      id: PROFILE_ID,
      slug: PROFILE_SLUG,
      display_name: "Live Creator",
      avatar_url: "https://example.com/avatar.png",
    });
    const row = [...h.state.streams.values()][0]!;
    expect(row["provider_input_id"]).toBe("cf-input-1");
    expect(row["profile_id"]).toBe(PROFILE_ID);
    expect(row["user_id"]).toBe(AUTH_USER);
  });

  it("stores the site destination by default (multistream model — v1 is site only)", async () => {
    const { status, json } = await goLive();
    expect(status).toBe(201);
    const siteOnly = [{ platform: "site", label: "Your profile", status: "active" }];
    expect(json.stream.destinations).toEqual(siteOnly);
    const row = [...h.state.streams.values()][0]!;
    expect(row["destinations"]).toEqual(siteOnly);
  });

  it("normalizes requested destinations: site first + active, others pending — never faked live", async () => {
    const { status, json } = await call("POST", "/live-streams", {
      title: "Multi",
      destinations: [
        { platform: "youtube", label: "YouTube", status: "active" },
        { platform: "twitch", label: "Twitch" },
        { platform: "site", label: "Your profile", status: "active" },
        { platform: "youtube", label: "Duplicate entry" },
        { platform: "tiktok", label: "TikTok", status: "off" },
      ],
    });
    expect(status).toBe(201);
    expect(json.stream.destinations).toEqual([
      { platform: "site", label: "Your profile", status: "active" },
      { platform: "youtube", label: "YouTube", status: "pending" },
      { platform: "twitch", label: "Twitch", status: "pending" },
      { platform: "tiktok", label: "TikTok", status: "off" },
    ]);
  });

  it("409s with the existing stream when the creator is already live", async () => {
    const first = await goLive();
    expect(first.status).toBe(201);
    const { status, json } = await goLive("Second Stream");
    expect(status).toBe(409);
    expect(json.code).toBe("ALREADY_LIVE");
    expect(json.stream.id).toBe(first.json.stream.id);
    // No second provider input was created for the rejected attempt.
    expect(h.state.createdInputs).toEqual(["Friday Night Live"]);
  });
});

describe("POST /api/live-streams/:id/end", () => {
  it("ends the stream, deletes the provider input, and is idempotent", async () => {
    const { json: created } = await goLive();
    const id = created.stream.id;
    const first = await call("POST", `/live-streams/${id}/end`);
    expect(first.status).toBe(200);
    expect(first.json.stream.status).toBe("ended");
    expect(first.json.stream.ended_at).toBeTruthy();
    expect(first.json.stream.playback).toBeNull();
    expect(h.state.deletedInputs).toEqual(["cf-input-1"]);

    const second = await call("POST", `/live-streams/${id}/end`);
    expect(second.status).toBe(200);
    expect(second.json.stream.status).toBe("ended");
    // No second provider delete for an already-ended stream.
    expect(h.state.deletedInputs).toEqual(["cf-input-1"]);
  });

  it("404s an unknown stream and 403s someone else's", async () => {
    const missing = await call("POST", "/live-streams/nope/end");
    expect(missing.status).toBe(404);

    const { json: created } = await goLive();
    const row = h.state.streams.get(created.stream.id)!;
    row["user_id"] = OTHER_USER;
    const forbidden = await call("POST", `/live-streams/${created.stream.id}/end`);
    expect(forbidden.status).toBe(403);
    expect(h.state.streams.get(created.stream.id)!["status"]).toBe("live");
  });
});

describe("public watch reads", () => {
  it("GET /live lists live streams with creator + playback and NEVER the whip url", async () => {
    await goLive();
    const { status, json } = await call("GET", "/live-streams/live");
    expect(status).toBe(200);
    expect(json.streams).toHaveLength(1);
    const dto = json.streams[0];
    expect(dto.title).toBe("Friday Night Live");
    expect(dto.creator.slug).toBe(PROFILE_SLUG);
    expect(dto.playback).toEqual({ whep_url: WHEP, hls_url: HLS });
    expect("whip_url" in dto).toBe(false);
  });

  it("GET /:id serves the watch DTO without the whip url; unknown ids 404", async () => {
    const { json: created } = await goLive();
    const { status, json } = await call("GET", `/live-streams/${created.stream.id}`);
    expect(status).toBe(200);
    expect(json.stream.status).toBe("live");
    expect("whip_url" in json.stream).toBe(false);

    const missing = await call("GET", "/live-streams/does-not-exist");
    expect(missing.status).toBe(404);
  });

  it("GET /profile/:slug reports the live stream, then null after it ends", async () => {
    const before = await call("GET", `/live-streams/profile/${PROFILE_SLUG}`);
    expect(before.json.stream).toBeNull();

    const { json: created } = await goLive();
    const during = await call("GET", `/live-streams/profile/${PROFILE_SLUG}`);
    expect(during.json.stream?.id).toBe(created.stream.id);

    await call("POST", `/live-streams/${created.stream.id}/end`);
    const after = await call("GET", `/live-streams/profile/${PROFILE_SLUG}`);
    expect(after.json.stream).toBeNull();

    const unknown = await call("GET", "/live-streams/profile/no-such-creator");
    expect(unknown.json.stream).toBeNull();
  });

  it("the stale sweep ends zombie streams (started > 12h ago) in the live list", async () => {
    const { json: created } = await goLive();
    const row = h.state.streams.get(created.stream.id)!;
    row["started_at"] = new Date(Date.now() - 13 * 60 * 60 * 1000);
    const { json } = await call("GET", "/live-streams/live");
    expect(json.streams).toHaveLength(0);
    expect(h.state.streams.get(created.stream.id)!["status"]).toBe("ended");
  });
});

describe("viewer heartbeats", () => {
  it("counts distinct sessions, merges into reads, and 410s after the end", async () => {
    const { json: created } = await goLive();
    const id = created.stream.id;

    const one = await call("POST", `/live-streams/${id}/heartbeat`, { session_id: "viewer-session-1" });
    expect(one.json.viewer_count).toBe(1);
    const two = await call("POST", `/live-streams/${id}/heartbeat`, { session_id: "viewer-session-2" });
    expect(two.json.viewer_count).toBe(2);
    // Same session re-heartbeating doesn't double-count.
    const again = await call("POST", `/live-streams/${id}/heartbeat`, { session_id: "viewer-session-1" });
    expect(again.json.viewer_count).toBe(2);
    // The peak persisted onto the row.
    expect(h.state.streams.get(id)!["peak_viewers"]).toBe(2);

    const watch = await call("GET", `/live-streams/${id}`);
    expect(watch.json.stream.viewer_count).toBe(2);

    await call("POST", `/live-streams/${id}/end`);
    const late = await call("POST", `/live-streams/${id}/heartbeat`, { session_id: "viewer-session-3" });
    expect(late.status).toBe(410);
    expect(late.json.code).toBe("STREAM_ENDED");
  });

  it("rejects a malformed session id and unknown streams", async () => {
    const { json: created } = await goLive();
    const bad = await call("POST", `/live-streams/${created.stream.id}/heartbeat`, { session_id: "x" });
    expect(bad.status).toBe(400);
    const missing = await call("POST", "/live-streams/nope/heartbeat", { session_id: "viewer-session-1" });
    expect(missing.status).toBe(404);
  });
});

describe("viewer tracker (unit)", () => {
  it("expires sessions past the TTL instead of counting ghosts", () => {
    const t0 = 1_000_000;
    touchViewer("s1", "a", t0);
    touchViewer("s1", "b", t0 + 10_000);
    expect(countViewers("s1", t0 + 20_000)).toBe(2);
    // 46s after "a" last beat (TTL 45s) but only 36s after "b".
    expect(countViewers("s1", t0 + 46_000)).toBe(1);
    expect(countViewers("never-seen", t0)).toBe(0);
  });
});

describe("POST /api/live-streams/:id/vod", () => {
  it("registers the recording: a generated_clips row + vod fields on the stream", async () => {
    const { json: created } = await goLive();
    const id = created.stream.id;
    await call("POST", `/live-streams/${id}/end`);
    const vodUrl = `https://pub.example.com/${AUTH_USER}/live/${id}.webm`;
    const { status, json } = await call("POST", `/live-streams/${id}/vod`, { vod_url: vodUrl });
    expect(status).toBe(200);
    expect(json.stream.vod_url).toBe(vodUrl);
    expect(json.clip_id).toBeTruthy();
    expect(h.state.clips).toHaveLength(1);
    expect(h.state.clips[0]).toMatchObject({
      user_id: AUTH_USER,
      title: "Friday Night Live",
      video_url: vodUrl,
      status: "completed",
    });
    const row = h.state.streams.get(id)!;
    expect(row["vod_url"]).toBe(vodUrl);
    expect(row["vod_clip_id"]).toBe(json.clip_id);

    // Re-registering is a no-op (no duplicate clip).
    const again = await call("POST", `/live-streams/${id}/vod`, { vod_url: vodUrl });
    expect(again.status).toBe(200);
    expect(h.state.clips).toHaveLength(1);
  });

  it("refuses a recording url outside the owner's own upload prefix", async () => {
    const { json: created } = await goLive();
    const foreign = `https://pub.example.com/${OTHER_USER}/live/x.webm`;
    const { status } = await call("POST", `/live-streams/${created.stream.id}/vod`, { vod_url: foreign });
    expect(status).toBe(400);
    expect(h.state.clips).toHaveLength(0);
  });

  it("403s a non-owner and 404s an unknown stream", async () => {
    const { json: created } = await goLive();
    const row = h.state.streams.get(created.stream.id)!;
    row["user_id"] = OTHER_USER;
    const vodUrl = `https://pub.example.com/${AUTH_USER}/live/x.webm`;
    const forbidden = await call("POST", `/live-streams/${created.stream.id}/vod`, { vod_url: vodUrl });
    expect(forbidden.status).toBe(403);
    const missing = await call("POST", "/live-streams/nope/vod", { vod_url: vodUrl });
    expect(missing.status).toBe(404);
  });
});

describe("GET /api/live-streams/status", () => {
  it("reports the configured flag and the caller's live stream (owner DTO)", async () => {
    const idle = await call("GET", "/live-streams/status");
    expect(idle.json).toEqual({ configured: true, live_stream: null });

    const { json: created } = await goLive();
    const live = await call("GET", "/live-streams/status");
    expect(live.json.live_stream.id).toBe(created.stream.id);
    expect(live.json.live_stream.whip_url).toBe(WHIP);

    h.state.configured = false;
    const off = await call("GET", "/live-streams/status");
    expect(off.json.configured).toBe(false);
  });
});

describe("toStreamDto (unit)", () => {
  it("never carries the whip url and drops playback once ended", () => {
    const row: any = {
      id: "s1",
      title: "T",
      status: "ended",
      started_at: new Date(),
      ended_at: new Date(),
      viewer_count: 0,
      peak_viewers: 9,
      vod_url: "https://pub.example.com/v.webm",
      whip_url: WHIP,
    };
    const dto = toStreamDto(row, null);
    expect("whip_url" in dto).toBe(false);
    expect(dto.playback).toBeNull();
    expect(dto.peak_viewers).toBe(9);
    expect(dto.vod_url).toBe("https://pub.example.com/v.webm");
  });
});
