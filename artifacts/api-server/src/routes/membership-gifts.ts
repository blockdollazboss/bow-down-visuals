/**
 * membership-gifts.ts — gift a Pro/Elite membership to another member.
 *
 *   GET  /membership-gifts/recipient?lookup=  auth: preview who a handle
 *                                             or email resolves to (so the
 *                                             sender confirms before paying)
 *   POST /membership-gifts/checkout           auth: embedded Stripe
 *                                             Checkout (mode=payment,
 *                                             ui_mode=embedded — the buyer
 *                                             never leaves bowdownvisuals.com)
 *   POST /membership-gifts/verify             auth: paid session → grant
 *                                             exactly once (the webhook is
 *                                             the other fulfillment door;
 *                                             both claim on the session id)
 *   GET  /membership-gifts/mine               auth: gifts I sent (receipts)
 *                                             + gifts I received
 *
 * Money logic lives in lib/membership-gifts.ts. A gift is a one-time
 * payment, never a subscription: it does not auto-renew, and at period
 * end the recipient glides back to Free unless they subscribe — the UI
 * copy (GIFT_NO_RENEW_COPY) says exactly that, everywhere.
 * JOIN TOUCHPOINT: the checkout success return lands on /creator-pricing
 * (the upgrade-path lane's page) with ?gift=return&session_id=… — that
 * page mounts the gift desk and runs verify from those params.
 */
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import Stripe from "stripe";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { buildCheckoutSessionIdempotencyKey, createGuardedStripeClient } from "../lib/stripe-client";
import {
  GIFT_NO_RENEW_COPY,
  GIFT_COLLISION_COPY,
  countCompletedGifts,
  fulfillGiftMembership,
  giftAmountCents,
  giftDisplayStatus,
  giftTierName,
  isGiftTier,
  listGiftsForUser,
  resolveGiftRecipient,
} from "../lib/membership-gifts";

const router = Router();

function getStripe(): Stripe {
  return createGuardedStripeClient();
}

function getBaseUrl(req?: Request): string {
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

function unavailable(res: Response) {
  res.status(503).json({
    error: "GIFT_MEMBERSHIP_UNAVAILABLE",
    message: "Gift memberships aren't live yet — they'll open with the next update. Nothing was charged.",
  });
}

export function buildGiftMembershipCheckoutKey(args: {
  senderUserId: string;
  recipientProfileId: string;
  tier: string;
  months: number;
  completedCount: number;
}): string {
  return buildCheckoutSessionIdempotencyKey({
    memberId: args.senderUserId,
    rail: "membership-gift",
    purchaseIntent: {
      recipientProfileId: args.recipientProfileId,
      tier: args.tier,
      months: args.months,
      completedGiftCount: args.completedCount,
    },
  });
}

/* ── GET /membership-gifts/recipient — preview the recipient ── */
router.get("/membership-gifts/recipient", requireAuth, publicApiLimiter, async (req, res) => {
  const lookup = String(req.query["lookup"] ?? "").trim();
  if (!lookup) {
    res.status(400).json({ error: "Enter a creator handle or email." });
    return;
  }
  const recipient = await resolveGiftRecipient(lookup);
  if (!recipient) {
    res.status(404).json({
      error: "RECIPIENT_NOT_FOUND",
      message: "We couldn't find a Bow Down Visuals creator with that handle or email — check it and try again. Nothing was charged.",
    });
    return;
  }
  if (recipient.userId === req.userId) {
    res.status(400).json({
      error: "SELF_GIFT",
      message: "That's you — you can't gift a membership to yourself. To upgrade your own plan, use the plan buttons above.",
      upgradeUrl: "/creator-pricing",
    });
    return;
  }
  res.json({
    recipient: { displayName: recipient.displayName, slug: recipient.slug },
    note: GIFT_COLLISION_COPY,
  });
});

/* ── POST /membership-gifts/checkout — embedded, on-site ── */
const checkoutSchema = z.object({
  recipient: z.string().trim().min(1).max(254),
  tier: z.enum(["pro", "elite"]),
  months: z.number().int().min(1).max(12).default(1),
  returnTo: z
    .string()
    .max(200)
    .refine((s) => s.startsWith("/") && !s.startsWith("//"), {
      message: "returnTo must be a same-site path",
    })
    .optional(),
});

router.post("/membership-gifts/checkout", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = checkoutSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Pick a recipient, a tier (Pro or Elite) and 1–12 months.", details: parsed.error.issues });
    return;
  }
  const { recipient: lookup, tier, months, returnTo } = parsed.data;

  const recipient = await resolveGiftRecipient(lookup);
  if (!recipient) {
    res.status(404).json({
      error: "RECIPIENT_NOT_FOUND",
      message: "We couldn't find a Bow Down Visuals creator with that handle or email — check it and try again. Nothing was charged.",
    });
    return;
  }
  if (recipient.userId === req.userId) {
    res.status(400).json({
      error: "SELF_GIFT",
      message: "You can't gift a membership to yourself. To upgrade your own plan, use the plan buttons on this page.",
      upgradeUrl: "/creator-pricing",
    });
    return;
  }

  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
    return;
  }

  const amountCents = giftAmountCents(tier, months);

  /* Completed-gift count is the idempotency sequence (gift-cards
     pattern): a retry of an unfinished gift reuses its session; a new
     gift after one completed gets a fresh key. The read touches
     membership_gifts on purpose — if the table isn't live yet, fail
     closed BEFORE any session exists. */
  let completedCount: number;
  try {
    completedCount = await countCompletedGifts({
      senderUserId: req.userId!,
      recipientProfileId: recipient.profileId,
      tier,
      months,
    });
  } catch (err) {
    logger.warn({ err }, "membership-gifts checkout: gift table unavailable");
    unavailable(res);
    return;
  }

  const idempotencyKey = buildGiftMembershipCheckoutKey({
    senderUserId: req.userId!,
    recipientProfileId: recipient.profileId,
    tier,
    months,
    completedCount,
  });
  const back = returnTo ?? "/creator-pricing";
  const baseUrl = getBaseUrl(req);
  try {
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        ui_mode: "embedded",
        line_items: [
          {
            price_data: {
              currency: "usd",
              unit_amount: amountCents,
              product_data: {
                name: `${giftTierName(tier)} membership gift — ${months} month${months === 1 ? "" : "s"} for ${recipient.displayName}`,
                description: `A one-time gift of Bow Down Visuals ${giftTierName(tier)} for @${recipient.slug}. ${GIFT_NO_RENEW_COPY}`,
              },
            },
            quantity: 1,
          },
        ],
        return_url: `${baseUrl}/creator-pricing?gift=return&session_id={CHECKOUT_SESSION_ID}&returnTo=${encodeURIComponent(back)}`,
        metadata: {
          kind: "membership_gift",
          sender_user_id: req.userId!,
          recipient_user_id: recipient.userId,
          recipient_profile_id: recipient.profileId,
          tier,
          months: String(months),
          amount_cents: String(amountCents),
        },
      },
      { idempotencyKey },
    );
    if (!session.client_secret) throw new Error("Embedded checkout session did not return a client secret");
    logger.info(
      { sender: req.userId, recipientProfileId: recipient.profileId, tier, months, sessionId: session.id },
      "membership gift checkout session created (embedded)",
    );
    res.json({
      clientSecret: session.client_secret,
      sessionId: session.id,
      amountCents,
      tier,
      months,
      recipient: { displayName: recipient.displayName, slug: recipient.slug },
      noRenewCopy: GIFT_NO_RENEW_COPY,
      collisionCopy: GIFT_COLLISION_COPY,
    });
  } catch (err) {
    const msg = (err as { message?: string })?.message ?? "unknown";
    logger.error({ err, msg }, "membership-gifts checkout: Stripe session failed");
    res.status(502).json({ error: `Stripe couldn't start checkout: ${msg}` });
  }
});

/* ── POST /membership-gifts/verify — grant exactly once ── */
const verifySchema = z.object({ sessionId: z.string().min(1).max(200) });

router.post("/membership-gifts/verify", requireAuth, publicApiLimiter, async (req: Request, res: Response) => {
  const parsed = verifySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }
  const { sessionId } = parsed.data;

  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
    return;
  }
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    res.status(400).json({ error: "Could not retrieve this checkout session." });
    return;
  }
  if (session.payment_status !== "paid") {
    res.status(400).json({ error: "Payment has not been completed." });
    return;
  }
  const meta = session.metadata ?? {};
  if (meta["kind"] !== "membership_gift") {
    res.status(400).json({ error: "This session isn't a membership gift." });
    return;
  }
  if (meta["sender_user_id"] !== req.userId) {
    res.status(403).json({ error: "This gift purchase doesn't belong to you." });
    return;
  }
  const tier = meta["tier"];
  const months = Number(meta["months"] ?? 0);
  const expectedCents = Number(meta["amount_cents"] ?? 0);
  if (!isGiftTier(tier) || !Number.isInteger(months) || months < 1 || months > 12 || !meta["recipient_user_id"] || !meta["recipient_profile_id"]) {
    res.status(400).json({ error: "This gift session is missing its recipient details — contact support, your payment is recorded." });
    return;
  }
  if (!expectedCents || (session.amount_total ?? 0) !== expectedCents) {
    res.status(400).json({ error: "The paid amount doesn't match this gift." });
    return;
  }

  try {
    const { gift, duplicate } = await fulfillGiftMembership({
      sessionId: session.id,
      paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : null,
      amountCents: session.amount_total ?? expectedCents,
      currency: session.currency,
      senderUserId: req.userId!,
      recipientUserId: meta["recipient_user_id"],
      recipientProfileId: meta["recipient_profile_id"],
      tier,
      months,
    });
    res.json({
      success: true,
      duplicate,
      receipt: {
        id: String(gift.id),
        tier: String(gift.tier),
        months: Number(gift.months),
        amountCents: gift["amount_cents"] == null ? expectedCents : Number(gift["amount_cents"]),
        periodStart: gift.period_start,
        periodEnd: gift.period_end,
        displayStatus: giftDisplayStatus(
          { tier: String(gift.tier), status: String(gift.status), periodStart: gift.period_start, periodEnd: gift.period_end },
          new Date(),
        ),
      },
      note: duplicate
        ? "This gift was already granted — the receipt above is the original. It was not charged or granted twice."
        : `Gift granted. ${GIFT_NO_RENEW_COPY}`,
    });
  } catch (err) {
    logger.error({ err, sessionId }, "membership-gifts verify: fulfillment failed");
    res.status(500).json({ error: "Payment confirmed but the gift couldn't be granted yet. It will land via our payment webhook — if it hasn't within a few minutes, contact support with your receipt." });
  }
});

/* ── GET /membership-gifts/mine — receipts + received ── */
router.get("/membership-gifts/mine", requireAuth, publicApiLimiter, async (req, res) => {
  try {
    const { sent, received } = await listGiftsForUser(req.userId!);
    res.json({ sent, received, noRenewCopy: GIFT_NO_RENEW_COPY, collisionCopy: GIFT_COLLISION_COPY });
  } catch (err) {
    logger.warn({ err, userId: req.userId }, "membership-gifts mine: gift table unavailable");
    unavailable(res);
  }
});

export default router;
