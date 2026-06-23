import Stripe from "stripe";
import pg from "pg";
import type { Request, Response } from "express";
import { logger } from "./logger";

const { Pool } = pg;

let _pool: InstanceType<typeof Pool> | null = null;
function getPool(): InstanceType<typeof Pool> {
  if (!_pool) {
    const connectionString = process.env["DATABASE_URL"];
    if (!connectionString) throw new Error("DATABASE_URL is not configured");
    _pool = new Pool({ connectionString });
  }
  return _pool;
}

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

  logger.info({ type: event.type }, "Stripe webhook event received");

  if (event.type !== "checkout.session.completed") {
    res.status(200).json({ received: true });
    return;
  }

  const session = event.data.object as Stripe.Checkout.Session;

  if (session.payment_status !== "paid") {
    logger.info({ sessionId: session.id, status: session.payment_status }, "Webhook: session not paid, skipping");
    res.status(200).json({ received: true });
    return;
  }

  const userId = session.metadata?.user_id;
  const creditPack = session.metadata?.credit_pack ?? "unknown";
  const creditsAmount = parseInt(session.metadata?.credits_amount ?? "0", 10);

  if (!userId) {
    logger.error({ sessionId: session.id }, "Webhook: missing user_id in session metadata");
    res.status(200).json({ received: true, warning: "Missing user_id in metadata" });
    return;
  }

  if (!creditsAmount || creditsAmount <= 0) {
    logger.error({ sessionId: session.id, creditsAmount }, "Webhook: invalid credits_amount in session metadata");
    res.status(200).json({ received: true, warning: "Invalid credits_amount in metadata" });
    return;
  }

  let pool: InstanceType<typeof Pool>;
  try {
    pool = getPool();
  } catch (err) {
    logger.error({ err }, "Webhook: DATABASE_URL not configured — cannot update credits");
    res.status(200).json({ received: true, warning: "Database not configured" });
    return;
  }

  try {
    const result = await pool.query<{ credits: number }>(
      `UPDATE profiles SET credits = credits + $1 WHERE id = $2 RETURNING credits`,
      [creditsAmount, userId]
    );

    if (result.rowCount === 0) {
      logger.error({ userId, creditsAmount }, "Webhook: no profile found for user_id");
      res.status(200).json({ received: true, warning: "User profile not found" });
      return;
    }

    const newCredits = result.rows[0].credits;

    if (process.env["NODE_ENV"] === "development") {
      logger.info(
        { userId, creditPack, creditsAmount, newCredits, sessionId: session.id },
        "Webhook: credits added successfully"
      );
    }

    res.status(200).json({ received: true, success: true, credits: newCredits });
  } catch (err: unknown) {
    const msg = (err as { message?: string })?.message ?? "unknown";
    logger.error({ err, msg, userId }, "Webhook: database credit update failed");
    res.status(200).json({ received: true, warning: `Credit update failed: ${msg}` });
  }
}
