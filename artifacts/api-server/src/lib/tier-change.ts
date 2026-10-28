import { buildCheckoutSessionIdempotencyKey } from "./stripe-client";
import { TIER_PLANS, type CreatorTier } from "./platform-fees";

/* ── Tier change flow — shared by every surface (stack600) ──────────────
   Gate Pass 1 (Oct 28, live): an existing subscriber could not change
   tiers ANYWHERE. The hosted checkout rail already swapped the price in
   place, but the embedded rail (the live default — the site never sends
   a customer away) answered 409 ALREADY_SUBSCRIBED, Settings → Billing
   had no change control, and the Stripe portal showed no plan-change
   either. This module is the one flow behind all of it:

     POST /creator-tiers/change/preview  → honest proration numbers
     POST /creator-tiers/change          → the in-place swap
     POST /embedded-checkout/subscription/intent (subscriber, other
       tier) → returns mode:"change" + the same preview, so the pricing
       page lands on the same confirm step instead of the 409 dead end
       (and the World PlansDesk inherits the intent-side shape).

   Invariants (the Oct 26 disaster stays impossible):
     - ONE Stripe customer per user — a change never creates a customer.
     - ONE subscription — a change is subscriptions.update() on the
       member's existing subscription id, never a create.
     - The swap is idempotency-keyed on the member's durable
       pre-change state (subscription id + from-tier + target tier +
       period end): a double-click or a concurrent retry replays the
       same Stripe update instead of executing a second one, and after
       the change lands the same request reads back as already-applied.
     - Proration is Stripe's own math with proration_behavior
       "always_invoice": an upgrade charges the prorated difference to
       the saved card TODAY and the new tier starts immediately; a
       downgrade starts immediately too and the net credit lands on
       future invoices (nothing charged today). The preview the member
       confirms is computed at the same proration_date the apply call
       uses, so the confirmed numbers are the charged numbers.       */

export type PaidTier = Exclude<CreatorTier, "free">;

export interface TierChangeRow {
  tier: string;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: Date | null;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
}

/** Deterministic idempotency key for one member's one tier change. */
export function buildTierChangeIdempotencyKey(args: {
  userId: string;
  subscriptionId: string;
  fromTier: string;
  toTier: string;
  currentPeriodEnd: Date | null;
}): string {
  return buildCheckoutSessionIdempotencyKey({
    memberId: args.userId,
    rail: "creator-tier-change",
    purchaseIntent: {
      subscriptionId: args.subscriptionId,
      fromTier: args.fromTier,
      toTier: args.toTier,
      currentPeriodEnd: args.currentPeriodEnd,
    },
  });
}

export interface TierChangePreviewView {
  fromTier: string;
  fromPlanName: string;
  toTier: PaidTier;
  toPlanName: string;
  toPriceUsdPerMonth: number | null;
  /** Charged to the saved card today (0 on a net-credit downgrade). */
  amountDueTodayCents: number;
  /** Credit toward future invoices (0 unless the swap nets negative). */
  creditCents: number;
  currency: string;
  /** The new tier applies immediately, mid-cycle. */
  effective: "immediate";
  /** Renewal date is unchanged by a swap — the period end stays. */
  renewalDate: string | null;
  /** True when the member had a cancel pending: changing plans clears
      it (changing your plan means you're staying). */
  clearsPendingCancel: boolean;
}

export function buildTierChangePreviewView(args: {
  row: TierChangeRow;
  toTier: PaidTier;
  amountDueTodayCents: number;
  creditCents: number;
  currency: string;
  currentPeriodEnd: Date | null;
}): TierChangePreviewView {
  const fromPlan = TIER_PLANS.find((p) => p.tier === args.row.tier);
  const toPlan = TIER_PLANS.find((p) => p.tier === args.toTier)!;
  const renewal = args.currentPeriodEnd ?? args.row.currentPeriodEnd;
  return {
    fromTier: args.row.tier,
    fromPlanName: fromPlan?.name ?? args.row.tier,
    toTier: args.toTier,
    toPlanName: toPlan.name,
    toPriceUsdPerMonth: toPlan.priceUsdPerMonth,
    amountDueTodayCents: args.amountDueTodayCents,
    creditCents: args.creditCents,
    currency: args.currency,
    effective: "immediate",
    renewalDate: renewal ? renewal.toISOString() : null,
    clearsPendingCancel: args.row.cancelAtPeriodEnd != null,
  };
}

/** Statuses whose subscription can be repriced in place. "canceling" is
    not a Stripe status — it is an active/trialing row whose
    cancelAtPeriodEnd date is set, and it stays changeable (the change
    clears the pending cancel). */
export function isChangeableRow(row: TierChangeRow | null): row is TierChangeRow & { stripeSubscriptionId: string } {
  if (!row?.stripeSubscriptionId) return false;
  return row.status === "active" || row.status === "trialing" || row.status === "past_due";
}
