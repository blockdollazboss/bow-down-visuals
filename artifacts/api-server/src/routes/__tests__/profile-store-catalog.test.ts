/**
 * DE-13 — the profile store catalog must reach every place a creator
 * sells, and every buyUrl must land on a page that can complete the
 * sale:
 *   - priced profile tracks/videos → /store/buy/<kind>/<id> (store rail)
 *   - store_products               → /storefront/product/<id> — the
 *     public product page backed by GET /api/storefront/product/:id +
 *     POST /api/storefront/checkout. (Was /artist/<slug>#product-<id>:
 *     an anchor no component renders — a dead end on the profile's own
 *     store shelf.)
 *   - customer-shop products (/api/shops rail) → /shop/<handle>, the
 *     public storefront page. (Were absent from the union entirely.)
 *
 * Prices are copied from each rail's own price field — displayed price
 * here IS the charged price there, by construction.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const PROFILE = "33333333-3333-4333-8333-333333333333";
const TRACK = "44444444-4444-4444-8444-444444444444";
const FREE_TRACK = "45454545-4444-4444-8444-444444444444";
const VIDEO = "55555555-5555-4555-8555-555555555555";
const PRODUCT = "66666666-6666-4666-8666-666666666666";
const INACTIVE_PRODUCT = "67676767-6666-4666-8666-666666666666";
const SHOP = "77777777-7777-4777-8777-777777777777";
const SHOP_PRODUCT = "88888888-8888-4888-8888-888888888888";
const FOREIGN_SHOP_PRODUCT = "89898989-8888-4888-8888-888888888888";

const h = vi.hoisted(() => ({ fake: null as any }));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = OWNER;
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  refreshSupabaseStorageUrl: async (v: unknown) => v,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb({
    creatorProfiles: actual.creatorProfilesTable,
    profileTracks: actual.profileTracksTable,
    profileVideos: actual.profileVideosTable,
    storeProducts: actual.storeProductsTable,
    shops: actual.shopsTable,
    shopProducts: actual.shopProductsTable,
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import router from "../profile-website";

let base = "";
let server: ReturnType<express.Express["listen"]>;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => undefined, info: () => undefined, warn: () => undefined };
    next();
  });
  app.use("/api", router);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  h.fake.clear();
  h.fake.seed("creatorProfiles", [
    { id: PROFILE, userId: OWNER, slug: "owner-creator", displayName: "Owner Creator", isPublic: true },
  ]);
  h.fake.seed("profileTracks", [
    {
      id: TRACK, profileId: PROFILE, title: "Golden Hour", artworkUrl: "https://cdn.example/track.png",
      downloadPriceCents: 499, pwywEnabled: false, pwywMinCents: 0, playCount: 10, isPublished: true,
    },
    {
      id: FREE_TRACK, profileId: PROFILE, title: "Freebie", artworkUrl: null,
      downloadPriceCents: 0, pwywEnabled: false, pwywMinCents: 0, playCount: 5, isPublished: true,
    },
  ]);
  h.fake.seed("profileVideos", [
    {
      id: VIDEO, profileId: PROFILE, title: "Golden Video", thumbnailUrl: "https://cdn.example/video.png",
      downloadPriceCents: 1299, pwywEnabled: false, pwywMinCents: 0, viewCount: 3, isPublished: true,
    },
  ]);
  h.fake.seed("storeProducts", [
    {
      id: PRODUCT, profileId: PROFILE, kind: "merch", title: "Gold Tee",
      mediaUrls: ["https://cdn.example/tee.png"], priceCents: 4500, compareAtCents: 6000,
      isActive: true, createdAt: new Date(),
    },
    {
      id: INACTIVE_PRODUCT, profileId: PROFILE, kind: "digital", title: "Retired Pack",
      mediaUrls: [], priceCents: 900, compareAtCents: null, isActive: false, createdAt: new Date(),
    },
  ]);
  h.fake.seed("shops", [
    { id: SHOP, user_id: OWNER, handle: "owner-shop", name: "Owner Shop" },
  ]);
  h.fake.seed("shopProducts", [
    {
      id: SHOP_PRODUCT, shop_id: SHOP, user_id: OWNER, name: "Shark Plush",
      price_cents: 2500, image_url: "https://cdn.example/plush.png", created_at: new Date(),
      /* status is a real column since migration 0176 (default
         'active'); the catalog's buyer read filters on it, so the
         fixture must carry it like a real row. */
      status: "active",
    },
    {
      id: FOREIGN_SHOP_PRODUCT, shop_id: "99999999-9999-4999-8999-999999999999", user_id: OTHER_USER,
      name: "Not Theirs", price_cents: 100, image_url: null, created_at: new Date(),
      status: "active",
    },
  ]);
});

async function get(path: string) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

describe("GET /creator-profiles/:slug/store-catalog (DE-13)", () => {
  it("unions all three selling surfaces with buyable buyUrls", async () => {
    const r = await get("/creator-profiles/owner-creator/store-catalog");
    expect(r.status).toBe(200);
    const byId = new Map(r.body.items.map((i: any) => [i.id, i]));

    const track = byId.get(TRACK);
    expect(track).toMatchObject({ kind: "track", priceCents: 499, price: "$4.99", buyUrl: `/store/buy/track/${TRACK}` });

    const video = byId.get(VIDEO);
    expect(video).toMatchObject({ kind: "video", priceCents: 1299, buyUrl: `/store/buy/video/${VIDEO}` });

    const product = byId.get(PRODUCT);
    expect(product).toMatchObject({
      kind: "product", productKind: "merch", priceCents: 4500, compareAtCents: 6000,
      buyUrl: `/storefront/product/${PRODUCT}`,
    });

    const shopProduct = byId.get(SHOP_PRODUCT);
    expect(shopProduct).toMatchObject({
      kind: "product", productKind: "shop", title: "Shark Plush",
      priceCents: 2500, price: "$25.00", artworkUrl: "https://cdn.example/plush.png",
      buyUrl: "/shop/owner-shop",
    });

    expect(r.body.counts).toEqual({ tracks: 1, videos: 1, products: 2, total: 4 });
  });

  it("never emits the dead #product- anchor anywhere in the catalog", async () => {
    const r = await get("/creator-profiles/owner-creator/store-catalog");
    for (const item of r.body.items) {
      expect(item.buyUrl).not.toContain("#product-");
    }
  });

  it("excludes free tracks, inactive store products, and other creators' shop products", async () => {
    const r = await get("/creator-profiles/owner-creator/store-catalog");
    const ids = r.body.items.map((i: any) => i.id);
    expect(ids).not.toContain(FREE_TRACK);
    expect(ids).not.toContain(INACTIVE_PRODUCT);
    expect(ids).not.toContain(FOREIGN_SHOP_PRODUCT);
  });

  it("a creator with no customer shop still gets the store-rail catalog", async () => {
    h.fake.store("shops").rows = [];
    h.fake.store("shopProducts").rows = [];
    const r = await get("/creator-profiles/owner-creator/store-catalog");
    expect(r.status).toBe(200);
    expect(r.body.counts).toEqual({ tracks: 1, videos: 1, products: 1, total: 3 });
  });

  it("404s an unknown slug", async () => {
    const r = await get("/creator-profiles/nope/store-catalog");
    expect(r.status).toBe(404);
  });
});
