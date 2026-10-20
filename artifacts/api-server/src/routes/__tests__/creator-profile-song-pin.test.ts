/**
 * Route tests for the profile-song pin's catalog treatment
 * (Stack-4 wave-2 #10) — routes/creator-platform.ts reading the SAME
 * pin the Stack-3 #5 spotlight writes (routes/profile-website.ts):
 *   PUT /api/creator-profiles/me/spotlight        (owner, the editor)
 *   GET /api/creator-profiles/:slug               (guest DTO: top_tracks / top_videos)
 *   GET /api/creator-profiles/:slug/media         (guest listing)
 *   GET /api/media/track/:id                      (guest detail)
 *
 * Contract pinned here:
 * - One pin only: the columns pinned_kind / pinned_item_id the
 *   spotlight already owns. No pin → both lists in natural order,
 *   is_pinned false everywhere (the profile is unchanged).
 * - Pinned → that item LEADS its Music / Videos list with
 *   is_pinned: true, even when its play/view counts would never have
 *   made the list, and it appears exactly once. The other kind's
 *   list is untouched.
 * - The pin can only ever be the owner's own published work:
 *   foreign → 400 PIN_NOT_YOURS, unpublished → 400 PIN_NOT_PUBLIC,
 *   and a refused write leaves no pin behind.
 * - Unpublishing the pinned work hides the lead (the guest DTO
 *   carries no pin) while the stored pin survives — re-publishing
 *   restores the lead, exactly the spotlight's rule.
 * - Clearing the pin (kind: null) restores natural order everywhere.
 *
 * Both real routers mount over ONE fake db (royal-court /
 * profile-website.test.ts style: real table objects via
 * importOriginal, WHERE params read back through PgDialect). The fake
 * honors ORDER BY by rendering the desc()/asc() column, so the two
 * different natural orders (plays for the profile payload, newest
 * for the media listing) are both exercised for real.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const OWNER_USER = "00000000-0000-4000-8000-0000000000aa";
const OTHER_USER = "00000000-0000-4000-8000-0000000000dd";

const OWNER_PROFILE = "11111111-1111-4111-8111-111111111111";
const OTHER_PROFILE = "22222222-2222-4222-8222-222222222222";

/* Six published tracks whose play order and recency order DIFFER, and
   whose pinned candidate is last in both — only the pin can lead it. */
const T_A = "33333333-3333-4333-8333-0000000000a1"; // plays 500, created Jan 2
const T_B = "33333333-3333-4333-8333-0000000000a2"; // plays 400, created Jan 6
const T_C = "33333333-3333-4333-8333-0000000000a3"; // plays 300, created Jan 5
const T_D = "33333333-3333-4333-8333-0000000000a4"; // plays 200, created Jan 4
const T_E = "33333333-3333-4333-8333-0000000000a5"; // plays 100, created Jan 3
const T_PIN = "33333333-3333-4333-8333-0000000000a6"; // plays 5, created Jan 1
const T_DRAFT = "33333333-3333-4333-8333-0000000000a7"; // owner's, unpublished
const T_FOREIGN = "33333333-3333-4333-8333-0000000000a8"; // other creator's

const V_TOP = "55555555-5555-4555-8555-0000000000b1"; // views 900, created Jan 3
const V_MID = "55555555-5555-4555-8555-0000000000b2"; // views 800, created Jan 2
const V_PIN = "55555555-5555-4555-8555-0000000000b3"; // views 10, created Jan 1

const h = vi.hoisted(() => ({
  state: {
    profilesById: new Map<string, Record<string, unknown>>(),
    tracks: [] as Array<Record<string, unknown>>,
    videos: [] as Array<Record<string, unknown>>,
  },
}));

const dialect = new PgDialect();
function render(cond: unknown): { sql: string; params: unknown[] } {
  const q = dialect.sqlToQuery(cond as never);
  return { sql: q.sql, params: q.params as unknown[] };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = String(user);
    next();
  },
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
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
    creatorProfilesTable, profileTracksTable, profileVideosTable,
  } = actual;

  const SNAKE_TO_CAMEL: Record<string, string> = {
    play_count: "playCount",
    view_count: "viewCount",
    created_at: "createdAt",
  };

  function rowsFor(table: unknown, fields: unknown, cond: unknown): Array<Record<string, unknown>> {
    const { sql, params } = render(cond);
    if (table === creatorProfilesTable) {
      const all = [...state.profilesById.values()];
      if (sql.includes(" in (")) {
        const ids = new Set(params.map(String));
        return all.filter((p) => ids.has(String(p["id"])));
      }
      if (sql.includes('"user_id"')) return all.filter((p) => String(p["userId"]) === String(params[0]));
      if (sql.includes('"slug"')) return all.filter((p) => String(p["slug"]) === String(params[0]));
      if (sql.includes('"id"')) return all.filter((p) => String(p["id"]) === String(params[0]));
      return [];
    }
    if (table === profileTracksTable || table === profileVideosTable) {
      const rows = table === profileTracksTable ? state.tracks : state.videos;
      /* Count selects (the profile payload's counts block). */
      if (fields && typeof fields === "object") {
        const keys = Object.keys(fields as Record<string, unknown>);
        if (keys.includes("trackCount")) {
          return [{ trackCount: state.tracks.filter((t) => String(t["profileId"]) === String(params[0]) && t["isPublished"] === true).length }];
        }
        if (keys.includes("videoCount")) {
          return [{ videoCount: state.videos.filter((v) => String(v["profileId"]) === String(params[0]) && v["isPublished"] === true).length }];
        }
        if (keys.includes("playlistCount")) return [{ playlistCount: 0 }];
        if (keys.length === 1 && keys[0] === "price") {
          /* profileExtras: published rows with the price alias filled. */
          return rows
            .filter((r) => String(r["profileId"]) === String(params[0]) && r["isPublished"] === true)
            .map((r) => ({ ...r, price: r["downloadPriceCents"] }));
        }
      }
      if (sql.includes(" in (")) {
        const ids = new Set(params.map(String));
        return rows.filter((r) => ids.has(String(r["id"])));
      }
      if (sql.includes('"is_published"')) {
        if (params.length >= 3) {
          /* (id, profileId, isPublished) — the pinned-row fetch. */
          return rows.filter(
            (r) => String(r["id"]) === String(params[0]) && String(r["profileId"]) === String(params[1]) && r["isPublished"] === params[2],
          );
        }
        /* (profileId, isPublished) — the published catalog lists. */
        return rows.filter((r) => String(r["profileId"]) === String(params[0]) && r["isPublished"] === params[1]);
      }
      if (sql.includes('"profile_id"')) {
        /* (id, profileId) — ownership checks / the spotlight resolve. */
        return rows.filter((r) => String(r["id"]) === String(params[0]) && String(r["profileId"]) === String(params[1]));
      }
      if (sql.includes('"id"')) {
        return rows.filter((r) => String(r["id"]) === String(params[0]));
      }
      return [];
    }
    /* playlists, shops, subscriptions, hosting, referral codes,
       storefront tables: nothing seeded on these paths. */
    return [];
  }

  function orderColumn(arg: unknown): { key: string; dir: 1 | -1 } | null {
    try {
      const { sql } = render(arg);
      const m = sql.match(/"([a-z_]+)"\s+(desc|asc)/i);
      if (!m) return null;
      const key = SNAKE_TO_CAMEL[m[1]!] ?? m[1]!;
      return { key, dir: m[2]!.toLowerCase() === "desc" ? -1 : 1 };
    } catch {
      return null;
    }
  }

  function chain(table: unknown, fields: unknown, cond: unknown): any {
    let limitN: number | null = null;
    let order: Array<{ key: string; dir: 1 | -1 }> = [];
    const compute = () => {
      let rows = rowsFor(table, fields, cond);
      for (const o of order) {
        rows = [...rows].sort((a, b) => {
          const av = a[o.key] as never;
          const bv = b[o.key] as never;
          const an = av instanceof Date ? av.getTime() : (typeof av === "number" ? av : 0);
          const bn = bv instanceof Date ? bv.getTime() : (typeof bv === "number" ? bv : 0);
          return o.dir === -1 ? bn - an : an - bn;
        });
      }
      return limitN === null ? rows : rows.slice(0, limitN);
    };
    const self: any = {
      limit: (n: number) => {
        limitN = n;
        return self;
      },
      offset: (_n: number) => self,
      orderBy: (...args: unknown[]) => {
        order = args.map(orderColumn).filter((x): x is { key: string; dir: 1 | -1 } => x !== null);
        return self;
      },
      then: (res: any, rej: any) => Promise.resolve(compute()).then(res, rej),
    };
    return self;
  }

  function thenable(extra: Record<string, unknown> = {}): any {
    return { ...extra, then: (res: any, rej: any) => Promise.resolve([]).then(res, rej) };
  }

  const fakeDb: any = {
    select: (fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => chain(table, fields, cond),
      }),
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          if (table === creatorProfilesTable) {
            const id = String(render(cond).params[0] ?? "");
            const row = state.profilesById.get(id);
            if (row) Object.assign(row, patch);
          }
          return thenable({ returning: async () => [] });
        },
      }),
    }),
    insert: () => ({ values: () => thenable({ returning: async () => [] }) }),
    delete: () => ({ where: () => thenable() }),
    execute: async () => ({ rows: [] }),
  };

  return { ...actual, db: fakeDb };
});

import creatorPlatformRouter from "../creator-platform";
import profileWebsiteRouter from "../profile-website";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => undefined, info: () => undefined, warn: () => undefined };
    next();
  });
  app.use("/api", creatorPlatformRouter);
  app.use("/api", profileWebsiteRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function profileRow(id: string, userId: string, slug: string): Record<string, unknown> {
  return {
    id, userId, slug,
    displayName: slug,
    bio: "",
    avatarUrl: null,
    bannerUrl: null,
    themeId: "royal-gold",
    vertical: "music",
    streamSchedule: null,
    mediaKit: null,
    themeConfig: {},
    sections: [],
    layoutBlocks: [],
    pinnedKind: null,
    pinnedItemId: null,
    collectionVisibility: "public",
    featuredMedia: null,
    merchItems: [],
    profileEvents: [],
    series: [],
    socialPosts: [],
    socialLinks: {},
    topCreators: [],
    tipJarEnabled: false,
    isPublic: true,
    isOfficial: false,
    followerCount: 0,
    totalPlays: 0,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function trackRow(id: string, profileId: string, plays: number, createdDay: number, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, profileId,
    title: `Track ${id.slice(-2)}`,
    audioUrl: `https://cdn.example.com/${id}.mp3`,
    artworkUrl: null,
    genre: "Soul",
    tags: [],
    durationSec: 180,
    downloadPriceCents: 0,
    pwywEnabled: false,
    pwywMinCents: 0,
    playCount: plays,
    likeCount: 0,
    repostCount: 0,
    commentCount: 0,
    isPublished: true,
    createdAt: new Date(`2026-01-${String(createdDay).padStart(2, "0")}T00:00:00.000Z`),
    ...extra,
  };
}

function videoRow(id: string, profileId: string, views: number, createdDay: number): Record<string, unknown> {
  return {
    id, profileId,
    title: `Video ${id.slice(-2)}`,
    videoUrl: `https://cdn.example.com/${id}.mp4`,
    thumbnailUrl: null,
    description: "",
    genre: null,
    tags: [],
    durationSec: 240,
    downloadPriceCents: 0,
    pwywEnabled: false,
    pwywMinCents: 0,
    viewCount: views,
    likeCount: 0,
    repostCount: 0,
    commentCount: 0,
    isPublished: true,
    isShort: false,
    season: null,
    episode: null,
    soundTrackId: null,
    createdAt: new Date(`2026-01-${String(createdDay).padStart(2, "0")}T00:00:00.000Z`),
  };
}

beforeEach(() => {
  h.state.profilesById = new Map([
    [OWNER_PROFILE, profileRow(OWNER_PROFILE, OWNER_USER, "pin-owner")],
    [OTHER_PROFILE, profileRow(OTHER_PROFILE, OTHER_USER, "other-creator")],
  ]);
  h.state.tracks = [
    trackRow(T_A, OWNER_PROFILE, 500, 2),
    trackRow(T_B, OWNER_PROFILE, 400, 6),
    trackRow(T_C, OWNER_PROFILE, 300, 5),
    trackRow(T_D, OWNER_PROFILE, 200, 4),
    trackRow(T_E, OWNER_PROFILE, 100, 3),
    trackRow(T_PIN, OWNER_PROFILE, 5, 1),
    trackRow(T_DRAFT, OWNER_PROFILE, 0, 7, { isPublished: false }),
    trackRow(T_FOREIGN, OTHER_PROFILE, 999, 6),
  ];
  h.state.videos = [
    videoRow(V_TOP, OWNER_PROFILE, 900, 3),
    videoRow(V_MID, OWNER_PROFILE, 800, 2),
    videoRow(V_PIN, OWNER_PROFILE, 10, 1),
  ];
});

async function call(method: string, path: string, opts: { user?: string; body?: unknown } = {}) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.user ? { "x-test-user": opts.user } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = (await r.json().catch(() => ({}))) as any;
  return { status: r.status, json };
}

const pinTrack = (itemId: string, user: string = OWNER_USER) =>
  call("PUT", "/creator-profiles/me/spotlight", { user, body: { kind: "track", itemId } });
const pinVideo = (itemId: string, user: string = OWNER_USER) =>
  call("PUT", "/creator-profiles/me/spotlight", { user, body: { kind: "video", itemId } });
const clearPin = () =>
  call("PUT", "/creator-profiles/me/spotlight", { user: OWNER_USER, body: { kind: null } });
const guestProfile = () => call("GET", "/creator-profiles/pin-owner");
const guestMedia = (kind: string) => call("GET", `/creator-profiles/pin-owner/media?kind=${kind}&limit=50`);

describe("profile-song pin — catalog treatment", () => {
  it("no pin: natural order on every surface, is_pinned false everywhere", async () => {
    const prof = await guestProfile();
    expect(prof.status).toBe(200);
    expect(prof.json.top_tracks.map((t: any) => t.id)).toEqual([T_A, T_B, T_C, T_D, T_E]);
    expect(prof.json.top_tracks.every((t: any) => t.is_pinned === false)).toBe(true);
    expect(prof.json.top_videos.map((v: any) => v.id)).toEqual([V_TOP, V_MID, V_PIN]);
    expect(prof.json.top_videos.every((v: any) => v.is_pinned === false)).toBe(true);

    const media = await guestMedia("track");
    expect(media.json.items.map((t: any) => t.id)).toEqual([T_B, T_C, T_D, T_E, T_A, T_PIN]);
    expect(media.json.items.every((t: any) => t.is_pinned === false)).toBe(true);
  });

  it("round-trip: pinning a low-play track leads Music on the guest DTO + listing, exactly once", async () => {
    const put = await pinTrack(T_PIN);
    expect(put.status).toBe(200);
    expect(put.json.pin?.itemId).toBe(T_PIN);

    const prof = await guestProfile();
    expect(prof.json.top_tracks.map((t: any) => t.id)).toEqual([T_PIN, T_A, T_B, T_C, T_D]);
    expect(prof.json.top_tracks[0].is_pinned).toBe(true);
    expect(prof.json.top_tracks.slice(1).every((t: any) => t.is_pinned === false)).toBe(true);
    /* The video area is untouched by a track pin. */
    expect(prof.json.top_videos.every((v: any) => v.is_pinned === false)).toBe(true);

    const media = await guestMedia("track");
    expect(media.json.items.map((t: any) => t.id)).toEqual([T_PIN, T_B, T_C, T_D, T_E, T_A]);
    expect(media.json.items.filter((t: any) => t.id === T_PIN)).toHaveLength(1);
    expect(media.json.items[0].is_pinned).toBe(true);

    const detail = await call("GET", `/media/track/${T_PIN}`);
    expect(detail.json.track.is_pinned).toBe(true);
    const otherDetail = await call("GET", `/media/track/${T_A}`);
    expect(otherDetail.json.track.is_pinned).toBe(false);

    /* The Stage (spotlight read) agrees — one pin, every surface. */
    const stage = await call("GET", "/creator-profiles/pin-owner/spotlight");
    expect(stage.json.pin?.itemId).toBe(T_PIN);
  });

  it("clearing the pin restores natural order everywhere", async () => {
    await pinTrack(T_PIN);
    const cleared = await clearPin();
    expect(cleared.status).toBe(200);
    expect(cleared.json.pin).toBeNull();

    const prof = await guestProfile();
    expect(prof.json.top_tracks.map((t: any) => t.id)).toEqual([T_A, T_B, T_C, T_D, T_E]);
    expect(prof.json.top_tracks.every((t: any) => t.is_pinned === false)).toBe(true);
    const media = await guestMedia("track");
    expect(media.json.items[0].id).toBe(T_B);
    expect(media.json.items.every((t: any) => t.is_pinned === false)).toBe(true);
  });

  it("a video pin leads Videos only — Music is untouched", async () => {
    const put = await pinVideo(V_PIN);
    expect(put.status).toBe(200);

    const prof = await guestProfile();
    expect(prof.json.top_videos.map((v: any) => v.id)).toEqual([V_PIN, V_TOP, V_MID]);
    expect(prof.json.top_videos[0].is_pinned).toBe(true);
    expect(prof.json.top_tracks.every((t: any) => t.is_pinned === false)).toBe(true);

    const media = await guestMedia("video");
    expect(media.json.items.map((v: any) => v.id)).toEqual([V_PIN, V_TOP, V_MID]);
    expect(media.json.items[0].is_pinned).toBe(true);
    const trackMedia = await guestMedia("track");
    expect(trackMedia.json.items.every((t: any) => t.is_pinned === false)).toBe(true);
  });

  it("foreign work is refused and leaves no pin behind", async () => {
    const put = await pinTrack(T_FOREIGN);
    expect(put.status).toBe(400);
    expect(put.json.error).toBe("PIN_NOT_YOURS");
    expect(h.state.profilesById.get(OWNER_PROFILE)?.["pinnedItemId"]).toBeNull();

    const prof = await guestProfile();
    expect(prof.json.top_tracks.every((t: any) => t.is_pinned === false)).toBe(true);
    /* The foreign track never enters the owner's catalog either. */
    expect(prof.json.top_tracks.map((t: any) => t.id)).not.toContain(T_FOREIGN);
  });

  it("unpublished work is refused at pin time", async () => {
    const put = await pinTrack(T_DRAFT);
    expect(put.status).toBe(400);
    expect(put.json.error).toBe("PIN_NOT_PUBLIC");
    expect(h.state.profilesById.get(OWNER_PROFILE)?.["pinnedItemId"]).toBeNull();
  });

  it("unpublishing the pinned work hides the lead; re-publishing restores it (pin survives)", async () => {
    await pinTrack(T_PIN);
    const row = h.state.tracks.find((t) => t["id"] === T_PIN)!;
    row["isPublished"] = false;

    const hidden = await guestProfile();
    expect(hidden.json.top_tracks.map((t: any) => t.id)).not.toContain(T_PIN);
    expect(hidden.json.top_tracks.every((t: any) => t.is_pinned === false)).toBe(true);
    const stage = await call("GET", "/creator-profiles/pin-owner/spotlight");
    expect(stage.json.pin).toBeNull();
    /* …but the stored pin itself was never cleared. */
    expect(h.state.profilesById.get(OWNER_PROFILE)?.["pinnedItemId"]).toBe(T_PIN);

    row["isPublished"] = true;
    const restored = await guestProfile();
    expect(restored.json.top_tracks[0].id).toBe(T_PIN);
    expect(restored.json.top_tracks[0].is_pinned).toBe(true);
  });
});
