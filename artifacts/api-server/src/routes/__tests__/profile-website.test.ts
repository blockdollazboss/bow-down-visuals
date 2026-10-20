/**
 * Route tests for Stack 3 "The profile IS the website"
 * (routes/profile-website.ts + lib/profile-website.ts):
 *   #2 layout model   GET|PUT /creator-profiles/me/layout, GET /:slug/layout
 *   #3 theme settings GET|PUT /creator-profiles/me/theme-settings
 *   #4 store catalog  GET /creator-profiles/:slug/store-catalog
 *   #5 spotlight pin  GET /creator-profiles/:slug/spotlight, PUT /me/spotlight
 *   #6 collections    GET /collections/:slug, GET /collections/me,
 *                     PUT /collections/me/visibility
 *
 * Contract pinned here:
 * - An untouched profile's layout IS today's page: stored sections in
 *   order (or the vertical starter order) + court/achievements/links.
 * - Layout saves are strict: registry types only, one per type, capped,
 *   scalar-only config (no freeform code/HTML vectors).
 * - Theme settings resolve KEYS server-side (colorway → theme_config
 *   colors, fonts → theme_config fonts); unknown keys are rejected.
 * - The store catalog prices are copied from the underlying surfaces
 *   (download_price_cents / price_cents) — never recomputed.
 * - A pin must be the owner's own published content; clearing works;
 *   an unpublished pin hides publicly but survives.
 * - Collections: private collections leak nothing (no items/counts);
 *   only completed store orders + digital sales show.
 *
 * Fake db in the royal-court.test.ts style: real table objects via
 * importOriginal, WHERE params read back through PgDialect.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

const OWNER_USER = "00000000-0000-4000-8000-0000000000aa";
const FAN_USER = "00000000-0000-4000-8000-0000000000bb";
const NO_PROFILE_USER = "00000000-0000-4000-8000-0000000000cc";

const OWNER_PROFILE = "11111111-1111-4111-8111-111111111111";
const FAN_PROFILE = "22222222-2222-4222-8222-222222222222";
const TRACK_ID = "33333333-3333-4333-8333-333333333333";
const TRACK_UNPUBLISHED = "44444444-4444-4444-8444-444444444444";
const VIDEO_ID = "55555555-5555-4555-8555-555555555555";
const OTHER_TRACK = "66666666-6666-4666-8666-666666666666";
const PRODUCT_ID = "77777777-7777-4777-8777-777777777777";
const SALE_ID = "88888888-8888-4888-8888-888888888888";
const ORDER_ID = "99999999-9999-4999-8999-999999999999";

const h = vi.hoisted(() => ({
  state: {
    profilesById: new Map<string, Record<string, unknown>>(),
    tracksById: new Map<string, Record<string, unknown>>(),
    videosById: new Map<string, Record<string, unknown>>(),
    productsById: new Map<string, Record<string, unknown>>(),
    sales: [] as Array<Record<string, unknown>>,
    orders: [] as Array<Record<string, unknown>>,
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

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const state = h.state;
  const {
    creatorProfilesTable, profileTracksTable, profileVideosTable,
    storeProductsTable, digitalSalesTable, storeOrdersTable,
    creatorSubscriptionsTable, creatorHostingTable,
  } = actual;

  function allProfiles() {
    return [...state.profilesById.values()];
  }

  function rowsFor(table: unknown, cond: unknown): unknown[] {
    const { sql, params } = render(cond);
    if (table === creatorProfilesTable) {
      if (sql.includes(" in (")) {
        return params.map((id) => state.profilesById.get(String(id))).filter(Boolean);
      }
      if (sql.includes('"user_id"')) {
        const row = allProfiles().find((p) => String(p["userId"]) === String(params[0]));
        return row ? [row] : [];
      }
      if (sql.includes('"slug"')) {
        const row = allProfiles().find((p) => String(p["slug"]) === String(params[0]));
        return row ? [row] : [];
      }
      if (sql.includes('"id"')) {
        const row = state.profilesById.get(String(params[0]));
        return row ? [row] : [];
      }
      return [];
    }
    if (table === profileTracksTable || table === profileVideosTable) {
      const map = table === profileTracksTable ? state.tracksById : state.videosById;
      const rows = [...map.values()];
      if (sql.includes('"is_published"') && sql.includes('"profile_id"')) {
        return rows.filter((r) => String(r["profileId"]) === String(params[0]) && r["isPublished"] === params[1]);
      }
      if (sql.includes('"profile_id"')) {
        return rows.filter((r) => String(r["id"]) === String(params[0]) && String(r["profileId"]) === String(params[1]));
      }
      if (sql.includes('"id"')) {
        const row = map.get(String(params[0]));
        return row ? [row] : [];
      }
      return rows;
    }
    if (table === storeProductsTable) {
      const rows = [...state.productsById.values()];
      if (sql.includes('"is_active"')) {
        return rows.filter((r) => String(r["profileId"]) === String(params[0]) && r["isActive"] === params[1]);
      }
      if (sql.includes('"id"')) {
        const row = state.productsById.get(String(params[0]));
        return row ? [row] : [];
      }
      return rows;
    }
    if (table === digitalSalesTable) {
      return state.sales.filter((s) => String(s["buyerUserId"]) === String(params[0]));
    }
    if (table === storeOrdersTable) {
      return state.orders.filter(
        (o) => String(o["buyerUserId"]) === String(params[0]) && String(o["status"]) === String(params[1]),
      );
    }
    if (table === creatorSubscriptionsTable || table === creatorHostingTable) {
      return [];
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

  function thenable(extra: Record<string, unknown> = {}): any {
    return { ...extra, then: (res: any, rej: any) => Promise.resolve([]).then(res, rej) };
  }

  const fakeDb: any = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => chain(table, cond),
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

import router from "../profile-website";

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
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function profileRow(id: string, userId: string, slug: string, extra: Record<string, unknown> = {}) {
  return {
    id, userId, slug,
    displayName: slug,
    bio: "",
    avatarUrl: null,
    bannerUrl: null,
    themeId: "gold-lux",
    vertical: "music",
    streamSchedule: [],
    mediaKit: null,
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
    followerCount: 0,
    totalPlays: 0,
    stripeConnectAccountId: null,
    stripeConnectOnboarded: false,
    stripeConnectChargesEnabled: false,
    stripeConnectPayoutsEnabled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
  };
}

beforeEach(() => {
  const s = h.state;
  s.profilesById = new Map();
  s.tracksById = new Map();
  s.videosById = new Map();
  s.productsById = new Map();
  s.sales = [];
  s.orders = [];

  s.profilesById.set(OWNER_PROFILE, profileRow(OWNER_PROFILE, OWNER_USER, "owner-creator", {
    displayName: "Owner Creator",
    sections: [
      { id: "hero-0", type: "hero", title: "Featured Track", visible: true },
      { id: "tracks-1", type: "tracks", title: "Music", visible: true },
      { id: "bio-2", type: "bio", title: "About", visible: false },
    ],
    themeConfig: { themeId: "midnight-gold", colors: { primary: "#d4af37" }, fonts: { heading: "Cinzel", body: "Inter" } },
  }));
  s.profilesById.set(FAN_PROFILE, profileRow(FAN_PROFILE, FAN_USER, "fan-person", { displayName: "Fan Person" }));

  s.tracksById.set(TRACK_ID, {
    id: TRACK_ID, profileId: OWNER_PROFILE, title: "Golden Hour", audioUrl: "https://cdn.example/track.mp3",
    artworkUrl: "https://cdn.example/track.png", genre: null, tags: [], isrc: null, durationSec: 180,
    downloadPriceCents: 499, pwywEnabled: false, pwywMinCents: 0, playCount: 10, likeCount: 0,
    repostCount: 0, commentCount: 0, isPublished: true, createdAt: new Date(),
  });
  s.tracksById.set(TRACK_UNPUBLISHED, {
    id: TRACK_UNPUBLISHED, profileId: OWNER_PROFILE, title: "Secret Draft", audioUrl: "https://cdn.example/draft.mp3",
    artworkUrl: null, genre: null, tags: [], isrc: null, durationSec: 60,
    downloadPriceCents: 0, pwywEnabled: false, pwywMinCents: 0, playCount: 0, likeCount: 0,
    repostCount: 0, commentCount: 0, isPublished: false, createdAt: new Date(),
  });
  s.tracksById.set(OTHER_TRACK, {
    id: OTHER_TRACK, profileId: FAN_PROFILE, title: "Not Yours", audioUrl: "https://cdn.example/other.mp3",
    artworkUrl: null, genre: null, tags: [], isrc: null, durationSec: 60,
    downloadPriceCents: 299, pwywEnabled: false, pwywMinCents: 0, playCount: 0, likeCount: 0,
    repostCount: 0, commentCount: 0, isPublished: true, createdAt: new Date(),
  });
  s.videosById.set(VIDEO_ID, {
    id: VIDEO_ID, profileId: OWNER_PROFILE, title: "Golden Video", videoUrl: "https://cdn.example/video.mp4",
    thumbnailUrl: "https://cdn.example/video.png", description: "", genre: null, tags: [], durationSec: 90,
    season: null, episode: null, soundTrackId: null, downloadPriceCents: 0, pwywEnabled: false, pwywMinCents: 0,
    viewCount: 5, likeCount: 0, repostCount: 0, commentCount: 0, isPublished: true, isShort: false,
    duetWith: null, stitchWith: null, soundId: null, soundTitle: null, soundUrl: null, soundUseCount: 0,
    createdAt: new Date(),
  });
  s.productsById.set(PRODUCT_ID, {
    id: PRODUCT_ID, profileId: OWNER_PROFILE, kind: "merch", title: "Gold Tee", description: "",
    priceCents: 4500, compareAtCents: 6000, inventory: -1, mediaUrls: ["https://cdn.example/tee.png"],
    serviceDetails: null, eventId: null, relatedLinks: [], isActive: true,
    createdAt: new Date(), updatedAt: new Date(),
  });

  s.sales = [{
    id: SALE_ID, buyerUserId: FAN_USER, profileId: OWNER_PROFILE, itemKind: "track", itemId: TRACK_ID,
    stripeSessionId: "cs_1", amountCents: 499, platformFeeCents: 50, creatorAmountCents: 449,
    createdAt: new Date("2026-10-01T00:00:00Z"),
  }];
  s.orders = [
    {
      id: ORDER_ID, buyerUserId: FAN_USER, profileId: OWNER_PROFILE, productId: PRODUCT_ID,
      productTitle: "Gold Tee", productKind: "merch", quantity: 1, amountCents: 4500, discountCode: null,
      platformFeeCents: 450, creatorAmountCents: 4050, stripeSessionId: "cs_2", status: "completed",
      fulfillmentNote: null, createdAt: new Date("2026-10-02T00:00:00Z"),
    },
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", buyerUserId: FAN_USER, profileId: OWNER_PROFILE, productId: PRODUCT_ID,
      productTitle: "Gold Tee (pending)", productKind: "merch", quantity: 1, amountCents: 4500, discountCode: null,
      platformFeeCents: 450, creatorAmountCents: 4050, stripeSessionId: "cs_3", status: "pending",
      fulfillmentNote: null, createdAt: new Date("2026-10-03T00:00:00Z"),
    },
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
  const json = await r.json().catch(() => null);
  return { status: r.status, json: json as any };
}

describe("#2 layout model", () => {
  it("an untouched profile's default layout is the Grand Stage order", async () => {
    const { status, json } = await call("GET", "/creator-profiles/me/layout", { user: OWNER_USER });
    expect(status).toBe(200);
    expect(json.isDefault).toBe(true);
    /* The owner's picked order (Oct 16): the masthead leads, then
     * The Stage → The Front Row → Music → Videos → Store → Memberships,
     * then the profile's remaining sections (bio, still hidden), then
     * the Trophy Shelf and Social Links. */
    expect(json.layout.map((b: any) => b.type)).toEqual([
      "hero", "spotlight", "court", "tracks", "videos", "store", "memberships",
      "bio", "achievements", "links",
    ]);
    expect(json.layout.find((b: any) => b.type === "spotlight").title).toBe("The Stage");
    expect(json.layout.find((b: any) => b.type === "court").title).toBe("The Front Row");
    expect(json.layout.find((b: any) => b.type === "tracks").title).toBe("Music");
    expect(json.layout.find((b: any) => b.type === "bio").visible).toBe(false);
    expect(json.maxBlocks).toBeGreaterThanOrEqual(json.blockTypes.length);
  });

  it("serves the untouched default layout to a GUEST with the memberships block visible", async () => {
    /* The Oct 17 flag, pinned: a guest reported no Memberships section
       on a creator profile. The guest read is THIS route with no
       credentials at all — for an untouched profile it must carry the
       memberships block, visible, in its Grand Stage slot (right after
       the store), or the block can never mount for a visitor. (Whether
       the section then renders tiers is the tiers read's business —
       an empty club hides by design; a missing block is a defect.) */
    const { status, json } = await call("GET", "/creator-profiles/owner-creator/layout");
    expect(status).toBe(200);
    expect(json.isDefault).toBe(true);
    const types = json.layout.map((b: any) => b.type);
    const at = types.indexOf("memberships");
    expect(at).toBeGreaterThan(-1);
    expect(types[at - 1]).toBe("store");
    const memberships = json.layout.find((b: any) => b.type === "memberships");
    expect(memberships.visible).toBe(true);
    expect(memberships.title).toBe("Memberships");
  });

  it("a profile with no saved sections gets the Grand Stage order over its starter sections", async () => {
    const { json } = await call("GET", "/creator-profiles/me/layout", { user: FAN_USER });
    expect(json.layout.map((b: any) => b.type)).toEqual([
      "hero", "spotlight", "court", "tracks", "videos", "store", "memberships",
      "merch", "events", "bio", "shoutwall", "topcreators",
      "achievements", "links",
    ]);
  });

  it("the registry carries The Front Row and the memberships block — and no Royal Court name", async () => {
    const { json } = await call("GET", "/creator-profiles/me/layout", { user: OWNER_USER });
    const court = json.blockTypes.find((b: any) => b.type === "court");
    expect(court.label).toBe("The Front Row");
    expect(json.blockTypes.map((b: any) => b.type)).toContain("memberships");
    expect(JSON.stringify(json.blockTypes)).not.toContain("Royal Court");
    expect(JSON.stringify(json.layout)).not.toContain("Royal Court");
  });

  it("a saved layout can carry the memberships block", async () => {
    const layout = [
      { type: "hero", title: "Featured", visible: true },
      { type: "memberships", title: "Memberships", visible: true },
      { type: "court", title: "The Front Row", visible: true },
    ];
    const put = await call("PUT", "/creator-profiles/me/layout", { user: OWNER_USER, body: { layout } });
    expect(put.status).toBe(200);
    expect(put.json.layout.map((b: any) => b.type)).toEqual(["hero", "memberships", "court"]);
  });

  it("saves a valid layout and reads it back (public view hides hidden blocks)", async () => {
    const layout = [
      { type: "hero", title: "Featured", visible: true },
      { type: "store", title: "The Shop", visible: true },
      { type: "tracks", title: "Music", visible: false, config: { note: "new drops" } },
    ];
    const put = await call("PUT", "/creator-profiles/me/layout", { user: OWNER_USER, body: { layout } });
    expect(put.status).toBe(200);
    expect(put.json.isDefault).toBe(false);
    expect(put.json.layout.map((b: any) => b.type)).toEqual(["hero", "store", "tracks"]);

    const pub = await call("GET", "/creator-profiles/owner-creator/layout");
    expect(pub.status).toBe(200);
    expect(pub.json.layout.map((b: any) => b.type)).toEqual(["hero", "store"]);
  });

  it("rejects unknown types, duplicates, oversize layouts, and code-bearing config", async () => {
    const unknown = await call("PUT", "/creator-profiles/me/layout", {
      user: OWNER_USER, body: { layout: [{ type: "rawhtml", title: "x", visible: true }] },
    });
    expect(unknown.status).toBe(400);
    expect(unknown.json.error).toBe("UNKNOWN_BLOCK_TYPE");

    const dup = await call("PUT", "/creator-profiles/me/layout", {
      user: OWNER_USER, body: { layout: [{ type: "hero" }, { type: "hero" }] },
    });
    expect(dup.status).toBe(400);
    expect(dup.json.error).toBe("DUPLICATE_BLOCK");

    const nested = await call("PUT", "/creator-profiles/me/layout", {
      user: OWNER_USER, body: { layout: [{ type: "hero", config: { html: { nested: "<script>" } } }] },
    });
    expect(nested.status).toBe(400);
    expect(nested.json.error).toBe("INVALID_BLOCK_CONFIG");

    const scriptString = await call("PUT", "/creator-profiles/me/layout", {
      user: OWNER_USER, body: { layout: [{ type: "hero", config: { code: "x".repeat(500) } }] },
    });
    expect(scriptString.status).toBe(400);
    expect(scriptString.json.error).toBe("INVALID_BLOCK_CONFIG");
  });

  it("requires auth and an existing profile", async () => {
    expect((await call("GET", "/creator-profiles/me/layout")).status).toBe(401);
    expect((await call("GET", "/creator-profiles/me/layout", { user: NO_PROFILE_USER })).status).toBe(404);
  });
});

describe("#3 theme settings", () => {
  it("reads current settings + the registries", async () => {
    const { status, json } = await call("GET", "/creator-profiles/me/theme-settings", { user: OWNER_USER });
    expect(status).toBe(200);
    expect(json.colorway).toBe("midnight-gold");
    expect(json.headingFont).toBe("Cinzel");
    expect(json.colorways.map((c: any) => c.id)).toContain("velvet-lounge");
    expect(json.fonts).toContain("Bebas Neue");
  });

  it("an unpicked look reads back as honest nulls, never invented picks", async () => {
    /* The fan seed is the untouched-default row (themeId "gold-lux",
       theme_config {}): no colorway key matches and no fonts were ever
       stored, so the DTO says null for all three picks — the editor
       must be able to tell "never picked" apart from a real pick. */
    const { status, json } = await call("GET", "/creator-profiles/me/theme-settings", { user: FAN_USER });
    expect(status).toBe(200);
    expect(json.colorway).toBeNull();
    expect(json.headingFont).toBeNull();
    expect(json.bodyFont).toBeNull();
    expect(json.colorways.map((c: any) => c.id)).toContain("royal-gold");
    expect(json.fonts).toContain("Inter");
  });

  it("a custom legacy look keeps its fonts and reports no registry colorway", async () => {
    /* The long-standing setup editor writes themeId "custom" the moment
       a creator tweaks one color or font. That look is real and saved —
       it just isn't one of the registry colorways, so colorway reads
       null while the stored fonts read through. */
    const row = h.state.profilesById.get(FAN_PROFILE)!;
    row["themeId"] = "custom";
    row["themeConfig"] = {
      themeId: "custom",
      colors: { primary: "#123456" },
      fonts: { heading: "Bebas Neue", body: "Inter" },
    };
    const { status, json } = await call("GET", "/creator-profiles/me/theme-settings", { user: FAN_USER });
    expect(status).toBe(200);
    expect(json.colorway).toBeNull();
    expect(json.headingFont).toBe("Bebas Neue");
    expect(json.bodyFont).toBe("Inter");
  });

  it("Royal Gold — the house theme — leads the colorway registry", async () => {
    const { json } = await call("GET", "/creator-profiles/me/theme-settings", { user: OWNER_USER });
    expect(json.colorways[0].id).toBe("royal-gold");
    expect(json.colorways[0].name).toBe("Royal Gold");
    const put = await call("PUT", "/creator-profiles/me/theme-settings", {
      user: OWNER_USER, body: { colorway: "royal-gold" },
    });
    expect(put.status).toBe(200);
    expect(put.json.colorway).toBe("royal-gold");
  });

  it("resolves a colorway key server-side into theme_config colors", async () => {
    const put = await call("PUT", "/creator-profiles/me/theme-settings", {
      user: OWNER_USER, body: { colorway: "velvet-lounge", headingFont: "DM Serif Display" },
    });
    expect(put.status).toBe(200);
    expect(put.json.colorway).toBe("velvet-lounge");
    expect(put.json.headingFont).toBe("DM Serif Display");
    const row = h.state.profilesById.get(OWNER_PROFILE)!;
    const cfg = row["themeConfig"] as Record<string, any>;
    expect(cfg.colors.primary).toBe("#d4a24e"); // velvet-lounge, resolved server-side
    expect(row["themeId"]).toBe("velvet-lounge");
  });

  it("saving one pick from an unpicked look leaves the other picks alone", async () => {
    /* The editor's exact round trip: it loads the settings (nulls for
       an unpicked look — pinned above) and sends the whole state back
       on Save. A null field is "no pick", not a value: the save must
       apply the one real change and leave the rest untouched instead
       of 400ing on the nulls its own GET handed out. */
    const put = await call("PUT", "/creator-profiles/me/theme-settings", {
      user: FAN_USER,
      body: { colorway: null, headingFont: "Space Grotesk", bodyFont: null },
    });
    expect(put.status).toBe(200);
    expect(put.json.headingFont).toBe("Space Grotesk");
    expect(put.json.colorway).toBeNull();
    expect(put.json.bodyFont).toBeNull();
    const row = h.state.profilesById.get(FAN_PROFILE)!;
    const cfg = row["themeConfig"] as Record<string, any>;
    expect(cfg.fonts.heading).toBe("Space Grotesk");
    expect(cfg.fonts.body).toBeUndefined();
    expect(row["themeId"]).toBe("gold-lux"); // untouched — no colorway was picked

    /* And the mirror image: picking a colorway next must not demand
       the fonts be re-sent as strings either. */
    const put2 = await call("PUT", "/creator-profiles/me/theme-settings", {
      user: FAN_USER,
      body: { colorway: "royal-gold", headingFont: null, bodyFont: null },
    });
    expect(put2.status).toBe(200);
    expect(put2.json.colorway).toBe("royal-gold");
    expect(put2.json.headingFont).toBe("Space Grotesk"); // the earlier pick survives
  });

  it("a save carrying no picks at all is refused, and nulls don't smuggle bad keys", async () => {
    const empty = await call("PUT", "/creator-profiles/me/theme-settings", {
      user: FAN_USER,
      body: { colorway: null, headingFont: null, bodyFont: null },
    });
    expect(empty.status).toBe(400);
    expect(empty.json.error).toBe("INVALID_THEME_SETTINGS");
    const bad = await call("PUT", "/creator-profiles/me/theme-settings", {
      user: FAN_USER,
      body: { colorway: "neon-glow", headingFont: null },
    });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("UNKNOWN_COLORWAY");
  });

  it("rejects unknown colorways and fonts — keys only, never raw CSS", async () => {
    const badColor = await call("PUT", "/creator-profiles/me/theme-settings", {
      user: OWNER_USER, body: { colorway: "#ff0000" },
    });
    expect(badColor.status).toBe(400);
    expect(badColor.json.error).toBe("UNKNOWN_COLORWAY");
    const badFont = await call("PUT", "/creator-profiles/me/theme-settings", {
      user: OWNER_USER, body: { bodyFont: "Comic Sans MS" },
    });
    expect(badFont.status).toBe(400);
    expect(badFont.json.error).toBe("UNKNOWN_FONT");
  });
});

describe("#4 store catalog", () => {
  it("assembles tracks + products at exactly the underlying prices", async () => {
    const { status, json } = await call("GET", "/creator-profiles/owner-creator/store-catalog");
    expect(status).toBe(200);
    expect(json.counts).toEqual({ tracks: 1, videos: 0, products: 1, total: 2 });
    const track = json.items.find((i: any) => i.kind === "track");
    expect(track).toMatchObject({ id: TRACK_ID, priceCents: 499, price: "$4.99", buyUrl: `/store/buy/track/${TRACK_ID}` });
    const product = json.items.find((i: any) => i.kind === "product");
    expect(product).toMatchObject({ id: PRODUCT_ID, productKind: "merch", priceCents: 4500, compareAtCents: 6000 });
    // The free video (download price 0) is not sellable — not in the catalog.
    expect(json.items.find((i: any) => i.id === VIDEO_ID)).toBeUndefined();
  });

  it("404s for an unknown slug", async () => {
    expect((await call("GET", "/creator-profiles/nope/store-catalog")).status).toBe(404);
  });
});

describe("#5 spotlight pin", () => {
  it("pins the owner's own published track and serves it publicly", async () => {
    const put = await call("PUT", "/creator-profiles/me/spotlight", {
      user: OWNER_USER, body: { kind: "track", itemId: TRACK_ID },
    });
    expect(put.status).toBe(200);
    expect(put.json.pin).toMatchObject({ kind: "track", itemId: TRACK_ID, title: "Golden Hour", mediaUrl: "https://cdn.example/track.mp3" });

    const pub = await call("GET", "/creator-profiles/owner-creator/spotlight");
    expect(pub.status).toBe(200);
    expect(pub.json.pin.itemId).toBe(TRACK_ID);
  });

  it("rejects pinning someone else's content and unpublished content", async () => {
    const others = await call("PUT", "/creator-profiles/me/spotlight", {
      user: OWNER_USER, body: { kind: "track", itemId: OTHER_TRACK },
    });
    expect(others.status).toBe(400);
    expect(others.json.error).toBe("PIN_NOT_YOURS");

    const draft = await call("PUT", "/creator-profiles/me/spotlight", {
      user: OWNER_USER, body: { kind: "track", itemId: TRACK_UNPUBLISHED },
    });
    expect(draft.status).toBe(400);
    expect(draft.json.error).toBe("PIN_NOT_PUBLIC");
  });

  it("clears the pin; an unpublished pinned item hides publicly", async () => {
    await call("PUT", "/creator-profiles/me/spotlight", { user: OWNER_USER, body: { kind: "track", itemId: TRACK_ID } });
    h.state.tracksById.get(TRACK_ID)!["isPublished"] = false;
    const hidden = await call("GET", "/creator-profiles/owner-creator/spotlight");
    expect(hidden.json.pin).toBeNull();

    const cleared = await call("PUT", "/creator-profiles/me/spotlight", { user: OWNER_USER, body: { kind: null } });
    expect(cleared.status).toBe(200);
    expect(cleared.json.pin).toBeNull();
    expect(h.state.profilesById.get(OWNER_PROFILE)!["pinnedKind"]).toBeNull();
  });
});

describe("#6 fan collections", () => {
  it("shows a fan's completed purchases with creator links, newest first", async () => {
    const { status, json } = await call("GET", "/collections/fan-person");
    expect(status).toBe(200);
    expect(json.isPrivate).toBe(false);
    expect(json.fan.slug).toBe("fan-person");
    expect(json.items.map((i: any) => i.kind)).toEqual(["product", "track"]);
    expect(json.items[0]).toMatchObject({ title: "Gold Tee", creatorSlug: "owner-creator", creatorUrl: "/artist/owner-creator", amountCents: 4500 });
    expect(json.items[1]).toMatchObject({ title: "Golden Hour", amountCents: 499 });
    // The pending order never shows.
    expect(json.items.find((i: any) => i.title.includes("pending"))).toBeUndefined();
  });

  it("a private collection leaks nothing — honest private state only", async () => {
    h.state.profilesById.get(FAN_PROFILE)!["collectionVisibility"] = "private";
    const { status, json } = await call("GET", "/collections/fan-person");
    expect(status).toBe(200);
    expect(json.isPrivate).toBe(true);
    expect(json.items).toEqual([]);
    expect(JSON.stringify(json)).not.toContain("Golden Hour");
  });

  it("the owner always sees their own collection + can flip visibility", async () => {
    const mine = await call("GET", "/collections/me", { user: FAN_USER });
    expect(mine.status).toBe(200);
    expect(mine.json.items.length).toBe(2);

    const flip = await call("PUT", "/collections/me/visibility", { user: FAN_USER, body: { visibility: "private" } });
    expect(flip.status).toBe(200);
    expect(flip.json.visibility).toBe("private");
    const pub = await call("GET", "/collections/fan-person");
    expect(pub.json.isPrivate).toBe(true);

    const bad = await call("PUT", "/collections/me/visibility", { user: FAN_USER, body: { visibility: "friends" } });
    expect(bad.status).toBe(400);
  });

  it("404s a collection for an unknown fan slug", async () => {
    expect((await call("GET", "/collections/nope")).status).toBe(404);
  });
});
