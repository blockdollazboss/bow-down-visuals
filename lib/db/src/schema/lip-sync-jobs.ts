import { pgTable, uuid, text, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Durable lip-sync job records.
 *
 * A lip-sync generation (trim audio/video → submit to Sync.so → poll for
 * 25–40+ minutes) far outlives any browser tab or HTTP request. The job
 * record is the source of truth for the server-owned background poller
 * (see artifacts/api-server/src/lib/job-poller.ts):
 *
 * - `queued`      — accepted by POST /lip-sync/preview, waiting for a submit worker
 * - `submitting`  — a worker claimed it and is trimming media + submitting to Sync.so
 * - `polling`     — submitted; provider_job_id is set, poller checks Sync.so on backoff
 * - `done`        — provider reported completion; result_url is the finished video
 * - `failed`      — terminal; error holds the last provider/worker error
 *
 * State transitions are atomic single-statement UPDATEs (queued→submitting,
 * submitting→polling), so overlapping deploys can never double-submit or
 * double-poll the same job. Jobs left in `submitting` by a dead process are
 * re-queued on boot; jobs in `polling` keep their provider_job_id and the
 * poller simply resumes checking. `history_recorded` is the idempotency
 * gate for the generation_history insert, so a recovered job can never
 * attach its video to the project twice.
 */
export const lipSyncJobsTable = pgTable("lip_sync_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  project_id: uuid("project_id"),
  scene_id: text("scene_id"),
  /** queued | submitting | polling | done | failed */
  state: text("state").notNull().default("queued"),
  /** Full lip-sync request params — everything needed to (re)run the submit. */
  params: jsonb("params").notNull(),
  /** Sync.so provider job id, set once the provider accepts the generation. */
  provider_job_id: text("provider_job_id"),
  /** Provider-reported output URL on success. */
  result_url: text("result_url"),
  /** Normalized error payload on failure. */
  error: jsonb("error"),
  /** How many times a worker has claimed this job for submit. Poison jobs stop at 3. */
  attempts: integer("attempts").notNull().default(0),
  /** How many provider status polls have run. */
  polls: integer("polls").notNull().default(0),
  /** Consecutive provider poll transport failures. The job fails at 5. */
  consecutive_poll_errors: integer("consecutive_poll_errors").notNull().default(0),
  /** When the poller should next check the provider (backoff schedule). */
  next_poll_at: timestamp("next_poll_at", { withTimezone: true }),
  /**
   * When a transient provider rejection (HTTP 429 / plan-concurrency limit)
   * deferred this job's next submit attempt. Submit claims skip rows whose
   * window has not elapsed yet — slots free up over 25–40 min, so the job
   * waits instead of burning its submit attempts in ~2 minutes.
   */
  next_attempt_at: timestamp("next_attempt_at", { withTimezone: true }),
  /**
   * Consecutive transient submit deferrals. Backoff grows 5→10→20→40 min
   * (capped); the job fails with provider_busy_timeout after 36 (~24h).
   * Unlike `attempts`, deferrals are not poison — they are just waiting.
   */
  submit_deferrals: integer("submit_deferrals").notNull().default(0),
  /** Idempotency flag: generation_history is written only on the false→true transition. */
  history_recorded: boolean("history_recorded").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LipSyncJobRow = typeof lipSyncJobsTable.$inferSelect;
