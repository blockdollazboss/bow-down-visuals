/**
 * Spend-pacing charge-order pins (stack1000 Lane P2).
 *
 * The defect: the ElevenLabs-music rails (generate-music-audio,
 * generate-music-audio/extend, beat/generate, song-cover) generated
 * FIRST and charged LAST. Their affordability pre-check reads the
 * balance snapshot taken at auth, so a burst of concurrent requests
 * all passed it against the same balance — every request burned real
 * provider money, and all but the first charge then failed. The fix
 * reserves at job start: chargeCredits lands BEFORE the first
 * provider call, and every failure exit refunds in full.
 *
 * beat/generate is pinned BEHAVIORALLY below (real router, mocked
 * credits/provider/storage): event order charge → provider, provider
 * failure refunds, and a failed charge means the provider is never
 * called. The two heavy handlers (music-audio, song-cover) are pinned
 * by source-shape guards, following the free-ai-rate-limit.test.ts
 * precedent for heavy routers.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const state = vi.hoisted(() => ({
  userCredits: 100_000 as number,
  events: [] as string[],
  chargeFails: null as null | "out_of_credits",
  providerFails: false,
  reset() {
    this.userCredits = 100_000;
    this.events = [];
    this.chargeFails = null;
    this.providerFails = false;
  },
}));

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    req.userId = "user-p2";
    req.userCredits = state.userCredits;
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  },
}));

vi.mock("../../../lib/credits", () => {
  class OutOfCreditsError extends Error {}
  class LedgerWriteError extends Error {}
  return {
    OutOfCreditsError,
    LedgerWriteError,
    /* join16: routes now derive charge keys via lib/credits —
       faithful copies of the real helpers (deterministic sha256 over
       the JSON intent; client-key form for long client keys). */
    buildChargeIdempotencyKey: (scope: string, userId: string, clientKey: unknown, intent: unknown) => {
      if (typeof clientKey === "string" && clientKey.trim().length >= 8) {
        return `${scope}:${userId}:client:${clientKey.trim()}`;
      }
      return `${scope}:${userId}:${createHash("sha256").update(JSON.stringify(intent ?? null)).digest("hex").slice(0, 32)}`;
    },
    voidChargeIdempotencyKey: vi.fn(async () => true),
    chargeCredits: vi.fn(async () => {
      state.events.push("charge");
      if (state.chargeFails === "out_of_credits") throw new OutOfCreditsError();
      return 99_700;
    }),
    refundCredits: vi.fn(async () => {
      state.events.push("refund");
    }),
  };
});

vi.mock("../../../lib/payment-record", () => ({
  recordGenerationHistory: vi.fn(async () => {
    state.events.push("history");
    return "hist-1";
  }),
  markGenerationHistoryCharged: vi.fn(async () => {}),
}));
  /* join16: NOTE — no durable stored-results fake for this suite:
     the guard's fail-open real helper answers null against the
     pg-mem schema (no generation_stored_results table), exactly as
     it did before the keying; the guard's in-process store is reset
     in beforeEach via __resetCa6ReplayCache. */


vi.mock("../../../lib/r2-client", () => ({
  r2Upload: vi.fn(async () => {
    state.events.push("upload");
  }),
  r2PublicUrl: (key: string) => `https://r2.example/${key}`,
}));

import beatRouter from "../beat";
import { createHash } from "node:crypto";

/* The provider fetch is stubbed per-test below; the test's own HTTP
   calls to the mounted router must use the real fetch. */
const realFetch = globalThis.fetch.bind(globalThis);

let base = "";
let server: ReturnType<typeof express.application.listen>;

beforeAll(async () => {
  process.env["ELEVENLABS_API_KEY"] = "test-key";
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  });
  app.use(beatRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  state.reset();
  vi.stubGlobal("fetch", vi.fn(async () => {
    state.events.push("provider");
    if (state.providerFails) {
      return {
        ok: false,
        status: 500,
        text: async () => "provider boom",
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    }
    return {
      ok: true,
      status: 200,
      text: async () => "",
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    };
  }));
});

async function postBeat() {
  const res = await realFetch(`${base}/beat/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vibe: "dark trap", genre: "trap", lengthSeconds: 60 }),
  });
  return { status: res.status, json: (await res.json()) as any };
}

describe("POST /beat/generate — reserve at job start", () => {
  it("charges BEFORE the provider call on the success path", async () => {
    const { status, json } = await postBeat();
    expect(status).toBe(200);
    expect(json.url).toContain("https://r2.example/");
    // The whole point of the lane: charge precedes provider spend.
    expect(state.events).toEqual(["charge", "provider", "upload", "history"]);
  });

  it("refunds in full when the provider fails", async () => {
    state.providerFails = true;
    const { status } = await postBeat();
    expect(status).toBe(502);
    expect(state.events).toEqual(["charge", "provider", "refund"]);
  });

  it("never calls the provider when the charge refuses (out of credits)", async () => {
    state.chargeFails = "out_of_credits";
    const { status, json } = await postBeat();
    expect(status).toBe(402);
    expect(json.error).toBe("out_of_credits");
    expect(state.events).toEqual(["charge"]);
  });
});

/* ── Source-shape guards for the heavy music rails ───────────────────
   In each handler the reserve chargeCredits call must sit before the
   first ElevenLabs fetch, and a refund guard must exist. */
describe("music rails — charge precedes provider (source shape)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const read = (rel: string) => readFileSync(path.join(here, rel), "utf8");

  it("generate-music-audio: reserve charge before the first /v1/music fetch", () => {
    const src = read("../music-audio.ts");
    const chargeIdx = src.indexOf('chargeCredits(req.userId!, creditCost, { action: "Generate Audio" }, { idempotencyKey: genKey })');
    const providerIdx = src.indexOf("https://api.elevenlabs.io/v1/music");
    expect(chargeIdx).toBeGreaterThan(-1);
    expect(providerIdx).toBeGreaterThan(-1);
    expect(chargeIdx).toBeLessThan(providerIdx);
    expect(src).toContain("refundCharge");
  });

  it("generate-music-audio/extend: reserve charge before the first /v1/music fetch", () => {
    const src = read("../music-audio.ts");
    const chargeIdx = src.indexOf('chargeCredits(req.userId!, creditCost, { action: "Extend Audio" }, { idempotencyKey: extKey })');
    const providerIdx = src.indexOf("https://api.elevenlabs.io/v1/music", chargeIdx);
    expect(chargeIdx).toBeGreaterThan(-1);
    expect(providerIdx).toBeGreaterThan(chargeIdx);
  });

  it("song-cover: reserve charge before the /v1/music fetch", () => {
    const src = read("../song-cover.ts");
    const chargeIdx = src.indexOf('chargeCredits(req.userId!, COVER_CREDIT_COST, { action: "Song Cover" }, { idempotencyKey })');
    const providerIdx = src.indexOf("https://api.elevenlabs.io/v1/music");
    expect(chargeIdx).toBeGreaterThan(-1);
    expect(providerIdx).toBeGreaterThan(-1);
    expect(chargeIdx).toBeLessThan(providerIdx);
    expect(src).toContain("refundCharge");
  });
});

/* ── Families 2+3: the generate-then-charge plan/image rails ─────────
   Each handler's reserve chargeCredits call must sit before its first
   provider call, with a refund guard for the failure exits. */
describe("plan/image rails — charge precedes provider (source shape)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const read = (rel: string) => readFileSync(path.join(here, rel), "utf8");

  const cases: Array<[string, string, string]> = [
    // file, charge action, provider marker
    ["../song.ts", '"Make a Song"', "chat.completions.create"],
    ["../song-video.ts", '"Make Song + Video"', "chat.completions.create"],
    ["../video.ts", '"Make a Music Video"', "chat.completions.create"],
    ["../promo.ts", '"Promo Clips"', "chat.completions.create"],
    ["../auto-video-plan.ts", '"Auto Director Plan"', "chat.completions.create"],
    ["../mix-plan.ts", '"Music Mixer AI Mix Plan"', "chat.completions.create"],
    ["../thumbnail.ts", '"Thumbnail Maker"', "chat.completions.create"],
    ["../contests.ts", "Contest announcement:", "images.generate"],
    ["../stream-pack.ts", "Stream Pack:", "images.generate"],
  ];
  for (const [rel, action, provider] of cases) {
    it(`${rel}: reserve (${action}) precedes ${provider}`, () => {
      const src = read(rel);
      const allCharges = [...src.matchAll(/chargeCredits\(/g)].map((m) => m.index!);
      const providerIdx = src.indexOf(provider);
      expect(providerIdx).toBeGreaterThan(-1);
      // The FIRST chargeCredits in the file belongs to the reserve in
      // every one of these single-purpose handlers.
      expect(allCharges[0]).toBeLessThan(providerIdx);
      expect(src).toContain(action);
      expect(src).toContain("refundCharge");
    });
  }

  it("pre-production: all four handlers reserve before their provider calls", () => {
    const src = read("../pre-production.ts");
    const reserves = [...src.matchAll(/Reserve at job start \(spend-pacing, stack1000 P2\)/g)];
    expect(reserves.length).toBe(4);
    for (const action of ['"Production Bible"', '"Storyboard"', '"Pre-production Pack"']) {
      expect(src).toContain(`chargeCredits(req.userId!, `);
      expect(src).toContain(action);
    }
    // The pack's charge used to sit AFTER the db insert that recorded
    // credits_charged — the reserve must precede the insert.
    const packCharge = src.indexOf('action: "Pre-production Pack"');
    const packInsert = src.indexOf(".insert(preproductionPacksTable)");
    expect(packCharge).toBeGreaterThan(-1);
    expect(packInsert).toBeGreaterThan(packCharge);
  });
});

/* ── Families 4+5: limiter parity wiring ─────────────────────────────
   Poll-charge submit rails carry the family generationLimiter; free
   provider endpoints carry the per-user freeAiLimiter. */
describe("limiter parity (source shape)", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const read = (rel: string) => readFileSync(path.join(here, rel), "utf8");

  it("poll-charge submits carry generationLimiter like their siblings", () => {
    expect(read("../intro-outro.ts")).toContain('router.post("/generate-intro-outro", requireAuth, generationLimiter,');
    expect(read("../logo.ts")).toContain('router.post("/generate-logo", requireAuth, generationLimiter,');
    expect(read("../avatar-presenter.ts")).toContain('router.post("/avatar-presenter", requireAuth, generationLimiter,');
    const vaults = read("../../artist-vaults.ts");
    expect(vaults).toContain('router.post("/artist-vaults/:id/reference-video", requireAuth, generationLimiter,');
    expect(vaults).toContain('router.post("/artist-vaults/:id/reference-video/loop", requireAuth, generationLimiter,');
  });

  it("free provider endpoints carry the per-user freeAiLimiter", () => {
    expect(read("../../creator-platform.ts")).toContain('"/playlists/:id/series-assist", requireAuth, freeAiLimiter,');
    expect(read("../../command.ts")).toContain('router.get("/command/brief", requireAuth, freeAiLimiter,');
    expect(read("../../ugc-ads.ts")).toContain('"/ugc-ads/script", requireAuth, publicApiLimiter, freeAiLimiter,');
    expect(read("../../wave9d-camera.ts")).toContain('"/wave9d/camera/design", requireAuth, publicApiLimiter, freeAiLimiter,');
    expect(read("../podcast-multiplier.ts")).toContain("freeAiLimiter,");
  });
});
