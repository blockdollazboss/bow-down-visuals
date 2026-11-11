import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import {
  db as defaultDb,
  type TempBucsExpiryWarning,
} from "@workspace/db";
import { sendEmail, emailShell, emailButton, escapeHtml, baseUrlForEmail, type SendEmailResult, type EmailTheme, EMAIL_COLORS } from "./email";
import { resolveEmailThemeForRecipient } from "./email-theme-rotation";
import { creditBalanceComposition } from "./credits";
import { getSupabaseAdmin } from "./supabase-admin";
import { getUserEmail } from "./stripe-connect";
import { logger } from "./logger";

/* ── Temporary Bucs expiry warning (stack1400 ruling #12 / Y6) ───────
   Temporary Visual Bucs live in ONE aggregate pool on the member's
   Supabase profiles row (bonus_credits + bonus_credits_expires_at,
   48h from grant — lib/bonus.ts). The balance display already names
   the soonest dated expiry and the amount expiring then
   (lib/credits.ts creditBalanceComposition), but until now nothing
   warned the member before the Bucs were gone. The ruling: ONE
   warning email before expiry, carrying the amount and the exact
   expiry date, exactly once per pool expiry.

   THE WINDOW: warn when a live pool is inside its final 3 days
   (expiry in (now, now + 3 days]). The standard pool lives 48h, so
   in practice a standard pool is warned on the first sweep after
   its grant — that is the honest reading for short pools: the
   warning is the member's only notice, and it must land while
   there is still time to spend the Bucs.

   EXACTLY-ONCE (the presave-release-notify discipline, migration
   0186): the temp_bucs_expiry_warnings ledger (migration 0317) is
   claimed insert-first — INSERT … ON CONFLICT (user_id,
   pool_expires_at) DO NOTHING — and only a claim that lands may
   send. The pool's expiry instant is the warning's identity: a
   retried sweep, a racing sweeper, or a restart after a crash can
   never email a member twice about the same pool. A new grant
   refreshes the pool expiry — a new pool, which may earn its own
   warning. A failed attempt is recorded ('failed' + last_error)
   and a later sweep may retry it while attempts < MAX_ATTEMPTS;
   past the cap the row is 'dead' and terminal. A claim stuck in
   'pending' (the process died mid-send) becomes retryable once it
   is older than STALE_PENDING_MS — the retry claim is a
   status-guarded UPDATE, so even then only one sender wins.

   SUPPRESSION IS ABSOLUTE (the email-automations law): the address
   is re-checked immediately before the send — if it appears on any
   email_subscribers row with unsubscribed_at set, the claim is
   settled 'suppressed' (terminal) and nothing is mailed.

   THE AMOUNT + DATE come from creditBalanceComposition — the same
   composition the balance display reads — never from a second
   definition: the soonest dated temporary expiry and the amount
   expiring then (for the production store that is the one pool's
   amount at its expiry).

   THE SENDER rides the house transactional rail — lib/email.ts
   sendEmail (Resend), fail-open: with no RESEND_API_KEY configured
   it returns { sent: false, reason: "no-provider" } instead of
   throwing. Those attempts land in the ledger as 'failed' with
   that reason and retry on later sweeps (up to the cap) — the
   ledger + trigger are complete either way; delivery itself needs
   the provider key configured. This module only builds and sweeps;
   it is wired live by startTempBucsExpiryWarningSweeper in index.ts.

   FAILURE ISOLATION: every pool is processed inside its own
   try/catch; one bad address or a provider hiccup never blocks the
   rest of the sweep, and the sweep never throws into the sweeper. */

export const TEMP_BUCS_EXPIRY_WARNING_WINDOW_MS =
  Number(process.env["TEMP_BUCS_EXPIRY_WARNING_WINDOW_MS"]) || 3 * 24 * 60 * 60 * 1000;
const TEMP_BUCS_WARNING_MAX_ATTEMPTS =
  Number(process.env["TEMP_BUCS_WARNING_MAX_ATTEMPTS"]) || 3;
const TEMP_BUCS_WARNING_STALE_PENDING_MS =
  Number(process.env["TEMP_BUCS_WARNING_STALE_PENDING_MS"]) || 15 * 60 * 1000;
const SWEEP_INTERVAL_MS =
  Number(process.env["TEMP_BUCS_EXPIRY_SWEEP_INTERVAL_MS"]) || 15 * 60 * 1000;
const SWEEP_STARTUP_DELAY_MS =
  Number(process.env["TEMP_BUCS_EXPIRY_SWEEP_STARTUP_DELAY_MS"]) || 45 * 1000;
/** Max candidate pools scanned per sweep (the bookings-reminder
    batch discipline). */
const POOL_BATCH = 500;

/** One live temporary (bonus) pool, as the profiles row stores it. */
export interface TempBucsPoolCandidate {
  userId: string;
  credits: number | null;
  bonusCredits: number | null;
  bonusCreditsExpiresAt: string | null;
}

/** What a pool is owed a warning for, per the display composition:
    the amount expiring at the soonest dated expiry, and when. Null
    when the pool carries no live dated temporary segment. */
export function tempBucsWarningTarget(
  pool: TempBucsPoolCandidate,
  now: number = Date.now(),
): { amount: number; expiresAt: string; expiryMs: number } | null {
  const composition = creditBalanceComposition(
    {
      credits: pool.credits,
      bonus_credits: pool.bonusCredits,
      bonus_credits_expires_at: pool.bonusCreditsExpiresAt,
    },
    now,
  );
  const soonest = composition.soonestTemporaryExpiry;
  if (!soonest || !soonest.expiresAt) return null;
  const expiryMs = new Date(soonest.expiresAt).getTime();
  if (!Number.isFinite(expiryMs)) return null;
  return { amount: soonest.amount, expiresAt: soonest.expiresAt, expiryMs };
}

/** The default pool source: Supabase profiles (the bonus pool's
    store of record) pre-filtered to pools expiring inside the
    window. The sweep re-verifies every candidate through
    tempBucsWarningTarget, so due-ness never rests on this filter
    alone. */
export async function listExpiringTempBucsPools(
  now: Date,
  windowMs: number = TEMP_BUCS_EXPIRY_WARNING_WINDOW_MS,
): Promise<TempBucsPoolCandidate[]> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("profiles")
    .select("id, credits, bonus_credits, bonus_credits_expires_at")
    .gt("bonus_credits", 0)
    .not("bonus_credits_expires_at", "is", null)
    .gt("bonus_credits_expires_at", now.toISOString())
    .lte("bonus_credits_expires_at", new Date(now.getTime() + windowMs).toISOString())
    .order("bonus_credits_expires_at", { ascending: true })
    .limit(POOL_BATCH);
  if (error) throw new Error(`Failed to read expiring bonus pools: ${error.message}`);
  return (data ?? []).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      userId: String(r["id"]),
      credits: typeof r["credits"] === "number" ? r["credits"] : null,
      bonusCredits: typeof r["bonus_credits"] === "number" ? r["bonus_credits"] : null,
      bonusCreditsExpiresAt:
        r["bonus_credits_expires_at"] == null ? null : String(r["bonus_credits_expires_at"]),
    };
  });
}

export interface TempBucsExpiryWarningStore {
  /** Insert-first claim: lands a 'pending' row and returns it, or
      null when a row for (user, pool expiry) already exists. */
  claimWarning(input: {
    userId: string;
    poolExpiresAt: Date;
    email: string;
    amountVb: number;
  }): Promise<TempBucsExpiryWarning | null>;
  /** Read the existing ledger row for (user, pool expiry), if any. */
  getWarning(userId: string, poolExpiresAt: Date): Promise<TempBucsExpiryWarning | null>;
  /** Atomically re-claim a retryable row ('failed' under the attempt
      cap, or a stale 'pending' claim). Returns the row when this
      call won the claim; null when another sender holds it or it is
      terminal. */
  claimRetry(
    warningId: string,
    maxAttempts: number,
    stalePendingBefore: Date,
    now: Date,
  ): Promise<TempBucsExpiryWarning | null>;
  markSent(warningId: string, providerId: string | null, now: Date): Promise<void>;
  markFailed(warningId: string, error: string, dead: boolean, now: Date): Promise<void>;
  markSuppressed(warningId: string, now: Date): Promise<void>;
  /** True when the address is suppressed: an email_subscribers row
      (any list) carries unsubscribed_at for it. The same check the
      email automations treat as absolute. */
  isSuppressed(email: string): Promise<boolean>;
}

type Db = typeof defaultDb;

/* The store speaks raw SQL through db.execute — the house pattern
   for this neighborhood (presave-release-notify, stock-alerts), and
   the only dialect the pg-mem verification harness executes
   identically to production. Claim semantics are single-statement:
   the insert carries ON CONFLICT DO NOTHING, the retry claim is a
   status-guarded UPDATE … RETURNING. */
function warningFromRow(raw: Record<string, unknown>): TempBucsExpiryWarning {
  const asDate = (v: unknown): Date | null =>
    v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v));
  return {
    id: String(raw["id"]),
    userId: String(raw["user_id"]),
    poolExpiresAt: asDate(raw["pool_expires_at"]) ?? new Date(0),
    email: String(raw["email"]),
    amountVb: Number(raw["amount_vb"] ?? 0),
    status: String(raw["status"]),
    attempts: Number(raw["attempts"] ?? 0),
    providerId: raw["provider_id"] === null || raw["provider_id"] === undefined ? null : String(raw["provider_id"]),
    lastError: raw["last_error"] === null || raw["last_error"] === undefined ? null : String(raw["last_error"]),
    sentAt: asDate(raw["sent_at"]),
    createdAt: asDate(raw["created_at"]) ?? new Date(0),
    updatedAt: asDate(raw["updated_at"]) ?? new Date(0),
  } as TempBucsExpiryWarning;
}

const WARNING_COLUMNS = sql`id, user_id, pool_expires_at, email, amount_vb, status, attempts, provider_id, last_error, sent_at, created_at, updated_at`;

export function createDrizzleTempBucsWarningStore(db: Db = defaultDb): TempBucsExpiryWarningStore {
  return {
    async claimWarning(input) {
      /* The claim id is generated here, not by the DB default: the
         claim counts as landed only when RETURNING hands back THIS
         id. On a conflict the statement inserts nothing — and this
         check keeps that true even on engines whose RETURNING
         surfaces the pre-existing row instead of no row. */
      const claimId = randomUUID();
      const result = await db.execute(sql`
        INSERT INTO temp_bucs_expiry_warnings (id, user_id, pool_expires_at, email, amount_vb, status)
        VALUES (${claimId}, ${input.userId}, ${input.poolExpiresAt}, ${input.email}, ${input.amountVb}, 'pending')
        ON CONFLICT (user_id, pool_expires_at) DO NOTHING
        RETURNING ${WARNING_COLUMNS}
      `);
      const row = result.rows[0] as unknown as Record<string, unknown> | undefined;
      if (!row || String(row["id"]) !== claimId) return null;
      return warningFromRow(row);
    },

    async getWarning(userId, poolExpiresAt) {
      const result = await db.execute(sql`
        SELECT ${WARNING_COLUMNS} FROM temp_bucs_expiry_warnings
        WHERE user_id = ${userId} AND pool_expires_at = ${poolExpiresAt}
        LIMIT 1
      `);
      const row = result.rows[0] as unknown as Record<string, unknown> | undefined;
      return row ? warningFromRow(row) : null;
    },

    async claimRetry(warningId, maxAttempts, stalePendingBefore, now) {
      const result = await db.execute(sql`
        UPDATE temp_bucs_expiry_warnings
        SET status = 'pending', updated_at = ${now}
        WHERE id = ${warningId}
          AND (
            (status = 'failed' AND attempts < ${maxAttempts})
            OR (status = 'pending' AND updated_at < ${stalePendingBefore})
          )
        RETURNING ${WARNING_COLUMNS}
      `);
      const row = result.rows[0] as unknown as Record<string, unknown> | undefined;
      return row ? warningFromRow(row) : null;
    },

    async markSent(warningId, providerId, now) {
      await db.execute(sql`
        UPDATE temp_bucs_expiry_warnings
        SET status = 'sent', attempts = attempts + 1, provider_id = ${providerId},
            last_error = NULL, sent_at = ${now}, updated_at = ${now}
        WHERE id = ${warningId}
      `);
    },

    async markFailed(warningId, error, dead, now) {
      await db.execute(sql`
        UPDATE temp_bucs_expiry_warnings
        SET status = ${dead ? "dead" : "failed"}, attempts = attempts + 1,
            last_error = ${error.slice(0, 500)}, updated_at = ${now}
        WHERE id = ${warningId}
      `);
    },

    async markSuppressed(warningId, now) {
      await db.execute(sql`
        UPDATE temp_bucs_expiry_warnings
        SET status = 'suppressed', updated_at = ${now}
        WHERE id = ${warningId}
      `);
    },

    async isSuppressed(email) {
      const result = await db.execute(sql`
        SELECT 1 AS hit FROM email_subscribers
        WHERE lower(email) = lower(${email})
          AND unsubscribed_at IS NOT NULL
        LIMIT 1
      `);
      return result.rows.length > 0;
    },
  };
}

interface TempBucsWarningDeps {
  store?: TempBucsExpiryWarningStore;
  listPools?: (now: Date, windowMs: number) => Promise<TempBucsPoolCandidate[]>;
  getEmail?: (userId: string) => Promise<string | null>;
  send?: (opts: { to: string; subject: string; html: string; text?: string; theme?: EmailTheme; themeRecipient?: string }) => Promise<SendEmailResult>;
  now?: Date;
  windowMs?: number;
  maxAttempts?: number;
  stalePendingMs?: number;
}

function deps(depsIn: TempBucsWarningDeps): Required<TempBucsWarningDeps> {
  return {
    store: depsIn.store ?? createDrizzleTempBucsWarningStore(),
    listPools: depsIn.listPools ?? listExpiringTempBucsPools,
    getEmail: depsIn.getEmail ?? getUserEmail,
    send: depsIn.send ?? sendEmail,
    now: depsIn.now ?? new Date(),
    windowMs: depsIn.windowMs ?? TEMP_BUCS_EXPIRY_WARNING_WINDOW_MS,
    maxAttempts: depsIn.maxAttempts ?? TEMP_BUCS_WARNING_MAX_ATTEMPTS,
    stalePendingMs: depsIn.stalePendingMs ?? TEMP_BUCS_WARNING_STALE_PENDING_MS,
  };
}

/** The exact expiry moment as the member reads it: full date + time,
    in UTC (the zone the pool's clock runs on), spelled out so the
    date in the email can never be misread. */
export function formatTempBucsExpiryDate(expiresAt: string): string {
  const d = new Date(expiresAt);
  if (!Number.isFinite(d.getTime())) return expiresAt;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(d);
}

function formatShortExpiryDate(expiresAt: string): string {
  const d = new Date(expiresAt);
  if (!Number.isFinite(d.getTime())) return expiresAt;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(d);
}

function formatAmount(amount: number): string {
  return amount.toLocaleString("en-US");
}

/** The one warning email for one pool. Carries the amount expiring
    and the exact expiry date, plus the house truth the balance
    display already states: Temporary Bucs are spent first, so
    using anything on the site draws this pool down before the
    member's permanent Bucs. */
export function buildTempBucsExpiryEmail(input: {
  email: string;
  amount: number;
  expiresAt: string;
  theme?: EmailTheme;
}): { to: string; subject: string; html: string; text: string; theme?: EmailTheme; themeRecipient?: string } {
  const amount = formatAmount(input.amount);
  const when = formatTempBucsExpiryDate(input.expiresAt);
  const siteUrl = baseUrlForEmail();
  const html = emailShell(
    "Your Temporary Visual Bucs are about to expire",
    `<p>You have <strong>${escapeHtml(amount)} Temporary Visual Bucs</strong> that expire on <strong>${escapeHtml(when)}</strong>. After that moment they are gone — they do not turn into permanent Bucs.</p>
<p>Good news: Temporary Bucs are spent first. Anything you create or unlock on Bow Down Visuals draws from this pool before your permanent Bucs, so putting them to work is as simple as making something.</p>
${emailButton(escapeHtml(siteUrl), "Use your Temporary Bucs")}
<p style="color:${EMAIL_COLORS.muted};font-size:13px;">You got this email because your Bow Down Visuals account holds Temporary Visual Bucs with an expiry coming up. One warning per pool — no spam, ever.</p>`,
    { theme: input.theme },
  );
  const text = [
    `You have ${amount} Temporary Visual Bucs that expire on ${when}. After that moment they are gone — they do not turn into permanent Bucs.`,
    `Temporary Bucs are spent first: anything you create or unlock on Bow Down Visuals draws from this pool before your permanent Bucs.`,
    `Use them here: ${siteUrl}`,
    `You got this email because your Bow Down Visuals account holds Temporary Visual Bucs with an expiry coming up. One warning per pool.`,
  ].join("\n");
  return {
    to: input.email,
    subject: `${amount} Temporary Visual Bucs expire ${formatShortExpiryDate(input.expiresAt)} — use them before they're gone`,
    html,
    text,
    theme: input.theme,
    themeRecipient: input.email,
  };
}

export interface TempBucsExpirySweepResult {
  pools: number;
  claimed: number;
  sent: number;
  failed: number;
  /** Pools whose ledger row already resolved (or is held by another
      sender), plus pools with no reachable address — no send. */
  skipped: number;
  suppressed: number;
}

/**
 * One sweep: warn every member whose live temporary pool expires
 * inside the window, exactly once per pool expiry. Never throws: a
 * per-pool failure is ledgered and logged, and the rest of the
 * sweep still goes out.
 */
export async function sweepTempBucsExpiryWarnings(
  depsIn: TempBucsWarningDeps = {},
): Promise<TempBucsExpirySweepResult> {
  const d = deps(depsIn);
  const result: TempBucsExpirySweepResult = {
    pools: 0,
    claimed: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    suppressed: 0,
  };
  const nowMs = d.now.getTime();
  const stalePendingBefore = new Date(nowMs - d.stalePendingMs);

  let pools: TempBucsPoolCandidate[];
  try {
    pools = await d.listPools(d.now, d.windowMs);
  } catch (err) {
    logger.error({ err }, "[temp-bucs-expiry] pool scan failed — no warnings sent this pass");
    return result;
  }

  for (const pool of pools) {
    try {
      /* Due-ness is judged here, from the display composition —
         never from the source's pre-filter alone: expired pools,
         undated pools, empty pools, and pools more than the window
         out earn no warning. */
      const target = tempBucsWarningTarget(pool, nowMs);
      if (!target) continue;
      if (target.expiryMs <= nowMs || target.expiryMs > nowMs + d.windowMs) continue;
      result.pools++;

      const email = await d.getEmail(pool.userId);
      if (!email) {
        /* No reachable address — not actionable, and no claim: a
           later sweep can still warn if an address appears while
           the pool is live. */
        result.skipped++;
        continue;
      }

      const poolExpiresAt = new Date(target.expiryMs);
      let row = await d.store.claimWarning({
        userId: pool.userId,
        poolExpiresAt,
        email,
        amountVb: target.amount,
      });
      if (!row) {
        const existing = await d.store.getWarning(pool.userId, poolExpiresAt);
        if (
          !existing ||
          existing.status === "sent" ||
          existing.status === "dead" ||
          existing.status === "suppressed"
        ) {
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

      /* Suppression re-check at send time (the email-automations
         law): an unsubscribe that landed after the pool was scanned
         still wins. Suppressed is terminal — never mailed, never
         retried. */
      if (await d.store.isSuppressed(email)) {
        await d.store.markSuppressed(row.id, d.now);
        result.suppressed++;
        continue;
      }

      const theme = await resolveEmailThemeForRecipient(email);
      const sendResult = await d.send(
        buildTempBucsExpiryEmail({ email, amount: target.amount, expiresAt: target.expiresAt, theme }),
      );
      if (sendResult.sent) {
        await d.store.markSent(row.id, sendResult.id ?? null, d.now);
        result.sent++;
      } else {
        const reason = sendResult.reason ?? "send-failed";
        await d.store.markFailed(row.id, reason, row.attempts + 1 >= d.maxAttempts, d.now);
        result.failed++;
        logger.warn(
          { userId: pool.userId, reason },
          "[temp-bucs-expiry] warning email not sent (ledgered for retry)",
        );
      }
    } catch (err) {
      /* One pool must never block the rest of the sweep. */
      result.failed++;
      logger.error(
        { err, userId: pool.userId },
        "[temp-bucs-expiry] pool warning failed — isolated",
      );
    }
  }
  if (result.sent > 0 || result.failed > 0 || result.suppressed > 0) {
    logger.info(result, "[temp-bucs-expiry] sweep complete");
  }
  return result;
}

/* Starts the expiry-warning sweeper: one run shortly after boot (a
   deploy inside a pool's window still warns), then on the
   configured interval. A sweep that throws is logged, never fatal. */
export function startTempBucsExpiryWarningSweeper(
  depsIn: TempBucsWarningDeps = {},
): { stop: () => void } {
  const run = () =>
    sweepTempBucsExpiryWarnings(depsIn).catch((err) =>
      logger.error({ err }, "[temp-bucs-expiry] sweep crashed"),
    );
  const startupTimer = setTimeout(run, SWEEP_STARTUP_DELAY_MS);
  const intervalTimer = setInterval(run, SWEEP_INTERVAL_MS);
  logger.info(
    { intervalMs: SWEEP_INTERVAL_MS, startupDelayMs: SWEEP_STARTUP_DELAY_MS },
    "[temp-bucs-expiry] sweeper started",
  );
  return {
    stop: () => {
      clearTimeout(startupTimer);
      clearInterval(intervalTimer);
    },
  };
}
