/**
 * qcproof-ugc-pin-nocharge.test.ts — QC-200 Q161 residual pin.
 *
 * ugc-ads.test.ts already proves the money legs of the UGC ads rail:
 * persona charges exactly 100 (UGC_PERSONA_CREDIT_COST) with an
 * idempotency key and refunds in full on generation failure; video
 * charges exactly 400 (UGC_VIDEO_CREDIT_COST = GEN45_CREDIT_COST)
 * and refunds in full on provider failure. ugc-pin.test.ts proves
 * pin/unpin semantics (cardinality, ownership, state) — but its
 * credits mock was a silent stub, so "pinning is free" was never
 * actually asserted. This suite drives the REAL pin/unpin routes
 * with a COUNTING credits mock and pins:
 *
 *   - pin moves ONLY pinned_ugc_ad_id (+ updated_at) on the product
 *     row — every other product field is byte-identical after;
 *   - unpin clears only that column;
 *   - neither pin nor unpin ever calls chargeCredits or
 *     refundCredits;
 *   - the rail constants themselves: persona 100, video 400 = the
 *     gen4.5 flat rate.
 *
 * Harness mirrors ugc-pin.test.ts (house _reach-fake-db, mocked auth).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const ALICE = "00000000-0000-4000-8000-00000000a11c";
const SHOP = "11111111-1111-4111-8111-111111111111";
const PRODUCT_A = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({
  fake: null as any,
  chargeCalls: [] as Array<Record<string, unknown>>,
  refundCalls: [] as Array<Record<string, unknown>>,
}));

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
  freeAiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error {}
  return {
    OutOfCreditsError,
    LedgerWriteError: class LedgerWriteError extends Error {},
    chargeCredits: vi.fn(async (...args: unknown[]) => {
      h.chargeCalls.push({ args });
      return 9600;
    }),
    refundCredits: vi.fn(async (...args: unknown[]) => {
      h.refundCalls.push({ args });
    }),
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

import ugcAdsRouter, { UGC_PERSONA_CREDIT_COST, UGC_VIDEO_CREDIT_COST } from "../ugc-ads";
import { GEN45_CREDIT_COST } from "../generate/clip-pricing";
import { db, shopProductsTable, ugcAdsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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
  h.chargeCalls = [];
  h.refundCalls = [];
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

async function seedProduct() {
  const [row] = await db
    .insert(shopProductsTable)
    .values({
      id: PRODUCT_A,
      shop_id: SHOP,
      user_id: ALICE,
      name: "Gold Chain Tee",
      price_cents: 4900,
      image_url: null,
    })
    .returning();
  return row!;
}

async function seedAd() {
  const [row] = await db
    .insert(ugcAdsTable)
    .values({
      userId: ALICE,
      productSource: "shop",
      shopProductId: PRODUCT_A,
      productName: "Gold Chain Tee",
      style: "honest-review",
      faceKind: "none",
      status: "ready",
      videoRef: "supabase://generated-clips/ugc-ads/ad.mp4",
      captions: [],
    } as never)
    .returning();
  return row!;
}

async function productRow() {
  const [row] = await db
    .select()
    .from(shopProductsTable)
    .where(eq(shopProductsTable.id, PRODUCT_A));
  return row as unknown as Record<string, unknown>;
}

/** Every product field except the pin column and its timestamp. */
function productSansPin(row: Record<string, unknown>) {
  const { pinned_ugc_ad_id: _pin, updated_at: _ts, ...rest } = row as any;
  return rest;
}

describe("Q161 — UGC rail constants (from code)", () => {
  it("persona = 100, video = 400 = GEN45_CREDIT_COST", () => {
    expect(UGC_PERSONA_CREDIT_COST).toBe(100);
    expect(GEN45_CREDIT_COST).toBe(400);
    expect(UGC_VIDEO_CREDIT_COST).toBe(GEN45_CREDIT_COST);
    expect(UGC_VIDEO_CREDIT_COST).toBe(400);
  });
});

describe("Q161 — pin/unpin move ONLY pinned_ugc_ad_id, with NO charge call", () => {
  it("pin: only the pin column changes; charge + refund are never called", async () => {
    await seedProduct();
    const adRow = (await seedAd()) as unknown as Record<string, unknown>;
    const before = await productRow();

    const res = await call("POST", `/api/ugc-ads/${String(adRow["id"])}/pin`, {
      user: ALICE,
      body: {},
    });
    expect(res.status).toBe(200);

    const after = await productRow();
    expect(after["pinned_ugc_ad_id"]).toBe(adRow["id"]);
    expect(productSansPin(after)).toEqual(productSansPin(before));
    expect(h.chargeCalls).toHaveLength(0);
    expect(h.refundCalls).toHaveLength(0);
  });

  it("unpin: clears only the pin column; charge + refund are never called", async () => {
    await seedProduct();
    const adRow = (await seedAd()) as unknown as Record<string, unknown>;
    const adId = String(adRow["id"]);

    const pin = await call("POST", `/api/ugc-ads/${adId}/pin`, { user: ALICE, body: {} });
    expect(pin.status).toBe(200);
    const pinned = await productRow();
    expect(pinned["pinned_ugc_ad_id"]).toBe(adId);

    const unpin = await call("DELETE", `/api/ugc-ads/${adId}/pin`, { user: ALICE });
    expect(unpin.status).toBe(200);

    const after = await productRow();
    expect(after["pinned_ugc_ad_id"]).toBeNull();
    expect(productSansPin(after)).toEqual(productSansPin(pinned));
    expect(h.chargeCalls).toHaveLength(0);
    expect(h.refundCalls).toHaveLength(0);
  });
});
