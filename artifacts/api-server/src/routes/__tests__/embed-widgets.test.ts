/**
 * Route + page tests for the Stack900 C1 creator embed widgets
 * (routes/embed.ts): latest video, live badge, tip jar, storefront
 * item, the /api/embed/mine desk inventory, theming and responsive
 * guarantees, and the framing carve-out's exact scope.
 *
 * The fake db follows the embed-refcode.test.ts house pattern
 * (chainable builder, QueryResult-shaped execute()). Where-clauses are
 * ignored by the fake, so the getters' in-code flag checks
 * (isPublic / isPublished / status) are what these tests pin — the
 * same defense the production queries get from SQL.
 *
 * The tip-jar module is stubbed at its exported read helpers: the
 * embed reads tip truth through them, and the helpers' own behavior
 * (handle/slug resolution over the store of record) belongs to the
 * tip jar's suites. requireAuth is stubbed to inject a user id.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "44444444-4444-4444-8444-444444444444";
const VIDEO_ID = "22222222-2222-4222-8222-222222222222";
const STREAM_ID = "33333333-3333-4333-8333-333333333333";
const SHOP_ID = "55555555-5555-4555-8555-555555555555";
const PRODUCT_ID = "66666666-6666-4666-8666-666666666666";
const TRACK_ID = "77777777-7777-4777-8777-777777777777";
const PLAYLIST_ID = "88888888-8888-4888-8888-888888888888";
const PROFILE_SLUG = "some-creator";

const h = vi.hoisted(() => ({
  state: {
    profiles: [] as Array<Record<string, unknown>>,
    videos: [] as Array<Record<string, unknown>>,
    tracks: [] as Array<Record<string, unknown>>,
    playlists: [] as Array<Record<string, unknown>>,
    streams: [] as Array<Record<string, unknown>>,
    shops: [] as Array<Record<string, unknown>>,
    products: [] as Array<Record<string, unknown>>,
    followCount: 0,
    referralRows: [] as Array<Record<string, unknown>>,
    tipByHandleOrSlug: {} as Record<string, unknown>,
    tipByUser: {} as Record<string, unknown>,
    authUserId: undefined as string | undefined,
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
    req.userId = h.state.authUserId;
    next();
  },
}));

vi.mock("../generate/tip-jar", () => ({
  getPublicTipPageByHandleOrSlug: async (v: string) =>
    h.state.tipByHandleOrSlug[v.toLowerCase()] ?? null,
  getPublicTipPageByUserId: (uid: string) => h.state.tipByUser[uid] ?? null,
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

  function rowsFor(table: unknown, fields?: unknown): unknown[] {
    if (table === creatorProfilesTable) return state.profiles;
    if (table === profileTracksTable) return state.tracks;
    if (table === profileVideosTable) return state.videos;
    if (table === playlistsTable) return state.playlists;
    if (table === liveStreamsTable) return state.streams;
    if (table === shopsTable) return state.shops;
    if (table === shopProductsTable) return state.products;
    if (table === followsTable) {
      // The follower-count query selects an aggregate — answer in kind.
      if (fields && typeof fields === "object" && "value" in (fields as object)) {
        return [{ value: state.followCount }];
      }
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
import { securityHeaders } from "../../lib/security-headers";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  /* Mirror app.ts: security headers first, embed pages on the root
     (before any SPA fallback), the API under /api. */
  app.use(securityHeaders);
  app.use(embedPageRouter);
  app.use("/api", embedApiRouter);
  app.get("/promote", (_req, res) => res.send("spa"));
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  const s = h.state;
  s.profiles = [
    {
      id: PROFILE_ID,
      userId: OWNER_ID,
      slug: PROFILE_SLUG,
      displayName: "Some Creator",
      isPublic: true,
      avatarUrl: null,
      bio: "First line\nSecond line",
    },
  ];
  s.videos = [
    {
      id: VIDEO_ID,
      profileId: PROFILE_ID,
      title: "New Drop",
      isPublished: true,
      isShort: true,
      thumbnailUrl: "https://cdn.example.com/thumb.jpg",
      videoUrl: "https://cdn.example.com/drop.mp4",
      viewCount: 10,
      createdAt: new Date("2026-10-29T12:00:00Z"),
    },
    {
      id: "99999999-9999-4999-8999-999999999999",
      profileId: PROFILE_ID,
      title: "Unreleased Cut",
      isPublished: false,
      isShort: false,
      thumbnailUrl: null,
      videoUrl: "https://cdn.example.com/cut.mp4",
      viewCount: 0,
      createdAt: new Date("2026-10-30T12:00:00Z"),
    },
  ];
  s.tracks = [
    {
      id: TRACK_ID,
      profileId: PROFILE_ID,
      title: "Gold Standard",
      isPublished: true,
      artworkUrl: "https://cdn.example.com/art.jpg",
      audioUrl: "https://cdn.example.com/gold.mp3",
      playCount: 5,
      createdAt: new Date("2026-10-28T12:00:00Z"),
    },
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      profileId: PROFILE_ID,
      title: "Draft Tune",
      isPublished: false,
      artworkUrl: null,
      audioUrl: "https://cdn.example.com/draft.mp3",
      playCount: 0,
      createdAt: new Date("2026-10-29T12:00:00Z"),
    },
  ];
  s.playlists = [
    {
      id: PLAYLIST_ID,
      ownerProfileId: PROFILE_ID,
      title: "Evening Mix",
      isPublic: true,
      coverUrl: null,
      items: [
        { kind: "track", id: TRACK_ID },
        { kind: "video", id: VIDEO_ID },
      ],
      createdAt: new Date("2026-10-27T12:00:00Z"),
    },
    {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      ownerProfileId: PROFILE_ID,
      title: "Private Stash",
      isPublic: false,
      coverUrl: null,
      items: [{ kind: "track", id: TRACK_ID }],
      createdAt: new Date("2026-10-26T12:00:00Z"),
    },
  ];
  s.streams = [
    {
      id: STREAM_ID,
      profile_id: PROFILE_ID,
      user_id: OWNER_ID,
      title: "Friday Show",
      status: "live",
      viewer_count: 42,
      started_at: new Date("2026-10-29T23:00:00Z"),
    },
  ];
  s.shops = [{ id: SHOP_ID, user_id: OWNER_ID, name: "Creator Shop", handle: "creator-shop" }];
  s.products = [
    {
      id: PRODUCT_ID,
      shop_id: SHOP_ID,
      user_id: OWNER_ID,
      name: "Gold Hoodie",
      price_cents: 4900,
      image_url: "https://cdn.example.com/hoodie.png",
      image_path: null,
      description: "Warm and heavy.",
      status: "active",
      created_at: new Date("2026-10-20T12:00:00Z"),
    },
  ];
  s.followCount = 7;
  s.referralRows = [{ code: "ABC" }];
  const tipView = {
    handle: "some-creator-tips",
    displayName: "Some Creator",
    message: "Thanks for the love",
    suggestedAmounts: [5, 10, 25],
    goalAmount: 500,
    goalLabel: "New camera",
  };
  s.tipByHandleOrSlug = { [PROFILE_SLUG]: tipView, "some-creator-tips": tipView };
  s.tipByUser = { [OWNER_ID]: tipView };
  s.authUserId = OWNER_ID;
});

async function getJson(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

async function getPage(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  const text = await r.text();
  return { status: r.status, headers: r.headers, text };
}

describe("latest video widget", () => {
  it("serves the creator's newest public video with short flag + artist", async () => {
    const { status, json } = await getJson(`/api/embed/latest/${PROFILE_SLUG}`);
    expect(status).toBe(200);
    expect(json.kind).toBe("latest");
    expect(json.video.id).toBe(VIDEO_ID);
    expect(json.video.is_short).toBe(true);
    expect(json.video.video_url).toBe("https://cdn.example.com/drop.mp4");
    expect(json.artist_name).toBe("Some Creator");
    expect(json.ref_code).toBe("ABC");
  });

  it("honest empty state: creator with only unpublished videos gets video: null, not a borrowed clip", async () => {
    h.state.videos = [{ ...h.state.videos[0], isPublished: false }];
    const { status, json } = await getJson(`/api/embed/latest/${PROFILE_SLUG}`);
    expect(status).toBe(200);
    expect(json.video).toBeNull();
    expect(json.artist_slug).toBe(PROFILE_SLUG);
  });

  it("404s an unknown creator and a private profile", async () => {
    /* The fake ignores where-clauses (house pattern), so an unknown
       slug is simulated by the empty table — the getter's own
       isPublic check is what the second half pins. */
    h.state.profiles = [];
    expect((await getJson(`/api/embed/latest/nope`)).status).toBe(404);
    h.state.profiles = [
      {
        id: PROFILE_ID, userId: OWNER_ID, slug: PROFILE_SLUG,
        displayName: "Some Creator", isPublic: false, avatarUrl: null, bio: null,
      },
    ];
    expect((await getJson(`/api/embed/latest/${PROFILE_SLUG}`)).status).toBe(404);
  });
});

describe("live badge widget — truthful presence only", () => {
  it("shows LIVE with the real viewer count while the row says live", async () => {
    const { status, json } = await getJson(`/api/embed/live/${PROFILE_SLUG}`);
    expect(status).toBe(200);
    expect(json.is_live).toBe(true);
    expect(json.stream.id).toBe(STREAM_ID);
    expect(json.stream.viewer_count).toBe(42);
    expect(json.stream.title).toBe("Friday Show");
  });

  it("an ended stream reads offline — stream: null, is_live: false", async () => {
    h.state.streams = [{ ...h.state.streams[0], status: "ended" }];
    const { status, json } = await getJson(`/api/embed/live/${PROFILE_SLUG}`);
    expect(status).toBe(200);
    expect(json.is_live).toBe(false);
    expect(json.stream).toBeNull();
    expect(json.display_name).toBe("Some Creator");
  });

  it("404s an unknown creator", async () => {
    h.state.profiles = [];
    expect((await getJson(`/api/embed/live/nope`)).status).toBe(404);
  });
});

describe("tip jar widget", () => {
  it("resolves by profile slug and carries the page's REAL handle for the door", async () => {
    const { status, json } = await getJson(`/api/embed/tips/${PROFILE_SLUG}`);
    expect(status).toBe(200);
    expect(json.kind).toBe("tips");
    expect(json.handle).toBe("some-creator-tips");
    expect(json.suggested_amounts).toEqual([5, 10, 25]);
    expect(json.goal_label).toBe("New camera");
  });

  it("404s when the creator has no tip page", async () => {
    h.state.tipByHandleOrSlug = {};
    expect((await getJson(`/api/embed/tips/${PROFILE_SLUG}`)).status).toBe(404);
  });
});

describe("storefront item widget", () => {
  it("serves an active product with price + shop door data", async () => {
    const { status, json } = await getJson(`/api/embed/product/${PRODUCT_ID}`);
    expect(status).toBe(200);
    expect(json.name).toBe("Gold Hoodie");
    expect(json.price_cents).toBe(4900);
    expect(json.shop_handle).toBe("creator-shop");
    expect(json.shop_name).toBe("Creator Shop");
    expect(json.ref_code).toBe("ABC");
  });

  it("a paused product's billboard comes down (404)", async () => {
    h.state.products = [{ ...h.state.products[0], status: "paused" }];
    expect((await getJson(`/api/embed/product/${PRODUCT_ID}`)).status).toBe(404);
  });

  it("404s an unknown product", async () => {
    h.state.products = [];
    expect((await getJson(`/api/embed/product/nope`)).status).toBe(404);
  });
});

describe("profile widget payload", () => {
  it("carries the real follower count", async () => {
    const { status, json } = await getJson(`/api/embed/profile/${PROFILE_SLUG}`);
    expect(status).toBe(200);
    expect(json.follower_count).toBe(7);
  });
});

describe("GET /api/embed/mine — the desk inventory", () => {
  it("returns the owner's slug, tip handle, live state and active products only", async () => {
    h.state.products = [
      ...h.state.products,
      { ...h.state.products[0], id: "77777777-7777-4777-8777-777777777777", name: "Paused One", status: "paused" },
    ];
    const { status, json } = await getJson(`/api/embed/mine`);
    expect(status).toBe(200);
    expect(json.profile.slug).toBe(PROFILE_SLUG);
    expect(json.tip_handle).toBe("some-creator-tips");
    expect(json.live.is_live).toBe(true);
    expect(json.products).toHaveLength(1);
    expect(json.products[0].name).toBe("Gold Hoodie");
    expect(json.products[0].shop_handle).toBe("creator-shop");
  });

  /* Stack1000 M2 — the classic kinds' inventory: the desk can only
     offer what the embed getters themselves would resolve. */
  it("carries the owner's PUBLISHED tracks only — drafts never reach the desk", async () => {
    const { status, json } = await getJson(`/api/embed/mine`);
    expect(status).toBe(200);
    expect(json.tracks).toEqual([{ id: TRACK_ID, title: "Gold Standard" }]);
  });

  it("carries the owner's PUBLISHED videos only, with the short flag for the picker", async () => {
    const { json } = await getJson(`/api/embed/mine`);
    expect(json.videos).toEqual([{ id: VIDEO_ID, title: "New Drop", is_short: true }]);
  });

  it("carries the owner's PUBLIC playlists only, with real item counts", async () => {
    const { json } = await getJson(`/api/embed/mine`);
    expect(json.playlists).toEqual([{ id: PLAYLIST_ID, title: "Evening Mix", item_count: 2 }]);
  });

  it("another creator's media never leaks into the desk (owner scoping is in-code)", async () => {
    /* The fake ignores where-clauses, so rows owned by someone else sit
       in the same tables — the handler's own owner checks are the pin. */
    h.state.tracks = [
      ...h.state.tracks,
      {
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        profileId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        title: "Not Yours",
        isPublished: true,
        artworkUrl: null,
        audioUrl: "https://cdn.example.com/not-yours.mp3",
        playCount: 1,
        createdAt: new Date("2026-10-30T12:00:00Z"),
      },
    ];
    h.state.playlists = [
      ...h.state.playlists,
      {
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        ownerProfileId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        title: "Not Yours Either",
        isPublic: true,
        coverUrl: null,
        items: [],
        createdAt: new Date("2026-10-30T12:00:00Z"),
      },
    ];
    const { json } = await getJson(`/api/embed/mine`);
    expect(json.tracks.map((t: any) => t.title)).toEqual(["Gold Standard"]);
    expect(json.playlists.map((p: any) => p.title)).toEqual(["Evening Mix"]);
  });

  it("a creator with no profile gets empty classic lists, not an error", async () => {
    h.state.profiles = [];
    const { status, json } = await getJson(`/api/embed/mine`);
    expect(status).toBe(200);
    expect(json.profile).toBeNull();
    expect(json.tracks).toEqual([]);
    expect(json.videos).toEqual([]);
    expect(json.playlists).toEqual([]);
  });
});

describe("embed pages — framing scope", () => {
  it("embed pages carry NO X-Frame-Options and a CSP with no frame-ancestors", async () => {
    const { status, headers } = await getPage(`/embed/live/${PROFILE_SLUG}`);
    expect(status).toBe(200);
    expect(headers.get("x-frame-options")).toBeNull();
    const csp = headers.get("content-security-policy") ?? "";
    expect(csp).not.toContain("frame-ancestors");
  });

  it("non-embed pages keep X-Frame-Options: SAMEORIGIN", async () => {
    const { headers } = await getPage(`/promote`);
    expect(headers.get("x-frame-options")).toBe("SAMEORIGIN");
  });

  it("the main CSP lets OUR pages frame our own embeds (frame-src 'self') but no third party", async () => {
    const { headers } = await getPage(`/promote`);
    const csp = headers.get("content-security-policy") ?? "";
    expect(csp).toContain("frame-src 'self' https://js.stripe.com");
    expect(csp).not.toContain("frame-src *");
  });
});

describe("embed pages — theme + responsive pins", () => {
  it("the shell pre-paints the light theme from ?theme=light and defines both palettes", async () => {
    const { text } = await getPage(`/embed/product/${PRODUCT_ID}?theme=light`);
    expect(text).toContain('get("theme")==="light"');
    expect(text).toContain("document.documentElement.classList.add(\"light\")");
    expect(text).toContain(":root.light");
    expect(text).toContain("--bg:#FBF6E9");
    expect(text).toContain("--bg:#0a0805");
  });

  it("phone + tablet breakpoints, ≥44px doors, no sideways scroll at 320px", async () => {
    const { text } = await getPage(`/embed/live/${PROFILE_SLUG}`);
    expect(text).toContain("@media (max-width:480px)");
    expect(text).toContain("@media (min-width:768px)");
    expect(text).toMatch(/\.door\{[^}]*min-height:44px/);
    expect(text).toMatch(/\.cta\{[^}]*min-height:44px/);
    expect(text).toContain("overflow-x:hidden");
    expect(text).toContain("img,video{max-width:100%}");
  });

  it("the live page renders LIVE NOW with a 60s truth refresh and the /live/ door", async () => {
    const { text } = await getPage(`/embed/live/${PROFILE_SLUG}`);
    expect(text).toContain("LIVE NOW");
    expect(text).toContain("60000");
    expect(text).toContain("/live/");
    expect(text).toContain("/api/embed/live/");
  });

  it("the tips page doors home to /tips/<handle> — money never leaves the site", async () => {
    const { text } = await getPage(`/embed/tips/${PROFILE_SLUG}`);
    expect(text).toContain("Leave a tip");
    expect(text).toContain("/tips/");
    /* The shell builds its data URL from the baked-in kind. */
    expect(text).toContain('KIND="tips"');
    expect(text).toContain('fetch("/api/embed/"+KIND');
  });

  it("the product page doors home to /shop/<handle>", async () => {
    const { text } = await getPage(`/embed/product/${PRODUCT_ID}`);
    expect(text).toContain("See it in the shop");
    expect(text).toContain("/shop/");
  });

  it("the latest page fetches its JSON and labels the newest drop", async () => {
    const { text } = await getPage(`/embed/latest/${PROFILE_SLUG}`);
    expect(text).toContain('KIND="latest"');
    expect(text).toContain('fetch("/api/embed/"+KIND');
    expect(text).toContain("Newest drop");
  });
});

/* Stack1000 M2 — the classic pages (track / video / playlist) predate
   the desk but ride the same embedShell: theme pre-paint, brandbar
   footer, ≥44px doors, the framing carve-out. These pins keep them
   there; the video page's artist door is the one true parity fix —
   every sibling kind doors home to the artist, video only named them. */
describe("classic embed pages — parity with the C1 shell", () => {
  it("the track page rides the shared shell and doors to the artist", async () => {
    const { status, text } = await getPage(`/embed/track/${TRACK_ID}?theme=light`);
    expect(status).toBe(200);
    expect(text).toContain('KIND="track"');
    expect(text).toContain('get("theme")==="light"');
    expect(text).toContain("Made with");
    expect(text).toMatch(/\.door\{[^}]*min-height:44px/);
    expect(text).toContain("<audio controls");
    expect(text).toContain("/artist/");
  });

  it("the video page doors home to the artist profile, like the track page", async () => {
    const { text } = await getPage(`/embed/video/${VIDEO_ID}`);
    expect(text).toContain('KIND="video"');
    expect(text).toContain("<video controls");
    expect(text).toContain("/artist/");
    expect(text).toContain(">Profile</a>");
  });

  it("the playlist page lists items as ≥44px rows dooring to /track/ and /watch/", async () => {
    const { text } = await getPage(`/embed/playlist/${PLAYLIST_ID}`);
    expect(text).toContain('KIND="playlist"');
    expect(text).toContain("min-height:44px");
    expect(text).toContain('"/track/"');
    expect(text).toContain('"/watch/"');
  });

  it("classic pages sit inside the framing carve-out too (no X-Frame-Options)", async () => {
    for (const path of [`/embed/track/${TRACK_ID}`, `/embed/video/${VIDEO_ID}`, `/embed/playlist/${PLAYLIST_ID}`]) {
      const { status, headers } = await getPage(path);
      expect(status).toBe(200);
      expect(headers.get("x-frame-options")).toBeNull();
    }
  });
});
