/**
 * gift-cards.ts — stored-value gift cards for a seller's whole store
 * (Stack-100 #3 item 26). Docks in MONEY: the product is a
 * kind='gift_card' row in the seller's existing store_products store
 * (created through the store dashboard / POST /api/storefront/products
 * with seller-set denominations), bought here, and redeemed inside the
 * existing storefront / shops / digital-store checkouts — never a
 * standalone store.
 *
 * Endpoints:
 *   POST /gift-cards/checkout   auth: buy a card (recipient email is
 *                               REQUIRED — the buyer is never the end
 *                               user; delivery goes to the recipient)
 *   POST /gift-cards/verify     auth: paid session → issue the card
 *                               (exactly once per session) + email the
 *                               code to the recipient
 *   GET  /gift-cards/balance    public: balance lookup by code (the
 *                               code is the capability — bearer value)
 *   GET  /gift-cards/mine       auth: cards I bought + cards sent to
 *                               my account email
 *   GET  /gift-cards/sold       auth: seller desk — cards sold against
 *                               my store + outstanding liability
 *   POST /gift-cards/:id/refund auth (buyer): refund the purchase —
 *                               claws back ONLY the unspent balance
 *
 * Money law lives in lib/gift-cards.ts: no fee and no seller credit at
 * issuance (a liability, not a sale); the fee is charged once, at
 * redemption, by the redeeming rail on the sale's full gross.
 * ⚠️ PENDING-MIGRATION: until the held gift-card migration lands,
 * every endpoint that touches the new tables answers 503
 * GIFT_CARDS_UNAVAILABLE — money fails closed, never open.
 */
import { Router } from "express";
import Stripe from "stripe";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { formatUsd } from "../lib/platform-fees";
import { buildCheckoutSessionIdempotencyKey, createGuardedStripeClient } from "../lib/stripe-client";
import { sendEmail, emailShell, emailButton, money as emailMoney, escapeHtml, baseUrlForEmail } from "../lib/email";
import {
  GiftCardsUnavailable,
  generateGiftCardCode,
  hashGiftCardCode,
  isGiftCardCodeShape,
  issueGiftCard,
  findCardByCode,
  findCardById,
  clawbackUnspentBalance,
  presentCard,
  type GiftCardRow,
} from "../lib/gift-cards";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getStripe(): Stripe {
  return createGuardedStripeClient();
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

function unavailable(res: import("express").Response) {
  res.status(503).json({
    error: "GIFT_CARDS_UNAVAILABLE",
    message: "Gift cards aren't live yet — they'll open with the store's next update. Nothing was charged.",
  });
}

interface GiftProductRow extends Record<string, unknown> {
  id: string; profile_id: string; kind: string; title: string;
  price_cents: number; is_active: boolean;
  gift_card_denominations_cents: number[] | null;
  artist_name: string; artist_slug: string;
}

async function fetchGiftProduct(id: string): Promise<GiftProductRow | null> {
  const r = await db.execute(sql`
    SELECT sp.*, cp.display_name AS artist_name, cp.slug AS artist_slug
    FROM store_products sp
    JOIN creator_profiles cp ON cp.id = sp.profile_id
    WHERE sp.id = ${id} AND sp.is_active = true
    LIMIT 1
  `);
  return (r.rows[0] as unknown as GiftProductRow | undefined) ?? null;
}

/* ═══════════════ BUY: checkout (recipient delivery) ═══════════════ */
const CheckoutSchema = z.object({
  productId: z.string().regex(UUID_RE, "productId must be a UUID"),
  amountCents: z.number().int().positive().max(50_000),
  /* The buyer is never the end user: the card is delivered to the
     recipient's email. Required, and validated here. */
  recipientEmail: z.string().trim().email().max(254),
  recipientName: z.string().trim().max(120).optional(),
  message: z.string().trim().max(500).optional(),
});

export function buildGiftCardCheckoutKey(args: {
  userId: string; productId: string; amountCents: number;
  recipientEmail: string; completedCount: number;
}): string {
  return buildCheckoutSessionIdempotencyKey({
    memberId: args.userId,
    rail: "gift-card",
    purchaseIntent: {
      productId: args.productId,
      amountCents: args.amountCents,
      recipientEmail: args.recipientEmail.toLowerCase(),
      completedOrderCount: args.completedCount,
    },
  });
}

router.post("/gift-cards/checkout", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = CheckoutSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request.", details: parsed.error.issues });
    return;
  }
  const { productId, amountCents, recipientEmail } = parsed.data;

  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch {
    res.status(500).json({ error: "Payments are not configured yet." });
    return;
  }

  try {
    const p = await fetchGiftProduct(productId);
    if (!p || p.kind !== "gift_card") {
      res.status(404).json({ error: "NOT_A_GIFT_CARD", message: "That product isn't a gift card." });
      return;
    }
    const denominations = Array.isArray(p.gift_card_denominations_cents)
      ? p.gift_card_denominations_cents.map(Number)
      : [];
    if (!denominations.includes(amountCents)) {
      res.status(400).json({
        error: "AMOUNT_NOT_OFFERED",
        message: `This gift card comes in ${denominations.map((c) => formatUsd(c)).join(", ") || "set amounts"} — pick one of those.`,
      });
      return;
    }

    /* Fail closed BEFORE any session exists if the card tables aren't
       live yet (held migration): count issued cards for the session
       idempotency key — the read touches gift_cards on purpose. */
    let completedCount = 0;
    try {
      const countResult = await db.execute(sql`
        SELECT COUNT(*)::int AS c FROM gift_cards
        WHERE buyer_user_id = ${req.userId!} AND product_id = ${productId}
          AND initial_cents = ${amountCents}
          AND LOWER(recipient_email) = ${recipientEmail.toLowerCase()}
      `);
      completedCount = Number((countResult.rows[0] as { c?: number } | undefined)?.c ?? 0);
    } catch {
      unavailable(res);
      return;
    }

    const idempotencyKey = buildGiftCardCheckoutKey({
      userId: req.userId!, productId, amountCents, recipientEmail, completedCount,
    });
    const baseUrl = getBaseUrl(req);
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: {
              name: `${p.title} — gift card for ${p.artist_name}`,
              description: `Gift card delivered to ${recipientEmail}. Stored value for ${p.artist_name}'s store on Bow Down Visuals.`,
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/storefront/product/${p.id}?gift=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/storefront/product/${p.id}`,
      metadata: {
        type: "gift_card_purchase",
        buyer_user_id: req.userId!,
        profile_id: p.profile_id,
        product_id: p.id,
        amount_cents: String(amountCents),
        recipient_email: recipientEmail,
        recipient_name: parsed.data.recipientName ?? "",
        gift_message: parsed.data.message ?? "",
        /* Fee law, recorded on the session itself: issuance takes NO
           platform fee and credits NO seller amount — the money is a
           liability until redemption (lib/gift-cards.ts). */
        platform_fee_cents: "0",
        creator_amount_cents: "0",
      },
    }, { idempotencyKey });

    logger.info({ userId: req.userId, productId, amountCents, sessionId: session.id }, "[gift-cards] checkout session created");
    res.json({
      url: session.url,
      sessionId: session.id,
      amountCents,
      amount: formatUsd(amountCents),
      recipientEmail,
      note: "Real-money purchase via Stripe. The gift card is stored value for this creator's store — this is not Visual Bucs (AI credits). No platform fee is taken from a gift card; the full amount is the recipient's to spend.",
    });
  } catch (err) {
    if (err instanceof GiftCardsUnavailable) { unavailable(res); return; }
    logger.error({ err, productId }, "[gift-cards] checkout failed");
    res.status(500).json({ error: "Could not start checkout." });
  }
});

/* ═══════════════ VERIFY: issue the card, exactly once ═════════════ */
const VerifySchema = z.object({ sessionId: z.string().min(1).max(200) });

router.post("/gift-cards/verify", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = VerifySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "sessionId is required" });
    return;
  }
  const { sessionId } = parsed.data;

  let stripe: Stripe;
  try {
    stripe = getStripe();
  } catch {
    res.status(500).json({ error: "Payments are not configured yet." });
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
  if (meta["type"] !== "gift_card_purchase") {
    res.status(400).json({ error: "This session isn't a gift-card purchase." });
    return;
  }
  if (meta["buyer_user_id"] !== req.userId) {
    res.status(403).json({ error: "This purchase doesn't belong to you." });
    return;
  }
  const amountCents = session.amount_total ?? Number(meta["amount_cents"] ?? 0);
  if (!amountCents || amountCents !== Number(meta["amount_cents"] ?? 0)) {
    res.status(400).json({ error: "The paid amount doesn't match this gift card." });
    return;
  }

  try {
    /* The code is minted HERE and exists in plaintext only in this
       response + the recipient's email; the DB keeps hash + last4.
       A duplicate verify returns the card WITHOUT the code (it can't
       be recovered — by design). */
    const code = generateGiftCardCode();
    const { card, duplicate } = await issueGiftCard({
      code,
      profileId: meta["profile_id"] ?? "",
      productId: meta["product_id"] || null,
      buyerUserId: req.userId!,
      recipientEmail: meta["recipient_email"] ?? "",
      recipientName: meta["recipient_name"] || null,
      message: meta["gift_message"] || null,
      amountCents,
      stripeSessionId: sessionId,
    });

    const profileRes = await db.execute(sql`
      SELECT display_name, slug FROM creator_profiles WHERE id = ${card.profile_id} LIMIT 1
    `);
    const profile = profileRes.rows[0] as Record<string, unknown> | undefined;
    const storeName = profile ? String(profile["display_name"]) : "the creator";
    const storeUrl = profile ? `/artist/${String(profile["slug"])}` : "/";
    /* The delivery email's CTA must be absolute — a site-relative href
       cannot resolve in a real inbox. (The links.storeUrl in the JSON
       response below stays relative: our own frontend consumes it.) */
    const storeEmailUrl = `${baseUrlForEmail()}${storeUrl}`;

    if (!duplicate) {
      /* Delivery: the recipient's email carries the code — the buyer
         never has to forward anything, and the card is a surprise
         until it lands. Best-effort, fail-open (store.ts receipt
         pattern): the buyer's response below also carries the code
         exactly this once. */
      const html = emailShell(
        `You've got a ${emailMoney(amountCents)} gift card`,
        `<p style="margin:0 0 12px;">${escapeHtml(meta["recipient_name"] || "You")} — someone sent you stored value for <strong>${escapeHtml(storeName)}</strong>'s store on Bow Down Visuals.</p>
${meta["gift_message"] ? `<p style="margin:0 0 12px;">“${escapeHtml(meta["gift_message"])}”</p>` : ""}
<div style="background:#f3ecdb;border:1px solid #d9c68d;border-radius:10px;padding:18px 20px;margin:0 0 18px;text-align:center;">
<div style="color:#8a7c5c;font-size:12px;letter-spacing:2px;">YOUR GIFT CARD CODE</div>
<div style="color:#a67c1a;font-weight:700;font-size:24px;letter-spacing:1px;margin-top:6px;">${escapeHtml(code)}</div>
<div style="font-size:14px;margin-top:8px;">Worth <strong>${emailMoney(amountCents)}</strong> — spend it all at once or a little at a time, on anything in ${escapeHtml(storeName)}'s store.</div>
</div>
<p style="margin:0 0 16px;font-size:14px;">At checkout, paste the code in the gift-card field (right beside the discount code). Whatever you don't spend stays on the card.</p>
${emailButton(storeEmailUrl, `Shop ${escapeHtml(storeName)}'s store`)}`
      );
      void sendEmail({
        to: String(card.recipient_email),
        subject: `Your ${emailMoney(amountCents)} gift card for ${storeName}`,
        html,
      }).catch(() => undefined);
    }

    res.json({
      success: true,
      duplicate,
      card: presentCard(card as GiftCardRow, storeName),
      /* Shown to the buyer exactly once, at issuance. A duplicate
         verify cannot re-show it — only the hash is stored. */
      code: duplicate ? null : code,
      codeNote: duplicate
        ? "This card was already issued — its code went to the recipient's email at purchase and can't be shown again."
        : "This code is shown once — it has also been emailed to the recipient.",
      links: { storeUrl, balanceEndpoint: "/api/gift-cards/balance" },
      note: "Gift card = stored value (a liability we hold for the recipient), not revenue: no platform fee was taken and the full amount is spendable in this creator's store.",
    });
  } catch (err) {
    if (err instanceof GiftCardsUnavailable) { unavailable(res); return; }
    logger.error({ err, sessionId }, "[gift-cards] verify failed");
    res.status(500).json({ error: "Payment confirmed but the gift card couldn't be issued. Contact support — your payment is recorded." });
  }
});

/* ═══════════════ BALANCE: lookup by code (public) ═════════════════ */
router.get("/gift-cards/balance", publicApiLimiter, async (req, res) => {
  const code = String(req.query.code ?? "");
  if (!isGiftCardCodeShape(code)) {
    res.status(400).json({ error: "BAD_CODE", message: "That doesn't look like a gift-card code (BDV-XXXX-XXXX-XXXX-XXXX)." });
    return;
  }
  try {
    const card = await findCardByCode(code);
    if (!card) {
      res.status(404).json({ error: "NOT_FOUND", message: "No gift card with that code." });
      return;
    }
    const profileRes = await db.execute(sql`
      SELECT display_name, slug FROM creator_profiles WHERE id = ${card.profile_id} LIMIT 1
    `);
    const profile = profileRes.rows[0] as Record<string, unknown> | undefined;
    res.json({
      card: {
        codeLast4: String(card.code_last4),
        status: String(card.status),
        balanceCents: Number(card.balance_cents),
        balance: formatUsd(Number(card.balance_cents)),
        availableCents: Math.max(0, Number(card.balance_cents) - Number(card.reserved_cents)),
        initialCents: Number(card.initial_cents),
      },
      store: profile
        ? { name: String(profile["display_name"]), url: `/artist/${String(profile["slug"])}` }
        : null,
      note: "Gift-card balance is real-money stored value for this one creator's store — not Visual Bucs.",
    });
  } catch (err) {
    if (err instanceof GiftCardsUnavailable) { unavailable(res); return; }
    logger.error({ err }, "[gift-cards] balance lookup failed");
    res.status(500).json({ error: "Could not check that card." });
  }
});

/* ═══════════════ MINE: buyer + recipient views ════════════════════ */
router.get("/gift-cards/mine", requireAuth, publicApiLimiter, async (req, res) => {
  try {
    const bought = await db.execute(sql`
      SELECT gc.*, cp.display_name AS store_name FROM gift_cards gc
      JOIN creator_profiles cp ON cp.id = gc.profile_id
      WHERE gc.buyer_user_id = ${req.userId!}
      ORDER BY gc.created_at DESC LIMIT 100
    `);
    const email = (req.userEmail ?? "").trim().toLowerCase();
    const received = email
      ? await db.execute(sql`
          SELECT gc.*, cp.display_name AS store_name FROM gift_cards gc
          JOIN creator_profiles cp ON cp.id = gc.profile_id
          WHERE LOWER(gc.recipient_email) = ${email} AND gc.buyer_user_id IS DISTINCT FROM ${req.userId!}
          ORDER BY gc.created_at DESC LIMIT 100
        `)
      : { rows: [] as Record<string, unknown>[] };
    const present = (rows: Record<string, unknown>[]) =>
      rows.map((r) => presentCard(r as unknown as GiftCardRow, String(r["store_name"] ?? "")));
    res.json({ bought: present(bought.rows as Record<string, unknown>[]), received: present(received.rows as Record<string, unknown>[]) });
  } catch (err) {
    if (err instanceof GiftCardsUnavailable) { unavailable(res); return; }
    logger.error({ err, userId: req.userId }, "[gift-cards] mine failed");
    res.status(500).json({ error: "Could not load your gift cards." });
  }
});

/* ═══════════════ SOLD: the seller's money/store desk ══════════════ */
router.get("/gift-cards/sold", requireAuth, publicApiLimiter, async (req, res) => {
  try {
    const profileRes = await db.execute(sql`
      SELECT id, display_name FROM creator_profiles WHERE user_id = ${req.userId!} LIMIT 1
    `);
    const profile = profileRes.rows[0] as Record<string, unknown> | undefined;
    if (!profile) {
      res.status(404).json({ error: "NO_PROFILE", message: "You need a creator profile before you can sell." });
      return;
    }
    const profileId = String(profile["id"]);
    const cards = await db.execute(sql`
      SELECT * FROM gift_cards WHERE profile_id = ${profileId}
      ORDER BY created_at DESC LIMIT 200
    `);
    const totals = await db.execute(sql`
      SELECT
        COALESCE(SUM(initial_cents), 0)::int AS issued_cents,
        COALESCE(SUM(balance_cents) FILTER (WHERE status = 'active'), 0)::int AS outstanding_cents,
        COUNT(*)::int AS card_count
      FROM gift_cards WHERE profile_id = ${profileId}
    `);
    const t = totals.rows[0] as Record<string, unknown>;
    res.json({
      store: { name: String(profile["display_name"]) },
      /* Outstanding = the liability: value sold but not yet redeemed.
         It is NOT the seller's money yet — it becomes a sale (with the
         usual 5% platform fee on the sale's gross) only at redemption. */
      liability: {
        issuedCents: Number(t["issued_cents"] ?? 0), issued: formatUsd(Number(t["issued_cents"] ?? 0)),
        outstandingCents: Number(t["outstanding_cents"] ?? 0), outstanding: formatUsd(Number(t["outstanding_cents"] ?? 0)),
        cardCount: Number(t["card_count"] ?? 0),
        note: "Gift-card value is held as a liability until fans spend it — then it lands as a normal sale in your store, with the standard platform fee on that sale.",
      },
      cards: (cards.rows as Record<string, unknown>[]).map((r) => presentCard(r as unknown as GiftCardRow, String(profile["display_name"]))),
    });
  } catch (err) {
    if (err instanceof GiftCardsUnavailable) { unavailable(res); return; }
    logger.error({ err, userId: req.userId }, "[gift-cards] sold failed");
    res.status(500).json({ error: "Could not load your gift cards." });
  }
});

/* ═══════════════ REFUND: claw back only the unspent balance ══════ */
router.post("/gift-cards/:id/refund", requireAuth, publicApiLimiter, async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid card id." });
    return;
  }
  try {
    const card = await findCardById(id);
    if (!card) {
      res.status(404).json({ error: "Card not found." });
      return;
    }
    if (String(card.buyer_user_id) !== req.userId) {
      res.status(403).json({ error: "Only the buyer can refund this gift card." });
      return;
    }
    if (card.status === "refunded") {
      res.json({ success: true, duplicate: true, refundedCents: 0, refunded: formatUsd(0), note: "This card was already refunded." });
      return;
    }
    const refundable = Math.max(0, Number(card.balance_cents) - Number(card.reserved_cents));
    if (Number(card.reserved_cents) > 0) {
      res.status(409).json({
        error: "CARD_IN_USE",
        message: "Part of this card is being held by a checkout in progress — try again in a few minutes.",
      });
      return;
    }
    if (refundable <= 0) {
      res.status(400).json({
        error: "NOTHING_TO_REFUND",
        message: "This card is fully spent — there's no unspent balance left to refund.",
      });
      return;
    }
    if (!card.stripe_session_id) {
      res.status(400).json({ error: "No payment session is attached to this card — contact support." });
      return;
    }

    /* Money order: Stripe first (idempotent per card), ledger second.
       If Stripe lands and the ledger write fails, the clawback's
       ledger key (refund:{cardId}) + the card's session let support
       reconcile — and a retry re-runs both safely (Stripe replays the
       same refund; the clawback is exactly-once). */
    let stripe: Stripe;
    try {
      stripe = getStripe();
    } catch {
      res.status(500).json({ error: "Payments are not configured yet." });
      return;
    }
    const session = await stripe.checkout.sessions.retrieve(String(card.stripe_session_id));
    const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
    if (!pi) {
      res.status(400).json({ error: "No payment is attached to this card — contact support." });
      return;
    }
    await stripe.refunds.create(
      { payment_intent: pi, amount: refundable },
      { idempotencyKey: `giftcard-refund:${id}` },
    );
    const clawed = await clawbackUnspentBalance(id);
    if (!clawed) {
      res.status(409).json({ error: "The card changed while refunding — contact support with this card's last 4 digits." });
      return;
    }
    logger.info({ userId: req.userId, cardId: id, refundedCents: clawed.refundedCents }, "[gift-cards] purchase refunded (unspent clawback)");
    res.json({
      success: true,
      duplicate: clawed.duplicate,
      refundedCents: clawed.refundedCents,
      refunded: formatUsd(clawed.refundedCents),
      spentKeptCents: Number(card.initial_cents) - Number(card.balance_cents),
      note: "Only the unspent balance was refunded — what the recipient already spent stays spent, and the card is now closed.",
    });
  } catch (err) {
    if (err instanceof GiftCardsUnavailable) { unavailable(res); return; }
    logger.error({ err, cardId: id }, "[gift-cards] refund failed");
    res.status(500).json({ error: "Could not refund this gift card." });
  }
});

/* Re-exported for the checkout rails: hash lookup is how they find the
   card a buyer pasted beside the discount-code field. */
export { hashGiftCardCode };
export default router;
