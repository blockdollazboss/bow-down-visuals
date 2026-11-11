/**
 * Tests for POST /api/photo-backdrop — charge-on-failure lane pins.
 *
 * The composed Background Studio flow charges twice: Background
 * Removal (prep, 200 VB) then the AI backdrop (100 VB). The Nov 11
 * $0 probe stranded the prep charge when the backdrop leg failed.
 * Pins:
 * - a provider failure refunds the backdrop charge through the
 *   guaranteed path and reports it honestly;
 * - with a prepChargeKey naming THIS member's removal charge, the
 *   same failure also unwinds the prep charge — at the amount the
 *   LEDGER recorded, never a guessed constant;
 * - a prep key from any other scope/member is ignored;
 * - an already-unwound prep key (lookup finds nothing) skips quietly;
 * - the not-configured gate still refuses 503 before any charge.
 *
 * Heavy modules are mocked; the real Express router runs against a
 * local ephemeral server (the thumbnail-generator harness shape).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const mockState = vi.hoisted(() => ({
  authedUserId: "user-1" as string | null,
  userCredits: 1000,
  charges: [] as Array<{ amount: number; key: string | null }>,
  guaranteedRefunds: [] as Array<{ amount: number; action: string; key: string | null }>,
  chargeByKey: new Map<string, { creditsUsed: number; teamId: string | null }>(),
  geminiStatus: 200,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!mockState.authedUserId) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    req.userId = mockState.authedUserId;
    req.userCredits = mockState.userCredits;
    req.log = { info: () => {}, error: () => {} };
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  generationLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/r2-client", () => ({
  r2Upload: vi.fn(async (path: string) => `https://r2.example/${path}`),
}));

vi.mock("../../lib/generation-stored-results", () => ({
  findStoredGenerationResult: vi.fn(async () => null),
  storeGenerationResult: vi.fn(async () => undefined),
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async (_userId: string, amount: number, _rec?: unknown, opts?: { idempotencyKey?: string | null }) => {
    mockState.charges.push({ amount, key: opts?.idempotencyKey ?? null });
    mockState.userCredits -= amount;
    return mockState.userCredits;
  }),
  buildChargeIdempotencyKey: (scope: string, userId: string, clientKey: unknown, intent: unknown) =>
    typeof clientKey === "string" && clientKey.trim().length >= 8
      ? `${scope}:${userId}:client:${clientKey.trim()}`
      : `${scope}:${userId}:${JSON.stringify(intent)}`,
  refundCreditsGuaranteed: vi.fn(async (_userId: string, amount: number, rec: { action: string }, opts?: { idempotencyKey?: string | null }) => {
    mockState.guaranteedRefunds.push({ amount, action: rec.action, key: opts?.idempotencyKey ?? null });
    mockState.userCredits += amount;
    return true;
  }),
  findChargeAmountByKey: vi.fn(async (key: string) => mockState.chargeByKey.get(key) ?? null),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
}));

import router from "../generate/photo-backdrop";

let server: any;
let baseUrl: string;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  process.env["GEMINI_API_KEY"] = "test-key";
  globalThis.fetch = (async (url: any, init?: any) => {
    if (String(url).includes("generativelanguage.googleapis.com")) {
      if (mockState.geminiStatus !== 200) {
        return new Response("quota exhausted", { status: mockState.geminiStatus });
      }
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { data: "aW1hZ2U=" } }] } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return realFetch(url, init);
  }) as typeof fetch;
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  delete process.env["GEMINI_API_KEY"];
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  mockState.authedUserId = "user-1";
  mockState.userCredits = 1000;
  mockState.charges = [];
  mockState.guaranteedRefunds = [];
  mockState.chargeByKey = new Map();
  mockState.geminiStatus = 200;
});

async function postBackdrop(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/api/photo-backdrop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

const PREP_KEY = "background-removal:user-1:client:prep-abc";

describe("POST /api/photo-backdrop — charge-on-failure pins", () => {
  it("success charges 100 once and refunds nothing", async () => {
    const { status, json } = await postBackdrop({ prompt: "gold luxury studio" });
    expect(status).toBe(200);
    expect(json.status).toBe("succeeded");
    expect(mockState.charges).toHaveLength(1);
    expect(mockState.charges[0]!.amount).toBe(100);
    expect(mockState.guaranteedRefunds).toHaveLength(0);
  });

  it("a provider failure refunds its own charge through the guaranteed path", async () => {
    mockState.geminiStatus = 429;
    const { status, json } = await postBackdrop({ prompt: "gold luxury studio" });
    expect(status).toBe(500);
    expect(json.creditsRefunded).toBe(true);
    expect(json.prepCreditsRefunded).toBe(false);
    expect(mockState.guaranteedRefunds).toHaveLength(1);
    expect(mockState.guaranteedRefunds[0]!.amount).toBe(100);
    expect(mockState.userCredits).toBe(1000); // zero net charge
  });

  it("a failed composed job ALSO unwinds the prep charge at the ledger amount", async () => {
    mockState.geminiStatus = 429;
    mockState.chargeByKey.set(PREP_KEY, { creditsUsed: 200, teamId: null });
    const { status, json } = await postBackdrop({ prompt: "gold luxury studio", prepChargeKey: PREP_KEY });
    expect(status).toBe(500);
    expect(json.prepCreditsRefunded).toBe(true);
    expect(mockState.guaranteedRefunds).toHaveLength(2);
    const prep = mockState.guaranteedRefunds.find((r) => r.action === "Background Removal — Refund");
    expect(prep).toBeTruthy();
    expect(prep!.amount).toBe(200);
    expect(prep!.key).toBe(PREP_KEY);
    expect(mockState.userCredits).toBe(1200); // both charges returned (fake balance started at 1000, prep refund adds the prep amount back)
  });

  it("a prep key from another member or scope is ignored", async () => {
    mockState.geminiStatus = 429;
    const foreign = "background-removal:someone-else:client:prep-abc";
    mockState.chargeByKey.set(foreign, { creditsUsed: 200, teamId: null });
    const { status, json } = await postBackdrop({ prompt: "gold luxury studio", prepChargeKey: foreign });
    expect(status).toBe(500);
    expect(json.prepCreditsRefunded).toBe(false);
    expect(mockState.guaranteedRefunds).toHaveLength(1); // own refund only
  });

  it("an already-unwound prep key skips quietly (exactly-once)", async () => {
    mockState.geminiStatus = 429;
    const { status, json } = await postBackdrop({ prompt: "gold luxury studio", prepChargeKey: PREP_KEY });
    expect(status).toBe(500);
    expect(json.prepCreditsRefunded).toBe(false);
    expect(mockState.guaranteedRefunds).toHaveLength(1);
  });

  it("the not-configured gate refuses 503 before any charge", async () => {
    delete process.env["GEMINI_API_KEY"];
    try {
      const { status } = await postBackdrop({ prompt: "gold luxury studio" });
      expect(status).toBe(503);
      expect(mockState.charges).toHaveLength(0);
      expect(mockState.guaranteedRefunds).toHaveLength(0);
    } finally {
      process.env["GEMINI_API_KEY"] = "test-key";
    }
  });
});
