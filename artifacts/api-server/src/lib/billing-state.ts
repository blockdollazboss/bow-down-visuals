import { TIER_PLANS, type CreatorTier } from "./platform-fees";

/* ── Billing state — the ONE derivation behind Settings → Billing ─────────
   The subscription source of truth is the creator_subscriptions row the
   Stripe webhook sync maintains (lib/creator-tier-sync.ts). This module
   turns that row into the exact state the site shows, so Settings, the
   cancel endpoint, and any future surface can never drift apart:

     free      — no paid subscription on record
     active    — paid, renews on renewalDate
     trialing  — paid trial, renews on renewalDate
     canceling — cancel requested; the tier is KEPT until endsAt
                 (cancel_at_period_end semantics — the FAQ promise),
                 then the subscription ends and the tier glides to Free
     past_due  — Stripe status past_due (payment failed)
     canceled  — subscription has ended; tier reads Free
     incomplete— checkout started but never completed payment

   The stored row's cancelAtPeriodEnd column holds the DATE the paid tier
   ends once a cancel lands (Stripe's cancel_at), mirroring the webhook
   sync — a non-null value on a still-live subscription means "canceling".
──────────────────────────────────────────────────────────────────────────── */

export interface SubscriptionBillingRow {
  tier: string;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: Date | null;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
}

export type BillingStatus =
  | "free"
  | "active"
  | "trialing"
  | "canceling"
  | "past_due"
  | "canceled"
  | "incomplete";

export interface BillingState {
  /** Effective plan tier the site grants right now. */
  plan: CreatorTier;
  planName: string;
  priceUsdPerMonth: number | null;
  status: BillingStatus;
  /** Stripe's raw subscription status, for honest display/debugging. */
  stripeStatus: string | null;
  /** End of the current paid period (ISO). */
  currentPeriodEnd: string | null;
  /** Next charge date (ISO) — only while the plan will actually renew. */
  renewalDate: string | null;
  /** Date the paid tier ends (ISO) — set while canceling / after canceled. */
  endsAt: string | null;
  hasStripeSubscription: boolean;
  hasStripeCustomer: boolean;
  canCancel: boolean;
  canResume: boolean;
  /** A live paid subscription can be repriced in place (Pro ↔ Elite)
      from Settings → Billing / the pricing page — the change control
      Gate Pass 1 (Oct 28) found missing everywhere. */
  canChangePlan: boolean;
}

const LIVE_STATUSES = new Set(["active", "trialing"]);

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

export function buildBillingState(
  row: SubscriptionBillingRow | null,
  effectiveTier: CreatorTier,
): BillingState {
  const planTier: CreatorTier =
    row && (row.tier === "pro" || row.tier === "elite") ? (row.tier as CreatorTier) : effectiveTier;
  const plan = TIER_PLANS.find((p) => p.tier === planTier) ?? TIER_PLANS[0]!;
  const base: BillingState = {
    plan: planTier,
    planName: plan.name,
    priceUsdPerMonth: plan.priceUsdPerMonth,
    status: "free",
    stripeStatus: row?.status ?? null,
    currentPeriodEnd: iso(row?.currentPeriodEnd),
    renewalDate: null,
    endsAt: null,
    hasStripeSubscription: !!row?.stripeSubscriptionId,
    hasStripeCustomer: !!row?.stripeCustomerId,
    canCancel: false,
    canResume: false,
    canChangePlan: false,
  };

  if (!row || !row.stripeSubscriptionId || row.tier === "free") {
    return base;
  }

  if (row.status === "canceled") {
    return { ...base, status: "canceled", endsAt: iso(row.cancelAtPeriodEnd) ?? iso(row.currentPeriodEnd) };
  }

  const canceling = row.cancelAtPeriodEnd != null && LIVE_STATUSES.has(row.status);
  if (canceling) {
    return {
      ...base,
      status: "canceling",
      endsAt: iso(row.cancelAtPeriodEnd) ?? iso(row.currentPeriodEnd),
      canResume: true,
      canChangePlan: true,
    };
  }

  if (row.status === "active" || row.status === "trialing") {
    return {
      ...base,
      status: row.status,
      renewalDate: iso(row.currentPeriodEnd),
      canCancel: true,
      canChangePlan: true,
    };
  }

  if (row.status === "past_due") {
    return { ...base, status: "past_due", canChangePlan: true };
  }

  return { ...base, status: "incomplete" };
}
