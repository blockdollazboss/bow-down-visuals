/**
 * Items 20 + 21 (stack800 Lane 1, Group D) — song-tier boundary pins
 * and over-length honesty.
 *
 * Item 20: creditCostForLength (routes/generate/music-audio.ts) prices
 * a song by length tier — 400 VB ≤60s, 800 VB 61–180s, 1,200 VB
 * 181–300s, 2,400 VB 301–600s (owner ruling 2026-10-27 for the >5min
 * tier). No existing test called the function at the boundary seconds
 * (song-credits*.test.ts are about writer credits, not pricing). This
 * file pins every exact boundary second: 60/61, 180/181, 300/301,
 * 600 — in milliseconds, the function's own unit.
 *
 * Item 21: a >10-minute (>600s) song must REFUSE plainly, never
 * silently charge the 2,400 top tier. Before the fix,
 * creditCostForLength returned 2,400 for ANY length above 600,000 ms
 * and the route's clampLengthMs silently shortened the request to
 * 10 minutes — the fan was charged the top tier for a song they did
 * not ask for, with no word said. The pricing entry point now throws
 * SongTooLongError past MAX_LENGTH_MS, and the route refuses the
 * request with a plain-words 400 before any charge (route-level leg
 * pinned in the handler test below via the pricing contract: a
 * refused length can never reach chargeCredits because pricing throws
 * before the charge is computed).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/rail-core", () => ({
  invokeRailHandler: vi.fn(),
}));
vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "11111111-1111-4111-8111-111111111111";
    req.userCredits = 100_000;
    next();
  },
}));
vi.mock("../../../lib/payment-record", () => ({
  recordGenerationHistory: vi.fn(),
  markGenerationHistoryCharged: vi.fn(),
}));
vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(),
  refundCredits: vi.fn(),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));
vi.mock("../../../lib/voice-swap", () => ({
  swapSongVocalsToVoice: vi.fn(),
}));
vi.mock("../../../lib/r2-client", () => ({
  r2Upload: vi.fn(),
  r2PublicUrl: (key: string) => `https://cdn.example.com/${key}`,
}));
vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
  artistVaultsTable: { id: "id" },
  songsTable: { id: "id" },
}));

import musicAudioRouter, {
  MAX_LENGTH_MS,
  SONG_PRICE_TIERS,
  SongTooLongError,
  creditCostForLength,
} from "../music-audio";
import { chargeCredits } from "../../../lib/credits";
import express from "express";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach } from "vitest";

const s = (seconds: number) => seconds * 1000;

describe("item 20 — song-tier boundaries, exact seconds", () => {
  it("the tier table itself is the ruled 400 / 800 / 1,200 / 2,400 ladder", () => {
    expect(SONG_PRICE_TIERS).toEqual([
      { maxLengthMs: 60_000, cost: 400 },
      { maxLengthMs: 180_000, cost: 800 },
      { maxLengthMs: 300_000, cost: 1_200 },
      { maxLengthMs: 600_000, cost: 2_400 },
    ]);
    expect(MAX_LENGTH_MS).toBe(600_000);
  });

  it.each([
    // [lengthSeconds, expectedVb] — every boundary second, both sides.
    [1, 400],
    [59, 400],
    [60, 400], // exactly ≤1 min: still the 400 tier
    [61, 800], // first second of the ≤3 min tier
    [179, 800],
    [180, 800], // exactly ≤3 min: still 800
    [181, 1200], // first second of the ≤5 min tier
    [299, 1200],
    [300, 1200], // exactly ≤5 min: still 1,200
    [301, 2400], // first second of the ≤10 min tier
    [599, 2400],
    [600, 2400], // exactly ≤10 min: still 2,400 — the last legal length
  ])("%is costs %i VB", (seconds, vb) => {
    expect(creditCostForLength(s(seconds))).toBe(vb);
  });

  it("millisecond edges: 60,000ms is 400 and 60,001ms is 800 (no float drift)", () => {
    expect(creditCostForLength(60_000)).toBe(400);
    expect(creditCostForLength(60_001)).toBe(800);
    expect(creditCostForLength(180_000)).toBe(800);
    expect(creditCostForLength(180_001)).toBe(1200);
    expect(creditCostForLength(300_000)).toBe(1200);
    expect(creditCostForLength(300_001)).toBe(2400);
    expect(creditCostForLength(600_000)).toBe(2400);
  });
});

describe("item 21 — over-length honesty: >600s refuses, never silently charges 2,400", () => {
  it.each([601, 602, 900, 3600])("%is throws SongTooLongError instead of returning the top tier", (seconds) => {
    expect(() => creditCostForLength(s(seconds))).toThrow(SongTooLongError);
  });

  it("600,001ms — one millisecond over — already refuses", () => {
    expect(() => creditCostForLength(600_001)).toThrow(SongTooLongError);
  });

  it("the refusal is plain words a fan can act on (names the 10-minute limit, in seconds and minutes)", () => {
    try {
      creditCostForLength(s(601));
      expect.unreachable("a 601s song must refuse");
    } catch (err) {
      expect(err).toBeInstanceOf(SongTooLongError);
      const message = (err as Error).message;
      expect(message).toMatch(/10 minutes/);
      expect(message).toMatch(/601/);
      // Plain words, no internals: no tier table, no codes, no stack-y jargon.
      expect(message).not.toMatch(/SONG_PRICE_TIERS|creditCostForLength|undefined|NaN/);
    }
  });

  it("the error carries the refused length and the limit for honest logging", () => {
    try {
      creditCostForLength(s(601));
      expect.unreachable("a 601s song must refuse");
    } catch (err) {
      const e = err as SongTooLongError;
      expect(e.lengthMs).toBe(601_000);
      expect(e.maxLengthMs).toBe(600_000);
    }
  });
});

describe("item 21 — the generate route refuses a >600s request before any charge", () => {
  const realFetch = globalThis.fetch;
  let server: any;
  let baseUrl: string;

  beforeAll(async () => {
    process.env["ELEVENLABS_API_KEY"] = "test-key-not-real";
    const app = express();
    app.use(express.json());
    app.use((req: any, _res: any, next: any) => {
      req.log = { error: () => undefined, info: () => undefined, warn: () => undefined };
      next();
    });
    app.use("/api", musicAudioRouter);
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.on("listening", r));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });

  afterAll(async () => {
    delete process.env["ELEVENLABS_API_KEY"];
    server.closeAllConnections?.();
    await new Promise<void>((r) => server.close(() => r()));
  });

  beforeEach(() => {
    vi.mocked(chargeCredits).mockClear();
  });

  it("POST /generate-music-audio at 601s answers 400 plain words and charges nothing", async () => {
    const r = await realFetch(`${baseUrl}/generate-music-audio`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "a royal anthem", lengthSeconds: 601 }),
    });
    const json = (await r.json()) as any;
    expect(r.status).toBe(400);
    expect(json.code).toBe("song_too_long");
    expect(json.error).toMatch(/10 minutes/);
    expect(json.error).toMatch(/Nothing was charged/);
    expect(vi.mocked(chargeCredits)).not.toHaveBeenCalled();
  });
});
