/**
 * locale-waves-ja.test.ts — Stack-28 locale lane, Japanese waves ja-W1..W4
 * (board items 76, 85, 94, 98; wave definitions: a7-locale.md §5.7).
 *
 * Pins, per completed wave: every en key in the wave's namespaces is
 * present in ja (except the explicit CLDR/legit missing allowlist —
 * Japanese selects only the `_other` plural category, so `_one` forms
 * are correctly absent), and no key in those namespaces is still
 * identical to en except the explicit legit-identical allowlist
 * (brand/house names, platform names, URLs, placeholder-only values,
 * numbers, proper-noun placeholder examples — a7-locale.md §1.4).
 * Also pins placeholder parity and zero U+FFFD on wave keys.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function load(locale: string): Record<string, unknown> {
  const raw = readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}
function flat(o: unknown, p = "", out: Record<string, unknown> = {}): Record<string, unknown> {
  if (Array.isArray(o)) { out[p] = o; return out; }
  if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) flat(v, p ? `${p}.${k}` : k, out);
    return out;
  }
  out[p] = o; return out;
}
const EN = flat(load("en"));
const JA = flat(load("ja"));

const WAVES: Record<string, { namespaces: string[]; legitIdentical: string[]; legitMissing: string[] }> = {
  W1: {
    namespaces: ["pricing", "referrals", "memberships", "merch", "royalties", "moneyTracker", "refundPolicy", "tips", "myShop", "storefrontBuilder", "contracts", "tipPage", "storefronts", "jewelry", "jewelryShop", "brandingShop", "liveShopping", "llcGuide", "syncPitch", "brandDeals", "distribute", "sponsors", "sponsorsPost", "sponsorDealDetail", "labelPitch", "brandCalculator", "playlistPitch"],
    legitIdentical: ["brandDeals.resultsCount", "distribute.100_visual_bucs", "distribute.bow_down_records", "distribute.isrc", "distribute.midnight_frequencies", "distribute.shark_king", "distribute.tier.ep.label", "distribute.us_xxx_26_00001", "distribute.visual_bucs", "liveShopping.liveBadge", "llcGuide.creatorYouTuber", "memberships.aiCost", "merch.pricePlaceholder", "myShop.domainPlaceholder", "myShop.handlePlaceholder", "myShop.pricePlaceholder", "myShop.productNamePlaceholder", "myShop.shopNamePlaceholder", "playlistPitch.copyDmLabel", "pricing.creditPacks.packs.10.credits", "pricing.creditPacks.packs.10.price", "pricing.creditPacks.packs.150.credits", "pricing.creditPacks.packs.150.price", "pricing.creditPacks.packs.50.credits", "pricing.creditPacks.packs.50.price", "pricing.creditPacks.packs.500.credits", "pricing.creditPacks.packs.500.price", "pricing.plans.crimeBoss.name", "pricing.plans.gangster.name", "pricing.plans.hustler.features.f5", "pricing.plans.hustler.name", "pricing.plans.kingpin.name", "pricing.plans.shotCaller.name", "pricing.plans.streetPunk.features.f1", "pricing.plans.streetPunk.name", "referrals.contest.prizeFor", "referrals.hero.p4", "referrals.sharekit.templates.chat", "referrals.sharekit.templates.threads", "referrals.tracker.earned", "royalties.insights.cost", "sponsorDealDetail.followersPlaceholder", "sponsors.matchFollowersPlaceholder", "sponsors.matchPlatformsPlaceholder", "sponsorsPost.budgetMaxPlaceholder", "sponsorsPost.budgetMinPlaceholder", "storefrontBuilder.domainPlaceholder", "storefrontBuilder.handlePlaceholder", "storefrontBuilder.shopPreviewHandle", "storefrontBuilder.step3Cost", "syncPitch.statBpm", "syncPitch.typeTv", "tips.displayNamePlaceholder", "tips.goalAmountPlaceholder", "tips.handlePlaceholder", "tips.suggestedPlaceholder", "tips.tipMeta"],
    legitMissing: ["pricing.wantedMeter.hoverLabel_one", "pricing.wantedMeter.starOption_one"],
  },
};

function placeholders(v: unknown): string[] {
  const s = Array.isArray(v) ? v.join("\n") : String(v ?? "");
  return [...s.matchAll(/\{\{[^}]+\}\}/g)].map((m) => m[0]).sort();
}

describe("ja locale waves (Stack-28)", () => {
  for (const [wave, def] of Object.entries(WAVES)) {
    const keys = Object.keys(EN).filter((k) => def.namespaces.includes(k.split(".")[0]));
    it(`${wave}: all en keys present in ja except legit/CLDR allowlist`, () => {
      const missing = keys.filter((k) => !(k in JA) && !def.legitMissing.includes(k));
      expect(missing).toEqual([]);
    });
    it(`${wave}: no REAL identical-to-en values remain`, () => {
      const identical = keys.filter((k) => k in JA && JSON.stringify(JA[k]) === JSON.stringify(EN[k]) && !def.legitIdentical.includes(k));
      expect(identical).toEqual([]);
    });
    it(`${wave}: placeholder parity and no U+FFFD on wave keys`, () => {
      const bad: string[] = [];
      for (const k of keys) {
        if (!(k in JA)) continue;
        if (JSON.stringify(placeholders(JA[k])) !== JSON.stringify(placeholders(EN[k]))) bad.push(`placeholder:${k}`);
        if (JSON.stringify(JA[k]).includes("\uFFFD")) bad.push(`fffd:${k}`);
      }
      expect(bad).toEqual([]);
    });
  }
});
