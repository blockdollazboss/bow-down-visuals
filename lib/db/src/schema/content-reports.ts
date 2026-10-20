import { pgTable, uuid, text, timestamp, check, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Member content reports (migration 0174, Stack-4 #3).
 *
 * The member-facing half of moderation: a signed-in member can report
 * a post, a comment, or a creator profile, and the report lands here
 * for a human admin to work (GET/PATCH /api/admin/reports, beside the
 * DMCA bench). Before this table, NO member report path existed at
 * all — no store, no endpoint, no UI.
 *
 * A report never acts on its target: filing one only queues it. The
 * workflow vocabulary mirrors dmca_reports (0088) exactly.
 *
 * "comment" targets live in three stores, resolved by the route in a
 * fixed order: post thread-replies (posts, kind 'thread_reply'),
 * profile_comments (the Shout Wall), media_comments (track/video
 * threads). target_owner_user_id + target_summary are filed-time
 * snapshots so the queue keeps its context even if the target is
 * later deleted.
 */

export const CONTENT_REPORT_TARGET_TYPES = ["post", "comment", "profile"] as const;
export type ContentReportTargetType = (typeof CONTENT_REPORT_TARGET_TYPES)[number];

/** The fixed reason vocabulary — free text belongs in `note`. The
 *  frontend mirrors this list (lib/reports.ts) and the route tests
 *  pin both ends. */
export const CONTENT_REPORT_REASONS = [
  "spam",
  "harassment",
  "hate_speech",
  "violence",
  "sexual_content",
  "copyright",
  "scam",
  "other",
] as const;
export type ContentReportReason = (typeof CONTENT_REPORT_REASONS)[number];

export const CONTENT_REPORT_STATUSES = ["new", "reviewing", "actioned", "dismissed"] as const;
export type ContentReportStatus = (typeof CONTENT_REPORT_STATUSES)[number];

/** Statuses that make a report "open" for duplicate purposes: one
 *  open report per (reporter, target) — the partial unique index in
 *  migration 0174 is the database half of the same rule. */
export const CONTENT_REPORT_OPEN_STATUSES = ["new", "reviewing"] as const;

export const contentReportsTable = pgTable("content_reports", {
  id:                uuid("id").primaryKey().defaultRandom(),
  reporterUserId:    uuid("reporter_user_id").notNull(),
  targetType:        text("target_type").notNull(),
  targetId:          uuid("target_id").notNull(),
  targetOwnerUserId: uuid("target_owner_user_id"),
  targetSummary:     text("target_summary").notNull().default(""),
  reason:            text("reason").notNull(),
  note:              text("note"),
  status:            text("status").notNull().default("new"),
  createdAt:         timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("content_reports_target_type_check", sql`${t.targetType} IN ('post', 'comment', 'profile')`),
  check("content_reports_reason_check", sql`${t.reason} IN ('spam', 'harassment', 'hate_speech', 'violence', 'sexual_content', 'copyright', 'scam', 'other')`),
  check("content_reports_status_check", sql`${t.status} IN ('new', 'reviewing', 'actioned', 'dismissed')`),
  index("content_reports_status_idx").on(t.status, t.createdAt),
  index("content_reports_reporter_idx").on(t.reporterUserId, t.createdAt),
  /* One OPEN report per (reporter, target): the partial unique index
     is the database half of the idempotency rule (the route's
     open-report pre-check is the readable half). Same name +
     predicate as migration 0174. */
  uniqueIndex("content_reports_open_unique_idx").on(t.reporterUserId, t.targetType, t.targetId)
    .where(sql`${t.status} IN ('new', 'reviewing')`),
]);

export const insertContentReportSchema = createInsertSchema(contentReportsTable).omit({ id: true, createdAt: true, status: true });
export type InsertContentReport = z.infer<typeof insertContentReportSchema>;
export type ContentReport = typeof contentReportsTable.$inferSelect;
