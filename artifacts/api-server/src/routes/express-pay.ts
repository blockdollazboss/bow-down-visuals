import { Router } from "express";
import { z } from "zod";
import Stripe from "stripe";
import { publicApiLimiter } from "../lib/rate-limit";
import { requireAuth } from "../middlewares/require-auth";
import { logger } from "../lib/logger";
import { fulfillCreditPurchase, getStripePaymentStatus } from "../lib/payment-record";

/* Referral revenue share (25% of purchased credits to the referrer).
   Exactly-once by construction — referral_payouts carries
   UNIQUE(stripe_session_id) and only the insert winner pays — so every
   fulfillment path calls it once the purchase is known complete (see
   the twin helper in stripe-payments.ts). Keyed by the payment intent
   id, the same key the webhook's express branch awards under. Lazy
   import avoids a module cycle; fully guarded — a referral failure
   must never change the verify answer the buyer sees. */
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
      "express/verify: referral award attempt failed (non-fatal)"
    );
  }
}
import { createGuardedStripeClient } from "../lib/stripe-client";

const router = Router();

/* Express payments via Apple Pay / Google Pay (Stripe Payment Request Button).
   Flow: frontend creates PaymentIntent via POST /payments/express (auth'd,
   pack-keyed so the amount is resolved server-side from the Stripe Price),
   confirms with stripe.confirmCardPayment, then fulfills via
   POST /payments/express/verify which credits Visual Bucs idempotently. */

const PACK_MAP: Record<string, { envKey: string; credits: number; label: string }> = {
  "10":  { envKey: "STRIPE_PRICE_10_CREDITS",  credits: 1000,  label: "1,000 Visual Bucs"  },
  "50":  { envKey: "STRIPE_PRICE_50_CREDITS",  credits: 5000,  label: "5,000 Visual Bucs"  },
  "150": { envKey: "STRIPE_PRICE_150_CREDITS", credits: 15000, label: "15,000 Visual Bucs" },
  "500": { envKey: "STRIPE_PRICE_500_CREDITS", credits: 50000, label: "50,000 Visual Bucs" },
};

function getStripe(): Stripe {
  return createGuardedStripeClient();
}

const expressPaySchema = z.object({
  pack: z.string().min(1).max(10),
});

router.post("/payments/express", requireAuth, publicApiLimiter, async (req, res) => {
  try {
    const parsed = expressPaySchema.safeParse(req.body ?? {});
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

    // Resolve the amount server-side from the Stripe Price — never trust the client.
    const priceId = process.env[packInfo.envKey];
    if (!priceId) {
      res.status(501).json({ error: `Price not configured for the ${packInfo.label} pack.` });
      return;
    }
    const price = await stripe.prices.retrieve(priceId);
    if (!price.unit_amount) {
      res.status(501).json({ error: "Price has no fixed amount." });
      return;
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: price.unit_amount,
      currency: price.currency ?? "usd",
      description: packInfo.label,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: "never",
      },
      metadata: {
        source: "express_pay",
        user_id: req.userId!,
        credit_pack: packInfo.label,
        credits_amount: String(packInfo.credits),
        pack_key: parsed.data.pack,
      },
    });

    logger.info(
      { userId: req.userId, pack: packInfo.label, paymentIntentId: paymentIntent.id },
      "express_pay: PaymentIntent created"
    );

    res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount: price.unit_amount,
      currency: price.currency ?? "usd",
      label: packInfo.label,
    });
  } catch (err) {
    logger.error({ err }, "Express payment creation failed");
    res.status(500).json({ error: "Payment processing failed" });
  }
});

const expressVerifySchema = z.object({
  paymentIntentId: z.string().min(1).max(100),
});

router.post("/payments/express/verify", requireAuth, publicApiLimiter, async (req, res) => {
  try {
    const parsed = expressVerifySchema.safeParse(req.body ?? {});
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

    const pi = await stripe.paymentIntents.retrieve(parsed.data.paymentIntentId);
    if (pi.status !== "succeeded") {
      res.status(400).json({ error: "Payment has not been completed." });
      return;
    }

    const metaUserId = pi.metadata?.user_id;
    const metaCredits = pi.metadata?.credits_amount;
    const metaPack = pi.metadata?.credit_pack ?? "";

    if (metaUserId !== req.userId) {
      logger.error({ metaUserId, reqUserId: req.userId }, "express_pay/verify: user_id mismatch");
      res.status(403).json({ error: "Payment does not belong to this user." });
      return;
    }

    const creditsToAdd = parseInt(metaCredits ?? "0", 10);
    if (!creditsToAdd || creditsToAdd <= 0) {
      res.status(400).json({ error: "No valid Visual Buc amount found in this payment." });
      return;
    }

    // Grant via insert-first claiming — shares idempotency with the
    // payment_intent.succeeded webhook branch (same PI id key). Only the
    // claim winner grants; the loser sees duplicate/inflight.
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
        // Complete purchase; pays the referral share if the completing
        // path never ran it — a no-op when it already landed.
        await awardReferralShare(req.userId!, creditsToAdd, pi.id);
        res.json({ success: true, duplicate: true, added: creditsToAdd, pack: metaPack });
        return;
      }
      if (result.outcome === "inflight") {
        res.status(409).json({ error: "Payment is being processed. Please wait a moment and refresh." });
        return;
      }
      logger.info(
        { userId: req.userId, creditsToAdd, pack: metaPack, paymentIntentId: pi.id },
        "express_pay/verify: credits applied successfully"
      );
      await awardReferralShare(req.userId!, creditsToAdd, pi.id);
      res.json({ success: true, credits: result.newCredits, added: creditsToAdd, pack: metaPack });
    } catch (err: unknown) {
      logger.error({ err, userId: req.userId }, "express_pay/verify: credit grant failed");
      /* Reconcile before answering (D6, same as /checkout/verify): the
         payment_intent.succeeded webhook may have completed this
         payment while our grant attempt failed — "completed" is only
         set after credits land, so report the granted state. Otherwise
         the truthful pending message; never quote the internal error. */
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
  } catch (err) {
    logger.error({ err }, "Express payment verification failed");
    res.status(500).json({ error: "Payment verification failed" });
  }
});

export default router;
