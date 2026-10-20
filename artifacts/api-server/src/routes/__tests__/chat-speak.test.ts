/**
 * chat-speak (operator voice-out): real-handler tests with credits
 * faked in memory (same idempotency semantics as lib/credits) and the
 * ElevenLabs provider faked through global fetch.
 *
 * Pins:
 *  - status reports ready + the server price; ready requires BOTH the
 *    voice env (THY_CHEAT_CODE_VOICE_ID) and the ElevenLabs key
 *  - voice env unset → POST 503 voice_not_ready, ZERO charges
 *  - success charges exactly CHAT_SPEAK_CREDITS (100) once and returns
 *    a playable URL
 *  - an idempotent replay (same client key) does not double-charge
 *  - provider failure refunds the charge and voids the key — a retry
 *    with the same key then charges fresh and succeeds
 *  - over-cap text (2001 chars) → 400, no charge, no provider call
 *  - insufficient balance → 402, no charge, no provider call
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const state = vi.hoisted(() => ({
  balance: 1000,
  charges: [] as { amount: number; key: string }[],
  refunds: [] as number[],
  chargedKeys: new Set<string>(),
  voids: [] as string[],
  providerCalls: 0,
  providerFails: false,
  uploads: 0,
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
    chargeCredits: async (
      _userId: string,
      cost: number,
      _rec: unknown,
      opts?: { idempotencyKey?: string },
    ) => {
      const key = opts?.idempotencyKey ?? "";
      if (key && state.chargedKeys.has(key)) return state.balance; // replay
      if (state.balance < cost) throw new OutOfCreditsError("out");
      state.balance -= cost;
      if (key) state.chargedKeys.add(key);
      state.charges.push({ amount: cost, key });
      return state.balance;
    },
    refundCredits: async (_userId: string, amount: number) => {
      state.balance += amount;
      state.refunds.push(amount);
      return state.balance;
    },
    voidChargeIdempotencyKey: async (key: string) => {
      state.voids.push(key);
      return state.chargedKeys.delete(key);
    },
  };
});

vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: async (fileName: string) => {
    state.uploads += 1;
    return `https://storage.example/${fileName}`;
  },
  refreshSupabaseStorageUrl: async (url: string) => `${url}?signed=play`,
}));

import chatSpeakRouter, {
  CHAT_SPEAK_CREDITS,
  MAX_SPEAK_TEXT_CHARS,
} from "../chat-speak";

let base = "";
let server: ReturnType<express.Express["listen"]>;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  globalThis.fetch = (async (input: unknown, init?: unknown) => {
    const url = String(input);
    if (url.includes("api.elevenlabs.io")) {
      state.providerCalls += 1;
      if (state.providerFails) {
        return new Response("provider exploded", { status: 500 });
      }
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
  state.chargedKeys = new Set();
  state.voids = [];
  state.providerCalls = 0;
  state.providerFails = false;
  state.uploads = 0;
  delete process.env["THY_CHEAT_CODE_VOICE_ID"];
  process.env["ELEVENLABS_API_KEY"] = "test-key-not-real";
});

function castTheVoice() {
  process.env["THY_CHEAT_CODE_VOICE_ID"] = "king-voice-id";
}

async function postSpeak(body: unknown) {
  const res = await fetch(`${base}/chat/speak`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

describe("GET /chat/speak/status", () => {
  it("reports not-ready with the server price while the voice is uncast", async () => {
    const res = await fetch(`${base}/chat/speak/status`);
    const data = (await res.json()) as { ready: boolean; creditCost: number };
    expect(res.status).toBe(200);
    expect(data.ready).toBe(false);
    expect(data.creditCost).toBe(100);
    expect(CHAT_SPEAK_CREDITS).toBe(100);
  });

  it("reports ready once the voice env and provider key are both set", async () => {
    castTheVoice();
    const res = await fetch(`${base}/chat/speak/status`);
    const data = (await res.json()) as { ready: boolean; creditCost: number };
    expect(data.ready).toBe(true);
    expect(data.creditCost).toBe(CHAT_SPEAK_CREDITS);
  });

  it("stays not-ready when the provider key is missing", async () => {
    castTheVoice();
    delete process.env["ELEVENLABS_API_KEY"];
    const res = await fetch(`${base}/chat/speak/status`);
    const data = (await res.json()) as { ready: boolean };
    expect(data.ready).toBe(false);
  });
});

describe("POST /chat/speak — not-ready honesty", () => {
  it("answers voice_not_ready and never charges while uncast", async () => {
    const { status, data } = await postSpeak({ text: "Welcome to the palace." });
    expect(status).toBe(503);
    expect(data["error"]).toBe("voice_not_ready");
    expect(String(data["message"])).toContain("still being cast");
    expect(state.charges).toHaveLength(0);
    expect(state.providerCalls).toBe(0);
    expect(state.balance).toBe(1000);
  });
});

describe("POST /chat/speak — charge discipline", () => {
  it("charges exactly 100 once on success and returns a playable URL", async () => {
    castTheVoice();
    const { status, data } = await postSpeak({
      text: "Welcome to Bow Down Visuals.",
      idempotencyKey: "speak-key-0001",
    });
    expect(status).toBe(200);
    expect(String(data["audioPlayUrl"])).toContain("signed=play");
    expect(data["creditsUsed"]).toBe(100);
    expect(data["creditsRemaining"]).toBe(900);
    expect(state.charges).toHaveLength(1);
    expect(state.charges[0]!.amount).toBe(100);
    expect(state.providerCalls).toBe(1);
    expect(state.uploads).toBe(1);
  });

  it("an idempotent replay with the same client key does not double-charge", async () => {
    castTheVoice();
    const first = await postSpeak({
      text: "Same reply, spoken twice by accident.",
      idempotencyKey: "speak-key-replay",
    });
    const second = await postSpeak({
      text: "Same reply, spoken twice by accident.",
      idempotencyKey: "speak-key-replay",
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(state.charges).toHaveLength(1);
    expect(state.balance).toBe(900);
  });

  it("provider failure refunds the charge, voids the key, and a retry succeeds", async () => {
    castTheVoice();
    state.providerFails = true;
    const failed = await postSpeak({
      text: "This one fails at the provider.",
      idempotencyKey: "speak-key-flaky",
    });
    expect(failed.status).toBe(502);
    expect(String(failed.data["error"])).toContain("refunded");
    expect(state.refunds).toEqual([100]);
    expect(state.voids).toHaveLength(1);
    expect(state.balance).toBe(1000); // net zero

    state.providerFails = false;
    const retry = await postSpeak({
      text: "This one fails at the provider.",
      idempotencyKey: "speak-key-flaky",
    });
    expect(retry.status).toBe(200);
    expect(state.charges).toHaveLength(2); // first charge + fresh retry charge
    expect(state.balance).toBe(900);
  });

  it("insufficient balance → 402 with no charge and no provider call", async () => {
    castTheVoice();
    state.balance = 50;
    const { status, data } = await postSpeak({
      text: "Can't afford this one.",
      idempotencyKey: "speak-key-broke",
    });
    expect(status).toBe(402);
    expect(data["error"]).toBe("out_of_credits");
    expect(state.charges).toHaveLength(0);
    expect(state.providerCalls).toBe(0);
  });
});

describe("POST /chat/speak — validation", () => {
  it("refuses over-cap text honestly: 400, no charge, no provider call", async () => {
    castTheVoice();
    const tooLong = "x".repeat(MAX_SPEAK_TEXT_CHARS + 1);
    const { status, data } = await postSpeak({
      text: tooLong,
      idempotencyKey: "speak-key-long",
    });
    expect(status).toBe(400);
    const details = data["details"] as { field: string; message: string }[];
    expect(details[0]!.field).toBe("text");
    expect(details[0]!.message).toContain("too long to speak");
    expect(state.charges).toHaveLength(0);
    expect(state.providerCalls).toBe(0);
  });

  it("accepts text exactly at the cap", async () => {
    castTheVoice();
    const atCap = "x".repeat(MAX_SPEAK_TEXT_CHARS);
    const { status } = await postSpeak({
      text: atCap,
      idempotencyKey: "speak-key-atcap",
    });
    expect(status).toBe(200);
    expect(state.charges).toHaveLength(1);
  });

  it("refuses empty text with a 400 and no charge", async () => {
    castTheVoice();
    const { status } = await postSpeak({ text: "" });
    expect(status).toBe(400);
    expect(state.charges).toHaveLength(0);
    expect(state.providerCalls).toBe(0);
  });
});
