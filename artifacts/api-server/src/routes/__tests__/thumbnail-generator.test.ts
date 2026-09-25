/**
 * Tests for POST /api/thumbnail-generator.
 *
 * The AI Thumbnail Generator creates 4 thumbnail variations in one batch
 * for 2 credits (GPT Image 2.5). Pricing rules enforced:
 * - charge-before-generate (402 when short on credits)
 * - auto-refund via addCreditsToProfile when the batch fails
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
  userCredits: 10,
  deductedCredits: null as number | null,
  refundedCredits: 0,
  imageGenerateCalls: 0,
  imageEditCalls: 0,
  failOnVariation: -1, // -1 = never fail; N = throw on the Nth image call
  uploadedObjects: [] as string[],
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
  getOpenAI: () => ({
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
  }),
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      update: () => ({
        eq: vi.fn(async () => {
          mockState.deductedCredits = 2;
          mockState.userCredits -= 2;
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

import router from "../generate/thumbnail-generator";

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
  mockState.userCredits = 10;
  mockState.deductedCredits = null;
  mockState.refundedCredits = 0;
  mockState.imageGenerateCalls = 0;
  mockState.imageEditCalls = 0;
  mockState.failOnVariation = -1;
  mockState.uploadedObjects = [];
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
  it("generates 4 variations for 2 credits", async () => {
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
    expect(json.creditsUsed).toBe(2);
    expect(json.creditsRemaining).toBe(8);
    expect(mockState.deductedCredits).toBe(2);
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
    expect(json.error).toMatch(/prompt/i);
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
    expect(mockState.refundedCredits).toBe(2);
    // Credits were deducted (10 -> 8) then refunded (8 -> 10)
    expect(mockState.userCredits).toBe(10);
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
