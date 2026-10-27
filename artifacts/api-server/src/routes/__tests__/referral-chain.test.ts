/**
 * referral-chain.test.ts — the full referral rail, end to end, over a
 * fake Supabase (the routes' real store) + a spy credit_usage ledger.
 *
 * Live failure (payments Pass 0, Oct 24 2026): B signed up through A's
 * link, bought a pack, and NOTHING on the referral rail moved — no
 * referrals row, no referee grant from the rail, no 25% award, Promoter
 * HQ at zero. Root causes (see .lane/DIAGNOSIS.md): the frontend fired
 * /apply before a session existed and deleted the code first; the award
 * was only called from the webhook's claim-winning branch; grants wrote
 * no credit_usage rows. This suite pins the SERVER side of the fixed
 * chain:
 *
 *   apply → referrals row with the 1,000 welcome PENDING (rung 3: a bare
 *         signup grants nothing) → creator-profile creation fires the
 *         grant exactly once (ledger key `referral-welcome:<userId>`)
 *         → second apply is a 400, nothing double-grants
 *         → plus-address alias of a claimed mailbox (rung 2): withheld
 *   purchase award → referrer +250 exactly once per Stripe session
 *         → repeat award for the same session pays nothing more
 *   Promoter HQ (/referrals/me) → sees the join and the 250
 *   ledger failure → grant rolls back AND the claim is released, so a
 *         retry succeeds (no burned, unpaid claims on either side)
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";

const A = "11111111-1111-4111-8111-111111111111"; // referrer (the owner role)
const B = "22222222-2222-4222-8222-222222222222"; // referee
const C = "33333333-3333-4333-8333-333333333333"; // referee for rollback tests
const D = "44444444-4444-4444-8444-444444444444"; // alias-account referee #1
const E = "55555555-5555-4555-8555-555555555555"; // alias-account referee #2
const F = "66666666-6666-4666-8666-666666666666"; // alias-account referee #3
const CODE = "QRBCBEVG";
const SESSION = "cs_test_chain";

type Row = Record<string, any>;

const h = vi.hoisted(() => ({
  state: {
    codes: [] as Row[],
    referrals: [] as Row[],
    payouts: [] as Row[],
    milestones: [] as Row[],
    profiles: [] as Row[],
    balances: new Map<string, number>(),
    payCalls: [] as Array<{ userId: string; amount: number }>,
    ledger: [] as Array<{ userId: string; action: string; creditsUsed: number; idempotencyKey?: string | null }>,
    ledgerFails: false,
    seq: 0,
  },
}));

/* ── Fake Supabase (the subset the referrals routes use) ───────────────── */
function makeFakeSupabase() {
  const s = h.state;
  const tables: Record<string, Row[]> = {
    referral_codes: s.codes,
    referrals: s.referrals,
    referral_payouts: s.payouts,
    referral_milestones: s.milestones,
    creator_profiles: s.profiles,
  };

  function selectChain(rows: Row[]) {
    /* Predicate-based builder: supports the eq reads the routes always
       used PLUS the gte/lt/in/order/range shapes the unified Supabase
       standings aggregation (computeStandings) queries with. */
    const preds: Array<(r: Row) => boolean> = [];
    let sortCol: string | null = null;
    let slice: [number, number] | null = null;
    const matchedBase = () => rows.filter((r) => preds.every((p) => p(r)));
    const matched = () => {
      let m = matchedBase();
      if (sortCol) {
        const col = sortCol;
        m = [...m].sort((a, b) => String(a[col] ?? "").localeCompare(String(b[col] ?? "")));
      }
      if (slice) m = m.slice(slice[0], slice[1] + 1);
      return m;
    };
    const builder: any = {
      eq: (col: string, v: unknown) => {
        preds.push((r) => r[col] === v);
        return builder;
      },
      gte: (col: string, v: unknown) => {
        preds.push((r) => r[col] != null && String(r[col]) >= String(v));
        return builder;
      },
      lt: (col: string, v: unknown) => {
        preds.push((r) => r[col] != null && String(r[col]) < String(v));
        return builder;
      },
      in: (col: string, vals: unknown[]) => {
        preds.push((r) => vals.includes(r[col]));
        return builder;
      },
      order: (col: string) => {
        sortCol = col;
        return builder;
      },
      range: (from: number, to: number) => {
        slice = [from, to];
        return builder;
      },
      limit: (n: number) => {
        slice = [0, n - 1];
        return builder;
      },
      single: async () => {
        const m = matched();
        return m.length
          ? { data: m[0], error: null }
          : { data: null, error: { code: "PGRST116", message: "no rows" } };
      },
      maybeSingle: async () => ({ data: matched()[0] ?? null, error: null }),
      then: (res: any, rej: any) =>
        Promise.resolve({ data: matched(), error: null, count: matchedBase().length }).then(res, rej),
    };
    return builder;
  }

  function mutateChain(rows: Row[], apply: (r: Row) => void, remove = false) {
    const filters: Array<[string, unknown]> = [];
    const execute = () => {
      const matched = rows.filter((r) => filters.every(([k, v]) => r[k] === v));
      if (remove) {
        for (const r of matched) rows.splice(rows.indexOf(r), 1);
      } else {
        matched.forEach(apply);
      }
      return { data: matched, error: null };
    };
    const builder: any = {
      eq: (col: string, v: unknown) => {
        filters.push([col, v]);
        return builder;
      },
      // update(...).eq(...).eq(...).select("id") — the rung-3 claim flip.
      select: async (_cols?: string) => execute(),
      then: (res: any, rej: any) => Promise.resolve(execute()).then(res, rej),
    };
    return builder;
  }

  return {
    from: (table: string) => {
      const rows = tables[table];
      if (!rows) throw new Error(`fake supabase: unexpected table ${table}`);
      return {
        select: (_cols?: string, _opts?: unknown) => selectChain(rows),
        insert: (vals: Row) => {
          // Emulate the UNIQUE constraints the money claims rest on.
          if (table === "referrals" && rows.some((r) => r["referee_user_id"] === vals["referee_user_id"])) {
            return Promise.resolve({ error: { code: "23505", message: "duplicate key: referrals_referee" } });
          }
          if (table === "referral_payouts" && rows.some((r) => r["stripe_session_id"] === vals["stripe_session_id"])) {
            return Promise.resolve({ error: { code: "23505", message: "duplicate key: payouts_session" } });
          }
          const row = { id: `row-${++s.seq}`, ...vals };
          rows.push(row);
          const p: any = Promise.resolve({ error: null });
          p.select = (_c: string) => ({ single: async () => ({ data: row, error: null }) });
          return p;
        },
        update: (patch: Row) => mutateChain(rows, (r) => Object.assign(r, patch)),
        delete: () => mutateChain(rows, () => {}, true),
      };
    },
    // The increment_referrer_earned RPC is absent in this fake on purpose:
    // the route's read-modify-write fallback is the path under test.
    rpc: (_name: string, _args: unknown) => Promise.reject(new Error("rpc missing (test)")),
  };
}

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (!u) return res.status(401).json({ error: "Unauthorized" });
    req.userId = String(u);
    const email = req.headers["x-test-email"];
    if (email) req.userEmail = String(email);
    next();
  },
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => makeFakeSupabase(),
  addCreditsToProfile: vi.fn(async (userId: string, amount: number) => {
    const oldCredits = h.state.balances.get(userId) ?? 0;
    const newCredits = oldCredits + amount;
    h.state.balances.set(userId, newCredits);
    h.state.payCalls.push({ userId, amount });
    return { oldCredits, newCredits, created: false };
  }),
}));

vi.mock("../../lib/payment-record", () => ({
  recordCreditUsageStrict: vi.fn(async (rec: { userId: string; action: string; creditsUsed: number; idempotencyKey?: string | null }) => {
    if (h.state.ledgerFails) throw new Error("ledger down (test)");
    h.state.ledger.push({ ...rec });
  }),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    db: { execute: async () => ({ rows: [] }) },
  };
});

import referralsRouter, { awardReferralPayout } from "../referrals";
import { maybeGrantPendingReferralWelcome } from "../../lib/referral-welcome";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // Production mounts pino-http, so handlers can rely on req.log.
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
    next();
  });
  app.use("/api", referralsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  const s = h.state;
  s.codes = [{ user_id: A, code: CODE }];
  s.referrals = [];
  s.payouts = [];
  s.milestones = [];
  s.profiles = [];
  s.balances = new Map([[A, 87475], [B, 1300], [C, 300]]);
  s.payCalls = [];
  s.ledger = [];
  s.ledgerFails = false;
  s.seq = 0;
  // The fake's table map captured the arrays at factory time; rebind by
  // replacing contents in place instead of reassigning.
  // (makeFakeSupabase reads h.state fresh on every call, so reassignment
  // above is safe — each request/award builds a new client facade.)
});

async function applyAs(userId: string, code: string, email?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-test-user": userId,
  };
  if (email) headers["x-test-email"] = email;
  const res = await fetch(`${base}/api/referrals/apply`, {
    method: "POST",
    headers,
    body: JSON.stringify({ code }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

describe("referred signup → binding + PENDING welcome (rung 3)", () => {
  it("apply records the referral with the welcome pending — no grant, no ledger row yet", async () => {
    const { status, body } = await applyAs(B, CODE);
    expect(status).toBe(200);
    expect(body.refereeReward).toBe(0);
    expect(body.welcomeStatus).toBe("pending");
    expect(body.welcomePending).toBe(1000);
    expect(body.welcomeWithheld).toBeNull();

    expect(h.state.referrals).toHaveLength(1);
    const row = h.state.referrals[0]!;
    expect(row["referrer_user_id"]).toBe(A);
    expect(row["referee_user_id"]).toBe(B);
    expect(row["welcome_status"]).toBe("pending");
    expect(row["referee_credits_awarded"]).toBe(0);
    expect(new Date(row["share_expires_at"]).getTime()).toBeGreaterThan(Date.now());

    // A bare signup earns nothing: balance and ledger untouched.
    expect(h.state.balances.get(B)).toBe(1300);
    expect(h.state.ledger).toHaveLength(0);
  });

  it("creator-profile creation fires the pending welcome exactly once; replays never double-grant", async () => {
    await applyAs(B, CODE);
    // No profile yet → the grant check is a no-op.
    const early = await maybeGrantPendingReferralWelcome(B);
    expect(early).toEqual({ granted: false, amount: 0, reason: "no_creator_profile" });
    expect(h.state.balances.get(B)).toBe(1300);

    // Profile created (the creator-platform hook calls the same fn).
    h.state.profiles.push({ id: "profile-b", user_id: B });
    const fired = await maybeGrantPendingReferralWelcome(B);
    expect(fired).toEqual({ granted: true, amount: 1000, reason: "granted" });
    expect(h.state.balances.get(B)).toBe(2300); // 1,300 start + 1,000 welcome
    expect(h.state.ledger).toEqual([
      { userId: B, action: "Referral Welcome Grant", creditsUsed: -1000, idempotencyKey: `referral-welcome:${B}` },
    ]);
    expect(h.state.referrals[0]!["welcome_status"]).toBe("granted");
    expect(h.state.referrals[0]!["referee_credits_awarded"]).toBe(1000);

    // Replays (profile re-saves, retries) never pay again.
    const replay = await maybeGrantPendingReferralWelcome(B);
    expect(replay.granted).toBe(false);
    expect(h.state.balances.get(B)).toBe(2300);
    expect(h.state.ledger).toHaveLength(1);
  });

  it("a referee who already has a creator profile is granted at apply time", async () => {
    h.state.profiles.push({ id: "profile-b", user_id: B });
    const { status, body } = await applyAs(B, CODE);
    expect(status).toBe(200);
    expect(body.welcomeStatus).toBe("granted");
    expect(body.refereeReward).toBe(1000);
    expect(h.state.balances.get(B)).toBe(2300);
    expect(h.state.ledger).toHaveLength(1);
  });

  it("a second apply is a 400 and grants nothing more", async () => {
    await applyAs(B, CODE);
    const again = await applyAs(B, CODE);
    expect(again.status).toBe(400);
    expect(h.state.referrals).toHaveLength(1);
    expect(h.state.balances.get(B)).toBe(1300);
    expect(h.state.ledger).toHaveLength(0);
  });

  it("an unknown code is a 404 and records nothing", async () => {
    const { status } = await applyAs(B, "ZZZZ9999");
    expect(status).toBe(404);
    expect(h.state.referrals).toHaveLength(0);
    expect(h.state.balances.get(B)).toBe(1300);
  });
});

describe("purchase → 25% award, exactly once", () => {
  it("pays the referrer 250 of a 1,000 purchase, with a ledger row and a bumped total", async () => {
    await applyAs(B, CODE);
    const awarded = await awardReferralPayout(B, 1000, SESSION);
    expect(awarded).toBe(250);
    expect(h.state.balances.get(A)).toBe(87725);
    expect(h.state.payouts).toHaveLength(1);
    expect(h.state.payouts[0]!["referrer_credits_awarded"]).toBe(250);
    expect(h.state.referrals[0]!["total_referrer_earned"]).toBe(250);
    expect(h.state.ledger).toContainEqual({
      userId: A, action: "Referral Revenue Share", creditsUsed: -250, idempotencyKey: `referral-payout:${SESSION}`,
    });
  });

  it("a repeat award for the same Stripe session pays nothing more", async () => {
    await applyAs(B, CODE);
    await awardReferralPayout(B, 1000, SESSION);
    const again = await awardReferralPayout(B, 1000, SESSION);
    expect(again).toBe(0);
    expect(h.state.balances.get(A)).toBe(87725);
    expect(h.state.payouts).toHaveLength(1);
    expect(h.state.ledger.filter((l) => l.action === "Referral Revenue Share")).toHaveLength(1);
  });

  it("no referral row → no award (the Pass 0 starvation, now impossible via apply)", async () => {
    const awarded = await awardReferralPayout(C, 1000, "cs_test_unref");
    expect(awarded).toBe(0);
    expect(h.state.balances.get(A)).toBe(87475);
    expect(h.state.payouts).toHaveLength(0);
  });
});

describe("Promoter HQ read side", () => {
  it("/referrals/me shows the join and the earned 250 for the referrer", async () => {
    await applyAs(B, CODE);
    await awardReferralPayout(B, 1000, SESSION);
    const res = await fetch(`${base}/api/referrals/me`, { headers: { "x-test-user": A } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.code).toBe(CODE);
    expect(body.totalReferrals).toBe(1);
    expect(body.activeReferrals).toBe(1);
    expect(body.creditsEarned).toBe(250);
    expect(body.referrals).toHaveLength(1);
    expect(body.referrals[0].creditsEarned).toBe(250);
  });
});

describe("rung 2 — one welcome per canonical mailbox (route level)", () => {
  it("plus-address duplicate: the second alias account is withheld and gets NO second welcome", async () => {
    const first = await applyAs(D, CODE, "fan+promo@gmail.com");
    expect(first.status).toBe(200);
    expect(first.body.welcomeStatus).toBe("pending");
    expect(h.state.referrals.find((r) => r["referee_user_id"] === D)!["referee_canonical_email"]).toBe("fan@gmail.com");
    expect(h.state.referrals.find((r) => r["referee_user_id"] === D)!["welcome_status"]).toBe("pending");

    // Same inbox, different alias spelling + a brand-new account.
    const dupe = await applyAs(E, CODE, "fan@gmail.com");
    expect(dupe.status).toBe(200);
    expect(dupe.body.refereeReward).toBe(0);
    expect(dupe.body.welcomeStatus).toBe("withheld");
    expect(dupe.body.welcomePending).toBe(0);
    expect(dupe.body.welcomeWithheld).toBe("duplicate_mailbox");
    const dupeRow = h.state.referrals.find((r) => r["referee_user_id"] === E)!;
    expect(dupeRow["welcome_status"]).toBe("withheld");
    expect(dupeRow["referee_credits_awarded"]).toBe(0);

    // Gmail-dot spelling of the same inbox is also a duplicate.
    const dotDupe = await applyAs(F, CODE, "f.an@gmail.com");
    expect(dotDupe.body.welcomeWithheld).toBe("duplicate_mailbox");

    // And the withheld rows can never pay at profile creation.
    h.state.profiles.push({ id: "profile-e", user_id: E });
    const fired = await maybeGrantPendingReferralWelcome(E);
    expect(fired.granted).toBe(false);
    expect(h.state.balances.get(E) ?? 0).toBe(0);
    expect(h.state.ledger.filter((l) => l.userId === E)).toHaveLength(0);
  });
});

describe("ledger failure → rollback + claim release (retryable, never silently burned)", () => {
  it("grant: a failed ledger write at profile creation claws back, releases the claim, and a retry pays once", async () => {
    await applyAs(C, CODE);
    h.state.profiles.push({ id: "profile-c", user_id: C });
    h.state.ledgerFails = true;
    const failed = await maybeGrantPendingReferralWelcome(C);
    expect(failed).toEqual({ granted: false, amount: 0, reason: "error" });
    expect(h.state.balances.get(C)).toBe(300); // granted then clawed back, net zero
    expect(h.state.payCalls.filter((p) => p.userId === C).map((p) => p.amount)).toEqual([1000, -1000]);
    expect(h.state.referrals.find((r) => r["referee_user_id"] === C)!["welcome_status"]).toBe("pending");

    h.state.ledgerFails = false;
    const retry = await maybeGrantPendingReferralWelcome(C);
    expect(retry.granted).toBe(true);
    expect(h.state.balances.get(C)).toBe(1300);
    expect(h.state.ledger.filter((l) => l.userId === C)).toHaveLength(1);
    const replay = await maybeGrantPendingReferralWelcome(C);
    expect(replay.granted).toBe(false);
    expect(h.state.balances.get(C)).toBe(1300);
  });

  it("award: a failed ledger write releases the payout claim, and a retry pays exactly once", async () => {
    await applyAs(B, CODE);
    h.state.ledgerFails = true;
    const first = await awardReferralPayout(B, 1000, "cs_test_retry");
    expect(first).toBe(0);
    expect(h.state.payouts.filter((p) => p["stripe_session_id"] === "cs_test_retry")).toHaveLength(0);
    expect(h.state.balances.get(A)).toBe(87475); // granted then clawed back, net zero

    h.state.ledgerFails = false;
    const second = await awardReferralPayout(B, 1000, "cs_test_retry");
    expect(second).toBe(250);
    expect(h.state.balances.get(A)).toBe(87725);
    expect(h.state.payouts.filter((p) => p["stripe_session_id"] === "cs_test_retry")).toHaveLength(1);
  });
});
