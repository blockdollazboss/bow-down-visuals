import { Router } from "express";
import Stripe from "stripe";
import { requireAuth } from "../middlewares/require-auth";
import { logger } from "../lib/logger";

const router = Router();

const PACK_MAP: Record<string, { envKey: string; credits: number; label: string }> = {
  "10":  { envKey: "STRIPE_PRICE_10_CREDITS",  credits: 10,  label: "10 Credits"  },
  "50":  { envKey: "STRIPE_PRICE_50_CREDITS",  credits: 50,  label: "50 Credits"  },
  "150": { envKey: "STRIPE_PRICE_150_CREDITS", credits: 150, label: "150 Credits" },
  "500": { envKey: "STRIPE_PRICE_500_CREDITS", credits: 500, label: "500 Credits" },
};

function getStripe(): Stripe {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(key);
}

function getBaseUrl(): string {
  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
  if (domain) return `https://${domain}`;
  return "http://localhost";
}

/* ── POST /api/create-checkout-session ── */
router.post("/create-checkout-session", requireAuth, async (req, res) => {
  const { pack } = req.body as { pack?: string };

  const packInfo = pack ? PACK_MAP[pack] : undefined;
  if (!packInfo) {
    res.status(400).json({ error: "Invalid pack size. Must be 10, 50, 150, or 500." });
    return;
  }

  const priceId = process.env[packInfo.envKey];
  if (!priceId) {
    res
      .status(500)
      .json({ error: `Stripe price ID not configured for the ${packInfo.label} pack. Add ${packInfo.envKey} to Replit Secrets.` });
    return;
  }

  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch (err) {
    logger.error({ err }, "create-checkout-session: Stripe client init failed");
    res.status(500).json({ error: "Stripe is not configured. Add STRIPE_SECRET_KEY to Replit Secrets." });
    return;
  }

  try {
    const baseUrl = getBaseUrl();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/dashboard?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/pricing?payment=cancelled`,
      metadata: {
        userId: req.userId!,
        credits: String(packInfo.credits),
        pack: packInfo.label,
      },
    });

    logger.info({ userId: req.userId, pack: packInfo.label }, "Checkout session created");
    res.json({ url: session.url });
  } catch (err) {
    logger.error({ err }, "create-checkout-session: Stripe API call failed");
    res.status(500).json({ error: "Failed to create checkout session. Please try again." });
  }
});

/* ── POST /api/checkout/verify ── */
router.post("/checkout/verify", requireAuth, async (req, res) => {
  const { sessionId } = req.body as { sessionId?: string };

  if (!sessionId || typeof sessionId !== "string") {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }

  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch (err) {
    logger.error({ err }, "checkout/verify: Stripe client init failed");
    res.status(500).json({ error: "Stripe is not configured." });
    return;
  }

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch (err) {
    logger.error({ err, sessionId }, "checkout/verify: failed to retrieve session");
    res.status(400).json({ error: "Could not retrieve checkout session." });
    return;
  }

  if (session.payment_status !== "paid") {
    res.status(400).json({ error: "Payment has not been completed." });
    return;
  }

  if (session.metadata?.userId !== req.userId) {
    res.status(403).json({ error: "Session does not belong to this user." });
    return;
  }

  const creditsToAdd = parseInt(session.metadata?.credits ?? "0", 10);
  if (!creditsToAdd || creditsToAdd <= 0) {
    res.status(400).json({ error: "No valid credit amount found in this session." });
    return;
  }

  const { data: profile, error: fetchError } = await req.userSupabase!
    .from("profiles")
    .select("credits")
    .eq("id", req.userId)
    .single();

  if (fetchError || !profile) {
    logger.error({ err: fetchError, userId: req.userId }, "checkout/verify: failed to fetch profile");
    res.status(500).json({ error: "Could not load your profile." });
    return;
  }

  const newCredits = ((profile.credits as number) ?? 0) + creditsToAdd;

  const { error: updateError } = await req.userSupabase!
    .from("profiles")
    .update({ credits: newCredits })
    .eq("id", req.userId);

  if (updateError) {
    logger.error({ err: updateError, userId: req.userId }, "checkout/verify: failed to update credits");
    res.status(500).json({ error: "Credits verified but could not be applied. Contact support." });
    return;
  }

  logger.info({ userId: req.userId, creditsToAdd, newCredits, pack: session.metadata?.pack }, "checkout/verify: credits applied");
  res.json({ success: true, credits: newCredits, added: creditsToAdd, pack: session.metadata?.pack ?? "" });
});

export default router;
