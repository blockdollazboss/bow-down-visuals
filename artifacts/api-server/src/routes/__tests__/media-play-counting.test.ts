/**
 * Route tests for POST /api/media/:kind/:id/play (routes/creator-platform)
 * — the charts' input integrity at the media door (stack1100 X3).
 *
 * THE DISEASE: this door's only pacing was a per-IP 1/minute/media
 * gap limiter — no daily bound, so one address could still mint
 * 1,440 counted plays a day; the gap was keyed by IP alone, so every
 * signed-in listener behind one address shared a single slot; the
 * owner's plays of their own upload counted toward their own chart
 * position; and unpublished uploads accrued play_count here (no
 * is_published check anywhere on the path) to debut pre-inflated.
 * (The twin door, POST /discovery/play, was worse: it counted every
 * post — 7,200 plays an hour per address. lib/play-counting now
 * paces both doors identically.)
 *
 * THE PINS: a burst from one source counts ONCE (lib/play-counting's
 * gap); distinct signed-in listeners each count; the owner's
 * self-play never counts; unpublished media never counts; a counted
 * play moves all three chart inputs together (counter bump +
 * play_events row + profile total_plays) and an uncounted play moves
 * none — the windowed and all-time charts can never disagree.
 *
 * Harness mirrors creator-follow-unfollow.test.ts: the real router
 * over a fake db whose effects (counter bumps via db.execute,
 * play_events inserts, profile updates) are recorded for assertion.
 * Caller identity rides an x-test-user header stamped by a pre-router
 * middleware — the same stamp the door's optionalAuth leaves when a
 * real session rides along (it never gates; guests stay guests).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const OWNER = "00000000-0000-4000-8000-0000000000aa";
const FAN_A = "00000000-0000-4000-8000-0000000000bb";
const FAN_B = "00000000-0000-4000-8000-0000000000cc";
const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const TRACK_ID = "22222222-2222-4222-8222-222222222222";
const DRAFT_TRACK_ID = "23232323-2323-4232-8232-232323232323";
const VIDEO_ID = "33333333-3333-4333-8333-333333333333";
const MISSING_ID = "44444444-4444-4444-8444-444444444444";

const h = vi.hoisted(() => ({
  state: {
    profilesById: new Map<string, Record<string, unknown>>(),
    mediaById: new Map<string, Record<string, unknown>>(),
    playEvents: [] as Array<Record<string, unknown>>,
    counterBumps: [] as string[],
    profileUpdates: [] as Array<Record<string, unknown>>,
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = req.headers["x-test-user"] ?? OWNER;
    next();
  },
}));

vi.mock("../referrals", () => ({
  getRecruiterBadgeForUser: async () => null,
}));

vi.mock("../generate/milestones", () => ({
  computeAchievements: () => [],
}));

vi.mock("../../lib/email", () => ({
  sendEmail: async () => undefined,
  emailShell: (x: string) => x,
  emailButton: (href: string, label: string) => `<a href="${href}">${label}</a>`,
  emailDetailBox: (html: string) => html,
  escapeHtml: (s: string) => s,
  isEmailConfigured: () => false,
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: unknown) => v,
  isExternalHttpUrl: (v: unknown) =>
    typeof v === "string" && /^https?:\/\//i.test(v),
  isPermanentMediaValue: (v: unknown) =>
    typeof v === "string" &&
    (v.startsWith("r2://") || v.startsWith("supabase://")),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const {
    creatorProfilesTable,
    profileTracksTable,
    profileVideosTable,
    playEventsTable,
  } = actual;

  function rowsFor(table: unknown, cond: unknown): unknown[] {
    if (table === profileTracksTable || table === profileVideosTable) {
      const { params } = render(cond);
      const row = state.mediaById.get(String(params[0] ?? ""));
      return row ? [row] : [];
    }
    if (table === creatorProfilesTable) {
      const { params } = render(cond);
      const row = state.profilesById.get(String(params[0] ?? ""));
      return row ? [row] : [];
    }
    return [];
  }

  function chain(table: unknown, cond: unknown): any {
    const self: any = {
      limit: (_n: number) => self,
      offset: (_n: number) => self,
      orderBy: (..._args: unknown[]) => self,
      then: (res: any, rej: any) =>
        Promise.resolve(rowsFor(table, cond)).then(res, rej),
    };
    return self;
  }

  function thenable(extra: Record<string, unknown> = {}): any {
    return {
      ...extra,
      then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
    };
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => chain(table, cond),
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        if (table === playEventsTable) state.playEvents.push(v);
        return thenable({
          onConflictDoNothing: (_cfg: unknown) => thenable({ returning: async () => [{ ...v }] }),
          returning: async () => [{ ...v }],
        });
      },
    }),
    update: (table: unknown) => ({
      set: (patch: unknown) => {
        if (table === creatorProfilesTable) {
          state.profileUpdates.push(patch as Record<string, unknown>);
        }
        return { where: (_cond: unknown) => thenable() };
      },
    }),
    delete: (_table: unknown) => ({
      where: (_cond: unknown) => ({ returning: async () => [] }),
    }),
    execute: async (q: unknown) => {
      try {
        const text = dialect.sqlToQuery(q as never).sql;
        if (text.includes("play_count") || text.includes("view_count")) {
          state.counterBumps.push(text);
        }
      } catch {
        /* non-query execute — nothing to record */
      }
      return { rows: [], rowCount: 0 };
    },
  };

  return { ...actual, db: fakeDb };
});

import router from "../creator-platform";
import { __resetPlayCounterForTests } from "../../lib/play-counting";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => undefined, info: () => undefined, warn: () => undefined };
    if (req.headers["x-test-user"]) req.userId = String(req.headers["x-test-user"]);
    next();
  });
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
  s.profilesById = new Map();
  s.mediaById = new Map();
  s.playEvents = [];
  s.counterBumps = [];
  s.profileUpdates = [];
  __resetPlayCounterForTests();

  s.profilesById.set(PROFILE_ID, { id: PROFILE_ID, userId: OWNER, slug: "owner", displayName: "Owner" });
  s.mediaById.set(TRACK_ID, {
    id: TRACK_ID, profileId: PROFILE_ID, title: "Chart Hopeful",
    isPublished: true, playCount: 40, likeCount: 0, repostCount: 0,
  });
  s.mediaById.set(DRAFT_TRACK_ID, {
    id: DRAFT_TRACK_ID, profileId: PROFILE_ID, title: "Secret Draft",
    isPublished: false, playCount: 0, likeCount: 0, repostCount: 0,
  });
  s.mediaById.set(VIDEO_ID, {
    id: VIDEO_ID, profileId: PROFILE_ID, title: "Chart Hopeful (Video)",
    isPublished: true, viewCount: 7, likeCount: 0,
  });
});

async function postPlay(path: string, user?: string) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: user ? { "x-test-user": user } : {},
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("POST /media/:kind/:id/play — one source cannot mint a chart", () => {
  it("a guest burst of 15 counts once: one bump, one event row, one total_plays step", async () => {
    const answers: any[] = [];
    for (let i = 0; i < 15; i++) {
      const { status, json } = await postPlay(`/media/track/${TRACK_ID}/play`);
      expect(status).toBe(200);
      answers.push(json);
    }
    expect(answers[0].counted).toBe(true);
    expect(answers.slice(1).every((a) => a.counted === false)).toBe(true);
    expect(answers.every((a) => a.ok === true)).toBe(true);
    expect(h.state.counterBumps).toHaveLength(1);
    expect(h.state.playEvents).toHaveLength(1);
    expect(h.state.profileUpdates).toHaveLength(1);
  });

  it("distinct signed-in listeners each count — the budget is per source", async () => {
    const a = await postPlay(`/media/track/${TRACK_ID}/play`, FAN_A);
    const b = await postPlay(`/media/track/${TRACK_ID}/play`, FAN_B);
    expect(a.json.counted).toBe(true);
    expect(b.json.counted).toBe(true);
    expect(h.state.counterBumps).toHaveLength(2);
    expect(h.state.playEvents.map((e) => e["userId"])).toEqual([FAN_A, FAN_B]);
  });

  it("the same listener's immediate replay does not count twice", async () => {
    const first = await postPlay(`/media/track/${TRACK_ID}/play`, FAN_A);
    const replay = await postPlay(`/media/track/${TRACK_ID}/play`, FAN_A);
    expect(first.json.counted).toBe(true);
    expect(replay.json.counted).toBe(false);
    expect(h.state.counterBumps).toHaveLength(1);
  });

  it("the owner's play of their own upload never counts (self-follow's play twin)", async () => {
    const { status, json } = await postPlay(`/media/track/${TRACK_ID}/play`, OWNER);
    expect(status).toBe(200);
    expect(json.counted).toBe(false);
    expect(h.state.counterBumps).toHaveLength(0);
    expect(h.state.playEvents).toHaveLength(0);
    expect(h.state.profileUpdates).toHaveLength(0);
  });

  it("unpublished media never counts — no debuting with a pre-inflated counter", async () => {
    const { status, json } = await postPlay(`/media/track/${DRAFT_TRACK_ID}/play`, FAN_A);
    expect(status).toBe(200);
    expect(json.counted).toBe(false);
    expect(h.state.counterBumps).toHaveLength(0);
    expect(h.state.playEvents).toHaveLength(0);
  });

  it("videos count through view_count, same pacing", async () => {
    const first = await postPlay(`/media/video/${VIDEO_ID}/play`, FAN_A);
    const burst = await postPlay(`/media/video/${VIDEO_ID}/play`, FAN_A);
    expect(first.json.counted).toBe(true);
    expect(burst.json.counted).toBe(false);
    expect(h.state.counterBumps).toHaveLength(1);
    expect(h.state.counterBumps[0]).toContain("view_count");
  });

  it("missing media still 404s — the honest door answer is unchanged", async () => {
    const { status } = await postPlay(`/media/track/${MISSING_ID}/play`, FAN_A);
    expect(status).toBe(404);
    expect(h.state.playEvents).toHaveLength(0);
  });
});
