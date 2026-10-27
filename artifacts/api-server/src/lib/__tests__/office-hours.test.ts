/**
 * Office Hours (#167) — the VB money seam for Paid Bookings.
 * Pins: the service-shape reader (flag + valid price, never a guess),
 * the intent-derived charge key (same booking = same key, different
 * slot/product/buyer = different key), the Messages door, and the
 * credits-rail wrappers (charge maps typed failures to honest
 * answers; refund restores AND voids the key; a failed refund reports
 * false and does not void).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  chargeImpl: null as null | ((...a: any[]) => Promise<number>),
  refundImpl: null as null | ((...a: any[]) => Promise<void>),
  voidCalls: [] as string[],
  chargeCalls: [] as Array<{ userId: string; cost: number; opts: any }>,
  refundCalls: [] as Array<{ userId: string; amount: number }>,
}));

vi.mock("../credits", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    chargeCredits: vi.fn(async (userId: string, cost: number, _rec: any, opts: any) => {
      h.chargeCalls.push({ userId, cost, opts });
      if (h.chargeImpl) return h.chargeImpl(userId, cost, _rec, opts);
      return 1000 - cost;
    }),
    refundCredits: vi.fn(async (userId: string, amount: number) => {
      h.refundCalls.push({ userId, amount });
      if (h.refundImpl) return h.refundImpl(userId, amount);
    }),
    voidChargeIdempotencyKey: vi.fn(async (key: string) => {
      h.voidCalls.push(key);
      return true;
    }),
  };
});

import {
  officeHoursInfo,
  officeHoursChargeKey,
  officeHoursMessagesPath,
  chargeOfficeHoursBooking,
  refundOfficeHoursBooking,
} from "../office-hours";
import { OutOfCreditsError, CreditsDisabledError, LedgerWriteError } from "../credits";

beforeEach(() => {
  h.chargeImpl = null;
  h.refundImpl = null;
  h.voidCalls = [];
  h.chargeCalls = [];
  h.refundCalls = [];
});

describe("officeHoursInfo", () => {
  it("reads a valid Office Hours service", () => {
    expect(officeHoursInfo({ office_hours: true, price_vb: 750 })).toEqual({ officeHours: true, priceVb: 750 });
  });
  it("is not Office Hours without the flag", () => {
    expect(officeHoursInfo({ price_vb: 750 })).toEqual({ officeHours: false, priceVb: null });
    expect(officeHoursInfo(null)).toEqual({ officeHours: false, priceVb: null });
    expect(officeHoursInfo(undefined)).toEqual({ officeHours: false, priceVb: null });
  });
  it("never guesses a price: flagged without a valid price reads priceVb null", () => {
    for (const sd of [
      { office_hours: true },
      { office_hours: true, price_vb: 0 },
      { office_hours: true, price_vb: -5 },
      { office_hours: true, price_vb: 7.5 },
      { office_hours: true, price_vb: "750" },
    ]) {
      expect(officeHoursInfo(sd as any)).toEqual({ officeHours: true, priceVb: null });
    }
  });
});

describe("officeHoursChargeKey", () => {
  const base = { buyerUserId: "u1", productId: "p1", startUtc: "2026-11-02T14:00:00.000Z" };
  it("is deterministic for the same intent", () => {
    expect(officeHoursChargeKey(base)).toBe(officeHoursChargeKey({ ...base }));
    expect(officeHoursChargeKey(base)).toBe("office-hours:u1:p1:2026-11-02T14:00:00.000Z");
  });
  it("differs across buyer, product, and slot", () => {
    const k = officeHoursChargeKey(base);
    expect(officeHoursChargeKey({ ...base, buyerUserId: "u2" })).not.toBe(k);
    expect(officeHoursChargeKey({ ...base, productId: "p2" })).not.toBe(k);
    expect(officeHoursChargeKey({ ...base, startUtc: "2026-11-02T15:00:00.000Z" })).not.toBe(k);
  });
});

describe("officeHoursMessagesPath", () => {
  it("deep-links into the DM thread with the other party", () => {
    expect(officeHoursMessagesPath("user-123")).toBe("/messages?to=user-123");
  });
});

describe("chargeOfficeHoursBooking", () => {
  it("charges personal-only under the intent key and returns the balance", async () => {
    const r = await chargeOfficeHoursBooking({ buyerUserId: "u1", priceVb: 750, chargeKey: "office-hours:k" });
    expect(r).toEqual({ ok: true, balanceAfter: 250 });
    expect(h.chargeCalls).toHaveLength(1);
    expect(h.chargeCalls[0]!.cost).toBe(750);
    expect(h.chargeCalls[0]!.opts).toMatchObject({ personalOnly: true, idempotencyKey: "office-hours:k" });
  });
  it("maps insufficient balance to 402 INSUFFICIENT_BALANCE", async () => {
    h.chargeImpl = async () => { throw new OutOfCreditsError(); };
    const r = await chargeOfficeHoursBooking({ buyerUserId: "u1", priceVb: 750, chargeKey: "k" });
    expect(r).toMatchObject({ ok: false, status: 402, code: "INSUFFICIENT_BALANCE" });
  });
  it("maps credits-disabled to 403 and ledger failure to 500", async () => {
    h.chargeImpl = async () => { throw new CreditsDisabledError(); };
    expect(await chargeOfficeHoursBooking({ buyerUserId: "u1", priceVb: 1, chargeKey: "k" }))
      .toMatchObject({ ok: false, status: 403, code: "CREDITS_DISABLED" });
    h.chargeImpl = async () => { throw new LedgerWriteError(); };
    expect(await chargeOfficeHoursBooking({ buyerUserId: "u1", priceVb: 1, chargeKey: "k" }))
      .toMatchObject({ ok: false, status: 500, code: "LEDGER_FAILED" });
  });
});

describe("refundOfficeHoursBooking", () => {
  it("refunds in full and voids the charge key", async () => {
    const ok = await refundOfficeHoursBooking({ buyerUserId: "u1", priceVb: 750, chargeKey: "office-hours:k" });
    expect(ok).toBe(true);
    expect(h.refundCalls).toEqual([{ userId: "u1", amount: 750 }]);
    expect(h.voidCalls).toEqual(["office-hours:k"]);
  });
  it("reports false and does not void when the refund itself fails", async () => {
    h.refundImpl = async () => { throw new Error("db down"); };
    const ok = await refundOfficeHoursBooking({ buyerUserId: "u1", priceVb: 750, chargeKey: "office-hours:k" });
    expect(ok).toBe(false);
    expect(h.voidCalls).toEqual([]);
  });
});
