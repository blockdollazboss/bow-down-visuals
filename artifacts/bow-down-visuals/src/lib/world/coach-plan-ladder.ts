/* ─── Coach plan ladder — the palace Coach desk's plan ladder ─────
   Stack-100 Wave 5, item 31 (org/design audit A14): the World's
   Coach panels carry the money tracker, the plan numbers and the
   action tracker, but the PLAN LADDER — what the creator tiers
   are, what each includes — and the UPGRADE DOOR were missing
   in-world (billing UI lived only in Settings / on the pricing
   page). This seam is the ladder's pure logic; CoachPlanLadder.tsx
   renders it inside the Coach desk family.

   Sources of truth — NO copies that can drift:
   - The ladder itself is CREATOR_PLANS from lib/pricing-plans,
     the ONE pricing module /creator-pricing and /pricing both
     render (itself pinned against the server's platform-fees
     TIER_PLANS by pricing-truth.test.ts). Names, taglines,
     prices, fee and boosts are read off that module at build
     time; this file holds no price literal of its own.
   - Live configuration (whether each tier's Stripe price is
     actually configured server-side, the live fee) overlays from
     GET /api/creator-tiers/plans — the creator-pricing page's
     own overlay semantics: the fetch only ever overlays config
     onto the shared source, never names/prices/features.
   - The member's current tier comes from useCreatorTier (the
     hook every tier display reads) in the component, off
     GET /api/creator-tiers/me — the real entitlement rail.
   - The upgrade door rides the creator-pricing page's embedded
     rails (subscription intent → on-page PaymentElement →
     verify; the proration preview → POST /api/creator-tiers/
     change), with the intent/change verdicts shared with the
     Get Paid Room's PlansDesk via lib/world/money-desks-2.

   Feature rows render as LABELS ONLY: CREATOR_PLANS rows carry
   detailsUrl page anchors, and the World renders no page
   pull-ups — the label is the inclusion, exactly as the PlansDesk
   renders the rail DTO's feature strings. */

import {
  CREATOR_PLANS,
  type CreatorTierId,
} from "@/lib/pricing-plans";

export type { CreatorTierId };

type CreatorPlanRow = (typeof CREATOR_PLANS)[number];

/** One ladder card, built from the shared pricing source plus the
 *  live-config overlay. Every display field except
 *  priceConfigured/fee comes straight off the CREATOR_PLANS row. */
export interface LadderPlanView {
  tier: CreatorTierId;
  name: string;
  tagline: string;
  /** Monthly price in whole USD from the shared source; 0 = Free. */
  priceUsdPerMonth: number;
  /** Fee percent label ("5%") — the shared source's, overlaid by
   *  the rail's live fee when the plans payload carries the tier. */
  feePct: string;
  feeBps: number;
  aiBoostsPerMonth: number;
  /** Inclusion labels, verbatim and in the shared source's order. */
  features: string[];
  /** Whether the rail can actually sell this tier today. Seeded
   *  exactly like the creator-pricing page: Free is always
   *  configured; a paid tier is configured only when the live
   *  plans payload says its Stripe price exists. */
  priceConfigured: boolean;
}

/** The live-config overlay for one tier, from
 *  GET /api/creator-tiers/plans — config only, never copy. */
export interface PlanConfigOverlay {
  priceConfigured: boolean;
  feeBps: number;
  feePct: string;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isTierId(v: unknown): v is CreatorTierId {
  return v === "free" || v === "pro" || v === "elite";
}

/** Parse the plans payload's live config, tier by tier. Mirrors
 *  the creator-pricing page's read: the payload's plans array is
 *  matched by tier and only config fields are taken. Anything
 *  unusable (non-object payload, no plans array, malformed rows)
 *  simply yields no overlay for that tier — the caller tracks a
 *  failed LOAD separately (non-ok / transport), exactly like the
 *  page, so a broken payload never invents a configuration fact. */
export function parsePlanConfigOverlay(
  payload: unknown,
): Partial<Record<CreatorTierId, PlanConfigOverlay>> {
  const out: Partial<Record<CreatorTierId, PlanConfigOverlay>> = {};
  if (!isObj(payload) || !Array.isArray(payload["plans"])) return out;
  for (const raw of payload["plans"]) {
    if (!isObj(raw)) continue;
    const tier = raw["tier"];
    if (!isTierId(tier)) continue;
    const feeBps =
      typeof raw["feeBps"] === "number" && Number.isFinite(raw["feeBps"])
        ? raw["feeBps"]
        : null;
    out[tier] = {
      /* The page's overlay takes the flag as the rail states it;
         an absent flag on a present row reads as not configured —
         the page seeds paid tiers false until the rail speaks. */
      priceConfigured: raw["priceConfigured"] === true,
      feeBps: feeBps ?? 0,
      feePct:
        typeof raw["feePct"] === "string" && raw["feePct"]
          ? raw["feePct"]
          : feeBps !== null
            ? `${feeBps / 100}%`
            : "",
    };
  }
  return out;
}

/** Build the ladder: CREATOR_PLANS in the shared source's order,
 *  with the live-config overlay applied per tier (fee fields and
 *  priceConfigured only — names, taglines, prices, boosts and
 *  feature labels always stay on the shared source). An overlay
 *  row whose fee fields are empty (malformed) leaves the shared
 *  source's fee standing rather than blanking it. */
export function buildLadderPlans(
  overlay: Partial<Record<CreatorTierId, PlanConfigOverlay>>,
): LadderPlanView[] {
  return CREATOR_PLANS.map((row: CreatorPlanRow): LadderPlanView => {
    const o = overlay[row.tier];
    return {
      tier: row.tier,
      name: row.name,
      tagline: row.tagline,
      priceUsdPerMonth: row.priceUsdPerMonth,
      feePct: o && o.feePct ? o.feePct : row.feePct,
      feeBps: o && o.feePct ? o.feeBps : row.feeBps,
      aiBoostsPerMonth: row.aiBoostsPerMonth,
      features: row.features.map((f) => f.label),
      priceConfigured: o ? o.priceConfigured : row.tier === "free",
    };
  });
}

/** A ladder card's price line, the PlansDesk's dress: "Free" for
 *  the free tier, "$12/mo" for a paid one — formatted from the
 *  shared source's figure, never a literal. */
export function ladderPriceLabel(view: LadderPlanView): string {
  return view.priceUsdPerMonth === 0 ? "Free" : `$${view.priceUsdPerMonth}/mo`;
}

/** How long the ladder waits for useCreatorTier before calling
 *  the tier read failed. The hook itself retries transport/5xx
 *  failures (3 attempts over ~1.6s of backoff, each attempt a
 *  real fetch that may ride a cold server wake); the grace here
 *  sits well past that so a slow-but-alive read still lands,
 *  while a truly dead read surfaces the honest error + Retry
 *  instead of spinning forever — and NEVER resolves to a
 *  defaulted "Free" standing. */
export const COACH_LADDER_TIER_STALL_MS = 20_000;
