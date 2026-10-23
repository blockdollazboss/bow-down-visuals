/**
 * locale-waves-de.test.ts — Stack-28 German (de) locale waves W1–W3
 * (board items 71, 80, 89; namespaces per a7-locale audit §5.2).
 *
 * Pins the translated state wave by wave: every en key in a completed
 * wave's namespaces must exist non-empty in de.json, and no wave key may
 * be byte-identical to en unless it sits on that wave's explicit
 * legit-identical allowlist below (§1.4 classes: brand/house names —
 * incl. "Bow Down Visuals", "Visual Bucs" and the plan rank names —
 * platform names, URLs/e-mails/example identifiers, numbers/formats,
 * and German cognates/loanwords such as "Video", "Audio", "Design").
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
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) flat(v, p ? `${p}.${k}` : k, out);
  } else out[p] = o;
  return out;
}
const EN = flat(load("en"));
const DE = flat(load("de"));

function checkWave(namespaces: string[], allowlist: Set<string>) {
  const keys = Object.keys(EN).filter((k) => namespaces.includes(k.split(".")[0]));
  const missing: string[] = [];
  const identical: string[] = [];
  for (const k of keys) {
    const v = DE[k];
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) missing.push(k);
    else if (JSON.stringify(v) === JSON.stringify(EN[k]) && !allowlist.has(k)) identical.push(k);
  }
  expect(missing, `missing/empty de keys: ${missing.slice(0, 20).join(", ")}`).toEqual([]);
  expect(identical, `untranslated (identical to en, not allowlisted): ${identical.slice(0, 20).join(", ")}`).toEqual([]);
}

const W1_NAMESPACES = ["pricing", "referrals", "merch", "memberships", "royalties", "moneyTracker", "refundPolicy", "brandingShop", "liveShopping", "myShop", "llcGuide", "storefrontBuilder", "tips", "jewelry", "contracts", "credit-history", "storefronts", "jewelryShop", "tipPage", "shop", "syncPitch", "brandDeals"];
const W1_LEGIT_IDENTICAL = new Set([
  "brandDeals.audiences.k10_50k",
  "brandDeals.audiences.k1_10k",
  "brandDeals.audiences.k250plus",
  "brandDeals.audiences.k50_250k",
  "brandDeals.dealTypes.affiliate.label",
  "brandDeals.niches.beauty",
  "brandDeals.niches.fitness",
  "brandDeals.niches.gaming",
  "brandDeals.niches.lifestyle",
  "brandDeals.niches.tech",
  "brandDeals.resultsCount",
  "brandDeals.tabs.finder",
  "brandDeals.titleAccent",
  "brandingShop.colors.gold",
  "brandingShop.departments.merch",
  "brandingShop.departments.smart",
  "brandingShop.smartCardsBadge",
  "brandingShop.tabs.shop",
  "brandingShop.trackingLabel",
  "contracts.optional",
  "contracts.type.management",
  "credit-history.dashboard",
  "credit-history.status",
  "jewelry.format",
  "jewelry.optional",
  "jewelry.stepDesign",
  "jewelry.stepLogo",
  "jewelryShop.designNotesNote",
  "liveShopping.badge",
  "liveShopping.crossLinkEnd",
  "liveShopping.crossLinkText",
  "liveShopping.heroTitleLive",
  "liveShopping.liveBadge",
  "liveShopping.streamsLabel",
  "liveShopping.tabDashboard",
  "liveShopping.thStream",
  "llcGuide.businessNameOptional",
  "llcGuide.cheatCodeLabel",
  "llcGuide.creatorDesigner",
  "llcGuide.creatorPodcaster",
  "llcGuide.creatorStreamer",
  "llcGuide.creatorYouTuber",
  "llcGuide.statEin",
  "memberships.aiCost",
  "memberships.badge",
  "memberships.perMonth",
  "memberships.titleStart",
  "merch.download",
  "merch.pricePlaceholder",
  "merch.products.cap.label",
  "merch.products.hoodie.label",
  "merch.products.poster.label",
  "merch.products.t-shirt.label",
  "merch.styleLabel",
  "merch.styles.luxury-gold.label",
  "merch.styles.minimal.label",
  "merch.styles.streetwear.label",
  "merch.styles.vintage.label",
  "merch.tabs.design",
  "merch.tabs.merch",
  "merch.title",
  "moneyTracker.cat_affiliate",
  "moneyTracker.cat_software",
  "moneyTracker.title",
  "moneyTracker.viewRoyalties",
  "myShop.domainPlaceholder",
  "myShop.handlePlaceholder",
  "myShop.premium200",
  "myShop.pricePlaceholder",
  "myShop.productNamePlaceholder",
  "myShop.shopNamePlaceholder",
  "myShop.taglineLabel",
  "pricing.creditPacks.packs.10.credits",
  "pricing.creditPacks.packs.10.price",
  "pricing.creditPacks.packs.150.credits",
  "pricing.creditPacks.packs.150.price",
  "pricing.creditPacks.packs.50.credits",
  "pricing.creditPacks.packs.50.price",
  "pricing.creditPacks.packs.500.credits",
  "pricing.creditPacks.packs.500.price",
  "pricing.planCard.perMonth",
  "pricing.plans.crimeBoss.name",
  "pricing.plans.gangster.name",
  "pricing.plans.hustler.features.f5",
  "pricing.plans.hustler.name",
  "pricing.plans.kingpin.name",
  "pricing.plans.shotCaller.name",
  "pricing.plans.streetPunk.features.f5",
  "pricing.plans.streetPunk.name",
  "referrals.contest.prizeFor",
  "referrals.hero.p4",
  "referrals.ladder.bonus",
  "referrals.ladder.you",
  "referrals.rank.nextReward",
  "referrals.sharekit.templates.chat",
  "referrals.sharekit.templates.threads",
  "referrals.titlePrefix",
  "referrals.titleSuffix",
  "referrals.tracker.creator",
  "referrals.tracker.earned",
  "refundPolicy.howTo.email",
  "royalties.eyebrow",
  "royalties.insights.cost",
  "royalties.payouts.distributor",
  "royalties.payouts.statusLabel",
  "shop.poweredBy",
  "storefrontBuilder.colorGoldNoir",
  "storefrontBuilder.handlePlaceholder",
  "storefrontBuilder.hostLabel",
  "storefrontBuilder.step3Cost",
  "storefrontBuilder.stepBranding",
  "storefronts.heroTitleAccent",
  "syncPitch.copyEmailLabel",
  "syncPitch.madeWith",
  "syncPitch.matchScore",
  "syncPitch.notesPlaceholder",
  "syncPitch.publicBadge",
  "syncPitch.publicTitle",
  "syncPitch.statBpm",
  "syncPitch.statInstrumental",
  "syncPitch.statStems",
  "syncPitch.subTabOneSheet",
  "syncPitch.tabSync",
  "syncPitch.tagInstrumental",
  "syncPitch.tagStems",
  "syncPitch.typeFilm",
  "syncPitch.typeTv",
  "tips.displayNamePlaceholder",
  "tips.goalAmountPlaceholder",
  "tips.handlePlaceholder",
  "tips.suggestedPlaceholder",
  "tips.tipMeta"
]);
describe("de locale wave W1 (Stack-28)", () => {
  it("every en key exists non-empty in de and no untranslated residue remains", () => checkWave(W1_NAMESPACES, W1_LEGIT_IDENTICAL));
});
