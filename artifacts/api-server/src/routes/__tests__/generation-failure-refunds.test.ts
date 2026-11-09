/**
 * generation-failure-refunds.test.ts — Gate #5 pre-proof (stack1200):
 * AI GENERATION FAILURE REFUNDS at the route level for the two
 * synchronous up-front-charge rails the lib-level suites don't mount:
 * the song rail (POST /generate-song, 400 VB) and the image rail
 * (POST /cover-art, 200 VB standard).
 *
 * House style follows refund-gaps-media.test.ts: the REAL routers run
 * over HTTP with the provider stubbed (never a real provider call) and
 * the credit rail captured — the route must call refundCredits with
 * the EXACT charged amount, exactly once, when generation fails after
 * the charge. The composition/exactness of the refund once called is
 * proven against the unmocked rail in temp-first-spend.test.ts,
 * team-refund-seam.test.ts and lip-sync-failure-refund.test.ts; the
 * video rail charges on success only, so a failed generation there is
 * never charged at all (runway-clip-charge-on-success.test.ts).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  charges: [] as Array<{ amount: number; action?: string }>,
  refunds: [] as Array<{ amount: number; action?: string }>,
  providerMode: "throw" as "throw" | "ok",
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "user-1";
    req.userCredits = 100_000;
    next();
  },
}));

vi.mock("../../lib/credits", () => ({
  /* join16: routes now derive charge keys via lib/credits —
     faithful copy of the real helper (deterministic sha256 over the
     JSON intent; client-key form when a long client key is given). */
  buildChargeIdempotencyKey: (scope: string, userId: string, clientKey: unknown, intent: unknown) => {
    if (typeof clientKey === "string" && clientKey.trim().length >= 8) {
      return `${scope}:${userId}:client:${clientKey.trim()}`;
    }
    return `${scope}:${userId}:${createHash("sha256").update(JSON.stringify(intent ?? null)).digest("hex").slice(0, 32)}`;
  },
  voidChargeIdempotencyKey: vi.fn(async () => true),
  chargeCredits: vi.fn(async (_u: string, amount: number, meta: any) => {
    h.charges.push({ amount, action: meta?.action });
    return 100_000 - amount;
  }),
  refundCredits: vi.fn(async (_u: string, amount: number, meta: any) => {
    h.refunds.push({ amount, action: meta?.action });
  }),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

const __join16StoredRows = new Map<string, any>();
vi.mock("../../lib/generation-stored-results", () => ({
  /* join16: in-memory stored-results fake — first write wins,
     reads scoped by rail + key + user, matching the real helper. */
  findStoredGenerationResult: async (rail: string, key: string, userId: string) => {
    const row = __join16StoredRows.get(key);
    return row && row.rail === rail && row.userId === userId ? row.result : null;
  },
  storeGenerationResult: async (rail: string, key: string, userId: string, result: Record<string, unknown>) => {
    if (!__join16StoredRows.has(key)) __join16StoredRows.set(key, { rail, userId, result });
  },
}));

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => {
          if (h.providerMode === "throw") throw new Error("provider down");
          return {
            choices: [
              {
                message: {
                  content:
                    "## SONG CONCEPT\nA song.\n## BEST SONG TITLE\nT\n" +
                    '{"concept":"c","typography":"t","palette":["#000000"]}',
                },
              },
            ],
          };
        },
      },
    },
    images: {
      generate: async () => {
        if (h.providerMode === "throw") throw new Error("provider down");
        return { data: [{ b64_json: "aGVsbG8=" }] };
      },
    },
  }),
  getTextModel: () => "test-model",
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
}));

vi.mock("../../lib/payment-record", () => ({
  recordGenerationHistory: vi.fn(async () => "history-1"),
  markGenerationHistoryCharged: vi.fn(async () => {}),
}));

vi.mock("../../lib/retention", () => ({
  recordCreation: vi.fn(async () => {}),
}));

vi.mock("../../lib/co-stars", () => ({
  buildCoStarContext: vi.fn(async () => ""),
}));

vi.mock("../../lib/r2-client", () => ({
  r2Upload: vi.fn(async () => "https://cdn.example/cover.png"),
}));

import songRouter from "../generate/song";
import coverArtRouter from "../generate/cover-art";
import { createHash } from "node:crypto";

let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(songRouter);
  app.use(coverArtRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.charges = [];
  h.refunds = [];
  h.providerMode = "throw";
});

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

describe("song rail — POST /generate-song (400 VB up front)", () => {
  it("provider failure after the charge refunds the exact 400, exactly once", async () => {
    const { status } = await post("/generate-song", { songTopic: "a test song" });
    expect(status).toBe(500);
    expect(h.charges).toEqual([{ amount: 400, action: "Make a Song" }]);
    expect(h.refunds).toEqual([{ amount: 400, action: "Make a Song — Refund" }]);
  });

  it("happy path charges once and refunds nothing", async () => {
    h.providerMode = "ok";
    const { status } = await post("/generate-song", { songTopic: "a test song" });
    expect(status).toBe(200);
    expect(h.charges).toHaveLength(1);
    expect(h.refunds).toHaveLength(0);
  });
});

describe("image rail — POST /cover-art (200 VB standard up front)", () => {
  it("provider failure after the charge refunds the exact 200, exactly once", async () => {
    const { status, json } = await post("/cover-art", {
      songTitle: "Test Song",
      artistName: "Test Artist",
      tier: "standard",
    });
    expect(status).toBe(500);
    expect(json.refunded).toBe(true);
    expect(h.charges).toEqual([{ amount: 200, action: "Cover Art (standard)" }]);
    expect(h.refunds).toEqual([{ amount: 200, action: "Cover Art (standard) — Refund" }]);
  });
});
