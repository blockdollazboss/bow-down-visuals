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

   ★ PROPOSALS PENDING USER APPROVAL (flagged, env-overridable):
     - Tier fee rates:  free 10% / pro 7% / elite 5%
     - Subscription prices: pro $12/mo, elite $29/mo
     - Star ceilings:  free 1–3★ / pro 4–5★ / elite 6★
     - AI boost quotas: free 3 / pro 25 / elite 100 per month
   Nothing here bills a real card until the user signs off.               */

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
 * Matches the existing storefront fee (10%). Env-overridable without a deploy.
 */
export const PLATFORM_FEE_BPS: number = parseBps(process.env["PLATFORM_FEE_BPS"], 1000);

/** Per-tier fee rates. ★ PROPOSED — pending user approval. */
export const TIER_FEE_BPS: Record<CreatorTier, number> = {
  free: parseBps(process.env["PLATFORM_FEE_BPS_FREE"], PLATFORM_FEE_BPS),
  pro: parseBps(process.env["PLATFORM_FEE_BPS_PRO"], 700), // 7% — PROPOSED
  elite: parseBps(process.env["PLATFORM_FEE_BPS_ELITE"], 500), // 5% — PROPOSED
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

/** Difficulty-ladder ceiling: highest creator-level star a tier may use. ★ PROPOSED */
export const TIER_MAX_STARS: Record<CreatorTier, number> = {
  free: 3, // 1–3★ Street Punk → Gangster
  pro: 5, // 4–5★ Shot Caller → Crime Boss
  elite: 6, // 6★ Kingpin
};

export function maxStarsForTier(tier: CreatorTier): number {
  return TIER_MAX_STARS[tier];
}

/** AI promotion boosts included per month. ★ PROPOSED */
export const TIER_AI_BOOSTS: Record<CreatorTier, number> = {
  free: 3,
  pro: 25,
  elite: 100,
};

/* ── Tier catalog — the money story ───────────────────────────────────────
   Prices are PROPOSED (pending user approval), charged in real USD via
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
  /** Monthly price in whole USD; null = free forever. ★ PROPOSED */
  priceUsdPerMonth: number | null;
  /** Env var holding the Stripe TEST price id; null for free. */
  priceIdEnv: string | null;
  feeBps: number;
  maxStars: number;
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
    maxStars: TIER_MAX_STARS.free,
    aiBoostsPerMonth: TIER_AI_BOOSTS.free,
    features: [
      { label: "Your own subdomain site (you.bowdownvisuals.com)", detailsUrl: "/creator-pricing#feature-site" },
      { label: "Livestreaming to your fans", detailsUrl: "/creator-pricing#feature-streaming" },
      { label: "Sell downloads, products & tickets — standard 10% fee", detailsUrl: "/creator-pricing#money-math" },
      { label: "Basic site themes", detailsUrl: "/creator-pricing#feature-themes" },
      { label: "Basic analytics (plays, views, sales)", detailsUrl: "/analytics" },
      { label: "3 AI promotion boosts / month", detailsUrl: "/creator-pricing#feature-boosts" },
      { label: "Stars 1–3 controls (AI autopilot → guided tweaks)", detailsUrl: "/creator-pricing#stars" },
      { label: "Full earnings dashboard — your money is never gated", detailsUrl: "/creator-pricing#money-math" },
    ],
  },
  {
    tier: "pro",
    name: "Pro",
    tagline: "Go pro, keep more of your money. The fee drop pays for itself.",
    priceUsdPerMonth: 12, // ★ PROPOSED — pending user approval
    priceIdEnv: "STRIPE_PRICE_TIER_PRO",
    feeBps: TIER_FEE_BPS.pro,
    maxStars: TIER_MAX_STARS.pro,
    aiBoostsPerMonth: TIER_AI_BOOSTS.pro,
    features: [
      { label: "Everything in Free, plus:", detailsUrl: "/creator-pricing#money-math" },
      { label: "Your own custom domain (you.com, verified)", detailsUrl: "/storefronts" },
      { label: "Only 7% platform fee — keep 3% more of every sale", detailsUrl: "/creator-pricing#money-math" },
      { label: "Unlimited products in your shop", detailsUrl: "/storefronts" },
      { label: "Premium gold-luxury themes", detailsUrl: "/creator-pricing#feature-themes" },
      { label: "Pro analytics dashboard (funnels, sources, cohorts)", detailsUrl: "/analytics" },
      { label: "25 AI promotion boosts / month", detailsUrl: "/creator-pricing#feature-boosts" },
      { label: "Stars 4–5 controls (advanced panels, pro model pickers)", detailsUrl: "/creator-pricing#stars" },
    ],
  },
  {
    tier: "elite",
    name: "Elite",
    tagline: "Front of the line. The lowest fee on the platform.",
    priceUsdPerMonth: 29, // ★ PROPOSED — pending user approval
    priceIdEnv: "STRIPE_PRICE_TIER_ELITE",
    feeBps: TIER_FEE_BPS.elite,
    maxStars: TIER_MAX_STARS.elite,
    aiBoostsPerMonth: TIER_AI_BOOSTS.elite,
    features: [
      { label: "Everything in Pro, plus:", detailsUrl: "/creator-pricing#money-math" },
      { label: "Only 5% platform fee — keep 5% more of every sale", detailsUrl: "/creator-pricing#money-math" },
      { label: "Priority placement in discovery", detailsUrl: "/creator-pricing#feature-discovery" },
      { label: "Dedicated support badge + priority support", detailsUrl: "/creator-pricing#feature-support" },
      { label: "100 AI promotion boosts / month", detailsUrl: "/creator-pricing#feature-boosts" },
      { label: "Star 6 Kingpin controls (every knob, experimental)", detailsUrl: "/creator-pricing#stars" },
    ],
  },
];

/**
 * "Pays for itself" math: monthly sales volume (USD) at which the tier's
 * fee savings vs Free exactly cover the subscription price.
 * Pro: $12 / 3% = $400/mo. Elite: $29 / 5% = $580/mo.
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
