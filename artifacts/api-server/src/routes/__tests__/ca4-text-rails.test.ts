/**
 * CA-4 (Stack400 charge audit, batch B4) — replay hardening for the
 * generate m–p TEXT/LLM rails: meme-machine, mix-plan, promo.
 *
 * Each of these rails was an EXPOSED-REPLAY charge site: an identical
 * re-ask charged again and burned another provider call. The fix
 * (house pattern, contracts / post-assist / CA-KEY precedent):
 * server-derived idempotency key, durable stored-result pre-check
 * BEFORE funding via lib/generation-stored-results (migration 0333),
 * replay = stored body verbatim + exactly one added field
 * `replayed: true`, and every refund path VOIDS its key so a
 * refunded retry charges fresh instead of replaying free.
 *
 * These tests fake the credits ledger + the stored-results table
 * (same harness shape as generation-stored-results.test.ts) and pin,
 * per rail:
 *   1. fresh success charges exactly once, calls the provider
 *      exactly once, and stores exactly one row;
 *   2. an identical re-ask is served from the table — no second
 *      charge, no second provider call, body = stored body +
 *      replayed: true;
 *   3. a provider failure refunds AND voids the key, so the retry
 *      charges fresh and succeeds (never a free replay);
 *   4. the mix-plan failure shape is special: the rail refunds and
 *      still answers the free fallback plan with HTTP 200 — the
 *      retry must still charge fresh (the void is what saves it).
 *
 * mix-plan integration note: the rail constructs its OpenAI client
 * from the OPENAI_API_KEY env var (no shared seam). Setting a fake
 * key lets the handler run against the REAL SDK, whose requests hit
 * the (equally fake) OPENAI_BASE_URL endpoint below. The fake key is
 * at least not missing: a missing key takes the free-fallback door,
 * which is not the charged path under test.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const USER = "user-1";

const h = vi.hoisted(() => ({
  balance: 100_000,
  charges: [] as Array<{ amount: number; key: string }>,
  refunds: [] as number[],
  voids: [] as string[],
  chargedKeys: new Set<string>(),
  stored: new Map<string, { userId: string; rail: string; result: any }>(),
  storeMode: "ok" as "ok" | "throw",
  selectMode: "ok" as "ok" | "throw",
  memeCalls: 0,
  memeMode: "ok" as "ok" | "throw" | "empty",
  promoCalls: 0,
  promoMode: "ok" as "ok" | "throw",
  mixPlanCalls: 0,
  mixPlanMode: "ok" as "ok" | "badjson",
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
    req.log = { info() {}, error() {}, warn() {} };
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
      if (key && h.chargedKeys.has(key)) return h.balance; // ledger replay suppression
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

vi.mock("../../lib/rate-limit", () => ({ publicApiLimiter: (_req: any, _res: any, next: any) => next() }));
vi.mock("../../lib/logger", () => ({ logger: { info() {}, error() {}, warn() {} } }));
vi.mock("../../lib/co-stars", () => ({ buildCoStarContext: async () => null }));
vi.mock("../../lib/payment-record", () => ({ recordCreditUsage: async () => {} }));

vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "test-model",
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async (args: any) => {
          const sys = String(args?.messages?.[0]?.content ?? "");
          if (sys.includes("meme-caption writer")) {
            h.memeCalls++;
            if (h.memeMode === "throw") throw new Error("openai down");
            const content = h.memeMode === "empty"
              ? JSON.stringify({ captions: [] })
              : JSON.stringify({ captions: ["TOP / BOTTOM", "second", "third", "fourth", "fifth"] });
            return { choices: [{ message: { content } }] };
          }
          if (sys.includes("premium AI creative director")) {
            h.promoCalls++;
            if (h.promoMode === "throw") throw new Error("openai down");
            return { choices: [{ message: { content: "PROMO PLAN TEXT" } }] };
          }
          throw new Error("unexpected provider call in ca4-text test");
        },
      },
    },
  }),
}));

/* meme-machine imports the real SDK only for OpenAI.APIError type
   checks — a stub class keeps instanceof honest. */
/* The OpenAI stub is a REAL class for meme-machine's APIError
   instanceof use — but mix-plan constructs it and calls
   chat.completions.create. Delegate that to the local fake
   completions endpoint over HTTP so mix-plan's full SDK-shaped
   call path (request, JSON parse, PlanSchema validation) runs for
   real against the test's own server. */
vi.mock("openai", () => {
  class APIError extends Error { status?: number; code?: string; }
  class OpenAI {
    static APIError = APIError;
    chat = {
      completions: {
        create: async (params: unknown) => {
          const res = await realFetch(`${process.env["OPENAI_BASE_URL"]}/chat/completions`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(params),
          });
          return res.json();
        },
      },
    };
  }
  return { default: OpenAI, APIError };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const fakeDb = {
    select: () => ({
      from: () => ({
        where: (cond: unknown) => ({
          limit: async () => {
            if (h.selectMode === "throw") throw new Error("select failed");
            const key = keyFromCondition(cond);
            const row = key !== null ? h.stored.get(key) : undefined;
            return row ? [row] : [];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: { idempotencyKey: string; userId: string; rail: string; result: any }) => ({
        onConflictDoNothing: async () => {
          if (h.storeMode === "throw") throw new Error("store write failed");
          if (!h.stored.has(v.idempotencyKey)) {
            h.stored.set(v.idempotencyKey, { userId: v.userId, rail: v.rail, result: v.result });
          }
          return [];
        },
      }),
    }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
    delete: () => ({ where: async () => [] }),
  };
  return { ...actual, db: fakeDb };
});

import memeMachineRouter from "../generate/meme-machine";
import mixPlanRouter from "../generate/mix-plan";
import promoRouter from "../generate/promo";

let base = "";
let server: ReturnType<express.Express["listen"]>;
let mixServer: ReturnType<express.Express["listen"]> | undefined;
const realFetch = globalThis.fetch;

async function post(path: string, body?: unknown, on: string = base) {
  const res = await realFetch(`${on}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, any> | null };
}

beforeAll(async () => {
  process.env["OPENAI_API_KEY"] = "test-key-not-real";
  /* mix-plan talks to the REAL OpenAI SDK; point it at a local fake
     completions endpoint so no network leaves the box. */
  const mixApp = express();
  mixApp.use(express.json());
  mixApp.post("/v1/chat/completions", (_req, res) => {
    h.mixPlanCalls++;
    const content = h.mixPlanMode === "badjson"
      ? JSON.stringify({ nope: true })
      : JSON.stringify({
          preset: "trap-soul", summary: "A tight plan.",
          vocalChain: ["chain step"], beatChain: ["chain step"], masterChain: ["chain step"],
          loudnessTarget: "-9 LUFS", exportRecommendation: "WAV 24-bit",
        });
    res.json({
      id: "chatcmpl-test", object: "chat.completion", created: 0, model: "test-model",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    });
  });
  mixServer = await new Promise<ReturnType<express.Express["listen"]>>((resolve) => {
    const s = mixApp.listen(0, () => resolve(s));
  });
  const mixPort = (mixServer.address() as AddressInfo).port;
  process.env["OPENAI_BASE_URL"] = `http://127.0.0.1:${mixPort}/v1`;

  const app = express();
  app.use(express.json());
  app.use(memeMachineRouter);
  app.use(mixPlanRouter);
  app.use(promoRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  delete process.env["OPENAI_API_KEY"];
  delete process.env["OPENAI_BASE_URL"];
  await new Promise((r) => server.close(r));
  if (mixServer) await new Promise((r) => mixServer!.close(r));
});

beforeEach(() => {
  h.balance = 100_000;
  h.charges = []; h.refunds = []; h.voids = [];
  h.chargedKeys = new Set();
  h.stored = new Map();
  h.storeMode = "ok"; h.selectMode = "ok";
  h.memeCalls = 0; h.memeMode = "ok";
  h.promoCalls = 0; h.promoMode = "ok";
  h.mixPlanCalls = 0; h.mixPlanMode = "ok";
});

describe("meme-machine — CA-4 replay hardening", () => {
  const body = { context: "my cat knocked the camera over mid-stream", format: "distracted boyfriend" };

  it("fresh success charges once + provider once; identical re-ask replays from the table", async () => {
    const a = await post("/meme-machine/captions", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(a.json?.["captions"]).toHaveLength(5);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);
    expect(h.memeCalls).toBe(1);
    expect(h.stored.size).toBe(1);

    const b = await post("/meme-machine/captions", body);
    expect(b.status).toBe(200);
    expect(b.json?.["replayed"]).toBe(true);
    expect(b.json?.["captions"]).toEqual(a.json?.["captions"]);
    expect(b.json?.["creditsRemaining"]).toBe(a.json?.["creditsRemaining"]);
    expect(h.charges).toHaveLength(1);
    expect(h.memeCalls).toBe(1);
  });

  it("provider failure refunds + voids; the retry charges fresh and succeeds", async () => {
    h.memeMode = "throw";
    const a = await post("/meme-machine/captions", body);
    expect(a.status).toBe(502);
    expect(h.refunds).toEqual([100]);
    expect(h.voids).toHaveLength(1);
    expect(h.balance).toBe(100_000);
    expect(h.stored.size).toBe(0);

    h.memeMode = "ok";
    const b = await post("/meme-machine/captions", body);
    expect(b.status).toBe(200);
    expect(b.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(2);
    expect(h.balance).toBe(100_000 - 100);
  });

  it("concurrent duplicates: one charge, one provider call, both honest", async () => {
    const [a, b] = await Promise.all([
      post("/meme-machine/captions", body),
      post("/meme-machine/captions", body),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(h.charges).toHaveLength(1);
    expect(h.memeCalls).toBe(1);
    expect([a.json?.["replayed"], b.json?.["replayed"]].filter((x) => x === true)).toHaveLength(1);
  });
});

describe("mix-plan — CA-4 replay hardening (charged path only)", () => {
  const body = { preset: "trap-soul", stems: [{ name: "Lead Vocal", type: "vocal" }] };

  it("fresh success charges once + provider once; identical re-ask replays from the table", async () => {
    const a = await post("/mix-plan", body);
    expect(a.status).toBe(200);
    expect(a.json?.["fallback"]).toBe(false);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(200);
    expect(h.mixPlanCalls).toBe(1);
    expect(h.stored.size).toBe(1);

    const b = await post("/mix-plan", body);
    expect(b.status).toBe(200);
    expect(b.json?.["replayed"]).toBe(true);
    expect(b.json?.["generatedAt"]).toBe(a.json?.["generatedAt"]);
    expect(h.charges).toHaveLength(1);
    expect(h.mixPlanCalls).toBe(1);
  });

  it("invalid provider output refunds + voids and still answers the free fallback; the retry charges fresh", async () => {
    h.mixPlanMode = "badjson";
    const a = await post("/mix-plan", body);
    expect(a.status).toBe(200);
    expect(a.json?.["fallback"]).toBe(true);
    expect(h.refunds).toEqual([200]);
    expect(h.voids).toHaveLength(1);
    expect(h.balance).toBe(100_000);
    expect(h.stored.size).toBe(0);

    h.mixPlanMode = "ok";
    const b = await post("/mix-plan", body);
    expect(b.status).toBe(200);
    expect(b.json?.["fallback"]).toBe(false);
    expect(b.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(2);
    expect(h.balance).toBe(100_000 - 200);
  });
});

describe("promo — CA-4 replay hardening", () => {
  const body = { topic: "my new single drops friday" };

  it("fresh success charges once + provider once; identical re-ask replays from the table", async () => {
    const a = await post("/generate-promo-clips", body);
    expect(a.status).toBe(200);
    expect(a.json?.["replayed"]).toBeUndefined();
    expect(a.json?.["result"]).toBe("PROMO PLAN TEXT");
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);
    expect(h.promoCalls).toBe(1);
    expect(h.stored.size).toBe(1);

    const b = await post("/generate-promo-clips", body);
    expect(b.status).toBe(200);
    expect(b.json?.["replayed"]).toBe(true);
    expect(b.json?.["result"]).toBe("PROMO PLAN TEXT");
    expect(h.charges).toHaveLength(1);
    expect(h.promoCalls).toBe(1);
  });

  it("provider failure refunds + voids; the retry charges fresh and succeeds", async () => {
    h.promoMode = "throw";
    const a = await post("/generate-promo-clips", body);
    expect(a.status).toBe(500);
    expect(h.refunds).toEqual([100]);
    expect(h.voids).toHaveLength(1);
    expect(h.balance).toBe(100_000);

    h.promoMode = "ok";
    const b = await post("/generate-promo-clips", body);
    expect(b.status).toBe(200);
    expect(b.json?.["replayed"]).toBeUndefined();
    expect(h.charges).toHaveLength(2);
    expect(h.balance).toBe(100_000 - 100);
  });
});
