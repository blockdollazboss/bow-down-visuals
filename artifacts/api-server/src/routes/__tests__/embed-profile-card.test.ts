/**
 * Route + page tests for the profile embed card fill (routes/embed.ts).
 *
 * THE DEFECT (owner screenshot, Nov 4 2026): the profile embed was a
 * top-loaded header (avatar, name, follower count, one-line bio,
 * Follow door, one optional featured block) inside a tall fixed
 * frame — for a creator with no featured drop and an empty bio the
 * card was four small elements over a giant empty black void, and at
 * 320px the brand bar wrapped "Bow Down / Visuals" mid-name.
 *
 * THE FIX pinned here:
 * - getEmbedProfile carries REAL published-content counts
 *   (track_count / video_count, the same fail-soft aggregate pattern
 *   as follower_count), a two-line bio, and top_tracks — up to 3
 *   published tracks after the featured one, play-count order, with
 *   play counts and artwork. No invented content: an empty creator
 *   gets zeros, an empty list and featured: null.
 * - PROFILE_JS fills the frame: stats row, Featured drop, Top
 *   tracks mini-list, and the Follow door pinned to the bottom via
 *   margin-top:auto (.pf-follow); a content-less creator gets the
 *   honest "New creator" empty state with the larger avatar.
 * - The brand bar's name never wraps mid-name (.brandtxt / .brandbar
 *   b nowrap rules in the shared shell CSS).
 *
 * Fake db follows the embed-widgets house pattern (chainable builder,
 * QueryResult-shaped execute()); aggregate selects (a `value` field)
 * are answered in kind per table from state. Where-clauses are
 * ignored by the fake, so fixtures keep published rows ahead of the
 * unpublished one in play-count order, mirroring what the SQL
 * (isPublished + ORDER BY play_count DESC + LIMIT 4) returns.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "44444444-4444-4444-8444-444444444444";
const PROFILE_SLUG = "some-creator";

const h = vi.hoisted(() => ({
  state: {
    profiles: [] as Array<Record<string, unknown>>,
    tracks: [] as Array<Record<string, unknown>>,
    videos: [] as Array<Record<string, unknown>>,
    followCount: 0,
    referralRows: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  isStorageRef: (v: unknown) =>
    typeof v === "string" && (v.startsWith("r2://") || v.startsWith("supabase://")),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.userId = undefined;
    next();
  },
}));

vi.mock("../generate/tip-jar", () => ({
  getPublicTipPageByHandleOrSlug: async () => null,
  getPublicTipPageByUserId: () => null,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const {
    creatorProfilesTable,
    profileTracksTable,
    profileVideosTable,
    playlistsTable,
    liveStreamsTable,
    followsTable,
    shopsTable,
    shopProductsTable,
  } = actual;

  function isAggregate(fields?: unknown): boolean {
    return !!fields && typeof fields === "object" && "value" in (fields as object);
  }

  function publishedCount(rows: Array<Record<string, unknown>>): number {
    return rows.filter((r) => r.isPublished === true && r.profileId === PROFILE_ID).length;
  }

  function rowsFor(table: unknown, fields?: unknown): unknown[] {
    if (table === creatorProfilesTable) return state.profiles;
    if (table === profileTracksTable) {
      return isAggregate(fields) ? [{ value: publishedCount(state.tracks) }] : state.tracks;
    }
    if (table === profileVideosTable) {
      return isAggregate(fields) ? [{ value: publishedCount(state.videos) }] : state.videos;
    }
    if (table === followsTable) {
      return isAggregate(fields) ? [{ value: state.followCount }] : [];
    }
    if (
      table === playlistsTable ||
      table === liveStreamsTable ||
      table === shopsTable ||
      table === shopProductsTable
    ) {
      return [];
    }
    return [];
  }

  function chain(table: unknown, fields?: unknown): any {
    const c: any = {
      where: (_cond: unknown) => c,
      orderBy: (..._args: unknown[]) => c,
      limit: async (n: number) => rowsFor(table, fields).slice(0, n),
      then: (res: any, rej: any) => Promise.resolve(rowsFor(table, fields)).then(res, rej),
    };
    return c;
  }

  const fakeDb: any = {
    select: (fields?: unknown) => ({
      from: (table: unknown) => chain(table, fields),
    }),
    execute: async (_query: unknown) => ({
      command: "SELECT",
      rowCount: state.referralRows.length,
      oid: 0,
      fields: [],
      rows: state.referralRows,
    }),
  };

  return { ...actual, db: fakeDb };
});

import { embedApiRouter, embedPageRouter } from "../embed";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(embedPageRouter);
  app.use("/api", embedApiRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function track(id: string, title: string, playCount: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    profileId: PROFILE_ID,
    title,
    isPublished: true,
    artworkUrl: `https://cdn.example.com/${id}.jpg`,
    audioUrl: `https://cdn.example.com/${id}.mp3`,
    playCount,
    ...extra,
  };
}

beforeEach(() => {
  const s = h.state;
  s.profiles = [
    {
      id: PROFILE_ID,
      userId: OWNER_ID,
      slug: PROFILE_SLUG,
      displayName: "Some Creator",
      isPublic: true,
      avatarUrl: "https://cdn.example.com/avatar.png",
      bio: "Line one\nLine two\nLine three",
    },
  ];
  /* Play-count order, published first; the unpublished row sits last
     with the fewest plays, exactly where the real SQL leaves it out
     of the LIMIT 4 window. */
  s.tracks = [
    track("t1", "Biggest Song", 5000),
    track("t2", "Second Song", 900),
    track("t3", "Third Song", 120),
    track("t4", "Fourth Song", 40),
    track("t5", "Fifth Song", 3),
    track("t6", "Secret Draft", 2, { isPublished: false }),
  ];
  s.videos = [
    {
      id: "v1",
      profileId: PROFILE_ID,
      title: "First Video",
      isPublished: true,
      thumbnailUrl: "https://cdn.example.com/v1.jpg",
      videoUrl: "https://cdn.example.com/v1.mp4",
      viewCount: 77,
    },
    {
      id: "v2",
      profileId: PROFILE_ID,
      title: "Second Video",
      isPublished: true,
      thumbnailUrl: null,
      videoUrl: "https://cdn.example.com/v2.mp4",
      viewCount: 9,
    },
  ];
  s.followCount = 1234;
  s.referralRows = [{ code: "ABC" }];
});

async function getJson(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

async function getPage(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const text = await r.text();
  return { status: r.status, text };
}

describe("profile embed payload — counts, top tracks, two-line bio", () => {
  it("carries real published counts (unpublished rows never counted)", async () => {
    const { status, json } = await getJson(`/api/embed/profile/${PROFILE_SLUG}`);
    expect(status).toBe(200);
    expect(json.track_count).toBe(5);
    expect(json.video_count).toBe(2);
    expect(json.follower_count).toBe(1234);
  });

  it("featured is the #1 track; top_tracks are the next 3 in play order with counts + artwork", async () => {
    const { json } = await getJson(`/api/embed/profile/${PROFILE_SLUG}`);
    expect(json.featured.kind).toBe("track");
    expect(json.featured.id).toBe("t1");
    expect(json.top_tracks).toEqual([
      { id: "t2", title: "Second Song", play_count: 900, artwork_url: "https://cdn.example.com/t2.jpg" },
      { id: "t3", title: "Third Song", play_count: 120, artwork_url: "https://cdn.example.com/t3.jpg" },
      { id: "t4", title: "Fourth Song", play_count: 40, artwork_url: "https://cdn.example.com/t4.jpg" },
    ]);
    /* The featured track never repeats inside the list. */
    expect(json.top_tracks.map((t: any) => t.id)).not.toContain("t1");
    expect(json.top_tracks.map((t: any) => t.id)).not.toContain("t6");
  });

  it("bio now carries two of the creator's lines (was: first line only)", async () => {
    const { json } = await getJson(`/api/embed/profile/${PROFILE_SLUG}`);
    expect(json.bio).toBe("Line one\nLine two");
  });

  it("existing fields are untouched (shape is additive only)", async () => {
    const { json } = await getJson(`/api/embed/profile/${PROFILE_SLUG}`);
    expect(json.kind).toBe("profile");
    expect(json.slug).toBe(PROFILE_SLUG);
    expect(json.display_name).toBe("Some Creator");
    expect(json.avatar_url).toBe("https://cdn.example.com/avatar.png");
    expect(json.ref_code).toBe("ABC");
    expect(json.featured.media_url).toBe("https://cdn.example.com/t1.mp3");
    expect(json.featured.thumb).toBe("https://cdn.example.com/t1.jpg");
  });

  it("a single-track creator gets the featured drop and an empty list — no padding invented", async () => {
    h.state.tracks = [track("only", "Only Song", 12)];
    const { json } = await getJson(`/api/embed/profile/${PROFILE_SLUG}`);
    expect(json.featured.id).toBe("only");
    expect(json.top_tracks).toEqual([]);
    expect(json.track_count).toBe(1);
  });

  it("video-only creator: featured falls back to the top video, counts stay truthful", async () => {
    h.state.tracks = [];
    const { json } = await getJson(`/api/embed/profile/${PROFILE_SLUG}`);
    expect(json.featured.kind).toBe("video");
    expect(json.featured.id).toBe("v1");
    expect(json.top_tracks).toEqual([]);
    expect(json.track_count).toBe(0);
    expect(json.video_count).toBe(2);
  });

  it("brand-new creator: zeros, null featured, empty list — the honest empty payload", async () => {
    h.state.tracks = [];
    h.state.videos = [];
    h.state.followCount = 0;
    const { status, json } = await getJson(`/api/embed/profile/${PROFILE_SLUG}`);
    expect(status).toBe(200);
    expect(json.featured).toBeNull();
    expect(json.top_tracks).toEqual([]);
    expect(json.track_count).toBe(0);
    expect(json.video_count).toBe(0);
    expect(json.follower_count).toBe(0);
  });
});

describe("profile embed page — the frame-filling layout", () => {
  it("renders stats, Top tracks and the bottom-pinned Follow door from the payload", async () => {
    const { status, text } = await getPage(`/embed/profile/${PROFILE_SLUG}`);
    expect(status).toBe(200);
    expect(text).toContain('KIND="profile"');
    /* The layout classes + the pin that kills the void. */
    expect(text).toContain(".pf-follow{margin-top:auto}");
    expect(text).toContain("pf-stats");
    expect(text).toContain("Top tracks");
    expect(text).toContain("pf-row-plays");
    /* The renderer reads the new payload fields. */
    expect(text).toContain("d.track_count");
    expect(text).toContain("d.video_count");
    expect(text).toContain("d.top_tracks");
    /* The door copy + destination are unchanged. */
    expect(text).toContain("Follow on Bow Down Visuals");
    expect(text).toContain("/artist/");
  });

  it("a content-less creator gets the honest empty state + larger avatar treatment", async () => {
    const { text } = await getPage(`/embed/profile/${PROFILE_SLUG}`);
    expect(text).toContain("New creator on Bow Down Visuals");
    expect(text).toContain("Follow to catch their first drop");
    expect(text).toContain("pf-avatar-lg");
    expect(text).toContain("pf-empty");
  });

  it("the profile layout rides the theme variables (light palette designs it too)", async () => {
    const { text } = await getPage(`/embed/profile/${PROFILE_SLUG}?theme=light`);
    expect(text).toContain(":root.light");
    expect(text).toMatch(/\.pf-row\{[^}]*background:var\(--chip\)/);
    expect(text).toMatch(/\.pf-box\{[^}]*border:1px solid var\(--line\)/);
    expect(text).toMatch(/\.pf-bio\{[^}]*color:var\(--dim\)/);
  });

  it("the brand bar can no longer wrap the name mid-name", async () => {
    const { text } = await getPage(`/embed/profile/${PROFILE_SLUG}`);
    expect(text).toContain('class="brandtxt"');
    expect(text).toMatch(/\.brandbar \.brandtxt\{[^}]*white-space:nowrap/);
    expect(text).toMatch(/\.brandbar b\{white-space:nowrap\}/);
    /* CTA keeps its ≥44px touch height. */
    expect(text).toMatch(/\.cta\{[^}]*min-height:44px/);
  });
});
