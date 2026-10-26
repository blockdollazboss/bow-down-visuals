/**
 * gift-product.ts — Gift-This-Product (Wave-4 #45). Docks inside the
 * existing store surfaces — NO standalone page:
 *   - buy:    the storefront product page's "Send as a gift" panel
 *             posts here; the product, its real listed price and the
 *             flat 5% fee all come from the existing storefront rail.
 *   - claim:  the recipient finds the gift in their existing bell
 *             notifications + their Library ("Gifts for you") and
 *             claims it there; the claim writes their store_orders
 *             row, so the product lands in the SAME purchases/library
 *             every other storefront order uses.
 *   - resend: the buyer's sent list (same /mine payload) re-sends an
 *             unclaimed gift's delivery notification.
 *
 * Endpoints:
 *   POST /product-gifts/purchase   auth: buy a product as a gift
 *                                  (Visual Bucs, existing credits rail)
 *   GET  /product-gifts/mine       auth: gifts sent to me + by me
 *                                  (runs the delivery sweep first)
 *   POST /product-gifts/:id/claim  auth (recipient): claim → my order
 *   POST /product-gifts/:id/resend auth (buyer): re-notify recipient
 *
 * Money law lives in lib/gift-product.ts: gift price = the product's
 * real listed price (VB at the x100 rule), flat 5% fee recorded at
 * purchase and settled once at claim, exactly-once charge + claim,
 * unclaimed value held as the recipient's claimable credit — never
 * silently kept. ⚠️ Until provisional migration 9999 lands, endpoints
 * answer 503 PRODUCT_GIFTS_UNAVAILABLE — money fails closed.
 */
import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { formatUsd } from "../lib/platform-fees";
import { sendEmail, emailShell, emailButton, money as emailMoney, escapeHtml, baseUrlForEmail } from "../lib/email";
import {
  chargeCredits,
  refundCredits,
  buildChargeIdempotencyKey,
  OutOfCreditsError,
  CreditsDisabledError,
  LedgerWriteError,
} from "../lib/credits";
import {
  ProductGiftsUnavailable,
  validateGiftInput,
  giftGrossCents,
  createProductGift,
  findGiftById,
  findGiftByIdempotencyKey,
  sweepDueGifts,
  listGiftsForRecipient,
  listGiftsSentByBuyer,
  claimProductGift,
  attachClaimOrder,
  recordResend,
  canResend,
  giftBelongsToRecipient,
  stampDelivered,
  presentGift,
  type GiftRow,
} from "../lib/gift-product";

const router = Router();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unavailable(res: import("express").Response) {
  res.status(503).json({
    error: "PRODUCT_GIFTS_UNAVAILABLE",
    message: "Gifting isn't live yet — it'll open with the store's next update. Nothing was charged.",
  });
}

interface ProductRow extends Record<string, unknown> {
  id: string; profile_id: string; kind: string; title: string;
  price_cents: number; is_active: boolean; inventory: number;
  artist_name: string; artist_slug: string;
}

async function fetchProduct(id: string): Promise<ProductRow | null> {
  const r = await db.execute(sql`
    SELECT sp.*, cp.display_name AS artist_name, cp.slug AS artist_slug
    FROM store_products sp
    JOIN creator_profiles cp ON cp.id = sp.profile_id
    WHERE sp.id = ${id} AND sp.is_active = true
    LIMIT 1
  `);
  return (r.rows[0] as unknown as ProductRow | undefined) ?? null;
}

/** Best-effort member resolution by email (the profiles mirror).
 *  A miss is fine: the gift is addressed by email and matches the
 *  recipient's account email when they claim. */
async function resolveRecipientUserId(email: string): Promise<string | null> {
  try {
    const r = await db.execute(sql`
      SELECT id FROM profiles WHERE LOWER(email) = ${email} LIMIT 1
    `);
    const row = r.rows[0] as Record<string, unknown> | undefined;
    return row ? String(row["id"]) : null;
  } catch {
    return null;
  }
}

async function buyerDisplayName(userId: string): Promise<string> {
  try {
    const r = await db.execute(sql`
      SELECT display_name FROM creator_profiles WHERE user_id = ${userId} LIMIT 1
    `);
    const row = r.rows[0] as Record<string, unknown> | undefined;
    return row ? String(row["display_name"]) : "A member";
  } catch {
    return "A member";
  }
}

/** Deliver a gift's notification: bell (when the recipient is a known
 *  member) + the gift email family. Best-effort, fail-open — the gift
 *  itself is already recorded and claimable from the Library. */
async function notifyRecipient(gift: GiftRow, storeName: string): Promise<void> {
  const claimUrl = "/library";
  if (gift.recipient_user_id) {
    try {
      await db.execute(sql`
        INSERT INTO notifications (user_id, kind, title, body, link)
        VALUES (${gift.recipient_user_id}, 'gift_product',
                ${`You received a gift: ${gift.product_title}`},
                ${gift.gift_message ? `“${gift.gift_message}” — claim it in your Library.` : "Claim it in your Library — it's yours, held for you until you do."},
                ${claimUrl})
      `);
    } catch (err) {
      logger.warn({ err, giftId: gift.id }, "[gift-product] bell notification failed (gift still claimable)");
    }
  }
  const senderName = await buyerDisplayName(String(gift.buyer_user_id));
  const html = emailShell(
    `${senderName} sent you ${escapeHtml(String(gift.product_title))}`,
    `<p style="margin:0 0 12px;">${escapeHtml(senderName)} bought you <strong>${escapeHtml(String(gift.product_title))}</strong> from <strong>${escapeHtml(storeName)}</strong>'s store on Bow Down Visuals — as a gift.</p>
${gift.gift_message ? `<p style="margin:0 0 12px;">“${escapeHtml(String(gift.gift_message))}”</p>` : ""}
<p style="margin:0 0 16px;font-size:14px;">It's paid for and held for you — worth ${emailMoney(Number(gift.amount_cents))} — until you claim it. Claiming puts it in your Library, in your name, and there's no deadline: unclaimed gifts stay yours, they never expire into anyone else's pocket.</p>
${emailButton(`${baseUrlForEmail()}${claimUrl}`, "Claim your gift")}`,
  );
  void sendEmail({
    to: String(gift.recipient_email),
    subject: `You received a gift: ${String(gift.product_title)}`,
    html,
  }).catch(() => undefined);
}

/* ═══════════════ PURCHASE: buy a product as a gift ═══════════════ */
const PurchaseSchema = z.object({
  productId: z.string().regex(UUID_RE, "productId must be a UUID"),
  recipientEmail: z.string().trim().email().max(254),
  recipientUserId: z.string().regex(UUID_RE).optional(),
  giftMessage: z.string().trim().max(500).optional(),
  /* ISO delivery moment; omitted = deliver now. */
  deliveryAt: z.string().datetime().optional(),
  quantity: z.number().int().min(1).max(99).default(1),
  /* Client-generated per purchase intent (double-tap safe). */
  idempotencyKey: z.string().trim().min(8).max(200).optional(),
});

router.post("/product-gifts/purchase", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = PurchaseSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request.", details: parsed.error.issues });
    return;
  }
  const { productId } = parsed.data;
  try {
    const p = await fetchProduct(productId);
    if (!p) {
      res.status(404).json({ error: "NOT_FOR_SALE", message: "This product isn't for sale right now." });
      return;
    }
    if (p.kind === "gift_card") {
      res.status(400).json({
        error: "GIFT_CARD_CHECKOUT",
        message: "Gift cards are bought on their own gift-card checkout — this panel gifts the product itself.",
      });
      return;
    }
    if (p.kind === "service") {
      res.status(400).json({
        error: "NOT_GIFTABLE",
        message: "Services are booked for a specific time, so they can't be sent as a gift yet — gift a product instead.",
      });
      return;
    }
    if (Number(p.price_cents) === 0) {
      res.status(400).json({
        error: "FREE_PRODUCT",
        message: "This product is free — just send your friend the link and they can claim it themselves.",
      });
      return;
    }
    const inventory = Number(p.inventory);
    if (inventory === 0) {
      res.status(400).json({ error: "SOLD_OUT", message: "This one just sold out — the creator's restocking." });
      return;
    }
    if (inventory > 0 && parsed.data.quantity > inventory) {
      res.status(400).json({ error: "INSUFFICIENT_INVENTORY", message: `Only ${inventory} left.` });
      return;
    }
    if (p.kind === "course" && parsed.data.quantity !== 1) {
      res.status(400).json({ error: "COURSE_SINGLE", message: "A course gift is one unlock for one person — quantity is 1." });
      return;
    }

    const valid = validateGiftInput({
      recipientEmail: parsed.data.recipientEmail,
      buyerEmail: req.userEmail ?? null,
      giftMessage: parsed.data.giftMessage ?? null,
      deliveryAt: parsed.data.deliveryAt ?? null,
      quantity: parsed.data.quantity,
    });
    if (!valid.ok) {
      res.status(400).json({ error: "BAD_GIFT", message: valid.error });
      return;
    }
    if (parsed.data.recipientUserId && parsed.data.recipientUserId === req.userId) {
      res.status(400).json({ error: "BAD_GIFT", message: "A gift goes to someone else — pick a different recipient." });
      return;
    }

    const grossCents = giftGrossCents(Number(p.price_cents), valid.quantity);
    const giftKey = buildChargeIdempotencyKey("gift-product", req.userId!, parsed.data.idempotencyKey ?? null, {
      productId, recipientEmail: valid.recipientEmail, quantity: valid.quantity,
      deliveryAt: valid.deliveryAt.toISOString(), giftMessage: valid.giftMessage,
    });

    /* Fail closed BEFORE any charge if the gift tables aren't live
       (provisional migration): this read touches product_gifts on
       purpose, and a replay short-circuits here too — no charge. */
    const existing = await findGiftByIdempotencyKey(giftKey);
    if (existing) {
      res.json({
        success: true, duplicate: true,
        gift: presentGift(existing, { storeName: String(p.artist_name) }),
        note: "This exact gift was already sent — you weren't charged twice.",
      });
      return;
    }

    const recipientUserId = parsed.data.recipientUserId
      ?? (await resolveRecipientUserId(valid.recipientEmail));

    /* The charge: Visual Bucs on the existing credits rail, with the
       same idempotency key the gift row carries — a retry after this
       point replays against both guards and deducts nothing twice. */
    let balanceAfter: number;
    try {
      balanceAfter = await chargeCredits(
        req.userId!,
        grossCents,
        { action: `Gift product — ${String(p.title)}` },
        { idempotencyKey: giftKey },
      );
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: `This gift costs ${grossCents} Visual Bucs (the product's ${formatUsd(grossCents)} listed price) — top up and try again.`,
          neededCredits: grossCents,
        });
        return;
      }
      if (err instanceof CreditsDisabledError) {
        res.status(403).json({ error: "credits_disabled", message: "Credit spending is paused right now." });
        return;
      }
      if (err instanceof LedgerWriteError) {
        res.status(500).json({ error: "ledger_write_failed", message: "The charge couldn't be recorded, so it was rolled back — nothing was spent." });
        return;
      }
      throw err;
    }

    let created: Awaited<ReturnType<typeof createProductGift>>;
    try {
      created = await createProductGift({
        productId: p.id, profileId: p.profile_id, productTitle: String(p.title),
        productKind: String(p.kind), buyerUserId: req.userId!,
        recipientUserId, recipientEmail: valid.recipientEmail,
        giftMessage: valid.giftMessage, quantity: valid.quantity,
        priceCents: Number(p.price_cents), deliveryAt: valid.deliveryAt,
        idempotencyKey: giftKey,
      });
    } catch (err) {
      /* The charge landed but the gift row didn't: refund in full so
         no one pays for a gift that doesn't exist. */
      await refundCredits(req.userId!, grossCents, { action: `Gift product — refund (gift record failed) — ${String(p.title)}` }).catch(() => undefined);
      throw err;
    }
    if (created.duplicate) {
      /* A concurrent twin won the insert; its charge was the deduped
         one (same key), so this balance is already correct. */
      res.json({
        success: true, duplicate: true,
        gift: presentGift(created.gift, { storeName: String(p.artist_name) }),
        balanceAfter,
        note: "This exact gift was already sent — you weren't charged twice.",
      });
      return;
    }

    const gift = created.gift;
    if (valid.deliveryAt.getTime() <= Date.now()) {
      await notifyRecipient(gift, String(p.artist_name));
      await stampDelivered(gift.id).catch(() => undefined);
      gift.delivered_at = new Date().toISOString();
    }
    logger.info({ userId: req.userId, giftId: gift.id, productId, grossCents }, "[gift-product] gift purchased");
    res.status(201).json({
      success: true, duplicate: false,
      gift: presentGift(gift, { storeName: String(p.artist_name) }),
      chargedCredits: grossCents,
      balanceAfter,
      note: valid.deliveryAt.getTime() <= Date.now()
        ? `Sent — ${formatUsd(grossCents)} of value is held for ${valid.recipientEmail} until they claim it in their Library. The store's standard 5% platform fee comes out of the seller's side at claim, exactly like a normal sale — you paid the listed price, nothing more.`
        : `Scheduled — your gift lands on ${valid.deliveryAt.toISOString().slice(0, 10)} and is held for ${valid.recipientEmail} until they claim it.`,
    });
  } catch (err) {
    if (err instanceof ProductGiftsUnavailable) { unavailable(res); return; }
    logger.error({ err, productId }, "[gift-product] purchase failed");
    res.status(500).json({ error: "Could not send this gift." });
  }
});

/* ═══════════════ MINE: received + sent (delivery sweep first) ════ */
router.get("/product-gifts/mine", requireAuth, publicApiLimiter, async (req, res) => {
  try {
    const flipped = await sweepDueGifts(req.userId!, req.userEmail ?? null);
    for (const gift of flipped) {
      await notifyRecipient(gift, gift.store_name ? String(gift.store_name) : "the creator");
    }
    const [received, sent] = await Promise.all([
      listGiftsForRecipient(req.userId!, req.userEmail ?? null),
      listGiftsSentByBuyer(req.userId!),
    ]);
    res.json({
      received: received.map((g) => presentGift(g)),
      sent: sent.map((g) => presentGift(g)),
      note: "Unclaimed gifts stay held as your claimable credit — they never expire into anyone else's pocket.",
    });
  } catch (err) {
    if (err instanceof ProductGiftsUnavailable) { unavailable(res); return; }
    logger.error({ err, userId: req.userId }, "[gift-product] mine failed");
    res.status(500).json({ error: "Could not load your gifts." });
  }
});

/* ═══════════════ CLAIM: settle into the recipient's orders ═══════ */
router.post("/product-gifts/:id/claim", requireAuth, publicApiLimiter, async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid gift id." });
    return;
  }
  try {
    const gift = await findGiftById(id);
    /* A non-recipient reads as not-found — gift existence is never
       leaked across accounts (storefront fetchOwnOrder pattern). */
    if (!gift || !giftBelongsToRecipient(gift, req.userId!, req.userEmail ?? null)) {
      res.status(404).json({ error: "Gift not found." });
      return;
    }
    if (gift.status === "claimed") {
      res.json({
        success: true, duplicate: true,
        gift: presentGift(gift),
        orderId: gift.claim_order_id ? String(gift.claim_order_id) : null,
        note: "Already claimed — it's in your purchases.",
      });
      return;
    }
    if (new Date(gift.delivery_at).getTime() > Date.now()) {
      res.status(409).json({
        error: "NOT_DELIVERED",
        message: "This gift hasn't landed yet — it unlocks on its delivery date.",
        deliveryAt: String(gift.delivery_at),
      });
      return;
    }

    const claimed = await claimProductGift(id);
    if (!claimed) {
      /* Lost a race with a twin claim: read back the settled gift. */
      const settled = await findGiftById(id);
      if (settled && settled.status === "claimed") {
        res.json({
          success: true, duplicate: true,
          gift: presentGift(settled),
          orderId: settled.claim_order_id ? String(settled.claim_order_id) : null,
          note: "Already claimed — it's in your purchases.",
        });
        return;
      }
      res.status(409).json({ error: "CLAIM_FAILED", message: "This gift couldn't be claimed just now — try again." });
      return;
    }

    /* The settlement: the recipient's own store_orders row carrying
       the split recorded at purchase (flat 5% fee — settled here,
       exactly once, never re-split). 'gift:{id}' is UNIQUE, so a
       replayed claim can never write a second order. */
    const sessionKey = `gift:${id}`;
    const inserted = await db.execute(sql`
      INSERT INTO store_orders
        (buyer_user_id, profile_id, product_id, product_title, product_kind,
         quantity, amount_cents, platform_fee_cents, creator_amount_cents,
         stripe_session_id, status, fulfillment_note)
      VALUES (${req.userId!}, ${claimed.profile_id}, ${claimed.product_id},
              ${claimed.product_title}, ${claimed.product_kind}, ${Number(claimed.quantity)},
              ${Number(claimed.amount_cents)}, ${Number(claimed.platform_fee_cents)},
              ${Number(claimed.creator_amount_cents)}, ${sessionKey}, 'completed',
              'Received as a gift')
      ON CONFLICT (stripe_session_id) DO NOTHING
      RETURNING id
    `);
    let orderId = (inserted.rows[0] as Record<string, unknown> | undefined)?.["id"];
    if (!orderId) {
      const existingOrder = await db.execute(sql`
        SELECT id FROM store_orders WHERE stripe_session_id = ${sessionKey} LIMIT 1
      `);
      orderId = (existingOrder.rows[0] as Record<string, unknown> | undefined)?.["id"];
    }
    if (orderId) await attachClaimOrder(id, String(orderId)).catch(() => undefined);
    claimed.claim_order_id = orderId ? String(orderId) : null;

    logger.info({ userId: req.userId, giftId: id, orderId }, "[gift-product] gift claimed");
    res.json({
      success: true, duplicate: false,
      gift: presentGift(claimed),
      orderId: orderId ? String(orderId) : null,
      purchasesUrl: "/library",
      note: "Claimed — it's in your Library purchases now, in your name. The seller's standard 5% platform fee settled from the gift's recorded split; nothing was charged to you.",
    });
  } catch (err) {
    if (err instanceof ProductGiftsUnavailable) { unavailable(res); return; }
    logger.error({ err, giftId: id }, "[gift-product] claim failed");
    res.status(500).json({ error: "Could not claim this gift." });
  }
});

/* ═══════════════ RESEND: buyer nudges an unclaimed gift ═════════ */
router.post("/product-gifts/:id/resend", requireAuth, publicApiLimiter, async (req, res) => {
  const id = String(req.params.id ?? "");
  if (!UUID_RE.test(id)) {
    res.status(400).json({ error: "Invalid gift id." });
    return;
  }
  try {
    const gift = await findGiftById(id);
    if (!gift || String(gift.buyer_user_id) !== req.userId) {
      res.status(404).json({ error: "Gift not found." });
      return;
    }
    const check = canResend(gift);
    if (!check.ok) {
      res.status(409).json({ error: "CANNOT_RESEND", message: check.reason });
      return;
    }
    const updated = await recordResend(id);
    if (!updated) {
      res.status(409).json({ error: "CANNOT_RESEND", message: "This gift can't be re-sent right now." });
      return;
    }
    await notifyRecipient(updated, updated.store_name ? String(updated.store_name) : "the creator");
    logger.info({ userId: req.userId, giftId: id, resendCount: updated.resend_count }, "[gift-product] gift delivery re-sent");
    res.json({
      success: true,
      gift: presentGift(updated),
      note: `Re-sent to ${String(updated.recipient_email)} — the gift is still held for them, worth ${formatUsd(Number(updated.amount_cents))}, until they claim it.`,
    });
  } catch (err) {
    if (err instanceof ProductGiftsUnavailable) { unavailable(res); return; }
    logger.error({ err, giftId: id }, "[gift-product] resend failed");
    res.status(500).json({ error: "Could not re-send this gift." });
  }
});

export default router;
