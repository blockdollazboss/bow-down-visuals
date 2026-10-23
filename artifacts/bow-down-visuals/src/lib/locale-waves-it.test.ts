/**
 * locale-waves-it.test.ts — Stack-28 Italian locale waves (board items
 * 75 / 84 / 93 = it-W1 / it-W2 / it-W3 per a7-locale.md §5.6).
 *
 * Pins, per wave namespace set:
 *  - completeness: every en key in the wave namespaces exists in it,
 *    non-empty;
 *  - placeholder parity: {{...}} tokens identical to en;
 *  - no REAL untranslated identicals: an it value byte-identical to en
 *    fails unless the key sits on the wave's explicit legit-identical
 *    allowlist (brand/house names incl. "Bow Down Visuals" / "Visual
 *    Bucs", platform names, URLs, numbers/formats only, Italian
 *    cognates and established loanwords — a7-locale.md §1.4 classes);
 *  - CLDR plurals whole: families carried by the wave exist in it with
 *    _one / _other / _many (it selects one+other+many).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Catalog = Record<string, unknown>;

function load(locale: string): Catalog {
  const raw = readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8");
  return JSON.parse(raw) as Catalog;
}

function flat(o: unknown, p = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const key = p ? `${p}.${k}` : k;
      if (v && typeof v === "object" && !Array.isArray(v)) flat(v, key, out);
      else out[key] = v;
    }
  }
  return out;
}

const EN = flat(load("en"));
const IT = flat(load("it"));

function placeholders(v: unknown): string[] {
  if (typeof v !== "string") return [];
  return [...v.matchAll(/\{\{[^}]+\}\}/g)].map((m) => m[0]).sort();
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function checkWave(namespaces: string[], legitIdentical: string[]) {
  const legit = new Set(legitIdentical);
  const keys = Object.keys(EN).filter((k) => namespaces.includes(k.split(".")[0]!));
  const missing: string[] = [];
  const empty: string[] = [];
  const badPlaceholders: string[] = [];
  const realIdentical: string[] = [];
  for (const k of keys) {
    const v = IT[k];
    if (v === undefined) {
      missing.push(k);
      continue;
    }
    if (typeof v === "string" && v.trim() === "") empty.push(k);
    if (JSON.stringify(placeholders(EN[k])) !== JSON.stringify(placeholders(v))) badPlaceholders.push(k);
    if (sameValue(v, EN[k]) && !legit.has(k)) realIdentical.push(k);
  }
  return { keys, missing, empty, badPlaceholders, realIdentical };
}

/* ------------------------------ it-W1 (item 75) ------------------------------ */
const W1_NAMESPACES = [
  "pricing", "referrals", "memberships", "merch", "royalties", "moneyTracker",
  "refundPolicy", "liveShopping", "llcGuide", "tips", "myShop", "jewelry",
  "storefrontBuilder", "brandingShop", "contracts", "jewelryShop", "tipPage",
  "credit-history", "shop", "storefronts", "syncPitch", "brandDeals",
];

/* Legit identicals (§1.4): brand/house + plan names, platforms, numbers /
   formats only, placeholder-only, Italian cognates & established loanwords
   (Email, Film, No, Dashboard, Software, Fitness, Gaming, Lifestyle, Tech,
   Marketplace, Merch, Design, Logo, Host, Branding, Management, Creator…). */
const W1_LEGIT = new Set([
  "brandDeals.tabs.marketplace",
  "referrals.contest.hours",
  "referrals.contest.secs",
  "referrals.contest.prizeFor",
  "referrals.sharekit.templates.threads",
  "referrals.sharekit.templates.chat",
  "memberships.titleStart",
  "memberships.aiCost",
  "merch.tabs.design",
  "merch.tabs.merch",
  "merch.products.t-shirt.label",
  "merch.products.poster.label",
  "merch.styles.streetwear.label",
  "merch.styles.minimal.label",
  "merch.styles.vintage.label",
  "merch.styles.luxury-gold.label",
  "merch.pricePlaceholder",
  "pricing.creditPacks.packs.10.credits",
  "pricing.creditPacks.packs.10.price",
  "pricing.creditPacks.packs.50.credits",
  "pricing.creditPacks.packs.50.price",
  "pricing.creditPacks.packs.150.credits",
  "pricing.creditPacks.packs.150.price",
  "pricing.creditPacks.packs.500.credits",
  "pricing.creditPacks.packs.500.price",
  "pricing.plans.crimeBoss.name",
  "pricing.plans.gangster.features.f2",
  "pricing.plans.gangster.name",
  "pricing.plans.hustler.features.f4",
  "pricing.plans.hustler.name",
  "pricing.plans.kingpin.name",
  "pricing.plans.shotCaller.name",
  "pricing.plans.streetPunk.name",
  "moneyTracker.title",
  "moneyTracker.cat_software",
  "moneyTracker.viewRoyalties",
  "brandDeals.audiences.k10_50k",
  "brandDeals.audiences.k1_10k",
  "brandDeals.audiences.k250plus",
  "brandDeals.audiences.k50_250k",
  "brandDeals.niches.fitness",
  "brandDeals.niches.gaming",
  "brandDeals.niches.lifestyle",
  "brandDeals.niches.tech",
  "brandDeals.resultsCount",
  "brandingShop.departments.merch",
  "brandingShop.emailPlaceholder",
  "contracts.type.management",
  "credit-history.dashboard",
  "jewelry.merchWord",
  "jewelry.nfcNo",
  "jewelry.stepDesign",
  "jewelry.stepLogo",
  "jewelryShop.emailPh",
  "liveShopping.badge",
  "liveShopping.crossLinkEnd",
  "liveShopping.liveBadge",
  "liveShopping.tabDashboard",
  "llcGuide.cheatCodeLabel",
  "llcGuide.creatorDesigner",
  "llcGuide.creatorPodcaster",
  "llcGuide.creatorStreamer",
  "llcGuide.creatorYouTuber",
  "llcGuide.statEin",
  "storefrontBuilder.handlePlaceholder",
  "storefrontBuilder.hostLabel",
  "storefrontBuilder.step3Cost",
  "storefrontBuilder.stepBranding",
  "tips.displayNamePlaceholder",
  "tips.goalAmountPlaceholder",
  "tips.handlePlaceholder",
  "tips.suggestedPlaceholder",
  "tips.tipMeta",
  "royalties.insights.cost",
  "refundPolicy.howTo.email",
  "referrals.hero.p4",
  "referrals.tracker.creator",
  "referrals.tracker.earned",
  "myShop.shopNamePlaceholder",
  "myShop.handlePlaceholder",
  "myShop.pricePlaceholder",
  "myShop.premium200",
  "myShop.domainPlaceholder",
  "syncPitch.typeTv",
  "syncPitch.typeFilm",
  "syncPitch.copyEmailLabel",
  "syncPitch.statBpm",
  "syncPitch.no",
  "syncPitch.publicBadge",
  "syncPitch.publicTitle",
  "syncPitch.madeWith",
]);

describe("it-W1 (Stack-28 #75) — commerce namespaces fully Italian", () => {
  const r = checkWave(W1_NAMESPACES, [...W1_LEGIT]);
  it("covers every en key in the wave namespaces", () => {
    expect(r.missing).toEqual([]);
    expect(r.empty).toEqual([]);
  });
  it("preserves {{placeholders}} exactly", () => {
    expect(r.badPlaceholders).toEqual([]);
  });
  it("leaves no REAL untranslated identicals", () => {
    expect(r.realIdentical).toEqual([]);
  });
  it("carries pricing.wantedMeter plurals whole (_one/_other/_many)", () => {
    for (const base of ["pricing.wantedMeter.hoverLabel", "pricing.wantedMeter.starOption"]) {
      for (const suffix of ["_one", "_other", "_many"]) {
        expect(typeof IT[`${base}${suffix}`], `${base}${suffix}`).toBe("string");
      }
    }
  });
});
