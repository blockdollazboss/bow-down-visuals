import { pgTable, uuid, text, integer, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * Exactly-once completion/failure notifications for server-owned jobs.
 *
 * When a lip-sync or export job reaches a terminal state, the background
 * poller inserts one row here. The UNIQUE(job_type, job_id) constraint is
 * the exactly-once gate: INSERT … ON CONFLICT DO NOTHING means a job can
 * never produce a second ping, no matter how many times the poller,
 * boot recovery, or a relay re-checks it.
 *
 * Delivery is channel-agnostic by design (see JOB_NOTIFY_CHANNEL):
 * - `relay`   (default) — the row waits here; an external relay (the
 *               assistant's scheduled check) picks it up via
 *               GET /api/job-notifications/pending and ACKs it after the
 *               user has been pinged in chat (Discord later — same relay,
 *               different destination, no code changes).
 * - `discord` — the server POSTs straight to JOB_NOTIFY_DISCORD_WEBHOOK_URL.
 * - `log`     — dev fallback: logged, marked delivered.
 * - `none`    — stored but never delivered.
 *
 * `delivered_at` is flipped atomically (only when still NULL), so two
 * relays racing the same row still produce exactly one user-facing ping.
 */
export const jobNotificationsTable = pgTable(
  "job_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** 'lip_sync' | 'export' */
    job_type: text("job_type").notNull(),
    /** Source job id. */
    job_id: text("job_id").notNull(),
    user_id: uuid("user_id").notNull(),
    project_id: uuid("project_id"),
    /** 'completed' | 'failed' */
    status: text("status").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    /** Finished video URL, when there is one. */
    video_url: text("video_url"),
    /** Set when a delivery channel confirms the ping went out. */
    delivered_at: timestamp("delivered_at", { withTimezone: true }),
    delivery_channel: text("delivery_channel"),
    delivery_attempts: integer("delivery_attempts").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("job_notifications_job_uniq").on(t.job_type, t.job_id)],
);

export type JobNotificationRow = typeof jobNotificationsTable.$inferSelect;
