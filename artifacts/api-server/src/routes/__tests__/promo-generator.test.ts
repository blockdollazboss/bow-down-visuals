/**
 * Tests for POST /api/promo-generator (Promo Content Generator).
 *
 * Heavy modules (auth, credits ledger, OpenAI) are mocked; the real
 * Express router runs against a local ephemeral server. Covers:
 *  - schema validation (empty body, bad content type, bad tone, bad route)
 *  - 402 out_of_credits when the balance is short
 *  - happy path: 1 credit charged, promo copy returned
 *  - provider failure: credit refunded, 502 returned
 *  - incomplete model output: credit refunded, 502 returned
 *  - the model is called with max_completion_tokens (never max_tokens)
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const testState = vi.hoisted(() => ({
  userId: "user-1",
  userCredits: 10,
  chargeCalls: [] as Array<{ userId: string; amount: number }>,
  refundCalls: [] as Array<{ userId: string; amount: number }>,
  modelPayload: {
    title: "Your hooks are about to hit different.",
    body: "Hook Studio writes your first 3 seconds for you.",
    extras: ["Stop the scroll in 3 seconds flat."],
    hashtags: ["contentcreator", "musicmarketing"],
    cta: "Try Hook Studio now",
  },
  modelThrows: false,
  lastCompletionArgs: null as any,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = testState.userId;
    req.userCredits = testState.userCredits;
    next();
  },
}));

vi.mock("../../lib/credits", () => ({
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  chargeCredits: vi.fn(async (userId: string, amount: number) => {
    testState.chargeCalls.push({ userId, amount });
    testState.userCredits -= amount;
    return testState.userCredits;
  }),
  refundCredits: vi.fn(async (userId: string, amount: number) => {
    testState.refundCalls.push({ userId, amount });
    testState.userCredits += amount;
  }),
}));

vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "gpt-6-sol",
  getOpenAI: () => ({
    chat: {
      completions: {
        create: vi.fn(async (args: any) => {
          testState.lastCompletionArgs = args;
          if (testState.modelThrows) {
            throw new Error("provider exploded");
          }
          return {
            choices: [{ message: { content: JSON.stringify(testState.modelPayload) } }],
          };
        }),
      },
    },
  }),
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

import router from "../generate/promo-generator";

let server: any;
let baseUrl: string;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  testState.userId = "user-1";
  testState.userCredits = 10;
  testState.chargeCalls = [];
  testState.refundCalls = [];
  testState.modelPayload = {
    title: "Your hooks are about to hit different.",
    body: "Hook Studio writes your first 3 seconds for you.",
    extras: ["Stop the scroll in 3 seconds flat."],
    hashtags: ["contentcreator", "musicmarketing"],
    cta: "Try Hook Studio now",
  };
  testState.modelThrows = false;
  testState.lastCompletionArgs = null;
  vi.clearAllMocks();
});

const validBody = {
  featureName: "Hook Studio",
  featureTagline: "First-3-second hooks that stop the scroll",
  featureRoute: "/hooks",
  contentType: "twitter",
  tone: "hype",
};

async function post(body: unknown) {
  const r = await realFetch(`${baseUrl}/promo-generator`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("POST /api/promo-generator", () => {
  it("rejects an empty body with 400", async () => {
    const { status, json } = await post({});
    expect(status).toBe(400);
    expect(json.error).toMatch(/invalid/i);
  });

  it("rejects an unknown content type with 400", async () => {
    const { status } = await post({ ...validBody, contentType: "billboard" });
    expect(status).toBe(400);
  });

  it("rejects an unknown tone with 400", async () => {
    const { status } = await post({ ...validBody, tone: "sarcastic" });
    expect(status).toBe(400);
  });

  it("rejects a non-site feature route with 400", async () => {
    const { status } = await post({ ...validBody, featureRoute: "https://evil.example/x" });
    expect(status).toBe(400);
  });

  it("returns 402 out_of_credits when the balance is short — and charges nothing", async () => {
    testState.userCredits = 0;
    const { status, json } = await post(validBody);
    expect(status).toBe(402);
    expect(json.error).toBe("out_of_credits");
    expect(testState.chargeCalls).toHaveLength(0);
  });

  it("happy path: charges 1 credit and returns promo copy", async () => {
    const { status, json } = await post(validBody);
    expect(status).toBe(200);
    expect(testState.chargeCalls).toHaveLength(1);
    expect(testState.chargeCalls[0]).toEqual({ userId: "user-1", amount: 1 });
    expect(json.title).toBe("Your hooks are about to hit different.");
    expect(json.body).toContain("Hook Studio");
    expect(json.extras).toHaveLength(1);
    expect(json.hashtags).toContain("contentcreator");
    expect(json.cta).toBe("Try Hook Studio now");
    expect(json.creditsUsed).toBe(1);
    expect(json.creditsRemaining).toBe(9);
    expect(testState.refundCalls).toHaveLength(0);
  });

  it("uses max_completion_tokens (never max_tokens) with the centralized text model", async () => {
    await post(validBody);
    expect(testState.lastCompletionArgs.model).toBe("gpt-6-sol");
    expect(testState.lastCompletionArgs.max_completion_tokens).toBeGreaterThan(0);
    expect(testState.lastCompletionArgs).not.toHaveProperty("max_tokens");
  });

  it("refunds the credit and returns 502 when the provider fails", async () => {
    testState.modelThrows = true;
    const { status } = await post(validBody);
    expect(status).toBe(502);
    expect(testState.chargeCalls).toHaveLength(1);
    expect(testState.refundCalls).toHaveLength(1);
    expect(testState.refundCalls[0]).toEqual({ userId: "user-1", amount: 1 });
    expect(testState.userCredits).toBe(10);
  });

  it("refunds the credit and returns 502 when the model returns unusable output", async () => {
    testState.modelPayload = { title: "", body: "", extras: [], hashtags: [], cta: "" } as any;
    const { status } = await post(validBody);
    expect(status).toBe(502);
    expect(testState.refundCalls).toHaveLength(1);
    expect(testState.userCredits).toBe(10);
  });
});
