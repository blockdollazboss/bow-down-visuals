/**
 * Stack400 C-03 / C-36 — POST /posts/assist stored results.
 *
 * Before this lane: both ledgers (credits, AI boosts) deduped the
 * (prompt, tone) intent key, but the route treated a ledger "replay"
 * outcome as funded and ran the provider AGAIN — a duplicate that
 * arrived mid-call produced two different drafts for one boost or
 * one 100 VB charge, and a member re-asking the same prompt+tone
 * later was never told why the words came back the same.
 *
 * These tests fake the credits/boost/provider seams and the stored-
 * result table at their module boundaries and pin:
 *   - a concurrent duplicate pair = ONE funding, ONE provider call,
 *     both callers answered, the twin served the SAME draft marked
 *     replayed: true (charge path and boost path);
 *   - a sequential replay is served the stored draft verbatim plus
 *     exactly one added field (replayed: true) — no second funding,
 *     no second provider call (the C-36 response-shape pin);
 *   - a boost-ledger replay with no stored draft yet answers an
 *     honest 409 (never a second generation for the one boost), and
 *     serves the draft once it has landed;
 *   - a stored-result write failure is fail-open (the paid success
 *     still answers; a later replay regenerates under the one
 *     landed charge);
 *   - a twin of a FAILED generation falls through fresh after the
 *     first request's refund + key void.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const USER = "user-1";

const h = vi.hoisted(() => ({
  charges: [] as Array<{ amount: number; idempotencyKey?: string }>,
  refunds: [] as Array<{ amount: number; action?: string }>,
  voidedKeys: [] as string[],
  chargedKeys: new Set<string>(),
  /* In-memory boost ledger: idempotencyKey -> period. */
  boostRows: new Map<string, string>(),
  boostRefunds: [] as string[],
  /* When true, the caller's allowance reads as spent (remaining 0),
     so the route takes the CHARGE path — the charge-path tests set
     this; the boost-path tests leave it false. */
  boostExhausted: false,
  /* The post_assist_results store, keyed by idempotency key. */
  stored: new Map<string, { userId: string; result: any }>(),
  /* When "throw", the stored-result write fails (fail-open pin). */
  storeMode: "ok" as "ok" | "throw",
  /* The next N stored-result selects answer "empty" regardless —
     orchestrates the draft landing between the two checks. */
  selectMisses: 0,
  aiMode: "ok" as "ok" | "throw",
  failFirstProviderCall: false,
  providerCalls: 0,
  providerSeq: 0,
  /* One-shot provider gate: the FIRST provider call parks until the
     test releases it, so a true concurrent pair can be staged. */
  gate: null as null | {
    wait: Promise<void>;
    release: () => void;
    entered: Promise<void>;
    markEntered: () => void;
  },
}));

function armGate() {
  let release!: () => void;
  let markEntered!: () => void;
  const wait = new Promise<void>((r) => {
    release = r;
  });
  const entered = new Promise<void>((r) => {
    markEntered = r;
  });
  h.gate = { wait, release, entered, markEntered };
}

/* The route always looks up BY KEY — recover the key from the eq()
   the route built (drizzle parameterizes the value; it rides the
   condition's queryChunks as a Param node). Same walker as the
   contract rail's stored-result fake. */
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
    req.userCredits = 100_000;
    next();
  },
}));

vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error {}
  return {
    chargeCredits: vi.fn(async (_u: string, amount: number, _meta: any, opts: any) => {
      const key = opts?.idempotencyKey as string | undefined;
      if (key) {
        if (h.chargedKeys.has(key)) return 4242;
        h.chargedKeys.add(key);
      }
      h.charges.push({ amount, idempotencyKey: key });
      return 4242;
    }),
    refundCredits: vi.fn(async (_u: string, amount: number, meta: any) => {
      h.refunds.push({ amount, action: meta?.action });
    }),
    buildChargeIdempotencyKey: (
      scope: string,
      userId: string,
      clientKey: string | null | undefined,
      intent: Record<string, unknown>,
    ) =>
      clientKey
        ? `${scope}:${userId}:client:${clientKey}`
        : `${scope}:${userId}:auto:${JSON.stringify(intent)}`,
    voidChargeIdempotencyKey: vi.fn(async (key: string) => {
      h.voidedKeys.push(key);
      h.chargedKeys.delete(key);
    }),
    OutOfCreditsError,
    LedgerWriteError: class LedgerWriteError extends Error {},
  };
});

vi.mock("../../lib/ai-clients", () => ({
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => {
          h.providerCalls++;
          const gate = h.gate;
          if (gate) {
            h.gate = null;
            gate.markEntered();
            await gate.wait;
          }
          if (h.failFirstProviderCall) {
            h.failFirstProviderCall = false;
            throw new Error("provider down");
          }
          if (h.aiMode === "throw") throw new Error("provider down");
          h.providerSeq++;
          /* Each real generation carries a sequence marker, so "the
             replay returned the same draft" can only pass if the
             stored result was actually served. */
          return { choices: [{ message: { content: `Golden draft ${h.providerSeq}.` } }] };
        },
      },
    },
  }),
  getTextModel: () => "test-model",
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => null,
  addCreditsToProfile: async () => undefined,
}));

vi.mock("../../middlewares/require-tier", async (importOriginal) => {
  const real = await importOriginal<any>();
  return {
    ...real,
    resolveCreatorTier: async () => ({ tier: "free", profileId: "profile-1" }),
  };
});

vi.mock("../../lib/admin", async (importOriginal) => {
  const real = await importOriginal<any>();
  return { ...real, isAdminUserId: async () => false };
});

/* The boosts lib over the in-memory ledger, with the free tier's
   real allowance (3). State is derived from the rows, exactly like
   the real ledger derives it from the table. */
vi.mock("../../lib/ai-boosts", () => {
  const state = () => {
    const used = h.boostRows.size;
    const remaining = h.boostExhausted ? 0 : Math.max(0, 3 - used);
    return { tier: "free" as const, allowance: 3, used, remaining, period: "2026-11" };
  };
  return {
    fundingFor: ({ isAdmin, remaining }: { isAdmin: boolean; remaining: number }) =>
      isAdmin ? "admin" : remaining > 0 ? "boost" : "charge",
    getAiBoostState: async () => state(),
    tryConsumeAiBoost: async (_u: string, _tier: string, key: string) => {
      if (h.boostRows.has(key)) return { outcome: "replay" as const, state: state() };
      if (h.boostRows.size >= 3) return { outcome: "exhausted" as const, state: state() };
      h.boostRows.set(key, "2026-11");
      return { outcome: "consumed" as const, state: state() };
    },
    refundAiBoost: async (_u: string, key: string) => {
      h.boostRefunds.push(key);
      h.boostRows.delete(key);
    },
  };
});

vi.mock("../../lib/payment-record", () => ({
  recordCreditUsageStrict: async () => undefined,
}));

vi.mock("../../lib/social-crypto", () => ({
  encryptToken: (s: string) => s,
  decryptToken: (s: string) => s,
  isSocialTokenKeyConfigured: () => false,
}));

vi.mock("../../lib/social-meta", () => ({
  buildAuthUrl: () => "",
  buildFacebookAuthUrl: () => "",
  exchangeCodeForLongLivedToken: async () => {
    throw new Error("no Meta in route tests");
  },
  exchangeFacebookCodeForLongLivedToken: async () => {
    throw new Error("no Meta in route tests");
  },
  fetchInstagramProfile: async () => {
    throw new Error("no Meta in route tests");
  },
  listPages: async () => [],
  publishReelToInstagram: async () => {
    throw new Error("no Meta in route tests");
  },
  publishVideoToPage: async () => {
    throw new Error("no Meta in route tests");
  },
  MetaApiError: class MetaApiError extends Error {},
}));

vi.mock("../../lib/social-idempotency", () => ({
  claimPublishAttempt: async () => ({ claimed: true }),
  createDrizzleAttemptStore: () => ({}),
}));

vi.mock("../../lib/social-tiktok", () => ({
  buildTikTokAuthUrl: () => "",
  exchangeCodeForTikTokTokens: async () => {
    throw new Error("no TikTok in route tests");
  },
  refreshTikTokTokens: async () => {
    throw new Error("no TikTok in route tests");
  },
  fetchTikTokUserInfo: async () => {
    throw new Error("no TikTok in route tests");
  },
  uploadDraftToTikTok: async () => {
    throw new Error("no TikTok in route tests");
  },
  downloadVideoBytes: async () => new Uint8Array(),
  TikTokApiError: class TikTokApiError extends Error {},
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
  refreshSupabaseStorageUrlsDeep: async (v: unknown) => v,
  isStorageRef: () => false,
}));

vi.mock("../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: async (v: unknown) => v,
  isExternalHttpUrl: (v: unknown) => typeof v === "string" && /^https?:\/\//i.test(v),
  isPermanentMediaValue: () => false,
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

/* The stored-result seam (C-03): @workspace/db is replaced with a
   key-aware fake over h.stored. The assist route's only db uses are
   the post-assist-results select-by-key and the conflict-do-nothing
   insert, so the fake models exactly those two chains; the table
   objects stay the real (inert) ones. */
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const fakeDb = {
    select: () => ({
      from: () => ({
        where: (cond: unknown) => ({
          limit: async () => {
            if (h.selectMisses > 0) {
              h.selectMisses--;
              return [];
            }
            const key = keyFromCondition(cond);
            const row = key !== null ? h.stored.get(key) : undefined;
            return row ? [row] : [];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: { idempotencyKey: string; userId: string; result: any }) => ({
        onConflictDoNothing: async () => {
          if (h.storeMode === "throw") throw new Error("store write failed");
          if (!h.stored.has(v.idempotencyKey)) {
            h.stored.set(v.idempotencyKey, { userId: v.userId, result: v.result });
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

import socialRouter from "../social";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  });
  app.use(socialRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  h.charges = [];
  h.refunds = [];
  h.voidedKeys = [];
  h.chargedKeys = new Set();
  h.boostRows = new Map();
  h.boostRefunds = [];
  h.boostExhausted = false;
  h.stored = new Map();
  h.storeMode = "ok";
  h.selectMisses = 0;
  h.aiMode = "ok";
  h.failFirstProviderCall = false;
  h.providerCalls = 0;
  h.providerSeq = 0;
  h.gate = null;
  vi.clearAllMocks();
});

async function post(path: string, body: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

const BODY = { prompt: "my new single drops Friday", tone: "hype" };
const KEY = `post_assist:${USER}:auto:${JSON.stringify(BODY)}`;

describe("POST /posts/assist — stored results (Stack400 C-03/C-36)", () => {
  it("concurrent duplicate pair (charge path): one charge, one provider call, both answered, twin marked replayed", async () => {
    h.boostExhausted = true;
    armGate();
    const gate = h.gate!;
    const firstPromise = post("/posts/assist", BODY);
    await gate.entered; // the first request is parked mid-generation
    const twinPromise = post("/posts/assist", BODY);
    await new Promise((r) => setTimeout(r, 50)); // let the twin reach its wait
    expect(h.providerCalls).toBe(1);
    gate.release();
    const [first, twin] = await Promise.all([firstPromise, twinPromise]);
    expect(first.status).toBe(200);
    expect(twin.status).toBe(200);
    expect(h.providerCalls).toBe(1);
    expect(h.charges).toHaveLength(1);
    expect(h.charges[0]!.amount).toBe(100);
    expect("replayed" in first.json).toBe(false);
    expect(twin.json.replayed).toBe(true);
    expect(twin.json.draft).toBe(first.json.draft);
    expect(h.refunds).toEqual([]);
  });

  it("concurrent duplicate pair (boost path): one boost, one provider call, both answered, twin marked replayed", async () => {
    armGate();
    const gate = h.gate!;
    const firstPromise = post("/posts/assist", BODY);
    await gate.entered;
    const twinPromise = post("/posts/assist", BODY);
    await new Promise((r) => setTimeout(r, 50));
    expect(h.providerCalls).toBe(1);
    gate.release();
    const [first, twin] = await Promise.all([firstPromise, twinPromise]);
    expect(first.status).toBe(200);
    expect(twin.status).toBe(200);
    expect(h.providerCalls).toBe(1);
    expect(h.boostRows.size).toBe(1);
    expect(h.charges).toHaveLength(0);
    expect(first.json.boost.applied).toBe(true);
    expect("replayed" in first.json).toBe(false);
    expect(twin.json.replayed).toBe(true);
    expect(twin.json.draft).toBe(first.json.draft);
    expect(h.boostRefunds).toEqual([]);
  });

  it("sequential replay (charge path): stored draft verbatim + exactly one added field, no second charge or call", async () => {
    h.boostExhausted = true;
    const first = await post("/posts/assist", BODY);
    const second = await post("/posts/assist", BODY);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(h.providerCalls).toBe(1);
    expect(h.charges).toHaveLength(1);
    expect(second.json).toEqual({ ...first.json, replayed: true });
  });

  it("sequential replay (boost path): no second boost is consumed and no second call runs", async () => {
    const first = await post("/posts/assist", BODY);
    const second = await post("/posts/assist", BODY);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(h.providerCalls).toBe(1);
    expect(h.boostRows.size).toBe(1);
    expect(h.charges).toHaveLength(0);
    expect(second.json).toEqual({ ...first.json, replayed: true });
  });

  it("boost-ledger replay with no stored draft yet: honest 409, no generation, no charge", async () => {
    /* A twin in another process consumed the boost under this key;
       its generation has not landed a stored draft. */
    h.boostRows.set(KEY, "2026-11");
    const r = await post("/posts/assist", BODY);
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("assist_in_progress");
    expect(h.providerCalls).toBe(0);
    expect(h.charges).toHaveLength(0);
    expect(h.boostRows.size).toBe(1);
  });

  it("boost-ledger replay whose draft landed mid-flight: served from the store, no generation", async () => {
    h.boostRows.set(KEY, "2026-11");
    h.stored.set(KEY, {
      userId: USER,
      result: {
        draft: "Golden draft 1.",
        boost: { applied: true, allowance: 3, used: 1, remaining: 2 },
      },
    });
    h.selectMisses = 1; // the pre-funding check runs before the row "lands"
    const r = await post("/posts/assist", BODY);
    expect(r.status).toBe(200);
    expect(r.json.replayed).toBe(true);
    expect(r.json.draft).toBe("Golden draft 1.");
    expect(h.providerCalls).toBe(0);
    expect(h.charges).toHaveLength(0);
  });

  it("stored-result write failure is fail-open: the paid success still answers, a later replay regenerates under the one charge", async () => {
    h.boostExhausted = true;
    h.storeMode = "throw";
    const first = await post("/posts/assist", BODY);
    expect(first.status).toBe(200);
    expect("replayed" in first.json).toBe(false);
    const second = await post("/posts/assist", BODY);
    expect(second.status).toBe(200);
    expect("replayed" in second.json).toBe(false);
    expect(h.providerCalls).toBe(2);
    /* The ledger's landed key still suppresses the second charge. */
    expect(h.charges).toHaveLength(1);
    expect(h.refunds).toEqual([]);
  });

  it("a twin of a FAILED generation falls through fresh: first refunds + voids, twin funds and generates", async () => {
    h.boostExhausted = true;
    armGate();
    const gate = h.gate!;
    h.failFirstProviderCall = true;
    const firstPromise = post("/posts/assist", BODY);
    await gate.entered;
    const twinPromise = post("/posts/assist", BODY);
    await new Promise((r) => setTimeout(r, 50));
    expect(h.providerCalls).toBe(1);
    gate.release();
    const [first, twin] = await Promise.all([firstPromise, twinPromise]);
    expect(first.status).toBe(500);
    expect(first.json.error).toBe("assist_failed");
    expect(twin.status).toBe(200);
    expect("replayed" in twin.json).toBe(false);
    expect(twin.json.draft).toBe("Golden draft 1.");
    expect(h.providerCalls).toBe(2);
    /* The first request's charge was refunded + voided; the twin's
       fresh attempt charged for its own generation. */
    expect(h.refunds).toEqual([{ amount: 100, action: "post_assist — Refund (assist failed)" }]);
    expect(h.voidedKeys).toEqual([KEY]);
    expect(h.charges).toHaveLength(2);
  });
});
