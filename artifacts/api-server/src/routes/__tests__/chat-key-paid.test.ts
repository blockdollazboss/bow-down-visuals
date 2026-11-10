/**
 * chat-key — /api/chat PAID mode (CHAT_CREDIT_COST > 0), keyed.
 *
 * Owner ruling (Nov 10, 2026 — option (a), "key it anyway"): the
 * conditional per-message charge in routes/chat.ts is keyed +
 * stored-result backed (house Pattern A). Site chat stays FREE by
 * default — this suite pins only the env-enabled paid branch:
 *
 *   - fresh POST → 200, exactly one charge under the server-derived
 *     key (member + trimmed message + history), one provider call,
 *     one stored row, NO replay marker on the fresh body;
 *   - identical POST again → the stored body verbatim + replayed:true
 *     + the replay note, still one charge and one provider call —
 *     and still served when the balance has since dropped below the
 *     cost (the pre-check sits before the 402 gate);
 *   - two identical SIMULTANEOUS POSTs → one charge, one provider
 *     call, one bare body and one replayed body;
 *   - provider failure after the charge → the 500, a refund AND a
 *     void of the request's key, no stored row; the same message
 *     retried healthy charges FRESH (a second charge) and succeeds;
 *   - the operator action-turn body is stored and replayed like any
 *     other paid answer (no second provider/operator run);
 *   - same message with a different history is a different purchase.
 *
 * Harness: the REAL lib/credits + lib/payment-record +
 * lib/generation-stored-results over pg-mem (the CA-1 shape), an
 * in-memory supabase profile for balances, the REAL
 * buildChargeIdempotencyKey for expected keys, a fake model client,
 * and the operator-chat layer stubbed to its no-action state (the
 * operator protocol has its own suites; this one pins the rail).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { createTestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";

/* pg-mem enforces uuid columns for real: the auth user id must be a
   uuid, and the stored-results / ledger keys embed it verbatim. */
const USER = "11111111-1111-4111-8111-111111111111";
const COST = 5;

const h = vi.hoisted(() => {
  process.env.CHAT_CREDIT_COST = "5";
  return {
    charges: [] as Array<{ amount: number; key: string }>,
    refunds: [] as number[],
    voids: [] as string[],
    storedKeys: [] as string[],
    providerCalls: 0,
    providerMode: "ok" as "ok" | "throw",
    providerDelayMs: 0,
    actionTurn: null as null | { replyText: string; action: unknown },
    replyCalls: 0,
    db: null as any,
    profile: null as null | { id: string; credits: number; bonus_credits: number; bonus_credits_expires_at: string | null },
    seenKeys: new Map<string, string>(),
    mem: null as any,
  };
});

const MODEL_REPLY = "All good, fin-friend.";

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = USER;
    req.userCredits = h.profile?.credits ?? 0;
    req.log = { info() {}, error() {}, warn() {} };
    next();
  },
}));

vi.mock("../../lib/supabase-admin", () => ({
  /* In-memory profiles table for the REAL credits module: balances
     live here, keyed by user id. */
  getSupabaseAdmin: () => ({
    from: (_table: string) => {
      let mode: "select" | "update" | "insert" = "select";
      let pending: Record<string, unknown> = {};
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        update: (vals: Record<string, unknown>) => { mode = "update"; pending = vals; return chain; },
        insert: (vals: Record<string, unknown>) => { mode = "insert"; pending = vals; return chain; },
        single: async () => {
          if (mode === "update") {
            const cur = h.profile ?? { id: USER, credits: 0, bonus_credits: 0, bonus_credits_expires_at: null };
            h.profile = { ...cur, ...pending };
            return { data: null, error: null };
          }
          if (!h.profile) return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
          return { data: { ...h.profile }, error: null };
        },
        then: (res: any, rej: any) => {
          /* The real deduction awaits .update().eq() with NO .single()
             — the write lands through the chain's own resolution, so
             the fake must apply it here (the CA-1 copy this harness
             started from only applied updates via .single(), silently
             dropping every deduction; completed faithfully — the real
             supabase update persists). */
          if (mode === "update") {
            const cur = h.profile ?? { id: USER, credits: 0, bonus_credits: 0, bonus_credits_expires_at: null };
            h.profile = { ...cur, ...pending };
          }
          if (mode === "insert") {
            h.profile = { id: USER, credits: 0, bonus_credits: 0, bonus_credits_expires_at: null, ...(pending as any) };
          }
          return Promise.resolve({ data: null, error: null }).then(res, rej);
        },
      };
      return chain;
    },
  }),
  addCreditsToProfile: async (_userId: string, creditsToAdd: number) => {
    const cur = h.profile ?? { id: USER, credits: 0, bonus_credits: 0, bonus_credits_expires_at: null };
    const newCredits = (cur.credits ?? 0) + creditsToAdd;
    h.profile = { ...cur, credits: newCredits };
    return { oldCredits: cur.credits ?? 0, newCredits, created: false };
  },
}));

vi.mock("../../lib/admin", () => ({
  isAdminUserId: () => false,
  isAdminRequest: () => false,
}));

/* payment-record (real, pulled in by credits.ts) imports push-events,
   which imports the web-push stack — leaf-stub it. */
vi.mock("../../lib/push-events", () => ({
  notifyUserEvent: async () => {},
}));

vi.mock("../../lib/payment-record", async (importOriginal) => {
  /* Keep the REAL module (credits.ts's ledger write rides it) and stub
     only the generation-history helpers. The real
     recordCreditUsageStrict is wrapped ONLY to observe, at the moment
     a charge row is written, the key it was written with — chat
     charges, fails and voids inside ONE request, so without a
     charge-time observation the key is already NULL at the first
     post-request sync and a landed void is indistinguishable from a
     charge that never carried a key (the join16 CA-1 harness fix). */
  const actual = await importOriginal<any>();
  return {
    ...actual,
    recordCreditUsageStrict: async (record: any) => {
      const outcome = await actual.recordCreditUsageStrict(record);
      if (record?.creditsUsed > 0 && record?.idempotencyKey && h.db) {
        try {
          const { sql } = await import("drizzle-orm");
          const r: any = await h.db.execute(sql`SELECT id FROM credit_usage WHERE idempotency_key = ${record.idempotencyKey} LIMIT 1`);
          const rows = (r?.rows ?? r) as any[];
          if (rows[0]) h.seenKeys.set(String(rows[0].id), String(record.idempotencyKey));
        } catch { /* observation only — never disturb the real write */ }
      }
      return outcome;
    },
    recordGenerationHistory: async () => "hist-1",
    markGenerationHistoryCharged: async () => {},
  };
});

/* The pg-mem db has NO `teams` table — the REAL lib/teams lookup would
   throw before any ledger logic. Teamless user, exactly as the CA-1
   harness pins it. */
vi.mock("../../lib/teams", () => ({
  getUserActiveTeam: async () => null,
  deductTeamCredits: async () => { throw new Error("deductTeamCredits must not be called on the personal-balance path"); },
}));

vi.mock("../../lib/ai-clients", () => ({
  getTextModel: () => "test-model",
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
  getOpenAI: () => ({
    chat: {
      completions: {
        create: async () => {
          h.providerCalls++;
          if (h.providerDelayMs > 0) {
            await new Promise((r) => setTimeout(r, h.providerDelayMs));
          }
          if (h.providerMode === "throw") throw new Error("provider down");
          return { choices: [{ message: { content: MODEL_REPLY } }] };
        },
      },
    },
  }),
}));

/* The operator protocol has its own suites — here it sits in its
   no-pending-action / no-intent / no-marker state, except when a test
   arms an action turn. */
vi.mock("../../lib/operator-chat", () => ({
  buildReplyDoors: () => [],
  processOperatorPreTurn: async () => null,
  processOperatorIntentTurn: async () => null,
  processOperatorReply: async () => {
    h.replyCalls++;
    return h.actionTurn;
  },
}));

vi.mock("../../lib/rate-limit", () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return {
    publicApiLimiter: pass,
    generationLimiter: pass,
    freeAiLimiter: pass,
    chatVoiceTranscribeLimiter: pass,
    freeExpensiveAiLimiter: pass,
    reportWriteLimiter: pass,
    apiKeyLimiter: pass,
    apiKeyGenerationLimiter: pass,
    isWorldStaticAssetPath: () => false,
    skipWorldStaticAssets: () => false,
  };
});

vi.mock("../../lib/logger", () => ({
  logger: { info() {}, error() {}, warn() {}, debug() {} },
}));

/* The REAL pg-mem database: the real credits / payment-record /
   generation-stored-results modules run against it. */
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    get db() { return h.db; },
  };
});

const MONEY_DDL = `
CREATE TABLE credit_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  action text NOT NULL,
  credits_used integer NOT NULL,
  project_id uuid,
  team_id uuid,
  bonus_credits_used integer,
  bonus_expires_at timestamptz,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX credit_usage_idempotency_key_uidx ON credit_usage (idempotency_key);
CREATE TABLE generation_stored_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  rail text NOT NULL,
  idempotency_key text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX generation_stored_results_idempotency_key_uidx ON generation_stored_results (idempotency_key);
`;

/* Re-derive the assertion trackers from the REAL ledger + stored
   table (CA-1 shape): a voided charge's key reads back NULL, so voids
   are recovered from the keys remembered at charge-write time. */
async function rowsOf(q: ReturnType<typeof sql>) {
  const r: any = await h.db.execute(q);
  return (r?.rows ?? r) as any[];
}
async function syncTrackers() {
  const charges = await rowsOf(sql`SELECT id, credits_used AS amount, idempotency_key AS key FROM credit_usage WHERE credits_used > 0`);
  const refunds = await rowsOf(sql`SELECT credits_used FROM credit_usage WHERE credits_used < 0 ORDER BY created_at`);
  const stored = await rowsOf(sql`SELECT idempotency_key FROM generation_stored_results ORDER BY created_at`);
  const voids: string[] = [];
  h.charges = charges.map((c: any) => {
    const id = String(c.id);
    const liveKey = c.key == null ? null : String(c.key);
    if (liveKey) h.seenKeys.set(id, liveKey);
    const madeWith = liveKey ?? h.seenKeys.get(id) ?? "";
    if (!liveKey && h.seenKeys.has(id)) voids.push(h.seenKeys.get(id)!);
    return { amount: Number(c.amount), key: madeWith };
  });
  h.voids = voids;
  h.refunds = refunds.map((r: any) => Math.abs(Number(r.credits_used)));
  h.storedKeys = stored.map((s: any) => String(s.idempotency_key));
}

import chatRouter, { CHAT_REPLAY_NOTE } from "../chat";
import { buildChargeIdempotencyKey } from "../../lib/credits";

let server: any;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", chatRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(async () => {
  const t = createTestDb();
  /* pg-mem has no gen_random_uuid() built in — register it (the
     drizzle defaultRandom() inserts rely on the column default). */
  t.mem.public.registerFunction({
    name: "gen_random_uuid",
    args: [],
    returns: "uuid" as never,
    impure: true,
    implementation: () => randomUUID(),
  });
  t.mem.public.none(MONEY_DDL);
  h.db = t.db; h.mem = t.mem;
  h.profile = { id: USER, credits: 100, bonus_credits: 0, bonus_credits_expires_at: null };
  h.seenKeys = new Map();
  h.charges = []; h.refunds = []; h.voids = []; h.storedKeys = [];
  h.providerCalls = 0; h.providerMode = "ok"; h.providerDelayMs = 0;
  h.actionTurn = null; h.replyCalls = 0;
});

async function postChat(body: Record<string, unknown>) {
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

function expectedKey(message: string, history: unknown[] = []) {
  return buildChargeIdempotencyKey("chat", USER, null, { message, history });
}

describe("POST /api/chat — paid mode, keyed (chat-key)", () => {
  it("fresh POST charges once under the derived key; the identical repeat is a stored replay", async () => {
    const msg = "How do I grow my channel?";
    const first = await postChat({ message: msg });
    expect(first.status).toBe(200);
    expect(first.json.reply).toBe(MODEL_REPLY);
    expect(first.json.creditCost).toBe(COST);
    expect(first.json.replayed).toBeUndefined();

    await syncTrackers();
    expect(h.charges).toEqual([{ amount: COST, key: expectedKey(msg) }]);
    expect(h.providerCalls).toBe(1);
    expect(h.storedKeys).toEqual([expectedKey(msg)]);
    expect(h.profile?.credits).toBe(95);

    const second = await postChat({ message: msg });
    expect(second.status).toBe(200);
    expect(second.json.reply).toBe(MODEL_REPLY);
    expect(second.json.creditCost).toBe(COST);
    expect(second.json.replayed).toBe(true);
    expect(second.json.replayNote).toBe(CHAT_REPLAY_NOTE);

    await syncTrackers();
    expect(h.charges).toEqual([{ amount: COST, key: expectedKey(msg) }]);
    expect(h.providerCalls).toBe(1);
    expect(h.profile?.credits).toBe(95);
  });

  it("a paid replay is served even after the balance drops below the cost (pre-check before the 402 gate)", async () => {
    const msg = "What should I post this week?";
    const first = await postChat({ message: msg });
    expect(first.status).toBe(200);

    /* The member spends the rest elsewhere — balance now 0. */
    h.profile = { ...h.profile!, credits: 0 };

    const replay = await postChat({ message: msg });
    expect(replay.status).toBe(200);
    expect(replay.json.replayed).toBe(true);
    expect(replay.json.reply).toBe(MODEL_REPLY);

    /* A genuinely new message still hits the 402 gate, uncharged. */
    const fresh = await postChat({ message: "A brand new question?" });
    expect(fresh.status).toBe(402);
    expect(fresh.json.error).toBe("out_of_credits");

    await syncTrackers();
    expect(h.charges).toEqual([{ amount: COST, key: expectedKey(msg) }]);
    expect(h.providerCalls).toBe(1);
  });

  it("two identical simultaneous POSTs share one run: one charge, one provider call", async () => {
    const msg = "Help me plan a launch video.";
    h.providerDelayMs = 75;
    const [a, b] = await Promise.all([postChat({ message: msg }), postChat({ message: msg })]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.json.reply).toBe(MODEL_REPLY);
    expect(b.json.reply).toBe(MODEL_REPLY);
    const replayedCount = [a.json, b.json].filter((j) => j.replayed === true).length;
    expect(replayedCount).toBe(1);

    await syncTrackers();
    expect(h.charges).toEqual([{ amount: COST, key: expectedKey(msg) }]);
    expect(h.providerCalls).toBe(1);
    expect(h.profile?.credits).toBe(95);
  });

  it("provider failure refunds AND voids the key; the retry charges fresh and succeeds", async () => {
    const msg = "Write me a hook for a cooking short.";
    h.providerMode = "throw";
    const failed = await postChat({ message: msg });
    expect(failed.status).toBe(500);

    await syncTrackers();
    expect(h.charges).toEqual([{ amount: COST, key: expectedKey(msg) }]);
    expect(h.refunds).toEqual([COST]);
    expect(h.voids).toEqual([expectedKey(msg)]);
    expect(h.storedKeys).toEqual([]);
    expect(h.profile?.credits).toBe(100);

    h.providerMode = "ok";
    const retry = await postChat({ message: msg });
    expect(retry.status).toBe(200);
    expect(retry.json.reply).toBe(MODEL_REPLY);
    expect(retry.json.replayed).toBeUndefined();

    await syncTrackers();
    /* Two charge rows total: the voided first attempt + the fresh
       retry, whose key is live again. */
    expect(h.charges).toHaveLength(2);
    expect(h.charges.filter((c) => c.key === expectedKey(msg))).toHaveLength(2);
    expect(h.voids).toEqual([expectedKey(msg)]);
    expect(h.storedKeys).toEqual([expectedKey(msg)]);
    expect(h.providerCalls).toBe(2);
    expect(h.profile?.credits).toBe(95);
  });

  it("the operator action-turn body is stored and replayed without a second run", async () => {
    const msg = "Turn on my quest reminders.";
    h.actionTurn = { replyText: "Done — quest reminders are on.", action: { kind: "demo-action" } };
    const first = await postChat({ message: msg });
    expect(first.status).toBe(200);
    expect(first.json.reply).toBe("Done — quest reminders are on.");
    expect(first.json.action).toEqual({ kind: "demo-action" });
    expect(first.json.replayed).toBeUndefined();
    expect(h.replyCalls).toBe(1);

    const second = await postChat({ message: msg });
    expect(second.status).toBe(200);
    expect(second.json.replayed).toBe(true);
    expect(second.json.reply).toBe("Done — quest reminders are on.");
    expect(second.json.action).toEqual({ kind: "demo-action" });

    await syncTrackers();
    expect(h.charges).toEqual([{ amount: COST, key: expectedKey(msg) }]);
    expect(h.providerCalls).toBe(1);
    expect(h.replyCalls).toBe(1);
  });

  it("the same message with a different history is a different purchase", async () => {
    const msg = "How do I grow my channel?";
    const first = await postChat({ message: msg });
    expect(first.status).toBe(200);

    const history = [
      { role: "user", content: "Earlier question" },
      { role: "assistant", content: "Earlier answer" },
    ];
    const second = await postChat({ message: msg, history });
    expect(second.status).toBe(200);
    expect(second.json.replayed).toBeUndefined();

    await syncTrackers();
    expect(h.charges).toHaveLength(2);
    expect(h.charges.map((c) => c.key).sort()).toEqual(
      [expectedKey(msg), expectedKey(msg, history)].sort(),
    );
    expect(h.providerCalls).toBe(2);
    expect(h.profile?.credits).toBe(90);
  });
});
