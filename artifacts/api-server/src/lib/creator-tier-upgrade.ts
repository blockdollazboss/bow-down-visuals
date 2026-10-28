import Stripe from "stripe";
import type { CreatorTier } from "./platform-fees";

/* ── Upgrade/downgrade = subscription UPDATE (payfix upgrade-path) ───────
   Pass 1 (Oct 26): choosing Elite while on Pro opened a brand-new
   full-price checkout — a SECOND subscription on a SECOND customer,
   no proration, $41/mo billed. A tier change on an existing
   subscription is not a purchase: it is subscriptions.update() on the
   SAME subscription id, on the SAME customer, swapping the single
   item's price with proration_behavior "always_invoice" (Stripe
   credits the unused Pro time and charges the prorated Elite
   difference immediately — one subscription, one customer, one bill).

   First subscribe (no active subscription) is unchanged: it goes
   through Checkout, on the user's one persisted customer.            */

export type StripeSubscriptionChanger = Pick<Stripe, "subscriptions">;
export type StripeTierChangeClient = Pick<Stripe, "subscriptions" | "invoices">;

export interface TierChangeResult {
  subscriptionId: string;
  customerId: string | null;
  status: string;
  currentPeriodEnd: Date | null;
}

const CHANGEABLE_STATUSES = new Set(["active", "trialing", "past_due"]);

async function loadChangeableItem(
  stripe: StripeSubscriptionChanger,
  subscriptionId: string,
  priceId: string,
): Promise<{ sub: Stripe.Subscription; item: Stripe.SubscriptionItem }> {
  const sub = await stripe.subscriptions.retrieve(subscriptionId);
  if (!CHANGEABLE_STATUSES.has(sub.status)) {
    throw new Error(`Subscription ${sub.id} is ${sub.status} — it cannot be changed; start a fresh subscription instead.`);
  }
  const item = sub.items?.data?.[0];
  if (!item) {
    throw new Error(`Subscription ${sub.id} has no items to reprice.`);
  }
  if (item.price?.id === priceId) {
    throw new Error(`Subscription ${sub.id} is already on that price.`);
  }
  return { sub, item };
}

export interface TierChangePreview {
  subscriptionId: string;
  customerId: string | null;
  /** The proration instant (epoch seconds) the preview was computed at.
      The apply call reuses it, so the invoice Stripe generates carries
      exactly the amounts the member was shown. */
  prorationDate: number;
  /** What Stripe will charge the saved card today (≥ 0). */
  amountDueTodayCents: number;
  /** Credit toward future invoices when the swap nets negative (a
      downgrade mid-cycle) — nothing is charged today in that case. */
  creditCents: number;
  currency: string;
  currentPeriodEnd: Date | null;
}

/* Proration preview (stack600 plan-tier-change): the honest numbers
   BEFORE any money moves. Stripe's invoice preview for the same
   subscription + item-price swap + proration_date the apply call will
   use: amount_due > 0 is the prorated difference charged today
   (upgrade); amount_due < 0 is a net credit (downgrade). Creates
   nothing, charges nothing. */
export async function previewCreatorTierChange(
  stripe: StripeTierChangeClient,
  args: { subscriptionId: string; priceId: string; prorationDate?: number },
): Promise<TierChangePreview> {
  const { sub, item } = await loadChangeableItem(stripe, args.subscriptionId, args.priceId);
  const prorationDate = args.prorationDate ?? Math.floor(Date.now() / 1000);
  const preview = await stripe.invoices.createPreview({
    customer: typeof sub.customer === "string" ? sub.customer : undefined,
    subscription: sub.id,
    subscription_details: {
      items: [{ id: item.id, price: args.priceId }],
      proration_date: prorationDate,
    },
  });
  const due = typeof preview.amount_due === "number" ? preview.amount_due : 0;
  const cpe = item.current_period_end;
  return {
    subscriptionId: sub.id,
    customerId: typeof sub.customer === "string" ? sub.customer : null,
    prorationDate,
    amountDueTodayCents: Math.max(0, due),
    creditCents: Math.max(0, -due),
    currency: preview.currency ?? "usd",
    currentPeriodEnd: typeof cpe === "number" ? new Date(cpe * 1000) : null,
  };
}

export async function changeCreatorTierSubscription(
  stripe: StripeSubscriptionChanger,
  args: {
    subscriptionId: string;
    priceId: string;
    tier: Exclude<CreatorTier, "free">;
    userId: string;
    profileId: string;
    /** Pin the proration instant (from previewCreatorTierChange) so the
        generated invoice matches the preview the member confirmed. */
    prorationDate?: number;
    /** Stripe idempotency key: a double-click / concurrent retry of the
        same change replays THIS update instead of executing twice. */
    idempotencyKey?: string;
    /** A member who changes tiers is staying — a pending
        cancel_at_period_end is cleared as part of the change. */
    clearPendingCancel?: boolean;
  },
): Promise<TierChangeResult> {
  let loaded: Awaited<ReturnType<typeof loadChangeableItem>>;
  try {
    loaded = await loadChangeableItem(stripe, args.subscriptionId, args.priceId);
  } catch (err) {
    /* Concurrent twin of THIS keyed change already landed: the fresh
       retrieve shows the target price in place, so the swap the caller
       asked for is done — answer success from the retrieved state
       instead of refusing. Only for idempotency-keyed calls: the
       hosted rail passes no key and keeps the strict refusal. */
    if (args.idempotencyKey && err instanceof Error && /already on that price/.test(err.message)) {
      const sub = await stripe.subscriptions.retrieve(args.subscriptionId);
      const item = sub.items?.data?.[0];
      const cpe = item?.current_period_end;
      return {
        subscriptionId: sub.id,
        customerId: typeof sub.customer === "string" ? sub.customer : null,
        status: sub.status,
        currentPeriodEnd: typeof cpe === "number" ? new Date(cpe * 1000) : null,
      };
    }
    throw err;
  }
  const { sub, item } = loaded;
  const updateParams: Stripe.SubscriptionUpdateParams = {
    items: [{ id: item.id, price: args.priceId }],
    proration_behavior: "always_invoice",
    metadata: {
      ...(sub.metadata ?? {}),
      kind: "creator_tier",
      tier: args.tier,
      user_id: args.userId,
      profile_id: args.profileId,
    },
  };
  if (args.prorationDate) updateParams.proration_date = args.prorationDate;
  if (args.clearPendingCancel) updateParams.cancel_at_period_end = false;
  const updated = await stripe.subscriptions.update(
    sub.id,
    updateParams,
    args.idempotencyKey ? { idempotencyKey: args.idempotencyKey } : undefined,
  );
  const updatedItem = updated.items?.data?.[0];
  const cpe = updatedItem?.current_period_end;
  return {
    subscriptionId: updated.id,
    customerId: typeof updated.customer === "string" ? updated.customer : null,
    status: updated.status,
    currentPeriodEnd: typeof cpe === "number" ? new Date(cpe * 1000) : null,
  };
}
