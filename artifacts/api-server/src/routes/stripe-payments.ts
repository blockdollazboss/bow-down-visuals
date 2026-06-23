import { Router } from "express";
import Stripe from "stripe";
import { requireAuth } from "../middlewares/require-auth";
import { logger } from "../lib/logger";
import { addCreditsToProfile } from "../lib/supabase-admin";

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

function getBaseUrl(req?: import("express").Request): string {
  const domain = process.env["REPLIT_DOMAINS"]?.split(",")[0];
  if (domain) return `https://${domain}`;
  const devDomain = process.env["REPLIT_DEV_DOMAIN"];
  if (devDomain) return `https://${devDomain}`;
  if (req) {
    const proto = req.headers["x-forwarded-proto"] ?? "https";
    const host = req.headers["host"];
    if (host) return `${proto}://${host}`;
  }
  return "http://localhost";
}

/* ── GET /api/stripe-status ── diagnostic, no auth ── */
router.get("/stripe-status", async (_req, res) => {
  const secretKey = process.env["STRIPE_SECRET_KEY"];
  const webhookSecret = process.env["STRIPE_WEBHOOK_SECRET"];
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  const prices = {
    "10":  process.env["STRIPE_PRICE_10_CREDITS"],
    "50":  process.env["STRIPE_PRICE_50_CREDITS"],
    "150": process.env["STRIPE_PRICE_150_CREDITS"],
    "500": process.env["STRIPE_PRICE_500_CREDITS"],
  };

  const status = {
    secretKeyPresent: !!secretKey,
    secretKeyPrefix: secretKey ? secretKey.slice(0, 7) : null,
    webhookSecretPresent: !!webhookSecret,
    webhookSecretPrefix: webhookSecret ? webhookSecret.slice(0, 6) : null,
    serviceRoleKeyPresent: !!serviceRoleKey,
    prices: Object.fromEntries(
      Object.entries(prices).map(([k, v]) => [k, { present: !!v, prefix: v ? v.slice(0, 8) : null }])
    ),
    stripeReachable: false,
    stripeError: null as string | null,
  };

  if (secretKey) {
    try {
      const stripe = new Stripe(secretKey);
      await stripe.paymentMethods.list({ limit: 1 });
      status.stripeReachable = true;
    } catch (err: unknown) {
      status.stripeError = (err as { message?: string })?.message ?? "unknown";
    }
  }

  res.json(status);
});

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
    res.status(500).json({
      error: `Stripe price ID not configured for the ${packInfo.label} pack. Add ${packInfo.envKey} to Replit Secrets.`,
    });
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
    const baseUrl = getBaseUrl(req);
    logger.info({ userId: req.userId, pack: packInfo.label, priceId, baseUrl }, "Creating checkout session");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${baseUrl}/dashboard?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/pricing?payment=cancelled`,
      metadata: {
        user_id: req.userId!,
        credit_pack: packInfo.label,
        credits_amount: String(packInfo.credits),
      },
    });

    logger.info({ userId: req.userId, pack: packInfo.label }, "Checkout session created");
    res.json({ url: session.url });
  } catch (err: unknown) {
    const stripeMsg = (err as { message?: string })?.message ?? "Unknown error";
    logger.error({ err, stripeMsg }, "create-checkout-session: Stripe API call failed");
    res.status(500).json({ error: `Stripe error: ${stripeMsg}` });
  }
});

/* ── POST /api/checkout/verify ── */
router.post("/checkout/verify", requireAuth, async (req, res) => {
  const { sessionId } = req.body as { sessionId?: string };

  if (!sessionId || typeof sessionId !== "string") {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }

  // Fail fast if service role key is missing
  if (!process.env["SUPABASE_SERVICE_ROLE_KEY"]) {
    const msg = "Missing SUPABASE_SERVICE_ROLE_KEY. Add it to Replit Secrets so Stripe payments can update credits securely.";
    logger.error(msg);
    res.status(500).json({ error: msg });
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
    logger.info({ sessionId, paymentStatus: session.payment_status }, "checkout/verify: payment verified");
  } catch (err) {
    logger.error({ err, sessionId }, "checkout/verify: failed to retrieve session from Stripe");
    res.status(400).json({ error: "Could not retrieve checkout session." });
    return;
  }

  if (session.payment_status !== "paid") {
    res.status(400).json({ error: "Payment has not been completed." });
    return;
  }

  // Support both old and new metadata field names
  const metaUserId = session.metadata?.user_id ?? session.metadata?.userId;
  const metaCredits = session.metadata?.credits_amount ?? session.metadata?.credits;
  const metaPack = session.metadata?.credit_pack ?? session.metadata?.pack ?? "";

  logger.info({ metaUserId, metaCredits, metaPack, sessionId }, "checkout/verify: metadata read");

  if (metaUserId !== req.userId) {
    logger.error({ metaUserId, reqUserId: req.userId, sessionId }, "checkout/verify: user_id mismatch");
    res.status(403).json({ error: "Session does not belong to this user." });
    return;
  }

  logger.info({ userId: req.userId }, "checkout/verify: user_id found and matched");

  const creditsToAdd = parseInt(metaCredits ?? "0", 10);
  if (!creditsToAdd || creditsToAdd <= 0) {
    logger.error({ metaCredits, sessionId }, "checkout/verify: invalid credits_amount in metadata");
    res.status(400).json({ error: "No valid credit amount found in this session." });
    return;
  }

  logger.info({ creditsToAdd }, "checkout/verify: credits_amount found");

  try {
    const { oldCredits, newCredits, created } = await addCreditsToProfile(req.userId!, creditsToAdd);
    logger.info(
      { userId: req.userId, creditsToAdd, oldCredits, newCredits, pack: metaPack, sessionId, created },
      "checkout/verify: credits applied successfully"
    );
    res.json({ success: true, credits: newCredits, added: creditsToAdd, pack: metaPack });
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message ?? "unknown";
    logger.error({ err, msg, userId: req.userId }, "checkout/verify: credit update failed");
    res.status(500).json({ error: `Credits verified but could not be applied: ${msg}` });
  }
});

export default router;
