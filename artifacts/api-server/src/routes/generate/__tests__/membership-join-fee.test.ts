/**
 * Item 18 (stack800 Lane 1, Group D) — membership-JOIN fee math pin.
 *
 * The never-run gate leg: a fan membership JOIN charge splits
 * 10% platform / 90% creator, to the cent. Existing coverage pins the
 * pieces separately — memberships.test.ts pins the fee constant (10%)
 * and netAfterFee at two amounts; memberships-payments.test.ts pins
 * that checkout charges checkoutChargeCents(tier, period) in full.
 * This file pins the JOIN split itself: the exact gross a join charges
 * (monthly AND annual-discount joins) broken into platform fee +
 * creator net, to the cent, including odd-cent amounts.
 *
 * The code's own split semantics (memberships.ts netAfterFee): the
 * creator net is round(gross × 90%) and the platform keeps the
 * remainder, so fee + net always reconciles to the gross exactly.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(),
  refundCredits: vi.fn(),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(),
  getTextModel: vi.fn(() => "gpt-6-sol"),
}));

vi.mock("@workspace/db", () => ({
  db: { select: vi.fn(), insert: vi.fn(), update: vi.fn(), delete: vi.fn() },
  fanTiersTable: { id: "id", user_id: "user_id", sort_order: "sort_order", created_at: "created_at" },
  fanMembersTable: { id: "id", user_id: "user_id", tier_id: "tier_id", fan_label: "fan_label", joined_at: "joined_at" },
  fanMembershipGiftsTable: { id: "id" },
  creatorProfilesTable: { id: "id", userId: "user_id" },
  emailListsTable: { id: "id" },
  emailAutomationsTable: { id: "id" },
  emailAutomationSendsTable: { id: "id" },
}));

import {
  MEMBERSHIPS_PLATFORM_FEE_PCT,
  annualPriceCents,
  checkoutChargeCents,
  netAfterFee,
} from "../memberships";

/** The join split exactly as the code computes it: creator net from
 *  netAfterFee, platform fee = the remainder of the charged gross. */
function joinSplit(grossCents: number): { gross: number; fee: number; net: number } {
  const net = netAfterFee(grossCents);
  return { gross: grossCents, fee: grossCents - net, net };
}

describe("membership JOIN split — 10% platform / 90% creator, to the cent", () => {
  it("the join fee rate is the memberships platform fee: 10%", () => {
    expect(MEMBERSHIPS_PLATFORM_FEE_PCT).toBe(10);
  });

  it.each([
    // [grossCents, expectedFee, expectedNet]
    [0, 0, 0],
    [100, 10, 90], // $1.00 join
    [500, 50, 450], // $5.00 join
    [1000, 100, 900], // $10.00 join
    [2500, 250, 2250], // $25.00 join
    [10000, 1000, 9000], // $100.00 join
    [999, 100, 899], // $9.99: net rounds 899.1 → 899, platform keeps 100
    [499, 50, 449], // $4.99: net rounds 449.1 → 449, platform keeps 50
    [1999, 200, 1799], // $19.99: net rounds 1799.1 → 1799, platform keeps 200
    [105, 10, 95], // $1.05: net rounds 94.5 → 95 (half up), platform keeps the 10 remainder
    [1, 0, 1], // 1¢: net rounds 0.9 → 1, platform keeps 0 — split still reconciles
  ])("a %i¢ join splits fee %i¢ / creator %i¢", (gross, fee, net) => {
    expect(joinSplit(gross)).toEqual({ gross, fee, net });
  });

  it("fee + net always reconciles to the charged gross, and the fee is 10% within a cent", () => {
    for (let gross = 0; gross <= 5000; gross += 1) {
      const { fee, net } = joinSplit(gross);
      expect(fee + net).toBe(gross);
      expect(Math.abs(fee - gross / 10)).toBeLessThanOrEqual(1);
    }
  });
});

describe("the split applies to the actual JOIN charge (checkoutChargeCents)", () => {
  it("a monthly join at $9.99 charges 999¢ and splits 100 / 899", () => {
    const gross = checkoutChargeCents({ price_cents: 999, annual_discount_pct: 0 }, "monthly");
    expect(gross).toBe(999);
    expect(joinSplit(gross)).toEqual({ gross: 999, fee: 100, net: 899 });
  });

  it("an annual join charges 12 months minus the creator discount, then splits 10/90", () => {
    // $10/mo tier, 10% annual discount → 1000 × 12 × 0.90 = 10,800¢ gross.
    const gross = checkoutChargeCents({ price_cents: 1000, annual_discount_pct: 10 }, "annual");
    expect(gross).toBe(10800);
    expect(gross).toBe(annualPriceCents(1000, 10));
    expect(joinSplit(gross)).toEqual({ gross: 10800, fee: 1080, net: 9720 });
  });

  it("an odd-cent annual join still splits to the cent and reconciles", () => {
    // $9.99/mo, 15% annual discount → round(999 × 12 × 0.85) = 10,190¢ gross.
    const gross = checkoutChargeCents({ price_cents: 999, annual_discount_pct: 15 }, "annual");
    expect(gross).toBe(10190);
    const split = joinSplit(gross);
    expect(split).toEqual({ gross: 10190, fee: 1019, net: 9171 });
    expect(split.fee + split.net).toBe(split.gross);
  });
});
