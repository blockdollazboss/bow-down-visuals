/**
 * Charge-path tests for the AI Auto-Grade endpoint
 * (POST /api/pro-tools/auto-grade).
 *
 * The real Express router runs against an ephemeral server with auth,
 * the credits ledger, and the OpenAI client mocked; the money path is
 * exercised end to end. The price under test: PRO_TOOLS_AI_CREDITS
 * defaults to 100 VB since the owner's Oct 22, 2026 ruling — the
 * original default of 1 was a pre-x100 leftover. Covers:
 *  - the constant itself resolves to the ruled 100
 *  - a successful run debits exactly 100 and reports creditsUsed 100
 *  - a balance of exactly 100 is enough and ends at zero
 *  - a balance under 100 is refused (402) before any charge
 *  - a provider failure refunds the full 100 debit
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const testState = vi.hoisted(() => ({
  userId: "user-1",
  userCredits: 1000,
  chargeCalls: [] as Array<{ userId: string; amount: number }>,
  refundCalls: [] as Array<{ userId: string; amount: number }>,
  modelPayload: "",
  modelThrows: false,
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
        create: vi.fn(async () => {
          if (testState.modelThrows) throw new Error("provider exploded");
          return { choices: [{ message: { content: testState.modelPayload } }] };
        }),
      },
    },
  }),
}));

vi.mock("../../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../../lib/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

import router, { PRO_TOOLS_AI_CREDITS } from "../pro-tools-ai";

let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/pro-tools/auto-grade`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const VALID_CORRECTION =
  '{"brightness":10,"contrast":20,"saturation":-15,"temperature":30,"tint":0,"highlights":5,"shadows":-5,"vibrance":25,"exposure":8}';

beforeEach(() => {
  testState.userId = "user-1";
  testState.userCredits = 1000;
  testState.chargeCalls = [];
  testState.refundCalls = [];
  testState.modelPayload = VALID_CORRECTION;
  testState.modelThrows = false;
});

async function postAutoGrade() {
  return fetch(baseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ look: "warm cinematic" }),
  });
}

describe("AI Auto-Grade charge path", () => {
  it("the price constant resolves to the ruled 100 VB", () => {
    expect(PRO_TOOLS_AI_CREDITS).toBe(100);
  });

  it("a successful run debits exactly 100 VB", async () => {
    const res = await postAutoGrade();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.creditsUsed).toBe(100);
    expect(body.creditsRemaining).toBe(900);
    expect(body.correction.brightness).toBe(10);
    expect(testState.chargeCalls).toEqual([{ userId: "user-1", amount: 100 }]);
    expect(testState.refundCalls).toEqual([]);
    expect(testState.userCredits).toBe(900);
  });

  it("a balance of exactly 100 VB is enough and ends at zero", async () => {
    testState.userCredits = 100;
    const res = await postAutoGrade();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.creditsUsed).toBe(100);
    expect(body.creditsRemaining).toBe(0);
    expect(testState.chargeCalls).toEqual([{ userId: "user-1", amount: 100 }]);
  });

  it("a balance under 100 VB is refused with 402 before any charge", async () => {
    testState.userCredits = 99;
    const res = await postAutoGrade();
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe("out_of_credits");
    expect(testState.chargeCalls).toEqual([]);
    expect(testState.userCredits).toBe(99);
  });

  it("a provider failure refunds the full 100 VB debit", async () => {
    testState.modelThrows = true;
    const res = await postAutoGrade();
    expect(res.status).toBe(502);
    expect(testState.chargeCalls).toEqual([{ userId: "user-1", amount: 100 }]);
    expect(testState.refundCalls).toEqual([{ userId: "user-1", amount: 100 }]);
    expect(testState.userCredits).toBe(1000);
  });
});
