/**
 * Tests for POST /api/comment-replies (AI Comment Reply Assistant).
 *
 * Heavy modules (auth, credits ledger, OpenAI) are mocked; the real
 * Express router runs against a local ephemeral server. Covers:
 *  - schema validation (empty body, too many comments, bad tone)
 *  - 402 out_of_credits when the balance is short
 *  - happy path: 1 credit charged, replies returned 1:1 with comments
 *  - provider failure: credit refunded, 502 returned
 *  - incomplete model output: credit refunded, 502 returned
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const testState = vi.hoisted(() => ({
  userId: "user-1",
  userCredits: 10,
  chargeCalls: [] as Array<{ userId: string; amount: number }>,
  refundCalls: [] as Array<{ userId: string; amount: number }>,
  modelPayload: { replies: ["Love you back! What's your favorite track?"] },
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

import router from "../generate/comment-replies";

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
  testState.modelPayload = { replies: ["Love you back! What's your favorite track?"] };
  testState.modelThrows = false;
  testState.lastCompletionArgs = null;
  vi.clearAllMocks();
});

async function post(body: unknown) {
  const r = await realFetch(`${baseUrl}/comment-replies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

describe("POST /api/comment-replies", () => {
  it("rejects an empty body with 400", async () => {
    const { status, json } = await post({});
    expect(status).toBe(400);
    expect(json.error).toMatch(/invalid/i);
  });

  it("rejects more than 10 comments with 400", async () => {
    const { status } = await post({
      comments: Array.from({ length: 11 }, (_, i) => `comment ${i}`),
      tone: "hype",
    });
    expect(status).toBe(400);
  });

  it("rejects an unknown tone with 400", async () => {
    const { status } = await post({ comments: ["hi"], tone: "sarcastic" });
    expect(status).toBe(400);
  });

  it("returns 402 out_of_credits when the balance is short — and charges nothing", async () => {
    testState.userCredits = 0;
    const { status, json } = await post({ comments: ["love this"], tone: "grateful" });
    expect(status).toBe(402);
    expect(json.error).toBe("out_of_credits");
    expect(testState.chargeCalls).toHaveLength(0);
  });

  it("happy path: charges 1 credit and returns one reply per comment", async () => {
    testState.modelPayload = {
      replies: ["Reply one — what's your favorite part?", "Reply two — thanks for riding with me!"],
    };
    const { status, json } = await post({
      comments: ["this song is fire", "when's the next drop"],
      tone: "hype",
      voiceNotes: "I say let's get it",
    });
    expect(status).toBe(200);
    expect(json.replies).toHaveLength(2);
    expect(json.creditsUsed).toBe(1);
    expect(json.creditsRemaining).toBe(9);
    expect(testState.chargeCalls).toEqual([{ userId: "user-1", amount: 1 }]);
    expect(testState.refundCalls).toHaveLength(0);
  });

  it("uses max_completion_tokens (GPT-6 rejects max_tokens)", async () => {
    await post({ comments: ["nice"], tone: "playful" });
    const args = testState.lastCompletionArgs;
    expect(args).toBeTruthy();
    expect(args.max_completion_tokens).toBeGreaterThan(0);
    expect("max_tokens" in args).toBe(false);
  });

  it("sends the tone direction and voice notes to the model", async () => {
    await post({ comments: ["nice"], tone: "grateful", voiceNotes: "I call fans the wave" });
    const system = testState.lastCompletionArgs.messages[0].content as string;
    expect(system).toMatch(/grateful/i);
    expect(system).toContain("the wave");
  });

  it("refunds the credit and returns 502 when the provider fails", async () => {
    testState.modelThrows = true;
    const { status, json } = await post({ comments: ["love this"], tone: "hype" });
    expect(status).toBe(502);
    expect(json.error).toBeTruthy();
    expect(testState.chargeCalls).toHaveLength(1);
    expect(testState.refundCalls).toEqual([{ userId: "user-1", amount: 1 }]);
    expect(testState.userCredits).toBe(10); // charged then refunded
  });

  it("refunds the credit when the model returns an incomplete reply set", async () => {
    testState.modelPayload = { replies: ["only one reply"] } as any;
    const { status } = await post({
      comments: ["comment one", "comment two", "comment three"],
      tone: "professional",
    });
    expect(status).toBe(502);
    expect(testState.refundCalls).toHaveLength(1);
    expect(testState.userCredits).toBe(10);
  });

  it("trims whitespace-only lines server-side via schema (empty comment rejected)", async () => {
    const { status } = await post({ comments: [""], tone: "hype" });
    expect(status).toBe(400);
  });
});
