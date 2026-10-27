import { pgTable, uuid, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Durable Vault job records (Stack-200 UPGRADE #162 — The Vault).
 *
 * The Vault is the full-ownership export: ONE archive of everything a
 * creator owns — original songs/videos/art at full quality plus their
 * data (the existing /api/account/export JSON, sales + splits records,
 * settings). Gathering originals and packaging a large archive takes
 * far longer than a proxy will hold a request open, so — exactly like
 * export_jobs — the job record lives in Postgres: the route returns
 * 202 with a jobId, the client polls, stage/progress persist as the
 * packager advances, and jobs left queued/active by a dead process are
 * re-queued on boot (the persisted userId is everything a re-run needs).
 */
export const vaultJobsTable = pgTable("vault_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  /** queued | active | done | failed */
  state: text("state").notNull().default("queued"),
  /** Last observed packaging stage (e.g. "packaging media 3/12"). */
  stage: text("stage").notNull().default("queued"),
  /** 0–100 progress estimate, derived from stage. */
  progress: integer("progress").notNull().default(0),
  /** On success: { r2Key, fileName, sizeBytes, fileCount, skippedCount }. */
  result: jsonb("result"),
  /** Normalized error payload on failure. */
  error: jsonb("error"),
  /** How many times a worker has claimed this job. Poison jobs stop at 3. */
  attempts: integer("attempts").notNull().default(0),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VaultJobRow = typeof vaultJobsTable.$inferSelect;
