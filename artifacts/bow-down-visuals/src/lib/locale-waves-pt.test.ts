/**
 * locale-waves-pt.test.ts — Portuguese (pt) Stack-28 locale waves W1–W3
 * (board items 78 / 87 / 96; audit a7-locale.md §5.9).
 *
 * Each wave closes a set of whole namespaces: every en key of a wave
 * namespace must be present and non-empty in pt, and no pt value in a
 * closed namespace may be byte-identical to en unless the key sits on
 * the wave's explicit legit-identical allowlist below (brand names —
 * "Bow Down Visuals" / "Visual Bucs" / house product names — platform
 * names, URLs, numbers/formats only, ALL-CAPS codes, and true
 * Portuguese cognates/loanwords spelled identically, per §1.4 — pt had
 * the fewest real identicals of any locale thanks to true cognates, so
 * the allowlists are deliberately generous to correct Portuguese that
 * merely resembles English). Plural families are closed whole: pt
 * carries the _many form alongside _one/_other wherever en carries a
 * family (§4).
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
const PT = flat(load("pt"));
const nonEmpty = (v: unknown): boolean =>
  Array.isArray(v)
    ? v.length > 0 && v.every((x) => (typeof x === "string" ? x.trim() !== "" : x != null))
    : typeof v === "string" && v.trim() !== "";

function waveSuite(wave: string, namespaces: readonly string[], legit: ReadonlySet<string>) {
  const keys = Object.keys(EN).filter((k) => namespaces.some((ns) => k === ns || k.startsWith(`${ns}.`)));
  it("every en key of the wave namespaces is present and non-empty in pt", () => {
    const bad = keys.filter((k) => !(k in PT) || !nonEmpty(PT[k]));
    expect(bad, `pt ${wave} missing/empty: ${bad.slice(0, 10).join(", ")}`).toEqual([]);
  });
  it("no pt value is identical to en outside the legit allowlist", () => {
    const bad = keys.filter((k) => k in PT && JSON.stringify(PT[k]) === JSON.stringify(EN[k]) && !legit.has(k));
    expect(bad, `pt ${wave} untranslated residue: ${bad.slice(0, 10).join(", ")}`).toEqual([]);
  });
  it("the legit allowlist names only keys still identical to en (no stale entries)", () => {
    for (const k of legit) {
      expect(EN[k], `allowlist entry ${k} missing from en`).toBeDefined();
      expect(JSON.stringify(PT[k]), `allowlist entry ${k} no longer identical — drop it`).toBe(JSON.stringify(EN[k]));
    }
  });
}

const W1_NAMESPACES = ["pricing", "referrals", "memberships", "merch", "royalties", "moneyTracker", "refundPolicy", "llcGuide", "tips", "myShop", "jewelry", "storefrontBuilder", "liveShopping", "brandingShop", "jewelryShop", "contracts", "tipPage", "credit-history", "shop", "storefronts", "syncPitch", "labelPitch", "distribute", "brandDeals", "playlistPitch", "brandCalculator"] as const;
const W1_LEGIT: ReadonlySet<string> = new Set([
  "brandCalculator.niches.fitness",
  "brandCalculator.niches.tech",
  "brandDeals.niches.fitness",
  "brandDeals.niches.tech",
  "brandDeals.resultsCount",
  "brandingShop.departments.merch",
  "brandingShop.totalLabel",
  "credit-history.status",
  "distribute.100_visual_bucs",
  "distribute.bow_down_records",
  "distribute.hip_hop_trap",
  "distribute.isrc",
  "distribute.isrc_2",
  "distribute.midnight_frequencies",
  "distribute.shark_king",
  "distribute.tier.ep.label",
  "distribute.tier.single.label",
  "distribute.timing",
  "distribute.us_xxx_26_00001",
  "distribute.visual_bucs",
  "jewelry.merchWord",
  "jewelry.metal",
  "jewelry.stepDesign",
  "jewelry.stepLogo",
  "jewelryShop.total",
  "labelPitch.genres.afrobeats",
  "labelPitch.genres.country",
  "labelPitch.genres.edm",
  "labelPitch.genres.hip-hop",
  "labelPitch.genres.latin",
  "labelPitch.genres.pop",
  "labelPitch.genres.r&b",
  "labelPitch.genres.rock",
  "labelPitch.labelOneSheet",
  "liveShopping.badge",
  "liveShopping.crossLinkEnd",
  "liveShopping.streamsLabel",
  "liveShopping.thStream",
  "llcGuide.cheatCodeLabel",
  "llcGuide.creatorDesigner",
  "llcGuide.creatorPodcaster",
  "llcGuide.creatorStreamer",
  "llcGuide.creatorYouTuber",
  "llcGuide.statEin",
  "memberships.aiCost",
  "merch.pricePlaceholder",
  "merch.styles.streetwear.label",
  "merch.styles.vintage.label",
  "merch.tabs.merch",
  "moneyTracker.cat_software",
  "moneyTracker.viewRoyalties",
  "myShop.domainPlaceholder",
  "myShop.handlePlaceholder",
  "myShop.premium200",
  "myShop.pricePlaceholder",
  "myShop.shopNamePlaceholder",
  "playlistPitch.copyDmLabel",
  "playlistPitch.heroBadge",
  "playlistPitch.copyFollowUpLabel",
  "playlistPitch.packetLinks",
  "playlistPitch.pitchesCount",
  "playlistPitch.tabPlaylists",
  "pricing.creditPacks.packs.10.price",
  "pricing.creditPacks.packs.150.price",
  "pricing.creditPacks.packs.50.price",
  "pricing.creditPacks.packs.500.price",
  "pricing.plans.gangster.features.f2",
  "referrals.contest.days",
  "referrals.contest.hours",
  "referrals.contest.mins",
  "referrals.contest.prizeFor",
  "referrals.contest.secs",
  "referrals.hero.p4",
  "referrals.sharekit.templates.chat",
  "referrals.sharekit.templates.threads",
  "referrals.tracker.earned",
  "royalties.insights.cost",
  "royalties.payouts.statusLabel",
  "royalties.streams",
  "shop.totalLabel",
  "storefrontBuilder.handlePlaceholder",
  "storefrontBuilder.hostLabel",
  "storefrontBuilder.step3Cost",
  "storefrontBuilder.stepBranding",
  "syncPitch.statBpm",
  "syncPitch.statInstrumental",
  "syncPitch.statStems",
  "syncPitch.subTabOneSheet",
  "syncPitch.tagInstrumental",
  "syncPitch.tagStems",
  "syncPitch.typeGame",
  "syncPitch.typeTv",
  "tips.displayNamePlaceholder",
  "tips.goalAmountPlaceholder",
  "tips.handlePlaceholder",
  "tips.suggestedPlaceholder",
  "tips.tipMeta"
]);

describe("pt W1 (Stack-28 #78) — namespaces closed whole", () => {
  waveSuite("W1", W1_NAMESPACES, W1_LEGIT);
  it("pt carries the _many plural forms for the pricing families (§4)", () => {
    for (const k of ["pricing.wantedMeter.hoverLabel_many", "pricing.wantedMeter.starOption_many"]) {
      expect(PT[k], `${k} missing`).toBeDefined();
      expect(nonEmpty(PT[k])).toBe(true);
    }
  });
});

const W2_NAMESPACES = ["sponsorDealDetail", "sponsors", "sponsorsPost", "retentionDoctor", "retentionDelight", "invite", "fomoFeed", "home", "planPublic", "academy", "delight", "common", "waitlist", "betaAccess", "features", "auth", "promo-clip", "splitScreen", "productPhotoStudio", "carouselMaker", "videoTemplates", "movies", "motionGraphics"] as const;
const W2_LEGIT: ReadonlySet<string> = new Set([
  "academy.catBranding",
  "academy.coachRole",
  "academy.heroTitleAccent",
  "academy.heroTitleStart",
  "academy.hoursPlaceholder",
  "academy.lessonMinutes",
  "auth.passwordPlaceholder",
  "betaAccess.badgeBeta",
  "betaAccess.creatorRapper",
  "betaAccess.wantThumbnails",
  "carouselMaker.brandColorsPlaceholder",
  "carouselMaker.fontDisplay",
  "carouselMaker.fontSans",
  "carouselMaker.fontSerif",
  "common.beta",
  "common.premium",
  "common.visualBucs",
  "home.demo.hiphop.label",
  "home.demo.pop.label",
  "home.demo.rnb.label",
  "home.extTitleA",
  "home.faqKicker",
  "home.formats.podcasts.title",
  "home.formats.streamers.title",
  "home.manifestoTitleA",
  "home.manifestoTitleB",
  "home.vaultBodyB",
  "movies.logline",
  "movies.streamUrlPlaceholder",
  "productPhotoStudio.credits",
  "productPhotoStudio.lifestyle",
  "productPhotoStudio.packshot",
  "productPhotoStudio.pastePlaceholder",
  "productPhotoStudio.ratioStory",
  "promo-clip.creditBadge",
  "promo-clip.genres.afrobeats",
  "promo-clip.genres.country",
  "promo-clip.genres.dancehall",
  "promo-clip.genres.drill",
  "promo-clip.genres.gospel",
  "promo-clip.genres.hipHop",
  "promo-clip.genres.pop",
  "promo-clip.genres.rnb",
  "promo-clip.genres.rock",
  "promo-clip.genres.trap",
  "promo-clip.platforms.reels",
  "promo-clip.platforms.shorts",
  "promo-clip.platforms.tiktok",
  "promo-clip.tags.ctas",
  "promo-clip.tags.hashtags",
  "retentionDelight.prefs_sharkDrops",
  "retentionDoctor.atPlaceholder",
  "retentionDoctor.eyebrow",
  "retentionDoctor.platform_instagram",
  "retentionDoctor.platform_tiktok",
  "retentionDoctor.platform_x",
  "retentionDoctor.platform_youtube",
  "retentionDoctor.type_promo",
  "retentionDoctor.type_tutorial",
  "retentionDoctor.type_vlog",
  "splitScreen.modeSimple",
  "splitScreen.pickLayout",
  "sponsorDealDetail.escrowStatusLabel",
  "sponsorDealDetail.followersPlaceholder",
  "sponsors.matchFollowersPlaceholder",
  "sponsors.matchPlatformsPlaceholder",
  "sponsorsPost.budgetMaxPlaceholder",
  "sponsorsPost.budgetMinPlaceholder",
  "waitlist.artistTypeRapper",
  "waitlist.badgeBeta",
  "waitlist.wantThumbnails"
]);

describe("pt W2 (Stack-28 #87) — namespaces closed whole", () => {
  waveSuite("W2", W2_NAMESPACES, W2_LEGIT);
  it("pt carries the _many plural forms for the promo-clip families (§4)", () => {
    for (const k of ["promo-clip.clips.count_many", "promo-clip.summary.clipsSelected_many"]) {
      expect(PT[k], `${k} missing`).toBeDefined();
      expect(nonEmpty(PT[k])).toBe(true);
    }
  });
});
