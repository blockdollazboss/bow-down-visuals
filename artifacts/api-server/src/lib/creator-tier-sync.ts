import Stripe from "stripe";
import { db, creatorProfilesTable, creatorSubscriptionsTable, creatorHostingTable, creatorSubscriptionReceiptsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "./logger";
import { CREATOR_TIERS, type CreatorTier } from "./platform-fees";
import { sendEmail, emailShell, emailButton, escapeHtml, baseUrlForEmail } from "./email";
import { createGuardedStripeClient } from "./stripe-client";
import { notifyUserEvent, type UserEventInput } from "./push-events";

/* ── Creator tier subscription sync — Worker 12 ────────────────────────────
   Called from the central Stripe webhook (lib/stripe-webhook.ts). Handles:
     checkout.session.completed  (metadata.kind === "creator_tier")
     customer.subscription.updated
     customer.subscription.deleted
     invoice.payment_failed
   All writes are idempotent (upsert on profile_id). Real-money copy only —
   Visual Bucs are never mentioned here.                                   */

function getStripe(): Stripe {
  return createGuardedStripeClient();
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

/* ── Visible receipt/history rows (payfix upgrade-path, task 4) ────────
   Pass 1 found NO receipt anywhere for a paid subscription. Every
   lifecycle transition writes exactly one row to
   creator_subscription_receipts; idempotency_key is UNIQUE and the
   insert is ON CONFLICT DO NOTHING, so a replayed webhook delivery
   can never duplicate a receipt. Best-effort: a receipt failure must
   never roll back the entitlement sync itself. */
/* ── Plan-landed push (push wiring #5) ───────────────────────────────────
   A paid plan moment (subscribed / renewed / tier_changed to a paid
   tier) confirms to the buyer on their devices: you bought it, it
   landed. Exactly-once comes from the receipt row itself — its
   idempotency_key is UNIQUE and the insert is ON CONFLICT DO NOTHING,
   so only a receipt that actually LANDS fires; a replayed webhook can
   never re-ping. Bad-news kinds (payment_failed, canceled,
   status_changed) deliberately do not ride this rail. */
const PLAN_LANDED_KINDS: ReadonlySet<string> = new Set(["subscribed", "renewed", "tier_changed"]);

export function planLandedCopy(kind: string, tier: string | null | undefined): { title: string; body: string } | null {
  if (!PLAN_LANDED_KINDS.has(kind)) return null;
  if (!tier || tier === "free") return null;
  const name = tier.charAt(0).toUpperCase() + tier.slice(1);
  switch (kind) {
    case "subscribed":
      return {
        title: `Your ${name} plan is live 👑`,
        body: "Payment confirmed — your plan is active and everything it unlocks is ready in your studio.",
      };
    case "renewed":
      return {
        title: `Your ${name} plan renewed 👑`,
        body: "Your renewal payment landed — your plan rolls on without a gap.",
      };
    case "tier_changed":
      return {
        title: `Your plan is now ${name} 👑`,
        body: "The switch is done — same subscription, new tier, effective right away.",
      };
    default:
      return null;
  }
}

type TierEventNotifier = (input: UserEventInput) => Promise<unknown>;
let _tierEventNotifier: TierEventNotifier = notifyUserEvent;
/** Test seam — never used outside tests. */
export function __setTierEventNotifier(fn: TierEventNotifier | null): void {
  _tierEventNotifier = fn ?? notifyUserEvent;
}

export interface PlanLandedDeps {
  readUserId: (profileId: string) => Promise<string | null>;
  notify: TierEventNotifier;
}

const realPlanLandedDeps: PlanLandedDeps = {
  readUserId: async (profileId) => {
    const [row] = await db
      .select({ userId: creatorProfilesTable.userId })
      .from(creatorProfilesTable)
      .where(eq(creatorProfilesTable.id, profileId))
      .limit(1);
    return row?.userId ?? null;
  },
  notify: (input) => _tierEventNotifier(input),
};

/** Fire the plan-landed event for a receipt that just landed.
 *  Best-effort: never throws into the entitlement sync. */
export async function maybeNotifyPlanLanded(
  values: { profileId: string; kind: string; tier?: string | null },
  deps: PlanLandedDeps = realPlanLandedDeps,
): Promise<boolean> {
  const copy = planLandedCopy(values.kind, values.tier);
  if (!copy) return false;
  try {
    const userId = await deps.readUserId(values.profileId);
    if (!userId) return false;
    await deps.notify({
      userId,
      category: "money",
      kind: `plan_${values.kind}`,
      title: copy.title,
      body: copy.body,
      link: "/settings",
    });
    return true;
  } catch (err) {
    logger.warn({ err, profileId: values.profileId, kind: values.kind }, "tier-sync: plan-landed notification failed (non-fatal)");
    return false;
  }
}

export async function recordSubscriptionReceipt(values: {
  profileId: string;
  kind: string;
  tier?: string | null;
  status?: string | null;
  amountCents?: number | null;
  currency?: string | null;
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
  stripeObjectId?: string | null;
  idempotencyKey: string;
}): Promise<void> {
  try {
    const landed = await db
      .insert(creatorSubscriptionReceiptsTable)
      .values({
        profileId: values.profileId,
        kind: values.kind,
        tier: values.tier ?? null,
        status: values.status ?? null,
        amountCents: values.amountCents ?? null,
        currency: values.currency ?? null,
        stripeSubscriptionId: values.stripeSubscriptionId ?? null,
        stripeCustomerId: values.stripeCustomerId ?? null,
        stripeObjectId: values.stripeObjectId ?? null,
        idempotencyKey: values.idempotencyKey,
      })
      .onConflictDoNothing()
      .returning();
    /* Push wiring #5: only a receipt that LANDS fires the buyer's
       confirmation — a replayed webhook's duplicate insert lands
       nothing and pings nothing. */
    if (landed[0]) {
      await maybeNotifyPlanLanded(values);
    }
  } catch (err) {
    logger.warn({ err, kind: values.kind }, "subscription receipt write failed (non-fatal)");
  }
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
  await recordSubscriptionReceipt({
    profileId,
    kind: "subscribed",
    tier,
    status: "active",
    amountCents: session.amount_total ?? null,
    currency: session.currency ?? null,
    stripeSubscriptionId: subId ?? null,
    stripeCustomerId: customerId,
    stripeObjectId: session.id,
    idempotencyKey: `checkout:${session.id}`,
  });
  logger.info({ sessionId: session.id, profileId, tier }, "creator tier activated via webhook");

  /* ── Subscription confirmation email — best-effort, fail-open. The tier is
     already active; an email failure must never roll that back. ────────── */
  try {
    const buyerEmail =
      session.customer_details?.email ??
      (await db.execute(sql`SELECT email FROM profiles WHERE id = ${session.metadata?.["user_id"]} LIMIT 1`))
        .rows[0]?.["email"];
    if (typeof buyerEmail === "string" && buyerEmail.length > 0) {
      const tierName = tier.charAt(0).toUpperCase() + tier.slice(1);
      const html = emailShell(
        `Welcome to ${tierName}`,
        `<p style="margin:0 0 12px;">Your <strong style="color:#a67c1a;">${escapeHtml(tierName)}</strong> creator subscription is active. The full cheat code is now unlocked:</p>
<ul style="font-size:14px;line-height:1.8;margin:0 0 16px;padding-left:20px;">
<li>One flat 5% platform fee on everything you sell</li>
<li>Higher AI generation limits across the studio</li>
<li>Priority placement in discovery and charts</li>
</ul>
${currentPeriodEnd ? `<p style="color:#8a7c5c;font-size:13px;">Renews ${currentPeriodEnd.toLocaleDateString()} — cancel anytime from your dashboard.</p>` : ""}
${emailButton(`${baseUrlForEmail()}/dashboard`, "Open my dashboard")}`
      );
      // Fire-and-forget: webhook must return 200 to Stripe promptly.
      void sendEmail({ to: buyerEmail, subject: `Welcome to ${tierName} — your subscription is active`, html });
    }
  } catch (emailErr) {
    logger.warn({ emailErr, sessionId: session.id }, "tier confirmation email failed (non-fatal)");
  }
}

/** customer.subscription.updated / .deleted — keep tier + status in sync. */
export async function handleTierSubscriptionEvent(subscription: Stripe.Subscription, eventId?: string): Promise<void> {
  const stripe = getStripe();
  const customerId = typeof subscription.customer === "string" ? subscription.customer : null;
  const priceId = subscription.items.data[0]?.price?.id ?? null;
  const tier =
    validTier(subscription.metadata?.["tier"])
      ? (subscription.metadata!["tier"] as CreatorTier)
      : priceIdToTier(priceId);
  /* Resolve the profile from the subscription's OWN stamped user_id
     first (the intent/checkout rails stamp it at creation — the same
     metadata the hosted checkout handler trusts), falling back to the
     customer lookup. Resolving by customer alone silently dropped the
     sync for a profile with no creator_subscriptions row yet — a
     first-time embedded subscriber's verify landed nothing while the
     verify route still answered success (Gate #4 diagnosis). */
  const profileId = await profileIdForCustomer(stripe, {
    userId: subscription.metadata?.["user_id"],
    customerId,
  });
  if (!profileId) {
    logger.warn({ subId: subscription.id }, "subscription event: no creator profile for customer");
    return;
  }
  const status = subscription.status; // active | trialing | past_due | canceled | incomplete…
  const [prior] = await db
    .select({
      tier: creatorSubscriptionsTable.tier,
      status: creatorSubscriptionsTable.status,
      stripeSubscriptionId: creatorSubscriptionsTable.stripeSubscriptionId,
    })
    .from(creatorSubscriptionsTable)
    .where(eq(creatorSubscriptionsTable.profileId, profileId))
    .limit(1);
  /* ── Current-subscription guard (Gate #4, stack600 regression) ──────
     The profile has ONE row, but the customer can carry SEVERAL
     creator_tier subscriptions over time (Gate #2's dangling
     incomplete, Gate #3's ended plan, today's new one). This handler
     used to upsert ANY of their events into the row — tier, status
     AND stripe_subscription_id — resolved by customer alone. The
     stack600 intent hygiene (adoptDanglingSubscription) cancels the
     member's dangling incomplete subscriptions DURING subscribe,
     seconds before the verify sync lands the new tier; Stripe
     delivers the resulting customer.subscription.deleted
     asynchronously, and when it lands AFTER the verify upsert it
     rewrites the row to the dead subscription (status canceled →
     the account reads Free, Billing points at a corpse). No event
     ordering is guaranteed, so identity — not timing — is the guard:
       · same subscription as the row records → apply (its lifecycle);
       · a DIFFERENT subscription may write only to adopt a dead row
         when it is itself live (the closed-tab rescue: the purchase
         webhook arrives before any verify ran);
       · every other foreign-subscription event is ignored — a dead
         or stale subscription can never move the row, and a foreign
         live one can never clobber the current live plan. */
  if (prior?.stripeSubscriptionId && prior.stripeSubscriptionId !== subscription.id) {
    const rowLive = prior.status === "active" || prior.status === "trialing";
    const eventLive = status === "active" || status === "trialing";
    if (rowLive || !eventLive) {
      logger.warn(
        {
          subId: subscription.id,
          profileId,
          rowSubscriptionId: prior.stripeSubscriptionId,
          rowStatus: prior.status,
          eventStatus: status,
        },
        "subscription event ignored: not the profile's current subscription",
      );
      return;
    }
  }
  await upsertSubscription({
    profileId,
    tier: tier ?? "free",
    status,
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: customerId,
    currentPeriodEnd: periodEndOf(subscription),
    cancelAtPeriodEnd: cancelAtOf(subscription),
  });
  /* Receipt only for a real transition (tier or status actually
     changed) — routine subscription.updated noise writes nothing. */
  const nextTier = tier ?? "free";
  const tierChanged = !!prior && prior.tier !== nextTier;
  const statusChanged = !!prior && prior.status !== status;
  if (tierChanged || statusChanged) {
    const kind = status === "canceled" ? "canceled" : tierChanged ? "tier_changed" : "status_changed";
    await recordSubscriptionReceipt({
      profileId,
      kind,
      tier: nextTier,
      status,
      stripeSubscriptionId: subscription.id,
      stripeCustomerId: customerId,
      stripeObjectId: subscription.id,
      idempotencyKey: eventId
        ? `evt:${eventId}`
        : `sub:${subscription.id}:${nextTier}:${status}:${periodEndOf(subscription)?.toISOString() ?? ""}`,
    });
  }
  logger.info({ subId: subscription.id, profileId, tier, status }, "creator tier synced from subscription event");
}

/** invoice.payment_failed — flag the row so gating degrades honestly.
    Scoped to the invoice's OWN subscription (Gate #4 sibling): this
    handler used to mark BOTH the tier row and the hosting row past_due
    BY CUSTOMER for every failed invoice the webhook received — a
    failed invoice for a different subscription on the same customer
    (a dangling sub's retry, the member's other plan) degraded the
    live plan, and a tier failure falsely degraded hosting too. The
    scope check mirrors handleTierInvoicePaid below exactly: extract
    the invoice's subscription the same way, and skip a row only when
    BOTH ids are known and differ — unknowable identity (invoice
    carries no subscription, row records none) keeps the legacy
    by-customer behavior, the same non-trigger the tier guard uses. */
export async function handleTierInvoiceFailed(invoice: Stripe.Invoice): Promise<void> {
  const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
  if (!customerId) return;
  const invSubId =
    typeof (invoice as unknown as { subscription?: unknown }).subscription === "string"
      ? ((invoice as unknown as { subscription: string }).subscription)
      : null;
  const [subRow] = await db
    .select({
      profileId: creatorSubscriptionsTable.profileId,
      tier: creatorSubscriptionsTable.tier,
      stripeSubscriptionId: creatorSubscriptionsTable.stripeSubscriptionId,
    })
    .from(creatorSubscriptionsTable)
    .where(eq(creatorSubscriptionsTable.stripeCustomerId, customerId))
    .limit(1);
  const [hostingRow] = await db
    .select({
      profileId: creatorHostingTable.profileId,
      stripeSubscriptionId: creatorHostingTable.stripeSubscriptionId,
    })
    .from(creatorHostingTable)
    .where(eq(creatorHostingTable.stripeCustomerId, customerId))
    .limit(1);
  const foreignTo = (rowSubscriptionId: string | null | undefined): boolean =>
    !!(invSubId && rowSubscriptionId && invSubId !== rowSubscriptionId);
  if (subRow && foreignTo(subRow.stripeSubscriptionId)) {
    logger.warn(
      {
        invoiceId: invoice.id,
        invSubId,
        rowSubscriptionId: subRow.stripeSubscriptionId,
        customerId,
      },
      "invoice.payment_failed ignored for tier row: invoice belongs to a different subscription",
    );
  }
  let tierMarked = false;
  if (subRow && !foreignTo(subRow.stripeSubscriptionId)) {
    await db
      .update(creatorSubscriptionsTable)
      .set({ status: "past_due", updatedAt: new Date() })
      .where(eq(creatorSubscriptionsTable.profileId, subRow.profileId));
    await recordSubscriptionReceipt({
      profileId: subRow.profileId,
      kind: "payment_failed",
      tier: subRow.tier,
      status: "past_due",
      amountCents: invoice.amount_due ?? null,
      currency: invoice.currency ?? null,
      stripeSubscriptionId: subRow.stripeSubscriptionId,
      stripeCustomerId: customerId,
      stripeObjectId: invoice.id,
      idempotencyKey: `invoice_failed:${invoice.id}`,
    });
    tierMarked = true;
  }
  if (hostingRow && !foreignTo(hostingRow.stripeSubscriptionId)) {
    await db
      .update(creatorHostingTable)
      .set({ status: "past_due", updatedAt: new Date() })
      .where(eq(creatorHostingTable.profileId, hostingRow.profileId));
  }
  if (tierMarked) {
    logger.info({ customerId }, "creator tier marked past_due after failed invoice");
  }
}

/** invoice.paid — the recurring renewal receipt, exactly once per invoice.
    Only invoices for THE recorded tier subscription count (the same
    customer may also carry a Hosting subscription on a separate sub). */
export async function handleTierInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const customerId = typeof invoice.customer === "string" ? invoice.customer : null;
  if (!customerId) return;
  const invSubId =
    typeof (invoice as unknown as { subscription?: unknown }).subscription === "string"
      ? ((invoice as unknown as { subscription: string }).subscription)
      : null;
  const [subRow] = await db
    .select({
      profileId: creatorSubscriptionsTable.profileId,
      tier: creatorSubscriptionsTable.tier,
      stripeSubscriptionId: creatorSubscriptionsTable.stripeSubscriptionId,
    })
    .from(creatorSubscriptionsTable)
    .where(eq(creatorSubscriptionsTable.stripeCustomerId, customerId))
    .limit(1);
  if (!subRow) return;
  if (invSubId && subRow.stripeSubscriptionId && invSubId !== subRow.stripeSubscriptionId) return;
  // The first invoice of a brand-new subscription is already receipted
  // by the checkout handler ('subscribed'); renewals are billing_reason
  // subscription_cycle / subscription_update (proration invoices).
  const reason = (invoice as unknown as { billing_reason?: string | null }).billing_reason ?? null;
  if (reason === "subscription_create") return;
  await recordSubscriptionReceipt({
    profileId: subRow.profileId,
    kind: reason === "subscription_update" ? "tier_changed" : "renewed",
    tier: subRow.tier,
    status: "active",
    amountCents: invoice.amount_paid ?? null,
    currency: invoice.currency ?? null,
    stripeSubscriptionId: subRow.stripeSubscriptionId,
    stripeCustomerId: customerId,
    stripeObjectId: invoice.id,
    idempotencyKey: `invoice_paid:${invoice.id}`,
  });
  logger.info({ customerId, invoiceId: invoice.id }, "creator tier renewal receipt recorded");
}

/* ── Hosting plan sync (Stack 3, item 8) ──────────────────────────────────
   checkout.session.completed / customer.subscription.* with
   metadata.kind === "creator_hosting" land in creator_hosting (one row
   per profile, upserted) — the entitlement the branding rule reads.
   Idempotent, same discipline as the tier sync above.                 */

async function upsertHosting(values: {
  profileId: string;
  status: string;
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
  currentPeriodEnd?: Date | null;
  cancelAtPeriodEnd?: Date | null;
}): Promise<void> {
  const now = new Date();
  await db.execute(sql`
      INSERT INTO creator_hosting
        (profile_id, status, stripe_subscription_id, stripe_customer_id,
         current_period_end, cancel_at_period_end, created_at, updated_at)
      VALUES (${values.profileId}, ${values.status},
              ${values.stripeSubscriptionId ?? null}, ${values.stripeCustomerId ?? null},
              ${values.currentPeriodEnd ?? null}, ${values.cancelAtPeriodEnd ?? null},
              ${now}, ${now})
      ON CONFLICT (profile_id) DO UPDATE SET
        status = EXCLUDED.status,
        stripe_subscription_id = COALESCE(EXCLUDED.stripe_subscription_id, creator_hosting.stripe_subscription_id),
        stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, creator_hosting.stripe_customer_id),
        current_period_end = COALESCE(EXCLUDED.current_period_end, creator_hosting.current_period_end),
        cancel_at_period_end = EXCLUDED.cancel_at_period_end,
        updated_at = EXCLUDED.updated_at
    `);
}

async function profileIdForHostingCustomer(customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const [h] = await db
    .select({ profileId: creatorHostingTable.profileId })
    .from(creatorHostingTable)
    .where(eq(creatorHostingTable.stripeCustomerId, customerId))
    .limit(1);
  if (h) return h.profileId;
  const [s] = await db
    .select({ profileId: creatorSubscriptionsTable.profileId })
    .from(creatorSubscriptionsTable)
    .where(eq(creatorSubscriptionsTable.stripeCustomerId, customerId))
    .limit(1);
  return s?.profileId ?? null;
}

/** checkout.session.completed with metadata.kind === "creator_hosting". */
export async function handleHostingCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const stripe = getStripe();
  const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
  let currentPeriodEnd: Date | null = null;
  let customerId: string | null = typeof session.customer === "string" ? session.customer : null;
  if (subId) {
    const sub = await stripe.subscriptions.retrieve(subId);
    currentPeriodEnd = periodEndOf(sub);
    if (!customerId && typeof sub.customer === "string") customerId = sub.customer;
  }
  const metaProfileId = session.metadata?.["profile_id"];
  const profileId =
    (typeof metaProfileId === "string" && metaProfileId ? metaProfileId : null) ??
    (await profileIdForCustomer(stripe, { userId: session.metadata?.["user_id"], customerId }));
  if (!profileId) {
    logger.warn({ sessionId: session.id }, "hosting checkout: no creator profile for buyer — cannot attach entitlement");
    return;
  }
  await upsertHosting({
    profileId,
    status: "active",
    stripeSubscriptionId: subId ?? null,
    stripeCustomerId: customerId,
    currentPeriodEnd,
  });
  logger.info({ sessionId: session.id, profileId }, "hosting entitlement activated via webhook");
}

/** customer.subscription.updated / .deleted for a Hosting subscription. */
export async function handleHostingSubscriptionEvent(subscription: Stripe.Subscription): Promise<void> {
  const customerId = typeof subscription.customer === "string" ? subscription.customer : null;
  const metaProfileId = subscription.metadata?.["profile_id"];
  const profileId =
    (typeof metaProfileId === "string" && metaProfileId ? metaProfileId : null) ??
    (await profileIdForHostingCustomer(customerId));
  if (!profileId) {
    logger.warn({ subId: subscription.id }, "hosting subscription event: no creator profile for customer");
    return;
  }
  const [prior] = await db
    .select({
      status: creatorHostingTable.status,
      stripeSubscriptionId: creatorHostingTable.stripeSubscriptionId,
    })
    .from(creatorHostingTable)
    .where(eq(creatorHostingTable.profileId, profileId))
    .limit(1);
  /* ── Current-subscription guard (Gate #4 sibling — same discipline
     as handleTierSubscriptionEvent's guard in b3e5943be) ─────────────
     The hosting row is the same single-row upsert: one row per
     profile, but a profile can carry SEVERAL hosting subscriptions
     over time (an abandoned purchase, a re-buy). Resolving by the
     stamped profile_id narrows the event to the right profile but
     does not stop one hosting sub's event from overwriting another
     hosting sub's row — a late customer.subscription.deleted for a
     dead dangling hosting sub would rewrite a live entitlement to
     canceled exactly the way the tier corpse reverted Gate #4's Pro.
     Identity — not timing — is the guard, with the same semantics:
       · same subscription as the row records → apply (its lifecycle);
       · a DIFFERENT subscription may write only to adopt a dead row
         when it is itself live (the closed-tab rescue);
       · every other foreign-subscription event is ignored. */
  if (prior?.stripeSubscriptionId && prior.stripeSubscriptionId !== subscription.id) {
    const rowLive = prior.status === "active" || prior.status === "trialing";
    const eventLive = subscription.status === "active" || subscription.status === "trialing";
    if (rowLive || !eventLive) {
      logger.warn(
        {
          subId: subscription.id,
          profileId,
          rowSubscriptionId: prior.stripeSubscriptionId,
          rowStatus: prior.status,
          eventStatus: subscription.status,
        },
        "hosting subscription event ignored: not the profile's current subscription",
      );
      return;
    }
  }
  await upsertHosting({
    profileId,
    status: subscription.status,
    stripeSubscriptionId: subscription.id,
    stripeCustomerId: customerId,
    currentPeriodEnd: periodEndOf(subscription),
    cancelAtPeriodEnd: cancelAtOf(subscription),
  });
  logger.info({ subId: subscription.id, profileId, status: subscription.status }, "hosting entitlement synced from subscription event");
}
