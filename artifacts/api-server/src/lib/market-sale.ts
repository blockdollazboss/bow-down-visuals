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
import { findReservation, redeemReservation } from "./gift-cards";
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
  event_type: string;
  payment_status: string | null;
  stripe_session_id: string | null;
  checkout_group_id: string | null;
  /** Shop discount code the checkout was priced with (migration 0190). */
  discount_code: string | null;
  /** Affiliate share code the line was bought through (migration 0205). */
  affiliate_code: string | null;
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

export async function fetchMarketSaleBySession(sessionId: string): Promise<MarketSaleRow[]> {
  const r = await db.execute(sql`
    SELECT ${SALE_COLUMNS}
    FROM shop_events e
    LEFT JOIN shop_products p ON p.id = e.product_id
    WHERE e.stripe_session_id = ${sessionId}
    ORDER BY e.created_at ASC
  `);
  return r.rows as unknown as MarketSaleRow[];
}

/** True once every row for the session is a recorded (paid) sale. */
export function marketSaleIsPaid(rows: MarketSaleRow[]): boolean {
  return rows.length > 0 && rows.every((r) => r.event_type === "sale");
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
  }
  return { flipped: updated.rows.length, rows };
}

/** An abandoned/expired session: its lines stay pending_sale forever
 *  (never a sale) but are labelled honestly as expired. */
export async function markMarketSaleExpired(sessionId: string): Promise<void> {
  await db.execute(sql`
    UPDATE shop_events
    SET payment_status = 'expired'
    WHERE stripe_session_id = ${sessionId} AND event_type = 'pending_sale'
  `);
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
