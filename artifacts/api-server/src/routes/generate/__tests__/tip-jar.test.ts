/**
 * Tests for the Tip Jar backend.
 *
 * Covers: handle validation/normalization, suggested-amount normalization,
 * tip-intent validation (min/max), dashboard totals math, and the honesty
 * contract — tip intents are NEVER marked completed (payments coming soon).
 */
import { describe, expect, it } from "vitest";
import {
  TIP_STATUS_PENDING,
  TIP_MIN_AMOUNT,
  TIP_MAX_AMOUNT,
  TIP_MAX_SUGGESTED,
  normalizeSuggestedAmounts,
  sumTipIntents,
  tipPageSchema,
  tipIntentSchema,
  type TipIntent,
} from "../tip-jar";

function intent(amount: number): TipIntent {
  return {
    id: `t-${amount}`,
    pageUserId: "u1",
    handle: "sharkking",
    amount,
    currency: "USD",
    fanName: "fan",
    message: "",
    status: TIP_STATUS_PENDING,
    createdAt: new Date().toISOString(),
  };
}

describe("handle validation", () => {
  it("accepts lowercase handles with hyphens and underscores", () => {
    expect(tipPageSchema.safeParse({ handle: "shark_king-99", displayName: "Shark King" }).success).toBe(true);
  });

  it("lowercases handles", () => {
    const r = tipPageSchema.safeParse({ handle: "SharkKing", displayName: "Shark King" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.handle).toBe("sharkking");
  });

  it("rejects handles that are too short, too long, or have bad characters", () => {
    expect(tipPageSchema.safeParse({ handle: "ab", displayName: "X" }).success).toBe(false);
    expect(tipPageSchema.safeParse({ handle: "a".repeat(31), displayName: "X" }).success).toBe(false);
    expect(tipPageSchema.safeParse({ handle: "bad handle!", displayName: "X" }).success).toBe(false);
  });

  it("rejects more than the max suggested amounts", () => {
    const r = tipPageSchema.safeParse({
      handle: "sharkking",
      displayName: "Shark King",
      suggestedAmounts: Array.from({ length: TIP_MAX_SUGGESTED + 1 }, (_, i) => i + 1),
    });
    expect(r.success).toBe(false);
  });
});

describe("normalizeSuggestedAmounts", () => {
  it("dedupes, sorts ascending, and rounds to cents", () => {
    expect(normalizeSuggestedAmounts([25, 5, 10, 5, 10.004])).toEqual([5, 10, 25]);
  });

  it("drops out-of-range amounts", () => {
    expect(normalizeSuggestedAmounts([0.5, 5, 99999])).toEqual([5]);
  });
});

describe("tipIntentSchema", () => {
  it("accepts a valid tip", () => {
    const r = tipIntentSchema.safeParse({ amount: 25, fanName: "Big Fan", message: "Love the music!" });
    expect(r.success).toBe(true);
  });

  it("rejects amounts below the minimum and above the maximum", () => {
    expect(tipIntentSchema.safeParse({ amount: TIP_MIN_AMOUNT - 0.01 }).success).toBe(false);
    expect(tipIntentSchema.safeParse({ amount: TIP_MAX_AMOUNT + 1 }).success).toBe(false);
  });

  it("caps fan name and message lengths", () => {
    expect(tipIntentSchema.safeParse({ amount: 5, fanName: "x".repeat(61) }).success).toBe(false);
    expect(tipIntentSchema.safeParse({ amount: 5, message: "x".repeat(281) }).success).toBe(false);
  });
});

describe("sumTipIntents", () => {
  it("sums totals, counts, and averages", () => {
    const stats = sumTipIntents([intent(5), intent(10), intent(25)]);
    expect(stats.total).toBe(40);
    expect(stats.count).toBe(3);
    expect(stats.average).toBeCloseTo(13.33, 2);
  });

  it("handles zero intents", () => {
    expect(sumTipIntents([])).toEqual({ total: 0, count: 0, average: 0 });
  });
});

describe("honesty contract", () => {
  it("the only tip status is pending_payment — tips are never completed", () => {
    expect(TIP_STATUS_PENDING).toBe("pending_payment");
    const t = intent(10);
    expect(t.status).toBe("pending_payment");
    expect(t.status).not.toBe("completed");
  });
});
