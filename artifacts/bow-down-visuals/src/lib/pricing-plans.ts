/* ── Pricing truth — ONE shared source for every pricing surface ─────────
   Payfix lane (pricing-truth): /pricing used to sell a fake 6-plan
   rank-named ladder at invented prices under a billing-not-live note,
   while /creator-pricing sold the real plans. That ladder is dead.

   This module mirrors the server's single source of truth —
   api-server/src/lib/platform-fees.ts TIER_PLANS (Free $0 / Pro $12/mo /
   Elite $29/mo, flat 5% platform fee on every tier, AI boosts 3/25/100,
   prices approved 2026-10-07) and the server PACK_MAP in
   api-server/src/routes/stripe-payments.ts (keys 10/50/150/500 →
   1,000/5,000/15,000/50,000 Visual Bucs at $9/$39/$99/$249).

   BOTH pricing pages consume this module, and pricing-truth.test.ts pins
   it against the server sources, so the pages cannot drift apart or away
   from the rails again. Never invent a price here — ratified prices only.
   Checkout stays in test mode until launch; copy must say exactly that. */

export type CreatorTierId = "free" | "pro" | "elite";

export interface CreatorPlanFeature {
  label: string;
  detailsUrl: string;
}

export interface CreatorPlan {
  tier: CreatorTierId;
  name: string;
  tagline: string;
  /** Monthly price in whole USD; 0 = free forever. Ratified: Pro $12, Elite $29. */
  priceUsdPerMonth: number;
  feeBps: number;
  feePct: string;
  aiBoostsPerMonth: number;
  features: CreatorPlanFeature[];
}

export const CREATOR_PLANS: CreatorPlan[] = [
  {
    tier: "free",
    name: "Free",
    tagline: "Start earning. Keep the lights on, we'll handle the stage.",
    priceUsdPerMonth: 0,
    feeBps: 500,
    feePct: "5%",
    aiBoostsPerMonth: 3,
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
    priceUsdPerMonth: 12,
    feeBps: 500,
    feePct: "5%",
    aiBoostsPerMonth: 25,
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
    priceUsdPerMonth: 29,
    feeBps: 500,
    feePct: "5%",
    aiBoostsPerMonth: 100,
    features: [
      { label: "Everything in Pro, plus:", detailsUrl: "/creator-pricing#money-math" },
      { label: "Flat 5% platform fee — the same honest rate on every tier", detailsUrl: "/creator-pricing#money-math" },
      { label: "Priority placement in discovery", detailsUrl: "/creator-pricing#feature-discovery" },
      { label: "Dedicated support badge + priority support", detailsUrl: "/creator-pricing#feature-support" },
      { label: "100 AI promotion boosts / month", detailsUrl: "/creator-pricing#feature-boosts" },
      { label: "Profile Hosting included — the $9/mo Hosting plan is free while you're Elite", detailsUrl: "/creator-pricing#feature-site" },
    ],
  },
];

export interface CreditPack {
  packKey: string;
  credits: number;
  creditsLabel: string;
  priceUsd: number;
  priceLabel: string;
}

/** Ratified Visual Buc packs — mirrors the server PACK_MAP exactly. */
export const CREDIT_PACKS: CreditPack[] = [
  { packKey: "10", credits: 1000, creditsLabel: "1,000 Visual Bucs", priceUsd: 9, priceLabel: "$9" },
  { packKey: "50", credits: 5000, creditsLabel: "5,000 Visual Bucs", priceUsd: 39, priceLabel: "$39" },
  { packKey: "150", credits: 15000, creditsLabel: "15,000 Visual Bucs", priceUsd: 99, priceLabel: "$99" },
  { packKey: "500", credits: 50000, creditsLabel: "50,000 Visual Bucs", priceUsd: 249, priceLabel: "$249" },
];

/** The one honest billing-status sentence, true in test mode today. */
export const PRICING_TEST_MODE_NOTE =
  "Checkout is open in test mode — no real money is charged until launch.";
