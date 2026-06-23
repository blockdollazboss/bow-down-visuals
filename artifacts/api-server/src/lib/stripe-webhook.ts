import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import type { Request, Response } from "express";
import { logger } from "./logger";

export async function stripeWebhookHandler(req: Request, res: Response): Promise<void> {
  const secretKey = process.env["STRIPE_SECRET_KEY"];
  const webhookSecret = process.env["STRIPE_WEBHOOK_SECRET"];

  if (!secretKey || !webhookSecret) {
    logger.warn("Stripe webhook received but STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET not configured");
    res.status(200).json({ received: true, warning: "Stripe not fully configured" });
    return;
  }

  const stripe = new Stripe(secretKey);
  const sig = req.headers["stripe-signature"];

  if (!sig) {
    res.status(400).json({ error: "Missing stripe-signature header" });
    return;
  }

  const sigStr = Array.isArray(sig) ? sig[0] : sig;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body as Buffer, sigStr, webhookSecret);
  } catch (err) {
    logger.error({ err }, "Stripe webhook signature verification failed");
    res.status(400).json({ error: "Webhook signature verification failed" });
    return;
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;

    if (session.payment_status !== "paid") {
      res.status(200).json({ received: true });
      return;
    }

    const userId = session.metadata?.userId;
    const creditsToAdd = parseInt(session.metadata?.credits ?? "0", 10);

    if (!userId || !creditsToAdd || creditsToAdd <= 0) {
      logger.warn({ sessionId: session.id }, "Webhook: missing userId or credits in session metadata");
      res.status(200).json({ received: true });
      return;
    }

    const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
    if (!serviceRoleKey) {
      logger.warn(
        { userId, creditsToAdd },
        "Webhook: SUPABASE_SERVICE_ROLE_KEY not set — credits will be granted via /api/checkout/verify when user returns to dashboard"
      );
      res.status(200).json({ received: true });
      return;
    }

    const adminSupabase = createClient(
      process.env["SUPABASE_URL"] ?? "",
      serviceRoleKey,
      { auth: { persistSession: false } }
    );

    const { data: profile, error: fetchError } = await adminSupabase
      .from("profiles")
      .select("credits")
      .eq("id", userId)
      .single();

    if (fetchError || !profile) {
      logger.error({ err: fetchError, userId }, "Webhook: failed to fetch profile");
      res.status(200).json({ received: true });
      return;
    }

    const newCredits = (profile.credits as number ?? 0) + creditsToAdd;

    const { error: updateError } = await adminSupabase
      .from("profiles")
      .update({ credits: newCredits })
      .eq("id", userId);

    if (updateError) {
      logger.error({ err: updateError, userId }, "Webhook: failed to update credits");
    } else {
      logger.info({ userId, creditsToAdd, newCredits }, "Webhook: credits added via service role");
    }
  }

  res.status(200).json({ received: true });
}
