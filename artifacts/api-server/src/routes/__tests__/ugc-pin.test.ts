/**
 * Route tests for the UGC pin rail (Stack-4 wave 2 #7, migration 0178):
 *   POST   /api/ugc-ads/:id/pin        pin a finished ad to its product
 *   DELETE /api/ugc-ads/:id/pin        unpin
 *   + pin state on the ad DTO (GET one / list), the product picker
 *     (GET /api/ugc-ads/products), and ad deletion clearing the pin.
 *
 * Contract pinned here:
 * - Cardinality: ONE pinned ad per product (the pin is one column on
 *   the product row). Pinning a second ad to the same product replaces
 *   the first — the first ad's reads immediately show no pin.
 * - Ownership: the caller owns the ad AND the product. A foreign ad
 *   is a 404 on pin and unpin; a foreign product is a 404.
 * - Target: the product the ad was made for (shop_product_id). An
 *   explicit productId naming a DIFFERENT product is a 400; an
 *   upload ad (no shop product) needs an explicit productId and can
 *   only take one of the caller's own products.
 * - State: only a finished ad (status 'ready' with a video) pins —
 *   draft/failed ads are a 409.
 * - Deleting an ad clears any pin pointing at it.
 *
 * Driven against the REAL Express router on an ephemeral server with
 * the house _reach-fake-db and mocked auth (x-test-user), mirroring
 * ugc-ads.test.ts.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const ALICE = "00000000-0000-4000-8000-00000000a11c";
const BOB = "00000000-0000-4000-8000-00000000b0b5";
const SHOP = "11111111-1111-4111-8111-111111111111";
const PRODUCT_A = "22222222-2222-4222-8222-222222222222";
const PRODUCT_B = "33333333-3333-4333-8333-333333333333";
const BOB_PRODUCT = "44444444-4444-4444-8444-444444444444";

const h = vi.hoisted(() => ({ fake: null as any }));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = String(user);
    req.userCredits = Number(req.headers["x-test-credits"] ?? 10000);
    req.log = { info: () => {}, error: () => {}, warn: () => {} };
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
  generationLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error {}
  return {
    OutOfCreditsError,
    LedgerWriteError: class LedgerWriteError extends Error {},
    chargeCredits: vi.fn(async () => 9600),
    refundCredits: vi.fn(async () => {}),
    buildChargeIdempotencyKey: () => "test-key",
  };
});

vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "test-model",
  getOpenAI: () => ({
    chat: { completions: { create: async () => ({ choices: [{ message: { content: "{}" } }] }) } },
    images: { generate: async () => ({ data: [{ b64_json: Buffer.from("x").toString("base64") }] }) },
  }),
}));

vi.mock("../../lib/objectStorage", () => ({
  SUPABASE_CLIPS_BUCKET: "generated-clips",
  normalizeToStorageRef: (v: string | null | undefined) => v ?? null,
  refreshSupabaseStorageUrl: async (v: string) => {
    const m = /^supabase:\/\/generated-clips\/(.+)$/.exec(v);
    return m ? `https://signed.example/${m[1]}` : v;
  },
  uploadPublicMediaToR2: async (_bucket: string, path: string) => `https://r2.test/${path}`,
  uploadFileStreamToSupabaseStorage: async (_bucket: string, path: string) => `supabase://generated-clips/${path}`,
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: string) => v,
}));

vi.mock("../../lib/brand-record", () => ({
  readBrandKit: async () => null,
}));

vi.mock("@runwayml/sdk", () => {
  class FakeRunway {
    imageToVideo = { create: async () => ({ id: "task-img" }) };
    textToVideo = { create: async () => ({ id: "task-txt" }) };
    tasks = { retrieve: async () => ({ status: "SUCCEEDED", output: ["https://runway.test/out.mp4"] }) };
  }
  return { default: FakeRunway };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { createFakeDb } = await import("./_reach-fake-db");
  const fake = createFakeDb({
    ugcAds: actual.ugcAdsTable,
    ugcBriefs: actual.ugcBriefsTable,
    shopProducts: actual.shopProductsTable,
    generatedClips: actual.generatedClipsTable,
  });
  h.fake = fake;
  return { ...actual, db: fake.db };
});

import ugcAdsRouter from "../ugc-ads";
import { db, shopProductsTable, ugcAdsTable } from "@workspace/db";

let server: ReturnType<typeof express.application.listen>;
let base = "";
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", ugcAdsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.fake.clear();
});

async function call(
  method: string,
  path: string,
  opts: { user?: string; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const res = await realFetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.user ? { "x-test-user": opts.user } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function seedProduct(id: string, userId: string, name: string) {
  const [row] = await db
    .insert(shopProductsTable)
    .values({
      id,
      shop_id: SHOP,
      user_id: userId,
      name,
      price_cents: 4900,
      image_url: null,
    })
    .returning();
  return row!;
}

async function seedAd(userId: string, over: Record<string, unknown> = {}) {
  const [row] = await db
    .insert(ugcAdsTable)
    .values({
      userId,
      productSource: "shop",
      shopProductId: PRODUCT_A,
      productName: "Gold Chain Tee",
      style: "honest-review",
      faceKind: "none",
      status: "ready",
      videoRef: "supabase://generated-clips/ugc-ads/ad.mp4",
      captions: [],
      ...over,
    } as never)
    .returning();
  return row!;
}

describe("POST /api/ugc-ads/:id/pin", () => {
  it("pins a finished ad to its product and every ad read shows it", async () => {
    await seedProduct(PRODUCT_A, ALICE, "Gold Chain Tee");
    const ad = await seedAd(ALICE);

    const r = await call("POST", `/api/ugc-ads/${ad.id}/pin`, { user: ALICE, body: {} });
    expect(r.status).toBe(200);
    expect(r.json.ad.pinnedProductId).toBe(PRODUCT_A);
    expect(r.json.product).toMatchObject({ id: PRODUCT_A, pinnedAdId: ad.id });

    const one = await call("GET", `/api/ugc-ads/${ad.id}`, { user: ALICE });
    expect(one.json.ad.pinnedProductId).toBe(PRODUCT_A);
    expect(one.json.ad.videoUrl).toBe("https://signed.example/ugc-ads/ad.mp4");

    const list = await call("GET", "/api/ugc-ads", { user: ALICE });
    expect(list.json.ads[0].pinnedProductId).toBe(PRODUCT_A);

    const picker = await call("GET", "/api/ugc-ads/products", { user: ALICE });
    expect(picker.json.products[0].pinnedAdId).toBe(ad.id);
  });

  it("a second pin to the same product replaces the first, on both ads' reads", async () => {
    await seedProduct(PRODUCT_A, ALICE, "Gold Chain Tee");
    const first = await seedAd(ALICE);
    const second = await seedAd(ALICE, { videoRef: "supabase://generated-clips/ugc-ads/ad2.mp4" });

    await call("POST", `/api/ugc-ads/${first.id}/pin`, { user: ALICE, body: {} });
    const r = await call("POST", `/api/ugc-ads/${second.id}/pin`, { user: ALICE, body: {} });
    expect(r.status).toBe(200);

    const firstRead = await call("GET", `/api/ugc-ads/${first.id}`, { user: ALICE });
    expect(firstRead.json.ad.pinnedProductId).toBeNull();
    const secondRead = await call("GET", `/api/ugc-ads/${second.id}`, { user: ALICE });
    expect(secondRead.json.ad.pinnedProductId).toBe(PRODUCT_A);
    const picker = await call("GET", "/api/ugc-ads/products", { user: ALICE });
    expect(picker.json.products[0].pinnedAdId).toBe(second.id);
  });

  it("refuses a foreign ad (404), a foreign product (404), and a stranger (401)", async () => {
    await seedProduct(PRODUCT_A, ALICE, "Gold Chain Tee");
    await seedProduct(BOB_PRODUCT, BOB, "Bob's Boots");
    const ad = await seedAd(ALICE);

    const foreignAd = await call("POST", `/api/ugc-ads/${ad.id}/pin`, { user: BOB, body: {} });
    expect(foreignAd.status).toBe(404);

    const uploadAd = await seedAd(ALICE, { productSource: "upload", shopProductId: null });
    const foreignProduct = await call("POST", `/api/ugc-ads/${uploadAd.id}/pin`, {
      user: ALICE,
      body: { productId: BOB_PRODUCT },
    });
    expect(foreignProduct.status).toBe(404);

    const anon = await call("POST", `/api/ugc-ads/${ad.id}/pin`, { body: {} });
    expect(anon.status).toBe(401);
  });

  it("an ad pins only to the product it advertises (400 on a different own product)", async () => {
    await seedProduct(PRODUCT_A, ALICE, "Gold Chain Tee");
    await seedProduct(PRODUCT_B, ALICE, "Silver Cap");
    const ad = await seedAd(ALICE);
    const r = await call("POST", `/api/ugc-ads/${ad.id}/pin`, {
      user: ALICE,
      body: { productId: PRODUCT_B },
    });
    expect(r.status).toBe(400);
  });

  it("an upload ad needs an explicit target (400 without one) and takes an own product with one", async () => {
    await seedProduct(PRODUCT_A, ALICE, "Gold Chain Tee");
    const ad = await seedAd(ALICE, { productSource: "upload", shopProductId: null });
    const noTarget = await call("POST", `/api/ugc-ads/${ad.id}/pin`, { user: ALICE, body: {} });
    expect(noTarget.status).toBe(400);
    const withTarget = await call("POST", `/api/ugc-ads/${ad.id}/pin`, {
      user: ALICE,
      body: { productId: PRODUCT_A },
    });
    expect(withTarget.status).toBe(200);
    expect(withTarget.json.ad.pinnedProductId).toBe(PRODUCT_A);
  });

  it("only a finished ad pins — draft and failed are 409", async () => {
    await seedProduct(PRODUCT_A, ALICE, "Gold Chain Tee");
    const draft = await seedAd(ALICE, { status: "draft", videoRef: null });
    const failed = await seedAd(ALICE, { status: "failed", videoRef: null });
    expect((await call("POST", `/api/ugc-ads/${draft.id}/pin`, { user: ALICE, body: {} })).status).toBe(409);
    expect((await call("POST", `/api/ugc-ads/${failed.id}/pin`, { user: ALICE, body: {} })).status).toBe(409);
  });

  it("a malformed productId is a 400 and a missing ad is a 404", async () => {
    const ad = await seedAd(ALICE);
    const bad = await call("POST", `/api/ugc-ads/${ad.id}/pin`, {
      user: ALICE,
      body: { productId: "not-a-uuid" },
    });
    expect(bad.status).toBe(400);
    const missing = await call("POST", "/api/ugc-ads/99999999-9999-4999-8999-999999999999/pin", {
      user: ALICE,
      body: {},
    });
    expect(missing.status).toBe(404);
  });
});

describe("DELETE /api/ugc-ads/:id/pin", () => {
  it("unpin clears the ad's read and the product's picker state", async () => {
    await seedProduct(PRODUCT_A, ALICE, "Gold Chain Tee");
    const ad = await seedAd(ALICE);
    await call("POST", `/api/ugc-ads/${ad.id}/pin`, { user: ALICE, body: {} });

    const r = await call("DELETE", `/api/ugc-ads/${ad.id}/pin`, { user: ALICE });
    expect(r.status).toBe(200);
    expect(r.json.ad.pinnedProductId).toBeNull();

    const one = await call("GET", `/api/ugc-ads/${ad.id}`, { user: ALICE });
    expect(one.json.ad.pinnedProductId).toBeNull();
    const picker = await call("GET", "/api/ugc-ads/products", { user: ALICE });
    expect(picker.json.products[0].pinnedAdId).toBeNull();
  });

  it("a foreign unpin is a 404 and the pin survives it", async () => {
    await seedProduct(PRODUCT_A, ALICE, "Gold Chain Tee");
    const ad = await seedAd(ALICE);
    await call("POST", `/api/ugc-ads/${ad.id}/pin`, { user: ALICE, body: {} });

    const r = await call("DELETE", `/api/ugc-ads/${ad.id}/pin`, { user: BOB });
    expect(r.status).toBe(404);
    const one = await call("GET", `/api/ugc-ads/${ad.id}`, { user: ALICE });
    expect(one.json.ad.pinnedProductId).toBe(PRODUCT_A);
  });
});

describe("DELETE /api/ugc-ads/:id — the pin goes with the ad", () => {
  it("deleting a pinned ad clears the product's pin", async () => {
    await seedProduct(PRODUCT_A, ALICE, "Gold Chain Tee");
    const ad = await seedAd(ALICE);
    await call("POST", `/api/ugc-ads/${ad.id}/pin`, { user: ALICE, body: {} });

    const del = await call("DELETE", `/api/ugc-ads/${ad.id}`, { user: ALICE });
    expect(del.status).toBe(200);
    const picker = await call("GET", "/api/ugc-ads/products", { user: ALICE });
    expect(picker.json.products[0].pinnedAdId).toBeNull();
  });
});
