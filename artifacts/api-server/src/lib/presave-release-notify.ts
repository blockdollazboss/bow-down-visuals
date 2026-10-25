import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import {
  db as defaultDb,
  type PresaveReleaseDelivery,
} from "@workspace/db";
import { sendEmail, emailShell, emailButton, escapeHtml, baseUrlForEmail, type SendEmailResult } from "./email";
import { logger } from "./logger";

/* ── Release-day presave fan notifications (wave 3 #15; migration 0186) ──
   The presave landing page promises every fan who pre-saves: "You'll
   get one email when the music drops. No spam, ever." This module is
   that email.

   WHERE THE RELEASE MOMENT LIVES: there is no server-side "released"
   status for distribution releases — statuses are draft → packaged
   only, and nothing flips a row on release day. The release moment is
   temporal: a packaged release's release_date arriving. The public
   presave endpoint computes `released` exactly that way (release_date
   YYYY-MM-DD reads as UTC midnight; a full ISO string parses as-is),
   so this sweeper uses the identical rule and fans out when the date
   passes. Drafts never notify — a draft was never submitted.

   EXACTLY-ONCE (the live-alerts discipline, lib/live-alerts.ts): the
   presave_release_deliveries ledger is claimed insert-first —
   INSERT … ON CONFLICT (release_id, email) DO NOTHING — and only a
   claim that lands may send. A retried sweep, a racing sweeper, or a
   restart after a crash can never email a fan twice. A failed attempt
   is recorded ('failed' + last_error) and a later sweep may retry it
   while attempts < MAX_ATTEMPTS; past the cap the row is 'dead' and
   terminal. A claim stuck in 'pending' (the process died mid-send)
   becomes retryable once it is older than STALE_PENDING_MS — the
   retry claim is a status-guarded UPDATE, so even then only one
   sender wins.

   ELIGIBILITY: a follow counts as a pre-save when it was captured no
   later than FOLLOW_GRACE_MS after the release moment (release-day
   followers in every timezone are in; someone who follows a released
   page a week later joined the artist's list, not the pre-save list,
   and gets no stale "out now" email).

   FAILURE ISOLATION: every fan is processed inside their own
   try/catch; one bad address or a provider hiccup never blocks the
   rest of the list, and the fan-out as a whole never throws into the
   sweeper.

   THE SENDER: presave captures are email addresses, so the send rides
   the house transactional rail — lib/email.ts sendEmail (Resend),
   which is fail-open: with no RESEND_API_KEY configured it returns
   { sent: false, reason: "no-provider" } instead of throwing. Those
   attempts land in the ledger as 'failed' with that reason and retry
   on later sweeps (up to the cap) — the ledger + trigger are complete
   either way; delivery itself needs the provider key configured. */

export const PRESAVE_NOTIFY_MAX_ATTEMPTS =
  Number(process.env["PRESAVE_NOTIFY_MAX_ATTEMPTS"]) || 3;
export const PRESAVE_NOTIFY_FOLLOW_GRACE_MS =
  Number(process.env["PRESAVE_NOTIFY_FOLLOW_GRACE_MS"]) || 24 * 60 * 60 * 1000;
export const PRESAVE_NOTIFY_STALE_PENDING_MS =
  Number(process.env["PRESAVE_NOTIFY_STALE_PENDING_MS"]) || 15 * 60 * 1000;
const SWEEP_INTERVAL_MS =
  Number(process.env["PRESAVE_NOTIFY_SWEEP_INTERVAL_MS"]) || 15 * 60 * 1000;
const SWEEP_STARTUP_DELAY_MS =
  Number(process.env["PRESAVE_NOTIFY_SWEEP_STARTUP_DELAY_MS"]) || 45 * 1000;

/** The release moment for a stored release_date — the identical rule
    the public presave endpoint uses: YYYY-MM-DD is UTC midnight, a
    full ISO string parses as-is, anything else is no moment (null). */
export function presaveReleaseTargetMs(releaseDate: string | null | undefined): number | null {
  if (!releaseDate) return null;
  const trimmed = releaseDate.trim();
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? new Date(`${trimmed}T00:00:00Z`).getTime()
    : new Date(trimmed).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export interface DuePresaveRelease {
  id: string;
  title: string;
  artistName: string;
  presaveSlug: string;
  releaseDate: string;
  platformLinks: Record<string, string>;
}

export interface EligibleFollow {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
}

export interface PresaveNotifyStore {
  /** Packaged releases carrying a presave page and a release_date
      whose moment has arrived at `now`. */
  listDueReleases(now: Date): Promise<DuePresaveRelease[]>;
  /** One release's pre-save follows: captured at or before the
      eligibility cutoff (release moment + grace). */
  listEligibleFollows(releaseId: string, cutoff: Date): Promise<EligibleFollow[]>;
  /** Insert-first claim: lands a 'pending' row and returns it, or
      null when a row for (release, email) already exists. */
  claimDelivery(input: {
    releaseId: string;
    followId: string | null;
    email: string;
  }): Promise<PresaveReleaseDelivery | null>;
  /** Read the existing ledger row for (release, email), if any. */
  getDelivery(releaseId: string, email: string): Promise<PresaveReleaseDelivery | null>;
  /** Atomically re-claim a retryable row ('failed' under the attempt
      cap, or a stale 'pending' claim). Returns the row when this call
      won the claim; null when another sender holds it or it is
      terminal. */
  claimRetry(
    deliveryId: string,
    maxAttempts: number,
    stalePendingBefore: Date,
    now: Date,
  ): Promise<PresaveReleaseDelivery | null>;
  markSent(deliveryId: string, providerId: string | null, now: Date): Promise<void>;
  markFailed(deliveryId: string, error: string, dead: boolean, now: Date): Promise<void>;
}

type Db = typeof defaultDb;

/* The store speaks raw SQL through db.execute — the house pattern for
   the whole presave/distribution neighborhood (presave_slug and
   friends live outside the drizzle release schema), and the only
   dialect the pg-mem verification harness executes identically to
   production. Claim semantics are single-statement, exactly as the
   builder form would be: the insert carries ON CONFLICT DO NOTHING,
   the retry claim is a status-guarded UPDATE … RETURNING. */
function deliveryFromRow(raw: Record<string, unknown>): PresaveReleaseDelivery {
  const asDate = (v: unknown): Date | null =>
    v === null || v === undefined ? null : v instanceof Date ? v : new Date(String(v));
  return {
    id: String(raw["id"]),
    releaseId: String(raw["release_id"]),
    followId: raw["follow_id"] === null || raw["follow_id"] === undefined ? null : String(raw["follow_id"]),
    email: String(raw["email"]),
    status: String(raw["status"]),
    attempts: Number(raw["attempts"] ?? 0),
    providerId: raw["provider_id"] === null || raw["provider_id"] === undefined ? null : String(raw["provider_id"]),
    lastError: raw["last_error"] === null || raw["last_error"] === undefined ? null : String(raw["last_error"]),
    sentAt: asDate(raw["sent_at"]),
    createdAt: asDate(raw["created_at"]) ?? new Date(0),
    updatedAt: asDate(raw["updated_at"]) ?? new Date(0),
  } as PresaveReleaseDelivery;
}

const DELIVERY_COLUMNS = sql`id, release_id, follow_id, email, status, attempts, provider_id, last_error, sent_at, created_at, updated_at`;

export function createDrizzlePresaveNotifyStore(db: Db = defaultDb): PresaveNotifyStore {
  return {
    async listDueReleases(now) {
      const result = await db.execute(sql`
        SELECT id, title, artist_name, presave_slug, release_date, presave_platform_links
        FROM distribution_releases
        WHERE status = 'packaged'
          AND presave_slug IS NOT NULL
          AND release_date IS NOT NULL
      `);
      const due: DuePresaveRelease[] = [];
      for (const raw of result.rows as Array<Record<string, unknown>>) {
        const releaseDate = typeof raw["release_date"] === "string" ? raw["release_date"] : null;
        const target = presaveReleaseTargetMs(releaseDate);
        if (target === null || target > now.getTime()) continue;
        due.push({
          id: String(raw["id"]),
          title: String(raw["title"] ?? ""),
          artistName: String(raw["artist_name"] ?? ""),
          presaveSlug: String(raw["presave_slug"] ?? ""),
          releaseDate: releaseDate as string,
          platformLinks: (raw["presave_platform_links"] ?? {}) as Record<string, string>,
        });
      }
      return due;
    },

    async listEligibleFollows(releaseId, cutoff) {
      const result = await db.execute(sql`
        SELECT id, email, name, created_at FROM presave_follows
        WHERE release_id = ${releaseId}
        ORDER BY created_at ASC
      `);
      const follows: EligibleFollow[] = [];
      for (const raw of result.rows as Array<Record<string, unknown>>) {
        /* Some drivers hand timestamptz back as a string — coerce
           before comparing so an eligible follow is never dropped by
           a representation detail. */
        const createdAt =
          raw["created_at"] instanceof Date ? (raw["created_at"] as Date) : new Date(String(raw["created_at"]));
        if (createdAt.getTime() > cutoff.getTime()) continue;
        follows.push({
          id: String(raw["id"]),
          email: String(raw["email"]),
          name: raw["name"] === null || raw["name"] === undefined ? null : String(raw["name"]),
          createdAt,
        });
      }
      return follows;
    },

    async claimDelivery(input) {
      /* The claim id is generated here, not by the DB default: the
         claim counts as landed only when RETURNING hands back THIS
         id. On a conflict the statement inserts nothing — and this
         check keeps that true even on engines whose RETURNING
         surfaces the pre-existing row instead of no row. */
      const claimId = randomUUID();
      const result = await db.execute(sql`
        INSERT INTO presave_release_deliveries (id, release_id, follow_id, email, status)
        VALUES (${claimId}, ${input.releaseId}, ${input.followId}, ${input.email}, 'pending')
        ON CONFLICT (release_id, email) DO NOTHING
        RETURNING ${DELIVERY_COLUMNS}
      `);
      const row = result.rows[0] as unknown as Record<string, unknown> | undefined;
      if (!row || String(row["id"]) !== claimId) return null;
      return deliveryFromRow(row);
    },

    async getDelivery(releaseId, email) {
      const result = await db.execute(sql`
        SELECT ${DELIVERY_COLUMNS} FROM presave_release_deliveries
        WHERE release_id = ${releaseId} AND email = ${email}
        LIMIT 1
      `);
      const row = result.rows[0] as unknown as Record<string, unknown> | undefined;
      return row ? deliveryFromRow(row) : null;
    },

    async claimRetry(deliveryId, maxAttempts, stalePendingBefore, now) {
      const result = await db.execute(sql`
        UPDATE presave_release_deliveries
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
        UPDATE presave_release_deliveries
        SET status = 'sent', attempts = attempts + 1, provider_id = ${providerId},
            last_error = NULL, sent_at = ${now}, updated_at = ${now}
        WHERE id = ${deliveryId}
      `);
    },

    async markFailed(deliveryId, error, dead, now) {
      await db.execute(sql`
        UPDATE presave_release_deliveries
        SET status = ${dead ? "dead" : "failed"}, attempts = attempts + 1,
            last_error = ${error.slice(0, 500)}, updated_at = ${now}
        WHERE id = ${deliveryId}
      `);
    },
  };
}

export interface PresaveNotifyDeps {
  store?: PresaveNotifyStore;
  send?: (opts: { to: string; subject: string; html: string; text?: string }) => Promise<SendEmailResult>;
  now?: Date;
  maxAttempts?: number;
  followGraceMs?: number;
  stalePendingMs?: number;
}

function deps(depsIn: PresaveNotifyDeps): Required<PresaveNotifyDeps> {
  return {
    store: depsIn.store ?? createDrizzlePresaveNotifyStore(),
    send: depsIn.send ?? sendEmail,
    now: depsIn.now ?? new Date(),
    maxAttempts: depsIn.maxAttempts ?? PRESAVE_NOTIFY_MAX_ATTEMPTS,
    followGraceMs: depsIn.followGraceMs ?? PRESAVE_NOTIFY_FOLLOW_GRACE_MS,
    stalePendingMs: depsIn.stalePendingMs ?? PRESAVE_NOTIFY_STALE_PENDING_MS,
  };
}

/** The release-day email for one fan. Every artist/fan string is
    escaped; the listen link is the presave page itself, which
    persists after release day as the release's smartlink. */
export function buildPresaveReleaseEmail(
  release: DuePresaveRelease,
  follow: Pick<EligibleFollow, "email" | "name">,
): { to: string; subject: string; html: string; text: string } {
  const listenUrl = `${baseUrlForEmail()}/presave/${release.presaveSlug}`;
  const title = escapeHtml(release.title);
  const artist = escapeHtml(release.artistName);
  const greeting = follow.name?.trim()
    ? `<p>Hi ${escapeHtml(follow.name.trim())},</p>`
    : "";
  const links = Object.entries(release.platformLinks ?? {})
    .filter(([, url]) => typeof url === "string" && /^https?:\/\//i.test(url))
    .map(
      ([platform, url]) =>
        `<p style="margin:8px 0;"><a href="${escapeHtml(url)}" style="color:#a67c1a;">Listen on ${escapeHtml(platform.replace(/_/g, " "))}</a></p>`,
    )
    .join("");
  const html = emailShell(
    `${title} is out now`,
    `${greeting}
<p>You pre-saved it, and the wait is over — <strong>${title}</strong> by ${artist} just dropped.</p>
${emailButton(escapeHtml(listenUrl), "Listen now")}
${links}
<p style="color:#8a7c5c;font-size:13px;">You got this email because you pre-saved this release on Bow Down Visuals. One email per release, as promised — no spam, ever.</p>`,
  );
  const text = [
    `${release.title} by ${release.artistName} is out now.`,
    `You pre-saved it — listen here: ${listenUrl}`,
    `You got this email because you pre-saved this release on Bow Down Visuals. One email per release, as promised.`,
  ].join("\n");
  return {
    to: follow.email,
    subject: `Out now: ${release.title} — ${release.artistName}`,
    html,
    text,
  };
}

export interface PresaveFanoutResult {
  follows: number;
  claimed: number;
  sent: number;
  failed: number;
  /** Fans whose ledger row already resolved (or is held by another
      sender) — no send attempted. */
  skipped: number;
}

/**
 * Notify every eligible pre-save fan of one due release, exactly once.
 * Never throws: a per-fan failure is ledgered and logged, and the
 * rest of the list still goes out.
 */
export async function notifyPresaveFansForRelease(
  release: DuePresaveRelease,
  depsIn: PresaveNotifyDeps = {},
): Promise<PresaveFanoutResult> {
  const d = deps(depsIn);
  const result: PresaveFanoutResult = { follows: 0, claimed: 0, sent: 0, failed: 0, skipped: 0 };
  const target = presaveReleaseTargetMs(release.releaseDate);
  if (target === null) return result;
  const cutoff = new Date(target + d.followGraceMs);
  const stalePendingBefore = new Date(d.now.getTime() - d.stalePendingMs);

  let follows: EligibleFollow[];
  try {
    follows = await d.store.listEligibleFollows(release.id, cutoff);
  } catch (err) {
    logger.error({ err, releaseId: release.id }, "[presave-notify] follow read failed — no emails sent this pass");
    return result;
  }
  result.follows = follows.length;

  for (const follow of follows) {
    try {
      let row = await d.store.claimDelivery({
        releaseId: release.id,
        followId: follow.id,
        email: follow.email,
      });
      if (!row) {
        const existing = await d.store.getDelivery(release.id, follow.email);
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

      const sendResult = await d.send(buildPresaveReleaseEmail(release, follow));
      if (sendResult.sent) {
        await d.store.markSent(row.id, sendResult.id ?? null, d.now);
        result.sent++;
      } else {
        const reason = sendResult.reason ?? "send-failed";
        await d.store.markFailed(row.id, reason, row.attempts + 1 >= d.maxAttempts, d.now);
        result.failed++;
        logger.warn(
          { releaseId: release.id, email: follow.email, reason },
          "[presave-notify] release-day email not sent (ledgered for retry)",
        );
      }
    } catch (err) {
      /* One fan must never block the rest of the list. */
      result.failed++;
      logger.error({ err, releaseId: release.id, email: follow.email }, "[presave-notify] fan delivery failed — isolated");
    }
  }
  return result;
}

export interface PresaveSweepResult {
  releases: number;
  follows: number;
  sent: number;
  failed: number;
  skipped: number;
}

/** One sweep: every due release fans out; a broken release never
    blocks the others. This is the release-day trigger — the sweeper
    below runs it shortly after boot and on an interval. */
export async function sweepDuePresaveReleases(
  depsIn: PresaveNotifyDeps = {},
): Promise<PresaveSweepResult> {
  const d = deps(depsIn);
  const totals: PresaveSweepResult = { releases: 0, follows: 0, sent: 0, failed: 0, skipped: 0 };
  let releases: DuePresaveRelease[];
  try {
    releases = await d.store.listDueReleases(d.now);
  } catch (err) {
    logger.error({ err }, "[presave-notify] due-release scan failed");
    return totals;
  }
  totals.releases = releases.length;
  for (const release of releases) {
    try {
      const r = await notifyPresaveFansForRelease(release, depsIn);
      totals.follows += r.follows;
      totals.sent += r.sent;
      totals.failed += r.failed;
      totals.skipped += r.skipped;
      if (r.sent > 0 || r.failed > 0) {
        logger.info(
          { releaseId: release.id, title: release.title, ...r },
          "[presave-notify] release-day fan-out pass complete",
        );
      }
    } catch (err) {
      logger.error({ err, releaseId: release.id }, "[presave-notify] release fan-out crashed — continuing with the next release");
    }
  }
  return totals;
}

/* Starts the release-day sweeper: one run shortly after boot (a
   deploy on release morning still notifies), then on the configured
   interval. A sweep that throws is logged, never fatal. */
export function startPresaveReleaseSweeper(
  depsIn: PresaveNotifyDeps = {},
): { stop: () => void } {
  const run = () =>
    sweepDuePresaveReleases(depsIn).catch((err) =>
      logger.error({ err }, "[presave-notify] sweep crashed"),
    );
  const startupTimer = setTimeout(run, SWEEP_STARTUP_DELAY_MS);
  const intervalTimer = setInterval(run, SWEEP_INTERVAL_MS);
  logger.info(
    { intervalMs: SWEEP_INTERVAL_MS, startupDelayMs: SWEEP_STARTUP_DELAY_MS },
    "[presave-notify] release-day sweeper started",
  );
  return {
    stop: () => {
      clearTimeout(startupTimer);
      clearInterval(intervalTimer);
    },
  };
}
