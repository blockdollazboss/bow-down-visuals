/**
 * Linkage Fix 3 — a release announces itself.
 *
 * Before the fix, POST /distribution/releases/:id/submit touched only
 * distribution_releases: no profile presence, no follower
 * notification — while POST /notify's release fan-out existed for
 * exactly this and had zero callers.
 *
 * This test mounts the REAL distribution router, the REAL discovery
 * router (the /notify endpoint, now delegating to lib/notify-fanout),
 * and the REAL creator-platform router (the Fix 1 public-profile
 * path) over one hybrid fake db — builder chains for the
 * creator-platform router (the house fake-db style), SQL-text
 * dispatch for the raw-SQL surfaces (distribution, the fan-out, the
 * announcement) — and proves the whole chain in one flow:
 *
 *   submit a release built on a library song (Fix 2's attach-by-id)
 *   → each follower is notified exactly once, the creator never is
 *   → the release is a published track on the public profile,
 *     readable through the real GET /creator-profiles/:slug
 *   → re-submit 409s and announces nothing twice.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const OWNER = "11111111-1111-4111-8111-111111111111";
const FAN_ONE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FAN_TWO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const NO_PROFILE_USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const SONG_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const RELEASE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const ORPHAN_RELEASE_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const SONG_URL = "https://cdn.example.com/audio-stems/owner/golden-hour.mp3";

const h = vi.hoisted(() => ({
  state: {
    userId: "",
    userCredits: 0,
    charges: [] as Array<{ userId: string; cost: number }>,
    /* creator_profiles in drizzle (camelCase) row shape */
    profilesBySlug: new Map<string, Record<string, unknown>>(),
    /* profile_tracks / profile_videos in drizzle row shape */
    tracks: [] as Array<Record<string, unknown>>,
    videos: [] as Array<Record<string, unknown>>,
    /* raw-SQL surfaces in snake_case row shape */
    releases: new Map<string, Record<string, unknown>>(),
    follows: [] as Array<{ follower_user_id: string; profile_id: string }>,
    notifications: [] as Array<Record<string, unknown>>,
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.state.userId;
    req.userCredits = h.state.userCredits;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const {
    creatorProfilesTable,
    profileTracksTable,
    profileVideosTable,
    referralCodesTable,
    notificationsTable,
  } = actual;

  /* ── builder chains (creator-platform + the notify insert) ── */
  const publishedTracks = (profileId: unknown) =>
    state.tracks
      .filter((t) => t["profileId"] === profileId && t["isPublished"] === true)
      .sort((a, b) => Number(b["playCount"]) - Number(a["playCount"]));
  const publishedVideos = (profileId: unknown) =>
    state.videos
      .filter((v) => v["profileId"] === profileId && v["isPublished"] === true)
      .sort((a, b) => Number(b["viewCount"]) - Number(a["viewCount"]));

  function rowsFor(table: unknown, fields: unknown, cond: unknown): unknown[] {
    const params = cond !== undefined ? render(cond).params : [];
    if (table === referralCodesTable) return [];
    if (table === creatorProfilesTable) {
      const key = String(params[0] ?? "");
      const bySlug = state.profilesBySlug.get(key);
      if (bySlug) return [bySlug];
      const byId = [...state.profilesBySlug.values()].find((p) => p["id"] === key);
      return byId ? [byId] : [];
    }
    if (fields && typeof fields === "object") {
      const keys = Object.keys(fields as Record<string, unknown>);
      if (keys.includes("trackCount")) return [{ trackCount: publishedTracks(params[0]).length }];
      if (keys.includes("videoCount")) return [{ videoCount: publishedVideos(params[0]).length }];
      if (keys.includes("playlistCount")) return [{ playlistCount: 0 }];
    }
    if (table === profileTracksTable) return publishedTracks(params[0]);
    if (table === profileVideosTable) return publishedVideos(params[0]);
    return [];
  }

  /* ── raw-SQL dispatch (distribution, fan-out, announcement) ── */
  function executeDispatch(text: string, params: unknown[]): { rows: unknown[] } {
    const profiles = [...state.profilesBySlug.values()];

    if (/UPDATE distribution_releases/i.test(text)) {
      const release = state.releases.get(String(params[4]));
      if (!release) return { rows: [] };
      release["status"] = "packaged";
      release["credits_charged"] = params[0];
      release["aggregator"] = params[1];
      release["aggregator_release_id"] = params[2];
      release["platform_statuses"] = JSON.parse(String(params[3]));
      return { rows: [release] };
    }
    if (/FROM distribution_releases/i.test(text)) {
      const release = state.releases.get(String(params[0]));
      return { rows: release && release["user_id"] === params[1] ? [release] : [] };
    }
    if (/FROM creator_profiles/i.test(text)) {
      if (/WHERE id =/i.test(text)) {
        /* fan-out ownership: (profileId, ownerUserId) */
        const p = profiles.find((x) => x["id"] === params[0] && x["userId"] === params[1]);
        return { rows: p ? [{ id: p["id"] }] : [] };
      }
      /* announcement resolution: by owner user id */
      const p = profiles.find((x) => x["userId"] === params[0]);
      return { rows: p ? [{ id: p["id"], slug: p["slug"] }] : [] };
    }
    if (/FROM profile_tracks/i.test(text)) {
      const found = state.tracks.find(
        (t) => t["profileId"] === params[0] && t["audioUrl"] === params[1],
      );
      return { rows: found ? [{ id: found["id"] }] : [] };
    }
    if (/INSERT INTO profile_tracks/i.test(text)) {
      const row: Record<string, unknown> = {
        id: randomUUID(),
        profileId: params[0],
        title: params[1],
        audioUrl: params[2],
        artworkUrl: params[3],
        genre: params[4],
        tags: [],
        isrc: params[5],
        durationSec: 0,
        downloadPriceCents: 0,
        pwywEnabled: false,
        pwywMinCents: 0,
        playCount: 0,
        likeCount: 0,
        repostCount: 0,
        commentCount: 0,
        isPublished: true,
        createdAt: new Date(),
      };
      state.tracks.push(row);
      return { rows: [{ id: row["id"] }] };
    }
    if (/UPDATE profile_tracks/i.test(text)) {
      const row = state.tracks.find((t) => t["id"] === params[4]);
      if (row) {
        row["title"] = params[0];
        row["artworkUrl"] = params[1];
        row["genre"] = params[2];
        row["isrc"] = params[3];
        row["isPublished"] = true;
      }
      return { rows: [] };
    }
    if (/FROM follows/i.test(text)) {
      return {
        rows: state.follows
          .filter((f) => f.profile_id === params[0])
          .map((f) => ({ uid: f.follower_user_id })),
      };
    }
    if (/INSERT INTO notifications/i.test(text)) {
      /* Recipient ids ride the SQL text as unnest(ARRAY['…'::uuid,…]);
         kind/title/body/link are the bound params, in that order. */
      const ids = [...text.matchAll(/'([0-9a-f-]{36})'::uuid/gi)].map((m) => m[1]);
      for (const uid of ids) {
        state.notifications.push({
          user_id: uid,
          kind: params[0],
          title: params[1],
          body: params[2],
          link: params[3],
        });
      }
      return { rows: [] };
    }
    /* resolvePaidPlan's profiles probe + anything unmodeled: empty. */
    return { rows: [] };
  }

  const fakeDb: any = {
    select: (fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          const rows = () => rowsFor(table, fields, cond);
          return {
            limit: async (n: number) => rows().slice(0, n),
            orderBy: (..._args: unknown[]) => ({
              limit: async (n: number) => rows().slice(0, n),
              then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
            }),
            then: (res: any, rej: any) => Promise.resolve(rows()).then(res, rej),
          };
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: (obj: Record<string, unknown>) => {
        if (table === notificationsTable) {
          state.notifications.push({
            user_id: obj["userId"],
            kind: obj["kind"],
            title: obj["title"],
            body: obj["body"],
            link: obj["link"],
          });
          return Promise.resolve([]);
        }
        throw new Error("unexpected insert table in fake db");
      },
    }),
    execute: async (cond: unknown) => {
      const { sql: text, params } = render(cond);
      return executeDispatch(text, params);
    },
  };

  return { ...actual, db: fakeDb };
});

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async (userId: string, cost: number) => {
    h.state.charges.push({ userId, cost });
    return 100_000 - cost;
  }),
  refundCredits: vi.fn(async () => {}),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "gpt-test",
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => {
          throw new Error("AI is not exercised by these tests");
        },
      },
    },
  }),
}));

vi.mock("../referrals", () => ({
  getRecruiterBadgeForUser: async () => null,
}));

vi.mock("../generate/milestones", () => ({
  computeAchievements: () => [],
}));

vi.mock("../../lib/email", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    sendEmail: async () => undefined,
    isEmailConfigured: () => false,
  };
});

vi.mock("../../lib/mirrorMedia", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    mirrorExternalMediaUrl: async (v: unknown) => v,
    mirrorProjectScenes: async (v: unknown) => v,
    isExternalHttpUrl: (v: unknown) =>
      typeof v === "string" && /^https?:\/\//i.test(v),
    isPermanentMediaValue: (v: unknown) =>
      typeof v === "string" &&
      (v.startsWith("r2://") || v.startsWith("supabase://")),
  };
});

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

/* Storage refresh simulator (the distribution.test.ts contract). */
function signedFor(ref: string): string {
  return `https://signed.example.com/${ref.replace(/^(r2|supabase):\/\//, "")}?sig=test`;
}
async function deepRefresh(v: unknown): Promise<unknown> {
  if (typeof v === "string") {
    return v.startsWith("r2://") || v.startsWith("supabase://") ? signedFor(v) : v;
  }
  if (Array.isArray(v)) return Promise.all(v.map((x) => deepRefresh(x)));
  if (v !== null && typeof v === "object" && !(v instanceof Date)) {
    const proto = Object.getPrototypeOf(v);
    if (proto === Object.prototype || proto === null) {
      const entries = await Promise.all(
        Object.entries(v as Record<string, unknown>).map(
          async ([k, val]) => [k, await deepRefresh(val)] as const,
        ),
      );
      return Object.fromEntries(entries);
    }
  }
  return v;
}

vi.mock("../../lib/objectStorage", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    refreshSupabaseStorageUrl: async (v: unknown) =>
      typeof v === "string" && (v.startsWith("r2://") || v.startsWith("supabase://"))
        ? signedFor(v)
        : v,
    refreshSupabaseStorageUrlsDeep: async (v: unknown) => deepRefresh(v),
  };
});

import distributionRouter from "../generate/distribution";
import discoveryRouter from "../discovery";
import creatorPlatformRouter from "../creator-platform";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, warn: () => {}, info: () => {} };
    next();
  });
  app.use("/api", distributionRouter);
  app.use("/api", discoveryRouter);
  app.use("/api", creatorPlatformRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function futureDate(daysOut: number): string {
  return new Date(Date.now() + daysOut * 86_400_000).toISOString().slice(0, 10);
}

function profileRow(): Record<string, unknown> {
  return {
    id: PROFILE_ID,
    userId: OWNER,
    slug: "queen-bee",
    displayName: "Queen Bee",
    vertical: "music",
    streamSchedule: null,
    mediaKit: null,
    bio: "",
    avatarUrl: null,
    bannerUrl: null,
    themeId: "royal-gold",
    themeConfig: {},
    sections: [],
    layoutBlocks: [],
    pinnedKind: null,
    pinnedItemId: null,
    collectionVisibility: "public",
    featuredMedia: null,
    socialLinks: {},
    topCreators: [],
    tipJarEnabled: true,
    aiDesign: null,
    isPublic: true,
    isVerified: false,
    isOfficial: false,
    followerCount: 3,
    totalPlays: 0,
    stripeConnectAccountId: null,
    stripeConnectOnboarded: false,
    stripeConnectChargesEnabled: false,
    stripeConnectPayoutsEnabled: false,
    createdAt: new Date("2026-10-01T00:00:00.000Z"),
    updatedAt: new Date("2026-10-01T00:00:00.000Z"),
  };
}

function releaseRow(id: string, userId: string): Record<string, unknown> {
  return {
    id,
    user_id: userId,
    title: "Golden Hour",
    artist_name: "Queen Bee",
    release_date: futureDate(30),
    platforms: ["spotify"],
    audio_url: SONG_URL,
    artwork_url: "https://cdn.example.com/art/golden-hour.jpg",
    metadata: null,
    strategy: null,
    status: "draft",
    credits_charged: 0,
    created_at: "2026-10-10T00:00:00.000Z",
    updated_at: "2026-10-10T00:00:00.000Z",
    release_type: "single",
    isrc: "USABC2412345",
    genre: "Soul",
    explicit: false,
    explicit_declared: true,
    upc: null,
    upc_kind: "internal",
    label: null,
    label_imprint: null,
    copyright_line: null,
    copyright_c_line: null,
    copyright_p_line: null,
    subgenre: null,
    original_release_date: null,
    preorder_date: null,
    territories_mode: "worldwide",
    territories: [],
    /* The release is attached to the Fix 2 library song by id —
       creation verified the songs row and pre-filled audio from it. */
    song_id: SONG_ID,
    tracks: [{ title: "Golden Hour", isrc: "USABC2412345" }],
    aggregator: "none",
    aggregator_release_id: null,
    platform_statuses: [],
    presave_slug: null,
    split_share_slug: null,
  };
}

beforeEach(() => {
  h.state.userId = OWNER;
  h.state.userCredits = 100_000;
  h.state.charges = [];
  h.state.profilesBySlug = new Map([["queen-bee", profileRow()]]);
  h.state.tracks = [];
  h.state.videos = [];
  h.state.releases = new Map([
    [RELEASE_ID, releaseRow(RELEASE_ID, OWNER)],
    [ORPHAN_RELEASE_ID, releaseRow(ORPHAN_RELEASE_ID, NO_PROFILE_USER)],
  ]);
  /* Two real followers + the owner following their own profile (the
     fan-out must exclude the creator even when a self-follow exists). */
  h.state.follows = [
    { follower_user_id: FAN_ONE, profile_id: PROFILE_ID },
    { follower_user_id: FAN_TWO, profile_id: PROFILE_ID },
    { follower_user_id: OWNER, profile_id: PROFILE_ID },
  ];
  h.state.notifications = [];
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("POST /distribution/releases/:id/submit — the release announces itself", () => {
  it("notifies every follower exactly once and puts the release on the public profile", async () => {
    const { status, json } = await req("POST", `/distribution/releases/${RELEASE_ID}/submit`);
    expect(status).toBe(200);
    expect(json.release.status).toBe("packaged");
    expect(json.release.songId).toBe(SONG_ID);

    /* Followers: exactly one release notification each; the creator
       (a follower of their own profile) is never notified. */
    const releaseNotes = h.state.notifications.filter((n) => n["kind"] === "release");
    expect(releaseNotes).toHaveLength(2);
    expect(releaseNotes.map((n) => n["user_id"]).sort()).toEqual([FAN_ONE, FAN_TWO].sort());
    for (const note of releaseNotes) {
      expect(String(note["title"])).toContain("Golden Hour");
      expect(String(note["body"])).toContain("Golden Hour");
    }

    /* Profile presence: exactly one published profile track carrying
       the release's audio — and the notification link points at the
       track's own page. */
    expect(h.state.tracks).toHaveLength(1);
    const track = h.state.tracks[0]!;
    expect(track["profileId"]).toBe(PROFILE_ID);
    expect(track["title"]).toBe("Golden Hour");
    expect(track["audioUrl"]).toBe(SONG_URL);
    expect(track["isPublished"]).toBe(true);
    for (const note of releaseNotes) {
      expect(note["link"]).toBe(`/track/${String(track["id"])}`);
    }

    /* And it is visible through the REAL public-profile path (Fix 1):
       GET /creator-profiles/:slug serves it in top_tracks. */
    const page = await req("GET", "/creator-profiles/queen-bee");
    expect(page.status).toBe(200);
    expect(page.json.top_tracks).toHaveLength(1);
    expect(page.json.top_tracks[0].title).toBe("Golden Hour");
    expect(page.json.top_tracks[0].audio_url).toBe(SONG_URL);
    expect(page.json.counts.tracks).toBe(1);
  });

  it("a re-submit 409s and announces nothing twice", async () => {
    const first = await req("POST", `/distribution/releases/${RELEASE_ID}/submit`);
    expect(first.status).toBe(200);
    expect(h.state.notifications).toHaveLength(2);
    expect(h.state.tracks).toHaveLength(1);

    const second = await req("POST", `/distribution/releases/${RELEASE_ID}/submit`);
    expect(second.status).toBe(409);
    expect(h.state.notifications).toHaveLength(2);
    expect(h.state.tracks).toHaveLength(1);
  });

  it("a creator with no profile still packages cleanly — the announcement skips, never fails the submit", async () => {
    h.state.userId = NO_PROFILE_USER;
    const { status, json } = await req("POST", `/distribution/releases/${ORPHAN_RELEASE_ID}/submit`);
    expect(status).toBe(200);
    expect(json.release.status).toBe("packaged");
    expect(h.state.notifications).toHaveLength(0);
    expect(h.state.tracks).toHaveLength(0);
  });
});

describe("POST /notify — the endpoint contract survives its extraction to lib/notify-fanout", () => {
  it("fans out to the profile's followers for the owner, 403 for anyone else", async () => {
    const okRes = await req("POST", "/notify", {
      kind: "announcement",
      title: "Studio session tonight",
      body: "Pull up.",
      link: "/artist/queen-bee",
      profileId: PROFILE_ID,
    });
    expect(okRes.status).toBe(200);
    expect(okRes.json).toEqual({ ok: true, notified: 2 });
    const notes = h.state.notifications.filter((n) => n["kind"] === "announcement");
    expect(notes.map((n) => n["user_id"]).sort()).toEqual([FAN_ONE, FAN_TWO].sort());

    h.state.userId = FAN_ONE;
    const forbidden = await req("POST", "/notify", {
      kind: "announcement",
      title: "Not my profile",
      profileId: PROFILE_ID,
    });
    expect(forbidden.status).toBe(403);
    expect(h.state.notifications.filter((n) => n["kind"] === "announcement")).toHaveLength(2);
  });

  it("the single-user branch still delivers exactly one notification", async () => {
    const res = await req("POST", "/notify", {
      kind: "follow",
      title: "Someone followed you",
      userId: FAN_ONE,
    });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ ok: true, notified: 1 });
    expect(h.state.notifications).toHaveLength(1);
    expect(h.state.notifications[0]!["user_id"]).toBe(FAN_ONE);
  });
});
