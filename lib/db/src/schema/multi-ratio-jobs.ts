import { pgTable, uuid, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Durable multi-ratio export jobs (migration 0218, Stack-100 #3 editor
 * A-08).
 *
 * The job store used to be a process Map while the full cost is charged
 * UP FRONT (routes/generate/export-multi-ratio.ts): a hard kill skipped
 * the worker's refund finally — the charge stood, the poll endpoint
 * 404'd, and finished ratios' durable storage URLs became unreachable.
 * This row is the job record:
 *
 * - `state`    — queued | active | done | failed
 * - `ratios`   — RatioResult[] (per-ratio status + durable URL)
 * - `refunded` — total cents-of-credit refunded by settlement (the
 *   settle function runs from the worker AND from boot recovery;
 *   recovery refunds every ratio that never completed, then marks the
 *   job failed with error 'interrupted_by_restart')
 *
 * Per-ratio charging does not fit export_jobs' single credits_charged
 * flag, hence the dedicated table.
 */
export const multiRatioJobsTable = pgTable("multi_ratio_jobs", {
  id: uuid("id").primaryKey(),
  user_id: uuid("user_id").notNull(),
  video_url: text("video_url").notNull(),
  cost_total: integer("cost_total").notNull(),
  cost_per_ratio: integer("cost_per_ratio").notNull(),
  ratios: jsonb("ratios").notNull().default([]),
  state: text("state").notNull().default("queued"),
  error: text("error"),
  refunded: integer("refunded"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MultiRatioJobRow = typeof multiRatioJobsTable.$inferSelect;
