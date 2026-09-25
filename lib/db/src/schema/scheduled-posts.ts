import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

/* Content Scheduler — DB-backed scheduled social posts.
 *
 * The scheduler is server-owned and restart-safe: a post moves
 * draft → scheduled → publishing → posted|failed entirely through this
 * table, and the job-poller tick (see api-server/src/lib/job-poller.ts)
 * claims due rows with a single atomic UPDATE … WHERE status='scheduled'.
 * No in-memory state, so a deploy/restart can never lose or double-fire
 * a scheduled post.
 *
 * Money model:
 * - Drafts are free.
 * - Scheduling charges 1 credit per scheduled post UP FRONT (regardless of
 *   platform count), recorded in credits_charged. The worker then publishes
 *   through the existing provider helpers WITHOUT charging again (it marks
 *   the idempotency attempt as credits-deducted).
 * - Cancel → automatic refund of the 1 credit.
 * - Total provider failure at fire time → automatic refund of the 1 credit.
 *   Partial success (posted to ≥1 platform) → no refund; the post delivered.
 * - The AI best-time suggestion is a separate 1-credit call, refunded on
 *   provider failure.
 *
 * user_id references the Supabase auth user (no DB-level FK: auth lives in
 * Supabase, this table in Render Postgres). See
 * migrations/0009_content_scheduler.sql — the schema here must stay in
 * sync with it so boot-time `drizzle-kit push` matches the migration. */

export type ScheduledPostStatus =
  | "draft"
  | "scheduled"
  | "publishing"
  | "posted"
  | "failed"
  | "canceled";

export type SchedulerPlatform = "instagram" | "tiktok" | "facebook";

export type SchedulerMediaType = "video" | "image";

/** Per-platform result recorded when the worker fires. */
export interface ScheduledPlatformResult {
  platform: SchedulerPlatform;
  status: "posted" | "failed" | "skipped";
  mediaId?: string;
  permalink?: string | null;
  error?: string;
}

/** AI best-time suggestion payload (stored for review, free to view). */
export interface AiBestTimeSuggestion {
  suggestedAt: string;
  timezone: string;
  slots: Array<{
    date: string;
    time: string;
    platform: SchedulerPlatform;
    reason: string;
  }>;
  note: string;
}

export const scheduledPostsTable = pgTable(
  "scheduled_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(),
    status: text("status")
      .notNull()
      .default("draft")
      .$type<ScheduledPostStatus>(),
    /* Media to post. Supabase storage refs (supabase://…) are resolved to
       fresh signed URLs at fire time, same as the social pipeline. */
    media_url: text("media_url").notNull(),
    media_type: text("media_type")
      .notNull()
      .default("video")
      .$type<SchedulerMediaType>(),
    caption: text("caption").notNull().default(""),
    hashtags: text("hashtags").notNull().default(""),
    platforms: jsonb("platforms")
      .notNull()
      .default([])
      .$type<SchedulerPlatform[]>(),
    /* platform → social_accounts.id (the connected account to post from) */
    account_ids: jsonb("account_ids")
      .notNull()
      .default({})
      .$type<Record<string, string>>(),
    scheduled_at: timestamp("scheduled_at", { withTimezone: true }),
    posted_at: timestamp("posted_at", { withTimezone: true }),
    attempts: integer("attempts").notNull().default(0),
    last_error: text("last_error"),
    /* The 1-credit reservation taken at schedule time. Refunded on cancel
       or total provider failure. */
    credits_charged: integer("credits_charged").notNull().default(0),
    /* True once the reservation was refunded — prevents double refunds. */
    credits_refunded: boolean("credits_refunded").notNull().default(false),
    ai_best_time: jsonb("ai_best_time").$type<AiBestTimeSuggestion | null>(),
    results: jsonb("results")
      .notNull()
      .default([])
      .$type<ScheduledPlatformResult[]>(),
    created_at: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("scheduled_posts_user_id_idx").on(t.user_id),
    index("scheduled_posts_status_idx").on(t.status),
    /* The worker's due-claim query: scheduled + due, oldest first. */
    index("scheduled_posts_due_idx").on(t.status, t.scheduled_at),
  ],
);

export type ScheduledPost = typeof scheduledPostsTable.$inferSelect;
export type NewScheduledPost = typeof scheduledPostsTable.$inferInsert;
