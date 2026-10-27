import { Router } from "express";
import { z } from "zod";
import Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db, creatorSubscriptionsTable } from "@workspace/db";
import { publicApiLimiter } from "../lib/rate-limit";
import { requireAuth } from "../middlewares/require-auth";
import { logger } from "../lib/logger";
import { createGuardedStripeClient } from "../lib/stripe-client";
import {
  EMBEDDED_CHECKOUT_SOURCE,
  buildEmbeddedIntentIdempotencyKey,
  isEmbeddedCheckoutEnabled,
} from "../lib/embedded-checkout";
import {
  countCompletedCreditPurchases,
  fulfillCreditPurchase,
  getStripePaymentStatus,
} from "../lib/payment-record";
import { TIER_PLANS } from "../lib/platform-fees";
import { ensureProfile } from "./creator-tiers";

/* ── Embedded checkout (owner law 2026-10-26: never leave the site) ─────
   PaymentElement flows, TEST mode only (guarded client):

     POST /api/embedded-checkout/credit-pack/intent   { pack }
       -> { clientSecret, paymentIntentId, amount, currency, label }
     POST /api/embedded-checkout/credit-pack/verify   { paymentIntentId }
       -> fulfills Visual Bucs via fulfillCreditPurchase (insert-first
          claiming, keyed on the PI id — the SAME discipline the
          payment_intent.succeeded webhook branch uses for these PIs,
          so webhook + verify race to exactly one grant) + the
          exactly-once referral share.
     POST /api/embedded-checkout/subscription/intent  { tier }
       -> creates/reuses the Stripe customer + a subscription with
          payment_behavior="default_incomplete"; returns the first
          invoice PaymentIntent's client_secret for PaymentElement.
     POST /api/embedded-checkout/subscription/verify  { subscriptionId }
       -> when the subscription is active/trialing, syncs the tier via
          the existing handleTierSubscriptionEvent (the same upsert
          the customer.subscription.* webhook events run).

   The legacy hosted endpoints (POST /api/create-checkout-session,
   POST /api/creator-tiers/checkout) stay reachable as fallback only;
   EMBEDDED_CHECKOUT=off disables these routes with 404. */

const router = Router();

function getStripe(): Stripe {
  return createGuardedStripeClient();
}

function embeddedOff(res: import("express").Response): boolean {
  if (isEmbeddedCheckoutEnabled()) return false;
  res.status(404).json({ error: "Embedded checkout is not enabled." });
  return true;
}

/* Referral revenue share — exactly-once by construction
   (referral_payouts UNIQUE on the key), same helper shape as
   stripe-payments.ts / express-pay.ts. Keyed here on the PI id, the
   same key the webhook's embedded branch awards under. A referral
   failure never changes the buyer's answer. */
async function awardReferralShare(
  userId: string,
  creditsAmount: number,
  paymentIntentId: string,
): Promise<void> {
  try {
    const { awardReferralPayout } = await import("./referrals");
    await awardReferralPayout(userId, creditsAmount, paymentIntentId);
  } catch (err) {
    logger.error(
      { err, userId, paymentIntentId },
      "embedded-checkout/verify: referral award attempt failed (non-fatal)",
    );
  }
}

/* ── Credit packs ─────────────────────────────────────────────────────── */

const PACK_MAP: Record<string, { envKey: string; credits: number; label: string }> = {
  "10":  { envKey: "STRIPE_PRICE_10_CREDITS",  credits: 1000,  label: "1,000 Visual Bucs"  },
  "50":  { envKey: "STRIPE_PRICE_50_CREDITS",  credits: 5000,  label: "5,000 Visual Bucs"  },
  "150": { envKey: "STRIPE_PRICE_150_CREDITS", credits: 15000, label: "15,000 Visual Bucs" },
  "500": { envKey: "STRIPE_PRICE_500_CREDITS", credits: 50000, label: "50,000 Visual Bucs" },
};

const packIntentSchema = z.object({ pack: z.string().min(1).max(10) });

router.post("/embedded-checkout/credit-pack/intent", requireAuth, publicApiLimiter, async (req, res) => {
  if (embeddedOff(res)) return;
  const parsed = packIntentSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid pack" });
    return;
  }
  const packInfo = PACK_MAP[parsed.data.pack];
  if (!packInfo) {
    res.status(400).json({ error: "Invalid pack size. Must be 10, 50, 150, or 500." });
    return;
  }

  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch {
    res.status(501).json({ error: "Payments not configured. Please contact support." });
    return;
  }

  // Resolve the amount server-side from the Stripe Price — never the client.
  const priceId = process.env[packInfo.envKey];
  if (!priceId) {
    res.status(501).json({ error: `Price not configured for the ${packInfo.label} pack.` });
    return;
  }

  /* Idempotency (same discipline as the hosted session rail): before
     the grant lands, a double-submit sees the same completed count and
     Stripe reuses the original PI; after it lands, the count advances
     and a new purchase gets a fresh key. Fail closed if unreadable. */
  let completedPurchaseCount: number;
  try {
    completedPurchaseCount = await countCompletedCreditPurchases(req.userId!, packInfo.label);
  } catch (err) {
    logger.error({ err, userId: req.userId }, "embedded-checkout: purchase sequence read failed");
    res.status(500).json({ error: "Could not start checkout safely. Please try again." });
    return;
  }
  const idempotencyKey = buildEmbeddedIntentIdempotencyKey({
    memberId: req.userId!,
    rail: "credit-pack-embedded",
    purchaseIntent: { priceId, credits: packInfo.credits, completedPurchaseCount },
  });

  try {
    const price = await stripe.prices.retrieve(priceId);
    if (!price.unit_amount) {
      res.status(501).json({ error: "Price has no fixed amount." });
      return;
    }
    const paymentIntent = await stripe.paymentIntents.create({
      amount: price.unit_amount,
      currency: price.currency ?? "usd",
      description: packInfo.label,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      metadata: {
        source: EMBEDDED_CHECKOUT_SOURCE,
        kind: "credit_pack",
        user_id: req.userId!,
        credit_pack: packInfo.label,
        credits_amount: String(packInfo.credits),
        pack_key: parsed.data.pack,
      },
    }, { idempotencyKey });

    logger.info(
      { userId: req.userId, pack: packInfo.label, paymentIntentId: paymentIntent.id },
      "embedded-checkout: credit-pack PaymentIntent created",
    );
    res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: price.unit_amount,
      currency: price.currency ?? "usd",
      label: packInfo.label,
      credits: packInfo.credits,
    });
  } catch (err) {
    logger.error({ err }, "embedded-checkout: credit-pack intent creation failed");
    res.status(500).json({ error: "Payment processing failed" });
  }
});

const packVerifySchema = z.object({ paymentIntentId: z.string().min(1).max(100) });

router.post("/embedded-checkout/credit-pack/verify", requireAuth, publicApiLimiter, async (req, res) => {
  if (embeddedOff(res)) return;
  const parsed = packVerifySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid payment intent" });
    return;
  }

  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch {
    res.status(500).json({ error: "Stripe is not configured." });
    return;
  }

  let pi: Stripe.PaymentIntent;
  try {
    pi = await stripe.paymentIntents.retrieve(parsed.data.paymentIntentId);
  } catch {
    res.status(400).json({ error: "Could not retrieve this payment." });
    return;
  }
  if (pi.metadata?.["source"] !== EMBEDDED_CHECKOUT_SOURCE || pi.metadata?.["kind"] !== "credit_pack") {
    res.status(400).json({ error: "This payment isn't an embedded credit-pack purchase." });
    return;
  }
  if (pi.status !== "succeeded") {
    res.status(400).json({ error: "Payment has not been completed." });
    return;
  }
  if (pi.metadata?.["user_id"] !== req.userId) {
    logger.error({ metaUserId: pi.metadata?.["user_id"], reqUserId: req.userId }, "embedded-checkout/verify: user mismatch");
    res.status(403).json({ error: "Payment does not belong to this user." });
    return;
  }
  const creditsToAdd = parseInt(pi.metadata?.["credits_amount"] ?? "0", 10);
  const metaPack = pi.metadata?.["credit_pack"] ?? "";
  if (!creditsToAdd || creditsToAdd <= 0) {
    res.status(400).json({ error: "No valid Visual Buc amount found in this payment." });
    return;
  }

  try {
    const result = await fulfillCreditPurchase({
      idempotencyKey: pi.id,
      stripePaymentIntentId: pi.id,
      userId: req.userId!,
      creditPack: metaPack,
      creditsAmount: creditsToAdd,
      amountTotal: pi.amount,
      currency: pi.currency,
    });
    if (result.outcome === "duplicate") {
      await awardReferralShare(req.userId!, creditsToAdd, pi.id);
      res.json({ success: true, duplicate: true, added: creditsToAdd, pack: metaPack });
      return;
    }
    if (result.outcome === "inflight") {
      res.status(409).json({ error: "Payment is being processed. Please wait a moment and refresh." });
      return;
    }
    await awardReferralShare(req.userId!, creditsToAdd, pi.id);
    res.json({ success: true, credits: result.newCredits, added: creditsToAdd, pack: metaPack });
  } catch (err) {
    logger.error({ err, userId: req.userId }, "embedded-checkout/verify: credit grant failed");
    /* Reconcile before answering (same D6 discipline as the other
       verify rails): the webhook may have completed this payment
       while our grant attempt failed. */
    const status = await getStripePaymentStatus(pi.id).catch(() => null);
    if (status === "completed") {
      await awardReferralShare(req.userId!, creditsToAdd, pi.id);
      res.json({ success: true, duplicate: true, added: creditsToAdd, pack: metaPack });
      return;
    }
    res.status(500).json({
      error:
        "Your payment went through, but your Visual Bucs are still being applied. " +
        "They should appear within a few minutes — refresh your balance, and if they're still missing, contact support.",
    });
  }
});

/* ── Plan subscriptions (Creator Pro $12 / Elite $29) ─────────────────── */

const subIntentSchema = z.object({
  tier: z.enum(["pro", "elite"]),
});

router.post("/embedded-checkout/subscription/intent", requireAuth, publicApiLimiter, async (req, res) => {
  if (embeddedOff(res)) return;
  const parsed = subIntentSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Pick a tier: pro or elite.", details: parsed.error.issues });
    return;
  }
  const { tier } = parsed.data;
  const plan = TIER_PLANS.find((p) => p.tier === tier)!;
  const priceId = plan.priceIdEnv ? process.env[plan.priceIdEnv] : null;
  if (!priceId) {
    res.status(500).json({
      error: `Stripe price for the ${plan.name} tier isn't configured yet (${plan.priceIdEnv}). The owner adds it in Replit Secrets.`,
    });
    return;
  }

  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
    return;
  }

  let profileId: string;
  try {
    profileId = await ensureProfile(req.userId!, req.userEmail);
  } catch (err) {
    logger.error({ err }, "embedded-checkout: profile ensure failed");
    res.status(500).json({ error: "Couldn't set up your creator profile. Try again in a minute." });
    return;
  }

  /* Durable pre-purchase subscription state for the idempotency key
     (same discipline as the hosted tier checkout): a double-submit
     before activation sees the same state and reuses the original
     subscription instead of minting a second subscribable one. */
  let currentSub: { tier: string; status: string; currentPeriodEnd: Date | null; stripeSubscriptionId: string | null; stripeCustomerId: string | null } | null;
  try {
    const [row] = await db
      .select({
        tier: creatorSubscriptionsTable.tier,
        status: creatorSubscriptionsTable.status,
        currentPeriodEnd: creatorSubscriptionsTable.currentPeriodEnd,
        stripeSubscriptionId: creatorSubscriptionsTable.stripeSubscriptionId,
        stripeCustomerId: creatorSubscriptionsTable.stripeCustomerId,
      })
      .from(creatorSubscriptionsTable)
      .where(eq(creatorSubscriptionsTable.profileId, profileId))
      .limit(1);
    currentSub = row ?? null;
  } catch (err) {
    logger.error({ err, userId: req.userId }, "embedded-checkout: subscription state read failed");
    res.status(500).json({ error: "Couldn't start checkout safely. Try again in a minute." });
    return;
  }
  if (currentSub?.status === "active" || currentSub?.status === "trialing") {
    // Already subscribed on this rail — a second live subscription is
    // never the right answer; the client shows the manage/portal path.
    res.status(409).json({ error: "ALREADY_SUBSCRIBED", message: "You already have an active plan — manage it from your billing settings." });
    return;
  }
  const idempotencyKey = buildEmbeddedIntentIdempotencyKey({
    memberId: req.userId!,
    rail: "creator-tier-embedded",
    purchaseIntent: {
      tier,
      priceId,
      currentSubscription: currentSub
        ? { tier: currentSub.tier, status: currentSub.status, currentPeriodEnd: currentSub.currentPeriodEnd, stripeSubscriptionId: currentSub.stripeSubscriptionId }
        : null,
    },
  });

  try {
    let customerId = currentSub?.stripeCustomerId ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        ...(req.userEmail ? { email: req.userEmail } : {}),
        metadata: { kind: "creator_tier", user_id: req.userId!, profile_id: profileId },
      });
      customerId = customer.id;
    }

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      metadata: { kind: "creator_tier", tier, user_id: req.userId!, profile_id: profileId },
      expand: ["latest_invoice.payments"],
    }, { idempotencyKey });

    /* Current Stripe API: the invoice no longer carries a direct
       payment_intent — the PaymentElement secret is the invoice's
       confirmation_secret (a payment_intent client_secret), and the
       PI itself hangs off the invoice's default payment. */
    const invoice = subscription.latest_invoice;
    const invoiceObj = invoice && typeof invoice !== "string" ? invoice : null;
    const clientSecret = invoiceObj?.confirmation_secret?.client_secret ?? null;
    const defaultPayment = invoiceObj?.payments?.data?.find((p) => p.is_default) ?? invoiceObj?.payments?.data?.[0];
    const piRef = defaultPayment?.payment?.payment_intent;
    const paymentIntentId =
      (typeof piRef === "string" ? piRef : piRef?.id) ??
      (clientSecret ? clientSecret.split("_secret_")[0]! : null);
    if (!clientSecret || !paymentIntentId) {
      logger.error({ subscriptionId: subscription.id }, "embedded-checkout: subscription has no invoice confirmation secret");
      res.status(502).json({ error: "Stripe couldn't start checkout. Nothing was charged — try again." });
      return;
    }

    logger.info({ userId: req.userId, tier, subscriptionId: subscription.id }, "embedded-checkout: subscription created (incomplete)");
    res.json({
      success: true,
      clientSecret,
      subscriptionId: subscription.id,
      paymentIntentId,
      tier,
      amount: plan.priceUsdPerMonth != null ? plan.priceUsdPerMonth * 100 : (invoiceObj?.amount_due ?? 0),
      currency: "usd",
      label: `${plan.name} — $${plan.priceUsdPerMonth}/month`,
    });
  } catch (err) {
    const msg = (err as { message?: string })?.message ?? "unknown";
    logger.error({ err, msg }, "embedded-checkout: subscription creation failed");
    res.status(502).json({ error: `Stripe couldn't start checkout: ${msg}` });
  }
});

const subVerifySchema = z.object({ subscriptionId: z.string().min(1).max(100) });

router.post("/embedded-checkout/subscription/verify", requireAuth, publicApiLimiter, async (req, res) => {
  if (embeddedOff(res)) return;
  const parsed = subVerifySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "subscriptionId is required" });
    return;
  }

  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch {
    res.status(500).json({ error: "Stripe is not configured." });
    return;
  }

  let sub: Stripe.Subscription;
  try {
    sub = await stripe.subscriptions.retrieve(parsed.data.subscriptionId);
  } catch {
    res.status(400).json({ error: "Could not retrieve this subscription." });
    return;
  }
  if (sub.metadata?.["kind"] !== "creator_tier" || sub.metadata?.["user_id"] !== req.userId) {
    res.status(403).json({ error: "This subscription doesn't belong to you." });
    return;
  }
  if (sub.status !== "active" && sub.status !== "trialing") {
    res.status(400).json({ error: "Payment has not been completed.", status: sub.status });
    return;
  }

  /* Sync through the SAME upsert the customer.subscription.* webhook
     events run — idempotent, so verify + webhook landing in any order
     converges on one row. */
  try {
    const { handleTierSubscriptionEvent } = await import("../lib/creator-tier-sync");
    await handleTierSubscriptionEvent(sub);
  } catch (err) {
    logger.error({ err, subscriptionId: sub.id }, "embedded-checkout/subscription/verify: tier sync failed");
    res.status(500).json({
      error: "Your payment went through and your plan is active with Stripe — we're still applying it here. Refresh in a moment, and contact support if it doesn't appear.",
    });
    return;
  }
  res.json({ success: true, tier: sub.metadata?.["tier"] ?? null, status: sub.status });
});

export default router;
