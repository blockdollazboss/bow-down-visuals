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

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (
    req: { userId?: string; userCredits?: number },
    _res: unknown,
    next: () => void,
  ) => {
    req.userId = "user-1";
    req.userCredits = 1000;
    next();
  },
}));

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

async function postAudio(bytes: number, mime = "audio/webm") {
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(bytes)], { type: mime }), "chat-voice.webm");
  const res = await fetch(`${base}/chat/voice/transcribe`, { method: "POST", body: form });
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
