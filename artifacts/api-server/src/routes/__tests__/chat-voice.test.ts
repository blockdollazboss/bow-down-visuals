/**
 * chat-voice (chat voice-IN server fallback): real-handler tests with
 * the shared transcription seam faked in memory and credits faked
 * with a tripwire.
 *
 * Pins:
 *  - THE MONEY RULE: CHAT_VOICE_TRANSCRIBE_CREDITS is 0, the route
 *    source imports no credit code at all, a successful transcription
 *    performs ZERO charges, and its response carries no credit fields
 *    — free-chat is free, so its voice fallback is free.
 *  - success returns the seam's transcript, trimmed by the seam shape
 *  - empty transcript → 422 no_speech (honest, never invented words)
 *  - provider failure → 502 transcription_failed, still zero charges
 *  - no file → 400 no_audio; oversize file → 413 (the utterance cap)
 *  - the route is mounted behind requireAuth (source pin — the real
 *    middleware 401s signed-out callers before any provider call)
 *  - PACING (stack1400 ruling #42): the free rail is capped per
 *    member at 60 transcriptions/hour (chatVoiceTranscribeLimiter) —
 *    the 61st call in the window 429s before any provider call, a
 *    different member is unaffected, and an admin is uncapped (the
 *    house skipIfAdmin pattern). The 30/min-per-IP publicApiLimiter
 *    stays in the chain (source pin); it is stubbed to a pass-through
 *    below ONLY so loopback tests (every request shares 127.0.0.1)
 *    can reach the per-member cap — the real per-member limiter is
 *    NOT stubbed.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import express from "express";
import type { AddressInfo } from "node:net";

const state = vi.hoisted(() => ({
  transcript: "how much does a song cost",
  providerFails: false,
  providerCalls: 0,
  lastBufferBytes: 0,
  charges: [] as number[],
}));

/* Header-driven fake auth (admin-moderation.test.ts precedent):
   x-test-user / x-test-email choose the caller per request, so the
   pacing tests can switch members and present an admin; no headers
   = the default member the original tests ran as. */
vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (
    req: {
      userId?: string;
      userEmail?: string;
      userCredits?: number;
      headers: Record<string, unknown>;
    },
    _res: unknown,
    next: () => void,
  ) => {
    req.userId =
      typeof req.headers["x-test-user"] === "string"
        ? (req.headers["x-test-user"] as string)
        : "user-1";
    req.userEmail =
      typeof req.headers["x-test-email"] === "string"
        ? (req.headers["x-test-email"] as string)
        : undefined;
    req.userCredits = 1000;
    next();
  },
}));

/* Keep the REAL rate-limit module (the per-member cap under test
   must be the production limiter) and stub ONLY publicApiLimiter:
   it is 30/min per IP, every loopback test request shares
   127.0.0.1, and it would 429 long before a member could reach 60 —
   masking the per-member wall entirely. Its presence in the real
   route chain is pinned by source assertions below. */
vi.mock("../../lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/rate-limit")>();
  return {
    ...actual,
    publicApiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

vi.mock("../../lib/transcription", () => ({
  transcribeAudioTimed: async (input: { buffer: Buffer }) => {
    state.providerCalls += 1;
    state.lastBufferBytes = input.buffer.length;
    if (state.providerFails) throw new Error("Scribe exploded");
    return {
      text: state.transcript,
      duration: 2.5,
      language: "en",
      words: [],
      segments: [],
    };
  },
  getTimedTranscribeModel: () => "scribe_v2",
}));

/* Tripwire: if the route ever imports credit code and charges, this
   mock records it and the money-rule tests below fail. */
vi.mock("../../lib/credits", () => ({
  chargeCredits: async (_userId: string, amount: number) => {
    state.charges.push(amount);
    return 1000 - amount;
  },
  refundCredits: async () => 1000,
}));

import chatVoiceRouter, {
  CHAT_VOICE_TRANSCRIBE_CREDITS,
  CHAT_VOICE_MAX_AUDIO_BYTES,
  CHAT_VOICE_MAX_UTTERANCE_SEC,
} from "../chat-voice";

const routeSrc = readFileSync(new URL("../chat-voice.ts", import.meta.url), "utf8");
const rateLimitSrc = readFileSync(
  new URL("../../lib/rate-limit.ts", import.meta.url),
  "utf8",
);

let base = "";
let server: ReturnType<express.Express["listen"]>;

beforeAll(async () => {
  const app = express();
  app.use(chatVoiceRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  state.transcript = "how much does a song cost";
  state.providerFails = false;
  state.providerCalls = 0;
  state.lastBufferBytes = 0;
  state.charges = [];
});

async function postAudio(
  bytes: number,
  mime = "audio/webm",
  who?: { userId: string; email?: string },
) {
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(bytes)], { type: mime }), "chat-voice.webm");
  const headers: Record<string, string> = {};
  if (who) {
    headers["x-test-user"] = who.userId;
    if (who.email) headers["x-test-email"] = who.email;
  }
  const res = await fetch(`${base}/chat/voice/transcribe`, {
    method: "POST",
    body: form,
    headers,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, data };
}

describe("POST /chat/voice/transcribe — the money rule", () => {
  it("the price constant is ZERO — chat voice is free, stated in code", () => {
    expect(CHAT_VOICE_TRANSCRIBE_CREDITS).toBe(0);
  });

  it("the route source imports no credit code — there is nothing here that could charge", () => {
    expect(routeSrc).not.toContain("chargeCredits");
    expect(routeSrc).not.toContain("lib/credits");
    expect(routeSrc).not.toContain("refundCredits");
  });

  it("a successful transcription charges nothing and returns no credit fields", async () => {
    const { status, data } = await postAudio(2048);
    expect(status).toBe(200);
    expect(data["transcript"]).toBe("how much does a song cost");
    expect(state.charges).toHaveLength(0);
    expect(data).not.toHaveProperty("creditsRemaining");
    expect(data).not.toHaveProperty("creditsUsed");
  });
});

describe("POST /chat/voice/transcribe — behavior", () => {
  it("hands the recorded bytes to the shared transcription seam", async () => {
    const { status } = await postAudio(4096);
    expect(status).toBe(200);
    expect(state.providerCalls).toBe(1);
    expect(state.lastBufferBytes).toBe(4096);
  });

  it("an empty transcript answers 422 no_speech — never invented words, never a charge", async () => {
    state.transcript = "   ";
    const { status, data } = await postAudio(2048);
    expect(status).toBe(422);
    expect(data["error"]).toBe("no_speech");
    expect(state.charges).toHaveLength(0);
  });

  it("a provider failure answers 502 transcription_failed, honestly, and still charges nothing", async () => {
    state.providerFails = true;
    const { status, data } = await postAudio(2048);
    expect(status).toBe(502);
    expect(data["error"]).toBe("transcription_failed");
    expect(String(data["message"])).toContain("couldn't turn it into text");
    expect(state.charges).toHaveLength(0);
  });

  it("no audio file → 400 no_audio, no provider call", async () => {
    const res = await fetch(`${base}/chat/voice/transcribe`, {
      method: "POST",
      body: new FormData(),
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data["error"]).toBe("no_audio");
    expect(state.providerCalls).toBe(0);
  });

  it("an oversize file is refused 413 at the utterance cap, before any provider call", async () => {
    const { status, data } = await postAudio(CHAT_VOICE_MAX_AUDIO_BYTES + 1024);
    expect(status).toBe(413);
    expect(data["error"]).toBe("too_long");
    expect(String(data["message"])).toContain(String(CHAT_VOICE_MAX_UTTERANCE_SEC));
    expect(state.providerCalls).toBe(0);
    expect(state.charges).toHaveLength(0);
  });

  it("the cap is a short chat utterance, not a song file", () => {
    expect(CHAT_VOICE_MAX_UTTERANCE_SEC).toBe(30);
    expect(CHAT_VOICE_MAX_AUDIO_BYTES).toBeLessThan(25 * 1024 * 1024);
  });
});

describe("POST /chat/voice/transcribe — per-member pacing (ruling #42)", () => {
  it("the limiter is 60/hour per member, admin-skipped, and is NOT freeAiLimiter (30/hr)", () => {
    const start = rateLimitSrc.indexOf("chatVoiceTranscribeLimiter");
    expect(start).toBeGreaterThan(-1);
    const block = rateLimitSrc.slice(start, start + 900);
    expect(block).toContain("windowMs: 60 * 60_000");
    expect(block).toContain("limit: 60");
    expect(block).toContain("skip: skipIfAdmin");
    expect(block).toContain("userId");
    // Honest copy, no internals (no provider / model / bucket talk).
    const msgStart = block.indexOf('error: "');
    const msgLine = block.slice(msgStart, block.indexOf("\n", msgStart)).toLowerCase();
    expect(msgLine).toContain("hourly limit for chat voice transcription");
    expect(msgLine).not.toContain("elevenlabs");
    expect(msgLine).not.toContain("openai");
    expect(msgLine).not.toContain("provider");
    expect(msgLine).not.toContain("bucket");
    // Distinct from the 30/hr free-AI limiter — the ruling is 60.
    const freeStart = rateLimitSrc.indexOf("freeAiLimiter = rateLimit");
    const freeBlock = rateLimitSrc.slice(freeStart, freeStart + 400);
    expect(freeBlock).toContain("limit: 30");
  });

  it("the 61st transcription in the hour 429s, before any provider call or charge", async () => {
    const who = { userId: "cap-member-1" };
    for (let i = 0; i < 60; i++) {
      const { status } = await postAudio(1024, "audio/webm", who);
      expect(status).toBe(200);
    }
    expect(state.providerCalls).toBe(60);
    const over = await postAudio(1024, "audio/webm", who);
    expect(over.status).toBe(429);
    expect(String(over.data["error"])).toMatch(/hourly limit for chat voice transcription/i);
    // Refused at the limiter: provider never called, nothing charged.
    expect(state.providerCalls).toBe(60);
    expect(state.charges).toHaveLength(0);
  });

  it("a different member is unaffected by another member's exhausted cap", async () => {
    // cap-member-1 exhausted its budget in the test above.
    const other = await postAudio(1024, "audio/webm", { userId: "cap-member-2" });
    expect(other.status).toBe(200);
    expect(other.data["transcript"]).toBe("how much does a song cost");
    // And the capped member is still capped.
    const still = await postAudio(1024, "audio/webm", { userId: "cap-member-1" });
    expect(still.status).toBe(429);
  });

  it("an admin is uncapped — the house skipIfAdmin pattern skips this limiter", async () => {
    const prev = process.env["ADMIN_EMAILS"];
    process.env["ADMIN_EMAILS"] = "admin@example.test";
    try {
      const admin = { userId: "cap-admin-1", email: "admin@example.test" };
      for (let i = 0; i < 65; i++) {
        const { status } = await postAudio(1024, "audio/webm", admin);
        expect(status).toBe(200);
      }
    } finally {
      if (prev === undefined) delete process.env["ADMIN_EMAILS"];
      else process.env["ADMIN_EMAILS"] = prev;
    }
  });

  it("the IP limiter stays in the chain, ahead of the per-member cap and the upload", () => {
    const postAt = routeSrc.indexOf('"/chat/voice/transcribe"');
    const ipAt = routeSrc.indexOf("publicApiLimiter", postAt);
    const capAt = routeSrc.indexOf("chatVoiceTranscribeLimiter", postAt);
    const uploadAt = routeSrc.indexOf('upload.single("audio")', postAt);
    expect(ipAt).toBeGreaterThan(postAt);
    expect(capAt).toBeGreaterThan(ipAt);
    expect(uploadAt).toBeGreaterThan(capAt);
  });
});

describe("POST /chat/voice/transcribe — auth", () => {
  it("the route chain runs requireAuth before the upload and handler", () => {
    expect(routeSrc).toContain("requireAuth");
    const postAt = routeSrc.indexOf('"/chat/voice/transcribe"');
    const authAt = routeSrc.indexOf("requireAuth", postAt);
    const uploadAt = routeSrc.indexOf('upload.single("audio")', postAt);
    expect(authAt).toBeGreaterThan(postAt);
    expect(uploadAt).toBeGreaterThan(authAt);
  });

  it("the route rides the shared timed-transcription seam, not a private provider call", () => {
    expect(routeSrc).toContain('from "../lib/transcription"');
    expect(routeSrc).toContain("transcribeAudioTimed(");
    expect(routeSrc).not.toContain("api.elevenlabs.io");
    expect(routeSrc).not.toContain("api.openai.com");
  });
});
