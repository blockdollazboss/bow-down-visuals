import Stripe from "stripe";
import type { Request, Response } from "express";
import { logger } from "./logger";
import { getSupabaseAdmin } from "./supabase-admin";
import {
  claimStripePayment,
  markPaymentCompleted,
  markPaymentFailed,
  fulfillCreditPurchase,
  type PaymentClaimOutcome,
} from "./payment-record";
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
      /* Marketplace shop purchases (0144): the order already exists as
         pending_sale rows keyed on the session id; a paid session flips
         them to sales via the same guarded flip the verify endpoint
         runs, so webhook replays and verify+webhook races land once.
         The amount must match the order's server-computed gross — a
         mismatched session never fulfils. */
      if (s.metadata?.type === "marketplace_shop_purchase") {
        if (s.payment_status === "paid") {
          const { fetchMarketSaleBySession, markMarketSalePaid } = await import("./market-sale");
          const rows = await fetchMarketSaleBySession(s.id);
          const expected = rows.reduce((sum, r) => sum + Number(r.amount_cents), 0);
          if (rows.length > 0 && (s.amount_total ?? 0) === expected) {
            await markMarketSalePaid(s.id);
          } else {
            logger.warn({ sessionId: s.id, rows: rows.length, amountTotal: s.amount_total, expected }, "Stripe webhook: marketplace sale not applied (no pending order or amount mismatch)");
          }
        }
        res.status(200).json({ received: true, kind: "marketplace_shop_purchase" });
        return;
      }
      if (s.metadata?.kind === "creator_tier") {
        const { handleTierCheckoutCompleted } = await import("./creator-tier-sync");
        await handleTierCheckoutCompleted(s);
        res.status(200).json({ received: true, kind: "creator_tier" });
        return;
      }
      if (s.metadata?.kind === "creator_hosting") {
        const { handleHostingCheckoutCompleted } = await import("./creator-tier-sync");
        await handleHostingCheckoutCompleted(s);
        res.status(200).json({ received: true, kind: "creator_hosting" });
        return;
      }
    } else if (event.type === "checkout.session.expired") {
      /* An abandoned Marketplace checkout: label its pending lines
         expired — they never become sales (0144). */
      const s = event.data.object as Stripe.Checkout.Session;
      if (s.metadata?.type === "marketplace_shop_purchase") {
        const { markMarketSaleExpired } = await import("./market-sale");
        await markMarketSaleExpired(s.id);
        res.status(200).json({ received: true, kind: "marketplace_shop_purchase", expired: true });
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
      if (sub.metadata?.kind === "creator_hosting") {
        const { handleHostingSubscriptionEvent } = await import("./creator-tier-sync");
        await handleHostingSubscriptionEvent(sub);
        res.status(200).json({ received: true, kind: "creator_hosting" });
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

  if (event.type === "payment_intent.succeeded") {
    /* ── Express Pay (Apple Pay / Google Pay) ─────────────────────────────
       P0-8: previously fulfillment depended solely on the client calling
       /payments/express/verify. If the tab closed after the charge, money
       was taken but no credits were granted. This webhook branch grants
       server-side, sharing idempotency with /verify via the PI id. */
    const pi = event.data.object as Stripe.PaymentIntent;
    if (pi.metadata?.source !== "express_pay") {
      res.status(200).json({ received: true });
      return;
    }
    const userId = pi.metadata?.user_id;
    const creditsAmount = parseInt(pi.metadata?.credits_amount ?? "0", 10);
    const creditPack = pi.metadata?.credit_pack ?? "express";
    if (!userId || !creditsAmount || creditsAmount <= 0) {
      logger.error({ piId: pi.id }, "Stripe webhook: express_pay PI missing user_id/credits_amount");
      res.status(200).json({ received: true, warning: "Invalid express_pay metadata" });
      return;
    }
    try {
      const result = await fulfillCreditPurchase({
        idempotencyKey: pi.id,
        stripePaymentIntentId: pi.id,
        userId,
        creditPack,
        creditsAmount,
        amountTotal: pi.amount,
        currency: pi.currency,
      });
      if (result.outcome === "duplicate") {
        res.status(200).json({ received: true, duplicate: true });
        return;
      }
      if (result.outcome === "inflight") {
        // Another worker is granting — 500 so Stripe retries after it settles.
        res.status(500).json({ error: "Grant in flight, retry later" });
        return;
      }
      await awardReferralPayout(userId, creditsAmount, pi.id);
      res.status(200).json({ received: true, success: true, credits: result.newCredits });
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? "unknown";
      logger.error({ err, msg, piId: pi.id, userId }, "Stripe webhook: express_pay grant failed");
      // 500 → Stripe retries. fulfillCreditPurchase marked the row failed.
      res.status(500).json({ error: `Express grant failed: ${msg}` });
    }
    return;
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

  // ── IDEMPOTENCY: insert-first claiming (see claimStripePayment) ──────────
  // The old check-then-insert had a race: webhook + dashboard verify could
  // both pass the check and double-grant. Claiming is now done atomically
  // inside fulfillCreditPurchase() below. No pre-check here.
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
      // P0-7: 500 so Stripe retries — 200 would silently drop a paid escrow.
      res.status(500).json({ error: `Escrow funding failed: ${msg}` });
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
     (Printful live or mock sandbox).

     Idempotency: insert-first claiming on stripe_payments, the same
     pattern as the credit path below (P0-24 hardening). The payment row
     is claimed BEFORE any fulfillment, keyed on the session id (UNIQUE),
     with the same values the old trailing recordStripePayment() wrote.
     Previously this branch fulfilled FIRST and recorded LAST, and its
     only duplicate guard was fulfillBrandingOrder's check-then-act on
     provider_order_id: concurrent redeliveries could both pass that
     check and submit two real provider orders, and sequential
     redeliveries re-ran confirmBrandingFulfillment (an unconditional
     provider confirm POST) and then threw on the payment insert's
     UNIQUE constraint — a 500 loop, not a no-op. Now: only the claim
     winner fulfills; a completed claim → 200 duplicate; an active claim
     → 500 so Stripe retries after it settles; a fulfillment failure
     marks the claim failed → 500 → the retry reclaims and re-fulfills
     (fulfillBrandingOrder still early-returns once provider_order_id
     is set, so a retry after a partial success resumes, not repeats). */
  if (session.metadata?.kind === "branding_order" && session.metadata?.branding_order_id) {
    const brandingOrderId = session.metadata.branding_order_id;

    let claim: PaymentClaimOutcome;
    try {
      claim = await claimStripePayment({
        stripeSessionId:       session.id,
        stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
        userId,
        creditPack:            `branding_order:${brandingOrderId}`,
        creditsAmount:         0,
        amountTotal:           session.amount_total,
        currency:              session.currency,
      });
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? "unknown";
      logger.error({ err, msg, brandingOrderId }, "Stripe webhook: branding payment claim failed");
      // Fail closed (P0-7): 500 so Stripe retries — never fulfill unclaimed.
      res.status(500).json({ error: `Branding payment claim failed: ${msg}` });
      return;
    }

    if (claim === "duplicate") {
      logger.info({ brandingOrderId, sessionId: session.id }, "Stripe webhook: duplicate branding payment ignored — already completed");
      res.status(200).json({ received: true, duplicate: true });
      return;
    }
    if (claim === "inflight") {
      logger.warn({ brandingOrderId, sessionId: session.id }, "Stripe webhook: branding fulfillment already in flight elsewhere");
      // Another worker owns the claim — 500 so Stripe retries after it settles.
      res.status(500).json({ error: "Branding fulfillment in flight, retry later" });
      return;
    }

    // We won the claim — fulfill, then mark the payment completed.
    try {
      const { markBrandingOrderPaid, fulfillBrandingOrder, confirmBrandingFulfillment } = await import("./branding-fulfillment");
      await markBrandingOrderPaid(brandingOrderId, session.id);
      const fulfillment = await fulfillBrandingOrder(brandingOrderId);
      await confirmBrandingFulfillment(brandingOrderId);
      await markPaymentCompleted(session.id);
      logger.info(
        { brandingOrderId, sessionId: session.id, fulfillment },
        "Stripe webhook: branding order paid + submitted to fulfillment"
      );
      res.status(200).json({ received: true, success: true, brandingOrderId });
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? "unknown";
      // We own the claim, so marking it failed is safe: a Stripe retry
      // reclaims the failed row and re-runs fulfillment.
      await markPaymentFailed(session.id).catch(() => {});
      logger.error({ err, msg, brandingOrderId }, "Stripe webhook: branding order fulfillment failed");
      // P0-7: 500 so Stripe retries — 200 would silently drop a paid order.
      res.status(500).json({ error: `Branding fulfillment failed: ${msg}` });
    }
    return;
  }

  if (!creditsAmount || creditsAmount <= 0) {
    logger.error({ sessionId: session.id, creditsAmount }, "Stripe webhook: invalid credits_amount in metadata");
    res.status(200).json({ received: true, warning: "Invalid credits_amount in metadata" });
    return;
  }

  logger.info({ creditsAmount }, "Stripe webhook: credits_amount found");

  /* ── Grant via insert-first claiming (P0-7, P0-9, P0-24) ─────────────────
     fulfillCreditPurchase(): claims the payment row FIRST (insert with
     status='processing'), then grants atomically, then marks completed.
     - Crash between claim and grant → row stays processing/failed → retry
       reclaims it. No double-grant on redelivery (P0-24).
     - Grant failure → row marked failed → we 500 → Stripe retries (P0-7).
     - Concurrent webhook + dashboard verify → only the claim winner grants
       (P0-9). */
  try {
    const result = await fulfillCreditPurchase({
      idempotencyKey: session.id,
      stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
      userId,
      creditPack,
      creditsAmount,
      amountTotal: session.amount_total,
      currency: session.currency,
    });

    if (result.outcome === "duplicate") {
      logger.info({ sessionId: session.id }, "Stripe webhook: duplicate payment ignored — already completed");
      res.status(200).json({ received: true, duplicate: true });
      return;
    }
    if (result.outcome === "inflight") {
      logger.warn({ sessionId: session.id }, "Stripe webhook: grant already in flight elsewhere");
      res.status(500).json({ error: "Grant in flight, retry later" });
      return;
    }

    // Referral revenue share: 25% of purchased credits to the referrer
    // (idempotent — retried webhooks can't double-pay).
    const referralAwarded = await awardReferralPayout(userId, creditsAmount, session.id);

    res.status(200).json({ received: true, success: true, credits: result.newCredits, referralAwarded });
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message ?? "unknown";
    logger.error({ err, msg, userId, creditsAmount }, "Stripe webhook: credit grant failed");
    // P0-7: 500 so Stripe retries. fulfillCreditPurchase marked the row failed.
    res.status(500).json({ error: `Credit grant failed: ${msg}` });
  }
}
