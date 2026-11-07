import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildAlertText,
  feeBreakdown,
  formatPrice,
  parsePriceToCents,
  platformFeeCents,
  LIVE_SHOPPING_FEE_BPS,
} from "./live-shopping";

describe("LIVE_SHOPPING_FEE_BPS", () => {
  it("is 5% in basis points, matching the server", () => {
    expect(LIVE_SHOPPING_FEE_BPS).toBe(500);
  });
});

describe("formatPrice", () => {
  it("formats cents as dollars", () => {
    expect(formatPrice(2499)).toBe("$24.99");
    expect(formatPrice(100)).toBe("$1.00");
    expect(formatPrice(0)).toBe("$0.00");
  });
});

describe("parsePriceToCents", () => {
  it("parses dollar strings to whole cents", () => {
    expect(parsePriceToCents("24.99")).toBe(2499);
    expect(parsePriceToCents(" 5 ")).toBe(500);
    expect(parsePriceToCents("0")).toBe(0);
  });

  it("returns NaN for invalid input", () => {
    expect(parsePriceToCents("")).toBeNaN();
    expect(parsePriceToCents("abc")).toBeNaN();
    expect(parsePriceToCents("-5")).toBeNaN();
  });
});

describe("platformFeeCents", () => {
  it("computes the 5% fee, rounding half-up", () => {
    expect(platformFeeCents(10000)).toBe(500);
    expect(platformFeeCents(99)).toBe(5);
    expect(platformFeeCents(10)).toBe(1);
  });
});

describe("feeBreakdown", () => {
  it("renders a readable fee line", () => {
    expect(feeBreakdown(2499)).toBe("5% of $24.99 = $1.25");
  });
});

describe("buildAlertText", () => {
  it("builds the overlay alert headline", () => {
    expect(buildAlertText("Testfan", 2, 4998)).toBe("Testfan bought 2× — $49.98");
  });

  it("falls back to 'A viewer' for blank names", () => {
    expect(buildAlertText("   ", 1, 2499)).toBe("A viewer bought 1× — $24.99");
  });
});

/* Stack-200 census item 4 — the note under "Fire a test purchase
 * alert" used to claim "no real payments until platform checkout
 * ships" on the very page whose default buy path IS the shipped
 * on-platform checkout (embedded, test mode) — the page's own banner
 * says so. The replacement states today's truth: a test alert never
 * charges anyone, and real purchases go through the pinned product's
 * Buy button at platform checkout on the page (test mode).
 * Payment-adjacent copy follows the money-copy law (the W8 shoutout
 * pattern): the English source is carried VERBATIM in all ten
 * catalogs — the non-English values are English by design, flagged
 * UNREVIEWED, and allowlisted in the locale-waves suites. */
describe("liveShopping.testAlertsNote (Stack-200 item 4)", () => {
  const load = (locale: string): Record<string, any> =>
    JSON.parse(readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8")) as Record<string, any>;
  const en = load("en").liveShopping.testAlertsNote as string;

  it("no longer claims payments haven't shipped", () => {
    expect(en).not.toContain("no real payments");
    expect(en).not.toContain("until platform checkout ships");
  });

  it("states today's truth: test alerts never charge; the Buy button checks out on-platform (test mode)", () => {
    expect(en).toContain("never charges anyone");
    expect(en).toContain("Buy button");
    expect(en).toContain("right here on the platform (test mode)");
  });

  it("is present and English-verbatim in every catalog (money-copy law)", () => {
    for (const locale of ["en", "ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"]) {
      const note = load(locale).liveShopping.testAlertsNote;
      expect(note, `${locale} liveShopping.testAlertsNote`).toBe(en);
    }
  });
});
