/**
 * Tests for POST /api/release-checklist (AI Release Planner).
 *
 * Heavy modules (auth, credits ledger, OpenAI) are mocked; the real
 * Express router runs against a local ephemeral server. Covers:
 *  - schema validation (empty body, bad release type, missing title, past date, bad date format)
 *  - 402 out_of_credits when the balance is short — and charges nothing
 *  - happy path: 2 credits charged, week-by-week plan returned
 *  - provider failure: credit refunded, 502 returned
 *  - unusable model output: credit refunded, 502 returned
 *  - max_completion_tokens used (never max_tokens)
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const FUTURE_DATE = "2099-06-01";

const testState = vi.hoisted(() => ({
  userId: "user-1",
  userCredits: 10,
  chargeCalls: [] as Array<{ userId: string; amount: number }>,
  refundCalls: [] as Array<{ userId: string; amount: number }>,
  modelPayload: {
    weeks: [
      {
        label: "Week 1 — Foundation",
        tasks: [
          {
            title: "Upload to distributor",
            detail: "Upload the WAV + cover art to your distributor today.",
            category: "distribution",
            tool: null,
          },
          {
            title: "Draft playlist pitches",
            detail: "Write your 2-sentence pitch for independent curators.",
            category: "playlist",
            tool: "playlist-pitcher",
          },
        ],
      },
    ],
    summary: "Three weeks of prep, then release day.",
    preSaveTip: "Drop the pre-save link in your bio today.",
  } as any,
  modelThrows: false,
  lastCompletionArgs: null as any,
}));

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = testState.userId;
    req.userCredits = testState.userCredits;
    next();
  },
}));

vi.mock("../../../lib/credits", () => ({
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

vi.mock("../../../lib/ai-clients", () => ({
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

vi.mock("../../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

import router from "../release-checklist";

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
  testState.modelThrows = false;
  testState.lastCompletionArgs = null;
  vi.clearAllMocks();
});

const validBody = {
  releaseType: "single",
  title: "Bow Down Anthem",
  genre: "hip-hop",
  releaseDate: FUTURE_DATE,
};

async function post(body: unknown) {
  const r = await realFetch(`${baseUrl}/release-checklist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("POST /api/release-checklist", () => {
  it("rejects an empty body with 400", async () => {
    const { status, json } = await post({});
    expect(status).toBe(400);
    expect(json.error).toMatch(/invalid/i);
  });

  it("rejects an unknown release type with 400", async () => {
    const { status } = await post({ ...validBody, releaseType: "mixtape" });
    expect(status).toBe(400);
  });

  it("rejects a missing title with 400", async () => {
    const { status } = await post({ ...validBody, title: "" });
    expect(status).toBe(400);
  });

  it("rejects a release date in the past with 400", async () => {
    const { status } = await post({ ...validBody, releaseDate: "2020-01-01" });
    expect(status).toBe(400);
  });

  it("rejects a malformed date with 400", async () => {
    const { status } = await post({ ...validBody, releaseDate: "next friday" });
    expect(status).toBe(400);
  });

  it("returns 402 out_of_credits when the balance is short — and charges nothing", async () => {
    testState.userCredits = 1;
    const { status, json } = await post(validBody);
    expect(status).toBe(402);
    expect(json.error).toBe("out_of_credits");
    expect(testState.chargeCalls).toHaveLength(0);
  });

  it("happy path: charges 2 credits and returns a week-by-week plan", async () => {
    const { status, json } = await post(validBody);
    expect(status).toBe(200);
    expect(json.creditsUsed).toBe(2);
    expect(json.creditsRemaining).toBe(8);
    expect(json.plan.weeks).toHaveLength(1);
    expect(json.plan.weeks[0].tasks).toHaveLength(2);
    expect(json.plan.weeks[0].tasks[0].title).toBe("Upload to distributor");
    expect(json.plan.summary).toContain("release day");
    expect(testState.chargeCalls).toEqual([{ userId: "user-1", amount: 2 }]);
    expect(testState.refundCalls).toHaveLength(0);
  });

  it("uses max_completion_tokens (GPT-6 rejects max_tokens)", async () => {
    await post(validBody);
    const args = testState.lastCompletionArgs;
    expect(args).toBeTruthy();
    expect(args.max_completion_tokens).toBeGreaterThan(0);
    expect("max_tokens" in args).toBe(false);
  });

  it("sends the release type, title and date to the model", async () => {
    await post(validBody);
    const system = testState.lastCompletionArgs.messages[0].content as string;
    expect(system).toContain("single");
    expect(system).toContain("Bow Down Anthem");
    expect(system).toContain(FUTURE_DATE);
  });

  it("refunds the credits and returns 502 when the provider fails", async () => {
    testState.modelThrows = true;
    const { status, json } = await post(validBody);
    expect(status).toBe(502);
    expect(json.error).toBeTruthy();
    expect(testState.chargeCalls).toHaveLength(1);
    expect(testState.refundCalls).toEqual([{ userId: "user-1", amount: 2 }]);
    expect(testState.userCredits).toBe(10); // charged then refunded
  });

  it("refunds the credits when the model returns unusable output", async () => {
    testState.modelPayload = { weeks: [] } as any;
    const { status } = await post(validBody);
    expect(status).toBe(502);
    expect(testState.refundCalls).toHaveLength(1);
    expect(testState.userCredits).toBe(10);
  });
});
