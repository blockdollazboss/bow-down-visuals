import Stripe from "stripe";
import { db, creatorProfilesTable, creatorSubscriptionsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import { CREATOR_TIERS, type CreatorTier } from "./platform-fees";

/* ── Creator tier subscription sync — Worker 12 ────────────────────────────
   Called from the central Stripe webhook (lib/stripe-webhook.ts). Handles:
     checkout.session.completed  (metadata.kind === "creator_tier")
     customer.subscription.updated
     customer.subscription.deleted
     invoice.payment_failed
   All writes are idempotent (upsert on profile_id). Real-money copy only —
   Visual Bucs are never mentioned here.                                   */

function getStripe(): Stripe {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(key);
}

/** Stripe v22: the period lives on the subscription ITEM, not the subscription. */
function periodEndOf(sub: Stripe.Subscription): Date | null {
  const item = sub.items?.data?.[0];
  const cpe = item?.current_period_end;
  return typeof cpe === "number" ? new Date(cpe * 1000) : null;
}

function cancelAtOf(sub: Stripe.Subscription): Date | null {
  return typeof sub.cancel_at === "number" ? new Date(sub.cancel_at * 1000) : null;
}

function priceIdToTier(priceId: string | null | undefined): CreatorTier | null {
  if (!priceId) return null;
  if (priceId === process.env["STRIPE_PRICE_TIER_PRO"]) return "pro";
  if (priceId === process.env["STRIPE_PRICE_TIER_ELITE"]) return "elite";
  return null;
}

function validTier(v: unknown): v is CreatorTier {
  return typeof v === "string" && (CREATOR_TIERS as readonly string[]).includes(v);
}

async function profileIdForCustomer(
  stripe: Stripe,
  opts: { userId?: string | null; customerId?: string | null },
): Promise<string | null> {
  if (opts.userId) {
    const [p] = await db
      .select({ id: creatorProfilesTable.id })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.userId, opts.userId))
      .limit(1);
    if (p) return p.id;
  }
  if (opts.customerId) {
    const [s] = await db
      .select({ profileId: creatorSubscriptionsTable.profileId })
      .from(creatorSubscriptionsTable)
      .where(eq(creatorSubscriptionsTable.stripeCustomerId, opts.customerId))
      .limit(1);
    if (s) return s.profileId;
  }
  return null;
}

async function upsertSubscription(values: {
  profileId: string;
  tier: CreatorTier;
  status: string;
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: Date | null;
}): Promise<void> {
  const now = new Date();
  await db.execute(sql`
      INSERT INTO creator_subscriptions
        (profile_id, tier, status, stripe_subscription_id, stripe_customer_id,
         current_period_end, cancel_at_period_end, created_at, updated_at)
      VALUES (${values.profileId}, ${values.tier}, ${values.status},
              ${values.stripeSubscriptionId ?? null}, ${values.stripeCustomerId ?? null},
              ${values.currentPeriodEnd ?? null}, ${values.cancelAtPeriodEnd ?? null},
              ${now}, ${now})
      ON CONFLICT (profile_id) DO UPDATE SET
        tier = EXCLUDED.tier,
        status = EXCLUDED.status,
        stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, creator_subscriptions.stripe_subscription_id),
        stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, creator_subscriptions.stripe_customer_id),
        current_period_end = COALESCE(EXCLUDED.current_period_end, creator_subscriptions.current_period_end),
        cancel_at_period_end = EXCLUDED.cancel_at_period_end,
        updated_at = EXCLUDED.updated_at
    `);
}

/** checkout.session.completed with metadata.kind === "creator_tier". */
export async function handleTierCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const tier = validTier(session.metadata?.["tier"]) ? (session.metadata!["tier"] as CreatorTier) : null;
  if (!tier || tier === "free") {
    logger.warn({ sessionId: session.id }, "tier checkout: missing/invalid tier metadata");
    return;
  }
  const stripe = getStripe();
  const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  let currentPeriodEnd: Date | null = null;
  let customerId: string | null = typeof session.customer === "string" ? session.customer : null;
  if (subId) {
    const sub = await stripe.subscriptions.retrieve(subId);
    currentPeriodEnd = periodEndOf(sub);
    if (!customerId && typeof sub.customer === "string") customerId = sub.customer;
  }
  const profileId = await profileIdForCustomer(stripe, {
    userId: session.metadata?.["user_id"],
    customerId,
  });
  if (!profileId) {
    logger.warn({ sessionId: session.id }, "tier checkout: no creator profile for buyer — cannot attach tier");
    return;
  }
  await upsertSubscription({
    profileId,
    tier,
    status: "active",
    stripeSubscriptionId: subId ?? null,
    stripeCustomerId: customerId,
    currentPeriodEnd,
  });
  logger.info({ sessionId: session.id, profileId, tier }, "creator tier activated via webhook");
}

/** customer.subscription.updated / .deleted — keep tier + status in sync. */
export async function handleTierSubscriptionEvent(subscription: Stripe.Subscription): Promise<void> {
  const stripe = getStripe();
  const customerId = typeof subscription.customer === "string" ? subscription.customer : null;
  const priceId = subscription.items.data[0]?.price?.id ?? null;
  const tier =
    validTier(subscription.metadata?.["tier"])
      ? (subscription.metadata!["tier"] as CreatorTier)
      : priceIdToTier(priceId);
  const profileId = await profileIdForCustomer(stripe, { customerId });
  if (!profileId) {
    logger.warn({ subId: subscription.id }, "subscription event: no creator profile for customer");
    return;
  }
  const status = subscription.status; // active | trialing | past_due | canceled | incomplete…
  await upsertSubscription({
    profileId,
    tier: tier ?? "free",
    status,
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: customerId,
    currentPeriodEnd: periodEndOf(subscription),
    cancelAtPeriodEnd: cancelAtOf(subscription),
  });
  logger.info({ subId: subscription.id, profileId, tier, status }, "creator tier synced from subscription event");
}

/** invoice.payment_failed — flag the row so gating degrades honestly. */
export async function handleTierInvoiceFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
  if (!customerId) return;
  await db
    .update(creatorSubscriptionsTable)
    .set({ status: "past_due", updatedAt: new Date() })
    .where(eq(creatorSubscriptionsTable.stripeCustomerId, customerId));
  logger.info({ customerId }, "creator tier marked past_due after failed invoice");
}
