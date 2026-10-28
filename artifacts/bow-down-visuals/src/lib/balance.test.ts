import { describe, it, expect } from "vitest";
import { spendableCredits } from "./balance";

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
