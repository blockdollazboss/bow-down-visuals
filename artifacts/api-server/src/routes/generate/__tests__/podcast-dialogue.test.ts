/**
 * podcast-dialogue.test.ts — stack1400 ruling #32 (owner, 2026-11-02):
 * multi-speaker podcast dialogue is UNLOCKED at 300 Visual Bucs per
 * 10 minutes of finished audio.
 *
 * The rail spent its life behind DIALOGUE_PRICING_APPROVED=false with a
 * placeholder rate of 3 (a pre-×100-scale leftover — the deal-matcher
 * precedent). These pins hold the ruled state against the REAL handler
 * with credits, storage, the podcast assembly helpers and outbound
 * fetch mocked:
 *
 *  - the constants: 300 VB per 10-min block, approval true, pricing
 *    version is the dated approved stamp and no placeholder framing
 *    survives anywhere in the rail source;
 *  - the estimate: the file's existing duration math (150 wpm, 600s
 *    blocks, 1-block minimum) at the ruled rate — 300 / block;
 *  - GET status with a key configured reports enabled + reason "ok"
 *    (never "pricing_pending"); without a key the only blocker left is
 *    "key_missing";
 *  - POST with insufficient balance refuses 402 BEFORE any charge and
 *    BEFORE any provider call;
 *  - POST happy path charges exactly 300 for one block, once.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { request as httpRequest } from "http";
import type { AddressInfo } from "net";
import type { Server } from "http";

/* ── Hoisted mock state ─────────────────────────────────────────────── */
const h = vi.hoisted(() => ({
  userCredits: 10_000,
  chargeCalls: [] as Array<{ userId: string; amount: number; opts: unknown }>,
  refundCalls: [] as Array<{ userId: string; amount: number; opts: unknown }>,
  providerCalls: [] as string[],
}));

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req["userId"] = "user-1";
    req["userCredits"] = h.userCredits;
    req["log"] = { error: () => {}, warn: () => {}, info: () => {} };
    next();
  },
}));

vi.mock("../../../lib/credits", () => ({
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  chargeCredits: vi.fn(async (userId: string, amount: number, opts: unknown) => {
    h.chargeCalls.push({ userId, amount, opts });
    return h.userCredits - amount;
  }),
  refundCredits: vi.fn(async (userId: string, amount: number, opts: unknown) => {
    h.refundCalls.push({ userId, amount, opts });
  }),
}));

vi.mock("../../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../../../lib/objectStorage", () => ({
  uploadMediaToSupabaseStorage: vi.fn(async () => "user-1/podcast-dialogue/ep.mp3"),
  refreshSupabaseStorageUrl: vi.fn(async () => "https://example.com/ep.mp3"),
}));

/* The assembly helpers from ./podcast are not under test here — the
   dialogue rail's own gate + charge shape is. */
vi.mock("../podcast", () => ({
  WORDS_PER_MINUTE: 150,
  assembleEpisode: vi.fn(async () => {}),
  probeDurationSeconds: vi.fn(async () => 600),
  buildPodcastRss: vi.fn(() => "<rss version=\"2.0\"></rss>"),
}));

import dialogueRouter, {
  DIALOGUE_CREDITS_PER_10MIN,
  DIALOGUE_PRICING_APPROVED,
  DIALOGUE_PRICING_VERSION,
  DIALOGUE_SECONDS_PER_BLOCK,
  estimateDialogueCost,
} from "../podcast-dialogue";

/* ── Test HTTP plumbing (real express server, http-module client so the
   global fetch stub below only covers the route's own provider call) ── */
let server: Server;
let port: number;

function call(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? "" : JSON.stringify(body);
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({
            status: res.statusCode ?? 0,
            json: JSON.parse(text) as Record<string, unknown>,
          });
        });
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

/** A two-speaker script of exactly `words` spoken words. */
function taggedScript(words: number): string {
  const half = Math.floor(words / 2);
  const alex = new Array(half).fill("word").join(" ");
  const jordan = new Array(words - half).fill("word").join(" ");
  return `ALEX: ${alex}\nJORDAN: ${jordan}`;
}

const SPEAKERS = [
  { name: "ALEX", voiceId: "voice-alex" },
  { name: "JORDAN", voiceId: "voice-jordan" },
];

beforeEach(async () => {
  h.userCredits = 10_000;
  h.chargeCalls.length = 0;
  h.refundCalls.length = 0;
  h.providerCalls.length = 0;
  vi.stubEnv("ELEVENLABS_API_KEY", "test-key-not-real");

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      h.providerCalls.push(url);
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
        text: async () => "",
      };
    }),
  );

  const app = express();
  app.use(express.json());
  app.use(dialogueRouter);
  server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", r));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await new Promise<void>((r) => server.close(() => r()));
});

describe("ruling #32 — the approved price", () => {
  it("charges 300 VB per 10-minute block, pricing approved", () => {
    expect(DIALOGUE_CREDITS_PER_10MIN).toBe(300);
    expect(DIALOGUE_SECONDS_PER_BLOCK).toBe(600);
    expect(DIALOGUE_PRICING_APPROVED).toBe(true);
    expect(DIALOGUE_PRICING_VERSION).toBe("2026-11-02-approved");
  });

  it("carries no placeholder framing anywhere in the rail source", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../podcast-dialogue.ts", import.meta.url)),
      "utf8",
    );
    expect(src).not.toMatch(/placeholder/i);
    expect(src).not.toMatch(/not user-approved/i);
    expect(src).toMatch(/owner ruling 2026-11-02/);
  });
});

describe("estimateDialogueCost — existing duration math at the ruled rate", () => {
  it("1500 words = 10 minutes = 1 block = 300 VB", () => {
    const est = estimateDialogueCost(taggedScript(1500));
    expect(est.wordCount).toBe(1500);
    expect(est.estimatedSeconds).toBe(600);
    expect(est.billableBlocks).toBe(1);
    expect(est.credits).toBe(300);
    expect(est.speakerCount).toBe(2);
  });

  it("rounds partial blocks up (1501 words = 2 blocks = 600 VB)", () => {
    const est = estimateDialogueCost(taggedScript(1501));
    expect(est.billableBlocks).toBe(2);
    expect(est.credits).toBe(600);
  });

  it("enforces the 1-block minimum for tiny scripts (300 VB)", () => {
    const est = estimateDialogueCost("ALEX: Hi.\nJORDAN: Hello.");
    expect(est.billableBlocks).toBe(1);
    expect(est.credits).toBe(300);
  });
});

describe("GET /podcast/dialogue/status — unlocked", () => {
  it("reports enabled + ok with the ruled price when the key is set", async () => {
    const res = await call("GET", "/podcast/dialogue/status");
    expect(res.status).toBe(200);
    expect(res.json["enabled"]).toBe(true);
    expect(res.json["reason"]).toBe("ok");
    expect(res.json["pricingApproved"]).toBe(true);
    expect(res.json["creditsPer10Min"]).toBe(300);
    expect(res.json["pricingVersion"]).toBe("2026-11-02-approved");
  });

  it("without a key the only blocker is key_missing — never pricing_pending", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    const res = await call("GET", "/podcast/dialogue/status");
    expect(res.status).toBe(200);
    expect(res.json["enabled"]).toBe(false);
    expect(res.json["reason"]).toBe("key_missing");
    expect(res.json["pricingApproved"]).toBe(true);
  });
});

describe("POST /podcast/dialogue — money shape", () => {
  it("insufficient balance refuses 402 before any charge and before the provider", async () => {
    h.userCredits = 100; // one block costs 300
    const res = await call("POST", "/podcast/dialogue", {
      title: "Ep 1",
      script: taggedScript(1500),
      speakers: SPEAKERS,
    });
    expect(res.status).toBe(402);
    expect(res.json["error"]).toBe("out_of_credits");
    expect(res.json["creditsRequired"]).toBe(300);
    expect(h.chargeCalls).toHaveLength(0);
    expect(h.refundCalls).toHaveLength(0);
    expect(h.providerCalls).toHaveLength(0);
  });

  it("happy path charges exactly 300 once for a one-block dialogue", async () => {
    const res = await call("POST", "/podcast/dialogue", {
      title: "Ep 1",
      script: taggedScript(1500),
      speakers: SPEAKERS,
    });
    expect(res.status).toBe(200);
    expect(res.json["creditsUsed"]).toBe(300);
    expect(h.chargeCalls).toHaveLength(1);
    expect(h.chargeCalls[0]!.amount).toBe(300);
    expect(h.refundCalls).toHaveLength(0);
    expect(h.providerCalls).toEqual(["https://api.elevenlabs.io/v1/text-to-dialogue"]);
  });
});
