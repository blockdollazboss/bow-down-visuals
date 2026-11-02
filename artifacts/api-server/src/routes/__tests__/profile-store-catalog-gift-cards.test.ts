/**
 * Store-catalog gift-card denominations (stack1200 world-parity
 * leftovers) — GET /api/creator-profiles/:slug/store-catalog.
 *
 * Contract pinned here: a kind='gift_card' store product's catalog
 * item carries the seller-set `giftCardDenominationsCents` — the
 * gift-card checkout rail refuses any amount not on that list, so
 * without it an in-World surface could list the card but never
 * offer its purchase (the room's Buy button dead-ended on the
 * product rail's GIFT_CARD_CHECKOUT refusal). Every other item
 * carries null. Harness mirrors profile-store-catalog.test.ts
 * (_reach-fake-db).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const OWNER = "11111111-1111-4111-8111-111111111111";
const PROFILE = "33333333-3333-4333-8333-333333333333";
const TRACK = "44444444-4444-4444-8444-444444444444";
const GIFT = "a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1";
const GIFT_NO_DENOMS = "a2a2a2a2-a2a2-42a2-82a2-a2a2a2a2a2a2";
const PRODUCT = "66666666-6666-4666-8666-666666666666";

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
  h.fake.seed("profileTracks", [
    {
      id: TRACK, profileId: PROFILE, title: "Golden Hour", artworkUrl: null,
      downloadPriceCents: 499, pwywEnabled: false, pwywMinCents: 0, playCount: 10, isPublished: true,
    },
  ]);
  h.fake.seed("storeProducts", [
    {
      id: GIFT, profileId: PROFILE, kind: "gift_card", title: "Gift Card",
      mediaUrls: [], priceCents: 1000, compareAtCents: null,
      giftCardDenominationsCents: [1000, 2500, 5000],
      isActive: true, createdAt: new Date(),
    },
    {
      id: GIFT_NO_DENOMS, profileId: PROFILE, kind: "gift_card", title: "Gift Card (unset)",
      mediaUrls: [], priceCents: 1000, compareAtCents: null,
      giftCardDenominationsCents: null,
      isActive: true, createdAt: new Date(),
    },
    {
      id: PRODUCT, profileId: PROFILE, kind: "merch", title: "Gold Tee",
      mediaUrls: [], priceCents: 4500, compareAtCents: null,
      isActive: true, createdAt: new Date(),
    },
  ]);
});

async function get(path: string) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

describe("GET /creator-profiles/:slug/store-catalog — gift-card denominations", () => {
  it("a gift-card item carries the seller's denominations; every other item carries null", async () => {
    const r = await get("/creator-profiles/owner-creator/store-catalog");
    expect(r.status).toBe(200);
    const byId = new Map(r.body.items.map((i: any) => [i.id, i]));

    const gift = byId.get(GIFT);
    expect(gift).toMatchObject({ kind: "product", productKind: "gift_card" });
    expect(gift.giftCardDenominationsCents).toEqual([1000, 2500, 5000]);

    /* A gift card whose seller never set amounts stays unbuyable — null, not an invented list. */
    expect(byId.get(GIFT_NO_DENOMS).giftCardDenominationsCents).toBeNull();
    expect(byId.get(PRODUCT).giftCardDenominationsCents).toBeNull();
    expect(byId.get(TRACK).giftCardDenominationsCents).toBeNull();
  });
});
