/**
 * qcproof-referral-window.test.ts — QC-200 Q165 residual pin.
 *
 * Already proven elsewhere (re-run in this lane): the welcome is
 * 1,000 VB (REFERRAL_WELCOME_CREDITS in lib/referral-welcome, and the
 * routes/referrals display const agrees), paid exactly once at
 * creator-profile creation under the ledger key
 * `referral-welcome:<userId>`, with clawback + claim release on any
 * grant failure so a retry re-earns it (referral-welcome.test.ts,
 * referral-chain.test.ts); a 1,000 VB purchase pays the referrer
 * exactly 250 VB (25%, 1-referral Promoter tier) once per Stripe
 * session under UNIQUE referral_payouts.stripe_session_id + ledger
 * key `referral-payout:<sessionId>` (referral-chain.test.ts); awards
 * are attempted on BOTH the webhook and the verify paths
 * (referral-award-verify.test.ts, stripe-webhook-duplicate-delivery).
 *
 * The one leg none of those suites exercised: the 90-day window
 * itself. awardReferralPayout must pay NOTHING — no payout row, no
 * grant, no ledger row — once share_expires_at has passed, and the
 * boundary is inclusive (an award at the exact expiry instant is
 * already too late). Driven here against the REAL awardReferralPayout
 * with the Supabase admin client faked at the module boundary.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const REFERRER = "22222222-2222-4222-8222-222222222222";
const REFEREE = "33333333-3333-4333-8333-333333333333";

const h = vi.hoisted(() => ({
  referral: null as Record<string, unknown> | null,
  referrerCount: 1,
  payoutInserts: [] as Array<Record<string, unknown>>,
  payoutSessions: new Set<string>(),
  grants: [] as Array<{ userId: string; amount: number }>,
  ledger: [] as Array<Record<string, unknown>>,
}));

function chain(result: unknown) {
  const p = Promise.resolve(result) as Promise<unknown> & {
    single: () => Promise<unknown>;
    eq: () => unknown;
  };
  p.single = async () => result;
  p.eq = () => chain(result);
  return p;
}

const fakeSupabase = {
  from(table: string) {
    if (table === "referrals") {
      return {
        select: (_cols: string, opts?: { count?: string; head?: boolean }) => ({
          eq: () => {
            if (opts?.count === "exact") return chain({ count: h.referrerCount, data: null, error: null });
            return chain({ data: h.referral, error: null });
          },
        }),
        update: () => ({ eq: async () => ({ error: null }) }),
      };
    }
    if (table === "referral_payouts") {
      return {
        insert: async (row: Record<string, unknown>) => {
          const sid = String(row["stripe_session_id"]);
          if (h.payoutSessions.has(sid)) {
            return { error: { message: "duplicate key value violates unique constraint", code: "23505" } };
          }
          h.payoutSessions.add(sid);
          h.payoutInserts.push(row);
          return { error: null };
        },
        delete: () => ({
          eq: async (_col: string, sid: string) => {
            h.payoutSessions.delete(sid);
            h.payoutInserts = h.payoutInserts.filter((r) => r["stripe_session_id"] !== sid);
            return { error: null };
          },
        }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  },
  rpc: async () => ({ data: null, error: null }),
};

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => fakeSupabase,
  addCreditsToProfile: async (userId: string, amount: number) => {
    h.grants.push({ userId, amount });
  },
}));

vi.mock("../../lib/payment-record", () => ({
  recordCreditUsageStrict: async (rec: Record<string, unknown>) => {
    h.ledger.push(rec);
  },
}));

vi.mock("../../lib/push-events", () => ({
  notifyUserEvent: async () => {},
}));

import { awardReferralPayout } from "../referrals";

function referralExpiringAt(iso: string) {
  return {
    id: "ref-1",
    referrer_user_id: REFERRER,
    revenue_share_pct: 25,
    share_expires_at: iso,
  };
}

beforeEach(() => {
  h.referral = null;
  h.referrerCount = 1;
  h.payoutInserts = [];
  h.payoutSessions = new Set();
  h.grants = [];
  h.ledger = [];
});

describe("Q165 — the 90-day revenue-share window", () => {
  it("an expired window pays nothing: no payout row, no grant, no ledger row", async () => {
    h.referral = referralExpiringAt(new Date(Date.now() - 24 * 3600 * 1000).toISOString());
    const awarded = await awardReferralPayout(REFEREE, 1000, "cs_expired_window");
    expect(awarded).toBe(0);
    expect(h.payoutInserts).toHaveLength(0);
    expect(h.grants).toHaveLength(0);
    expect(h.ledger).toHaveLength(0);
  });

  it("the expiry instant itself is already too late (boundary is inclusive)", async () => {
    h.referral = referralExpiringAt(new Date(Date.now() - 1000).toISOString());
    const awarded = await awardReferralPayout(REFEREE, 1000, "cs_at_boundary");
    expect(awarded).toBe(0);
    expect(h.payoutInserts).toHaveLength(0);
    expect(h.grants).toHaveLength(0);
  });

  it("inside the window the same purchase pays exactly 250 (25% of 1,000) once", async () => {
    h.referral = referralExpiringAt(new Date(Date.now() + 89 * 24 * 3600 * 1000).toISOString());
    const awarded = await awardReferralPayout(REFEREE, 1000, "cs_in_window");
    expect(awarded).toBe(250);
    expect(h.payoutInserts).toHaveLength(1);
    expect(h.payoutInserts[0]).toMatchObject({
      referral_id: "ref-1",
      stripe_session_id: "cs_in_window",
      referee_credits_purchased: 1000,
      referrer_credits_awarded: 250,
    });
    expect(h.grants).toEqual([{ userId: REFERRER, amount: 250 }]);
    expect(h.ledger).toHaveLength(1);
    expect(h.ledger[0]).toMatchObject({
      userId: REFERRER,
      creditsUsed: -250,
      idempotencyKey: "referral-payout:cs_in_window",
    });

    /* Replay of the same session pays nothing more. */
    const replay = await awardReferralPayout(REFEREE, 1000, "cs_in_window");
    expect(replay).toBe(0);
    expect(h.payoutInserts).toHaveLength(1);
    expect(h.grants).toHaveLength(1);
    expect(h.ledger).toHaveLength(1);
  });

  it("a referral with no expiry recorded pays nothing (fail-closed window)", async () => {
    h.referral = { ...referralExpiringAt(""), share_expires_at: null };
    const awarded = await awardReferralPayout(REFEREE, 1000, "cs_no_expiry");
    expect(awarded).toBe(0);
    expect(h.payoutInserts).toHaveLength(0);
    expect(h.grants).toHaveLength(0);
  });
});
