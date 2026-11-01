/**
 * shop-delivery.ts — digital delivery for marketplace shop sales
 * (payfix lane 4, provisional migration 0271_shop_delivery).
 *
 * The launch blocker this closes: a buyer paid $5 for a digital
 * download and received NOTHING — no download, no library entry, no
 * order record. Now, when a sale line flips to PAID (and only then),
 * a digital product's deliverable lands in shop_deliveries as the
 * buyer's permanent record:
 *   (1) library entry — GET /api/shops/my-purchases reads these rows;
 *   (2) download/access — the row carries the deliverable URL snapshot;
 *   (3) order record — order_id is the checkout group, shown to the
 *       buyer on the receipt and in their library.
 *
 * Exactly-once: UNIQUE(sale_event_id) + ON CONFLICT DO NOTHING, and the
 * only callers are the guarded paid flip (lib/market-sale) and the
 * free/gift-card cart path that records a sale directly. Declined,
 * pending and expired checkouts never reach either caller, so they
 * never deliver.
 *
 * "Safely" discipline (the house pattern from affiliates/splits): a
 * delivery failure never breaks the flip that records the sale — it
 * logs LOUD with the sale id so the miss is reconcilable. On a
 * pre-migration database the shop_deliveries table simply doesn't
 * exist yet and every call is a no-op.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

export interface DeliveryLineInput {
  saleEventId: string;
  shopId: string;
  productId: string | null;
  buyerEmail: string | null;
  /** The buyer's account id when a verified session rode along at
   *  checkout (migration 0297). Preferred over the email resolution:
   *  an email-only key is lost whenever the buyer leaves the checkout
   *  email field blank or types a different inbox than their account's
   *  (the Oct 26 + Oct 28 gate failures). */
  buyerUserId?: string | null;
  /** The checkout group id — the order's visible identifier. */
  orderId: string;
}

export interface ShopDeliveryRow {
  sale_event_id: string;
  order_id: string;
  product_id: string | null;
  product_name: string | null;
  deliverable_url: string;
  deliverable_name: string | null;
  created_at: string;
}

/** Resolve a buyer account id from their checkout email, when one
 *  exists. Best-effort: the delivery is keyed by email regardless, so
 *  a guest buyer who signs up later with the same email still finds
 *  it in their library (my-purchases matches on email too). */
async function buyerUserIdForEmail(email: string | null): Promise<string | null> {
  if (!email) return null;
  try {
    const r = await db.execute(sql`
      SELECT id FROM users WHERE LOWER(email) = LOWER(${email}) LIMIT 1
    `);
    const row = (r.rows as Array<Record<string, unknown>>)[0];
    return row ? String(row["id"]) : null;
  } catch {
    return null;
  }
}

/**
 * Deliver every digital line in `lines`. Returns how many delivery
 * rows this call created (0 on replays — the rows already exist).
 * Never throws.
 */
export async function deliverPaidShopLinesSafely(lines: DeliveryLineInput[]): Promise<number> {
  let created = 0;
  for (const line of lines) {
    if (!line.productId) continue;
    try {
      const pr = await db.execute(sql`
        SELECT product_type, deliverable_url, deliverable_name, name
        FROM shop_products WHERE id = ${line.productId} LIMIT 1
      `);
      const p = (pr.rows as Array<Record<string, unknown>>)[0];
      if (!p) continue;
      if (String(p["product_type"] ?? "physical") !== "digital") continue;
      const url = p["deliverable_url"] ? String(p["deliverable_url"]) : "";
      if (!url) {
        /* A digital product with no file attached can deliver nothing —
           say so loudly: the seller misconfigured the listing. */
        logger.error(
          { saleEventId: line.saleEventId, productId: line.productId },
          "[shop-delivery] digital product has NO deliverable_url — buyer paid, nothing to deliver (seller must attach a file)",
        );
        continue;
      }
      const buyerUserId = line.buyerUserId ?? (await buyerUserIdForEmail(line.buyerEmail));
      const ins = await db.execute(sql`
        INSERT INTO shop_deliveries
          (sale_event_id, shop_id, product_id, buyer_user_id, buyer_email, order_id, product_name, deliverable_url, deliverable_name)
        VALUES
          (${line.saleEventId}, ${line.shopId}, ${line.productId}, ${buyerUserId}, ${line.buyerEmail}, ${line.orderId},
           ${p["name"] ? String(p["name"]) : null}, ${url}, ${p["deliverable_name"] ? String(p["deliverable_name"]) : null})
        ON CONFLICT (sale_event_id) DO NOTHING
        RETURNING id
      `);
      created += ins.rows.length;
    } catch (err) {
      logger.error(
        { err, saleEventId: line.saleEventId, productId: line.productId },
        "[shop-delivery] delivery write failed (sale stands; reconcile by sale_event_id)",
      );
    }
  }
  return created;
}

/** Deliveries for a set of sale lines (receipt rendering). [] when the
 *  table isn't there yet or nothing digital was in the order. */
export async function fetchDeliveriesForSaleEvents(saleEventIds: string[]): Promise<ShopDeliveryRow[]> {
  if (saleEventIds.length === 0) return [];
  try {
    const r = await db.execute(sql`
      SELECT sale_event_id, order_id, product_id, product_name, deliverable_url, deliverable_name, created_at
      FROM shop_deliveries
      WHERE sale_event_id IN (${sql.join(saleEventIds.map((id) => sql`${id}`), sql`, `)})
      ORDER BY created_at ASC
    `);
    return r.rows as unknown as ShopDeliveryRow[];
  } catch {
    return [];
  }
}

export interface UndeliveredSaleRow {
  sale_event_id: string;
  order_id: string | null;
  product_id: string | null;
  product_name: string | null;
  product_type: string | null;
  /* The product's CURRENT deliverable (stack1100 G5A): when the
     listing has since been fixed — digital with a file on it — the
     library read presents the paid line as downloadable (the
     read-time net under the durable backfill below). Null while the
     seller has still attached nothing: the honest missing state. */
  deliverable_url: string | null;
  deliverable_name: string | null;
  paid_at: string | null;
  created_at: string;
}

/** Paid shop sale lines that produced NO delivery row — the
 *  order-record half of the buyer's library (read-compat shim).
 *
 *  A paid line lands here when its product carried nothing
 *  deliverable at flip time: typed physical, or a digital listing
 *  whose file was never attached. The Oct 28 gate's "TEST Digital
 *  Download" was exactly this — sold three times at $5 while its
 *  product row sat at the physical default with no file, so no
 *  shop_deliveries row could ever be written and the buyer's
 *  Library → Purchases read "Nothing here yet" forever. The sale
 *  itself is real and recorded; the library must at least show the
 *  ORDER under the buyer's account, honestly marked as carrying no
 *  download, instead of pretending the purchase never happened.
 *
 *  Matched by the same keys the delivery read uses — account id OR
 *  checkout email — so pre-0297 sales (recorded before buyer ids
 *  were stamped; the column reads NULL on those rows) still surface
 *  by the email they checked out with. Refunded sales never match:
 *  the reversal engine renames them event_type='refunded_sale'
 *  (lib/payment-reversals). Never throws — [] when the shop tables
 *  aren't there yet. */
export async function fetchUndeliveredSalesForBuyer(
  userId: string,
  email: string | null,
): Promise<UndeliveredSaleRow[]> {
  try {
    const keyClause = email
      ? sql`(e.buyer_user_id = ${userId} OR LOWER(e.buyer_email) = LOWER(${email}))`
      : sql`e.buyer_user_id = ${userId}`;
    /* Anti-join via LEFT JOIN (delivery sale_event_id is UNIQUE, so at
       most one delivery row per sale — no fan-out). Written this way
       instead of NOT EXISTS so the pg-mem harness can execute it;
       semantics are identical on real Postgres. */
    const r = await db.execute(sql`
      SELECT e.id AS sale_event_id, e.checkout_group_id AS order_id, e.product_id,
             p.name AS product_name, p.product_type AS product_type,
             p.deliverable_url AS deliverable_url, p.deliverable_name AS deliverable_name,
             e.paid_at, e.created_at
      FROM shop_events e
      LEFT JOIN shop_products p ON p.id = e.product_id
      LEFT JOIN shop_deliveries d ON d.sale_event_id = e.id
      WHERE e.event_type = 'sale' AND ${keyClause}
        AND d.id IS NULL
      ORDER BY COALESCE(e.paid_at, e.created_at) DESC
      LIMIT 200
    `);
    return r.rows as unknown as UndeliveredSaleRow[];
  } catch {
    return [];
  }
}

/* Buyer-id column probe (migration 0297) — same cached
   information_schema discipline as the shops router: pre-0297 rows
   carry no buyer id, and the backfill then keys on email alone. */
let backfillBuyerColKnown: boolean | null = null;
async function shopEventsHasBuyerIdForBackfill(): Promise<boolean> {
  if (backfillBuyerColKnown !== null) return backfillBuyerColKnown;
  try {
    const r = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'shop_events' AND column_name = 'buyer_user_id'
      LIMIT 1
    `);
    backfillBuyerColKnown = r.rows.length > 0;
  } catch {
    backfillBuyerColKnown = false;
  }
  return backfillBuyerColKnown;
}

/**
 * Heal past sales of ONE product (stack1100 lane G5A — Gate #5
 * finding P2-2). Delivery is a flip-time snapshot: a product sold
 * while it carried no deliverable (the Gate #5 "TEST Digital
 * Download" sat at the physical default with no file) could never
 * gain a delivery row afterwards, so when the seller finally fixed
 * the listing the buyer STILL had nothing. This finds every PAID
 * sale line for the product with no delivery row and runs it through
 * the same writer the flip uses — the writer re-checks the product
 * is digital with a file and the UNIQUE(sale_event_id) key keeps it
 * exactly-once. Called from the product PATCH whenever the saved
 * listing is digital with a deliverable. Returns rows created.
 * Never throws: a failed heal never breaks the seller's save.
 */
export async function backfillDeliveriesForProductSafely(productId: string): Promise<number> {
  try {
    const withBuyer = await shopEventsHasBuyerIdForBackfill();
    const r = await db.execute(sql`
      SELECT e.id AS sale_event_id, e.shop_id, e.checkout_group_id, e.stripe_session_id,
             e.buyer_email${withBuyer ? sql`, e.buyer_user_id` : sql``}
      FROM shop_events e
      LEFT JOIN shop_deliveries d ON d.sale_event_id = e.id
      WHERE e.product_id = ${productId} AND e.event_type = 'sale' AND d.id IS NULL
      ORDER BY e.created_at ASC
      LIMIT 500
    `);
    const lines: DeliveryLineInput[] = (r.rows as Array<Record<string, unknown>>).map((row) => ({
      saleEventId: String(row["sale_event_id"]),
      shopId: String(row["shop_id"]),
      productId,
      buyerEmail: row["buyer_email"] ? String(row["buyer_email"]) : null,
      buyerUserId: row["buyer_user_id"] ? String(row["buyer_user_id"]) : null,
      orderId: row["checkout_group_id"]
        ? String(row["checkout_group_id"])
        : row["stripe_session_id"]
          ? String(row["stripe_session_id"])
          : String(row["sale_event_id"]),
    }));
    if (lines.length === 0) return 0;
    const created = await deliverPaidShopLinesSafely(lines);
    if (created > 0) {
      logger.info({ productId, created }, "[shop-delivery] late-attach backfill delivered past paid sales");
    }
    return created;
  } catch (err) {
    logger.error(
      { err, productId },
      "[shop-delivery] late-attach backfill failed (product save stands; reconcile by product_id)",
    );
    return 0;
  }
}

/** The buyer's library: every delivery that is theirs — matched by
 *  account id OR by the email they checked out with. */
export async function fetchDeliveriesForBuyer(userId: string, email: string | null): Promise<ShopDeliveryRow[]> {
  try {
    const r = email
      ? await db.execute(sql`
          SELECT sale_event_id, order_id, product_id, product_name, deliverable_url, deliverable_name, created_at
          FROM shop_deliveries
          WHERE buyer_user_id = ${userId} OR LOWER(buyer_email) = LOWER(${email})
          ORDER BY created_at DESC
          LIMIT 200
        `)
      : await db.execute(sql`
          SELECT sale_event_id, order_id, product_id, product_name, deliverable_url, deliverable_name, created_at
          FROM shop_deliveries
          WHERE buyer_user_id = ${userId}
          ORDER BY created_at DESC
          LIMIT 200
        `);
    return r.rows as unknown as ShopDeliveryRow[];
  } catch {
    return [];
  }
}
