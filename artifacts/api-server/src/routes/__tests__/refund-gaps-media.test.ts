/**
 * D5 refund-gap pins — the two image-delivery gaps (G5, G8).
 *
 * G5 (logo premium): the charge landed, then the storage upload AND
 * its one retry both threw — the route answered 500 claiming "no
 * credits were charged" while the member WAS charged 200 VB.
 * G8 (stream-pack): the charge landed after generation, then the
 * storage upload threw — 500, charge stood, no asset delivered.
 * Both now refund the exact charged amount before answering, and the
 * error copy matches reality.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  charges: [] as Array<{ amount: number; action?: string }>,
  refunds: [] as Array<{ amount: number; action?: string }>,
  uploadMode: "ok" as "ok" | "throw" | "throw-once",
  uploadCalls: 0,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "user-1";
    req.userCredits = 100_000;
    next();
  },
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async (_u: string, amount: number, meta: any) => {
    h.charges.push({ amount, action: meta?.action });
    return 4242;
  }),
  chargeCreditsAtomic: vi.fn(async (_u: string, amount: number, meta: any) => {
    h.charges.push({ amount, action: meta?.action });
    return 4242;
  }),
  refundCredits: vi.fn(async (_u: string, amount: number, meta: any) => {
    h.refunds.push({ amount, action: meta?.action });
  }),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => ({
    images: { generate: async () => ({ data: [{ b64_json: "aGVsbG8=" }] }) },
    chat: { completions: { create: async () => ({ choices: [{ message: { content: "{}" } }] }) } },
  }),
  getTextModel: () => "test-model",
}));

vi.mock("../../lib/objectStorage", () => ({
  uploadPublicMediaToR2: vi.fn(async () => {
    h.uploadCalls += 1;
    if (h.uploadMode === "throw") throw new Error("storage down");
    if (h.uploadMode === "throw-once" && h.uploadCalls === 1) throw new Error("storage down once");
    return "https://cdn.example/logo.png";
  }),
  uploadMediaToSupabaseStorage: vi.fn(async () => {
    h.uploadCalls += 1;
    if (h.uploadMode === "throw") throw new Error("storage down");
    return "stream-packs/test/ref.png";
  }),
  refreshSupabaseStorageUrl: async (ref: string) => `https://minted.test/${ref}`,
  normalizeToStorageRef: (v: string) => v,
}));

vi.mock("../../lib/save-generation", () => ({
  saveGeneration: vi.fn(async () => {}),
}));

vi.mock("../../lib/rail-core", () => ({
  invokeRailHandler: vi.fn(async () => ({ status: 200, body: {} })),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const chain: any = {
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
  };
  return {
    ...actual,
    db: {
      select: () => ({ from: () => chain }),
      insert: () => ({ values: async () => [] }),
      update: () => ({ set: () => ({ where: async () => [] }) }),
    },
  };
});

vi.mock("@runwayml/sdk", () => ({ default: class {} }));

import logoRouter from "../generate/logo";
import streamPackRouter from "../generate/stream-pack";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  });
  app.use(logoRouter);
  app.use(streamPackRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  h.charges = [];
  h.refunds = [];
  h.uploadMode = "ok";
  h.uploadCalls = 0;
  vi.clearAllMocks();
});

async function post(path: string, body: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("G5 — POST /generate-logo (premium) upload failure refunds the 200 VB charge", () => {
  it("refunds exactly once when the upload and its retry both throw — and the copy stops lying", async () => {
    h.uploadMode = "throw";
    const r = await post("/generate-logo", { brandName: "Nova Records", style: "luxury-gold", model: "premium" });
    expect(r.status).toBe(500);
    expect(r.json.error).not.toMatch(/no credits were charged/i);
    expect(r.json.error).toMatch(/refunded/);
    expect(h.uploadCalls).toBe(2); // original attempt + the one retry
    expect(h.charges).toEqual([{ amount: 200, action: "Logo (Premium)" }]);
    expect(h.refunds).toEqual([
      { amount: 200, action: "Logo (Premium) — Refund (delivery failed)" },
    ]);
  });

  it("delivers without a refund when the retry upload lands", async () => {
    h.uploadMode = "throw-once";
    const r = await post("/generate-logo", { brandName: "Nova Records", style: "luxury-gold", model: "premium" });
    expect(r.status).toBe(200);
    expect(h.charges).toHaveLength(1);
    expect(h.refunds).toEqual([]);
  });
});

describe("G8 — POST /stream-pack/generate upload failure refunds the 100 VB charge", () => {
  it("refunds exactly once when the storage upload throws after the charge", async () => {
    h.uploadMode = "throw";
    const r = await post("/stream-pack/generate", {
      channelName: "Nova",
      theme: "gold-luxury",
      asset: "webcam-frame",
    });
    expect(r.status).toBe(500);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);
    expect(h.refunds).toHaveLength(1);
    expect(h.refunds[0]!.amount).toBe(100);
    expect(h.refunds[0]!.action).toMatch(/Stream Pack: .* — Refund \(delivery failed\)/);
  });

  it("delivers without a refund on the happy path", async () => {
    const r = await post("/stream-pack/generate", {
      channelName: "Nova",
      theme: "gold-luxury",
      asset: "webcam-frame",
    });
    expect(r.status).toBe(200);
    expect(h.charges).toHaveLength(1);
    expect(h.refunds).toEqual([]);
  });
});
