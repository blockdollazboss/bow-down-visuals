/**
 * Stack300 plans-boosts — POST /posts/assist funding order.
 *
 * Plan terms have always included monthly AI promotion boosts
 * (Free 3 / Pro 25 / Elite 100 — TIER_AI_BOOSTS, ratified plan
 * terms), but until this lane no rail consumed one: Post Assist
 * charged everyone a flat 100 Visual Bucs. These tests pin the
 * funding order the build implements:
 *   - a member with boosts left pays ONE boost, never Bucs;
 *   - consumption is exactly-once per request (the assist's own
 *     charge idempotency key keys the boost ledger too);
 *   - past the allowance, the unchanged flat 100 VB charge applies;
 *   - a provider failure after consumption gives the boost back;
 *   - admins bypass the counter entirely (admin-unrestricted
 *     ruling) and take the unchanged charge path;
 *   - a boosts-ledger failure degrades to the charge path.
 * The charge-path contract itself (price, credit refund, key void)
 * stays pinned in social-assist-refund.test.ts.
 *
 * Stack400 C-03 note: the rail now persists each success in
 * post_assist_results and answers duplicate submits from the stored
 * row, so this file's db fake models that one table for real (the
 * double-submit pin below asserts the replayed stored draft). The
 * concurrency + replay-shape pins live in
 * social-assist-stored-results.test.ts.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  charges: [] as Array<{ amount: number; idempotencyKey?: string }>,
  refunds: [] as Array<{ amount: number; action?: string }>,
  voidedKeys: [] as string[],
  chargedKeys: new Set<string>(),
  aiMode: "ok" as "ok" | "throw",
  chargeMode: "ok" as "ok" | "broke",
  tier: "free" as "free" | "pro" | "elite",
  isAdmin: false,
  ledgerDown: false,
  /* In-memory boost ledger: idempotencyKey -> period ('YYYY-MM'). */
  boostRows: new Map<string, string>(),
  consumeCalls: 0,
  boostRefunds: [] as string[],
  /* The post_assist_results store (Stack400 C-03), keyed by
     idempotency key — the fake @workspace/db below reads/writes it
     for that one table; every other table keeps the generic chain. */
  assistStored: new Map<string, { userId: string; result: any }>(),
}));

const currentPeriod = () => new Date().toISOString().slice(0, 7);

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = "user-1";
    req.userCredits = 100_000;
    next();
  },
}));

vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error {}
  return {
  chargeCredits: vi.fn(async (_u: string, amount: number, _meta: any, opts: any) => {
    if (h.chargeMode === "broke") {
      throw new OutOfCreditsError();
    }
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
          if (h.aiMode === "throw") throw new Error("provider down");
          return { choices: [{ message: { content: "Golden hour, golden sound." } }] };
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
    resolveCreatorTier: async () => ({ tier: h.tier, profileId: "profile-1" }),
  };
});

vi.mock("../../lib/admin", async (importOriginal) => {
  const real = await importOriginal<any>();
  return { ...real, isAdminUserId: async () => h.isAdmin };
});

/* The boosts lib, re-implemented over an in-memory ledger with the
   REAL tier quotas (imported from platform-fees) and the real
   decision function, so grant-by-tier is exercised against the
   ratified numbers, not a copy of them. */
vi.mock("../../lib/ai-boosts", async () => {
  const fees = await import("../../lib/platform-fees");
  const allowanceFor = (tier: string) =>
    (fees.TIER_AI_BOOSTS as Record<string, number>)[tier] ?? 0;
  const stateFor = (tier: string) => {
    const period = currentPeriod();
    const used = [...h.boostRows.values()].filter((p) => p === period).length;
    const allowance = allowanceFor(tier);
    return {
      tier,
      allowance,
      used,
      remaining: Math.max(0, allowance - used),
      period,
    };
  };
  return {
    fundingFor: ({ isAdmin, remaining }: { isAdmin: boolean; remaining: number }) =>
      isAdmin ? "admin" : remaining > 0 ? "boost" : "charge",
    getAiBoostState: async (_userId: string, tier: string) => {
      if (h.ledgerDown) throw new Error("ledger unavailable");
      return stateFor(tier);
    },
    tryConsumeAiBoost: async (_userId: string, tier: string, key: string) => {
      if (h.ledgerDown) throw new Error("ledger unavailable");
      h.consumeCalls += 1;
      const period = currentPeriod();
      if (h.boostRows.has(key)) {
        return { outcome: "replay", state: stateFor(tier) };
      }
      const state = stateFor(tier);
      if (state.remaining <= 0) return { outcome: "exhausted", state };
      h.boostRows.set(key, period);
      return { outcome: "consumed", state: stateFor(tier) };
    },
    refundAiBoost: async (_userId: string, key: string) => {
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

/* The stored-result lookup always goes BY KEY — recover it from
   the eq() the route built (drizzle parameterizes the value; it
   rides the condition's queryChunks as a Param node). */
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

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const chain: any = {
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
  };
  /* Stack400 C-03: post_assist_results gets a real key-aware fake —
     the rail persists each success there and answers replays from
     the row, so a harness that cannot store cannot see the rail's
     actual behavior. Every other table keeps the generic chain. */
  const storedSelect = {
    where: (cond: unknown) => ({
      limit: async () => {
        const key = keyFromCondition(cond);
        const row = key !== null ? h.assistStored.get(key) : undefined;
        return row ? [row] : [];
      },
    }),
  };
  const storedInsert = {
    values: (v: { idempotencyKey: string; userId: string; result: any }) => ({
      onConflictDoNothing: async () => {
        if (!h.assistStored.has(v.idempotencyKey)) {
          h.assistStored.set(v.idempotencyKey, { userId: v.userId, result: v.result });
        }
        return [];
      },
    }),
  };
  return {
    ...actual,
    db: {
      select: () => ({
        from: (table: unknown) => (table === actual.postAssistResultsTable ? storedSelect : chain),
      }),
      insert: (table: unknown) =>
        table === actual.postAssistResultsTable ? storedInsert : { values: async () => [] },
      update: () => ({ set: () => ({ where: async () => [] }) }),
      delete: () => ({ where: async () => [] }),
    },
  };
});

import socialRouter from "../social";

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
  h.aiMode = "ok";
  h.chargeMode = "ok";
  h.tier = "free";
  h.isAdmin = false;
  h.ledgerDown = false;
  h.boostRows = new Map();
  h.consumeCalls = 0;
  h.boostRefunds = [];
  h.assistStored = new Map();
});

async function assist(prompt = "my new single drops friday") {
  const res = await fetch(`${baseUrl}/posts/assist`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, tone: "hype" }),
  });
  const body = (await res.json().catch(() => ({}))) as any;
  return { status: res.status, body };
}

function seedUsedBoosts(n: number) {
  const period = currentPeriod();
  for (let i = 0; i < n; i++) h.boostRows.set(`seed-${i}`, period);
}

describe("POST /posts/assist — boost funding order", () => {
  it("a Free member with boosts left pays one boost, not Bucs", async () => {
    const { status, body } = await assist();
    expect(status).toBe(200);
    expect(body.draft).toBe("Golden hour, golden sound.");
    expect(h.charges).toEqual([]);
    expect(h.boostRows.size).toBe(1);
    expect(body.boost).toEqual({ applied: true, allowance: 3, used: 1, remaining: 2 });
  });

  it("a double-submit of the same draft consumes exactly one boost", async () => {
    const first = await assist();
    const second = await assist();
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(h.boostRows.size).toBe(1);
    expect(h.charges).toEqual([]);
    /* Stack400 C-03: the second submit is answered from the stored
       result of the first (same draft, marked replayed) — never a
       second generation for the one boost. */
    expect(second.body.draft).toBe(first.body.draft);
    expect(second.body.replayed).toBe(true);
    expect("replayed" in first.body).toBe(false);
  });

  it("past the Free allowance the flat 100 VB charge applies", async () => {
    seedUsedBoosts(3);
    const { status, body } = await assist();
    expect(status).toBe(200);
    expect(h.charges).toEqual([{ amount: 100, idempotencyKey: expect.any(String) }]);
    expect(body.boost).toEqual({ applied: false, allowance: 3, used: 3, remaining: 0 });
  });

  it("grant-by-tier: a Pro member's 25-boost allowance covers what Free's 3 would not", async () => {
    h.tier = "pro";
    seedUsedBoosts(3);
    const { status, body } = await assist();
    expect(status).toBe(200);
    expect(h.charges).toEqual([]);
    expect(body.boost).toEqual({ applied: true, allowance: 25, used: 4, remaining: 21 });
  });

  it("a provider failure after consumption gives the boost back — no credit refund, no charge", async () => {
    h.aiMode = "throw";
    const failed = await assist();
    expect(failed.status).toBe(500);
    expect(h.boostRows.size).toBe(0);
    expect(h.boostRefunds.length).toBe(1);
    expect(h.refunds).toEqual([]);
    expect(h.charges).toEqual([]);
    /* And the retry is boost-funded again, not charged for the failure. */
    h.aiMode = "ok";
    const retry = await assist();
    expect(retry.status).toBe(200);
    expect(retry.body.boost.applied).toBe(true);
    expect(h.charges).toEqual([]);
  });

  it("admins bypass the counter entirely and take the unchanged charge path", async () => {
    h.isAdmin = true;
    const { status } = await assist();
    expect(status).toBe(200);
    expect(h.consumeCalls).toBe(0);
    expect(h.boostRows.size).toBe(0);
    expect(h.charges).toEqual([{ amount: 100, idempotencyKey: expect.any(String) }]);
  });

  it("a boosts-ledger failure degrades to the charge path", async () => {
    h.ledgerDown = true;
    const { status, body } = await assist();
    expect(status).toBe(200);
    expect(body.draft).toBe("Golden hour, golden sound.");
    expect(h.charges).toEqual([{ amount: 100, idempotencyKey: expect.any(String) }]);
    expect(body.boost).toBeNull();
  });

  it("out of boosts AND out of Bucs is the unchanged 402", async () => {
    seedUsedBoosts(3);
    h.chargeMode = "broke";
    const { status, body } = await assist();
    expect(status).toBe(402);
    expect(body.error).toBe("out_of_credits");
    expect(body.message).toContain("100 Visual Bucs");
  });
});
