import { describe, it, expect } from "vitest";
import {
  spendableCredits,
  composeBalance,
  balanceComposition,
  daysUntilExpiry,
  formatExpiryDate,
} from "./balance";

const NOW = Date.parse("2026-10-28T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

describe("spendableCredits — the displayed balance", () => {
  it("is credits alone when there is no bonus pool", () => {
    expect(spendableCredits({ credits: 87_475, bonus_credits: 0, bonus_credits_expires_at: null })).toBe(87_475);
  });

  it("includes a live bonus pool — a bonus-funded charge moves the displayed number", () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    expect(spendableCredits({ credits: 87_475, bonus_credits: 500, bonus_credits_expires_at: future })).toBe(87_975);
  });

  it("excludes an expired bonus pool", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(spendableCredits({ credits: 100, bonus_credits: 500, bonus_credits_expires_at: past })).toBe(100);
  });

  it("handles a null profile", () => {
    expect(spendableCredits(null)).toBe(0);
    expect(spendableCredits(undefined)).toBe(0);
  });
});

describe("composeBalance — the permanent/temporary split (Lane V-bucs)", () => {
  it("splits permanent from multiple live grants and names the soonest expiry with its amount", () => {
    const composition = composeBalance(
      1_000,
      [
        { amount: 200, expiresAt: iso(NOW + 7 * DAY) },
        { amount: 300, expiresAt: iso(NOW + 2 * DAY) },
        { amount: 500, expiresAt: iso(NOW - DAY) }, // expired — excluded
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

  it("keeps a no-expiry grant live but never calls it the soonest expiry", () => {
    const composition = composeBalance(
      100,
      [
        { amount: 50, expiresAt: null },
        { amount: 25, expiresAt: iso(NOW + 3 * DAY) },
      ],
      NOW,
    );
    expect(composition.temporaryCredits).toBe(75);
    expect(composition.soonestTemporaryExpiry?.amount).toBe(25);
  });
});

describe("balanceComposition — the auth profile adapter", () => {
  it("splits the owner's Pass 4 shape: 87,475 permanent + 100 temporary inside 87,575", () => {
    const profile = {
      credits: 87_575, // already folded total (AuthContext)
      credits_base: 87_475,
      bonus_credits: 100,
      bonus_credits_expires_at: iso(NOW + 2 * DAY),
    };
    const composition = balanceComposition(profile, NOW);
    expect(composition.permanentCredits).toBe(87_475);
    expect(composition.temporaryCredits).toBe(100);
    expect(composition.total).toBe(87_575);
    expect(composition.soonestTemporaryExpiry).toEqual({
      amount: 100,
      expiresAt: iso(NOW + 2 * DAY),
    });
  });

  it("works on a raw profile row whose credits column is still permanent", () => {
    const raw = {
      credits: 300,
      bonus_credits: 1_000,
      bonus_credits_expires_at: iso(NOW + DAY),
    };
    const composition = balanceComposition(raw, NOW);
    expect(composition.total).toBe(1_300);
    expect(composition.total).toBe(spendableCredits(raw, NOW));
  });

  it("excludes an expired bonus pool, matching spendableCredits", () => {
    const profile = {
      credits: 300,
      bonus_credits: 1_000,
      bonus_credits_expires_at: iso(NOW - 60_000),
    };
    const composition = balanceComposition(profile, NOW);
    expect(composition.temporaryCredits).toBe(0);
    expect(composition.total).toBe(spendableCredits(profile, NOW));
  });

  it("handles a null profile as an honest zero composition", () => {
    expect(balanceComposition(null, NOW)).toEqual({
      total: 0,
      permanentCredits: 0,
      temporaryCredits: 0,
      temporaryGrants: [],
      soonestTemporaryExpiry: null,
    });
  });
});

describe("expiry presentation helpers", () => {
  it("counts whole days up — 47 hours left reads as 2 days", () => {
    expect(daysUntilExpiry(iso(NOW + 47 * 60 * 60 * 1000), NOW)).toBe(2);
    expect(daysUntilExpiry(iso(NOW + DAY), NOW)).toBe(1);
    expect(daysUntilExpiry(iso(NOW), NOW)).toBe(0);
    expect(daysUntilExpiry(null, NOW)).toBeNull();
    expect(daysUntilExpiry("not-a-date", NOW)).toBeNull();
  });

  it("formats the expiry date and stays empty for a missing one", () => {
    expect(formatExpiryDate(iso(NOW + 2 * DAY), "en-US")).toBe("Oct 30, 2026");
    expect(formatExpiryDate(null)).toBe("");
  });
});
