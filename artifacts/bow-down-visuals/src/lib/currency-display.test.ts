/**
 * currency-display.test.ts — Wave-4 #46 local-currency DISPLAY layer.
 *
 * Pins the honesty contract:
 *  - conversion math + sensible rounding against the fallback table;
 *  - Visual Bucs are NEVER converted (the converter refuses VB codes, and
 *    the VB formatter is locale/currency blind);
 *  - every converted figure carries its honesty line naming the USD
 *    charge and the approximate rate — a converted number is never the
 *    charge;
 *  - the rate source is the labeled static fallback (no invented live FX);
 *  - currency follows the locale SETTING, with the Settings preference
 *    as the only override;
 *  - the pricing surfaces actually dock the component + honesty copy.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FALLBACK_RATES_USD,
  RATES_LABEL,
  convertUsd,
  currencyForLocale,
  displayPrice,
  displayPriceFromCents,
  formatUsd,
  getRates,
  parseCurrencyPreference,
  resolveDisplayCurrency,
  roundForDisplay,
} from "./currency-display";
import { formatBucs } from "./visual-bucs";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("conversion math (fallback table)", () => {
  it("converts USD at the fallback rate, then rounds for display", () => {
    // $29 × 0.92 = 26.68 → €27 whole units at ≥10
    expect(convertUsd(29, "EUR")).toBe(27);
    // $29 × 0.79 = 22.91 → £23 (board example shape: "≈ £24 — charged $29 USD")
    expect(convertUsd(29, "GBP")).toBe(23);
    // $12 × 0.92 = 11.04 → €11 (the Pro guide tier)
    expect(convertUsd(12, "EUR")).toBe(11);
    // USD converts to itself, unchanged
    expect(convertUsd(29, "USD")).toBe(29);
  });

  it("keeps small amounts at two decimals instead of collapsing them", () => {
    // $9 pack × 0.92 = 8.28
    expect(convertUsd(9, "EUR")).toBe(8.28);
    expect(roundForDisplay(8.28, "EUR")).toBe(8.28);
  });

  it("rounds zero-decimal currencies to whole units, nearest 10 at 1,000+", () => {
    expect(convertUsd(29, "JPY")).toBe(4350); // 29 × 150
    expect(convertUsd(99, "JPY")).toBe(14850); // 99 × 150 = 14,850 → nearest 10
    expect(convertUsd(29, "KRW")).toBe(40020); // 29 × 1380 = 40,020
    expect(roundForDisplay(1234, "JPY")).toBe(1230);
    expect(roundForDisplay(999, "JPY")).toBe(999);
  });

  it("rounds large two-decimal amounts to the nearest 10 (no false precision)", () => {
    expect(roundForDisplay(2552, "INR")).toBe(2550); // $29 × 88
    expect(convertUsd(29, "INR")).toBe(2550);
  });

  it("refuses non-amounts and unknown currencies", () => {
    expect(convertUsd(NaN, "EUR")).toBeNull();
    expect(convertUsd(-5, "EUR")).toBeNull();
    expect(convertUsd(10, "XXX")).toBeNull();
    expect(convertUsd(10, "")).toBeNull();
  });
});

describe("Visual Bucs are NEVER converted", () => {
  it("the converter refuses every VB-shaped code", () => {
    for (const code of ["VB", "VBUCS", "VISUALBUCS", "VISUAL_BUCS", "CREDITS", "vb"]) {
      expect(convertUsd(10000, code), code).toBeNull();
    }
  });

  it("the VB formatter renders the same string whatever the locale/currency", () => {
    // formatBucs takes no currency/locale at all — pin that its output is
    // the canonical VB rendering and contains no fiat conversion marks.
    const out = formatBucs(10000);
    expect(out).toBe("10,000 Visual Bucs");
    expect(out).not.toContain("≈");
    expect(out).not.toContain("€");
    expect(out).not.toContain("$");
  });

  it("the display module never imports a VB-to-fiat path", () => {
    const src = read("./currency-display.ts");
    expect(src).not.toContain("visual-bucs");
    expect(src).toContain("Visual Bucs are NEVER converted");
  });
});

describe("honest labeling — a converted figure is never the charge", () => {
  it("a converted display carries the full honesty line naming the USD charge", () => {
    const d = displayPrice(29, { locale: "fr" });
    expect(d.isConverted).toBe(true);
    expect(d.currency).toBe("EUR");
    expect(d.convertedText).toContain("≈");
    expect(d.honestyLine).toBeTruthy();
    expect(d.honestyLine).toContain(d.convertedText!);
    expect(d.honestyLine).toContain("charged");
    expect(d.honestyLine).toContain("$29");
    expect(d.honestyLine).toContain("USD");
    expect(d.honestyLine).toContain("approximate");
    expect(d.honestyLine).toContain("settled in USD");
  });

  it("USD viewers get no conversion and no honesty line (nothing to disclose)", () => {
    const d = displayPrice(29, { locale: "en" });
    expect(d).toEqual({
      usdText: "$29",
      currency: "USD",
      isConverted: false,
      convertedText: null,
      honestyLine: null,
    });
  });

  it("the board's example shape holds: converted ≈, USD named as the charge", () => {
    const d = displayPrice(29, { locale: "en", preference: "GBP" });
    expect(d.convertedText).toBe("≈ £23");
    expect(d.honestyLine).toContain("charged $29 USD");
  });

  it("the component source renders the honesty line wherever it converts", () => {
    const src = read("../components/LocalCurrencyPrice.tsx");
    expect(src).toContain("currencyDisplay.honesty");
    expect(src).toContain("isConverted");
    // The converted figure and the honesty copy are one render path.
    expect(src).toContain("convertedText");
  });

  it("en catalog carries the honesty + approximate copy for every surface", () => {
    const en = JSON.parse(read("../locales/en.json")) as {
      currencyDisplay: Record<string, string>;
    };
    expect(en.currencyDisplay.honesty).toContain("{{converted}}");
    expect(en.currencyDisplay.honesty).toContain("{{usd}}");
    expect(en.currencyDisplay.honesty.toLowerCase()).toContain("charged");
    expect(en.currencyDisplay.approxNote.toLowerCase()).toContain("approximate");
    expect(en.currencyDisplay.approxNote).toContain("USD");
    expect(en.currencyDisplay.vbNote).toContain("Visual Bucs");
    expect(en.currencyDisplay.vbNote.toLowerCase()).toContain("never converted");
  });

  it("all 10 catalogs carry the currencyDisplay namespace with placeholder parity", () => {
    for (const loc of ["en", "es", "fr", "pt", "de", "it", "hi", "ar", "ja", "ko"]) {
      const cat = JSON.parse(read(`../locales/${loc}.json`)) as {
        currencyDisplay?: Record<string, string>;
      };
      const block = cat.currencyDisplay;
      expect(block, `${loc} missing currencyDisplay`).toBeTruthy();
      for (const key of ["honesty", "chargedInUsd", "approxNote", "settingsTitle", "settingsDesc", "autoOption", "usdOnlyOption", "vbNote", "ratesNote"]) {
        expect(typeof block![key], `${loc}.currencyDisplay.${key}`).toBe("string");
        expect(block![key]!.trim().length, `${loc}.currencyDisplay.${key} empty`).toBeGreaterThan(0);
      }
      expect(block!.honesty, `${loc} honesty placeholders`).toContain("{{converted}}");
      expect(block!.honesty, `${loc} honesty placeholders`).toContain("{{usd}}");
      expect(block!.chargedInUsd, `${loc} chargedInUsd placeholder`).toContain("{{usd}}");
    }
  });
});

describe("rate source — labeled static fallback, no invented live FX", () => {
  it("getRates returns the fallback table, flagged approximate", () => {
    const r = getRates();
    expect(r.source).toBe("static-fallback");
    expect(r.approximate).toBe(true);
    expect(r.label).toBe(RATES_LABEL);
    expect(r.label.toLowerCase()).toContain("not a live exchange rate");
    expect(r.rates).toBe(FALLBACK_RATES_USD);
  });

  it("the fallback table is rounded, sane, and covers every supported currency", () => {
    expect(FALLBACK_RATES_USD.USD).toBe(1);
    expect(FALLBACK_RATES_USD.SAR).toBe(3.75); // the actual USD peg
    for (const [code, rate] of Object.entries(FALLBACK_RATES_USD)) {
      expect(rate, code).toBeGreaterThan(0);
      // deliberately rounded: at most 2 decimal places, no fake precision
      expect(Number(rate.toFixed(2)), code).toBe(rate);
    }
  });
});

describe("currency follows the locale setting; preference overrides", () => {
  it("maps all 10 site locales", () => {
    expect(currencyForLocale("en")).toBe("USD");
    expect(currencyForLocale("es")).toBe("EUR");
    expect(currencyForLocale("fr")).toBe("EUR");
    expect(currencyForLocale("de")).toBe("EUR");
    expect(currencyForLocale("it")).toBe("EUR");
    expect(currencyForLocale("pt")).toBe("BRL");
    expect(currencyForLocale("hi")).toBe("INR");
    expect(currencyForLocale("ar")).toBe("SAR");
    expect(currencyForLocale("ja")).toBe("JPY");
    expect(currencyForLocale("ko")).toBe("KRW");
    expect(currencyForLocale("fr-CA")).toBe("EUR"); // base language wins
    expect(currencyForLocale("xx")).toBe("USD");
    expect(currencyForLocale(undefined)).toBe("USD");
  });

  it("a pinned preference beats the locale; auto follows it", () => {
    expect(resolveDisplayCurrency({ locale: "fr", preference: "auto" })).toBe("EUR");
    expect(resolveDisplayCurrency({ locale: "fr", preference: "GBP" })).toBe("GBP");
    expect(resolveDisplayCurrency({ locale: "ja", preference: "USD" })).toBe("USD");
  });

  it("preference parsing is strict — junk falls back to auto", () => {
    expect(parseCurrencyPreference(null)).toBe("auto");
    expect(parseCurrencyPreference("auto")).toBe("auto");
    expect(parseCurrencyPreference("eur")).toBe("EUR");
    expect(parseCurrencyPreference("VB")).toBe("auto"); // VB can never be a display currency
    expect(parseCurrencyPreference("garbage")).toBe("auto");
  });

  it("cents payloads (storefront/shop) convert from the same seam", () => {
    const d = displayPriceFromCents(2900, { locale: "de" });
    expect(d.usdText).toBe("$29");
    expect(d.convertedText).toContain("≈");
    expect(d.honestyLine).toContain("charged $29 USD");
    const free = displayPriceFromCents(0, { locale: "de" });
    expect(free.usdText).toBe("$0");
  });

  it("formatUsd always renders the charge in dollars", () => {
    expect(formatUsd(29, "fr")).toContain("29");
    expect(formatUsd(29, "en")).toBe("$29");
  });
});

describe("docked into the existing pricing surfaces (no standalone page)", () => {
  it("pricing page renders converted prices for plans + credit packs and the section note", () => {
    const src = read("../pages/pricing.tsx");
    expect(src).toContain("LocalCurrencyPrice");
    expect(src).toContain("CurrencyHonestyNote");
    expect(src).toContain("priceUsd");
  });

  it("creator pricing (guide tiers) renders the converted price under the USD price", () => {
    const src = read("../pages/creator-pricing.tsx");
    expect(src).toContain("LocalCurrencyPrice");
    expect(src).toContain("priceUsdPerMonth");
  });

  it("storefront product page renders the converted price beside the USD price", () => {
    const src = read("../pages/storefront-product.tsx");
    expect(src).toContain("LocalCurrencyPrice");
    expect(src).toContain("priceCents");
  });

  it("shop renders the converted price on the product detail", () => {
    const src = read("../pages/shop.tsx");
    expect(src).toContain("LocalCurrencyPrice");
  });

  it("settings carries the single display preference, in the existing page", () => {
    const src = read("../pages/settings.tsx");
    expect(src).toContain("CurrencyDisplaySettings");
    const card = read("../components/CurrencyDisplaySettings.tsx");
    expect(card).toContain("writeCurrencyPreference");
    expect(card).toContain("currencyDisplay.vbNote");
  });

  it("no new route was created for currency display", () => {
    const app = read("../App.tsx");
    expect(app.toLowerCase()).not.toContain("currency-display");
    expect(app.toLowerCase()).not.toContain("currencydisplay");
  });
});
