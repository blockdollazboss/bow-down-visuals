/**
 * CA-4 (Stack400 charge audit, batch B4) — replay hardening for the
 * music + podcast rails: music-audio (generate + extend), podcast
 * (script branch), podcast-dialogue.
 *
 * Each was an EXPOSED-REPLAY charge site: an identical re-ask charged
 * again and burned another provider call (and, for music, minted
 * twin song-library rows). The fix (house pattern): server-derived
 * idempotency key, durable stored-result pre-check BEFORE funding
 * via lib/generation-stored-results (migration 0333), replay =
 * stored body verbatim + exactly one added field `replayed: true`,
 * and every refund path VOIDS its key so a refunded retry charges
 * fresh instead of replaying free.
 *
 * Test design: the credits ledger + stored-results table are faked
 * (same harness shape as generation-stored-results.test.ts); the
 * ElevenLabs HTTP surface is stubbed at global fetch and returns a
 * REAL tiny MP3 (embedded below) so the rails' real ffmpeg steps
 * (podcast episode assembly, music extend crossfade join) run for
 * real. R2 / object storage are faked with call counters + a
 * failure mode. Per rail the pins are:
 *   1. fresh success charges exactly once, calls the provider
 *      exactly once, stores exactly one row;
 *   2. an identical re-ask replays the stored body verbatim (+
 *      replayed: true) — no second charge, no second provider call,
 *      and for music the ORIGINAL song ids come back (no twin rows);
 *   3. a provider/storage failure refunds AND voids the key, so the
 *      retry charges fresh and succeeds.
 *
 * The podcast VIDEO branch (Pattern D) is not covered here: its work
 * needs a real video download + ffmpeg extraction, and its
 * charge-point machinery (failWithRefund + store) is the same code
 * the script branch exercises.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const USER = "user-1";

/* A real 2-second 440Hz MP3 (ffmpeg sine, 32kbps mono) — the
   provider stub returns these exact bytes so ffmpeg/ffprobe steps
   inside the rails succeed for real. */
const TINY_MP3 = Buffer.from(
  "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" +
  "GdBeOGDDAkYxRZMxtDGyxQWNUp5H3eNd1/0f///7EMTng8VoIRQN+2JApYQjAb/oTPSgyIiRhWZpPhg9jVmc9reZxY1JhCA/H7+c" +
  "LZyHHXOCp2gT4Zd9P0IxkUMkGzQTA4BxMUEYo4sMojh3F6MTAEsDXYVLTDzwyKBMQG2JSkK/lfoG//sSxOaDxVgjFA37YkCZg+NB" +
  "v2RIQALi5hh4ZnHmEsPEaL/iBoiDwGFGEmcqUahIa8ubJoAmC/5wPH/q+iozBc0pw4DU//gxOhoTiL1LOFIZExKwUg1gIFRkHZpf" +
  "xkzC6Y0C36/o9v96//sQxOeDxWQhFA37YkCjhCMBv2hISoWIGLYms7GESM6aAWfpn1jNmEkD4cF+aE6aQkadaBkbaWwy76ozJY0h" +
  "837g/X8xNRtDhi3qOCsaYxJAWxtWMpzKuDUfTKGV1RkGfy/2f//Sh8D/+xLE5wPFbCMUDftiQJ+EIwG/aEzRUxI4M7iTCoHQNMvo" +
  "Y0rhzjCzCPOhKNUmNabNg8MsAZvOZgn+71UygpM3NDWFc6W2MGOCWzKsUtsymoJHMF5AiCjhIDgyhPNDpDJyZK2HqU9+/1f/+xDE" +
  "5wPFDB8WDXtCQJmEIwG/aE2v+hMB23bXaivTsPgLRiUoD4fT7YGZZJlgrrlDsORDk2GoEwQiCn0PV8eAr2ezx5rN/dXv4+HjBEhp" +
  "xWRPDfv70f3aECAAPRgNhsMBQIAAAAAA+f/7EsTpA8ZEIRAN+2JAmgPjQa9kSEB4Lw1UrwPSgA1Ss6YYAGg2OeF3hYUH9MUW4gIO" +
  "EUEM6kk/yNIQiQ5RN/+aF0yM3Nf1EQCK1UxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7EMTmg8VIHxQN+2JApAPjAb9o" +
  "SFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV" +
  "VVVVVVVVVVVV//sSxOYDxVQfFA17QkCYg+NBr2hMVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV" +
  "VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//sQxOeDxVwfFA17QkCjBCMBv2hIVVVVVVVVVVVVVVVVVVVV" +
  "VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+xLE5wBF" +
  "6CEQDf9iQQaOKray8AdVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV" +
  "VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+xDE2IAIhIdduUkAEAAANIOAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV" +
  "VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQ==" ,
  "base64",
);

const h = vi.hoisted(() => ({
  balance: 100_000,
  charges: [] as Array<{ amount: number; key: string }>,
  refunds: [] as number[],
  voids: [] as string[],
  chargedKeys: new Set<string>(),
  stored: new Map<string, { userId: string; rail: string; result: any }>(),
  storeMode: "ok" as "ok" | "throw",
  selectMode: "ok" as "ok" | "throw",
  songSeq: 0,
  elevenMode: "ok" as "ok" | "fail",
  musicCalls: 0,
  ttsCalls: 0,
  dialogueCalls: 0,
  r2Calls: 0,
  r2Mode: "ok" as "ok" | "throw",
  fetchHits: [] as string[],
}));

function keyFromCondition(cond: unknown): string | null {
  const walk = (node: unknown, depth: number): string | null => {
    if (node === null || typeof node !== "object" || depth > 6) return null;
    if ((node as { constructor?: { name?: string } }).constructor?.name === "Param") {
      const v = (node as { value?: unknown }).value;
      return typeof v === "string" ? v : null;
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        const hit = walk(child, depth + 1);
        if (hit !== null) return hit;
      }
      return null;
    }
    const chunks = (node as { queryChunks?: unknown }).queryChunks;
    return Array.isArray(chunks) ? walk(chunks, depth + 1) : null;
  };
  return walk(cond, 0);
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = USER;
    req.userCredits = h.balance;
    req.log = { info() {}, error() {}, warn() {}, debug() {} };
    next();
  },
}));

vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error { readonly code = "OUT_OF_CREDITS"; }
  class LedgerWriteError extends Error { readonly code = "LEDGER_WRITE"; }
  return {
    OutOfCreditsError,
    LedgerWriteError,
    buildChargeIdempotencyKey: (scope: string, userId: string, clientKey: unknown, intent: unknown) =>
      typeof clientKey === "string" && clientKey.trim().length >= 8
        ? `${scope}:${userId}:client:${clientKey.trim()}`
        : `${scope}:${userId}:${JSON.stringify(intent)}`,
    chargeCredits: async (_userId: string, amount: number, _meta: unknown, opts?: { idempotencyKey?: string | null }) => {
      const key = opts?.idempotencyKey ?? "";
      if (key && h.chargedKeys.has(key)) return h.balance;
      if (h.balance < amount) throw new OutOfCreditsError("out");
      h.balance -= amount;
      if (key) h.chargedKeys.add(key);
      h.charges.push({ amount, key });
      return h.balance;
    },
    refundCredits: async (_userId: string, amount: number) => {
      h.balance += amount;
      h.refunds.push(amount);
      return h.balance;
    },
    voidChargeIdempotencyKey: async (key: string) => {
      h.voids.push(key);
      return h.chargedKeys.delete(key);
    },
  };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const fakeDb = {
    /* Projection-aware: the stored-results helper selects
       {userId, rail, result} and re-checks them, so a stored row
       must be returned in EXACTLY that projected shape — returning
       the raw stored record (which carries idempotencyKey instead)
       makes the helper see userId === undefined and answer null.
       Unprojected selects (music-audio's vault/song lookups) get
       the raw record / empty result as before. */
    select: (proj?: Record<string, unknown>) => ({
      from: () => ({
        where: (cond: unknown) => ({
          limit: async () => {
            if (h.selectMode === "throw") throw new Error("select failed");
            const key = keyFromCondition(cond);
            const row = key !== null ? h.stored.get(key) : undefined;
            if (!row) return [];
            if (proj && "result" in proj) {
              return [{ userId: row.userId, rail: row.rail, result: row.result }];
            }
            return [row];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: { idempotencyKey?: string; userId: string; rail?: string; result?: any }) => ({
        onConflictDoNothing: async () => {
          if (h.storeMode === "throw") throw new Error("store write failed");
          if (v.idempotencyKey && !h.stored.has(v.idempotencyKey)) {
            h.stored.set(v.idempotencyKey, { userId: v.userId, rail: v.rail ?? "", result: v.result });
          }
          return [];
        },
        /* music-audio's song-library insert: .values(...).returning() */
        returning: async () => [{ id: `song-${++h.songSeq}` }],
      }),
    }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
    delete: () => ({ where: async () => [] }),
  };
  return { ...actual, db: fakeDb };
});

vi.mock("../../lib/logger", () => ({ logger: { info() {}, error() {}, warn() {}, debug() {} } }));
vi.mock("../../lib/rate-limit", () => ({ publicApiLimiter: (_req: any, _res: any, next: any) => next() }));

/* podcast.ts references getOpenAI() only inside
   writeScriptFromTopic (topic mode, not under test) — the stub
   client's create() throws if it is ever reached. */
vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => ({ chat: { completions: { create: async () => { throw new Error("topic mode not under test"); } } } }),
  getTextModel: () => "test-model",
  LOW_REASONING_PARAMS: {},
}));
vi.mock("../../lib/admin", () => ({ isAdminRequest: () => false }));
vi.mock("../../lib/rail-core", () => ({ invokeRailHandler: async () => ({}) }));
vi.mock("../../lib/payment-record", () => ({
  recordGenerationHistory: async () => "hist-1",
  markGenerationHistoryCharged: async () => {},
  recordCreditUsage: async () => {},
}));
vi.mock("../../lib/voice-swap", () => ({ swapSongVocalsToVoice: async (b: Buffer) => b }));
vi.mock("../../lib/r2-client", () => ({
  r2Upload: async () => {
    h.r2Calls++;
    if (h.r2Mode === "throw") throw new Error("r2 unavailable in test");
  },
  r2PublicUrl: (key: string) => `https://r2.example/${key}`,
}));
vi.mock("../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: async (objectName: string) => `https://storage.example/${objectName}`,
  refreshSupabaseStorageUrl: async (ref: string) => `https://play.example/${ref}`,
}));
/* attributionOptIn() must return a REAL zod schema — both podcast
   schemas embed it as a field, and zod validates field types when
   the object schema is constructed (a hand-rolled chainable throws
   "Invalid element at key attribution" at parse time). Mirror the
   real helper's behavior with the real zod. */
vi.mock("../../lib/attribution", async () => {
  const { z } = await import("zod");
  const coerce = (v: unknown): unknown =>
    typeof v === "string" ? v.trim().toLowerCase() === "true" : v;
  return {
    attributionOptIn: () => z.preprocess(coerce, z.boolean().optional().default(false)),
    ATTRIBUTION_TEXT: "Made with Bow Down Visuals",
  };
});

import musicAudioRouter from "../generate/music-audio";
import podcastRouter from "../generate/podcast";
import podcastDialogueRouter from "../generate/podcast-dialogue";

let base = "";
let server: ReturnType<express.Express["listen"]>;
const realFetch = globalThis.fetch;

async function post(path: string, body?: unknown) {
  const res = await realFetch(`${base}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, any> | null };
}

beforeAll(async () => {
  process.env["ELEVENLABS_API_KEY"] = "test-key-not-real";
  const app = express();
  app.use(express.json());
  app.use(musicAudioRouter);
  app.use(podcastRouter);
  app.use(podcastDialogueRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  globalThis.fetch = realFetch;
  await new Promise((r) => server.close(r));
});

beforeEach(() => {
  /* Provider stub: ElevenLabs surfaces + the extend flow's original
     download. Plain assignment, NOT vi.stubGlobal (see the job-rails
     file: stubGlobal's auto-unstub between tests silently restored
     the real fetch there). */
  globalThis.fetch = (async (input: unknown, init?: unknown) => {
    const url = String(input);
    h.fetchHits.push(url);
    if (url.startsWith(base)) return realFetch(input as any, init as any);
    const audio = () => new Response(new Uint8Array(TINY_MP3), { status: 200, headers: { "Content-Type": "audio/mpeg" } });
    const fail = () => new Response("provider error", { status: 500 });
    if (url.includes("api.elevenlabs.io/v1/music")) { h.musicCalls++; return h.elevenMode === "ok" ? audio() : fail(); }
    if (url.includes("api.elevenlabs.io/v1/text-to-dialogue")) { h.dialogueCalls++; return h.elevenMode === "ok" ? audio() : fail(); }
    if (url.includes("api.elevenlabs.io/v1/text-to-speech")) { h.ttsCalls++; return h.elevenMode === "ok" ? audio() : fail(); }
    if (url.startsWith("https://cdn.example.com/")) return audio();
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  h.balance = 100_000;
  h.charges = []; h.refunds = []; h.voids = [];
  h.chargedKeys = new Set(); h.stored = new Map();
  h.storeMode = "ok"; h.selectMode = "ok";
  h.songSeq = 0;
  h.elevenMode = "ok";
  h.musicCalls = 0; h.ttsCalls = 0; h.dialogueCalls = 0;
  h.r2Calls = 0; h.r2Mode = "ok";
  h.fetchHits = [];
});

describe("music-audio generate — CA-4 replay hardening", () => {
  const body = { prompt: "lofi study beat", lengthSeconds: 30 };

  it("fresh charges once + provider once; re-ask replays the original song ids; failure refunds+voids", async () => {
    const a = await post("/generate-music-audio", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(400);
    expect(h.musicCalls).toBe(1);
    expect(h.stored.size).toBe(1);
    const songIds = a.json?.["songIds"];
    expect(Array.isArray(songIds)).toBe(true);
    expect(songIds).toHaveLength(1);

    const b = await post("/generate-music-audio", body);
    expect(b.status).toBe(200);
    expect(b.json?.["replayed"]).toBe(true);
    expect(b.json?.["songIds"]).toEqual(songIds);
    expect(b.json?.["url"]).toBe(a.json?.["url"]);
    expect(h.charges).toHaveLength(1);
    expect(h.musicCalls).toBe(1);
    expect(h.songSeq).toBe(1);

    h.elevenMode = "fail";
    const failBody = { prompt: "dark trap anthem", lengthSeconds: 30 };
    const f = await post("/generate-music-audio", failBody);
    expect(f.status).toBe(500);
    expect(h.refunds).toEqual([400]);
    expect(h.voids).toHaveLength(1);
    expect(h.balance).toBe(100_000 - 400);

    h.elevenMode = "ok";
    const c = await post("/generate-music-audio", failBody);
    expect(c.status).toBe(200);
    expect(c.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(3);
    expect(h.balance).toBe(100_000 - 800);
  });
});

describe("music-audio extend — CA-4 replay hardening", () => {
  const body = {
    originalAudioUrl: "https://cdn.example.com/orig.mp3",
    originalPrompt: "lofi study beat",
    extendPrompt: "add a drum break",
    extendSeconds: 30,
  };

  it("fresh charges once + provider once; re-ask replays; r2 failure refunds+voids; retry charges fresh", async () => {
    const a = await post("/generate-music-audio/extend", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(400);
    expect(h.musicCalls).toBe(1);
    expect(typeof a.json?.["songId"]).toBe("string");

    const b = await post("/generate-music-audio/extend", body);
    expect(b.status).toBe(200);
    expect(b.json?.["replayed"]).toBe(true);
    expect(b.json?.["songId"]).toBe(a.json?.["songId"]);
    expect(h.charges).toHaveLength(1);
    expect(h.musicCalls).toBe(1);

    h.r2Mode = "throw";
    const failBody = { ...body, extendPrompt: "add strings" };
    const f = await post("/generate-music-audio/extend", failBody);
    expect(f.status).toBe(500);
    expect(h.refunds).toEqual([400]);
    expect(h.voids).toHaveLength(1);
    expect(h.balance).toBe(100_000 - 400);

    h.r2Mode = "ok";
    const c = await post("/generate-music-audio/extend", failBody);
    expect(c.status).toBe(200);
    expect(c.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(3);
    expect(h.balance).toBe(100_000 - 800);
  });
});

describe("podcast script branch — CA-4 replay hardening", () => {
  const body = {
    mode: "script",
    title: "Episode One",
    script: "Hello world. This is a short test episode about nothing at all.",
    hostVoiceId: "voice-host",
  };

  it("fresh charges 300 once + TTS once; re-ask replays; TTS failure refunds+voids; retry charges fresh", async () => {
    const a = await post("/podcast/generate", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(a.json?.["creditsUsed"]).toBe(300);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(300);
    expect(h.ttsCalls).toBe(1);

    const b = await post("/podcast/generate", body);
    expect(b.status).toBe(200);
    expect(b.json?.["replayed"]).toBe(true);
    expect(b.json?.["audioRef"]).toBe(a.json?.["audioRef"]);
    expect(h.charges).toHaveLength(1);
    expect(h.ttsCalls).toBe(1);

    h.elevenMode = "fail";
    const failBody = { ...body, script: "A different episode entirely, with other words to speak aloud today." };
    const f = await post("/podcast/generate", failBody);
    expect(f.status).toBeGreaterThanOrEqual(500);
    expect(h.refunds).toEqual([300]);
    expect(h.voids).toHaveLength(1);
    expect(h.balance).toBe(100_000 - 300);

    h.elevenMode = "ok";
    const c = await post("/podcast/generate", failBody);
    expect(c.status).toBe(200);
    expect(c.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(3);
    expect(h.balance).toBe(100_000 - 600);
  });
});

describe("podcast-dialogue — CA-4 replay hardening", () => {
  const body = {
    title: "Two Voices",
    script: "ALEX: Hello there, welcome to the show.\nBLAIR: Thanks for having me on today.",
    speakers: [
      { name: "ALEX", voiceId: "voice-a" },
      { name: "BLAIR", voiceId: "voice-b" },
    ],
  };

  it("fresh charges 300 once + one dialogue call; re-ask replays; provider failure refunds+voids; retry charges fresh", async () => {
    const a = await post("/podcast/dialogue", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(a.json?.["creditsUsed"]).toBe(300);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(300);
    expect(h.dialogueCalls).toBe(1);

    const b = await post("/podcast/dialogue", body);
    expect(b.status).toBe(200);
    expect(b.json?.["replayed"]).toBe(true);
    expect(b.json?.["audioUrl"]).toBe(a.json?.["audioUrl"]);
    expect(h.charges).toHaveLength(1);
    expect(h.dialogueCalls).toBe(1);

    h.elevenMode = "fail";
    const failBody = { ...body, script: "ALEX: A brand new conversation starts right now.\nBLAIR: Indeed it does, let us begin." };
    const f = await post("/podcast/dialogue", failBody);
    expect(f.status).toBeGreaterThanOrEqual(500);
    expect(h.refunds).toEqual([300]);
    expect(h.voids).toHaveLength(1);
    expect(h.balance).toBe(100_000 - 300);

    h.elevenMode = "ok";
    const c = await post("/podcast/dialogue", failBody);
    expect(c.status).toBe(200);
    expect(c.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(3);
    expect(h.balance).toBe(100_000 - 600);
  });
});
