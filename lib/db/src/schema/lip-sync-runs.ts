import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Durable lip-sync RUN-ALL orchestration records (migration 0217,
 * Stack-100 #3 editor A-08).
 *
 * The per-scene sub-jobs are durable (lip_sync_jobs) and the final export
 * is durable (export_jobs), but the run record used to live in a process
 * Map (routes/lip-sync.ts): a restart mid-run stranded finished scenes
 * with no run to poll. This row is the run record:
 *
 * - `state`        — running | done | failed
 * - `scenes`       — RunAllScene[] (per-scene status, mirrors the Map shape)
 * - `export_state` — pending | running | done | failed | skipped
 * - `params`       — everything needed to RESUME orchestration after a
 *   restart: scene ids + clip URLs, timings, resolved audio ref, settings
 *   snapshot. NOT the request JWT: resume runs under the service-role
 *   client with ownership re-verified from user_id/project_id.
 *
 * Boot recovery re-drives rows left in `running` (see routes/lip-sync.ts);
 * terminal rows are swept after a retention TTL.
 */
export const lipSyncRunsTable = pgTable("lip_sync_runs", {
  id: uuid("id").primaryKey(),
  user_id: uuid("user_id").notNull(),
  project_id: uuid("project_id").notNull(),
  state: text("state").notNull().default("running"),
  scenes: jsonb("scenes").notNull().default([]),
  export_state: text("export_state").notNull().default("pending"),
  export_job_id: uuid("export_job_id"),
  video_url: text("video_url"),
  error: text("error"),
  params: jsonb("params").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LipSyncRunRow = typeof lipSyncRunsTable.$inferSelect;
