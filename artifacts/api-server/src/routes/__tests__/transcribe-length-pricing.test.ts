/**
 * Length-based transcription pricing at the rails (owner ruling
 * 2026-11-02, by delegation): 100 VB flat up to 5 minutes, then
 * +20 VB per additional minute, rounded up.
 *
 * Harness follows transcribe-plain-model.test.ts: the REAL router,
 * mocked requireAuth / credits / provider clients. The duration
 * probe (lib/transcription-pricing) is mocked to return the
 * duration each case states — the probe itself is proven against
 * real ffprobe in lib/__tests__/transcription-pricing.test.ts, and
 * the pure price function is pinned there too (5 min = 100,
 * 6 min = 120, 11 min = 220). What THIS suite pins is the wiring:
 * the amount that actually reaches chargeCredits / refundCredits /
 * the 402 `required` field is the length price of the probed
 * duration, on BOTH routes.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const state = vi.hoisted(() => ({
  probeSeconds: null as number | null,
  userCredits: 100_000,
  plainShouldFail: false,
  timedShouldFail: false,
  charges: [] as number[],
  refunds: [] as number[],
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "user-transcribe-pricing-test";
    req.userCredits = state.userCredits;
    next();
  },
}));

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
    chargeCredits: async (_userId: string, amount: number) => {
      state.charges.push(amount);
      return 100_000 - amount;
    },
    refundCredits: async (_userId: string, amount: number) => {
      state.refunds.push(amount);
    },
  };
});

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => ({
    audio: {
      transcriptions: {
        create: async () => {
          if (state.plainShouldFail) throw new Error("provider boom");
          return { text: "hello world" };
        },
      },
    },
  }),
  getPlainTranscribeModel: () => "gpt-transcribe",
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },

}));

vi.mock("../../lib/transcription", () => ({
  transcribeAudioTimed: async () => {
    if (state.timedShouldFail) throw new Error("timed provider boom");
    return {
      text: "timed hello",
      duration: state.probeSeconds,
      language: "en",
      words: [],
      segments: [],
    };
  },
}));

/* Keep the REAL price function; stub only the ffprobe probe so each
   case states its duration directly. */
vi.mock("../../lib/transcription-pricing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/transcription-pricing")>();
  return {
    ...actual,
    probeAudioDurationSeconds: async () => state.probeSeconds,
  };
});

import transcribeRouter from "../transcribe";

let baseUrl = "";
let server: ReturnType<typeof express.application.listen>;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
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

beforeEach(() => {
  state.probeSeconds = null;
  state.userCredits = 100_000;
  state.plainShouldFail = false;
  state.timedShouldFail = false;
  state.charges = [];
  state.refunds = [];
});

async function postTranscribe(): Promise<{ status: number; json: any }> {
  const form = new FormData();
  form.append(
    "audio",
    new Blob([Buffer.from("fake-audio-bytes")], { type: "audio/mpeg" }),
    "clip.mp3",
  );
  const res = await fetch(`${baseUrl}/transcribe`, { method: "POST", body: form });
  return { status: res.status, json: await res.json().catch(() => null) };
}

/* /transcribe-url downloads the audio itself with the global fetch —
   delegate calls to the test server to the real fetch and serve a
   fake audio file for every other URL. */
const realFetch = globalThis.fetch;
function stubAudioFetch() {
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    if (url.startsWith(baseUrl)) return realFetch(input, init);
    const headers = {
      get: (name: string) =>
        name.toLowerCase() === "content-length"
          ? "1024"
          : name.toLowerCase() === "content-type"
            ? "audio/mpeg"
            : null,
    };
    if ((init?.method ?? "GET").toUpperCase() === "HEAD") {
      return { ok: true, status: 200, headers } as Response;
    }
    return {
      ok: true,
      status: 200,
      headers,
      arrayBuffer: async () => Buffer.from("fake-audio-bytes").buffer,
    } as unknown as Response;
  }) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

async function postTranscribeUrl(): Promise<{ status: number; json: any }> {
  stubAudioFetch();
  const res = await realFetch(`${baseUrl}/transcribe-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audioUrl: "https://storage.example.test/song.mp3" }),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

describe("POST /transcribe — length price reaches the charge", () => {
  it("5 minutes probed → charges exactly 100", async () => {
    state.probeSeconds = 300;
    const { status, json } = await postTranscribe();
    expect(status).toBe(200);
    expect(json.transcript).toBe("hello world");
    expect(state.charges).toEqual([100]);
    expect(json.creditsRemaining).toBe(100_000 - 100);
  });

  it("6 minutes probed → charges exactly 120", async () => {
    state.probeSeconds = 360;
    const { status } = await postTranscribe();
    expect(status).toBe(200);
    expect(state.charges).toEqual([120]);
  });

  it("11 minutes probed → charges exactly 220", async () => {
    state.probeSeconds = 660;
    const { status } = await postTranscribe();
    expect(status).toBe(200);
    expect(state.charges).toEqual([220]);
  });

  it("unprobed duration (probe failed) → flat base 100, the documented fallback", async () => {
    state.probeSeconds = null;
    const { status } = await postTranscribe();
    expect(status).toBe(200);
    expect(state.charges).toEqual([100]);
  });

  it("balance below the LENGTH price → 402 naming the length price, no charge", async () => {
    state.probeSeconds = 660; // 220 VB
    state.userCredits = 150; // enough for the old flat 100, not for 220
    const { status, json } = await postTranscribe();
    expect(status).toBe(402);
    expect(json.error).toBe("out_of_credits");
    expect(json.required).toBe(220);
    expect(state.charges).toEqual([]);
  });

  it("provider failure refunds the LENGTH price that was charged", async () => {
    state.probeSeconds = 360; // 120 VB
    state.plainShouldFail = true;
    const { status } = await postTranscribe();
    expect(status).toBe(500);
    expect(state.charges).toEqual([120]);
    expect(state.refunds).toEqual([120]);
  });
});

describe("POST /transcribe-url — length price reaches the charge", () => {
  it("11 minutes probed → charges exactly 220", async () => {
    state.probeSeconds = 660;
    const { status, json } = await postTranscribeUrl();
    expect(status).toBe(200);
    expect(json.transcript).toBe("timed hello");
    expect(state.charges).toEqual([220]);
  });

  it("5 minutes probed → charges exactly 100", async () => {
    state.probeSeconds = 300;
    const { status } = await postTranscribeUrl();
    expect(status).toBe(200);
    expect(state.charges).toEqual([100]);
  });

  it("provider failure refunds the LENGTH price that was charged", async () => {
    state.probeSeconds = 660; // 220 VB
    state.timedShouldFail = true;
    const { status } = await postTranscribeUrl();
    expect(status).toBe(500);
    expect(state.charges).toEqual([220]);
    expect(state.refunds).toEqual([220]);
  });
});
