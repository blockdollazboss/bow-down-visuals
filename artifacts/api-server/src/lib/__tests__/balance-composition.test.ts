/**
 * Lane V-bucs — the balance composition read (owner ruling, Oct 28 2026:
 * temporary Visual Bucs are shown separately, labelled temporary, with
 * their expiry named).
 *
 * The composition is a READ model over the exact pool Lane 4 unified:
 * permanent `profiles.credits` + the live bonus pool. These tests pin
 * the math — mixed permanent + multiple temporary grants with different
 * expiries, expired grants excluded — and pin that the composition's
 * total is ALWAYS the spendableBalance total, so no surface can drift
 * from the number charges move.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  profile: null as null | {
    credits?: number;
    bonus_credits?: number;
    bonus_credits_expires_at?: string | null;
  },
}));

vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: h.profile }),
        }),
      }),
    }),
  }),
  addCreditsToProfile: async () => undefined,
}));

vi.mock("../teams", () => ({
  getUserActiveTeam: async () => null,
  deductTeamCredits: async () => 0,
}));

vi.mock("../payment-record", () => ({
  recordCreditUsageStrict: async () => undefined,
}));

import {
  composeCreditBalance,
  creditBalanceComposition,
  getCreditBalance,
  getCreditBalanceComposition,
  spendableBalance,
} from "../credits";

const NOW = Date.parse("2026-10-28T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("composeCreditBalance — permanent + temporary grants", () => {
  it("splits permanent from multiple live grants and names the soonest expiry with its amount", () => {
    const composition = composeCreditBalance(
      1_000,
      [
        { amount: 200, expiresAt: iso(NOW + 7 * DAY) },
        { amount: 300, expiresAt: iso(NOW + 2 * DAY) },
        { amount: 500, expiresAt: iso(NOW - DAY) }, // expired — excluded
        { amount: 0, expiresAt: iso(NOW + DAY) }, // empty — excluded
      ],
      NOW,
    );

    expect(composition.permanentCredits).toBe(1_000);
    expect(composition.temporaryCredits).toBe(500);
    expect(composition.total).toBe(1_500);
    expect(composition.temporaryGrants).toEqual([
      { amount: 300, expiresAt: iso(NOW + 2 * DAY) },
      { amount: 200, expiresAt: iso(NOW + 7 * DAY) },
    ]);
    expect(composition.soonestTemporaryExpiry).toEqual({
      amount: 300,
      expiresAt: iso(NOW + 2 * DAY),
    });
  });

  it("keeps a no-expiry temporary grant live but never calls it the soonest expiry", () => {
    const composition = composeCreditBalance(
      100,
      [
        { amount: 50, expiresAt: null },
        { amount: 25, expiresAt: iso(NOW + 3 * DAY) },
      ],
      NOW,
    );
    expect(composition.temporaryCredits).toBe(75);
    expect(composition.total).toBe(175);
    expect(composition.soonestTemporaryExpiry).toEqual({
      amount: 25,
      expiresAt: iso(NOW + 3 * DAY),
    });

    const noDatedExpiry = composeCreditBalance(
      100,
      [{ amount: 50, expiresAt: null }],
      NOW,
    );
    expect(noDatedExpiry.temporaryCredits).toBe(50);
    expect(noDatedExpiry.soonestTemporaryExpiry).toBeNull();
  });

  it("treats a grant expiring exactly now as still live, and one a millisecond past as gone", () => {
    const atBoundary = composeCreditBalance(
      0,
      [{ amount: 10, expiresAt: iso(NOW) }],
      NOW,
    );
    expect(atBoundary.temporaryCredits).toBe(10);

    const justPast = composeCreditBalance(
      0,
      [{ amount: 10, expiresAt: iso(NOW - 1) }],
      NOW,
    );
    expect(justPast.temporaryCredits).toBe(0);
    expect(justPast.temporaryGrants).toEqual([]);
    expect(justPast.soonestTemporaryExpiry).toBeNull();
  });

  it("handles an all-permanent balance and a missing profile shape", () => {
    expect(composeCreditBalance(2_300, [], NOW)).toEqual({
      total: 2_300,
      permanentCredits: 2_300,
      temporaryCredits: 0,
      temporaryGrants: [],
      soonestTemporaryExpiry: null,
    });
    expect(creditBalanceComposition(null, NOW).total).toBe(0);
  });
});

describe("creditBalanceComposition — the live profile pool adapter", () => {
  it("adapts the aggregate bonus pool to one temporary segment (the owner's +100 case)", () => {
    const profile = {
      credits: 87_475,
      bonus_credits: 100,
      bonus_credits_expires_at: iso(NOW + 2 * DAY),
    };
    const composition = creditBalanceComposition(profile, NOW);
    expect(composition).toEqual({
      total: 87_575,
      permanentCredits: 87_475,
      temporaryCredits: 100,
      temporaryGrants: [{ amount: 100, expiresAt: iso(NOW + 2 * DAY) }],
      soonestTemporaryExpiry: { amount: 100, expiresAt: iso(NOW + 2 * DAY) },
    });
    expect(composition.total).toBe(spendableBalance(profile, NOW));
  });

  it("excludes an expired bonus pool exactly like spendableBalance does", () => {
    const profile = {
      credits: 300,
      bonus_credits: 1_000,
      bonus_credits_expires_at: iso(NOW - 60_000),
    };
    const composition = creditBalanceComposition(profile, NOW);
    expect(composition.temporaryCredits).toBe(0);
    expect(composition.total).toBe(300);
    expect(composition.total).toBe(spendableBalance(profile, NOW));
  });
});

describe("getCreditBalanceComposition — the fresh profile read", () => {
  beforeEach(() => {
    h.profile = null;
  });

  it("returns the composition of the same read getCreditBalance totals", async () => {
    h.profile = {
      credits: 2_000,
      bonus_credits: 300,
      bonus_credits_expires_at: iso(Date.now() + 2 * DAY),
    };
    const composition = await getCreditBalanceComposition("user-1");
    expect(composition.permanentCredits).toBe(2_000);
    expect(composition.temporaryCredits).toBe(300);
    expect(composition.soonestTemporaryExpiry?.amount).toBe(300);
    expect(composition.total).toBe(await getCreditBalance("user-1"));
  });

  it("reads a missing profile as an honest zero composition", async () => {
    const composition = await getCreditBalanceComposition("user-gone");
    expect(composition).toEqual({
      total: 0,
      permanentCredits: 0,
      temporaryCredits: 0,
      temporaryGrants: [],
      soonestTemporaryExpiry: null,
    });
  });
});
