/**
 * Share-truth tests for the embed pages (routes/embed.ts) — Stack1000 P4.
 *
 * Before this lane an embed URL carried a generic <title> ("Bow Down
 * Visuals embed") and no OG/Twitter tags at all: a pasted embed link
 * unfurled as nothing. Bots now get the entity's real card injected into
 * the shell (canonical og:url = the canonical page, never the embed);
 * humans keep the byte-identical player shell.
 *
 * Pure composition is pinned per kind via embedOgFromData; the HTTP
 * tests pin the bot-only wiring (fake db follows the embed-widgets
 * house pattern — where-clauses are ignored, in-code flag checks rule).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const TRACK_ID = "22222222-2222-4222-8222-222222222222";
const SHOP_ID = "55555555-5555-4555-8555-555555555555";
const PRODUCT_ID = "66666666-6666-4666-8666-666666666666";
const PROFILE_SLUG = "thy-cheat-code";

const h = vi.hoisted(() => ({
  state: {
    profiles: [] as Array<Record<string, unknown>>,
    tracks: [] as Array<Record<string, unknown>>,
    shops: [] as Array<Record<string, unknown>>,
    products: [] as Array<Record<string, unknown>>,
    followCount: 0,
    referralRows: [] as Array<Record<string, unknown>>,
    tipByHandleOrSlug: {} as Record<string, unknown>,
  },
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  isStorageRef: (v: unknown) =>
    typeof v === "string" && (v.startsWith("r2://") || v.startsWith("supabase://")),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../generate/tip-jar", () => ({
  getPublicTipPageByHandleOrSlug: async (v: string) =>
    h.state.tipByHandleOrSlug[v.toLowerCase()] ?? null,
  getPublicTipPageByUserId: () => null,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const {
    creatorProfilesTable,
    profileTracksTable,
    followsTable,
    shopsTable,
    shopProductsTable,
  } = actual;

  function rowsFor(table: unknown, fields?: unknown): unknown[] {
    if (table === creatorProfilesTable) return state.profiles;
    if (table === profileTracksTable) return state.tracks;
    if (table === shopsTable) return state.shops;
    if (table === shopProductsTable) return state.products;
    if (table === followsTable) {
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

import { embedPageRouter, embedOgFromData, buildEmbedOgTags, type EmbedOgCard } from "../embed";

const ORIGIN = "https://bowdownvisuals.com";
const ARTIST = "Thy Cheat Code";

/* ── Pure composition: every embed kind names its actual content ──────── */

describe("embedOgFromData", () => {
  it("track: title names the song + creator, image is the track's artwork, canonical is /track", () => {
    const og = embedOgFromData(
      {
        kind: "track",
        id: TRACK_ID,
        title: "Crown Heavy",
        artist_name: ARTIST,
        artist_slug: PROFILE_SLUG,
        artwork_url: "https://cdn.example.com/art.jpg",
        audio_url: "https://cdn.example.com/a.mp3",
        ref_code: null,
      },
      ORIGIN,
    );
    expect(og.title).toBe("Crown Heavy — Thy Cheat Code");
    expect(og.image).toBe("https://cdn.example.com/art.jpg");
    expect(og.url).toBe(`${ORIGIN}/track/${TRACK_ID}`);
    expect(og.ogType).toBe("music.song");
  });

  it("video: thumbnail is the card image, canonical is /watch", () => {
    const og = embedOgFromData(
      {
        kind: "video",
        id: TRACK_ID,
        title: "Studio Tour",
        artist_name: ARTIST,
        artist_slug: PROFILE_SLUG,
        thumbnail_url: "https://cdn.example.com/thumb.jpg",
        video_url: "https://cdn.example.com/v.mp4",
        ref_code: null,
      },
      ORIGIN,
    );
    expect(og.title).toBe("Studio Tour — Thy Cheat Code");
    expect(og.image).toBe("https://cdn.example.com/thumb.jpg");
    expect(og.url).toBe(`${ORIGIN}/watch/${TRACK_ID}`);
  });

  it("playlist: cover image + owner named, canonical is /playlist", () => {
    const og = embedOgFromData(
      {
        kind: "playlist",
        id: TRACK_ID,
        title: "Late Night Gold",
        owner_name: ARTIST,
        cover_url: "https://cdn.example.com/cover.jpg",
        item_count: 12,
        ref_code: null,
        items: [],
      },
      ORIGIN,
    );
    expect(og.title).toBe("Late Night Gold — Thy Cheat Code");
    expect(og.description).toContain("12 items");
    expect(og.image).toBe("https://cdn.example.com/cover.jpg");
    expect(og.url).toBe(`${ORIGIN}/playlist/${TRACK_ID}`);
  });

  it("profile: creator named, avatar image, bio is the description, canonical is /artist", () => {
    const og = embedOgFromData(
      {
        kind: "profile",
        slug: PROFILE_SLUG,
        display_name: ARTIST,
        avatar_url: "https://cdn.example.com/avatar.png",
        bio: "The content creator's cheat code.",
        follower_count: 10,
        ref_code: null,
        featured: null,
      },
      ORIGIN,
    );
    expect(og.title).toBe("Thy Cheat Code — creator on Bow Down Visuals");
    expect(og.description).toBe("The content creator's cheat code.");
    expect(og.image).toBe("https://cdn.example.com/avatar.png");
    expect(og.url).toBe(`${ORIGIN}/artist/${PROFILE_SLUG}`);
  });

  it("latest: with a video it names the video; without one it never borrows a clip", () => {
    const withVideo = embedOgFromData(
      {
        kind: "latest",
        artist_name: ARTIST,
        artist_slug: PROFILE_SLUG,
        avatar_url: "https://cdn.example.com/avatar.png",
        ref_code: null,
        video: {
          id: TRACK_ID,
          title: "Fresh Drop",
          is_short: false,
          thumbnail_url: "https://cdn.example.com/fresh.jpg",
          video_url: "https://cdn.example.com/f.mp4",
          created_at: "2026-10-30T00:00:00.000Z",
        },
      },
      ORIGIN,
    );
    expect(withVideo.title).toBe("Fresh Drop — Thy Cheat Code");
    expect(withVideo.image).toBe("https://cdn.example.com/fresh.jpg");
    expect(withVideo.url).toBe(`${ORIGIN}/watch/${TRACK_ID}`);

    const noVideo = embedOgFromData(
      {
        kind: "latest",
        artist_name: ARTIST,
        artist_slug: PROFILE_SLUG,
        avatar_url: "https://cdn.example.com/avatar.png",
        ref_code: null,
        video: null,
      },
      ORIGIN,
    );
    expect(noVideo.title).toBe("Thy Cheat Code — creator on Bow Down Visuals");
    expect(noVideo.url).toBe(`${ORIGIN}/artist/${PROFILE_SLUG}`);
  });

  it("live: a live stream names the stream and points at /live; offline never claims live", () => {
    const live = embedOgFromData(
      {
        kind: "live",
        is_live: true,
        display_name: ARTIST,
        artist_slug: PROFILE_SLUG,
        avatar_url: "https://cdn.example.com/avatar.png",
        ref_code: null,
        stream: {
          id: TRACK_ID,
          title: "Friday Freestyle",
          viewer_count: 5,
          started_at: "2026-10-30T20:00:00.000Z",
        },
      },
      ORIGIN,
    );
    expect(live.title).toBe("Friday Freestyle — live by Thy Cheat Code");
    expect(live.url).toBe(`${ORIGIN}/live/${TRACK_ID}`);

    const offline = embedOgFromData(
      {
        kind: "live",
        is_live: false,
        display_name: ARTIST,
        artist_slug: PROFILE_SLUG,
        avatar_url: "https://cdn.example.com/avatar.png",
        ref_code: null,
        stream: null,
      },
      ORIGIN,
    );
    expect(offline.title).not.toContain("live by");
    expect(offline.url).toBe(`${ORIGIN}/artist/${PROFILE_SLUG}`);
  });

  it("tips: the creator's own tip-page message is the description; canonical is /tips", () => {
    const og = embedOgFromData(
      {
        kind: "tips",
        handle: "cheatcode",
        display_name: ARTIST,
        message: "Tips fund the next video — thank you!",
        suggested_amounts: [100, 500],
        goal_amount: null,
        goal_label: "",
      },
      ORIGIN,
    );
    expect(og.title).toBe("Tip Thy Cheat Code — Bow Down Visuals");
    expect(og.description).toBe("Tips fund the next video — thank you!");
    expect(og.url).toBe(`${ORIGIN}/tips/cheatcode`);
    // No content art exists on a tip page — the brand card, never a borrowed image.
    expect(og.image).toBe(`${ORIGIN}/og-fallback.png`);
  });

  it("product: name + shop named, product shot is the image, canonical is the storefront product", () => {
    const og = embedOgFromData(
      {
        kind: "product",
        id: PRODUCT_ID,
        name: "Gold Mic Wrap",
        price_cents: 4900,
        image_url: "https://cdn.example.com/wrap.jpg",
        description: null,
        shop_name: "TEST Buyer D Shop",
        shop_handle: "test-buyer-d-shop",
        ref_code: null,
      },
      ORIGIN,
    );
    expect(og.title).toBe("Gold Mic Wrap — TEST Buyer D Shop");
    expect(og.image).toBe("https://cdn.example.com/wrap.jpg");
    expect(og.url).toBe(`${ORIGIN}/storefront/product/${PRODUCT_ID}`);
  });

  it("art-less entities fall back to the brand card, never the homepage image", () => {
    const og = embedOgFromData(
      {
        kind: "track",
        id: TRACK_ID,
        title: "No Art Yet",
        artist_name: ARTIST,
        artist_slug: PROFILE_SLUG,
        artwork_url: null,
        audio_url: "https://cdn.example.com/a.mp3",
        ref_code: null,
      },
      ORIGIN,
    );
    expect(og.image).toBe(`${ORIGIN}/og-fallback.png`);
  });
});

describe("buildEmbedOgTags", () => {
  it("escapes hostile titles and emits the full tag set", () => {
    const og: EmbedOgCard = {
      title: `Bad " <script> Title`,
      description: "d & d",
      image: `${ORIGIN}/og-fallback.png`,
      url: `${ORIGIN}/track/x`,
      ogType: "music.song",
    };
    const tags = buildEmbedOgTags(og);
    expect(tags).toContain(`<meta property="og:title" content="Bad &quot; &lt;script&gt; Title"/>`);
    expect(tags).toContain(`<meta name="twitter:card" content="summary_large_image"/>`);
    expect(tags).not.toContain("<script>");
  });
});

/* ── HTTP wiring: bots get the card, humans get the untouched shell ───── */

let server: any;
let baseUrl: string;

beforeAll(async () => {
  h.state.profiles = [
    {
      id: PROFILE_ID,
      userId: "44444444-4444-4444-8444-444444444444",
      slug: PROFILE_SLUG,
      displayName: ARTIST,
      avatarUrl: "https://cdn.example.com/avatar.png",
      isPublic: true,
    },
  ];
  h.state.tracks = [
    {
      id: TRACK_ID,
      profileId: PROFILE_ID,
      title: "Crown Heavy",
      artworkUrl: "https://cdn.example.com/art.jpg",
      audioUrl: "https://cdn.example.com/a.mp3",
      isPublished: true,
    },
  ];
  h.state.shops = [{ id: SHOP_ID, name: "TEST Buyer D Shop", handle: "test-buyer-d-shop" }];
  h.state.products = [
    {
      id: PRODUCT_ID,
      shop_id: SHOP_ID,
      name: "Gold Mic Wrap",
      price_cents: 4900,
      image_url: "https://cdn.example.com/wrap.jpg",
      image_path: null,
      description: null,
      status: "active",
    },
  ];
  const app = express();
  app.use(embedPageRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

describe("embed page share wiring", () => {
  it("humans get the untouched player shell — generic title, no og tags", async () => {
    const res = await fetch(`${baseUrl}/embed/track/${TRACK_ID}`, {
      headers: { "user-agent": BROWSER_UA },
    });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).toContain("<title>Bow Down Visuals embed</title>");
    expect(text).not.toContain("og:title");
  });

  it("Twitterbot gets the track's real card with the canonical /track URL", async () => {
    const res = await fetch(`${baseUrl}/embed/track/${TRACK_ID}`, {
      headers: { "user-agent": "Twitterbot/1.0" },
    });
    const text = await res.text();
    expect(text).toContain("<title>Crown Heavy — Thy Cheat Code</title>");
    expect(text).toContain(
      `<meta property="og:image" content="https://cdn.example.com/art.jpg"/>`,
    );
    expect(text).toContain(`<meta property="og:url" content="${ORIGIN}/track/${TRACK_ID}"/>`);
    expect(res.headers.get("vary")).toContain("User-Agent");
  });

  it("Discordbot gets the product's real card with the storefront canonical", async () => {
    const res = await fetch(`${baseUrl}/embed/product/${PRODUCT_ID}`, {
      headers: { "user-agent": "Discordbot/2.0; +https://discordapp.com" },
    });
    const text = await res.text();
    expect(text).toContain("<title>Gold Mic Wrap — TEST Buyer D Shop</title>");
    expect(text).toContain(
      `<meta property="og:url" content="${ORIGIN}/storefront/product/${PRODUCT_ID}"/>`,
    );
  });

  it("a bot asking for a missing entity gets the plain shell, never a 500 or a borrowed card", async () => {
    const saved = h.state.tracks;
    h.state.tracks = [];
    try {
      const res = await fetch(`${baseUrl}/embed/track/${TRACK_ID}`, {
        headers: { "user-agent": "Twitterbot/1.0" },
      });
      const text = await res.text();
      expect(res.status).toBe(200);
      expect(text).toContain("<title>Bow Down Visuals embed</title>");
      expect(text).not.toContain("og:title");
    } finally {
      h.state.tracks = saved;
    }
  });
});
