/**
 * Wave-4 #47 — Stripe Tax to the activation line.
 *
 * The contract under test: with STRIPE_TAX_ENABLED unset/off, every
 * helper is a no-op and checkout behavior is byte-identical to the
 * pre-tax plumbing; with it on, sessions request automatic tax, line
 * items carry the mapped preset tax codes, and amount reads come
 * back net of collected tax so fee splits never touch tax money.
 */
import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { DIGITAL_ITEM_KINDS } from "@workspace/db";
import { STORE_PRODUCT_KINDS } from "@workspace/db";
import {
  applyStripeTaxToPriceData,
  isStripeTaxEnabled,
  sessionAmountExcludingTaxCents,
  sessionTaxCents,
  stripeTaxCodeFor,
  stripeTaxKindForStoreKind,
  stripeTaxKindForStorefrontKind,
  stripeTaxSessionFields,
} from "../stripe-tax";

const OFF: Record<string, string | undefined> = {};
const ON: Record<string, string | undefined> = { STRIPE_TAX_ENABLED: "1" };

describe("isStripeTaxEnabled", () => {
  it("is off by default and for any non-affirmative value", () => {
    expect(isStripeTaxEnabled(OFF)).toBe(false);
    expect(isStripeTaxEnabled({ STRIPE_TAX_ENABLED: "0" })).toBe(false);
    expect(isStripeTaxEnabled({ STRIPE_TAX_ENABLED: "off" })).toBe(false);
    expect(isStripeTaxEnabled({ STRIPE_TAX_ENABLED: "yes" })).toBe(false);
    expect(isStripeTaxEnabled({ STRIPE_TAX_ENABLED: "" })).toBe(false);
  });
  it("turns on for 1/true in any case, trimmed", () => {
    expect(isStripeTaxEnabled({ STRIPE_TAX_ENABLED: "1" })).toBe(true);
    expect(isStripeTaxEnabled({ STRIPE_TAX_ENABLED: "true" })).toBe(true);
    expect(isStripeTaxEnabled({ STRIPE_TAX_ENABLED: " TRUE " })).toBe(true);
  });
});

describe("stripeTaxSessionFields", () => {
  it("returns an empty object while disabled (params unchanged)", () => {
    expect(stripeTaxSessionFields(OFF)).toEqual({});
  });
  it("requests automatic tax + required billing address when enabled", () => {
    expect(stripeTaxSessionFields(ON)).toEqual({
      automatic_tax: { enabled: true },
      billing_address_collection: "required",
    });
  });
});

describe("stripeTaxCodeFor — mapping from existing catalog constants", () => {
  it("maps each rail kind to its Stripe preset code", () => {
    expect(stripeTaxCodeFor("credit-packs", OFF)).toBe("txcd_10000000");
    expect(stripeTaxCodeFor("subscription", OFF)).toBe("txcd_10103000");
    expect(stripeTaxCodeFor("store-audio", OFF)).toBe("txcd_10401100");
    expect(stripeTaxCodeFor("store-video", OFF)).toBe("txcd_10402100");
    expect(stripeTaxCodeFor("store-stream", OFF)).toBe("txcd_10402000");
    expect(stripeTaxCodeFor("store-digital", OFF)).toBe("txcd_10000000");
    expect(stripeTaxCodeFor("general-services", OFF)).toBe("txcd_20030000");
    expect(stripeTaxCodeFor("tangible-goods", OFF)).toBe("txcd_99999999");
  });
  it("honors a well-formed env override", () => {
    expect(
      stripeTaxCodeFor("subscription", { STRIPE_TAX_CODE_SUBSCRIPTION: "txcd_10103001" }),
    ).toBe("txcd_10103001");
  });
  it("fails closed on a malformed override", () => {
    expect(() =>
      stripeTaxCodeFor("subscription", { STRIPE_TAX_CODE_SUBSCRIPTION: "saas" }),
    ).toThrow(/STRIPE_TAX_CODE_SUBSCRIPTION/);
    expect(() =>
      stripeTaxCodeFor("credit-packs", { STRIPE_TAX_CODE_CREDIT_PACKS: "txcd_123" }),
    ).toThrow(/txcd_/);
  });
});

describe("kind mapping covers the full existing catalogs", () => {
  it("every DIGITAL_ITEM_KINDS member maps to a tax kind", () => {
    const seen = new Map<string, string>();
    for (const kind of DIGITAL_ITEM_KINDS) {
      seen.set(kind, stripeTaxKindForStoreKind(kind));
    }
    expect(seen.get("track")).toBe("store-audio");
    expect(seen.get("album")).toBe("store-audio");
    expect(seen.get("video")).toBe("store-video");
    expect(seen.get("series")).toBe("store-stream");
    for (const kind of DIGITAL_ITEM_KINDS) {
      expect(seen.get(kind), kind).toBeTruthy();
      expect(stripeTaxCodeFor(seen.get(kind) as never, OFF)).toMatch(/^txcd_\d{8}$/);
    }
  });
  it("every STORE_PRODUCT_KINDS member maps — except gift cards, which are not taxed at sale", () => {
    for (const kind of STORE_PRODUCT_KINDS) {
      const taxKind = stripeTaxKindForStorefrontKind(kind);
      if (kind === "gift_card") {
        expect(taxKind).toBeNull();
      } else {
        expect(taxKind, kind).toBeTruthy();
        expect(stripeTaxCodeFor(taxKind as never, OFF)).toMatch(/^txcd_\d{8}$/);
      }
    }
    expect(stripeTaxKindForStorefrontKind("merch")).toBe("tangible-goods");
    expect(stripeTaxKindForStorefrontKind("service")).toBe("general-services");
    expect(stripeTaxKindForStorefrontKind("ticket")).toBe("general-services");
  });
});

describe("applyStripeTaxToPriceData", () => {
  const base = {
    currency: "usd",
    unit_amount: 1200,
    product_data: { name: "Track — Artist", description: "Digital download · track" },
  };
  it("passes the object through by reference while disabled", () => {
    expect(applyStripeTaxToPriceData(base, "store-audio", OFF)).toBe(base);
  });
  it("passes through for a null kind even when enabled (gift cards)", () => {
    expect(applyStripeTaxToPriceData(base, null, ON)).toBe(base);
  });
  it("adds exclusive tax behavior + the mapped tax code when enabled, preserving fields", () => {
    const out = applyStripeTaxToPriceData(base, "store-audio", ON);
    expect(out).not.toBe(base);
    expect(out.tax_behavior).toBe("exclusive");
    expect(out.product_data.tax_code).toBe("txcd_10401100");
    expect(out.product_data.name).toBe("Track — Artist");
    expect(out.product_data.description).toBe("Digital download · track");
    expect(out.unit_amount).toBe(1200);
    /* the input is not mutated */
    expect(base.product_data).not.toHaveProperty("tax_code");
  });
});

describe("session tax amount reads", () => {
  const session = (partial: Partial<Stripe.Checkout.Session>) =>
    partial as Stripe.Checkout.Session;
  it("reads zero when total_details is absent (tax off — today's sessions)", () => {
    expect(sessionTaxCents(session({}))).toBe(0);
    expect(sessionTaxCents(session({ total_details: null }))).toBe(0);
    expect(sessionAmountExcludingTaxCents(session({ amount_total: 5000 }))).toBe(5000);
  });
  it("nets collected tax out of the total when Stripe Tax ran", () => {
    const s = session({
      amount_total: 5500,
      total_details: { amount_tax: 500, amount_discount: 0, amount_shipping: 0 },
    });
    expect(sessionTaxCents(s)).toBe(500);
    expect(sessionAmountExcludingTaxCents(s)).toBe(5000);
  });
  it("preserves the caller's fallback when amount_total is missing", () => {
    expect(sessionAmountExcludingTaxCents(session({ amount_total: null }), 4200)).toBe(4200);
    expect(sessionAmountExcludingTaxCents(session({ amount_total: null }))).toBe(0);
  });
  it("never lets a bogus tax figure drive the gross negative-ward", () => {
    const s = session({
      amount_total: 100,
      total_details: { amount_tax: -50, amount_discount: 0, amount_shipping: 0 },
    });
    expect(sessionTaxCents(s)).toBe(0);
    expect(sessionAmountExcludingTaxCents(s)).toBe(100);
  });
});
