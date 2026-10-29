/**
 * market-sale.ts — the shared paid-flip for Marketplace (customer shop)
 * sales, migration 0146.
 *
 * A card checkout through POST /api/storefronts/checkout writes its lines
 * into shop_events as event_type='pending_sale' BEFORE the Stripe session
 * opens. Those rows are NOT sales: analytics, earnings and payouts only
 * ever read event_type='sale'. The flip below is the one and only path
 * from pending to sale, and both confirmation doors run it:
 *   - POST /api/storefronts/checkout/verify (the buyer returning), and
 *   - the central Stripe webhook (checkout.session.completed).
 * The UPDATE is guarded on event_type='pending_sale', so webhook replays,
 * double verify calls and verify+webhook races all land exactly once —
 * the loser simply reads back the already-paid rows.
 *
 * Queries use raw SQL via db.execute(sql``) — the shop surface's own
 * convention (pg-mem cannot run the drizzle query builder here).
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { recordAffiliateSaleSafely } from "./affiliates";
import { deliverPaidShopLinesSafely } from "./shop-delivery";
import { createJobNotification } from "./job-notifications";
import { notifyUserEvent } from "./push-events";
import { recordShopEventSplitsSafely } from "./sale-splits";
import { findReservation, redeemReservation } from "./gift-cards";
import { consumeOfferByClaimRef, releaseOfferClaimByRef } from "./product-offers";
import { logger } from "./logger";

export interface MarketSaleRow {
  id: string;
  shop_id: string;
  user_id: string;
  product_id: string | null;
  product_name: string | null;
  quantity: number;
  amount_cents: number;
  platform_fee_cents: number;
  buyer_email: string | null;
  /** The buyer's account id, stamped at checkout from their verified
   *  session (migration 0297). Absent pre-migration. */
  buyer_user_id?: string | null;
  event_type: string;
  payment_status: string | null;
  stripe_session_id: string | null;
  checkout_group_id: string | null;
  /** Shop discount code the checkout was priced with (migration 0190). */
  discount_code: string | null;
  /** Affiliate share code the line was bought through (migration 0209). */
  affiliate_code: string | null;
  /** Order bump marker (feature #13): on the add-on's own row, the
      cart product it was attached through. Absent pre-migration. */
  bump_for_product_id?: string | null;
  paid_at: string | null;
  created_at: string;
}

const SALE_COLUMNS = sql`
  e.id, e.shop_id, e.user_id, e.product_id, p.name AS product_name,
  e.quantity, e.amount_cents, e.platform_fee_cents, e.buyer_email,
  e.event_type, e.payment_status, e.stripe_session_id, e.checkout_group_id,
  e.discount_code, e.affiliate_code,
  e.paid_at, e.created_at
`;

/* The bump marker rides a best-effort select: on a database where the
   feature's migration hasn't landed yet the plain select keeps every
   receipt working exactly as before (a bump row can only exist once
   the columns do, so nothing is lost by the fallback). */
const SALE_COLUMNS_WITH_BUMP = sql`
  e.id, e.shop_id, e.user_id, e.product_id, p.name AS product_name,
  e.quantity, e.amount_cents, e.platform_fee_cents, e.buyer_email,
  e.event_type, e.payment_status, e.stripe_session_id, e.checkout_group_id,
  e.discount_code, e.affiliate_code, e.bump_for_product_id,
  e.paid_at, e.created_at
`;

/* The buyer id (migration 0297) rides the same best-effort discipline:
   widest select first, then the bump select, then the plain one — a
   pre-migration database keeps every receipt working exactly as before. */
const SALE_COLUMNS_WITH_BUYER = sql`
  e.id, e.shop_id, e.user_id, e.product_id, p.name AS product_name,
  e.quantity, e.amount_cents, e.platform_fee_cents, e.buyer_email, e.buyer_user_id,
  e.event_type, e.payment_status, e.stripe_session_id, e.checkout_group_id,
  e.discount_code, e.affiliate_code, e.bump_for_product_id,
  e.paid_at, e.created_at
`;

export async function fetchMarketSaleBySession(sessionId: string): Promise<MarketSaleRow[]> {
  const columnSets = [SALE_COLUMNS_WITH_BUYER, SALE_COLUMNS_WITH_BUMP, SALE_COLUMNS];
  for (let i = 0; i < columnSets.length; i++) {
    try {
      const r = await db.execute(sql`
        SELECT ${columnSets[i]}
        FROM shop_events e
        LEFT JOIN shop_products p ON p.id = e.product_id
        WHERE e.stripe_session_id = ${sessionId}
        ORDER BY e.created_at ASC
      `);
      return r.rows as unknown as MarketSaleRow[];
    } catch (err) {
      /* Column set not landed yet — fall through to the narrower one.
         The narrowest set failing is a real error: let it propagate,
         exactly as before. */
      if (i === columnSets.length - 1) throw err;
    }
  }
  return [];
}

/** True once every row for the session is a recorded (paid) sale. */
export function marketSaleIsPaid(rows: MarketSaleRow[]): boolean {
  return rows.length > 0 && rows.every((r) => r.event_type === "sale");
}

export interface StorefrontSaleNoticeLine {
  productName: string | null;
  amountCents: number;
  platformFeeCents: number;
}

/**
 * The seller's "You just got paid" finale for STOREFRONT (marketplace
 * shop) sales — bell row + device push, exactly once per order.
 *
 * The gap this closes (Oct 28 gate, Pass 2): the Stack500 push
 * foundation wired this finale on the /api/store rail only
 * (routes/store.ts, digital_sales) — the push scope listed the
 * storefront sale as a separate event that was never wired. The
 * storefront flip below ran its money legs (fee, splits, delivery)
 * and told the seller NOTHING: earnings filled silently while the
 * bell stayed empty.
 *
 * Exactly-once, two deep:
 *   1. Callers run this only for rows they themselves recorded/flipped
 *      (a replay flips 0 rows and never reaches here), and
 *   2. the bell + push fire only when the UNIQUE(job_type, job_id)
 *      job_notifications row actually lands — the same gate the
 *      /api/store finale uses (createJobNotification's contract).
 * One order = one notification, keyed by the checkout group, however
 * many lines it carried. A seller buying from their own shop is not
 * pinged about it. Best-effort: a notification failure NEVER breaks
 * the sale it rides on; it logs and returns false.
 */
export async function notifyStorefrontSaleSafely(input: {
  sellerId: string;
  /** The buyer's account id when a verified session rode along. */
  buyerUserId?: string | null;
  /** Exactly-once key: the checkout group (fallback: the session id). */
  orderKey: string;
  lines: StorefrontSaleNoticeLine[];
}): Promise<boolean> {
  try {
    if (input.lines.length === 0) return false;
    if (input.buyerUserId && input.buyerUserId === input.sellerId) return false;
    const gross = input.lines.reduce((s, l) => s + Number(l.amountCents || 0), 0);
    const fees = input.lines.reduce((s, l) => s + Number(l.platformFeeCents || 0), 0);
    const net = gross - fees;
    const money = (c: number) => `$${(c / 100).toFixed(2)}`;
    const title = "You just got paid 👑";
    const firstName = input.lines[0]?.productName ?? null;
    const message =
      input.lines.length === 1 && firstName
        ? `“${firstName}” just sold for ${money(gross)} — ${money(net)} is now in your pending payout. The cheat code works.`
        : `${input.lines.length} items from your shop just sold for ${money(gross)} — ${money(net)} is now in your pending payout. The cheat code works.`;
    const landed = await createJobNotification({
      jobType: "sale",
      jobId: input.orderKey,
      userId: input.sellerId,
      status: "completed",
      title,
      message,
    });
    if (!landed) return false;
    await notifyUserEvent({
      userId: input.sellerId,
      category: "money",
      kind: "sale",
      title,
      body: message,
      link: "/store/dashboard",
    });
    return true;
  } catch (err) {
    logger.error(
      { err, orderKey: input.orderKey },
      "[market-sale] seller sale notification failed (sale stands)",
    );
    return false;
  }
}

/**
 * Flip a session's pending lines to paid sales, exactly once.
 * Returns the rows as they stand after the attempt plus how many lines
 * this call actually flipped (0 on a replay — the rows are already sales).
 */
export async function markMarketSalePaid(
  sessionId: string,
): Promise<{ flipped: number; rows: MarketSaleRow[] }> {
  const updated = await db.execute(sql`
    UPDATE shop_events
    SET event_type = 'sale', payment_status = 'paid', paid_at = COALESCE(paid_at, now())
    WHERE stripe_session_id = ${sessionId} AND event_type = 'pending_sale'
    RETURNING id
  `);
  const rows = await fetchMarketSaleBySession(sessionId);
  /* Discount redemption counting (0190) — the storefront's discipline:
     a code's use is counted when the sale is RECORDED, never at
     validate/checkout time. The guarded flip above lands exactly once
     (replays flip 0 rows), so counting here is exactly-once too. One
     checkout = one use, however many lines it carried: count each
     distinct (shop, code) among the rows THIS call flipped. */
  if (updated.rows.length > 0) {
    const flippedIds = new Set(
      (updated.rows as Array<Record<string, unknown>>).map((r) => String(r["id"])),
    );
    const counted = new Set<string>();
    for (const row of rows) {
      if (!flippedIds.has(String(row.id)) || !row.discount_code) continue;
      const key = `${row.shop_id}:${row.discount_code.toUpperCase()}`;
      if (counted.has(key)) continue;
      counted.add(key);
      await db.execute(sql`
        UPDATE shop_discount_codes
        SET used_count = used_count + 1
        WHERE shop_id = ${row.shop_id} AND UPPER(code) = ${row.discount_code.toUpperCase()}
      `);
    }
    /* Affiliate commissions (#16, migration 0205) — the same exactly-once
       discipline as discount counting: a commission is recorded only for
       rows THIS call flipped, keyed by (surface, checkout_group_id,
       product) in the ledger, so replays and races can never double-pay.
       The commission is a creator-set % of the line's seller net
       (amount − platform fee); the fee itself is untouched. Safely = a
       ledger failure never breaks the flip that records the sale. */
    for (const row of rows) {
      if (!flippedIds.has(String(row.id)) || !row.affiliate_code || !row.product_id) continue;
      await recordAffiliateSaleSafely({
        code: row.affiliate_code,
        surface: "shop_product",
        productId: String(row.product_id),
        productTitle: row.product_name ?? undefined,
        orderRef: row.checkout_group_id ?? sessionId,
        buyerEmail: row.buyer_email,
        grossCents: Number(row.amount_cents),
        platformFeeCents: Number(row.platform_fee_cents),
      });
    }
    /* Co-seller splits (Wave 4 #36) — the same exactly-once discipline:
       a product sold by two creators divides its net (amount − the
       flat 5% fee, already out) between them in sale_split_entries,
       only for rows THIS call flipped. Safely = a ledger failure never
       breaks the flip that records the sale. */
    for (const row of rows) {
      if (!flippedIds.has(String(row.id)) || !row.product_id) continue;
      await recordShopEventSplitsSafely(String(row.id));
    }
    /* Digital delivery (payfix lane 4) — the buyer actually receives
       what they paid for: one shop_deliveries row per flipped digital
       line, exactly once (UNIQUE sale_event_id), only ever from this
       paid flip. Physical lines and file-less listings no-op inside. */
    await deliverPaidShopLinesSafely(
      rows
        .filter((row) => flippedIds.has(String(row.id)))
        .map((row) => ({
          saleEventId: String(row.id),
          shopId: String(row.shop_id),
          productId: row.product_id ? String(row.product_id) : null,
          buyerEmail: row.buyer_email,
          buyerUserId: row.buyer_user_id ? String(row.buyer_user_id) : null,
          orderId: row.checkout_group_id ? String(row.checkout_group_id) : sessionId,
        })),
    );
    /* Seller "you just got paid" (bell + push) — only the call that
       flipped rows runs this, and the helper's own exactly-once gate
       keeps verify + webhook + replays at one ping per order. A
       session's lines belong to one shop; group per seller anyway so
       the keying stays honest if that ever changes. */
    const flippedRows = rows.filter((row) => flippedIds.has(String(row.id)));
    for (const sellerId of new Set(flippedRows.map((r) => String(r.user_id)))) {
      const sellerRows = flippedRows.filter((r) => String(r.user_id) === sellerId);
      await notifyStorefrontSaleSafely({
        sellerId,
        buyerUserId: sellerRows[0]?.buyer_user_id ? String(sellerRows[0].buyer_user_id) : null,
        orderKey: sellerRows[0]?.checkout_group_id
          ? String(sellerRows[0].checkout_group_id)
          : sessionId,
        lines: sellerRows.map((r) => ({
          productName: r.product_name ?? null,
          amountCents: Number(r.amount_cents),
          platformFeeCents: Number(r.platform_fee_cents),
        })),
      });
    }
  }
  /* Gift-card settlement (Stack-100 #3 #26): if this checkout held a
     gift-card reservation (rail 'shops', ref = checkout group), the
     flip is the moment the tender becomes a real debit — exactly
     once, because only the call that flipped rows runs it, and
     redeemReservation itself is idempotent. Best-effort with a LOUD
     log: the sale stands (the buyer paid the rest by card), and the
     reservation id is the reconciliation key. A pre-migration DB
     (gift tables not landed) throws inside findReservation — caught
     here so a gift-card-less sale can never be blocked by it. */
  if (updated.rows.length > 0) {
    try {
      const groupId = rows[0]?.checkout_group_id ? String(rows[0].checkout_group_id) : null;
      if (groupId) {
        const reservation = await findReservation("shops", groupId);
        if (reservation && reservation.status === "reserved") {
          const redeemed = await redeemReservation({ reservationId: String(reservation.id), ref: groupId });
          if (!redeemed) {
            logger.error({ sessionId, groupId }, "[market-sale] gift-card redeem failed after sale flip — needs reconciliation");
          }
        }
      }
    } catch (err) {
      logger.error({ err, sessionId }, "[market-sale] gift-card settlement check failed (sale stands)");
    }
    /* Make-an-offer (Wave 4 #43): if this checkout claimed an accepted
       offer (claimed_ref = the checkout group id), the recorded sale
       consumes it — exactly once, because only the call that flipped
       rows runs this, and the consume itself is status-guarded. The
       lib never throws into the flip. */
    const offerGroupId = rows[0]?.checkout_group_id ? String(rows[0].checkout_group_id) : null;
    if (offerGroupId) await consumeOfferByClaimRef(offerGroupId);
  }
  return { flipped: updated.rows.length, rows };
}

/** An abandoned/expired session: its lines stay pending_sale forever
 *  (never a sale) but are labelled honestly as expired. */
export async function markMarketSaleExpired(sessionId: string): Promise<void> {
  const rows = await fetchMarketSaleBySession(sessionId).catch(() => [] as MarketSaleRow[]);
  await db.execute(sql`
    UPDATE shop_events
    SET payment_status = 'expired'
    WHERE stripe_session_id = ${sessionId} AND event_type = 'pending_sale'
  `);
  /* An expired checkout frees any offer claim it held (#43) — the
     accepted offer itself stays live until its own expiry. */
  const groupId = rows[0]?.checkout_group_id ? String(rows[0].checkout_group_id) : null;
  if (groupId) await releaseOfferClaimByRef(groupId);
}

export interface MarketSaleReceipt {
  status: "paid" | "pending_payment" | "expired";
  paid: boolean;
  gross_cents: number;
  platform_fee_cents: number;
  seller_net_cents: number;
  lines: Array<{
    saleId: string;
    productId: string | null;
    productName: string | null;
    quantity: number;
    gross_cents: number;
    platform_fee_cents: number;
    seller_net_cents: number;
    /** Order bump (feature #13): this line is a ticked add-on. */
    isBump: boolean;
    bumpForProductId: string | null;
  }>;
}

/** The one receipt shape every surface renders from server truth. */
export function marketSaleReceipt(rows: MarketSaleRow[]): MarketSaleReceipt {
  const paid = marketSaleIsPaid(rows);
  const expired = !paid && rows.some((r) => r.payment_status === "expired");
  const lines = rows.map((r) => ({
    saleId: String(r.id),
    productId: r.product_id ? String(r.product_id) : null,
    productName: r.product_name ?? null,
    quantity: Number(r.quantity) || 1,
    gross_cents: Number(r.amount_cents),
    platform_fee_cents: Number(r.platform_fee_cents),
    seller_net_cents: Number(r.amount_cents) - Number(r.platform_fee_cents),
    isBump: Boolean(r.bump_for_product_id),
    bumpForProductId: r.bump_for_product_id ? String(r.bump_for_product_id) : null,
  }));
  return {
    status: paid ? "paid" : expired ? "expired" : "pending_payment",
    paid,
    gross_cents: lines.reduce((s, l) => s + l.gross_cents, 0),
    platform_fee_cents: lines.reduce((s, l) => s + l.platform_fee_cents, 0),
    seller_net_cents: lines.reduce((s, l) => s + l.seller_net_cents, 0),
    lines,
  };
}
