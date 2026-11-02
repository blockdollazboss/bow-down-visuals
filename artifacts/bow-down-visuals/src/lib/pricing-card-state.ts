/* ─── pricing-card-state — /pricing plan-card CTA derivation ───────────
   stack700 pricing-free-state: /pricing rendered its Free card with an
   actionable "Start free" button for EVERYONE — including a signed-in
   member whose current plan IS Free (proven live on the stack600
   settle walk, Oct 28: the owner's free account was offered "Start
   free" as if it had no plan, and the card carried no current-plan
   marker). /creator-pricing already derives this honestly from
   useCreatorTier — its Free card shows a non-actionable "Your current
   plan" marker to a free member — but /pricing never read the tier at
   all. This module is the one derivation the /pricing render and its
   tests share:

     plan card    viewer tier    CTA
     ──────────   ─────────────  ────────────────────────────────────
     free         free           "your-plan" — marker, no action
     free         pro / elite    "none" — no action (see below)
     free         null           "start-free" — visitor / still
                                  loading: today's marketing CTA
     pro / elite  any            "go" — link onward to
                                  /creator-pricing, where the Go /
                                  Switch / Your-plan states and the
                                  tier-change confirm live

   Why "none" for a paid member on the Free card: moving to Free is
   NOT a tier change. /creator-tiers/change accepts only pro|elite
   targets (the route's changeSchema; lib/tier-change's PaidTier
   excludes "free") — a swap to a $0 plan has no Stripe price to swap
   to and does not exist. Leaving a paid plan is the cancel path in
   Settings → Billing: the tier is held to period end, then glides
   back to Free, exactly as the FAQ promises. Offering "Start free"
   here would promise an instant downgrade the product deliberately
   does not perform, so the card renders no CTA at all.            */

import type { CreatorTierId } from "./pricing-plans";

type PricingCardCtaKind = "start-free" | "your-plan" | "none" | "go";

export function pricingCardCta(
  planTier: CreatorTierId,
  currentTier: CreatorTierId | null,
): PricingCardCtaKind {
  if (planTier !== "free") return "go";
  if (currentTier === "free") return "your-plan";
  if (currentTier === "pro" || currentTier === "elite") return "none";
  return "start-free";
}

/* ─── Paid-plan CTA — /creator-pricing Pro / Elite cards ──────────────
   stack1300 staging-gate-api: the page seeds paid plans with
   priceConfigured:false and overlays GET /api/creator-tiers/plans.
   When that load FAILED (non-ok — the staging gate's 401 included —
   or a network throw), the overlay never arrived and the fallback
   rendered "price coming soon" even with the price fully configured
   server-side: a load failure dressed up as a configuration fact.
   The two are different facts and render differently:

     configured                 → "buy"         (Go / Switch label)
     unconfigured, load clean   → "coming-soon" (the honest fact)
     unconfigured, load FAILED  → "retry-load"  (honest failure; the
                                  click re-runs the load, never opens
                                  a checkout against unknown config)  */

export type PaidPlanCtaKind = "buy" | "coming-soon" | "retry-load";

export function paidPlanCta(
  priceConfigured: boolean,
  plansLoadFailed: boolean,
): PaidPlanCtaKind {
  if (priceConfigured) return "buy";
  return plansLoadFailed ? "retry-load" : "coming-soon";
}
