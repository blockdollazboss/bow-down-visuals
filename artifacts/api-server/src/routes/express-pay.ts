import { Router } from "express";
import { z } from "zod";
import Stripe from "stripe";
import { publicApiLimiter } from "../lib/rate-limit";
import { requireAuth } from "../middlewares/require-auth";
import { logger } from "../lib/logger";
import { addCreditsToProfile } from "../lib/supabase-admin";
import { isPaymentAlreadyRecorded, recordStripePayment } from "../lib/payment-record";

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
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(key);
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

    // Idempotency — same pattern as checkout/verify
    try {
      const alreadyProcessed = await isPaymentAlreadyRecorded(pi.id);
      if (alreadyProcessed) {
        res.json({ success: true, duplicate: true, added: creditsToAdd, pack: metaPack });
        return;
      }
    } catch (err: unknown) {
      logger.error({ err }, "express_pay/verify: idempotency check failed — proceeding");
    }

    try {
      const { newCredits } = await addCreditsToProfile(req.userId!, creditsToAdd);
      await recordStripePayment({
        stripeSessionId: pi.id,
        stripePaymentIntentId: pi.id,
        userId: req.userId!,
        creditPack: metaPack,
        creditsAmount: creditsToAdd,
        amountTotal: pi.amount,
        currency: pi.currency,
      });
      logger.info(
        { userId: req.userId, creditsToAdd, pack: metaPack, paymentIntentId: pi.id },
        "express_pay/verify: credits applied successfully"
      );
      res.json({ success: true, credits: newCredits, added: creditsToAdd, pack: metaPack });
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? "unknown";
      logger.error({ err, userId: req.userId }, "express_pay/verify: credit update failed");
      res.status(500).json({ error: `Payment verified but credits could not be applied: ${msg}` });
    }
  } catch (err) {
    logger.error({ err }, "Express payment verification failed");
    res.status(500).json({ error: "Payment verification failed" });
  }
});

export default router;
