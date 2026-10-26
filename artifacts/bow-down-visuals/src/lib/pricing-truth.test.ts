/**
 * pricing-truth.test.ts — payfix lane 3 (pricing-truth).
 *
 * /pricing used to sell a FAKE 6-plan ladder ($19/$49/$99/$199/$399/$799,
 * rank names as plans, every button joining the beta list under
 * "Billing is not live yet") while /creator-pricing sold the real plans
 * (Free $0 / Pro $12 / Elite $29, checkout live in test mode). These pins
 * hold the fix: ONE shared FE source (@/lib/pricing-plans) consumed by
 * BOTH pages, re-derived against the server's own sources of truth
 * (platform-fees.ts TIER_PLANS + stripe-payments.ts PACK_MAP) so the
 * pages cannot drift apart or away from the rails again.
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CREATOR_PLANS, CREDIT_PACKS, PRICING_TEST_MODE_NOTE } from "./pricing-plans";

function readFe(rel: string): string {
  return readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
}
function readApi(rel: string): string {
  return readFileSync(new URL(`../../../api-server/src/${rel}`, import.meta.url), "utf8");
}

describe("shared source carries the ratified plans only", () => {
  it("plan names + prices are Free $0 / Pro $12 / Elite $29", () => {
    expect(CREATOR_PLANS.map((p) => p.name)).toEqual(["Free", "Pro", "Elite"]);
    expect(CREATOR_PLANS.map((p) => p.priceUsdPerMonth)).toEqual([0, 12, 29]);
    expect(CREATOR_PLANS.map((p) => p.tier)).toEqual(["free", "pro", "elite"]);
  });

  it("flat 5% fee + boosts 3/25/100 on every tier", () => {
    expect(CREATOR_PLANS.map((p) => p.feeBps)).toEqual([500, 500, 500]);
    expect(CREATOR_PLANS.map((p) => p.feePct)).toEqual(["5%", "5%", "5%"]);
    expect(CREATOR_PLANS.map((p) => p.aiBoostsPerMonth)).toEqual([3, 25, 100]);
  });

  it("matches the server TIER_PLANS names, prices and feature labels exactly", () => {
    const fees = readApi("lib/platform-fees.ts");
    const block = fees.slice(fees.indexOf("export const TIER_PLANS"), fees.indexOf("export function breakEvenSalesUsd"));
    const serverNames = [...block.matchAll(/name: "([^"]+)"/g)].map((m) => m[1]);
    expect(serverNames).toEqual(CREATOR_PLANS.map((p) => p.name));
    const serverPrices = [...block.matchAll(/priceUsdPerMonth: (null|\d+)/g)].map((m) =>
      m[1] === "null" ? 0 : Number(m[1]),
    );
    expect(serverPrices).toEqual(CREATOR_PLANS.map((p) => p.priceUsdPerMonth));
    const serverLabels = [...block.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]);
    const sharedLabels = CREATOR_PLANS.flatMap((p) => p.features.map((f) => f.label));
    expect(sharedLabels).toEqual(serverLabels);
  });

  it("credit packs match the server PACK_MAP (keys, credits) at $9/$39/$99/$249", () => {
    const stripe = readApi("routes/stripe-payments.ts");
    const block = stripe.slice(stripe.indexOf("const PACK_MAP"), stripe.indexOf("function getStripe"));
    const serverPacks = [...block.matchAll(/"(\d+)":\s*\{\s*envKey: "[^"]+",\s*credits: (\d+)/g)].map((m) => ({
      packKey: m[1],
      credits: Number(m[2]),
    }));
    expect(CREDIT_PACKS.map((p) => ({ packKey: p.packKey, credits: p.credits }))).toEqual(serverPacks);
    expect(CREDIT_PACKS.map((p) => p.priceUsd)).toEqual([9, 39, 99, 249]);
    expect(CREDIT_PACKS.map((p) => p.priceLabel)).toEqual(["$9", "$39", "$99", "$249"]);
  });
});

describe("both pages render the shared source — identical names/prices", () => {
  it("/pricing maps CREATOR_PLANS + CREDIT_PACKS from pricing-plans", () => {
    const page = readFe("pages/pricing.tsx");
    expect(page).toContain('from "@/lib/pricing-plans"');
    expect(page).toContain("CREATOR_PLANS.map");
    expect(page).toContain("CREDIT_PACKS.map");
    expect(page).toContain("PRICING_TEST_MODE_NOTE");
  });

  it("/creator-pricing builds its rendered plans from the same CREATOR_PLANS", () => {
    const page = readFe("pages/creator-pricing.tsx");
    expect(page).toContain('from "@/lib/pricing-plans"');
    expect(page).toContain("CREATOR_PLANS.map");
    // Names/prices/features may NOT be re-declared locally on either page.
    for (const src of [page, readFe("pages/pricing.tsx")]) {
      expect(src).not.toMatch(/price:\s*(19|49|99|199|399|799)\b/);
    }
  });
});

describe("the fake ladder is gone from pricing contexts", () => {
  const FAKE_STRINGS = [
    "Billing is not live yet",
    "All plan buttons join the beta list",
    "Payments are not live yet",
    "Become a Crime Boss",
    "Claim the Kingpin Crown",
    "Become a Gangster",
    "Become a Shot Caller",
    "150,000 Visual Bucs monthly",
    "400,000 Visual Bucs monthly",
    "60,000 Visual Bucs monthly",
    "25,000 Visual Bucs monthly",
  ];

  it("neither pricing page carries a fake-ladder string", () => {
    for (const rel of ["pages/pricing.tsx", "pages/creator-pricing.tsx"]) {
      const src = readFe(rel);
      for (const fake of FAKE_STRINGS) {
        expect(src, `${rel}: ${fake}`).not.toContain(fake);
      }
      expect(src, `${rel}: beta-access plan CTA`).not.toContain('href="/beta-access"');
    }
  });

  it("no locale catalog carries the fake plan ladder or the false billing copy", () => {
    const dir = new URL("../locales/", import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
    expect(files).toHaveLength(10);
    for (const file of files) {
      const cat = JSON.parse(readFileSync(new URL(`../locales/${file}`, import.meta.url), "utf8"));
      expect(cat.pricing.plans, `${file}: pricing.plans ladder`).toBeUndefined();
      const betaText: string = cat.pricing.betaNotice.text;
      expect(betaText, `${file}: betaNotice`).not.toMatch(/not live|not yet live|payments are coming/i);
      expect(cat.pricing.faq.a2, `${file}: faq.a2`).not.toMatch(/not yet\.|coming soon/i);
    }
  });

  it("the test-mode note is honest: checkout open, no real money", () => {
    expect(PRICING_TEST_MODE_NOTE).toContain("test mode");
    expect(PRICING_TEST_MODE_NOTE).toContain("no real money is charged");
    expect(PRICING_TEST_MODE_NOTE).not.toContain("not live");
  });
});
