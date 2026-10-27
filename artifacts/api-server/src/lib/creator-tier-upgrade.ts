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

export interface TierChangeResult {
  subscriptionId: string;
  customerId: string | null;
  status: string;
  currentPeriodEnd: Date | null;
}

const CHANGEABLE_STATUSES = new Set(["active", "trialing", "past_due"]);

export async function changeCreatorTierSubscription(
  stripe: StripeSubscriptionChanger,
  args: {
    subscriptionId: string;
    priceId: string;
    tier: Exclude<CreatorTier, "free">;
    userId: string;
    profileId: string;
  },
): Promise<TierChangeResult> {
  const sub = await stripe.subscriptions.retrieve(args.subscriptionId);
  if (!CHANGEABLE_STATUSES.has(sub.status)) {
    throw new Error(`Subscription ${sub.id} is ${sub.status} — it cannot be changed; start a fresh subscription instead.`);
  }
  const item = sub.items?.data?.[0];
  if (!item) {
    throw new Error(`Subscription ${sub.id} has no items to reprice.`);
  }
  if (item.price?.id === args.priceId) {
    throw new Error(`Subscription ${sub.id} is already on that price.`);
  }
  const updated = await stripe.subscriptions.update(sub.id, {
    items: [{ id: item.id, price: args.priceId }],
    proration_behavior: "always_invoice",
    metadata: {
      ...(sub.metadata ?? {}),
      kind: "creator_tier",
      tier: args.tier,
      user_id: args.userId,
      profile_id: args.profileId,
    },
  });
  const updatedItem = updated.items?.data?.[0];
  const cpe = updatedItem?.current_period_end;
  return {
    subscriptionId: updated.id,
    customerId: typeof updated.customer === "string" ? updated.customer : null,
    status: updated.status,
    currentPeriodEnd: typeof cpe === "number" ? new Date(cpe * 1000) : null,
  };
}
