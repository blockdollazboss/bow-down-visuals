import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { logger } from "./logger";

/**
 * Exactly-once job completion/failure notifications.
 *
 * When a lip-sync or export job reaches a terminal state, the background
 * poller calls `notifyJobCompletion` / `notifyJobFailed`. The
 * UNIQUE(job_type, job_id) constraint on `job_notifications` is the
 * exactly-once gate — INSERT … ON CONFLICT DO NOTHING — so a job can
 * never produce a second ping no matter how many times the poller, boot
 * recovery, or a relay re-checks it.
 *
 * Delivery channels are chosen with JOB_NOTIFY_CHANNEL (no code changes):
 * - `relay`   (default) — the row waits in the table; an external relay
 *               (the assistant's scheduled check) fetches it via
 *               GET /api/job-notifications/pending and ACKs it after the
 *               user has been pinged in chat. Switching the relay's
 *               destination to Discord later needs no server changes.
 * - `discord` — the server POSTs the ping straight to
 *               JOB_NOTIFY_DISCORD_WEBHOOK_URL and marks it delivered.
 * - `log`     — dev fallback: logged and marked delivered.
 * - `none`    — stored but never delivered.
 */

export type JobType = "lip_sync" | "export";
export type JobCompletionStatus = "completed" | "failed";
export type NotifyChannel = "relay" | "discord" | "log" | "none";

export interface JobNotificationInput {
  jobType: JobType;
  jobId: string;
  userId: string;
  projectId?: string | null;
  status: JobCompletionStatus;
  title: string;
  message: string;
  videoUrl?: string | null;
}

export interface JobNotification extends JobNotificationInput {
  id: string;
  deliveredAt: number | null;
  deliveryChannel: string | null;
  deliveryAttempts: number;
  createdAt: number;
}

let _pool: Pool | null = null;

type DrizzleDb = ReturnType<typeof drizzle>;
let _dbOverride: DrizzleDb | null = null;
/** Test seam — never used outside tests. */
export function __setJobNotificationsDb(db: DrizzleDb | null): void {
  _dbOverride = db;
}

function getPool(): Pool {
  if (!_pool) {
    const connectionString = process.env["DATABASE_URL"];
    if (!connectionString) {
      throw new Error("DATABASE_URL is not configured — cannot access job_notifications.");
    }
    _pool = new Pool({ connectionString, max: 5 });
  }
  return _pool;
}

function db(): DrizzleDb {
  return _dbOverride ?? drizzle(getPool());
}

const NOTIF_COLUMNS = sql`id, job_type, job_id, user_id, project_id, status, title, message, video_url, delivered_at, delivery_channel, delivery_attempts, created_at`;

function toNotification(row: Record<string, unknown>): JobNotification {
  return {
    id: String(row["id"]),
    jobType: row["job_type"] as JobType,
    jobId: String(row["job_id"]),
    userId: String(row["user_id"]),
    projectId: row["project_id"] != null ? String(row["project_id"]) : null,
    status: row["status"] as JobCompletionStatus,
    title: String(row["title"] ?? ""),
    message: String(row["message"] ?? ""),
    videoUrl: row["video_url"] != null ? String(row["video_url"]) : null,
    deliveredAt: row["delivered_at"] != null ? new Date(row["delivered_at"] as string).getTime() : null,
    deliveryChannel: row["delivery_channel"] != null ? String(row["delivery_channel"]) : null,
    deliveryAttempts: Number(row["delivery_attempts"] ?? 0),
    createdAt: new Date(row["created_at"] as string).getTime(),
  };
}

export function getNotifyChannel(): NotifyChannel {
  const raw = (process.env["JOB_NOTIFY_CHANNEL"] ?? "relay").toLowerCase().trim();
  if (raw === "discord" || raw === "log" || raw === "none" || raw === "relay") return raw;
  logger.warn({ raw }, "[job-notifications] unknown JOB_NOTIFY_CHANNEL; falling back to relay");
  return "relay";
}

/**
 * Record a job's terminal outcome. Returns true when this call created the
 * notification, false when one already existed (exactly-once).
 * Depending on JOB_NOTIFY_CHANNEL, delivery may happen inline (discord/log)
 * or be left for the relay.
 */
export async function createJobNotification(input: JobNotificationInput): Promise<boolean> {
  const id = randomUUID();
  const res = await db().execute(sql`
    INSERT INTO job_notifications (id, job_type, job_id, user_id, project_id, status, title, message, video_url)
    VALUES (
      ${id},
      ${input.jobType},
      ${input.jobId},
      ${input.userId},
      ${input.projectId ?? null},
      ${input.status},
      ${input.title},
      ${input.message},
      ${input.videoUrl ?? null}
    )
    ON CONFLICT DO NOTHING
    RETURNING ${NOTIF_COLUMNS}
  `);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) {
    // A notification already exists for this job — exactly-once held.
    return false;
  }
  const notification = toNotification(row);
  logger.info(
    { jobType: input.jobType, jobId: input.jobId, status: input.status },
    "[job-notifications] recorded",
  );
  const channel = getNotifyChannel();
  if (channel === "discord" || channel === "log") {
    await dispatchDirect(notification, channel).catch((err) =>
      logger.error({ err, id: notification.id }, "[job-notifications] direct dispatch failed; left for relay"),
    );
  }
  return true;
}

/** Convenience wrapper for failures — surfaces the last error as the message. */
export async function notifyJobFailed(input: Omit<JobNotificationInput, "status">): Promise<boolean> {
  return createJobNotification({ ...input, status: "failed" });
}

/** Oldest undelivered notifications, for the relay. */
export async function listPendingNotifications(limit = 20): Promise<JobNotification[]> {
  const res = await db().execute(sql`
    SELECT ${NOTIF_COLUMNS} FROM job_notifications
    WHERE delivered_at IS NULL
    ORDER BY created_at ASC
    LIMIT ${Math.max(1, Math.min(limit, 50))}
  `);
  return (res.rows as Record<string, unknown>[]).map(toNotification);
}

/**
 * Atomically mark a notification delivered. Returns false when the row is
 * missing or was already delivered — two relays racing the same row still
 * produce exactly one user-facing ping.
 */
export async function ackJobNotification(id: string, channel: string): Promise<boolean> {
  const res = await db().execute(sql`
    UPDATE job_notifications
    SET delivered_at = now(), delivery_channel = ${channel}
    WHERE id = ${id} AND delivered_at IS NULL
    RETURNING id
  `);
  return res.rows.length > 0;
}

/** Direct (non-relay) delivery: Discord webhook or dev log. */
async function dispatchDirect(n: JobNotification, channel: "discord" | "log"): Promise<void> {
  if (channel === "log") {
    logger.info(
      { jobType: n.jobType, jobId: n.jobId, status: n.status, title: n.title },
      `[job-notifications] ${n.title} — ${n.message}`,
    );
    await ackJobNotification(n.id, "log");
    return;
  }
  const webhookUrl = process.env["JOB_NOTIFY_DISCORD_WEBHOOK_URL"];
  if (!webhookUrl) {
    logger.warn("[job-notifications] JOB_NOTIFY_CHANNEL=discord but JOB_NOTIFY_DISCORD_WEBHOOK_URL is not set; leaving for relay");
    return;
  }
  const emoji = n.status === "completed" ? "✅" : "❌";
  const body = {
    content: `${emoji} **${n.title}**\n${n.message}${n.videoUrl ? `\n${n.videoUrl}` : ""}`,
  };
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord webhook HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  await ackJobNotification(n.id, "discord");
  logger.info({ id: n.id }, "[job-notifications] delivered via Discord webhook");
}

/**
 * Backfill "it's ready" pings for terminal export jobs.
 *
 * Export renders already run server-side to completion with durable state
 * (lib/export-jobs.ts) — the tab could always close — but nothing ever
 * pinged the user when one finished. Each poller tick picks up export_jobs
 * rows in done/failed (last 24h) that have no notification yet and records
 * exactly one (the UNIQUE constraint holds even if two ticks race).
 * Returns how many notifications were created.
 */
export async function notifyTerminalExportJobs(): Promise<number> {
  let rows: Record<string, unknown>[];
  try {
    const res = await db().execute(sql`
      SELECT j.id, j.user_id, j.project_id, j.state, j.result, j.error
      FROM export_jobs j
      LEFT JOIN job_notifications n
        ON n.job_type = 'export' AND n.job_id = j.id::text
      WHERE j.state IN ('done', 'failed')
        AND n.id IS NULL
        AND j.updated_at > now() - interval '24 hours'
      LIMIT 20
    `);
    rows = res.rows as Record<string, unknown>[];
  } catch (err) {
    // export_jobs may not exist yet on a fresh database — non-fatal.
    logger.warn({ err }, "[job-notifications] export backfill select failed; skipping");
    return 0;
  }
  let created = 0;
  for (const r of rows) {
    const jobId = String(r["id"]);
    const state = String(r["state"]);
    try {
      let ok: boolean;
      if (state === "done") {
        const result = asJsonRecord(r["result"]);
        const videoUrl = typeof result?.["url"] === "string" ? (result["url"] as string) : null;
        ok = await createJobNotification({
          jobType: "export",
          jobId,
          userId: String(r["user_id"]),
          projectId: r["project_id"] != null ? String(r["project_id"]) : null,
          status: "completed",
          title: "Export ready",
          message: "Your video export finished.",
          videoUrl,
        });
      } else {
        const errRec = asJsonRecord(r["error"]);
        const message =
          typeof errRec?.["message"] === "string" && errRec["message"]
            ? String(errRec["message"])
            : "The export failed.";
        ok = await createJobNotification({
          jobType: "export",
          jobId,
          userId: String(r["user_id"]),
          projectId: r["project_id"] != null ? String(r["project_id"]) : null,
          status: "failed",
          title: "Export failed",
          message: message.length > 500 ? `${message.slice(0, 500)}…` : message,
        });
      }
      if (ok) created++;
    } catch (err) {
      logger.warn({ err, jobId }, "[job-notifications] export backfill notification failed");
    }
  }
  return created;
}

function asJsonRecord(v: unknown): Record<string, unknown> | null {
  if (v == null) return null;
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v) as unknown;
      return typeof p === "object" && p !== null ? (p as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return typeof v === "object" ? (v as Record<string, unknown>) : null;
}
