/**
 * Stack300 plans-boosts — the AI promotion boosts allowance math.
 *
 * Pins the pure heart of lib/ai-boosts.ts:
 *   - the period is 'YYYY-MM' in UTC and rolls at the month boundary
 *     (the monthly reset is structural: a new month has no ledger
 *     rows, so last month's usage can never leak into this month's
 *     count — the count is always scoped to the current period);
 *   - grant-by-tier comes from the ratified TIER_AI_BOOSTS terms
 *     (Free 3 / Pro 25 / Elite 100) — never a second copy of the
 *     numbers;
 *   - a mid-month downgrade (used > the new tier's allowance) reads
 *     as 0 remaining, never negative;
 *   - the funding decision: admins bypass the counter even with
 *     boosts remaining; members draw a boost before any charge.
 * The DB-facing halves (consume/refund exactly-once) are pinned at
 * the route level in routes/__tests__/social-assist-boosts.test.ts.
 */
import { describe, it, expect } from "vitest";
import { boostPeriodFor, computeBoostState, fundingFor } from "../ai-boosts";
import { TIER_AI_BOOSTS } from "../platform-fees";

describe("boostPeriodFor — monthly rollover (UTC)", () => {
  it("formats 'YYYY-MM' in UTC", () => {
    expect(boostPeriodFor(new Date("2026-11-07T18:40:00Z"))).toBe("2026-11");
    expect(boostPeriodFor(new Date("2027-01-01T00:00:00Z"))).toBe("2027-01");
  });

  it("rolls at the exact month boundary", () => {
    expect(boostPeriodFor(new Date("2026-11-30T23:59:59.999Z"))).toBe("2026-11");
    expect(boostPeriodFor(new Date("2026-12-01T00:00:00.000Z"))).toBe("2026-12");
  });

  it("uses UTC, not the caller's local month", () => {
    /* 2026-11-01T02:00Z is still Oct 31 in US Eastern — the period
       must already read November everywhere. */
    expect(boostPeriodFor(new Date("2026-11-01T02:00:00Z"))).toBe("2026-11");
    /* And the year's last UTC hour is December everywhere. */
    expect(boostPeriodFor(new Date("2026-12-31T23:30:00Z"))).toBe("2026-12");
  });
});

describe("computeBoostState — grant-by-tier from the ratified terms", () => {
  it("allowances are TIER_AI_BOOSTS itself: Free 3 / Pro 25 / Elite 100", () => {
    expect(TIER_AI_BOOSTS).toEqual({ free: 3, pro: 25, elite: 100 });
    expect(computeBoostState("free", 0, "2026-11").allowance).toBe(3);
    expect(computeBoostState("pro", 0, "2026-11").allowance).toBe(25);
    expect(computeBoostState("elite", 0, "2026-11").allowance).toBe(100);
  });

  it("remaining is allowance minus used", () => {
    expect(computeBoostState("pro", 7, "2026-11")).toEqual({
      tier: "pro",
      allowance: 25,
      used: 7,
      remaining: 18,
      period: "2026-11",
    });
    expect(computeBoostState("free", 3, "2026-11").remaining).toBe(0);
  });

  it("a mid-month downgrade below the used count floors at 0, never negative", () => {
    /* Used 40 boosts as Elite, dropped to Pro (25): the month is
       spent — 0 remaining — not −15. */
    const state = computeBoostState("pro", 40, "2026-11");
    expect(state.used).toBe(40);
    expect(state.remaining).toBe(0);
  });
});

describe("fundingFor — the assist funding decision", () => {
  it("admins bypass the counter even with boosts remaining", () => {
    expect(fundingFor({ isAdmin: true, remaining: 100 })).toBe("admin");
    expect(fundingFor({ isAdmin: true, remaining: 0 })).toBe("admin");
  });

  it("members draw a boost before any charge", () => {
    expect(fundingFor({ isAdmin: false, remaining: 1 })).toBe("boost");
    expect(fundingFor({ isAdmin: false, remaining: 0 })).toBe("charge");
  });
});
