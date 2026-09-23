import { pgTable, uuid, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Durable export job records.
 *
 * A full video export (download clips → normalize → FFmpeg stitch with
 * captions/effects → upload → sign URL) takes several minutes. The render
 * runs as a background job and the client polls for progress — so the job
 * record must survive a server restart. The previous in-memory registry
 * lost every in-flight render whenever the backend redeployed or crashed
 * (polling then 404'd mid-render). These rows are the source of truth:
 * stage/progress are persisted as the render advances, credits are charged
 * exactly once via the credits_charged flag, and jobs left in
 * queued/active by a dead process are re-queued automatically on boot.
 */
export const exportJobsTable = pgTable("export_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  project_id: uuid("project_id").notNull(),
  /** queued | active | done | failed */
  state: text("state").notNull().default("queued"),
  /** Last observed render stage (e.g. "combining", "normalizing clip 2/7"). */
  stage: text("stage").notNull().default("queued"),
  /** 0–100 progress estimate, derived from stage. */
  progress: integer("progress").notNull().default(0),
  /** Full export request body — everything needed to (re)run the render. */
  params: jsonb("params").notNull(),
  /** executeExport result payload (url, objectPath, …) on success. */
  result: jsonb("result"),
  /** Normalized error payload on failure. */
  error: jsonb("error"),
  /** Idempotency flag: credits are deducted only on the false→true transition. */
  credits_charged: boolean("credits_charged").notNull().default(false),
  /** How many times a worker has claimed this job. Poison jobs stop at 3. */
  attempts: integer("attempts").notNull().default(0),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ExportJobRow = typeof exportJobsTable.$inferSelect;
