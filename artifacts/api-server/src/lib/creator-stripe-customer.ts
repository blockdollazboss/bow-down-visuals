import Stripe from "stripe";
import {
  db,
  userStripeCustomersTable,
  creatorSubscriptionsTable,
  creatorHostingTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

/* ── One Stripe customer per user (payfix upgrade-path, Oct 26 2026) ─────
   Root cause of the Pass-1 defect: creator-tier checkout created a
   Checkout Session WITHOUT a `customer`, so Stripe minted a new
   customer on every purchase — Pro on customer A, the Elite "upgrade"
   on customer B, two live subscriptions, $41/mo billed.

   Every subscription checkout now resolves the customer through here:
     1. the durable user_stripe_customers mapping;
     2. a legacy customer id already recorded on the profile's
        creator_subscriptions / creator_hosting rows (backfilled into
        the mapping, so pre-fix subscribers keep THEIR customer);
     3. only when neither exists: create ONE customer and persist it
        BEFORE the checkout session is created.
   A stored customer Stripe says is gone (resource_missing) is replaced
   once and the mapping updated; any other Stripe error propagates so
   checkout fails closed instead of minting a duplicate.               */

export type StripeCustomerClient = Pick<Stripe, "customers">;

async function storedCustomerId(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ stripeCustomerId: userStripeCustomersTable.stripeCustomerId })
    .from(userStripeCustomersTable)
    .where(eq(userStripeCustomersTable.userId, userId))
    .limit(1);
  return row?.stripeCustomerId ?? null;
}

async function legacyCustomerId(profileId: string | null | undefined): Promise<string | null> {
  if (!profileId) return null;
  const [sub] = await db
    .select({ stripeCustomerId: creatorSubscriptionsTable.stripeCustomerId })
    .from(creatorSubscriptionsTable)
    .where(eq(creatorSubscriptionsTable.profileId, profileId))
    .limit(1);
  if (sub?.stripeCustomerId) return sub.stripeCustomerId;
  const [hosting] = await db
    .select({ stripeCustomerId: creatorHostingTable.stripeCustomerId })
    .from(creatorHostingTable)
    .where(eq(creatorHostingTable.profileId, profileId))
    .limit(1);
  return hosting?.stripeCustomerId ?? null;
}

/** Insert the mapping; on a race, the winner's id is the one true id. */
async function persistCustomerId(userId: string, customerId: string): Promise<string> {
  await db
    .insert(userStripeCustomersTable)
    .values({ userId, stripeCustomerId: customerId })
    .onConflictDoNothing();
  return (await storedCustomerId(userId)) ?? customerId;
}

export async function getOrCreateStripeCustomerForUser(
  stripe: StripeCustomerClient,
  args: { userId: string; profileId?: string | null; email?: string | null },
): Promise<string> {
  let customerId = await storedCustomerId(args.userId);

  if (!customerId) {
    const legacy = await legacyCustomerId(args.profileId);
    if (legacy) {
      customerId = await persistCustomerId(args.userId, legacy);
      logger.info({ userId: args.userId, customerId }, "stripe customer: backfilled from legacy subscription row");
    }
  }

  if (customerId) {
    // Verify the stored customer still exists in Stripe. Deleted
    // customers would hard-fail checkout; replace exactly those.
    try {
      const existing = await stripe.customers.retrieve(customerId);
      if ((existing as { deleted?: boolean }).deleted) throw { code: "resource_missing" };
      return customerId;
    } catch (err) {
      if ((err as { code?: string })?.code !== "resource_missing") throw err;
      logger.warn({ userId: args.userId, customerId }, "stripe customer: stored customer missing in Stripe, replacing");
      const replacement = await stripe.customers.create({
        email: args.email ?? undefined,
        metadata: { user_id: args.userId },
      });
      await db
        .update(userStripeCustomersTable)
        .set({ stripeCustomerId: replacement.id, updatedAt: new Date() })
        .where(eq(userStripeCustomersTable.userId, args.userId));
      return replacement.id;
    }
  }

  const created = await stripe.customers.create({
    email: args.email ?? undefined,
    metadata: { user_id: args.userId },
  });
  const persisted = await persistCustomerId(args.userId, created.id);
  if (persisted !== created.id) {
    logger.warn(
      { userId: args.userId, created: created.id, persisted },
      "stripe customer: concurrent create won the mapping; orphan customer left unsubscribed",
    );
  }
  return persisted;
}
