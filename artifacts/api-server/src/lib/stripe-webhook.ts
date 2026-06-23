import Stripe from "stripe";
import type { Request, Response } from "express";
import { logger } from "./logger";
import { addCreditsToProfile, getSupabaseAdmin } from "./supabase-admin";

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
    res.status(200).json({ received: true, success: true, credits: newCredits });
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message ?? "unknown";
    logger.error({ err, msg, userId, creditsAmount }, "Stripe webhook: credit update failed");
    res.status(200).json({ received: true, warning: `Credit update failed: ${msg}` });
  }
}
