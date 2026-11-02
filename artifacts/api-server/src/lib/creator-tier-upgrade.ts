import Stripe from "stripe";
import type { CreatorTier } from "./platform-fees";
import { withCheckoutRequestFingerprint } from "./stripe-client";

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

type StripeSubscriptionChanger = Pick<Stripe, "subscriptions">;
type StripeTierChangeClient = Pick<Stripe, "subscriptions" | "invoices">;

interface TierChangeResult {
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

/* The amount a tier change bills TODAY is the PRORATION NET — never
   the preview invoice's amount_due. createPreview answers "the
   upcoming invoice": it carries EVERY pending charge, so its
   amount_due bundles the swap's proration lines together with the
   next renewal at the new price (and any pending invoice items).
   Quoting amount_due overstates an upgrade by exactly the new plan's
   full monthly price — Gate #5 (Nov 1, live): a same-day Pro→Elite
   switch quoted $46.00 = $17 proration + $29 renewal, while
   always_invoice bills only the $17 proration invoice today — and in
   the downgrade direction it can shrink a real credit or even flip
   it into a fake charge. What the apply call (always_invoice) bills
   today is the proration invoice alone, so the quote is the sum of
   the preview's proration lines. Stripe's own API guidance: "The
   recommended way to get only the prorations being previewed on the
   invoice is to consider line items where
   parent.subscription_item_details.proration is true." Proration
   lines sort first on the preview's line list, ahead of the renewal
   lines, so the net is complete even if the list is paginated. */
export function prorationNetFromPreviewLines(
  lines: readonly Stripe.InvoiceLineItem[] | undefined | null,
): number {
  if (!lines) {
    /* A preview with no line list cannot support an honest quote —
       refuse (the routes answer 502) rather than guess a number. */
    throw new Error("Stripe's proration preview came back without line items — cannot quote that tier change.");
  }
  let net = 0;
  for (const line of lines) {
    const parent = line.parent;
    const isProration =
      parent?.subscription_item_details?.proration === true ||
      parent?.invoice_item_details?.proration === true;
    if (isProration && typeof line.amount === "number") net += line.amount;
  }
  return net;
}

/* Proration preview (stack600 plan-tier-change; quote math corrected
   stack1100 Z2): the honest numbers BEFORE any money moves. Stripe's
   invoice preview for the same subscription + item-price swap +
   proration_date the apply call will use, reduced to its proration
   lines (see prorationNetFromPreviewLines): net > 0 is the prorated
   difference charged today (upgrade); net < 0 is a net credit toward
   future invoices (downgrade). Creates nothing, charges nothing. */
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
  const due = prorationNetFromPreviewLines(preview.lines?.data);
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
    /** Stripe idempotency key for the change: a retry of the same
        change replays THIS update instead of executing twice. The
        effective key sent to Stripe also fingerprints the exact
        update parameters (see the update call below). */
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
  /* The caller's key names the change (subscription + from/to +
     period); the EFFECTIVE key also fingerprints the exact update
     parameters built here, so the key identifies this request: a
     re-previewed retry (a fresh proration instant) is a new request
     whose safety comes from the already-on-that-price guard above,
     while a byte-identical retry of THIS request still dedupes.
     Without the fold, a later same-period change back to the same
     tier could replay the first update's response under the shared
     key and never execute — and a parameter change under the key is
     exactly what Stripe refuses outright. */
  const requestKey = args.idempotencyKey
    ? withCheckoutRequestFingerprint(args.idempotencyKey, { subscriptionId: sub.id, updateParams })
    : undefined;
  const updated = await stripe.subscriptions.update(
    sub.id,
    updateParams,
    requestKey ? { idempotencyKey: requestKey } : undefined,
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
