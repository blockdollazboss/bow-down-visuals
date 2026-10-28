/**
 * credits-reconciliation.test.ts — Stack400 Lane 4 (charge integrity).
 *
 * The reconciliation law: the DISPLAYED balance must equal the baseline
 * minus the ledger charges. Before this lane, three mechanisms broke it:
 *   A1. deductCredits spent the bonus pool first while every display read
 *       only `profiles.credits` — a real charge left the displayed number
 *       unmoved (Pass 4: "AI Media Kit Builder −100" row, balance 87,475
 *       before AND after).
 *   A2. Team-pool charges wrote a row into the member's personal history
 *       with no team marker (covered in payment-record history tests).
 *   A3. Nineteen endpoints wrote a second ledger row per deduction
 *       (pinned by duplicate-ledger-writes.test.ts).
 *
 * These tests pin the fixed invariant at the rail: for a personal charge,
 * spendableBalance(after) === spendableBalance(before) − Σ ledger rows,
 * no matter which pool (credits / bonus) the money physically came from.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(),
  addCreditsToProfile: vi.fn(),
}));

vi.mock("../payment-record", () => ({
  recordCreditUsageStrict: vi.fn(),
}));

vi.mock("../teams", () => ({
  getUserActiveTeam: vi.fn(async () => null),
  deductTeamCredits: vi.fn(async () => {
    throw new Error("deductTeamCredits must not be called on the personal-balance path");
  }),
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => []) })),
      })),
    })),
  },
  teamsTable: { id: "id", credits: "credits" },
  creditUsageTable: { id: "id", userId: "user_id", action: "action", idempotencyKey: "idempotency_key" },
}));

import { getSupabaseAdmin, addCreditsToProfile } from "../supabase-admin";
import { recordCreditUsageStrict } from "../payment-record";
import {
  chargeCredits,
  deductCredits,
  getCreditBalance,
  spendableBalance,
} from "../credits";

interface FakeProfile {
  credits: number;
  bonus_credits: number;
  bonus_credits_expires_at: string | null;
}

/* In-memory profiles row with the full balance shape (credits + bonus). */
function makeSupabase(initial: FakeProfile) {
  const profile: FakeProfile = { ...initial };
  const table = {
    select: () => table,
    eq: () => table,
    single: async () => ({ data: { ...profile }, error: null }),
    update: (vals: Partial<FakeProfile>) => {
      Object.assign(profile, vals);
      return { eq: (_c: string, _v: string) => Promise.resolve({ error: null }) };
    },
  };
  return {
    client: { from: (_t: string) => table },
    profile,
  };
}

function ledgerCalls(): Array<{ creditsUsed: number }> {
  return vi.mocked(recordCreditUsageStrict).mock.calls.map((c) => c[0] as { creditsUsed: number });
}

describe("spendableBalance — the one balance definition", () => {
  it("sums credits + live bonus", () => {
    expect(
      spendableBalance({ credits: 100, bonus_credits: 40, bonus_credits_expires_at: null }),
    ).toBe(140);
  });

  it("treats an expired bonus pool as zero", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(
      spendableBalance({ credits: 100, bonus_credits: 40, bonus_credits_expires_at: past }),
    ).toBe(100);
  });

  it("treats a missing profile as zero", () => {
    expect(spendableBalance(null)).toBe(0);
  });
});

describe("reconciliation — displayed balance vs ledger charges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(recordCreditUsageStrict).mockResolvedValue(undefined);
    vi.mocked(addCreditsToProfile).mockResolvedValue({ oldCredits: 0, newCredits: 0, created: false });
  });

  it("Pass 4 shape: a charge fully covered by the bonus pool still moves the displayed balance by the full cost", async () => {
    /* Baseline mirrors the live evidence: 87,475 displayed, with a live
       bonus pool large enough to absorb the 100 VB media-kit charge. */
    const fake = makeSupabase({
      credits: 87_475,
      bonus_credits: 500,
      bonus_credits_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.client as never);

    const baseline = await getCreditBalance("user-A");
    expect(baseline).toBe(87_975); // displayed = credits + live bonus

    const after = await chargeCredits("user-A", 100, { action: "AI Media Kit Builder" });

    const ledgerSum = ledgerCalls().reduce((s, r) => s + r.creditsUsed, 0);
    expect(ledgerSum).toBe(100);
    /* The law: displayed-after === baseline − ledger charges. */
    expect(after).toBe(baseline - ledgerSum);
    expect(await getCreditBalance("user-A")).toBe(baseline - ledgerSum);
    /* The physical split is unchanged (bonus spent first) — only the
       accounting definition moved. */
    expect(fake.profile.bonus_credits).toBe(400);
    expect(fake.profile.credits).toBe(87_475);
  });

  it("a charge split across bonus + credits moves the displayed balance by exactly the cost", async () => {
    const fake = makeSupabase({
      credits: 250,
      bonus_credits: 40,
      bonus_credits_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.client as never);

    const baseline = await getCreditBalance("user-1");
    const after = await chargeCredits("user-1", 100, { action: "Split Charge" });

    const ledgerSum = ledgerCalls().reduce((s, r) => s + r.creditsUsed, 0);
    expect(after).toBe(baseline - ledgerSum);
    expect(fake.profile.bonus_credits).toBe(0);
    expect(fake.profile.credits).toBe(190);
  });

  it("an expired bonus pool is not spendable and not displayed", async () => {
    const fake = makeSupabase({
      credits: 50,
      bonus_credits: 500,
      bonus_credits_expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.client as never);

    expect(await getCreditBalance("user-1")).toBe(50);
    await expect(deductCredits("user-1", 100)).rejects.toThrow();
    expect(ledgerCalls()).toHaveLength(0);
  });

  it("deductCredits returns the spendable total, not the credits column", async () => {
    const fake = makeSupabase({
      credits: 300,
      bonus_credits: 200,
      bonus_credits_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.client as never);

    const after = await deductCredits("user-1", 50);
    expect(after).toBe(450); // 500 spendable − 50, not 300 (credits column)
  });
});
