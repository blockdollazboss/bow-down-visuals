import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { logger } from "./logger";
import { OutOfCreditsError } from "./credits";

/**
 * Durable async export job store.
 *
 * A full video export (download clips → normalize → FFmpeg stitch with
 * captions/effects → upload → sign URL) takes several minutes — far longer
 * than a hosting proxy will keep a single HTTP request open. The route
 * returns HTTP 202 with a jobId immediately and the render runs in the
 * background; the client polls GET /api/export-video-job/:jobId.
 *
 * Jobs used to live in a module-level Map. Every backend restart, redeploy,
 * or crash wiped in-flight renders and polling 404'd mid-render (twice in
 * one day during real use). Job records now live in the `export_jobs`
 * table (created via drizzle-kit push on boot):
 * - stage/progress are persisted as the render advances (≤ ~2s stale),
 * - credits are charged exactly once via the credits_charged flag,
 * - jobs left in queued/active by a dead process are re-queued on boot
 *   (see recoverInterruptedJobs) — a render now survives deploys.
 *
 * Renders still run strictly one at a time (FIFO, in-memory queue) so a
 * small instance never has two FFmpeg processes fighting for memory.
 * Single-node only (WEB_CONCURRENCY=1): the queue itself is not durable,
 * but every queued job row is re-enqueued by recovery on boot.
 */

export type ExportJobState = "queued" | "active" | "done" | "failed";

export interface ExportJobError {
  message: string;
  code?: string;
  exportStatus?: unknown;
  stderrTail?: string[];
  ffmpegExitCode?: number | null;
}

/** Live render status, mutated by the running export (mirrors ExportStatusInfo). */
export interface ExportStatusRef {
  current: { ffmpegStage?: string } | null;
}

export interface ExportJob {
  id: string;
  userId: string;
  projectId: string;
  state: ExportJobState;
  /** Last observed render stage (e.g. "combining", "normalizing clip 2/7"). */
  stage: string;
  progress: number;
  /** Full export request body — everything needed to (re)run the render. */
  params: unknown;
  result?: Record<string, unknown> | null;
  error?: ExportJobError | null;
  creditsCharged: boolean;
  attempts: number;
  createdAt: number;
  updatedAt: number;
}

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    const connectionString = process.env["DATABASE_URL"];
    if (!connectionString) {
      throw new Error("DATABASE_URL is not configured — cannot access export_jobs.");
    }
    _pool = new Pool({ connectionString, max: 5 });
  }
  return _pool;
}

function db() {
  return drizzle(getPool());
}

const JOB_COLUMNS = sql`id, user_id, project_id, state, stage, progress, params, result, error, credits_charged, attempts, created_at, updated_at`;

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

function toExportJob(row: Record<string, unknown>): ExportJob {
  return {
    id: String(row["id"]),
    userId: String(row["user_id"]),
    projectId: String(row["project_id"]),
    state: row["state"] as ExportJobState,
    stage: String(row["stage"] ?? "queued"),
    progress: Number(row["progress"] ?? 0),
    params: row["params"],
    result: asRecord(row["result"]),
    error: asRecord(row["error"]) as ExportJobError | null,
    creditsCharged: row["credits_charged"] === true,
    attempts: Number(row["attempts"] ?? 0),
    createdAt: new Date(row["created_at"] as string).getTime(),
    updatedAt: new Date(row["updated_at"] as string).getTime(),
  };
}

/** Create the durable job row. Returns the job (state=queued). */
export async function createExportJob(
  userId: string,
  projectId: string,
  params: unknown,
): Promise<ExportJob> {
  const d = db();
  // Best-effort prune of old terminal jobs; never blocks creation.
  d.execute(
    sql`DELETE FROM export_jobs WHERE state IN ('done', 'failed') AND created_at < now() - interval '2 hours'`,
  ).catch((err) => logger.warn({ err }, "[export-jobs] prune failed"));
  const res = await d.execute(sql`
    INSERT INTO export_jobs (user_id, project_id, params)
    VALUES (${userId}, ${projectId}, ${JSON.stringify(params ?? {})}::jsonb)
    RETURNING ${JOB_COLUMNS}
  `);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error("createExportJob: INSERT returned no row");
  return toExportJob(row);
}

export async function getExportJob(id: string): Promise<ExportJob | undefined> {
  if (!id || typeof id !== "string") return undefined;
  const res = await db().execute(sql`SELECT ${JOB_COLUMNS} FROM export_jobs WHERE id = ${id} LIMIT 1`);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  return row ? toExportJob(row) : undefined;
}

/**
 * Claim a job for a worker run: queued → active, attempts + 1.
 * Returns undefined when the job is gone or already terminal.
 */
export async function claimJobForRun(id: string): Promise<ExportJob | undefined> {
  const res = await db().execute(sql`
    UPDATE export_jobs
    SET state = 'active', stage = 'starting', attempts = attempts + 1, updated_at = now()
    WHERE id = ${id} AND state IN ('queued', 'active')
    RETURNING ${JOB_COLUMNS}
  `);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  return row ? toExportJob(row) : undefined;
}

/** Persist a stage change (called at most when the stage actually changes). */
export async function updateJobStage(id: string, stage: string): Promise<void> {
  await db().execute(sql`
    UPDATE export_jobs SET stage = ${stage}, updated_at = now() WHERE id = ${id}
  `);
}

/**
 * Exactly-once credit charge for a successful render.
 *
 * The credits_charged flag flip and the balance deduction happen in a
 * single Postgres transaction: either both commit or neither does. A
 * crash between "render done" and "charged" can therefore never
 * double-charge on recovery — the retry simply finds credits_charged
 * already true and skips the deduction.
 *
 * Throws OutOfCreditsError when the balance is insufficient (the render
 * itself already succeeded; the caller decides how to report that).
 */
export async function chargeCreditsForJob(
  jobId: string,
  userId: string,
  cost: number,
): Promise<{ charged: boolean; creditsAfter: number }> {
  if (!Number.isFinite(cost) || cost <= 0) {
    throw new Error(`chargeCreditsForJob: invalid cost ${cost}`);
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const flag = await client.query(
      `UPDATE export_jobs SET credits_charged = true, updated_at = now()
       WHERE id = $1 AND credits_charged = false
       RETURNING id`,
      [jobId],
    );
    if ((flag.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return { charged: false, creditsAfter: -1 };
    }
    const deduction = await client.query(
      `UPDATE profiles SET credits = credits - $2
       WHERE id = $1 AND credits >= $2
       RETURNING credits`,
      [userId, cost],
    );
    if ((deduction.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      throw new OutOfCreditsError();
    }
    await client.query("COMMIT");
    return { charged: true, creditsAfter: (deduction.rows[0] as { credits: number }).credits };
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* already rolled back / connection dead — the original error matters */
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Mark a job done with its render result. */
export async function completeJob(id: string, result: Record<string, unknown>): Promise<void> {
  await db().execute(sql`
    UPDATE export_jobs
    SET state = 'done', stage = 'completed', progress = 100,
        result = ${JSON.stringify(result ?? {})}::jsonb, updated_at = now()
    WHERE id = ${id} AND state IN ('queued', 'active')
  `);
}

export async function failJob(id: string, error: ExportJobError): Promise<void> {
  await db().execute(sql`
    UPDATE export_jobs
    SET state = 'failed', stage = 'failed', progress = 0,
        error = ${JSON.stringify(error ?? {})}::jsonb, updated_at = now()
    WHERE id = ${id}
  `);
}

const MAX_ATTEMPTS = 3;

/**
 * Boot recovery: jobs left in queued/active belong to a dead process —
 * the render died with it (FFmpeg state can't be resumed mid-render), but
 * the full request params are persisted, so the job can simply re-run
 * from scratch. Jobs that already burned MAX_ATTEMPTS are marked failed
 * with an honest "interrupted" error instead of looping forever.
 */
export async function recoverInterruptedJobs(
  onRecover: (job: ExportJob) => Promise<void>,
): Promise<void> {
  let rows: Record<string, unknown>[];
  try {
    const res = await db().execute(sql`
      SELECT ${JOB_COLUMNS} FROM export_jobs
      WHERE state IN ('queued', 'active')
      ORDER BY created_at ASC
    `);
    rows = res.rows as Record<string, unknown>[];
  } catch (err) {
    // Table may not exist yet on the very first boot before drizzle-kit push
    // finishes — log and continue; the next boot will recover.
    logger.warn({ err }, "[export-jobs] recovery select failed; skipping");
    return;
  }
  for (const r of rows) {
    const job = toExportJob(r);
    try {
      if (job.attempts >= MAX_ATTEMPTS) {
        await failJob(job.id, {
          message: "This export was interrupted by a server restart and could not be recovered. Please try again — you were not charged.",
          code: "interrupted",
        });
        logger.warn({ jobId: job.id }, "[export-jobs] interrupted job exceeded retry limit; marked failed");
        continue;
      }
      await db().execute(sql`
        UPDATE export_jobs SET state = 'queued', stage = 'queued', updated_at = now()
        WHERE id = ${job.id}
      `);
      await onRecover({ ...job, state: "queued", stage: "queued" });
      logger.info({ jobId: job.id, attempts: job.attempts }, "[export-jobs] re-queued interrupted job");
    } catch (err) {
      logger.error({ err, jobId: job.id }, "[export-jobs] recovery failed for job");
    }
  }
}

/* ── In-memory FIFO render queue (single node) ── */

const waitQueue: Array<() => Promise<void>> = [];
let activeCount = 0;

const MAX_CONCURRENT_EXPORTS = 1;

/** Enqueue a render. Runs FIFO, at most MAX_CONCURRENT_EXPORTS at once. */
export function enqueueExport(run: () => Promise<void>): void {
  waitQueue.push(run);
  pumpQueue();
}

function pumpQueue(): void {
  while (activeCount < MAX_CONCURRENT_EXPORTS && waitQueue.length > 0) {
    const run = waitQueue.shift()!;
    activeCount++;
    run()
      .catch(() => {
        /* run() is expected to handle its own errors; this is a last-resort guard. */
      })
      .finally(() => {
        activeCount--;
        pumpQueue();
      });
  }
}

/** Map the persisted stage to a user-facing label + progress estimate. */
export function describeJobProgress(job: Pick<ExportJob, "state" | "stage" | "updatedAt">): {
  stage: string;
  progress: number;
} {
  const stage = job.stage;
  let progress: number;
  if (job.state === "done") {
    progress = 100;
  } else if (job.state === "failed") {
    progress = 0;
  } else if (stage === "completed") {
    progress = 100;
  } else if (stage === "combining") {
    progress = 62;
  } else if (stage.startsWith("normalizing clip")) {
    const m = /normalizing clip (\d+)\/(\d+)/.exec(stage);
    progress = m
      ? 15 + 40 * (Math.min(parseInt(m[1]!, 10), parseInt(m[2]!, 10)) / Math.max(parseInt(m[2]!, 10), 1))
      : 25;
  } else if (stage === "downloading clips") {
    progress = 8;
  } else {
    progress = 3;
  }
  // While the bar sits at "combining", the render is actually in upload/sign/save —
  // creep forward slowly so the UI doesn't look stuck on a multi-minute render.
  if ((job.state === "active" || job.state === "queued") && progress >= 62 && progress < 96) {
    const idleMin = (Date.now() - job.updatedAt) / 60000;
    progress = Math.min(96, progress + idleMin * 5);
  }
  return { stage: humanizeStage(stage), progress: Math.round(progress) };
}

function humanizeStage(stage: string): string {
  switch (stage) {
    case "queued":
      return "Queued — waiting for the renderer…";
    case "starting":
      return "Starting render…";
    case "downloading clips":
      return "Downloading clips…";
    case "combining":
      return "Stitching video with FFmpeg…";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    default:
      if (stage.startsWith("normalizing clip")) return `Preparing ${stage.replace("normalizing ", "")}…`;
      return stage;
  }
}

/** Kept for tests/callers that need a job id without a DB round-trip. */
export function newJobId(): string {
  return randomUUID();
}
