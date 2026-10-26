/**
 * gift-product.ts — Gift-This-Product (Wave-4 #45): buy a REAL store
 * product as a gift for another member.
 *
 * This rides the existing rails — it is NOT a second gift machine:
 *  - Product + price come from the seller's existing store_products
 *    row (storefront rail). The gift price is the product's real
 *    listed price × quantity — never invented, never marked up.
 *  - Payment is Visual Bucs through lib/credits.ts chargeCredits
 *    (the test-mode credits rail), charged exactly once: the charge
 *    carries a credit_usage idempotency key AND product_gifts has a
 *    UNIQUE idempotency_key, so retries cannot double-charge or
 *    double-create.
 *  - The store's FLAT 5% platform fee (lib/platform-fees.ts feeSplit,
 *    500 bps) is computed on the full gross at purchase, recorded on
 *    the gift row, and settled exactly once when the recipient claims
 *    — the claim writes the recipient's store_orders row with those
 *    recorded split amounts (stripe_session_id 'gift:{id}', UNIQUE).
 *    Gifts change nothing about the fee.
 *  - Stored-value gift CARDS (lib/gift-cards.ts) are a different
 *    product (store credit) and are untouched by this module.
 *
 * UNCLAIMED RULE (honest, chosen by this lane and flagged at join):
 * the paid value is HELD on the gift row as the recipient's
 * claimable credit (claimable_cents = amount_cents). It never
 * expires into platform or seller revenue, the seller split is not
 * settled until claim, and the recipient can claim at any time.
 * Nothing is ever silently kept.
 *
 * Delivery: the buyer may schedule a future delivery moment. A gift
 * becomes claimable at delivery; delivery is swept on read (the
 * gift-cards reservation pattern — no cron): listing a recipient's
 * gifts flips due gifts to awaiting_claim and fires the bell
 * notification + the gift email exactly once (delivered_at gate).
 *
 * Queries use raw SQL via db.execute(sql``) — the storefront/store
 * convention (pg-mem cannot run the drizzle query builder).
 * ⚠️ PROVISIONAL MIGRATION 9999-gift-product.sql: until it lands,
 * every DB helper throws ProductGiftsUnavailable and routes answer
 * 503 — money fails closed.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { feeSplit } from "./platform-fees";

/* ── Pure helpers (unit-tested without a DB) ──────────────────────── */

/** Visual Bucs charged for a gift: the house x100 rule — a product's
 *  price_cents IS its Visual Bucs price (real-money value unchanged). */
export function giftPriceCredits(priceCents: number, quantity: number): number {
  const p = Math.max(0, Math.floor(priceCents));
  const q = Math.max(1, Math.floor(quantity));
  return p * q;
}

/** Gross in cents for a gift line: listed price × quantity. */
export function giftGrossCents(priceCents: number, quantity: number): number {
  return giftPriceCredits(priceCents, quantity);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const GIFT_MESSAGE_MAX = 500;
export const GIFT_MAX_DELIVERY_DAYS = 365;

export interface GiftInput {
  recipientEmail: string;
  buyerEmail: string | null;
  giftMessage?: string | null;
  deliveryAt?: string | null;
  quantity: number;
}

export function validateGiftInput(
  input: GiftInput,
  now: Date = new Date(),
): { ok: true; recipientEmail: string; giftMessage: string | null; deliveryAt: Date; quantity: number } | { ok: false; error: string } {
  const recipientEmail = String(input.recipientEmail ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(recipientEmail) || recipientEmail.length > 254) {
    return { ok: false, error: "Enter the recipient's email — that's where the gift is delivered." };
  }
  if (input.buyerEmail && recipientEmail === input.buyerEmail.trim().toLowerCase()) {
    return { ok: false, error: "A gift goes to someone else — enter their email, not yours." };
  }
  const giftMessage = input.giftMessage ? String(input.giftMessage).trim().slice(0, GIFT_MESSAGE_MAX) || null : null;
  const quantity = Math.floor(input.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    return { ok: false, error: "Quantity must be between 1 and 99." };
  }
  let deliveryAt = now;
  if (input.deliveryAt) {
    const parsed = new Date(input.deliveryAt);
    if (Number.isNaN(parsed.getTime())) return { ok: false, error: "That delivery date doesn't parse." };
    deliveryAt = parsed;
    if (deliveryAt.getTime() > now.getTime() + GIFT_MAX_DELIVERY_DAYS * 86_400_000) {
      return { ok: false, error: "Delivery can be scheduled at most a year out." };
    }
    /* A moment slightly in the past (clock skew / slow tap) delivers now. */
    if (deliveryAt.getTime() < now.getTime() - 5 * 60_000) {
      return { ok: false, error: "That delivery date is in the past — pick today or later." };
    }
  }
  return { ok: true, recipientEmail, giftMessage, deliveryAt, quantity };
}

/** Status a gift should present as, given its stored status + clock. */
export function effectiveStatus(
  gift: Pick<GiftRow, "status" | "delivery_at">,
  now: Date = new Date(),
): "scheduled" | "awaiting_claim" | "claimed" {
  if (gift.status === "claimed") return "claimed";
  return new Date(gift.delivery_at).getTime() <= now.getTime() ? "awaiting_claim" : "scheduled";
}

/** Unclaimed-gift resend throttle: one resend per hour per gift —
 *  enough to nudge, never enough to spam an inbox. */
export const RESEND_COOLDOWN_MS = 60 * 60 * 1000;
export function canResend(
  gift: Pick<GiftRow, "status" | "delivery_at" | "last_resent_at" | "delivered_at">,
  now: Date = new Date(),
): { ok: boolean; reason?: string } {
  if (gift.status === "claimed") return { ok: false, reason: "This gift was already claimed." };
  if (effectiveStatus(gift, now) !== "awaiting_claim") {
    return { ok: false, reason: "This gift hasn't been delivered yet — resend opens once it lands." };
  }
  const last = gift.last_resent_at ?? gift.delivered_at;
  if (last && now.getTime() - new Date(last).getTime() < RESEND_COOLDOWN_MS) {
    return { ok: false, reason: "That gift was just re-sent — give it an hour before nudging again." };
  }
  return { ok: true };
}

/* ── Fail-closed plumbing (gift-cards.ts pattern) ─────────────────── */

export class ProductGiftsUnavailable extends Error {
  constructor() {
    super("Product gifts are not available yet.");
    this.name = "ProductGiftsUnavailable";
  }
}

function rethrowGiftErrors(err: unknown): never {
  const e = err as { code?: string; message?: string };
  const msg = e?.message ?? "";
  if (e?.code === "42P01" || e?.code === "42703" || /relation "product_gift|column .*product_gift/i.test(msg)) {
    throw new ProductGiftsUnavailable();
  }
  throw err;
}

async function exec(query: Parameters<typeof db.execute>[0]) {
  try {
    return await db.execute(query);
  } catch (err) {
    rethrowGiftErrors(err);
  }
}

/* ── Rows ─────────────────────────────────────────────────────────── */

export interface GiftRow extends Record<string, unknown> {
  id: string;
  product_id: string | null;
  profile_id: string;
  product_title: string;
  product_kind: string;
  buyer_user_id: string;
  recipient_user_id: string | null;
  recipient_email: string;
  gift_message: string | null;
  quantity: number;
  amount_cents: number;
  credits_charged: number;
  platform_fee_cents: number;
  creator_amount_cents: number;
  claimable_cents: number;
  idempotency_key: string;
  status: string;
  delivery_at: string;
  delivered_at: string | null;
  claimed_at: string | null;
  claim_order_id: string | null;
  resend_count: number;
  last_resent_at: string | null;
  created_at: string;
}

/** Create the gift row + its charge ledger row, exactly once per
 *  idempotency key. A replay returns the existing row uncharged. */
export async function createProductGift(args: {
  productId: string;
  profileId: string;
  productTitle: string;
  productKind: string;
  buyerUserId: string;
  recipientUserId: string | null;
  recipientEmail: string;
  giftMessage: string | null;
  quantity: number;
  priceCents: number;
  deliveryAt: Date;
  idempotencyKey: string;
}): Promise<{ gift: GiftRow; duplicate: boolean }> {
  const gross = giftGrossCents(args.priceCents, args.quantity);
  const split = feeSplit(gross);
  const status = args.deliveryAt.getTime() <= Date.now() ? "awaiting_claim" : "scheduled";
  const inserted = await exec(sql`
    INSERT INTO product_gifts
      (product_id, profile_id, product_title, product_kind, buyer_user_id,
       recipient_user_id, recipient_email, gift_message, quantity,
       amount_cents, credits_charged, platform_fee_cents, creator_amount_cents,
       claimable_cents, idempotency_key, status, delivery_at)
    VALUES (${args.productId}, ${args.profileId}, ${args.productTitle}, ${args.productKind},
            ${args.buyerUserId}, ${args.recipientUserId}, ${args.recipientEmail},
            ${args.giftMessage}, ${args.quantity}, ${gross}, ${gross},
            ${split.fee}, ${split.net}, ${gross}, ${args.idempotencyKey},
            ${status}, ${args.deliveryAt.toISOString()})
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING *
  `);
  if (inserted.rows.length === 0) {
    const existing = await exec(sql`
      SELECT * FROM product_gifts WHERE idempotency_key = ${args.idempotencyKey} LIMIT 1
    `);
    return { gift: existing.rows[0] as unknown as GiftRow, duplicate: true };
  }
  const gift = inserted.rows[0] as unknown as GiftRow;
  await exec(sql`
    INSERT INTO product_gift_ledger (gift_id, kind, amount_cents, ref, idempotency_key)
    VALUES (${gift.id}, 'charge', ${gross}, ${args.buyerUserId}, ${`charge:${args.idempotencyKey}`})
    ON CONFLICT (idempotency_key) DO NOTHING
  `);
  return { gift, duplicate: false };
}

export async function findGiftById(id: string): Promise<GiftRow | null> {
  const r = await exec(sql`SELECT * FROM product_gifts WHERE id = ${id} LIMIT 1`);
  return (r.rows[0] as unknown as GiftRow | undefined) ?? null;
}

export async function findGiftByIdempotencyKey(key: string): Promise<GiftRow | null> {
  const r = await exec(sql`SELECT * FROM product_gifts WHERE idempotency_key = ${key} LIMIT 1`);
  return (r.rows[0] as unknown as GiftRow | undefined) ?? null;
}

/** Does this gift belong to this recipient (by member id or by the
 *  account email it was addressed to)? */
export function giftBelongsToRecipient(
  gift: Pick<GiftRow, "recipient_user_id" | "recipient_email">,
  userId: string,
  userEmail: string | null,
): boolean {
  if (gift.recipient_user_id && gift.recipient_user_id === userId) return true;
  return !!userEmail && gift.recipient_email.toLowerCase() === userEmail.trim().toLowerCase();
}

/**
 * Delivery sweep (on read): flip due scheduled gifts to
 * awaiting_claim. Returns ONLY the gifts this call flipped, so the
 * caller notifies each exactly once — delivered_at is the gate and
 * is stamped in the same UPDATE.
 */
export async function sweepDueGifts(recipientUserId: string, recipientEmail: string | null): Promise<GiftRow[]> {
  const email = (recipientEmail ?? "").trim().toLowerCase();
  const flipped = await exec(sql`
    UPDATE product_gifts
    SET status = 'awaiting_claim', delivered_at = now(), updated_at = now()
    WHERE status = 'scheduled' AND delivery_at <= now()
      AND (recipient_user_id = ${recipientUserId}
           OR (${email} <> '' AND LOWER(recipient_email) = ${email}))
    RETURNING *
  `);
  return flipped.rows as unknown as GiftRow[];
}

export async function listGiftsForRecipient(userId: string, userEmail: string | null): Promise<GiftRow[]> {
  const email = (userEmail ?? "").trim().toLowerCase();
  const r = await exec(sql`
    SELECT * FROM product_gifts
    WHERE recipient_user_id = ${userId}
       OR (${email} <> '' AND LOWER(recipient_email) = ${email})
    ORDER BY created_at DESC LIMIT 100
  `);
  return r.rows as unknown as GiftRow[];
}

export async function listGiftsSentByBuyer(userId: string): Promise<GiftRow[]> {
  const r = await exec(sql`
    SELECT * FROM product_gifts WHERE buyer_user_id = ${userId}
    ORDER BY created_at DESC LIMIT 100
  `);
  return r.rows as unknown as GiftRow[];
}

/**
 * Claim a gift, exactly once. The conditional UPDATE is the guard:
 * only an unclaimed, delivered gift flips, and the flip stamps the
 * settlement — claimable_cents goes to 0 in the same write. The
 * caller then writes the recipient's store_orders row under the
 * UNIQUE session key 'gift:{id}'; if that insert reports a conflict
 * the claim had already settled and the order already exists.
 */
export async function claimProductGift(giftId: string): Promise<GiftRow | null> {
  const updated = await exec(sql`
    UPDATE product_gifts
    SET status = 'claimed', claimed_at = now(), claimable_cents = 0, updated_at = now()
    WHERE id = ${giftId} AND status <> 'claimed' AND delivery_at <= now()
    RETURNING *
  `);
  const gift = (updated.rows[0] as unknown as GiftRow | undefined) ?? null;
  if (!gift) return null;
  await exec(sql`
    INSERT INTO product_gift_ledger (gift_id, kind, amount_cents, ref, idempotency_key)
    VALUES (${gift.id}, 'claim_settle', ${Number(gift.amount_cents)}, ${String(gift.recipient_user_id ?? gift.recipient_email)}, ${`claim:${gift.id}`})
    ON CONFLICT (idempotency_key) DO NOTHING
  `);
  return gift;
}

/** Attach the claim's store_orders row id back onto the gift. */
export async function attachClaimOrder(giftId: string, orderId: string): Promise<void> {
  await exec(sql`
    UPDATE product_gifts SET claim_order_id = ${orderId}, updated_at = now()
    WHERE id = ${giftId} AND claim_order_id IS NULL
  `);
}

/** Record a resend of the delivery notification (buyer nudge). The
 *  conditional UPDATE enforces the cooldown atomically. */
export async function recordResend(giftId: string): Promise<GiftRow | null> {
  const gift = await findGiftById(giftId);
  if (!gift) return null;
  const check = canResend(gift);
  if (!check.ok) return null;
  const updated = await exec(sql`
    UPDATE product_gifts
    SET resend_count = resend_count + 1, last_resent_at = now(), updated_at = now()
    WHERE id = ${giftId} AND status <> 'claimed'
    RETURNING *
  `);
  const row = (updated.rows[0] as unknown as GiftRow | undefined) ?? null;
  if (!row) return null;
  await exec(sql`
    INSERT INTO product_gift_ledger (gift_id, kind, amount_cents, ref, idempotency_key)
    VALUES (${giftId}, 'resend', 0, ${String(gift.buyer_user_id)}, ${`resend:${giftId}:${Number(row.resend_count)}`})
    ON CONFLICT (idempotency_key) DO NOTHING
  `);
  return row;
}

/** Public-safe gift view. Never exposes the buyer's email; the
 *  recipient sees who sent it only via the buyer's display name the
 *  route resolves separately. */
export function presentGift(gift: GiftRow, opts?: { storeName?: string | null; productUrl?: string | null }) {
  return {
    id: String(gift.id),
    productId: gift.product_id ? String(gift.product_id) : null,
    productTitle: String(gift.product_title),
    productKind: String(gift.product_kind),
    storeName: opts?.storeName ?? null,
    productUrl: opts?.productUrl ?? (gift.product_id ? `/storefront/product/${gift.product_id}` : null),
    giftMessage: gift.gift_message ? String(gift.gift_message) : null,
    quantity: Number(gift.quantity),
    amountCents: Number(gift.amount_cents),
    creditsCharged: Number(gift.credits_charged),
    platformFeeCents: Number(gift.platform_fee_cents),
    creatorAmountCents: Number(gift.creator_amount_cents),
    /* While unclaimed this is the recipient's held claimable credit. */
    claimableCents: Number(gift.claimable_cents),
    status: effectiveStatus(gift),
    deliveryAt: String(gift.delivery_at),
    deliveredAt: gift.delivered_at ? String(gift.delivered_at) : null,
    claimedAt: gift.claimed_at ? String(gift.claimed_at) : null,
    claimOrderId: gift.claim_order_id ? String(gift.claim_order_id) : null,
    resendCount: Number(gift.resend_count),
    createdAt: String(gift.created_at),
  };
}
