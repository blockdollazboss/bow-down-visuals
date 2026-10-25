import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import {
  db as defaultDb,
  type ProductDropDelivery,
} from "@workspace/db";
import { sendEmail, emailShell, emailButton, escapeHtml, baseUrlForEmail, type SendEmailResult } from "./email";
import { logger } from "./logger";
import { isUndefinedTable } from "./pg-errors";

/* ── Drop-day product notifications (Stack-100 #3 #25) ───────────────────
   The drop page promises every fan who joins the capture list: "You'll
   get one email when this drops." This module is that email, built on
   the presave release-day discipline (lib/presave-release-notify.ts,
   migration 0186) — same claim ledger shape, same sender rail
   (lib/email.ts sendEmail via Resend, fail-open with no provider key).

   THE DROP MOMENT: product_drops.drop_at is a timestamptz — one UTC
   instant. A drop is due when drop_at <= now. Publishing is NOT owned
   by this sweeper alone: every public product read gates on the same
   rule (routes/storefront.ts), so a product can never be bought early
   even if the sweeper is down, and the moment it is due it reads as
   live even before the sweep flips the status.

   EXACTLY-ONCE, twice over:
   - Going live: the flip is a status-guarded UPDATE
     (… WHERE status='scheduled') — only one sweeper wins it, and only
     the winner fans out.
   - Each email: the product_drop_deliveries ledger is claimed
     insert-first — INSERT … ON CONFLICT (drop_id, email) DO NOTHING —
     and only a claim that lands may send. A retried sweep, a racing
     sweeper, or a restart after a crash can never email a fan twice.
     A failed attempt is recorded ('failed' + last_error) and a later
     sweep may retry it while attempts < MAX_ATTEMPTS; past the cap the
     row is 'dead' and terminal. A claim stuck in 'pending' (the
     process died mid-send) becomes retryable once it is older than
     STALE_PENDING_MS — the retry claim is a status-guarded UPDATE, so
     even then only one sender wins.

   ELIGIBILITY: a capture counts when it was captured no later than
   FOLLOW_GRACE_MS after the drop moment (drop-day captures in every
   timezone are in; someone who captures a week later joined the
   creator's list, not the drop list, and gets no stale "out now"
   email).

   GRACEFUL DEGRADATION: the product_drops tables arrive by a migration
   whose number is assigned at join (see the lane's MIGRATION-NEEDED).
   Until it lands, every store call sees undefined-table (42P01): the
   sweep treats that as "feature not deployed yet" and returns empty
   totals — it never throws into the boot sequence.

   FAILURE ISOLATION: every fan is processed inside their own
   try/catch; one bad address or a provider hiccup never blocks the
   rest of the list, and the fan-out as a whole never throws. */

export const PRODUCT_DROP_NOTIFY_MAX_ATTEMPTS =
  Number(process.env["PRODUCT_DROP_NOTIFY_MAX_ATTEMPTS"]) || 3;
export const PRODUCT_DROP_NOTIFY_FOLLOW_GRACE_MS =
  Number(process.env["PRODUCT_DROP_NOTIFY_FOLLOW_GRACE_MS"]) || 24 * 60 * 60 * 1000;
export const PRODUCT_DROP_NOTIFY_STALE_PENDING_MS =
  Number(process.env["PRODUCT_DROP_NOTIFY_STALE_PENDING_MS"]) || 15 * 60 * 1000;
const SWEEP_INTERVAL_MS =
  Number(process.env["PRODUCT_DROP_NOTIFY_SWEEP_INTERVAL_MS"]) || 15 * 60 * 1000;
const SWEEP_STARTUP_DELAY_MS =
  Number(process.env["PRODUCT_DROP_NOTIFY_SWEEP_STARTUP_DELAY_MS"]) || 45 * 1000;

export interface DueProductDrop {
  id: string;
  productId: string;
  title: string;
  creatorName: string;
  creatorSlug: string;
  dropAt: Date;
}

export interface EligibleCapture {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
}

export interface ProductDropNotifyStore {
  /** Scheduled drops whose moment has arrived at `now`. */
  listDueDrops(now: Date): Promise<DueProductDrop[]>;
  /** Live drops whose delivery ledger still holds retryable rows
      ('failed' under the attempt cap, or a stale 'pending' claim) that
      have rested since before `retryBefore` — a row that failed THIS
      sweep waits for a later one, like the presave sweeper. These get
      another fan-out pass, which the claim ledger keeps exactly-once. */
  listRetryDrops(maxAttempts: number, retryBefore: Date): Promise<DueProductDrop[]>;
  /** Atomically flip one drop scheduled → live. Returns true only for
      the caller that won the flip (and therefore owns the fan-out). */
  claimLive(dropId: string, now: Date): Promise<boolean>;
  /** Stamp the fan-out completion on a live drop (observability). */
  markNotified(dropId: string, now: Date): Promise<void>;
  /** One drop's captures: captured at or before the eligibility cutoff
      (drop moment + grace). */
  listEligibleCaptures(dropId: string, cutoff: Date): Promise<EligibleCapture[]>;
  /** Insert-first claim: lands a 'pending' row and returns it, or
      null when a row for (drop, email) already exists. */
  claimDelivery(input: {
    dropId: string;
    captureId: string | null;
    email: string;
  }): Promise<ProductDropDelivery | null>;
  /** Read the existing ledger row for (drop, email), if any. */
  getDelivery(dropId: string, email: string): Promise<ProductDropDelivery | null>;
  /** Atomically re-claim a retryable row ('failed' under the attempt
      cap, or a stale 'pending' claim). Returns the row when this call
      won the claim; null when another sender holds it or it is
      terminal. */
  claimRetry(
    deliveryId: string,
    maxAttempts: number,
    stalePendingBefore: Date,
    now: Date,
  ): Promise<ProductDropDelivery | null>;
  markSent(deliveryId: string, providerId: string | null, now: Date): Promise<void>;
  markFailed(deliveryId: string, error: string, dead: boolean, now: Date): Promise<void>;
}

type Db = typeof defaultDb;

/* The store speaks raw SQL through db.execute — the house pattern for
   the presave neighborhood, and the only dialect the pg-mem
   verification harness executes identically to production. */
function deliveryFromRow(raw: Record<string, unknown>): ProductDropDelivery {
  const asDate = (v: unknown): Date | null =>
    v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v));
  return {
    id: String(raw["id"]),
    dropId: String(raw["drop_id"]),
    captureId: raw["capture_id"] === null || raw["capture_id"] === undefined ? null : String(raw["capture_id"]),
    email: String(raw["email"]),
    status: String(raw["status"]),
    attempts: Number(raw["attempts"] ?? 0),
    providerId: raw["provider_id"] === null || raw["provider_id"] === undefined ? null : String(raw["provider_id"]),
    lastError: raw["last_error"] === null || raw["last_error"] === undefined ? null : String(raw["last_error"]),
    sentAt: asDate(raw["sent_at"]),
    createdAt: asDate(raw["created_at"]) ?? new Date(0),
    updatedAt: asDate(raw["updated_at"]) ?? new Date(0),
  } as ProductDropDelivery;
}

const DELIVERY_COLUMNS = sql`id, drop_id, capture_id, email, status, attempts, provider_id, last_error, sent_at, created_at, updated_at`;

export function createDrizzleProductDropNotifyStore(db: Db = defaultDb): ProductDropNotifyStore {
  return {
    async listDueDrops(now) {
      const result = await db.execute(sql`
        SELECT d.id, d.product_id, d.drop_at, sp.title, cp.display_name AS creator_name, cp.slug AS creator_slug
        FROM product_drops d
        JOIN store_products sp ON sp.id = d.product_id
        JOIN creator_profiles cp ON cp.id = d.profile_id
        WHERE d.status = 'scheduled' AND d.drop_at <= ${now}
        ORDER BY d.drop_at ASC
      `);
      return (result.rows as Array<Record<string, unknown>>).map((raw) => ({
        id: String(raw["id"]),
        productId: String(raw["product_id"]),
        title: String(raw["title"] ?? ""),
        creatorName: String(raw["creator_name"] ?? ""),
        creatorSlug: String(raw["creator_slug"] ?? ""),
        dropAt: raw["drop_at"] instanceof Date ? (raw["drop_at"] as Date) : new Date(String(raw["drop_at"])),
      }));
    },

    async listRetryDrops(maxAttempts, retryBefore) {
      const result = await db.execute(sql`
        SELECT DISTINCT d.id, d.product_id, d.drop_at, sp.title, cp.display_name AS creator_name, cp.slug AS creator_slug
        FROM product_drops d
        JOIN store_products sp ON sp.id = d.product_id
        JOIN creator_profiles cp ON cp.id = d.profile_id
        JOIN product_drop_deliveries dv ON dv.drop_id = d.id
        WHERE d.status = 'live'
          AND (
            (dv.status = 'failed' AND dv.attempts < ${maxAttempts} AND dv.updated_at < ${retryBefore})
            OR (dv.status = 'pending' AND dv.updated_at < ${retryBefore})
          )
        ORDER BY d.drop_at ASC
      `);
      return (result.rows as Array<Record<string, unknown>>).map((raw) => ({
        id: String(raw["id"]),
        productId: String(raw["product_id"]),
        title: String(raw["title"] ?? ""),
        creatorName: String(raw["creator_name"] ?? ""),
        creatorSlug: String(raw["creator_slug"] ?? ""),
        dropAt: raw["drop_at"] instanceof Date ? (raw["drop_at"] as Date) : new Date(String(raw["drop_at"])),
      }));
    },

    async claimLive(dropId, now) {
      const result = await db.execute(sql`
        UPDATE product_drops
        SET status = 'live', updated_at = ${now}
        WHERE id = ${dropId} AND status = 'scheduled'
        RETURNING id
      `);
      return result.rows.length > 0;
    },

    async markNotified(dropId, now) {
      await db.execute(sql`
        UPDATE product_drops SET notified_at = ${now}, updated_at = ${now} WHERE id = ${dropId}
      `);
    },

    async listEligibleCaptures(dropId, cutoff) {
      const result = await db.execute(sql`
        SELECT id, email, name, created_at FROM product_drop_captures
        WHERE drop_id = ${dropId}
        ORDER BY created_at ASC
      `);
      const captures: EligibleCapture[] = [];
      for (const raw of result.rows as Array<Record<string, unknown>>) {
        const createdAt =
          raw["created_at"] instanceof Date ? (raw["created_at"] as Date) : new Date(String(raw["created_at"]));
        if (createdAt.getTime() > cutoff.getTime()) continue;
        captures.push({
          id: String(raw["id"]),
          email: String(raw["email"]),
          name: raw["name"] === null || raw["name"] === undefined ? null : String(raw["name"]),
          createdAt,
        });
      }
      return captures;
    },

    async claimDelivery(input) {
      /* The claim id is generated here, not by the DB default: the
         claim counts as landed only when RETURNING hands back THIS
         id. On a conflict the statement inserts nothing — and this
         check keeps that true even on engines whose RETURNING
         surfaces the pre-existing row instead of no row. */
      const claimId = randomUUID();
      const result = await db.execute(sql`
        INSERT INTO product_drop_deliveries (id, drop_id, capture_id, email, status)
        VALUES (${claimId}, ${input.dropId}, ${input.captureId}, ${input.email}, 'pending')
        ON CONFLICT (drop_id, email) DO NOTHING
        RETURNING ${DELIVERY_COLUMNS}
      `);
      const row = result.rows[0] as unknown as Record<string, unknown> | undefined;
      if (!row || String(row["id"]) !== claimId) return null;
      return deliveryFromRow(row);
    },

    async getDelivery(dropId, email) {
      const result = await db.execute(sql`
        SELECT ${DELIVERY_COLUMNS} FROM product_drop_deliveries
        WHERE drop_id = ${dropId} AND email = ${email}
        LIMIT 1
      `);
      const row = result.rows[0] as unknown as Record<string, unknown> | undefined;
      return row ? deliveryFromRow(row) : null;
    },

    async claimRetry(deliveryId, maxAttempts, stalePendingBefore, now) {
      const result = await db.execute(sql`
        UPDATE product_drop_deliveries
        SET status = 'pending', updated_at = ${now}
        WHERE id = ${deliveryId}
          AND (
            (status = 'failed' AND attempts < ${maxAttempts})
            OR (status = 'pending' AND updated_at < ${stalePendingBefore})
          )
        RETURNING ${DELIVERY_COLUMNS}
      `);
      const row = result.rows[0] as unknown as Record<string, unknown> | undefined;
      return row ? deliveryFromRow(row) : null;
    },

    async markSent(deliveryId, providerId, now) {
      await db.execute(sql`
        UPDATE product_drop_deliveries
        SET status = 'sent', attempts = attempts + 1, provider_id = ${providerId},
            last_error = NULL, sent_at = ${now}, updated_at = ${now}
        WHERE id = ${deliveryId}
      `);
    },

    async markFailed(deliveryId, error, dead, now) {
      await db.execute(sql`
        UPDATE product_drop_deliveries
        SET status = ${dead ? "dead" : "failed"}, attempts = attempts + 1,
            last_error = ${error.slice(0, 500)}, updated_at = ${now}
        WHERE id = ${deliveryId}
      `);
    },
  };
}

export interface ProductDropNotifyDeps {
  store?: ProductDropNotifyStore;
  send?: (opts: { to: string; subject: string; html: string; text?: string }) => Promise<SendEmailResult>;
  now?: Date;
  maxAttempts?: number;
  followGraceMs?: number;
  stalePendingMs?: number;
}

function deps(depsIn: ProductDropNotifyDeps): Required<ProductDropNotifyDeps> {
  return {
    store: depsIn.store ?? createDrizzleProductDropNotifyStore(),
    send: depsIn.send ?? sendEmail,
    now: depsIn.now ?? new Date(),
    maxAttempts: depsIn.maxAttempts ?? PRODUCT_DROP_NOTIFY_MAX_ATTEMPTS,
    followGraceMs: depsIn.followGraceMs ?? PRODUCT_DROP_NOTIFY_FOLLOW_GRACE_MS,
    stalePendingMs: depsIn.stalePendingMs ?? PRODUCT_DROP_NOTIFY_STALE_PENDING_MS,
  };
}

/** The drop-day email for one fan. Every creator/fan string is
    escaped; the buy link is the product page itself, which flips from
    drop page to buy page at the drop moment. */
export function buildProductDropEmail(
  drop: DueProductDrop,
  capture: Pick<EligibleCapture, "email" | "name">,
): { to: string; subject: string; html: string; text: string } {
  const productUrl = `${baseUrlForEmail()}/storefront/product/${drop.productId}`;
  const title = escapeHtml(drop.title);
  const creator = escapeHtml(drop.creatorName);
  const greeting = capture.name?.trim()
    ? `<p>Hi ${escapeHtml(capture.name.trim())},</p>`
    : "";
  const html = emailShell(
    `${title} just dropped`,
    `${greeting}
<p>You joined the drop list, and the wait is over — <strong>${title}</strong> by ${creator} is live now.</p>
${emailButton(escapeHtml(productUrl), "Get it now")}
<p style="color:#8a7c5c;font-size:13px;">You got this email because you joined the drop list for this product on Bow Down Visuals. One email per drop, as promised — no spam, ever.</p>`,
  );
  const text = [
    `${drop.title} by ${drop.creatorName} just dropped and is live now.`,
    `You joined the drop list — get it here: ${productUrl}`,
    `You got this email because you joined the drop list for this product on Bow Down Visuals. One email per drop, as promised.`,
  ].join("\n");
  return {
    to: capture.email,
    subject: `It's live: ${drop.title} — ${drop.creatorName}`,
    html,
    text,
  };
}

export interface ProductDropFanoutResult {
  captures: number;
  claimed: number;
  sent: number;
  failed: number;
  /** Fans whose ledger row already resolved (or is held by another
      sender) — no send attempted. */
  skipped: number;
}

/**
 * Notify every eligible capture of one live drop, exactly once.
 * Never throws: a per-fan failure is ledgered and logged, and the
 * rest of the list still goes out.
 */
export async function notifyDropFansForDrop(
  drop: DueProductDrop,
  depsIn: ProductDropNotifyDeps = {},
): Promise<ProductDropFanoutResult> {
  const d = deps(depsIn);
  const result: ProductDropFanoutResult = { captures: 0, claimed: 0, sent: 0, failed: 0, skipped: 0 };
  const cutoff = new Date(drop.dropAt.getTime() + d.followGraceMs);
  const stalePendingBefore = new Date(d.now.getTime() - d.stalePendingMs);

  let captures: EligibleCapture[];
  try {
    captures = await d.store.listEligibleCaptures(drop.id, cutoff);
  } catch (err) {
    if (isUndefinedTable(err)) return result;
    logger.error({ err, dropId: drop.id }, "[product-drop-notify] capture read failed — no emails sent this pass");
    return result;
  }
  result.captures = captures.length;

  for (const capture of captures) {
    try {
      let row = await d.store.claimDelivery({
        dropId: drop.id,
        captureId: capture.id,
        email: capture.email,
      });
      if (!row) {
        const existing = await d.store.getDelivery(drop.id, capture.email);
        if (!existing || existing.status === "sent" || existing.status === "dead") {
          result.skipped++;
          continue;
        }
        row = await d.store.claimRetry(existing.id, d.maxAttempts, stalePendingBefore, d.now);
        if (!row) {
          result.skipped++;
          continue;
        }
      }
      result.claimed++;

      const sendResult = await d.send(buildProductDropEmail(drop, capture));
      if (sendResult.sent) {
        await d.store.markSent(row.id, sendResult.id ?? null, d.now);
        result.sent++;
      } else {
        const reason = sendResult.reason ?? "send-failed";
        await d.store.markFailed(row.id, reason, row.attempts + 1 >= d.maxAttempts, d.now);
        result.failed++;
        logger.warn(
          { dropId: drop.id, email: capture.email, reason },
          "[product-drop-notify] drop-day email not sent (ledgered for retry)",
        );
      }
    } catch (err) {
      /* One fan must never block the rest of the list. */
      result.failed++;
      logger.error({ err, dropId: drop.id, email: capture.email }, "[product-drop-notify] fan delivery failed — isolated");
    }
  }
  return result;
}

export interface ProductDropSweepResult {
  drops: number;
  captures: number;
  sent: number;
  failed: number;
  skipped: number;
}

/** One sweep: every due drop flips live (winner-only) and fans out;
    then live drops whose ledger still holds retryable rows get another
    fan-out pass (the claim ledger keeps every retry exactly-once). */
export async function sweepDueProductDrops(
  depsIn: ProductDropNotifyDeps = {},
): Promise<ProductDropSweepResult> {
  const d = deps(depsIn);
  const totals: ProductDropSweepResult = { drops: 0, captures: 0, sent: 0, failed: 0, skipped: 0 };
  let drops: DueProductDrop[];
  try {
    drops = await d.store.listDueDrops(d.now);
  } catch (err) {
    if (!isUndefinedTable(err)) {
      logger.error({ err }, "[product-drop-notify] due-drop scan failed");
    }
    return totals;
  }
  totals.drops = drops.length;
  for (const drop of drops) {
    try {
      const won = await d.store.claimLive(drop.id, d.now);
      if (!won) continue; /* Another sweeper owns this drop's fan-out. */
      const r = await notifyDropFansForDrop(drop, depsIn);
      totals.captures += r.captures;
      totals.sent += r.sent;
      totals.failed += r.failed;
      totals.skipped += r.skipped;
      await d.store.markNotified(drop.id, d.now);
      if (r.sent > 0 || r.failed > 0) {
        logger.info(
          { dropId: drop.id, productId: drop.productId, title: drop.title, ...r },
          "[product-drop-notify] drop-day fan-out pass complete",
        );
      }
    } catch (err) {
      if (isUndefinedTable(err)) return totals;
      logger.error({ err, dropId: drop.id }, "[product-drop-notify] drop fan-out crashed — continuing with the next drop");
    }
  }
  /* Retry pass: live drops with unresolved deliveries. */
  try {
    const stalePendingBefore = new Date(d.now.getTime() - d.stalePendingMs);
    const retryDrops = await d.store.listRetryDrops(d.maxAttempts, stalePendingBefore);
    for (const drop of retryDrops) {
      try {
        const r = await notifyDropFansForDrop(drop, depsIn);
        totals.captures += r.captures;
        totals.sent += r.sent;
        totals.failed += r.failed;
        totals.skipped += r.skipped;
      } catch (err) {
        logger.error({ err, dropId: drop.id }, "[product-drop-notify] drop retry pass crashed — continuing");
      }
    }
  } catch (err) {
    if (!isUndefinedTable(err)) {
      logger.error({ err }, "[product-drop-notify] retry-drop scan failed");
    }
  }
  return totals;
}

/* Starts the drop-day sweeper: one run shortly after boot (a deploy on
   drop morning still publishes + notifies), then on the configured
   interval. A sweep that throws is logged, never fatal. */
export function startProductDropSweeper(
  depsIn: ProductDropNotifyDeps = {},
): { stop: () => void } {
  const run = () =>
    sweepDueProductDrops(depsIn).catch((err) =>
      logger.error({ err }, "[product-drop-notify] sweep crashed"),
    );
  const startupTimer = setTimeout(run, SWEEP_STARTUP_DELAY_MS);
  const intervalTimer = setInterval(run, SWEEP_INTERVAL_MS);
  logger.info(
    { intervalMs: SWEEP_INTERVAL_MS, startupDelayMs: SWEEP_STARTUP_DELAY_MS },
    "[product-drop-notify] drop-day sweeper started",
  );
  return {
    stop: () => {
      clearTimeout(startupTimer);
      clearInterval(intervalTimer);
    },
  };
}
