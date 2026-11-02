/**
 * qcproof-chatspeak-status.test.ts — QC-200 Q162 residual pin.
 *
 * chat-speak.test.ts already proves the charged legs behaviourally:
 * exactly 100 VB once on success, an idempotent replay never
 * double-charges, a provider failure refunds in full (net zero) and
 * voids the key so a retry succeeds, and insufficient balance → 402
 * with no charge and no provider call. The one leg it asserted only
 * by response body is the STATUS leg's freeness: GET /chat/speak/
 * status must move no money at all — no charge, no refund, no
 * provider call, balance byte-identical — in both the uncast and the
 * cast (ready) states, while reporting { ready, creditCost: 100 }.
 *
 * Harness mirrors chat-speak.test.ts: real router, credits faked in
 * memory with production idempotency semantics, provider faked
 * through global fetch.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const state = vi.hoisted(() => ({
  balance: 1000,
  charges: [] as { amount: number; key: string }[],
  refunds: [] as number[],
  providerCalls: 0,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (
    req: { userId?: string; userCredits?: number },
    _res: unknown,
    next: () => void,
  ) => {
    req.userId = "user-1";
    req.userCredits = state.balance;
    next();
  },
}));

vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error { readonly code = "OUT_OF_CREDITS"; }
  class LedgerWriteError extends Error { readonly code = "LEDGER_WRITE"; }
  return {
    OutOfCreditsError,
    LedgerWriteError,
    buildChargeIdempotencyKey: (
      scope: string,
      userId: string,
      clientKey: unknown,
      intent: unknown,
    ) =>
      typeof clientKey === "string" && clientKey.trim().length >= 8
        ? `${scope}:${userId}:client:${clientKey.trim()}`
        : `${scope}:${userId}:${JSON.stringify(intent)}`,
    chargeCredits: async (_userId: string, cost: number, _rec: unknown, opts?: { idempotencyKey?: string }) => {
      state.balance -= cost;
      state.charges.push({ amount: cost, key: opts?.idempotencyKey ?? "" });
      return state.balance;
    },
    refundCredits: async (_userId: string, amount: number) => {
      state.balance += amount;
      state.refunds.push(amount);
      return state.balance;
    },
    voidChargeIdempotencyKey: async () => true,
  };
});

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: async (fileName: string) => `https://storage.example/${fileName}`,
  refreshSupabaseStorageUrl: async (url: string) => `${url}?signed=play`,
}));

import chatSpeakRouter, { CHAT_SPEAK_CREDITS } from "../chat-speak";

let base = "";
let server: ReturnType<express.Express["listen"]>;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  globalThis.fetch = (async (input: unknown, init?: unknown) => {
    const url = String(input);
    if (url.includes("api.elevenlabs.io")) {
      state.providerCalls += 1;
      return new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 });
    }
    return realFetch(input as never, init as never);
  }) as typeof fetch;

  const app = express();
  app.use(express.json());
  app.use(chatSpeakRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  delete process.env["THY_CHEAT_CODE_VOICE_ID"];
  delete process.env["ELEVENLABS_API_KEY"];
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  state.balance = 1000;
  state.charges = [];
  state.refunds = [];
  state.providerCalls = 0;
  delete process.env["THY_CHEAT_CODE_VOICE_ID"];
  process.env["ELEVENLABS_API_KEY"] = "test-key-not-real";
});

async function getStatus() {
  const res = await fetch(`${base}/chat/speak/status`);
  const data = (await res.json()) as { ready: boolean; creditCost: number };
  return { status: res.status, data };
}

describe("Q162 — GET /chat/speak/status is FREE and reports the server price", () => {
  it("uncast: reports { ready:false, creditCost:100 } and moves nothing", async () => {
    const { status, data } = await getStatus();
    expect(status).toBe(200);
    expect(data).toEqual({ ready: false, creditCost: 100 });
    expect(CHAT_SPEAK_CREDITS).toBe(100);
    expect(state.charges).toHaveLength(0);
    expect(state.refunds).toHaveLength(0);
    expect(state.providerCalls).toBe(0);
    expect(state.balance).toBe(1000);
  });

  it("cast (ready): repeated status polls still move nothing", async () => {
    process.env["THY_CHEAT_CODE_VOICE_ID"] = "king-voice-id";
    for (let i = 0; i < 3; i++) {
      const { status, data } = await getStatus();
      expect(status).toBe(200);
      expect(data).toEqual({ ready: true, creditCost: 100 });
    }
    expect(state.charges).toHaveLength(0);
    expect(state.refunds).toHaveLength(0);
    expect(state.providerCalls).toBe(0);
    expect(state.balance).toBe(1000);
  });
});
