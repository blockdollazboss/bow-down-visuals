/**
 * Store-catalog pinned-ad tests (Stack-4 wave 2 #7, migration 0178) —
 * GET /api/creator-profiles/:slug/store-catalog (profile store).
 *
 * Contract pinned here: a shop product's catalog item carries
 * `pinnedAd: { id, videoUrl }` only while the product is 'active' and
 * the pinned ad is still 'ready' with a video (the same render rule
 * as the storefront reads). A paused product shows no ad; a pin to a
 * not-ready ad shows no ad; every other item carries pinnedAd: null.
 * videoUrl leaves buildStoreCatalog as the storage ref — the route's
 * deep refresh mints it on the way out (mocked identity here, exactly
 * like profile-store-catalog.test.ts).
 *
 * Harness mirrors profile-store-catalog.test.ts (_reach-fake-db).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const OWNER = "11111111-1111-4111-8111-111111111111";
const PROFILE = "33333333-3333-4333-8333-333333333333";
const SHOP = "77777777-7777-4777-8777-777777777777";
const SP_PINNED = "88888888-8888-4888-8888-888888888888";
const SP_PAUSED_PINNED = "89898989-8888-4888-8888-898989898989";
const SP_DRAFT_PIN = "90909090-9999-4999-8999-909090909090";
const AD_READY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const AD_DRAFT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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
    ugcAds: actual.ugcAdsTable,
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
  h.fake.seed("shops", [
    { id: SHOP, user_id: OWNER, handle: "owner-shop", name: "Owner Shop" },
  ]);
  const product = (over: Record<string, unknown>) => ({
    shop_id: SHOP,
    user_id: OWNER,
    price_cents: 2500,
    image_url: null,
    status: "active",
    pinned_ugc_ad_id: null,
    created_at: new Date(),
    ...over,
  });
  h.fake.seed("shopProducts", [
    product({ id: SP_PINNED, name: "Pinned Plush", pinned_ugc_ad_id: AD_READY }),
    product({ id: SP_PAUSED_PINNED, name: "Paused Plush", status: "paused", pinned_ugc_ad_id: AD_READY }),
    product({ id: SP_DRAFT_PIN, name: "Draft Pin Plush", pinned_ugc_ad_id: AD_DRAFT }),
  ]);
  h.fake.seed("ugcAds", [
    {
      id: AD_READY, userId: OWNER, productSource: "shop", shopProductId: SP_PINNED,
      productName: "Pinned Plush", style: "unboxing", faceKind: "none",
      status: "ready", videoRef: "supabase://generated-clips/ugc-ads/ready.mp4", captions: [],
    },
    {
      id: AD_DRAFT, userId: OWNER, productSource: "shop", shopProductId: SP_DRAFT_PIN,
      productName: "Draft Pin Plush", style: "unboxing", faceKind: "none",
      status: "draft", videoRef: null, captions: [],
    },
  ]);
});

async function get(path: string) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

describe("GET /creator-profiles/:slug/store-catalog — pinned UGC ads", () => {
  it("an active product with a ready pinned ad carries it; paused and draft pins carry none", async () => {
    const r = await get("/creator-profiles/owner-creator/store-catalog");
    expect(r.status).toBe(200);
    const byId = new Map(r.body.items.map((i: any) => [i.id, i]));

    expect(byId.get(SP_PINNED).pinnedAd).toEqual({
      id: AD_READY,
      videoUrl: "supabase://generated-clips/ugc-ads/ready.mp4",
    });
    /* The paused product still lists (its pre-existing catalog
       behavior) but its ad does NOT surface while it is unlisted
       for buyers. */
    expect(byId.get(SP_PAUSED_PINNED).pinnedAd).toBeNull();
    expect(byId.get(SP_DRAFT_PIN).pinnedAd).toBeNull();
  });
});
