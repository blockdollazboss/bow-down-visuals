import { Router } from "express";
import { z } from "zod";
import Stripe from "stripe";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";

const router = Router();

/* Express payments via Apple Pay / Google Pay (Payment Request API).
   Creates a Stripe PaymentIntent for the native payment sheet. */

const expressPaySchema = z.object({
  amount: z.number().int().positive(),
  label: z.string().min(1).max(200),
  paymentData: z.any(),
  payerEmail: z.string().email().optional(),
});

router.post("/payments/express", publicApiLimiter, async (req, res) => {
  try {
    const parsed = expressPaySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid payment data" });
      return;
    }

    const secretKey = process.env["STRIPE_SECRET_KEY"];
    if (!secretKey) {
      res.status(501).json({
        error: "Payments not configured. Please contact support.",
      });
      return;
    }

    const stripe = new Stripe(secretKey);

    // Create a PaymentIntent for the express payment
    const paymentIntent = await stripe.paymentIntents.create({
      amount: parsed.data.amount,
      currency: "usd",
      description: parsed.data.label,
      receipt_email: parsed.data.payerEmail,
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: "never",
      },
      metadata: {
        source: "express_pay",
        label: parsed.data.label,
      },
    });

    res.json({
      success: true,
      clientSecret: paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
    });
  } catch (err) {
    logger.error("Express payment failed");
    res.status(500).json({ error: "Payment processing failed" });
  }
});

export default router;
