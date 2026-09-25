import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { logger } from "./logger";

/**
 * Durable lip-sync job store.
 *
 * Lip-sync jobs used to live in a module-level Map inside the lip-sync
 * route. Every backend restart, redeploy, or crash wiped in-flight jobs —
 * and because Sync.so generations run 25–40+ minutes, the browser tab had
 * to stay open polling or the job was lost. Job records now live in the
 * `lip_sync_jobs` table (created via drizzle-kit push on boot):
 *
 * - POST /lip-sync/preview inserts a `queued` row and returns immediately;
 * - the background poller (lib/job-poller.ts) claims queued rows,
 *   submits them to Sync.so, then polls the provider on a backoff
 *   schedule until completion or failure — no tab required;
 * - jobs left in `submitting` by a dead process are re-queued on boot,
 *   jobs in `polling` keep their provider_job_id and polling resumes;
 * - `history_recorded` gates the generation_history insert so a recovered
 *   job can never attach its video to the project twice.
 */

export type LipSyncJobState = "queued" | "submitting" | "polling" | "done" | "failed";

export interface LipSyncJobParams {
  clipUrl: string;
  audioUrl: string;
  sceneStartSec: number;
  sceneEndSec: number;
  provider?: string | null;
}

export interface LipSyncJobError {
  message: string;
  code?: string;
  providerStatus?: unknown;
}

export interface LipSyncJob {
  id: string;
  userId: string;
  projectId: string | null;
  sceneId: string | null;
  state: LipSyncJobState;
  params: LipSyncJobParams;
  providerJobId: string | null;
  resultUrl: string | null;
  error: LipSyncJobError | null;
  attempts: number;
  polls: number;
  consecutivePollErrors: number;
  nextPollAt: number | null;
  historyRecorded: boolean;
  createdAt: number;
  updatedAt: number;
}

let _pool: Pool | null = null;

/* Test seam: __setLipSyncJobsDb lets the $0 verification suite run every
   query below against an in-memory Postgres without touching production.
   Never used outside tests. */
type DrizzleDb = ReturnType<typeof drizzle>;
let _dbOverride: DrizzleDb | null = null;
export function __setLipSyncJobsDb(db: DrizzleDb | null): void {
  _dbOverride = db;
}

function getPool(): Pool {
  if (!_pool) {
    const connectionString = process.env["DATABASE_URL"];
    if (!connectionString) {
      throw new Error("DATABASE_URL is not configured — cannot access lip_sync_jobs.");
    }
    _pool = new Pool({ connectionString, max: 5 });
  }
  return _pool;
}

function db(): DrizzleDb {
  return _dbOverride ?? drizzle(getPool());
}

const JOB_COLUMNS = sql`id, user_id, project_id, scene_id, state, params, provider_job_id, result_url, error, attempts, polls, consecutive_poll_errors, next_poll_at, history_recorded, created_at, updated_at`;

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v == null) return null;
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v) as unknown;
      return typeof p === "object" && p !== null ? (p as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function toLipSyncJob(row: Record<string, unknown>): LipSyncJob {
  const params = asRecord(row["params"]) as unknown as LipSyncJobParams | null;
  return {
    id: String(row["id"]),
    userId: String(row["user_id"]),
    projectId: row["project_id"] != null ? String(row["project_id"]) : null,
    sceneId: row["scene_id"] != null ? String(row["scene_id"]) : null,
    state: row["state"] as LipSyncJobState,
    params: params ?? { clipUrl: "", audioUrl: "", sceneStartSec: 0, sceneEndSec: 0 },
    providerJobId: row["provider_job_id"] != null ? String(row["provider_job_id"]) : null,
    resultUrl: row["result_url"] != null ? String(row["result_url"]) : null,
    error: asRecord(row["error"]) as LipSyncJobError | null,
    attempts: Number(row["attempts"] ?? 0),
    polls: Number(row["polls"] ?? 0),
    consecutivePollErrors: Number(row["consecutive_poll_errors"] ?? 0),
    nextPollAt: row["next_poll_at"] != null ? new Date(row["next_poll_at"] as string).getTime() : null,
    historyRecorded: row["history_recorded"] === true,
    createdAt: new Date(row["created_at"] as string).getTime(),
    updatedAt: new Date(row["updated_at"] as string).getTime(),
  };
}

export interface CreateLipSyncJobInput {
  userId: string;
  projectId?: string | null;
  sceneId?: string | null;
  params: LipSyncJobParams;
}

/** Create the durable job row. Returns the job (state=queued). */
export async function createLipSyncJob(input: CreateLipSyncJobInput): Promise<LipSyncJob> {
  const d = db();
  // Best-effort prune of old terminal jobs; never blocks creation.
  d.execute(
    sql`DELETE FROM lip_sync_jobs WHERE state IN ('done', 'failed') AND created_at < now() - interval '7 days'`,
  ).catch((err) => logger.warn({ err }, "[lip-sync-jobs] prune failed"));
  const id = randomUUID();
  const res = await d.execute(sql`
    INSERT INTO lip_sync_jobs (id, user_id, project_id, scene_id, params)
    VALUES (
      ${id},
      ${input.userId},
      ${input.projectId ?? null},
      ${input.sceneId ?? null},
      ${JSON.stringify(input.params ?? {})}::jsonb
    )
    RETURNING ${JOB_COLUMNS}
  `);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error("createLipSyncJob: INSERT returned no row");
  return toLipSyncJob(row);
}

export async function getLipSyncJob(id: string): Promise<LipSyncJob | undefined> {
  if (!id || typeof id !== "string") return undefined;
  const res = await db().execute(sql`SELECT ${JOB_COLUMNS} FROM lip_sync_jobs WHERE id = ${id} LIMIT 1`);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  return row ? toLipSyncJob(row) : undefined;
}

/**
 * Claim a queued job for submit: queued → submitting, attempts + 1.
 * Single atomic UPDATE — even if two processes race (overlapping deploys),
 * exactly one wins. Returns undefined when the job is gone or not queued.
 */
export async function claimJobForSubmit(id: string): Promise<LipSyncJob | undefined> {
  const res = await db().execute(sql`
    UPDATE lip_sync_jobs
    SET state = 'submitting', attempts = attempts + 1, updated_at = now()
    WHERE id = ${id} AND state = 'queued'
    RETURNING ${JOB_COLUMNS}
  `);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  return row ? toLipSyncJob(row) : undefined;
}

/** Claim up to `limit` queued jobs for submit workers (oldest first). */
export async function claimQueuedJobs(limit: number): Promise<LipSyncJob[]> {
  const res = await db().execute(sql`
    UPDATE lip_sync_jobs
    SET state = 'submitting', attempts = attempts + 1, updated_at = now()
    WHERE id IN (
      SELECT id FROM lip_sync_jobs
      WHERE state = 'queued'
      ORDER BY created_at ASC
      LIMIT ${limit}
    )
    RETURNING ${JOB_COLUMNS}
  `);
  return (res.rows as Record<string, unknown>[]).map(toLipSyncJob);
}

/** Submit accepted by the provider: submitting → polling with the provider job id. */
export async function markJobSubmitted(id: string, providerJobId: string, nextPollInMs: number): Promise<void> {
  const nextPollAt = new Date(Date.now() + nextPollInMs).toISOString();
  await db().execute(sql`
    UPDATE lip_sync_jobs
    SET state = 'polling',
        provider_job_id = ${providerJobId},
        consecutive_poll_errors = 0,
        next_poll_at = ${nextPollAt}::timestamptz,
        updated_at = now()
    WHERE id = ${id} AND state = 'submitting'
  `);
}

/**
 * Record a provider poll.
 * - ok: polls + 1, transport errors reset, next poll scheduled with backoff.
 * - transport failure: consecutive_poll_errors + 1 (job fails at the caller's limit).
 */
export async function recordJobPoll(
  id: string,
  poll: { ok: true; nextPollInMs: number } | { ok: false; error: string; nextPollInMs: number },
): Promise<void> {
  const nextPollAt = new Date(Date.now() + poll.nextPollInMs).toISOString();
  if (poll.ok) {
    await db().execute(sql`
      UPDATE lip_sync_jobs
      SET polls = polls + 1,
          consecutive_poll_errors = 0,
          next_poll_at = ${nextPollAt}::timestamptz,
          updated_at = now()
      WHERE id = ${id} AND state = 'polling'
    `);
  } else {
    await db().execute(sql`
      UPDATE lip_sync_jobs
      SET polls = polls + 1,
          consecutive_poll_errors = consecutive_poll_errors + 1,
          error = ${JSON.stringify({ message: poll.error, code: "provider_poll_error" })}::jsonb,
          next_poll_at = ${nextPollAt}::timestamptz,
          updated_at = now()
      WHERE id = ${id} AND state = 'polling'
    `);
  }
}

/** Jobs whose backoff window has elapsed, oldest first. */
export async function getJobsDueForPoll(limit: number): Promise<LipSyncJob[]> {
  const res = await db().execute(sql`
    SELECT ${JOB_COLUMNS} FROM lip_sync_jobs
    WHERE state = 'polling'
      AND provider_job_id IS NOT NULL
      AND (next_poll_at IS NULL OR next_poll_at <= now())
    ORDER BY next_poll_at ASC NULLS FIRST
    LIMIT ${limit}
  `);
  return (res.rows as Record<string, unknown>[]).map(toLipSyncJob);
}

/** Mark a job done with the provider's output URL. */
export async function completeLipSyncJob(id: string, resultUrl: string): Promise<void> {
  await db().execute(sql`
    UPDATE lip_sync_jobs
    SET state = 'done', result_url = ${resultUrl}, updated_at = now()
    WHERE id = ${id} AND state IN ('submitting', 'polling')
  `);
}

export async function failLipSyncJob(id: string, error: LipSyncJobError): Promise<void> {
  await db().execute(sql`
    UPDATE lip_sync_jobs
    SET state = 'failed',
        error = ${JSON.stringify(error ?? {})}::jsonb,
        updated_at = now()
    WHERE id = ${id}
  `);
}

/**
 * Re-queue a job whose submit worker died: submitting → queued (or failed
 * when it already burned its attempts). Returns the attempts count so the
 * caller can decide whether to notify.
 */
export async function requeueSubmitJob(id: string, maxAttempts: number): Promise<number> {
  const res = await db().execute(sql`
    UPDATE lip_sync_jobs
    SET state = CASE WHEN attempts >= ${maxAttempts} THEN 'failed' ELSE 'queued' END,
        error = CASE WHEN attempts >= ${maxAttempts}
          THEN ${JSON.stringify({ message: "Lip-sync submit was interrupted by a server restart and could not be recovered.", code: "interrupted" })}::jsonb
          ELSE error END,
        updated_at = now()
    WHERE id = ${id} AND state = 'submitting'
    RETURNING attempts
  `);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  return row ? Number(row["attempts"] ?? 0) : 0;
}

/**
 * Idempotency gate for the generation_history insert: only the worker that
 * flips history_recorded false→true proceeds. A recovered job can never
 * attach its video to the project twice.
 */
export async function markHistoryRecorded(id: string): Promise<boolean> {
  const res = await db().execute(sql`
    UPDATE lip_sync_jobs
    SET history_recorded = true, updated_at = now()
    WHERE id = ${id} AND history_recorded = false
    RETURNING id
  `);
  return res.rows.length > 0;
}

/**
 * Boot recovery: jobs left in `submitting` belong to a dead worker — the
 * trim/submit died with it, but the full request params are persisted, so
 * the job simply goes back to `queued`. Jobs in `polling` keep their
 * provider_job_id; the poller resumes checking them (next_poll_at is
 * clamped to now so they are picked up on the first tick).
 */
export async function recoverInterruptedLipSyncJobs(maxAttempts: number): Promise<void> {
  let rows: Record<string, unknown>[];
  try {
    const res = await db().execute(sql`
      SELECT ${JOB_COLUMNS} FROM lip_sync_jobs
      WHERE state IN ('queued', 'submitting', 'polling')
      ORDER BY created_at ASC
    `);
    rows = res.rows as Record<string, unknown>[];
  } catch (err) {
    // Table may not exist yet on the very first boot before drizzle-kit push
    // finishes — log and continue; the next boot will recover.
    logger.warn({ err }, "[lip-sync-jobs] recovery select failed; skipping");
    return;
  }
  for (const r of rows) {
    const job = toLipSyncJob(r);
    try {
      if (job.state === "submitting") {
        if (job.attempts >= maxAttempts) {
          await failLipSyncJob(job.id, {
            message: "This lip-sync job was interrupted by a server restart and could not be recovered.",
            code: "interrupted",
          });
          logger.warn({ jobId: job.id }, "[lip-sync-jobs] interrupted submit exceeded retry limit; marked failed");
        } else {
          await db().execute(sql`
            UPDATE lip_sync_jobs SET state = 'queued', updated_at = now()
            WHERE id = ${job.id}
          `);
          logger.info({ jobId: job.id, attempts: job.attempts }, "[lip-sync-jobs] re-queued interrupted submit");
        }
      } else if (job.state === "polling") {
        await db().execute(sql`
          UPDATE lip_sync_jobs
          SET next_poll_at = LEAST(next_poll_at, now()), updated_at = now()
          WHERE id = ${job.id}
        `);
        logger.info({ jobId: job.id }, "[lip-sync-jobs] resumed polling interrupted job");
      }
    } catch (err) {
      logger.error({ err, jobId: job.id }, "[lip-sync-jobs] recovery failed for job");
    }
  }
}

/** Kept for callers that need a job id without a DB round-trip. */
export function newLipSyncJobId(): string {
  return randomUUID();
}
