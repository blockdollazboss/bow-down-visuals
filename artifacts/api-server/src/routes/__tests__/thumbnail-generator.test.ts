/**
 * Tests for POST /api/thumbnail-generator.
 *
 * The AI Thumbnail Generator creates 4 thumbnail variations in one batch
 * for 2 credits (GPT Image 2.5). Pricing rules enforced:
 * - a not-configured provider refuses 503 BEFORE any charge
 * - charge-before-generate (402 when short on credits)
 * - auto-refund via the ledger (refundCreditsGuaranteed) when the
 *   batch fails — never a profile-only credit with no ledger row
 * - max_completion_tokens is never used here (image-only route — asserts
 *   no max_tokens either, since image calls take no token params)
 *
 * Heavy modules (OpenAI, Supabase, auth, storage) are mocked; the real
 * Express router runs against a local ephemeral server.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const mockState = vi.hoisted(() => ({
  authedUserId: "user-1" as string | null,
  userCredits: 1000,
  deductedCredits: null as number | null,
  refundedCredits: 0,
  imageGenerateCalls: 0,
  imageEditCalls: 0,
  failOnVariation: -1, // -1 = never fail; N = throw on the Nth image call
  uploadedObjects: [] as string[],
  chargedKeys: new Set<string>(),
  chargeKeys: [] as (string | null)[],
  voids: [] as string[],
  providerNotConfigured: false,
  refundAttempts: 0,
  refundFailuresRemaining: 0,
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

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => {
    if (mockState.providerNotConfigured) {
      throw new Error("OPENAI_API_KEY is not configured — this AI feature is unavailable.");
    }
    return {
    images: {
      generate: vi.fn(async () => {
        mockState.imageGenerateCalls++;
        if (mockState.imageGenerateCalls === mockState.failOnVariation) {
          throw new Error("OpenAI image generation failed");
        }
        return { data: [{ b64_json: "aW1hZ2UtYnl0ZXM=" }] };
      }),
      edit: vi.fn(async () => {
        mockState.imageEditCalls++;
        if (mockState.imageEditCalls === mockState.failOnVariation) {
          throw new Error("OpenAI image edit failed");
        }
        return { data: [{ b64_json: "aW1hZ2UtYnl0ZXM=" }] };
      }),
    },
    };
  },
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },

}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      update: () => ({
        eq: vi.fn(async () => {
          mockState.deductedCredits = 200;
          mockState.userCredits -= 200;
          return { data: null, error: null };
        }),
      }),
    }),
  }),
  addCreditsToProfile: vi.fn(async (_userId: string, amount: number) => {
    mockState.refundedCredits += amount;
    mockState.userCredits += amount;
    return { oldCredits: 0, newCredits: 0, created: false };
  }),
}));

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(async (objectName: string) => {
    mockState.uploadedObjects.push(objectName);
    return `storage-ref:${objectName}`;
  }),
  refreshSupabaseStorageUrl: vi.fn(async (ref: string) => `https://signed.example/${ref}`),
  normalizeToStorageRef: vi.fn((u: string) => u),
}));

vi.mock("../../lib/payment-record", () => ({
  recordCreditUsage: vi.fn(async () => undefined),
  recordThumbnailHistory: vi.fn(async () => undefined),
}));

vi.mock("../../lib/credits", () => {
  /* P0-23: the route charges up front via chargeCredits (strict ledger),
     not the old Supabase profile update. Simulate the deduction against
     mockState so the balance assertions below keep their meaning.
     CA-KEY: the mock now mirrors the real ledger's idempotency —
     a charge carrying an already-seen key is a replay (no second
     deduction), and voiding a key makes its retry charge fresh.
     Charge-on-failure lane: refundCreditsGuaranteed mirrors the real
     helper — a refund attempt can be made to fail
     (refundFailuresRemaining), the helper retries exactly once, and
     the key is voided ONLY when a refund landed. */
  const attemptRefund = async (_userId: string, amount: number) => {
    mockState.refundAttempts++;
    if (mockState.refundFailuresRemaining > 0) {
      mockState.refundFailuresRemaining--;
      throw new Error("simulated refund failure");
    }
    mockState.refundedCredits += amount;
    mockState.userCredits += amount;
  };
  const voidKey = async (key: string) => {
    mockState.voids.push(key);
    return mockState.chargedKeys.delete(key);
  };
  return {
  chargeCredits: vi.fn(async (_userId: string, amount: number, _rec?: unknown, opts?: { idempotencyKey?: string | null }) => {
    const key = opts?.idempotencyKey ?? null;
    mockState.chargeKeys.push(key);
    if (key && mockState.chargedKeys.has(key)) return mockState.userCredits;
    mockState.deductedCredits = amount;
    mockState.userCredits -= amount;
    if (key) mockState.chargedKeys.add(key);
    return mockState.userCredits;
  }),
  buildChargeIdempotencyKey: (scope: string, userId: string, clientKey: unknown, intent: unknown) =>
    typeof clientKey === "string" && clientKey.trim().length >= 8
      ? `${scope}:${userId}:client:${clientKey.trim()}`
      : `${scope}:${userId}:${JSON.stringify(intent)}`,
  voidChargeIdempotencyKey: vi.fn(voidKey),
  refundCredits: vi.fn(attemptRefund),
  refundCreditsGuaranteed: vi.fn(async (userId: string, amount: number, _rec?: unknown, opts?: { idempotencyKey?: string | null }) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await attemptRefund(userId, amount);
        if (opts?.idempotencyKey) await voidKey(opts.idempotencyKey);
        return true;
      } catch { /* the real helper retries exactly once, loudly */ }
    }
    return false;
  }),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
  };
});

import router, { __resetThumbnailReplayCache } from "../generate/thumbnail-generator";

let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  mockState.authedUserId = "user-1";
  mockState.userCredits = 1000;
  mockState.deductedCredits = null;
  mockState.refundedCredits = 0;
  mockState.imageGenerateCalls = 0;
  mockState.imageEditCalls = 0;
  mockState.failOnVariation = -1;
  mockState.uploadedObjects = [];
  mockState.chargedKeys = new Set();
  mockState.chargeKeys = [];
  mockState.voids = [];
  mockState.providerNotConfigured = false;
  mockState.refundAttempts = 0;
  mockState.refundFailuresRemaining = 0;
  __resetThumbnailReplayCache();
});

async function postBatch(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl}/api/thumbnail-generator`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

describe("POST /api/thumbnail-generator", () => {
  it("generates 4 variations for 200 Visual Bucs", async () => {
    const { status, json } = await postBatch({
      prompt: "Shark king on a golden throne, dramatic lighting",
      stylePreset: "luxury",
      aspectRatio: "16:9",
      overlayText: "BOW DOWN",
    });
    expect(status).toBe(200);
    expect(json.images).toHaveLength(4);
    expect(json.images[0]).toHaveProperty("url");
    expect(json.images[0]).toHaveProperty("variation", 1);
    expect(json.images[3]).toHaveProperty("variation", 4);
    expect(json.creditsUsed).toBe(200);
    expect(json.creditsRemaining).toBe(800);
    expect(mockState.deductedCredits).toBe(200);
    expect(mockState.imageGenerateCalls).toBe(4);
    expect(mockState.uploadedObjects).toHaveLength(4);
  });

  it("defaults to 16:9 when aspect ratio is missing", async () => {
    const { status, json } = await postBatch({ prompt: "Epic gaming setup" });
    expect(status).toBe(200);
    expect(json.aspectRatio).toBe("16:9");
    expect(json.images).toHaveLength(4);
  });

  it("accepts 9:16 for Shorts/TikTok", async () => {
    const { status, json } = await postBatch({
      prompt: "Vlog thumbnail beach day",
      stylePreset: "vlog",
      aspectRatio: "9:16",
    });
    expect(status).toBe(200);
    expect(json.aspectRatio).toBe("9:16");
    expect(json.images).toHaveLength(4);
  });

  it("rejects a missing prompt with 400", async () => {
    const { status, json } = await postBatch({ prompt: "" });
    expect(status).toBe(400);
    // Zod validation contract: generic top-level error, with the
    // field-level detail (which names the prompt) in `details`.
    expect(json.error).toBe("Invalid thumbnail request.");
    expect(JSON.stringify(json.details)).toMatch(/prompt/i);
    expect(mockState.deductedCredits).toBeNull();
  });

  it("rejects a too-short prompt with 400", async () => {
    const { status } = await postBatch({ prompt: "ab" });
    expect(status).toBe(400);
    expect(mockState.deductedCredits).toBeNull();
  });

  it("returns 402 when out of credits (no charge)", async () => {
    mockState.userCredits = 1;
    const { status, json } = await postBatch({ prompt: "Something cool" });
    expect(status).toBe(402);
    expect(json.error).toBe("out_of_credits");
    expect(mockState.deductedCredits).toBeNull();
    expect(mockState.imageGenerateCalls).toBe(0);
  });

  it("returns 401 when unauthenticated", async () => {
    mockState.authedUserId = null;
    const { status } = await postBatch({ prompt: "Something cool" });
    expect(status).toBe(401);
  });

  it("auto-refunds credits when generation fails mid-batch", async () => {
    mockState.failOnVariation = 2; // second image call throws
    const { status, json } = await postBatch({ prompt: "Something cool" });
    expect(status).toBe(500);
    expect(json.creditsRefunded).toBe(true);
    expect(mockState.refundedCredits).toBe(200);
    // Credits were deducted (1000 -> 800) then refunded (800 -> 1000)
    expect(mockState.userCredits).toBe(1000);
  });

  it("uses GPT Image 2.5 (never gpt-image-1) for generation", async () => {
    // The route source must reference the 2.5 model, not the old gpt-image-1.
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      new URL("../generate/thumbnail-generator.ts", import.meta.url),
      "utf8",
    );
    expect(src).toMatch(/gpt-image-2\.5/);
    expect(src).not.toMatch(/model:\s*["']gpt-image-1["']/);
  });

  it("never uses max_tokens (image route takes no token params)", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      new URL("../generate/thumbnail-generator.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toMatch(/max_tokens/);
    expect(src).not.toMatch(/max_completion_tokens/);
  });

  it("exposes all six style presets", async () => {
    const { STYLE_PRESETS } = await import("../generate/thumbnail-generator");
    expect(Object.keys(STYLE_PRESETS).sort()).toEqual(
      ["before-after", "bold-text-pop", "gaming", "luxury", "shocked-face", "vlog"].sort(),
    );
  });
});

describe("POST /api/thumbnail-generator — CA-KEY idempotency", () => {
  it("a no-key request charges exactly once across a replay; the replay serves the stored batch with the honest note", async () => {
    const body = {
      prompt: "Shark king on a golden throne, dramatic lighting",
      stylePreset: "luxury",
      aspectRatio: "16:9",
      overlayText: "BOW DOWN",
    };
    const first = await postBatch(body);
    expect(first.status).toBe(200);
    expect(first.json.replayed).toBeUndefined();
    expect(mockState.userCredits).toBe(800);

    const second = await postBatch(body);
    expect(second.status).toBe(200);
    /* One charge, one generation run — the replay is served stored. */
    expect(mockState.userCredits).toBe(800);
    expect(mockState.imageGenerateCalls).toBe(4);
    expect(second.json.replayed).toBe(true);
    expect(String(second.json.replayNote)).toMatch(/already made/);
    expect(second.json.images).toEqual(first.json.images);
    /* The charge carried a REAL server-derived key, never null. */
    expect(mockState.chargeKeys).toHaveLength(1);
    expect(mockState.chargeKeys[0]).toMatch(/^thumbnail-generator:user-1:/);
  });

  it("a client key is honored (wrapped), and its replay charges once", async () => {
    const body = { prompt: "Epic gaming setup", idempotencyKey: "thumb-attempt-1" };
    const first = await postBatch(body);
    expect(first.status).toBe(200);
    const second = await postBatch(body);
    expect(second.status).toBe(200);
    expect(second.json.replayed).toBe(true);
    expect(mockState.userCredits).toBe(800);
    expect(mockState.imageGenerateCalls).toBe(4);
    expect(mockState.chargeKeys).toEqual(["thumbnail-generator:user-1:client:thumb-attempt-1"]);
  });

  it("a refunded batch VOIDS its key, so the retry charges fresh instead of generating free", async () => {
    mockState.failOnVariation = 2;
    const failed = await postBatch({ prompt: "Something cool" });
    expect(failed.status).toBe(500);
    expect(mockState.refundedCredits).toBe(200);
    expect(mockState.voids).toHaveLength(1);
    expect(mockState.voids[0]).toMatch(/^thumbnail-generator:user-1:/);
    expect(mockState.userCredits).toBe(1000);

    mockState.failOnVariation = -1;
    const retry = await postBatch({ prompt: "Something cool" });
    expect(retry.status).toBe(200);
    expect(retry.json.replayed).toBeUndefined();
    expect(mockState.userCredits).toBe(800); // the retry paid again
  });
});

describe("POST /api/thumbnail-generator — charge-on-failure pins", () => {
  it("a not-configured provider refuses 503 BEFORE any charge (the Nov 11 probe path)", async () => {
    mockState.providerNotConfigured = true;
    const { status, json } = await postBatch({ prompt: "Something cool" });
    expect(status).toBe(503);
    expect(json.error).toMatch(/OPENAI_API_KEY is not configured/);
    expect(mockState.deductedCredits).toBeNull();
    expect(mockState.chargeKeys).toHaveLength(0);
    expect(mockState.imageGenerateCalls).toBe(0);
    expect(mockState.userCredits).toBe(1000);
  });

  it("a refund that fails once still zeroes the charge via the guaranteed retry", async () => {
    mockState.failOnVariation = 2;
    mockState.refundFailuresRemaining = 1; // the first refund attempt throws
    const { status, json } = await postBatch({ prompt: "Something cool" });
    expect(status).toBe(500);
    expect(json.creditsRefunded).toBe(true);
    expect(mockState.refundAttempts).toBe(2); // retried exactly once
    expect(mockState.refundedCredits).toBe(200);
    expect(mockState.userCredits).toBe(1000); // zero net charge
    expect(mockState.voids).toHaveLength(1); // voided because the refund landed
  });

  it("a refund that cannot land is reported honestly, the key stays landed, and the retry re-runs against the standing charge", async () => {
    mockState.failOnVariation = 2;
    mockState.refundFailuresRemaining = 99; // every refund attempt throws
    const failed = await postBatch({ prompt: "Something cool" });
    expect(failed.status).toBe(500);
    expect(failed.json.creditsRefunded).toBe(false); // no false claim
    expect(mockState.userCredits).toBe(800); // the charge honestly stands
    expect(mockState.voids).toHaveLength(0); // never void an unrefunded key

    mockState.refundFailuresRemaining = 0;
    mockState.failOnVariation = -1;
    const retry = await postBatch({ prompt: "Something cool" });
    expect(retry.status).toBe(200);
    expect(retry.json.replayed).toBeUndefined();
    /* No second deduction: the retry ran against the standing charge. */
    expect(mockState.userCredits).toBe(800);
    expect(mockState.chargeKeys).toHaveLength(2);
    expect(mockState.chargeKeys[0]).toBe(mockState.chargeKeys[1]);
  });
});
