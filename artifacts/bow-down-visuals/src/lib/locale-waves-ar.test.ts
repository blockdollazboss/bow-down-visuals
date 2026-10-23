/**
 * locale-waves-ar.test.ts — Stack-28 Arabic locale waves (board items
 * 70/79/88/97 = ar-W1..W4, namespaces per a7-locale.md §5.1).
 *
 * Per completed wave this pins, for every en key in the wave's namespaces:
 *  - the key exists in ar.json, non-empty;
 *  - the {{placeholder}} shape matches en exactly;
 *  - the value is NOT byte-identical to en, unless the key sits on the
 *    wave's explicit legit-identical allowlist below (brand/house names,
 *    platform names, URLs/example identifiers, pure numbers/formats,
 *    codes — §1.4 classes, each verified by hand for ar).
 *
 * Waves are added here as they land; a wave block appears only when the
 * whole wave is translated.
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
const AR = flat(load("ar"));

function placeholders(v: unknown): string[] {
  const s = typeof v === "string" ? v : JSON.stringify(v) ?? "";
  return [...s.matchAll(/\{\{[^}]+\}\}/g)].map((m) => m[0]).sort();
}

function checkWave(namespaces: string[], allowlist: Set<string>) {
  const keys = Object.keys(EN).filter((k) => namespaces.includes(k.split(".")[0]!));
  expect(keys.length).toBeGreaterThan(0);
  for (const k of keys) {
    const arv = AR[k];
    expect(arv, `ar missing ${k}`).toBeDefined();
    const ars = typeof arv === "string" ? arv : JSON.stringify(arv);
    expect(ars && ars.length > 0, `ar empty ${k}`).toBeTruthy();
    expect(placeholders(arv), `placeholder shape ${k}`).toEqual(placeholders(EN[k]));
    if (!allowlist.has(k)) {
      const ens = typeof EN[k] === "string" ? (EN[k] as string) : JSON.stringify(EN[k]);
      expect(ars, `ar identical to en (untranslated): ${k}`).not.toBe(ens);
    }
  }
  // every allowlist entry must really be identical (no stale entries)
  for (const k of allowlist) {
    const ens = typeof EN[k] === "string" ? (EN[k] as string) : JSON.stringify(EN[k]);
    const ars = typeof AR[k] === "string" ? (AR[k] as string) : JSON.stringify(AR[k]);
    expect(ars, `allowlist entry no longer identical: ${k}`).toBe(ens);
  }
}

/* ar-W1 (item 70) — commerce. Legit identicals: pack credits/prices and
   plan rank names (house names, kept in English site-wide), brand phrases
   ("100 Visual Bucs", "Bow Down Records"), codes (ISRC, EP, DM, BPM, TV),
   audience ranges and numeric/example placeholders, platform-name pairs,
   and pure-format strings ("({{n}})", ".", "{{date}} · {{status}}"). */
const W1_NS = [
  "pricing", "referrals", "merch", "memberships", "royalties", "moneyTracker",
  "refundPolicy", "tips", "myShop", "storefrontBuilder", "jewelry",
  "liveShopping", "contracts", "llcGuide", "tipPage", "storefronts",
  "jewelryShop", "brandingShop", "syncPitch", "brandDeals", "distribute",
  "sponsors", "sponsorsPost", "sponsorDealDetail", "labelPitch",
  "brandCalculator", "playlistPitch",
];
const W1_ALLOW = new Set([
  "brandDeals.audiences.k10_50k",
  "brandDeals.audiences.k1_10k",
  "brandDeals.audiences.k250plus",
  "brandDeals.audiences.k50_250k",
  "brandDeals.resultsCount",
  "distribute.100_visual_bucs",
  "distribute.bow_down_records",
  "distribute.isrc",
  "distribute.isrc_2",
  "distribute.midnight_frequencies",
  "distribute.shark_king",
  "distribute.tier.ep.label",
  "distribute.us_xxx_26_00001",
  "distribute.visual_bucs",
  "jewelry.merchWord",
  "liveShopping.crossLinkEnd",
  "llcGuide.cheatCodeLabel",
  "llcGuide.creatorYouTuber",
  "memberships.aiCost",
  "memberships.perMonth",
  "merch.pricePlaceholder",
  "myShop.domainPlaceholder",
  "myShop.handlePlaceholder",
  "myShop.pricePlaceholder",
  "myShop.shopNamePlaceholder",
  "playlistPitch.copyDmLabel",
  "pricing.creditPacks.packs.10.credits",
  "pricing.creditPacks.packs.10.price",
  "pricing.creditPacks.packs.150.credits",
  "pricing.creditPacks.packs.150.price",
  "pricing.creditPacks.packs.50.credits",
  "pricing.creditPacks.packs.50.price",
  "pricing.creditPacks.packs.500.credits",
  "pricing.creditPacks.packs.500.price",
  "pricing.plans.crimeBoss.name",
  "pricing.plans.gangster.name",
  "pricing.plans.hustler.name",
  "pricing.plans.kingpin.name",
  "pricing.plans.shotCaller.name",
  "pricing.plans.streetPunk.name",
  "referrals.contest.prizeFor",
  "referrals.hero.p4",
  "referrals.sharekit.templates.chat",
  "referrals.sharekit.templates.threads",
  "referrals.titleSuffix",
  "referrals.tracker.earned",
  "royalties.insights.cost",
  "sponsorDealDetail.followersPlaceholder",
  "sponsors.matchFollowersPlaceholder",
  "sponsors.matchPlatformsPlaceholder",
  "sponsorsPost.budgetMaxPlaceholder",
  "sponsorsPost.budgetMinPlaceholder",
  "storefrontBuilder.domainPlaceholder",
  "storefrontBuilder.handlePlaceholder",
  "storefrontBuilder.step3Cost",
  "syncPitch.bpmPlaceholder",
  "syncPitch.statBpm",
  "syncPitch.typeTv",
  "tips.displayNamePlaceholder",
  "tips.goalAmountPlaceholder",
  "tips.handlePlaceholder",
  "tips.suggestedPlaceholder",
  "tips.tipMeta",
]);

describe("ar-W1 (Stack-28 #70) commerce namespaces fully translated", () => {
  it("every en key present, non-empty, placeholders intact, no untranslated residue", () => {
    checkWave(W1_NS, W1_ALLOW);
  });
});

/* ar-W2 (item 79) — retention/invite + video surfaces. Legit identicals:
   platform names (TikTok/Instagram/YouTube/X), the Turbo mode name (house
   rendering, cf. videoEditor.modeSimple), brand-only strings ("Visual
   Bucs", "100 Visual Bucs"), and pure formats (placeholder e-mail/dots,
   hex colours, "https://…", "0:12", ".", "{n} Visual Bucs"). */
const W2_NS = [
  "retentionDoctor", "retentionDelight", "invite", "fomoFeed", "planPublic",
  "delight", "academy", "common", "home", "auth", "features", "waitlist",
  "promo-clip", "splitScreen", "productPhotoStudio", "carouselMaker",
  "videoTemplates", "movies", "motionGraphics", "cartoonStudio",
];
const W2_ALLOW = new Set([
  "academy.hoursPlaceholder",
  "auth.emailPlaceholder",
  "auth.passwordPlaceholder",
  "carouselMaker.brandColorsPlaceholder",
  "common.visualBucs",
  "home.vaultBodyB",
  "productPhotoStudio.credits",
  "productPhotoStudio.pastePlaceholder",
  "promo-clip.creditBadge",
  "promo-clip.platforms.tiktok",
  "retentionDoctor.atPlaceholder",
  "retentionDoctor.platform_instagram",
  "retentionDoctor.platform_tiktok",
  "retentionDoctor.platform_x",
  "retentionDoctor.platform_youtube",
  "splitScreen.modeSimple",
]);

describe("ar-W2 (Stack-28 #79) retention/invite + video namespaces fully translated", () => {
  it("every en key present, non-empty, placeholders intact, no untranslated residue", () => {
    checkWave(W2_NS, W2_ALLOW);
  });
});
