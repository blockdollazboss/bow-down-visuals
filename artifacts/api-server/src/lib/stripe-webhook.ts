import Stripe from "stripe";
import type { Request, Response } from "express";
import { logger } from "./logger";
import { addCreditsToProfile, getSupabaseAdmin } from "./supabase-admin";
import { isPaymentAlreadyRecorded, recordStripePayment } from "./payment-record";
import { awardReferralPayout } from "../routes/referrals";

export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
  const secretKey = process.env["STRIPE_SECRET_KEY"];
  const webhookSecret = process.env["STRIPE_WEBHOOK_SECRET"];

  if (!secretKey) {
    logger.warn("Stripe webhook: STRIPE_SECRET_KEY not configured");
    res.status(200).json({ received: true, warning: "STRIPE_SECRET_KEY not configured" });
    return;
  }

  if (!webhookSecret) {
    logger.warn("Stripe webhook: STRIPE_WEBHOOK_SECRET not configured — cannot verify signature");
    res.status(200).json({ received: true, warning: "STRIPE_WEBHOOK_SECRET not configured" });
    return;
  }

  // Verify service role key is available before doing any work
  try {
    getSupabaseAdmin();
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message ?? "unknown";
    logger.error({ msg }, "Stripe webhook: Supabase admin client unavailable");
    res.status(200).json({ received: true, warning: msg });
    return;
  }

  const sig = req.headers["stripe-signature"];
  if (!sig) {
    res.status(400).json({ error: "Missing stripe-signature header" });
    return;
  }

  const sigStr = Array.isArray(sig) ? sig[0] : sig;
  const stripe = new Stripe(secretKey);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body as Buffer, sigStr, webhookSecret);
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message ?? "unknown";
    logger.error({ err, msg }, "Stripe webhook signature verification failed");
    res.status(400).json({ error: `Webhook signature verification failed: ${msg}` });
    return;
  }

  logger.info({ type: event.type }, "Stripe webhook: event received");

  /* ── Creator tier subscription events (Worker 12) ──────────────────────
     checkout.session.completed with metadata.kind === "creator_tier" activates
     the tier; customer.subscription.* keep status/period in sync;
     invoice.payment_failed flags past_due. All other kinds flow through the
     existing Visual Bucs logic below untouched. */
  try {
    if (event.type === "checkout.session.completed") {
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.metadata?.kind === "creator_tier") {
        const { handleTierCheckoutCompleted } = await import("./creator-tier-sync");
        await handleTierCheckoutCompleted(s);
        res.status(200).json({ received: true, kind: "creator_tier" });
        return;
      }
    } else if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const sub = event.data.object as Stripe.Subscription;
      if (sub.metadata?.kind === "creator_tier") {
        const { handleTierSubscriptionEvent } = await import("./creator-tier-sync");
        await handleTierSubscriptionEvent(sub);
        res.status(200).json({ received: true, kind: "creator_tier" });
        return;
      }
    } else if (event.type === "invoice.payment_failed") {
      const inv = event.data.object as Stripe.Invoice;
      const { handleTierInvoiceFailed } = await import("./creator-tier-sync");
      await handleTierInvoiceFailed(inv);
      res.status(200).json({ received: true, kind: "creator_tier" });
      return;
    } else if (event.type === "account.updated" || (event.type as string) === "v2.core.account.updated") {
      /* Stripe Connect: keep the creator profile's onboarding flags in sync
         with the Express account's capability state. v2 accounts emit
         v2.core.account.updated; the sync helper reads the v2 shape. */
      const acct = event.data.object as {
        id: string;
        configuration?: {
          recipient?: {
            capabilities?: { stripe_balance?: { stripe_transfers?: { status?: string } } };
          };
        };
        requirements?: { entries?: unknown[] };
      };
      const { syncConnectAccountStatus } = await import("./stripe-connect");
      await syncConnectAccountStatus(acct);
      res.status(200).json({ received: true, kind: "connect_account" });
      return;
    }
  } catch (err) {
    logger.error({ err, type: event.type }, "Stripe webhook: creator tier sync failed");
    // Fall through to the standard flow rather than 500ing Stripe's retry.
  }

  if (event.type !== "checkout.session.completed") {
    res.status(200).json({ received: true });
    return;
  }

  const session = event.data.object as Stripe.Checkout.Session;

  if (session.payment_status !== "paid") {
    logger.info({ sessionId: session.id, status: session.payment_status }, "Stripe webhook: session not paid, skipping");
    res.status(200).json({ received: true });
    return;
  }

  // ── IDEMPOTENCY CHECK ─────────────────────────────────────────────────────
  try {
    const alreadyProcessed = await isPaymentAlreadyRecorded(session.id);
    if (alreadyProcessed) {
      logger.info({ sessionId: session.id }, "Stripe webhook: duplicate payment ignored — already recorded");
      res.status(200).json({ received: true, duplicate: true });
      return;
    }
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message ?? "unknown";
    logger.error({ err, msg, sessionId: session.id }, "Stripe webhook: idempotency check failed");
    // Continue processing — better to double-credit than to silently fail
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── SPONSOR ESCROW ────────────────────────────────────────────────────
  // Brands fund sponsorship deals through Checkout with
  // metadata.sponsor_deal_id set. This path owns the money; it never
  // touches credits. Idempotency is handled inside markEscrowFunded.
  if (session.metadata?.sponsor_deal_id) {
    const dealId = session.metadata.sponsor_deal_id;
    logger.info({ dealId, sessionId: session.id }, "Stripe webhook: sponsor escrow payment verified");
    try {
      const { markEscrowFunded } = await import("../routes/generate/sponsors");
      const result = await markEscrowFunded(
        dealId,
        session.id,
        typeof session.payment_intent === "string" ? session.payment_intent : null,
      );
      if (!result.ok) {
        logger.warn({ dealId, reason: result.reason }, "Stripe webhook: escrow funding not applied");
        res.status(200).json({ received: true, warning: `Escrow not applied: ${result.reason}` });
        return;
      }
      res.status(200).json({ received: true, success: true, escrow: "funded" });
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? "unknown";
      logger.error({ err, msg, dealId }, "Stripe webhook: escrow funding failed");
      res.status(200).json({ received: true, warning: `Escrow funding failed: ${msg}` });
    }
    return;
  }
  // ─────────────────────────────────────────────────────────────────────────

  const userId = session.metadata?.user_id;
  const creditPack = session.metadata?.credit_pack ?? "unknown";
  const creditsAmount = parseInt(session.metadata?.credits_amount ?? "0", 10);

  logger.info({ userId, creditPack, creditsAmount, sessionId: session.id }, "Stripe webhook: payment verified");

  if (!userId) {
    logger.error({ sessionId: session.id }, "Stripe webhook: missing user_id in session metadata");
    res.status(200).json({ received: true, warning: "Missing user_id in metadata" });
    return;
  }

  logger.info({ userId }, "Stripe webhook: user_id found");

  /* ── Branding-shop merch orders ─────────────────────────────────────────
     Branding checkout sessions carry metadata.kind = "branding_order" +
     branding_order_id. Mark the order paid and submit it to fulfillment
     (Printful live or mock sandbox). Idempotent via isPaymentAlreadyRecorded. */
  if (session.metadata?.kind === "branding_order" && session.metadata?.branding_order_id) {
    const brandingOrderId = session.metadata.branding_order_id;
    try {
      const { markBrandingOrderPaid, fulfillBrandingOrder, confirmBrandingFulfillment } = await import("./branding-fulfillment");
      await markBrandingOrderPaid(brandingOrderId, session.id);
      const fulfillment = await fulfillBrandingOrder(brandingOrderId);
      await confirmBrandingFulfillment(brandingOrderId);
      logger.info(
        { brandingOrderId, sessionId: session.id, fulfillment },
        "Stripe webhook: branding order paid + submitted to fulfillment"
      );
      await recordStripePayment({
        stripeSessionId:      session.id,
        stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
        userId,
        creditPack:           `branding_order:${brandingOrderId}`,
        creditsAmount:         0,
        amountTotal:  session.amount_total,
        currency:     session.currency,
      });
      res.status(200).json({ received: true, success: true, brandingOrderId });
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? "unknown";
      logger.error({ err, msg, brandingOrderId }, "Stripe webhook: branding order fulfillment failed");
      res.status(200).json({ received: true, warning: `Branding fulfillment failed: ${msg}` });
    }
    return;
  }

  if (!creditsAmount || creditsAmount <= 0) {
    logger.error({ sessionId: session.id, creditsAmount }, "Stripe webhook: invalid credits_amount in metadata");
    res.status(200).json({ received: true, warning: "Invalid credits_amount in metadata" });
    return;
  }

  logger.info({ creditsAmount }, "Stripe webhook: credits_amount found");

  try {
    const { oldCredits, newCredits, created } = await addCreditsToProfile(userId, creditsAmount);
    logger.info(
      { userId, creditPack, creditsAmount, oldCredits, newCredits, created, sessionId: session.id },
      "Stripe webhook: credits added successfully"
    );

    // Record the payment to prevent future duplicates
    await recordStripePayment({
      stripeSessionId:      session.id,
      stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
      userId,
      creditPack,
      creditsAmount,
      amountTotal:  session.amount_total,
      currency:     session.currency,
    });

    // Referral revenue share: 25% of purchased credits to the referrer
    // (idempotent — retried webhooks can't double-pay).
    const referralAwarded = await awardReferralPayout(userId, creditsAmount, session.id);

    res.status(200).json({ received: true, success: true, credits: newCredits, referralAwarded });
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message ?? "unknown";
    logger.error({ err, msg, userId, creditsAmount }, "Stripe webhook: credit update failed");
    res.status(200).json({ received: true, warning: `Credit update failed: ${msg}` });
  }
}
