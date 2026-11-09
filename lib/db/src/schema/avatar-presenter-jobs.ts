import { pgTable, text, integer, boolean, jsonb, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Avatar-presenter durable jobs (migration 0334, follow-on lane
 * f-avatar-durable — the s400-ca-weak-keys lane's named follow-on).
 *
 * One row per presenter job, keyed by the job id itself (PRIMARY
 * KEY). The CA-KEY keying derives the job id from the paid intent,
 * so twin POSTs land on the SAME job — this table makes that job
 * survive the process: before 0334 the records lived only in the
 * rail's in-memory Map (2h TTL), and a restart between submit and
 * completion orphaned the reserve-at-submit charge with no job
 * left to complete or refund from.
 *
 * The row mirrors the rail's in-memory AvatarJob record field for
 * field: member, status lifecycle, provider job id, the submit
 * inputs the worker needs to finish the job after a restart
 * (jsonb), the result refs, the reserved amount + charge key, and
 * the exactly-once refund claim (credits_refunded) — claimed in
 * the row synchronously with the in-memory flag, before the
 * refund moves, so a replayed completion can never double-refund.
 *
 * The rail treats this table fail-open, exactly like the
 * stored-result tables (0329 / 0330 / 0333): a missing table or a
 * failed write degrades to the pre-0334 in-process behavior and
 * can never error the rail or double-charge.
 */
export const avatarPresenterJobsTable = pgTable(
  "avatar_presenter_jobs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    status: text("status").notNull(),
    avatarId: text("avatar_id").notNull(),
    script: text("script").notNull(),
    providerJobId: text("provider_job_id"),
    outputUrl: text("output_url"),
    error: text("error"),
    creditsCharged: integer("credits_charged").notNull(),
    chargeKey: text("charge_key"),
    creditsRefunded: boolean("credits_refunded").notNull().default(false),
    submitInput: jsonb("submit_input").$type<{
      voiceId?: string;
      aspectRatio?: "16:9" | "9:16" | "1:1";
      imageUrl?: string;
      audioUrl?: string;
      prompt?: string;
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("avatar_presenter_jobs_user_idx").on(t.userId),
    index("avatar_presenter_jobs_created_idx").on(t.createdAt),
  ],
);
