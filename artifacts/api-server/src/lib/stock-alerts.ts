import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import {
  db as defaultDb,
} from "@workspace/db";
import { sendEmail, emailShell, emailButton, escapeHtml, baseUrlForEmail, type SendEmailResult } from "./email";
import { logger } from "./logger";
import { isUndefinedTable, pgErrorText } from "./pg-errors";

/** Missing-table detection for the pre-migration window: the strict
    42P01 check plus the message shape some engines (the verification
    harness among them) surface instead — the same belt-and-braces
    the drop tables use (routes/storefront.ts isMissingDropTables). */
function isMissingStockAlertsTable(err: unknown): boolean {
  return isUndefinedTable(err) || /relation .* does not exist|undefined_table/i.test(pgErrorText(err));
}

/* ── Back-in-stock alerts (Wave 4 #37, migration 0236) ──────────────────
   "Tell me when it's back." A signed-in fan taps once on a sold-out
   store product; the tap is one stock_alerts row (user, product).
   When the product's stock returns, the waiting rows are claimed
   exactly once and the alert fires:

   - IN-APP (the guaranteed rail): one row in `notifications` per fan —
     the same table every other site ping uses.
   - EMAIL (best-effort bonus): only through the EXISTING subscriber
     relationship — the fan is emailed via lib/email's sendEmail only
     when their account email is already a confirmed, not-unsubscribed
     subscriber of the SELLER's email list. This module never captures
     an email address, never creates a list, and never sends to anyone
     outside that relationship.

   EXACTLY-ONCE: the claim is one status-guarded UPDATE
   (… WHERE status='waiting') whose RETURNING set is the fan-out list.
   Two racing restock writes (a seller PATCH and a Shopify import, say)
   can both call the fan-out; only one wins any given row, so no fan
   is ever pinged twice for one restock. Consumption is part of the
   claim: a notified row never fires again, and a product that sells
   out a second time alerts only fans who tapped again after that
   sell-out (subscribing re-arms the row).

   STOCK IS THE WHOLE SIGNAL: inventory 0 = sold out, anything else
   (a positive count, or -1 unlimited) = buyable. License keys (#35)
   mint at fulfillment and never gate an alert.

   GRACEFUL DEGRADATION: until migration 0236 lands, every store call
   sees undefined-table (42P01): reads answer "no alerts", the fan-out
   is a no-op, and the subscribe route answers 503 — products behave
   exactly as before.

   FAILURE ISOLATION: the fan-out never throws. A caller (the PATCH
   handler) can await it after its own update has committed; an alert
   failure can never fail or roll back the seller's edit. */

export const STOCK_ALERT_NOTIFICATION_KIND = "back_in_stock";

export interface StockAlertProduct {
  id: string;
  profileId: string;
  /** The seller's auth user id (creator_profiles.user_id). */
  sellerUserId: string;
  title: string;
  inventory: number;
  isActive: boolean;
  creatorName: string;
  creatorSlug: string;
}

export type SubscribeOutcome = "created" | "rearmed" | "already";

export interface StockAlertStore {
  /** The product + its creator, or null when the product is gone. */
  getProduct(productId: string): Promise<StockAlertProduct | null>;
  /** Insert-first subscribe: lands a 'waiting' row, re-arms a consumed
      ('notified') row, or reports the fan is already waiting. */
  subscribe(userId: string, productId: string): Promise<SubscribeOutcome>;
  /** Cancel a WAITING alert. Returns true when a row was removed. A
      consumed ('notified') row is history and stays. */
  unsubscribe(userId: string, productId: string): Promise<boolean>;
  /** 'waiting' | 'notified' | null (no row). */
  getSubscriptionStatus(userId: string, productId: string): Promise<string | null>;
  /** The seller's demand signal: fans currently waiting on a product. */
  countWaiting(productId: string): Promise<number>;
  /** Batch form for list payloads: productId → waiting count. */
  countWaitingForProducts(productIds: string[]): Promise<Map<string, number>>;
  /** Atomically flip every waiting row for the product to 'notified'
      and return the claimed fan user ids. Only the caller whose flip
      lands a row may alert that fan. */
  claimWaiting(productId: string, now: Date): Promise<string[]>;
  /** One bulk insert of in-app notifications (the notifications rail). */
  insertNotifications(
    userIds: string[],
    note: { kind: string; title: string; body: string; link: string },
  ): Promise<void>;
  /** The fan's account email (profiles.email), or null. */
  getUserEmail(userId: string): Promise<string | null>;
  /** True when `email` is a confirmed, not-unsubscribed subscriber of
      ANY email list the seller owns — the existing subscriber
      relationship an email alert is allowed to ride. */
  isSellerListSubscriber(sellerUserId: string, email: string): Promise<boolean>;
}

type Db = typeof defaultDb;

/* The store speaks raw SQL through db.execute — the house pattern for
   this neighborhood, and the only dialect the pg-mem verification
   harness executes identically to production. */
export function createDrizzleStockAlertStore(db: Db = defaultDb): StockAlertStore {
  return {
    async getProduct(productId) {
      const r = await db.execute(sql`
        SELECT sp.id, sp.profile_id, sp.title, sp.inventory, sp.is_active,
               cp.display_name AS creator_name, cp.slug AS creator_slug,
               cp.user_id AS seller_user_id
        FROM store_products sp
        JOIN creator_profiles cp ON cp.id = sp.profile_id
        WHERE sp.id = ${productId}
        LIMIT 1
      `);
      const raw = r.rows[0] as Record<string, unknown> | undefined;
      if (!raw) return null;
      return {
        id: String(raw["id"]),
        profileId: String(raw["profile_id"]),
        sellerUserId: String(raw["seller_user_id"]),
        title: String(raw["title"] ?? ""),
        inventory: Number(raw["inventory"]),
        isActive: Boolean(raw["is_active"]),
        creatorName: String(raw["creator_name"] ?? ""),
        creatorSlug: String(raw["creator_slug"] ?? ""),
      };
    },

    async subscribe(userId, productId) {
      /* The claim id is generated here, not by the DB default: the
         insert counts as landed only when RETURNING hands back THIS
         id — some engines surface the pre-existing row on a conflict
         instead of no row (the product-drop claim discipline). */
      const claimId = randomUUID();
      const landed = await db.execute(sql`
        INSERT INTO stock_alerts (id, user_id, product_id, status)
        VALUES (${claimId}, ${userId}, ${productId}, 'waiting')
        ON CONFLICT (user_id, product_id) DO NOTHING
        RETURNING id
      `);
      const landedRow = landed.rows[0] as Record<string, unknown> | undefined;
      if (landedRow && String(landedRow["id"]) === claimId) return "created";
      const existing = await db.execute(sql`
        SELECT status FROM stock_alerts
        WHERE user_id = ${userId} AND product_id = ${productId}
        LIMIT 1
      `);
      const status = (existing.rows[0] as Record<string, unknown> | undefined)?.["status"];
      if (String(status) === "notified") {
        /* Consumed by an earlier restock — this tap is a NEW wait. */
        const rearmed = await db.execute(sql`
          UPDATE stock_alerts
          SET status = 'waiting', notified_at = NULL, created_at = now()
          WHERE user_id = ${userId} AND product_id = ${productId} AND status = 'notified'
          RETURNING id
        `);
        if (rearmed.rows.length > 0) return "rearmed";
      }
      return "already";
    },

    async unsubscribe(userId, productId) {
      const r = await db.execute(sql`
        DELETE FROM stock_alerts
        WHERE user_id = ${userId} AND product_id = ${productId} AND status = 'waiting'
        RETURNING id
      `);
      return r.rows.length > 0;
    },

    async getSubscriptionStatus(userId, productId) {
      const r = await db.execute(sql`
        SELECT status FROM stock_alerts
        WHERE user_id = ${userId} AND product_id = ${productId}
        LIMIT 1
      `);
      const raw = r.rows[0] as Record<string, unknown> | undefined;
      return raw ? String(raw["status"]) : null;
    },

    async countWaiting(productId) {
      const r = await db.execute(sql`
        SELECT COUNT(*) AS n FROM stock_alerts
        WHERE product_id = ${productId} AND status = 'waiting'
      `);
      return Number((r.rows[0] as Record<string, unknown> | undefined)?.["n"] ?? 0);
    },

    async countWaitingForProducts(productIds) {
      const out = new Map<string, number>();
      if (productIds.length === 0) return out;
      const r = await db.execute(sql`
        SELECT product_id, COUNT(*) AS n FROM stock_alerts
        WHERE status = 'waiting' AND product_id IN (${sql.join(productIds.map((id) => sql`${id}`), sql`, `)})
        GROUP BY product_id
      `);
      for (const raw of r.rows as Array<Record<string, unknown>>) {
        out.set(String(raw["product_id"]), Number(raw["n"] ?? 0));
      }
      return out;
    },

    async claimWaiting(productId, now) {
      const r = await db.execute(sql`
        UPDATE stock_alerts
        SET status = 'notified', notified_at = ${now}
        WHERE product_id = ${productId} AND status = 'waiting'
        RETURNING user_id
      `);
      return (r.rows as Array<Record<string, unknown>>).map((raw) => String(raw["user_id"]));
    },

    async insertNotifications(userIds, note) {
      /* Chunked multi-row insert, mirroring notify-fanout's batching
         without its unnest idiom (plain VALUES run identically on the
         verification harness). */
      for (let i = 0; i < userIds.length; i += 500) {
        const chunk = userIds.slice(i, i + 500);
        const values = chunk.map(
          (uid) => sql`(${uid}, ${note.kind}, ${note.title}, ${note.body}, ${note.link})`,
        );
        await db.execute(sql`
          INSERT INTO notifications (user_id, kind, title, body, link)
          VALUES ${sql.join(values, sql`, `)}
        `);
      }
    },

    async getUserEmail(userId) {
      const r = await db.execute(sql`
        SELECT email FROM profiles WHERE id = ${userId} LIMIT 1
      `);
      const raw = r.rows[0] as Record<string, unknown> | undefined;
      const email = raw?.["email"];
      return email === null || email === undefined || String(email).trim() === ""
        ? null
        : String(email);
    },

    async isSellerListSubscriber(sellerUserId, email) {
      const r = await db.execute(sql`
        SELECT 1 AS hit
        FROM email_subscribers s
        JOIN email_lists l ON l.id = s.list_id
        WHERE l.user_id = ${sellerUserId}
          AND lower(s.email) = lower(${email})
          AND s.confirmed = true
          AND s.unsubscribed_at IS NULL
        LIMIT 1
      `);
      return r.rows.length > 0;
    },
  };
}

export interface StockAlertDeps {
  store?: StockAlertStore;
  send?: (opts: { to: string; subject: string; html: string; text?: string }) => Promise<SendEmailResult>;
  now?: Date;
}

function deps(depsIn: StockAlertDeps): Required<StockAlertDeps> {
  return {
    store: depsIn.store ?? createDrizzleStockAlertStore(),
    send: depsIn.send ?? sendEmail,
    now: depsIn.now ?? new Date(),
  };
}

/* ── Subscribe / unsubscribe / read ──────────────────────────────────── */

export type SubscribeResult =
  | { ok: true; alreadyWaiting: boolean }
  | { ok: false; reason: "not_found" | "not_sold_out" | "unavailable" };

/** One tap from a signed-in fan on a sold-out product. Refuses honestly
    when the product is gone/inactive (not_found) or buyable already
    (not_sold_out — there is nothing to wait for). */
export async function subscribeStockAlert(
  input: { userId: string; productId: string },
  depsIn: StockAlertDeps = {},
): Promise<SubscribeResult> {
  const d = deps(depsIn);
  try {
    const product = await d.store.getProduct(input.productId);
    if (!product || !product.isActive) return { ok: false, reason: "not_found" };
    if (product.inventory !== 0) return { ok: false, reason: "not_sold_out" };
    const outcome = await d.store.subscribe(input.userId, input.productId);
    return { ok: true, alreadyWaiting: outcome === "already" };
  } catch (err) {
    if (isMissingStockAlertsTable(err)) return { ok: false, reason: "unavailable" };
    throw err;
  }
}

export async function unsubscribeStockAlert(
  input: { userId: string; productId: string },
  depsIn: StockAlertDeps = {},
): Promise<{ ok: boolean }> {
  const d = deps(depsIn);
  try {
    const removed = await d.store.unsubscribe(input.userId, input.productId);
    return { ok: removed };
  } catch (err) {
    if (isMissingStockAlertsTable(err)) return { ok: false };
    throw err;
  }
}

/** Is this fan currently waiting on this product? (false pre-migration.) */
export async function isWaitingOnStockAlert(
  input: { userId: string; productId: string },
  depsIn: StockAlertDeps = {},
): Promise<boolean> {
  const d = deps(depsIn);
  try {
    return (await d.store.getSubscriptionStatus(input.userId, input.productId)) === "waiting";
  } catch (err) {
    if (isMissingStockAlertsTable(err)) return false;
    throw err;
  }
}

/** The seller's waiting count for one product (0 pre-migration). */
export async function countWaitingStockAlerts(
  productId: string,
  depsIn: StockAlertDeps = {},
): Promise<number> {
  const d = deps(depsIn);
  try {
    return await d.store.countWaiting(productId);
  } catch (err) {
    if (isMissingStockAlertsTable(err)) return 0;
    throw err;
  }
}

/** Batch waiting counts for list payloads (empty pre-migration). */
export async function countWaitingStockAlertsForProducts(
  productIds: string[],
  depsIn: StockAlertDeps = {},
): Promise<Map<string, number>> {
  const d = deps(depsIn);
  try {
    return await d.store.countWaitingForProducts(productIds);
  } catch (err) {
    if (isMissingStockAlertsTable(err)) return new Map();
    throw err;
  }
}

/* ── The restock fan-out ─────────────────────────────────────────────── */

export function buildRestockEmail(
  product: StockAlertProduct,
): { subject: string; html: string; text: string } {
  const productUrl = `${baseUrlForEmail()}/storefront/product/${product.id}`;
  const title = escapeHtml(product.title);
  const creator = escapeHtml(product.creatorName);
  const html = emailShell(
    `${title} is back`,
    `<p><strong>${title}</strong> by ${creator} sold out — and you asked to be told when it came back. It's back.</p>
${emailButton(productUrl, "Get it while it lasts")}
<p style="color:#8a7c5c;font-size:13px;">Stock is limited, and this alert went to everyone who was waiting — when it's gone, it's gone. You got this email because you're on ${creator}'s email list and tapped "tell me when it's back" on Bow Down Visuals.</p>`,
  );
  const text = [
    `${product.title} by ${product.creatorName} is back in stock.`,
    `You asked to be told when it came back — get it while it lasts: ${productUrl}`,
    `Stock is limited, and this alert went to everyone who was waiting. You got this email because you're on ${product.creatorName}'s email list and tapped "tell me when it's back" on Bow Down Visuals.`,
  ].join("\n");
  return { subject: `It's back: ${product.title} — ${product.creatorName}`, html, text };
}

export interface RestockFanoutResult {
  /** Waiting rows this call claimed (and therefore consumed). */
  claimed: number;
  /** Fans who got the in-app notification. */
  notified: number;
  /** Fans also emailed (existing list subscribers only). */
  emailed: number;
  /** Claimed fans the email leg skipped (not list subscribers, no
      account email, or a send that failed open). */
  emailSkipped: number;
}

/**
 * Fire the restock alert for one product. Claims the waiting rows
 * atomically, pings every claimed fan in-app, and emails the claimed
 * fans who are already subscribers of the seller's list. No-ops when
 * the product is still sold out or inactive — a stale or racing call
 * can never consume alerts for a product fans still can't buy.
 * NEVER throws.
 */
export async function fireRestockAlerts(
  productId: string,
  depsIn: StockAlertDeps = {},
): Promise<RestockFanoutResult> {
  const d = deps(depsIn);
  const result: RestockFanoutResult = { claimed: 0, notified: 0, emailed: 0, emailSkipped: 0 };

  let product: StockAlertProduct | null;
  try {
    product = await d.store.getProduct(productId);
  } catch (err) {
    if (!isMissingStockAlertsTable(err)) {
      logger.error({ err, productId }, "[stock-alerts] product read failed — no alerts fired");
    }
    return result;
  }
  if (!product || !product.isActive || product.inventory === 0) return result;

  let claimed: string[];
  try {
    claimed = await d.store.claimWaiting(productId, d.now);
  } catch (err) {
    if (!isMissingStockAlertsTable(err)) {
      logger.error({ err, productId }, "[stock-alerts] claim failed — no alerts fired");
    }
    return result;
  }
  result.claimed = claimed.length;
  if (claimed.length === 0) return result;

  /* The in-app rail: one notification per claimed fan. */
  try {
    await d.store.insertNotifications(claimed, {
      kind: STOCK_ALERT_NOTIFICATION_KIND,
      title: `Back in stock: ${product.title}`,
      body: `${product.creatorName} restocked “${product.title}” — it's back while it lasts.`,
      link: `/storefront/product/${product.id}`,
    });
    result.notified = claimed.length;
  } catch (err) {
    /* The claim already consumed the rows; a lost ping must be loud in
       the logs, never silent — and never thrown into the seller's edit. */
    logger.error({ err, productId, fans: claimed.length }, "[stock-alerts] notification insert failed after claim");
  }

  /* The email leg: existing subscribers of the seller's list only. */
  const mail = buildRestockEmail(product);
  for (const userId of claimed) {
    try {
      const email = await d.store.getUserEmail(userId);
      if (!email) { result.emailSkipped++; continue; }
      if (!(await d.store.isSellerListSubscriber(product.sellerUserId, email))) {
        result.emailSkipped++;
        continue;
      }
      const sent = await d.send({ to: email, ...mail });
      if (sent.sent) result.emailed++;
      else result.emailSkipped++;
    } catch (err) {
      result.emailSkipped++;
      logger.warn({ err, productId, userId }, "[stock-alerts] restock email leg failed for one fan — isolated");
    }
  }

  logger.info(
    { productId, title: product.title, ...result },
    "[stock-alerts] restock fan-out complete",
  );
  return result;
}

/** The transition test a stock-writing caller applies before invoking
    the fan-out: stock came back (sold out → anything buyable) on a live
    product, or a stocked product went live. Pure — unit-pinned. */
export function isRestockTransition(
  prev: { inventory: number; isActive: boolean },
  next: { inventory: number; isActive: boolean },
): boolean {
  if (!next.isActive || next.inventory === 0) return false;
  if (prev.inventory === 0 && next.inventory !== 0) return true;
  if (!prev.isActive && next.isActive) return true;
  return false;
}

/** Caller-side wrapper: fire only on a real restock transition. The
    fan-out re-reads the product and re-checks buyability itself, so a
    caller working from slightly stale prev/next values can never
    consume alerts wrongly. NEVER throws. */
export async function maybeFireRestockAlerts(
  input: {
    productId: string;
    prev: { inventory: number; isActive: boolean };
    next: { inventory: number; isActive: boolean };
  },
  depsIn: StockAlertDeps = {},
): Promise<RestockFanoutResult | null> {
  if (!isRestockTransition(input.prev, input.next)) return null;
  return fireRestockAlerts(input.productId, depsIn);
}
