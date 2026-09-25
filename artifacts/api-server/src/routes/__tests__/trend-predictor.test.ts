/**
 * Tests for POST /api/trend-predictor/forecast and /api/trend-predictor/ideas
 * (Trend Predictor).
 *
 * Heavy modules (auth, credits ledger, OpenAI) are mocked; the real
 * Express router runs against a local ephemeral server. Covers:
 *  - schema validation (empty body, bad platform, empty trend)
 *  - 402 out_of_credits when the balance is short — and charges nothing
 *  - happy paths: forecast charges 2 credits, ideas charge 1 credit
 *  - max_completion_tokens used (GPT-6 rejects max_tokens)
 *  - provider failure: credit refunded, 502 returned
 *  - unusable model output: credit refunded, 502 returned
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

function makeTrend(i: number) {
  return {
    trend: `Trend ${i}`,
    confidence: 60 + i,
    timeframe: "2-4 weeks",
    reasoning: `Pattern reasoning for trend ${i}`,
    earlySignals: [`signal-${i}-a`, `signal-${i}-b`],
  };
}

const testState = vi.hoisted(() => ({
  userId: "user-1",
  userCredits: 10,
  chargeCalls: [] as Array<{ userId: string; amount: number }>,
  refundCalls: [] as Array<{ userId: string; amount: number }>,
  modelPayload: {} as any,
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

import router from "../generate/trend-predictor";

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
    trends: [1, 2, 3, 4, 5].map(makeTrend),
    disclaimer: "Predictions based on pattern analysis — not guarantees.",
  };
  testState.modelThrows = false;
  testState.lastCompletionArgs = null;
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

describe("POST /api/trend-predictor/forecast", () => {
  it("rejects an empty body with 400", async () => {
    const { status, json } = await post("/trend-predictor/forecast", {});
    expect(status).toBe(400);
    expect(json.error).toMatch(/invalid/i);
  });

  it("rejects an unknown platform with 400", async () => {
    const { status } = await post("/trend-predictor/forecast", {
      niche: "Music",
      platforms: ["myspace"],
    });
    expect(status).toBe(400);
  });

  it("returns 402 out_of_credits when the balance is short — and charges nothing", async () => {
    testState.userCredits = 1;
    const { status, json } = await post("/trend-predictor/forecast", { niche: "Music" });
    expect(status).toBe(402);
    expect(json.error).toBe("out_of_credits");
    expect(testState.chargeCalls).toHaveLength(0);
  });

  it("happy path: charges 2 credits and returns 5 trends with structure", async () => {
    const { status, json } = await post("/trend-predictor/forecast", {
      niche: "Music",
      platforms: ["tiktok", "instagram"],
      audienceSize: "growing",
    });
    expect(status).toBe(200);
    expect(json.trends).toHaveLength(5);
    for (const t of json.trends) {
      expect(t.trend).toBeTruthy();
      expect(t.confidence).toBeGreaterThanOrEqual(0);
      expect(t.confidence).toBeLessThanOrEqual(100);
      expect(t.timeframe).toBeTruthy();
      expect(t.reasoning).toBeTruthy();
      expect(Array.isArray(t.earlySignals)).toBe(true);
    }
    expect(json.disclaimer).toBeTruthy();
    expect(json.creditsUsed).toBe(2);
    expect(json.creditsRemaining).toBe(8);
    expect(testState.chargeCalls).toEqual([{ userId: "user-1", amount: 2 }]);
    expect(testState.refundCalls).toHaveLength(0);
  });

  it("uses max_completion_tokens (GPT-6 rejects max_tokens)", async () => {
    await post("/trend-predictor/forecast", { niche: "Music" });
    const args = testState.lastCompletionArgs;
    expect(args).toBeTruthy();
    expect(args.max_completion_tokens).toBeGreaterThan(0);
    expect("max_tokens" in args).toBe(false);
  });

  it("sends the niche and honesty disclaimer direction to the model", async () => {
    await post("/trend-predictor/forecast", { niche: "Lo-fi beats" });
    const system = testState.lastCompletionArgs.messages[0].content as string;
    expect(system).toMatch(/not guarantees/i);
    const userMsg = testState.lastCompletionArgs.messages[1].content as string;
    expect(userMsg).toContain("Lo-fi beats");
  });

  it("refunds the credit and returns 502 when the provider fails", async () => {
    testState.modelThrows = true;
    const { status, json } = await post("/trend-predictor/forecast", { niche: "Music" });
    expect(status).toBe(502);
    expect(json.error).toBeTruthy();
    expect(testState.chargeCalls).toHaveLength(1);
    expect(testState.refundCalls).toEqual([{ userId: "user-1", amount: 2 }]);
    expect(testState.userCredits).toBe(10); // charged then refunded
  });

  it("refunds the credit when the model returns no usable trends", async () => {
    testState.modelPayload = { trends: [] };
    const { status } = await post("/trend-predictor/forecast", { niche: "Music" });
    expect(status).toBe(502);
    expect(testState.refundCalls).toHaveLength(1);
    expect(testState.userCredits).toBe(10);
  });
});

describe("POST /api/trend-predictor/ideas", () => {
  it("rejects an empty body with 400", async () => {
    const { status, json } = await post("/trend-predictor/ideas", {});
    expect(status).toBe(400);
    expect(json.error).toMatch(/invalid/i);
  });

  it("rejects a missing trend with 400", async () => {
    const { status } = await post("/trend-predictor/ideas", { niche: "Music" });
    expect(status).toBe(400);
  });

  it("returns 402 out_of_credits when the balance is short — and charges nothing", async () => {
    testState.userCredits = 0;
    const { status, json } = await post("/trend-predictor/ideas", {
      niche: "Music",
      trend: "AI duets",
    });
    expect(status).toBe(402);
    expect(json.error).toBe("out_of_credits");
    expect(testState.chargeCalls).toHaveLength(0);
  });

  it("happy path: charges 1 credit and returns 10 ideas", async () => {
    testState.modelPayload = {
      ideas: Array.from({ length: 10 }, (_, i) => `Idea ${i + 1} (Hook: first 3 seconds)`),
    };
    const { status, json } = await post("/trend-predictor/ideas", {
      niche: "Music",
      trend: "AI duets",
      trendWhy: "Duets are spiking",
    });
    expect(status).toBe(200);
    expect(json.ideas).toHaveLength(10);
    expect(json.creditsUsed).toBe(1);
    expect(json.creditsRemaining).toBe(9);
    expect(testState.chargeCalls).toEqual([{ userId: "user-1", amount: 1 }]);
    expect(testState.refundCalls).toHaveLength(0);
  });

  it("uses max_completion_tokens (GPT-6 rejects max_tokens)", async () => {
    testState.modelPayload = { ideas: ["one idea"] };
    await post("/trend-predictor/ideas", { niche: "Music", trend: "AI duets" });
    const args = testState.lastCompletionArgs;
    expect(args).toBeTruthy();
    expect(args.max_completion_tokens).toBeGreaterThan(0);
    expect("max_tokens" in args).toBe(false);
  });

  it("refunds the credit and returns 502 when the provider fails", async () => {
    testState.modelThrows = true;
    const { status } = await post("/trend-predictor/ideas", {
      niche: "Music",
      trend: "AI duets",
    });
    expect(status).toBe(502);
    expect(testState.chargeCalls).toHaveLength(1);
    expect(testState.refundCalls).toEqual([{ userId: "user-1", amount: 1 }]);
    expect(testState.userCredits).toBe(10);
  });

  it("refunds the credit when the model returns no usable ideas", async () => {
    testState.modelPayload = { ideas: [] };
    const { status } = await post("/trend-predictor/ideas", {
      niche: "Music",
      trend: "AI duets",
    });
    expect(status).toBe(502);
    expect(testState.refundCalls).toHaveLength(1);
    expect(testState.userCredits).toBe(10);
  });
});
