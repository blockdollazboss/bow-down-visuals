import { z } from "zod";

/* ── Platform fee economics — SINGLE SOURCE OF TRUTH ─────────────────────
   Worker 12 (PLATFORM TIERS + FEE ECONOMICS) owns the money math for the
   creator streaming platform. Every sale surface — downloads, products,
   services, tickets — must compute its split through this module.

   EXISTING FEES FOUND IN CODEBASE (2026-10-07 audit):
     - storefronts.ts: STOREFRONT_PLATFORM_FEE_BPS = env || 1000 (10%)
       → adopted as the canonical base fee below. NOT invented; it matches
       the shops the site already sells through.
     - store.ts (digital sales): reuses STOREFRONT_PLATFORM_FEE_BPS (10%).
     - memberships.ts: 10% · shoutouts.ts: 10% · live-shopping.ts: 5%
       · sponsors.ts: 1500 bps (15%) · beats: 15% commission.
   Those surfaces keep their own constants for now; new creator-platform
   sale types use this module, and the others can migrate to it.

   ★ APPROVED BY USER 2026-10-07 (env-overridable):
     - Tier fee rates:  free 10% / pro 7% / elite 5%
     - Subscription prices: pro $12/mo, elite $29/mo
     - Star ceilings:  free 1–3★ / pro 4–5★ / elite 6★
     - AI boost quotas: free 3 / pro 25 / elite 100 per month
   Stripe stays in TEST mode until launch — no real card is billed until the user flips it live.

   ★ FEE RATES SUPERSEDED 2026-10-23 (owner ruling — "flat 5% everywhere"):
     the tier fee ladder above is RETIRED. Every storefront/shop rail now
     charges one flat 5% platform fee on every tier: the shops rail has
     charged flat 5% since the owner's 2026-10-18 ruling
     (STOREFRONT_PLATFORM_FEE_BPS, routes/generate/shops.ts; routes/store.ts
     reuses it), and PLATFORM_FEE_BPS below — the rate routes/storefront.ts
     actually charges — is aligned to the same 500. Displays, projections
     and charge paths tell the single 5% story. Subscription prices and AI
     boost quotas above are unaffected. Other products keep their own
     ratified fees (memberships 10%, beats 15%, sponsors 15%, live
     shopping 5%, Paid Series 5%) — they do not read this module.          */

export const CREATOR_TIERS = ["free", "pro", "elite"] as const;
export type CreatorTier = (typeof CREATOR_TIERS)[number];
export const creatorTierSchema = z.enum(CREATOR_TIERS);

const TIER_RANK: Record<CreatorTier, number> = { free: 0, pro: 1, elite: 2 };

function parseBps(raw: string | undefined, fallback: number): number {
  const v = Number(raw);
  if (Number.isFinite(v) && v >= 0 && v <= 10_000) return Math.round(v);
  return fallback;
}

/**
 * Canonical base platform fee, basis points (100 bps = 1%).
 * Flat 5% — the storefront/shop rate on every rail and every tier
 * (owner ruling 2026-10-23). routes/storefront.ts charges through this
 * constant. Env-overridable without a deploy.
 */
export const PLATFORM_FEE_BPS: number = parseBps(process.env["PLATFORM_FEE_BPS"], 500);

/** Per-tier fee rates. feeSplitForTier feeds creator-tiers display +
 * next-tier projections, and this map is the schedule those surfaces
 * publish. The 10% / 7% / 5% ladder approved 2026-10-07 was never
 * delivered by a sale rail and is retired: the owner ruled a flat 5%
 * platform fee on every tier (2026-10-23), matching what the shops rail
 * has charged since 2026-10-18 (STOREFRONT_PLATFORM_FEE_BPS in
 * routes/generate/shops.ts; routes/store.ts reuses it) and what
 * routes/storefront.ts charges through PLATFORM_FEE_BPS above. */
export const TIER_FEE_BPS: Record<CreatorTier, number> = {
  free: parseBps(process.env["PLATFORM_FEE_BPS_FREE"], 500), // flat 5% — the rail truth for every tier
  pro: parseBps(process.env["PLATFORM_FEE_BPS_PRO"], 500), // flat 5%
  elite: parseBps(process.env["PLATFORM_FEE_BPS_ELITE"], 500), // flat 5%
};

export interface FeeSplit {
  gross: number; // integer cents, what the buyer paid
  fee: number; // integer cents, platform's cut
  net: number; // integer cents, creator's cut
  feeBps: number; // fee rate used
}

/**
 * Canonical fee split. Rounds the fee to the nearest cent (half up),
 * net = gross − fee so gross always reconciles exactly.
 */
export function feeSplit(amountCents: number, feeBps: number = PLATFORM_FEE_BPS): FeeSplit {
  const gross = Math.max(0, Math.round(amountCents));
  const bps = Math.max(0, Math.min(10_000, Math.round(feeBps)));
  const fee = Math.round((gross * bps) / 10_000);
  return { gross, fee, net: gross - fee, feeBps: bps };
}

/** Fee split at a creator's tier rate. */
export function feeSplitForTier(amountCents: number, tier: CreatorTier): FeeSplit {
  return feeSplit(amountCents, TIER_FEE_BPS[tier]);
}

/** "700" → "7%", "1000" → "10%". */
export function bpsToPct(bps: number): string {
  const pct = bps / 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

/** Integer cents → "$12.34" (never mixes Visual Bucs copy with real money). */
export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** true when `actual` tier meets or exceeds `required` tier. */
export function meetsTier(actual: CreatorTier, required: CreatorTier): boolean {
  return TIER_RANK[actual] >= TIER_RANK[required];
}

/**
 * Map legacy main-site plan names (pricing page: "Pro Artist", "Studio",
 * "VIP", "MVP") onto canonical creator tiers. Legacy paying plans count
 * as at least "pro" so nobody loses access they already paid for.
 */
export function tierFromLegacyPlan(plan: string | null | undefined): CreatorTier {
  const p = (plan ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!p) return "free";
  if (p.includes("mvp") || p.includes("vip")) return "elite";
  if (p.includes("pro") || p.includes("studio")) return "pro";
  return "free";
}

/**
 * Map the 1–6 plan ladder (Supabase profiles.plan_tier) onto canonical
 * creator tiers: ladder tiers 1–3 read as free, 4–5 as pro, and 6 as
 * elite. (The ladder number is a plan record, not a rank — Creator
 * Level stars are earned separately and no tier moves them.)
 */
export function tierFromPlanTier(planTier: number | null | undefined): CreatorTier {
  const t = typeof planTier === "number" && Number.isFinite(planTier) ? Math.floor(planTier) : 1;
  if (t >= 6) return "elite";
  if (t >= 4) return "pro";
  return "free";
}

/**
 * Express a canonical tier in the legacy plan-name vocabulary that
 * req.userPlan's consumers already parse (storefront meetsProTier,
 * export watermark FREE_PLANS, tierFromLegacyPlan above): "free",
 * "Pro Artist" (pro), "VIP" (elite). Keep in lockstep with
 * tierFromLegacyPlan — every name here must map back to its tier.
 */
export function legacyPlanNameForTier(tier: CreatorTier): string {
  if (tier === "elite") return "VIP";
  if (tier === "pro") return "Pro Artist";
  return "free";
}

/* Creator Level stars are EARNED RANK (owner ruling 2026-10-17) and are
 * never sold or capped by a tier — the former TIER_MAX_STARS ceiling is
 * abolished. Tiers sell fees, boosts, domains and themes; rank comes
 * only from recorded work (lib/creator-rank.ts). */

/** AI promotion boosts included per month. ★ APPROVED 2026-10-07 */
export const TIER_AI_BOOSTS: Record<CreatorTier, number> = {
  free: 3,
  pro: 25,
  elite: 100,
};

/* ── Tier catalog — the money story ───────────────────────────────────────
   Prices APPROVED 2026-10-07, charged in real USD via
   Stripe subscriptions (TEST mode only until launch). */

export interface TierFeature {
  label: string;
  /** Where "learn more" links: a real page, or an in-page anchor on /creator-pricing. */
  detailsUrl: string;
}

export interface TierPlanDef {
  tier: CreatorTier;
  name: string;
  tagline: string;
  /** Monthly price in whole USD; null = free forever. ★ APPROVED 2026-10-07 */
  priceUsdPerMonth: number | null;
  /** Env var holding the Stripe TEST price id; null for free. */
  priceIdEnv: string | null;
  feeBps: number;
  aiBoostsPerMonth: number;
  features: TierFeature[];
}

export const TIER_PLANS: TierPlanDef[] = [
  {
    tier: "free",
    name: "Free",
    tagline: "Start earning. Keep the lights on, we'll handle the stage.",
    priceUsdPerMonth: null,
    priceIdEnv: null,
    feeBps: TIER_FEE_BPS.free,
    aiBoostsPerMonth: TIER_AI_BOOSTS.free,
    features: [
      { label: "Your own subdomain site (you.bowdownvisuals.com)", detailsUrl: "/creator-pricing#feature-site" },
      { label: "Livestreaming to your fans", detailsUrl: "/creator-pricing#feature-streaming" },
      { label: "Sell downloads, products & tickets — flat 5% platform fee", detailsUrl: "/creator-pricing#money-math" },
      { label: "Basic site themes", detailsUrl: "/creator-pricing#feature-themes" },
      { label: "Basic analytics (plays, views, sales)", detailsUrl: "/analytics" },
      { label: "3 AI promotion boosts / month", detailsUrl: "/creator-pricing#feature-boosts" },
      { label: "Full earnings dashboard — your money is never gated", detailsUrl: "/creator-pricing#money-math" },
    ],
  },
  {
    tier: "pro",
    name: "Pro",
    tagline: "Go pro: your own domain, unlimited products, pro analytics.",
    priceUsdPerMonth: 12, // ★ APPROVED 2026-10-07
    priceIdEnv: "STRIPE_PRICE_TIER_PRO",
    feeBps: TIER_FEE_BPS.pro,
    aiBoostsPerMonth: TIER_AI_BOOSTS.pro,
    features: [
      { label: "Everything in Free, plus:", detailsUrl: "/creator-pricing#money-math" },
      { label: "Your own custom domain (you.com, verified)", detailsUrl: "/storefronts" },
      { label: "Flat 5% platform fee — the same honest rate on every tier", detailsUrl: "/creator-pricing#money-math" },
      { label: "Unlimited products in your shop", detailsUrl: "/storefronts" },
      { label: "Premium gold-luxury themes", detailsUrl: "/creator-pricing#feature-themes" },
      { label: "Pro analytics dashboard (funnels, sources, cohorts)", detailsUrl: "/analytics" },
      { label: "25 AI promotion boosts / month", detailsUrl: "/creator-pricing#feature-boosts" },
    ],
  },
  {
    tier: "elite",
    name: "Elite",
    tagline: "Front of the line. Priority placement and the full boost stack.",
    priceUsdPerMonth: 29, // ★ APPROVED 2026-10-07
    priceIdEnv: "STRIPE_PRICE_TIER_ELITE",
    feeBps: TIER_FEE_BPS.elite,
    aiBoostsPerMonth: TIER_AI_BOOSTS.elite,
    features: [
      { label: "Everything in Pro, plus:", detailsUrl: "/creator-pricing#money-math" },
      { label: "Flat 5% platform fee — the same honest rate on every tier", detailsUrl: "/creator-pricing#money-math" },
      { label: "Priority placement in discovery", detailsUrl: "/creator-pricing#feature-discovery" },
      { label: "Dedicated support badge + priority support", detailsUrl: "/creator-pricing#feature-support" },
      { label: "100 AI promotion boosts / month", detailsUrl: "/creator-pricing#feature-boosts" },
    ],
  },
];

/**
 * "Pays for itself" math: monthly sales volume (USD) at which the tier's
 * fee savings vs Free exactly cover the subscription price. Since
 * Stack-28 item 4 the fee is a flat 5% on every tier (the rail truth),
 * so there are no tier fee savings: this returns null and
 * monthlySavingsUsd returns 0 — paid tiers pay for themselves with
 * their features (domain, products, analytics, boosts), not a fee drop.
 */
export function breakEvenSalesUsd(tier: Exclude<CreatorTier, "free">): number | null {
  const plan = TIER_PLANS.find((p) => p.tier === tier);
  if (!plan || plan.priceUsdPerMonth == null) return null;
  const savedBps = TIER_FEE_BPS.free - plan.feeBps;
  if (savedBps <= 0) return null;
  return Math.ceil((plan.priceUsdPerMonth / (savedBps / 10_000)) * 100) / 100;
}

/** Monthly savings (USD) at a given sales volume vs the Free tier fee. */
export function monthlySavingsUsd(tier: Exclude<CreatorTier, "free">, salesUsdPerMonth: number): number {
  const plan = TIER_PLANS.find((p) => p.tier === tier);
  if (!plan) return 0;
  const savedBps = TIER_FEE_BPS.free - plan.feeBps;
  return Math.round(salesUsdPerMonth * (savedBps / 10_000) * 100) / 100;
}

/* ── Hosting plan (Stack 3, item 8) ───────────────────────────────────────
   ONE plan on the creator-tiers chassis: custom domain + clean branding
   (the paid state of the free-tier branding rule) + the profile page as
   the creator's website, hosted by us. Sold via Stripe subscription,
   TEST mode only, exactly like the tiers.

   PRICE LAW: never invent a price. The tiers above carry owner-approved
   prices in code; the Hosting plan does NOT — its price is a named
   server config value (HOSTING_PRICE_USD_PER_MONTH, with the Stripe
   TEST price id in STRIPE_PRICE_HOSTING). Until the owner sets them,
   the price reads null and the plan is honestly NOT available for
   purchase — checkout refuses rather than faking a number. */

export interface HostingPlanDef {
  name: string;
  tagline: string;
  /** Env var holding the Stripe TEST price id. */
  priceIdEnv: string;
  features: TierFeature[];
}

export const HOSTING_PLAN: HostingPlanDef = {
  name: "Hosting",
  tagline: "Your page is your website — on your own domain, with clean branding, hosted by us.",
  priceIdEnv: "STRIPE_PRICE_HOSTING",
  features: [
    { label: "Your own custom domain on your profile page", detailsUrl: "/creator-pricing#feature-site" },
    { label: "Clean branding — no “Powered by” mark on your page", detailsUrl: "/creator-pricing#feature-site" },
    { label: "Your profile page, hosted — fast, secure, always up", detailsUrl: "/creator-pricing#feature-site" },
  ],
};

/** The configured monthly Hosting price in USD, or null when the owner
    hasn't set one. Read live from env so a config change needs no deploy
    of code — only the value the owner chose. */
export function hostingPriceUsdPerMonth(): number | null {
  const v = Number(process.env["HOSTING_PRICE_USD_PER_MONTH"]);
  if (Number.isFinite(v) && v > 0 && v <= 10_000) return Math.round(v * 100) / 100;
  return null;
}

/** True only when BOTH the price and its Stripe TEST price id exist —
    the plan can then be sold at exactly the displayed price. */
export function hostingPriceConfigured(): boolean {
  return hostingPriceUsdPerMonth() !== null && !!process.env[HOSTING_PLAN.priceIdEnv];
}
