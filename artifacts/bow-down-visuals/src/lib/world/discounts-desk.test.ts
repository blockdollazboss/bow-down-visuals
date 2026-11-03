/**
 * discounts-desk — stack1500 world parity wave #3 item 45
 * pins. The Discount Codes desk is the seller codes' native
 * form. These pins hold: the family is FREE (no registry
 * row); the state helper mirrors the rail's discountUsable
 * order (inactive → expired → used up → live); the list
 * guard reads the rail's camelCase rows and drops malformed
 * ones rather than dressing them up; the create payload
 * mirrors CreateDiscountSchema (code charset + length,
 * percent 1–90 int, blank max-uses = -1, a date becomes the
 * ISO datetime the schema demands); the usage line is
 * honest about limits.
 */
import { describe, expect, it } from "vitest";
import {
  DISCOUNTS_FREE,
  buildDiscountPayload,
  discountCodeState,
  discountCodesOf,
  discountPath,
  discountUsageLine,
  type DiscountCode,
} from "./discounts-desk";

const CODE: DiscountCode = {
  id: "d1",
  code: "CROWN20",
  percentOff: 20,
  maxUses: 50,
  usedCount: 12,
  expiresAt: null,
  isActive: true,
  appliesTo: "3 active product(s)",
};

const NOW = new Date("2026-11-03T12:00:00Z").getTime();

describe("free rails + paths", () => {
  it("no registry row exists for the family", () => {
    expect(DISCOUNTS_FREE).toBe(true);
    expect(discountPath("d 1")).toBe("/api/storefront/discounts/d%201");
  });
});

describe("the state helper — the rail's discountUsable order", () => {
  it("inactive beats expired beats used-up beats live", () => {
    expect(discountCodeState({ ...CODE, isActive: false, expiresAt: "2020-01-01T00:00:00Z", usedCount: 50 }, NOW)).toBe("inactive");
    expect(discountCodeState({ ...CODE, expiresAt: "2020-01-01T00:00:00Z", usedCount: 50 }, NOW)).toBe("expired");
    expect(discountCodeState({ ...CODE, usedCount: 50 }, NOW)).toBe("used-up");
    expect(discountCodeState(CODE, NOW)).toBe("live");
    expect(discountCodeState({ ...CODE, maxUses: -1, usedCount: 9999 }, NOW)).toBe("live");
  });

  it("the usage line is honest about limits", () => {
    expect(discountUsageLine(CODE)).toBe("12 of 50 used");
    expect(discountUsageLine({ ...CODE, maxUses: -1 })).toBe("12 used · no limit");
  });
});

describe("the list guard", () => {
  it("reads the rail's rows; malformed rows drop", () => {
    const codes = discountCodesOf({
      codes: [
        { id: "d1", code: "CROWN20", percentOff: 20, maxUses: 50, usedCount: 12, expiresAt: null, isActive: true, createdAt: "x", appliesTo: "3 active product(s)" },
        { id: "d2", code: "BROKEN" },
        "junk",
      ],
    })!;
    expect(codes).toHaveLength(1);
    expect(codes[0]).toEqual(CODE);
    expect(discountCodesOf({})).toBeNull();
  });
});

describe("the create payload — CreateDiscountSchema mirrored", () => {
  it("a good form builds the rail's body; the date becomes end-of-day ISO", () => {
    const body = buildDiscountPayload({ code: " crown20 ", percentOff: "20", maxUses: "", expiresDate: "2026-12-31" })!;
    expect(body["code"]).toBe("crown20");
    expect(body["percentOff"]).toBe(20);
    expect(body["maxUses"]).toBe(-1);
    expect(typeof body["expiresAt"]).toBe("string");
    expect(new Date(body["expiresAt"] as string).getDate()).toBe(31);
    expect(buildDiscountPayload({ code: "X1", percentOff: "10", maxUses: "", expiresDate: "" })?.["expiresAt"]).toBeNull();
  });

  it("bad inputs are refused in-desk", () => {
    expect(buildDiscountPayload({ code: "A", percentOff: "10", maxUses: "", expiresDate: "" })).toBeNull();
    expect(buildDiscountPayload({ code: "HAS SPACE", percentOff: "10", maxUses: "", expiresDate: "" })).toBeNull();
    expect(buildDiscountPayload({ code: "OK20", percentOff: "0", maxUses: "", expiresDate: "" })).toBeNull();
    expect(buildDiscountPayload({ code: "OK20", percentOff: "91", maxUses: "", expiresDate: "" })).toBeNull();
    expect(buildDiscountPayload({ code: "OK20", percentOff: "10", maxUses: "-2", expiresDate: "" })).toBeNull();
  });
});
