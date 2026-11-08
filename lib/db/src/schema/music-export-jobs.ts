import { pgTable, uuid, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Durable music (mix) export jobs (migration 0326, stack300
 * export-reliability item 62).
 *
 * Mix renders used to live in a process Map in routes/music-export.ts:
 * a restart killed every in-flight render and the poll endpoint 404'd.
 * This row is the source of truth, mirroring export_jobs:
 *
 * - `state`  — queued | processing | done | failed (the poll
 *   endpoint's own status vocabulary)
 * - `params` — everything needed to (re)run the render: the parsed
 *   stem inputs, master settings, format/kind, disclosure toggle
 * - `result` — the MixExportJobResult payload on success
 * - `attempt_key` — duplicate-submit guard (item 64): derived from
 *   (user + params hash) at creation; a duplicate POST inside the
 *   dedup window returns the existing queued/processing job
 * - `attempts` — worker claims; poison jobs stop at 3 (the
 *   export_jobs standard) and fail honestly at boot recovery
 */
export const musicExportJobsTable = pgTable("music_export_jobs", {
  id: uuid("id").primaryKey(),
  user_id: uuid("user_id").notNull(),
  state: text("state").notNull().default("queued"),
  params: jsonb("params").notNull(),
  result: jsonb("result"),
  error: text("error"),
  code: text("code"),
  attempt_key: text("attempt_key"),
  attempts: integer("attempts").notNull().default(0),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
