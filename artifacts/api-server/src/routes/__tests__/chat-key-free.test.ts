/**
 * chat-key — /api/chat FREE mode (the default), unchanged.
 *
 * Standing ruling: /api/chat carries NO separate charge —
 * CHAT_CREDIT_COST defaults to 0. The chat-key lane (owner ruling,
 * Nov 10, 2026) keyed only the env-enabled paid branch, entirely
 * inside its cost > 0 condition. This suite pins that the free path
 * is exactly the old one: same response shape, a fresh model call
 * per request (no replay machinery), and ZERO interaction with the
 * credits ledger or the stored-results rail.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => {
  process.env.CHAT_CREDIT_COST = "0";
  return {
    providerCalls: 0,
    chargeCalls: 0,
    refundCalls: 0,
    keyBuildCalls: 0,
    voidCalls: 0,
    findCalls: 0,
    storeCalls: 0,
  };
});

const MODEL_REPLY = "All good, fin-friend.";

vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error { readonly code = "OUT_OF_CREDITS"; }
  class LedgerWriteError extends Error { readonly code = "LEDGER_WRITE"; }
  return {
    OutOfCreditsError,
    LedgerWriteError,
    chargeCredits: async () => { h.chargeCalls++; return 0; },
    refundCredits: async () => { h.refundCalls++; return 0; },
    buildChargeIdempotencyKey: () => { h.keyBuildCalls++; return "unused-free-key"; },
    voidChargeIdempotencyKey: async () => { h.voidCalls++; return true; },
  };
});

vi.mock("../../lib/generation-stored-results", () => ({
  findStoredGenerationResult: async () => { h.findCalls++; return null; },
  storeGenerationResult: async () => { h.storeCalls++; },
}));

vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "test-model",
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => {
          h.providerCalls++;
          return { choices: [{ message: { content: MODEL_REPLY } }] };
        },
      },
    },
  }),
}));

/* Guest resolution with no session — the free path's maybeAuth. */
vi.mock("../../lib/optional-auth", () => ({
  resolveOptionalSession: async () => {},
}));

/* The operator protocol has its own suites — here it sits in its
   no-pending-action / no-intent / no-marker state. */
vi.mock("../../lib/operator-chat", () => ({
  buildReplyDoors: () => [],
  processOperatorPreTurn: async () => null,
  processOperatorIntentTurn: async () => null,
  processOperatorReply: async () => null,
}));

vi.mock("../../lib/rate-limit", () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return {
    publicApiLimiter: pass,
    generationLimiter: pass,
    freeAiLimiter: pass,
    chatVoiceTranscribeLimiter: pass,
    freeExpensiveAiLimiter: pass,
    reportWriteLimiter: pass,
    apiKeyLimiter: pass,
    apiKeyGenerationLimiter: pass,
    isWorldStaticAssetPath: () => false,
    skipWorldStaticAssets: () => false,
  };
});

vi.mock("../../lib/logger", () => ({
  logger: { info() {}, error() {}, warn() {}, debug() {} },
}));

import chatRouter from "../chat";

let server: any;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", chatRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  h.providerCalls = 0;
  h.chargeCalls = 0; h.refundCalls = 0; h.keyBuildCalls = 0; h.voidCalls = 0;
  h.findCalls = 0; h.storeCalls = 0;
});

async function postChat(body: Record<string, unknown>) {
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

describe("POST /api/chat — free mode is byte-for-byte the old path (chat-key)", () => {
  it("answers with the unchanged shape and never touches the money modules", async () => {
    const res = await postChat({ message: "How do I grow my channel?" });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ reply: MODEL_REPLY, model: "test-model", creditCost: 0 });
    expect(h.providerCalls).toBe(1);
    expect(h.chargeCalls).toBe(0);
    expect(h.refundCalls).toBe(0);
    expect(h.keyBuildCalls).toBe(0);
    expect(h.voidCalls).toBe(0);
    expect(h.findCalls).toBe(0);
    expect(h.storeCalls).toBe(0);
  });

  it("an identical repeat generates fresh — no replay machinery in free mode", async () => {
    const body = { message: "Same question again?" };
    const first = await postChat(body);
    const second = await postChat(body);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.json).toEqual({ reply: MODEL_REPLY, model: "test-model", creditCost: 0 });
    expect(second.json.replayed).toBeUndefined();
    expect(h.providerCalls).toBe(2);
    expect(h.chargeCalls).toBe(0);
    expect(h.findCalls).toBe(0);
    expect(h.storeCalls).toBe(0);
  });

  it("GET /chat/status still reports the free rail", async () => {
    const res = await fetch(`${base}/api/chat/status`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ creditCost: 0 });
  });
});
