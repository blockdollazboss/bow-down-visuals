/**
 * POST /api/transcribe (routes/transcribe.ts) consumes ONLY the plain
 * transcript text — no word/segment timestamps — so it runs on the
 * plain-transcription model (gpt-transcribe via getPlainTranscribeModel)
 * instead of whisper-1, which OpenAI removes on 2027-02-26.
 *
 * The sibling POST /api/transcribe-url route in the same file DOES
 * consume word timestamps (its clients align caption lines to them),
 * so it stays on whisper-1; a source-shape guard below pins that split
 * so a future "helpful" sweep can't silently break caption alignment
 * or re-break this route.
 *
 * Harness follows free-ai-rate-limit.test.ts: the REAL router, mocked
 * requireAuth, mocked OpenAI client (no network, no provider spend).
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const captured = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "user-transcribe-test";
    req.userCredits = 100_000;
    next();
  },
}));

/* /transcribe charges the displayed 100 VB server-side (owner's
   2026-10-14 ruling). This suite's subject is the model split, so the
   credits lib is a permissive fake: charges always succeed. */
vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error {
    readonly status = 402;
    constructor() {
      super("out_of_credits");
      this.name = "OutOfCreditsError";
    }
  }
  class LedgerWriteError extends Error {
    readonly status = 500;
    constructor() {
      super("ledger_write_failed");
      this.name = "LedgerWriteError";
    }
  }
  class CreditsDisabledError extends Error {
    readonly status = 403;
    constructor() {
      super("credits_disabled");
      this.name = "CreditsDisabledError";
    }
  }
  return {
    OutOfCreditsError,
    LedgerWriteError,
    CreditsDisabledError,
    buildChargeIdempotencyKey: (scope: string, userId: string) => `${scope}:${userId}:test-key`,
    chargeCredits: async () => 99_900,
    refundCredits: async () => {},
  };
});

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => ({
    audio: {
      transcriptions: {
        create: async (params: Record<string, unknown>) => {
          captured.calls.push(params);
          return { text: "hello world" };
        },
      },
    },
  }),
  getPlainTranscribeModel: () => "gpt-transcribe",
}));

import transcribeRouter from "../transcribe";

let baseUrl = "";
let server: ReturnType<typeof express.application.listen>;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // Minimal stand-in for pino-http's req.log, used on error paths.
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  });
  app.use(transcribeRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("POST /transcribe — plain transcription model", () => {
  it("transcribes with gpt-transcribe + json format and returns only the text", async () => {
    const form = new FormData();
    form.append(
      "audio",
      new Blob([Buffer.from("fake-audio-bytes")], { type: "audio/mpeg" }),
      "clip.mp3",
    );
    const res = await fetch(`${baseUrl}/transcribe`, { method: "POST", body: form });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { transcript?: string };
    expect(json.transcript).toBe("hello world");

    expect(captured.calls).toHaveLength(1);
    const params = captured.calls[0]!;
    expect(params.model).toBe("gpt-transcribe");
    expect(params.response_format).toBe("json");
    // No verbose_json-only machinery on the plain path.
    expect(params.timestamp_granularities).toBeUndefined();
  });
});

describe("transcribe.ts — the plain/timed split stays intact", () => {
  const src = readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "transcribe.ts"),
    "utf8",
  );

  it("the plain route goes through the shared accessor, never a literal", () => {
    expect(src).toContain("model: getPlainTranscribeModel()");
  });

  it("exactly one whisper-1 call remains: the timed /transcribe-url route", () => {
    const occurrences = src.split('model: "whisper-1"').length - 1;
    expect(occurrences).toBe(1);
    // …and it still requests the word+segment timestamps its clients align to.
    expect(src).toContain('timestamp_granularities: ["word", "segment"]');
    expect(src).toContain('response_format: "verbose_json"');
  });
});
