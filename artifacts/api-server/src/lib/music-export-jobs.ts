import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { pgSslConfig } from "@workspace/db";
import { logger } from "./logger";

/**
 * Durable music (mix) export job store (stack300 export-reliability,
 * item 62).
 *
 * Mix renders take minutes — POST /music/export returns 202 with a
 * jobId and the client polls GET /music/export/job/:id. The job record
 * used to live in a module-level Map: every restart, redeploy, or
 * crash wiped in-flight renders and polling 404'd mid-render. Job
 * records now live in the `music_export_jobs` table (migration 0326),
 * mirroring the export_jobs rail:
 * - the full render params are persisted, so boot recovery re-runs a
 *   queued/processing job from scratch (see
 *   recoverInterruptedMusicExportJobs) — a render survives deploys;
 * - the row carries user_id, and the poll endpoint 404s for any other
 *   user (item 63 — the sibling export poll handlers' pattern);
 * - `attempt_key` is the duplicate-submit guard (item 64): derived
 *   from (user + params hash) at creation, a duplicate POST inside
 *   the dedup window returns the existing queued/processing job.
 *
 * Mix export carries no credit charge (the rail is free), so there is
 * no charge bookkeeping on this table — durability, ownership, and
 * dedup are the whole job.
 */

export type MusicExportJobState = "queued" | "processing" | "done" | "failed";

export interface MusicExportJob {
  id: string;
  userId: string;
  state: MusicExportJobState;
  /** Full render inputs — everything needed to (re)run the render. */
  params: unknown;
  result?: Record<string, unknown> | null;
  error?: string | null;
  code?: string | null;
  attemptKey?: string | null;
  attempts: number;
  createdAt: number;
  updatedAt: number;
}

let _pool: Pool | null = null;

type DrizzleDb = ReturnType<typeof drizzle>;
let _dbOverride: DrizzleDb | null = null;
/** Test seam — never used outside tests. */
export function __setMusicExportJobsDb(db: DrizzleDb | null): void {
  _dbOverride = db;
}

function getPool(): Pool {
  if (!_pool) {
    const connectionString = process.env["DATABASE_URL"];
    if (!connectionString) {
      throw new Error("DATABASE_URL is not configured — cannot access music_export_jobs.");
    }
    _pool = new Pool({ connectionString, max: 5, ssl: pgSslConfig(connectionString) });
  }
  return _pool;
}

function db(): DrizzleDb {
  return _dbOverride ?? drizzle(getPool());
}

const JOB_COLUMNS = sql`id, user_id, state, params, result, error, code, attempt_key, attempts, created_at, updated_at`;

/** Duplicate-submit window: an identical start POST is a duplicate
 *  while the original job is still queued/processing (and never older
 *  than the 2 h terminal-prune horizon). */
export const MUSIC_EXPORT_DEDUP_WINDOW_MS = 2 * 60 * 60 * 1000;

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

function toMusicExportJob(row: Record<string, unknown>): MusicExportJob {
  return {
    id: String(row["id"]),
    userId: String(row["user_id"]),
    state: row["state"] as MusicExportJobState,
    params: row["params"],
    result: asRecord(row["result"]),
    error: row["error"] != null ? String(row["error"]) : null,
    code: row["code"] != null ? String(row["code"]) : null,
    attemptKey: row["attempt_key"] != null ? String(row["attempt_key"]) : null,
    attempts: Number(row["attempts"] ?? 0),
    createdAt: new Date(row["created_at"] as string).getTime(),
    updatedAt: new Date(row["updated_at"] as string).getTime(),
  };
}

/** Create the durable job row (state=queued). Returns the job. */
export async function createMusicExportJob(
  id: string,
  userId: string,
  params: unknown,
  attemptKey: string | null,
): Promise<MusicExportJob> {
  const d = db();
  // Best-effort prune of old terminal jobs; never blocks creation.
  d.execute(
    sql`DELETE FROM music_export_jobs WHERE state IN ('done', 'failed') AND created_at < now() - interval '2 hours'`,
  ).catch((err) => logger.warn({ err }, "[music-export-jobs] prune failed"));
  const res = await d.execute(sql`
    INSERT INTO music_export_jobs (id, user_id, state, params, attempt_key)
    VALUES (${id}, ${userId}, 'queued', ${JSON.stringify(params ?? {})}::jsonb, ${attemptKey})
    RETURNING ${JOB_COLUMNS}
  `);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error("createMusicExportJob: INSERT returned no row");
  return toMusicExportJob(row);
}

export async function getMusicExportJob(id: string): Promise<MusicExportJob | undefined> {
  if (!id || typeof id !== "string") return undefined;
  const res = await db().execute(sql`SELECT ${JOB_COLUMNS} FROM music_export_jobs WHERE id = ${id} LIMIT 1`);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  return row ? toMusicExportJob(row) : undefined;
}

/**
 * Item 64: the duplicate-submit lookup — an identical start POST while
 * the original job is still in flight returns that job. Scoped to the
 * owner: an attempt key never leaks another user's job.
 */
export async function findActiveMusicExportJobByAttemptKey(
  userId: string,
  attemptKey: string,
): Promise<MusicExportJob | undefined> {
  if (!attemptKey) return undefined;
  const since = new Date(Date.now() - MUSIC_EXPORT_DEDUP_WINDOW_MS).toISOString();
  const res = await db().execute(sql`
    SELECT ${JOB_COLUMNS} FROM music_export_jobs
    WHERE user_id = ${userId} AND attempt_key = ${attemptKey}
      AND state IN ('queued', 'processing') AND created_at > ${since}
    ORDER BY created_at DESC
    LIMIT 1
  `);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  return row ? toMusicExportJob(row) : undefined;
}

/**
 * Claim a job for a worker run: queued → processing, attempts + 1.
 * The claim is a single atomic UPDATE — exactly one worker wins the
 * render, even if the route and boot recovery race the same row.
 */
export async function claimMusicExportJob(id: string): Promise<MusicExportJob | undefined> {
  const res = await db().execute(sql`
    UPDATE music_export_jobs
    SET state = 'processing', attempts = attempts + 1, updated_at = now()
    WHERE id = ${id} AND state = 'queued'
    RETURNING ${JOB_COLUMNS}
  `);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  return row ? toMusicExportJob(row) : undefined;
}

/** Mark a job done with its render result (state-guarded). */
export async function completeMusicExportJob(
  id: string,
  result: Record<string, unknown>,
): Promise<void> {
  await db().execute(sql`
    UPDATE music_export_jobs
    SET state = 'done', result = ${JSON.stringify(result ?? {})}::jsonb,
        error = NULL, code = NULL, updated_at = now()
    WHERE id = ${id} AND state IN ('queued', 'processing')
  `);
}

/** Mark a job failed with an honest error (state-guarded). */
export async function failMusicExportJob(
  id: string,
  error: string,
  code?: string,
): Promise<void> {
  await db().execute(sql`
    UPDATE music_export_jobs
    SET state = 'failed', error = ${error}, code = ${code ?? null}, updated_at = now()
    WHERE id = ${id} AND state IN ('queued', 'processing')
  `);
}

const MAX_ATTEMPTS = 3;

/**
 * Boot recovery: jobs left in queued/processing belong to a dead
 * process — the render died with it (FFmpeg state can't be resumed
 * mid-render), but the full request params are persisted, so the job
 * can simply re-run from scratch. Jobs that already burned
 * MAX_ATTEMPTS are marked failed with an honest "interrupted" error
 * instead of looping forever. Mix export is free, so the honest copy
 * can say plainly that nothing was charged.
 */
export async function recoverInterruptedMusicExportJobs(
  onRecover: (job: MusicExportJob) => Promise<void>,
): Promise<void> {
  let rows: Record<string, unknown>[];
  try {
    const res = await db().execute(sql`
      SELECT ${JOB_COLUMNS} FROM music_export_jobs
      WHERE state IN ('queued', 'processing')
      ORDER BY created_at ASC
    `);
    rows = res.rows as Record<string, unknown>[];
  } catch (err) {
    // Table may not exist yet on the very first boot before migrations
    // finish — log and continue; the next boot will recover.
    logger.warn({ err }, "[music-export-jobs] recovery select failed; skipping");
    return;
  }
  for (const r of rows) {
    const job = toMusicExportJob(r);
    try {
      if (job.attempts >= MAX_ATTEMPTS) {
        await failMusicExportJob(job.id, "This export was interrupted by a server restart and could not be recovered. Please try again — you were not charged.", "interrupted");
        logger.warn({ jobId: job.id }, "[music-export-jobs] interrupted job exceeded retry limit; marked failed");
        continue;
      }
      await db().execute(sql`
        UPDATE music_export_jobs SET state = 'queued', updated_at = now()
        WHERE id = ${job.id}
      `);
      await onRecover({ ...job, state: "queued" });
      logger.info({ jobId: job.id, attempts: job.attempts }, "[music-export-jobs] re-queued interrupted job");
    } catch (err) {
      logger.error({ err, jobId: job.id }, "[music-export-jobs] recovery failed for job");
    }
  }
}
