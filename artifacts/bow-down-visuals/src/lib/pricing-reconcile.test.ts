/**
 * pricing-reconcile.test.ts — Stack-100 #3, Wave 3, Lane 12.
 *
 * Display-vs-source reconciliation pins. Sources of truth (see
 * .lane/TRUTH.md): TIER_PLANS in api-server/src/lib/platform-fees.ts
 * (Free $0 / Pro $12/mo / Elite $29/mo, flat 5% fee) and the server
 * PACK_MAP in api-server/src/routes/stripe-payments.ts (keys
 * 10/50/150/500 → 1,000/5,000/15,000/50,000 Visual Bucs), whose
 * displayed dollar prices are $9/$39/$99/$249 on every surface.
 * These pins hold the DISPLAYS to those sources — a wrong price in
 * one language is still a wrong price.
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readFe(rel: string): string {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}

/** Digits only, so locale grouping ("1 000", "1.000", "1,000") compares equal. */
function digits(s: unknown): string {
  return String(s ?? "").replace(/\D/g, "");
}

const EXPECTED_PACKS: Record<string, { credits: string; price: string }> = {
  "10": { credits: "1000", price: "9" },
  "50": { credits: "5000", price: "39" },
  "150": { credits: "15000", price: "99" },
  "500": { credits: "50000", price: "249" },
};

describe("credit pack displays match the server PACK_MAP on every surface", () => {
  it("all 10 locale catalogs price the packs $9/$39/$99/$249 for 1k/5k/15k/50k VB", () => {
    const dir = new URL("../locales/", import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
    expect(files).toHaveLength(10);
    for (const file of files) {
      const cat = JSON.parse(readFileSync(new URL(`../locales/${file}`, import.meta.url), "utf8"));
      const packs = cat?.pricing?.creditPacks?.packs;
      expect(packs, `${file}: pricing.creditPacks.packs missing`).toBeTruthy();
      for (const [key, exp] of Object.entries(EXPECTED_PACKS)) {
        expect(digits(packs[key]?.credits), `${file} pack ${key} credits`).toBe(exp.credits);
        expect(digits(packs[key]?.price), `${file} pack ${key} price`).toBe(exp.price);
      }
    }
  });

  it("home page pack cards carry the same four prices in rail order", () => {
    const home = readFe("pages/home.tsx");
    const block = home.slice(home.indexOf("const CREDIT_PACKS"), home.indexOf("const FAQS"));
    const prices = [...block.matchAll(/price: "(\$\d+)"/g)].map((m) => m[1]);
    expect(prices).toEqual(["$9", "$39", "$99", "$249"]);
  });
});

describe("creator tier price displays match TIER_PLANS ($0 / $12 / $29)", () => {
  it("pricing guide states Pro $12/mo and Elite $29/mo with TIER_PLANS features", () => {
    const guide = readFe("guides/pricing.ts");
    expect(guide).toContain("Creator Pro — $12/mo");
    expect(guide).toContain("Creator Elite — $29/mo");
    expect(guide).toContain("25 AI promotion boosts a month");
    expect(guide).toContain("100 AI promotion boosts a month");
  });

  it("creator-pricing no longer calls the approved prices 'proposed'", () => {
    const page = readFe("pages/creator-pricing.tsx");
    expect(page).not.toContain("Prices and fee rates are proposed");
    expect(page).toContain("Prices approved 2026-10-07");
  });
});
