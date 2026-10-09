import { Router } from "express";
import { z } from "zod";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";

const router = Router();

/* Express payments via Apple Pay / Google Pay (Payment Request API).
   The frontend collects payment details via the native sheet;
   this endpoint processes them via Stripe. */

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

    // TODO: Integrate with Stripe PaymentIntents for actual processing.
    // Requires STRIPE_SECRET_KEY on the server.
    // For now, return a stub indicating the integration point.
    logger.error("Express payment not yet connected to Stripe");

    res.status(501).json({
      error: "Express payments are being set up. Please use card checkout for now.",
      setupRequired: true,
    });
  } catch (err) {
    logger.error("Express payment failed");
    res.status(500).json({ error: "Payment processing failed" });
  }
});

export default router;
