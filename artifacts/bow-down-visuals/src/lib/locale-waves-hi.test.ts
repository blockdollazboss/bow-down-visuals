/**
 * locale-waves-hi.test.ts — Stack-28 Hindi locale waves hi-W1..hi-W4
 * (board items 74, 83, 92, 100) + U+FFFD repairs.
 *
 * Source audit: .lane/audit/a7-locale.md §5.5 (wave namespace lists),
 * §1.4 (LEGIT vs REAL identical classification), §3 (18 U+FFFD-corrupted
 * hi keys), §4 (CLDR plural families: hi selects one/other).
 *
 * For every COMPLETED wave this suite pins, over that wave's exact
 * namespace list:
 *  - completeness: every en leaf is present and non-empty in hi
 *    (arrays are single leaves, matching the guard's flattening);
 *  - no REAL identicals left: a hi value identical to en is allowed
 *    only for the explicit LEGIT allowlist below (brand names incl.
 *    "Bow Down Visuals" / "Visual Bucs", platform names, codes,
 *    number/format-only values, proper-noun examples — §1.4);
 *  - placeholder parity: {{...}} multisets match en exactly;
 *  - plural completeness: every en plural family (base carrying both
 *    _one and _other) in the wave carries hi _one and _other;
 *  - U+FFFD: no replacement characters in any completed-wave
 *    namespace, and the whole-file set of corrupted keys is exactly
 *    the shrinking remainder pinned below (empty once hi-W4 lands —
 *    the final state is zero U+FFFD in hi.json).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Catalog = Record<string, unknown>;

function load(locale: string): Catalog {
  const raw = readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8");
  return JSON.parse(raw) as Catalog;
}

function loadRaw(locale: string): string {
  return readFileSync(new URL(`../locales/${locale}.json`, import.meta.url), "utf8");
}

type Leaf = string | unknown[];
function flat(o: unknown, p = "", out: Record<string, Leaf> = {}): Record<string, Leaf> {
  if (Array.isArray(o)) {
    out[p] = o;
  } else if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      flat(v, p ? `${p}.${k}` : k, out);
    }
  } else if (typeof o === "string") {
    out[p] = o;
  }
  return out;
}

const en = flat(load("en"));
const hi = flat(load("hi"));

const WAVES: Record<string, string[]> = {
  W1: ["pricing", "referrals", "memberships", "merch", "royalties", "moneyTracker", "refundPolicy", "tips", "myShop", "storefrontBuilder", "brandingShop", "llcGuide", "liveShopping", "jewelryShop", "contracts", "tipPage", "storefronts", "jewelry", "syncPitch", "labelPitch", "brandDeals", "distribute", "sponsorsPost", "sponsors", "sponsorDealDetail"],
  W2: ["brandCalculator", "playlistPitch", "retentionDoctor", "retentionDelight", "invite", "fomoFeed", "planPublic", "delight", "academy", "home", "common", "features", "waitlist", "auth", "promo-clip", "splitScreen", "productPhotoStudio", "carouselMaker", "videoTemplates", "movies", "motionGraphics"]
};

const LEGIT_IDENTICAL: Record<string, string[]> = {
  W1: ["brandDeals.audiences.k10_50k", "brandDeals.audiences.k1_10k", "brandDeals.audiences.k250plus", "brandDeals.audiences.k50_250k", "brandDeals.resultsCount", "brandingShop.brandNamePlaceholder", "brandingShop.nichePlaceholder", "brandingShop.zipPlaceholder", "distribute.100_visual_bucs", "distribute.bow_down_records", "distribute.isrc", "distribute.isrc_2", "distribute.midnight_frequencies", "distribute.shark_king", "distribute.tier.ep.label", "distribute.us_xxx_26_00001", "distribute.visual_bucs", "labelPitch.genrePlaceholder", "labelPitch.labelNamePlaceholder", "labelPitch.moodPlaceholder", "labelPitch.songTitlePlaceholder", "labelPitch.tempoPlaceholder", "liveShopping.liveBadge", "llcGuide.cheatCodeLabel", "llcGuide.creatorYouTuber", "llcGuide.statEin", "memberships.aiCost", "memberships.aiSuggesterTitle", "memberships.badge", "memberships.perMonth", "memberships.tierOption", "memberships.titleAccent", "memberships.titleStart", "merch.pricePlaceholder", "merch.products.cap.blurb", "moneyTracker.cat_sponsor_deals", "moneyTracker.cat_streaming_royalties", "myShop.domainPlaceholder", "myShop.handlePlaceholder", "myShop.pricePlaceholder", "myShop.productNamePlaceholder", "myShop.shopNamePlaceholder", "pricing.creditPacks.packs.10.credits", "pricing.creditPacks.packs.10.price", "pricing.creditPacks.packs.150.credits", "pricing.creditPacks.packs.150.price", "pricing.creditPacks.packs.50.credits", "pricing.creditPacks.packs.50.price", "pricing.creditPacks.packs.500.credits", "pricing.creditPacks.packs.500.price", "pricing.hero.titleLine2", "pricing.jsonLd.offerCatalogName", "pricing.plans.crimeBoss.name", "pricing.plans.gangster.features.f2", "pricing.plans.gangster.features.f3", "pricing.plans.gangster.name", "pricing.plans.hustler.features.f4", "pricing.plans.hustler.features.f5", "pricing.plans.hustler.name", "pricing.plans.kingpin.name", "pricing.plans.shotCaller.name", "pricing.plans.streetPunk.features.f1", "pricing.plans.streetPunk.features.f4", "pricing.plans.streetPunk.name", "referrals.contest.days", "referrals.contest.hours", "referrals.contest.mins", "referrals.contest.prizeFor", "referrals.contest.secs", "referrals.hero.p4", "referrals.ladder.title", "referrals.ladder.you", "referrals.leaderboard.title", "referrals.sharekit.templates.chat", "referrals.sharekit.templates.threads", "referrals.sharekit.templates.tiktok", "referrals.sharekit.title", "referrals.titleSuffix", "referrals.tracker.creator", "referrals.tracker.earned", "royalties.insights.cost", "royalties.payouts.distributor", "royalties.streams", "sponsorDealDetail.followersPlaceholder", "sponsors.matchFollowersPlaceholder", "sponsors.matchPlatformsPlaceholder", "sponsorsPost.brandNamePlaceholder", "sponsorsPost.budgetMaxPlaceholder", "sponsorsPost.budgetMinPlaceholder", "sponsorsPost.deliverablesPlaceholder", "sponsorsPost.nichePlaceholder", "storefrontBuilder.domainPlaceholder", "storefrontBuilder.handlePlaceholder", "storefrontBuilder.shopPreviewHandle", "storefrontBuilder.step3Cost", "syncPitch.amountPlaceholder", "syncPitch.artistNamePlaceholder", "syncPitch.bpmPlaceholder", "syncPitch.briefMoodPlaceholder", "syncPitch.briefTitlePlaceholder", "syncPitch.budgetPlaceholder", "syncPitch.contactEmailPlaceholder", "syncPitch.contactNamePlaceholder", "syncPitch.genrePlaceholder", "syncPitch.keyPlaceholder", "syncPitch.notesPlaceholder", "syncPitch.songTitlePlaceholder", "syncPitch.statBpm", "syncPitch.targetPlaceholder", "syncPitch.typeTv", "tips.displayNamePlaceholder", "tips.goalAmountPlaceholder", "tips.handlePlaceholder", "tips.suggestedPlaceholder", "tips.tipMeta"],
  W2: ["academy.heroTitleStart", "academy.hoursPlaceholder", "auth.passwordPlaceholder", "carouselMaker.brandColorsPlaceholder", "carouselMaker.kicker", "common.visualBucs", "home.demo.rnb.label", "home.extTitleA", "movies.streamUrlLabel", "movies.virality", "playlistPitch.copyDmLabel", "productPhotoStudio.credits", "productPhotoStudio.pastePlaceholder", "promo-clip.creditBadge", "promo-clip.genres.afrobeats", "promo-clip.genres.country", "promo-clip.genres.dancehall", "promo-clip.genres.drill", "promo-clip.genres.gospel", "promo-clip.genres.hipHop", "promo-clip.genres.pop", "promo-clip.genres.rnb", "promo-clip.genres.rock", "promo-clip.genres.trap", "promo-clip.platforms.reels", "promo-clip.platforms.shorts", "promo-clip.platforms.tiktok", "promo-clip.tags.ctas", "retentionDelight.prefs_sharkDrops", "retentionDoctor.atPlaceholder", "retentionDoctor.platform_instagram", "retentionDoctor.platform_tiktok", "retentionDoctor.platform_x", "retentionDoctor.platform_youtube", "retentionDoctor.type_short", "splitScreen.modeSimple"]
};

/** hi keys still carrying U+FFFD, pinned exactly; shrinks per wave, [] at hi-W4. */
const FFFD_REMAINING: string[] = ["artistVault.clothingPlaceholder", "artistVault.detailLevelHint", "artistVault.doNotChangePlaceholder", "artistVault.freeBadge", "artistVault.hairPlaceholder", "artistVault.outfitNamePlaceholder", "artistVault.personalityPlaceholder", "artistVault.removeOutfitAria", "artistVault.songTipRest", "locations.save", "upscale.tabListLabel", "watermarkRemoval.progressNote"];

function inWave(key: string, wave: string): boolean {
  return WAVES[wave].some((ns) => key === ns || key.startsWith(`${ns}.`));
}

function placeholders(v: string): string[] {
  return [...v.matchAll(/{{[^}]*}}/g)].map((m) => m[0]).sort();
}

describe("Stack-28 Hindi locale waves", () => {
  for (const wave of Object.keys(WAVES)) {
    describe(wave, () => {
      it("is complete: every en leaf present and non-empty in hi", () => {
        const missing: string[] = [];
        for (const [k, v] of Object.entries(en)) {
          if (!inWave(k, wave)) continue;
          const hv = hi[k];
          if (hv === undefined) missing.push(k);
          else if (typeof v === "string" && typeof hv === "string" && hv.trim() === "") missing.push(`${k} (empty)`);
          else if (Array.isArray(v) && (!Array.isArray(hv) || hv.length !== v.length)) missing.push(`${k} (array shape)`);
        }
        expect(missing).toEqual([]);
      });

      it("has no REAL identicals left (identical ⇒ allowlisted LEGIT)", () => {
        const allow = new Set(LEGIT_IDENTICAL[wave]);
        const bad: string[] = [];
        for (const [k, v] of Object.entries(en)) {
          if (!inWave(k, wave) || typeof v !== "string") continue;
          if (hi[k] === v && !allow.has(k)) bad.push(k);
        }
        expect(bad).toEqual([]);
      });

      it("allowlist has no stale entries (each is still identical to en)", () => {
        for (const k of LEGIT_IDENTICAL[wave]) {
          expect(hi[k], k).toBe(en[k]);
        }
      });

      it("keeps {{placeholder}} parity with en", () => {
        const bad: string[] = [];
        for (const [k, v] of Object.entries(en)) {
          if (!inWave(k, wave) || typeof v !== "string") continue;
          const hv = hi[k];
          if (typeof hv === "string" && JSON.stringify(placeholders(hv)) !== JSON.stringify(placeholders(v))) bad.push(k);
        }
        expect(bad).toEqual([]);
      });

      it("carries whole CLDR plural families (hi: one/other)", () => {
        const bad: string[] = [];
        for (const k of Object.keys(en)) {
          if (!inWave(k, wave) || !k.endsWith("_one")) continue;
          const base = k.slice(0, -"_one".length);
          if (`${base}_other` in en) {
            if (!(`${base}_one` in hi) || !(`${base}_other` in hi)) bad.push(base);
          }
        }
        expect(bad).toEqual([]);
      });

      it("has no U+FFFD in this wave's namespaces", () => {
        const bad: string[] = [];
        for (const [k, v] of Object.entries(hi)) {
          if (!inWave(k, wave) || typeof v !== "string") continue;
          if (v.includes("\uFFFD")) bad.push(k);
        }
        expect(bad).toEqual([]);
      });
    });
  }

  it("whole-file U+FFFD keys are exactly the pinned remainder", () => {
    const got = Object.entries(hi)
      .filter(([, v]) => typeof v === "string" && v.includes("\uFFFD"))
      .map(([k]) => k)
      .sort();
    expect(got).toEqual([...FFFD_REMAINING].sort());
    expect(loadRaw("hi").split("\uFFFD").length - 1).toBe(
      got.reduce((n, k) => n + (typeof hi[k] === "string" ? (hi[k] as string).split("\uFFFD").length - 1 : 0), 0),
    );
  });
});
