import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { pgSslConfig } from "@workspace/db";
import { logger } from "./logger";

/**
 * Durable Vault job store (Stack-200 UPGRADE #162 — The Vault).
 *
 * Mirrors export-jobs.ts deliberately: the Vault archive (gather a
 * creator's original media → package one ZIP → upload) takes minutes,
 * so the route returns 202 with a jobId and the client polls
 * GET /api/account/vault/:jobId. Job records live in the `vault_jobs`
 * table (provisional migration 0293_vault_jobs.sql):
 * - stage/progress are persisted as the packager advances,
 * - jobs left queued/active by a dead process are re-queued on boot
 *   (see recoverInterruptedVaultJobs) — a Vault now survives deploys,
 * - packaging runs strictly one at a time (FIFO, in-memory queue) so a
 *   small instance never holds two full archives in flight.
 */

export type VaultJobState = "queued" | "active" | "done" | "failed";

export interface VaultJobResult {
  r2Key: string;
  fileName: string;
  sizeBytes: number;
  fileCount: number;
  skippedCount: number;
}

export interface VaultJob {
  id: string;
  userId: string;
  state: VaultJobState;
  stage: string;
  progress: number;
  result?: VaultJobResult | null;
  error?: { message: string; code?: string } | null;
  attempts: number;
  createdAt: number;
  updatedAt: number;
}

let _pool: Pool | null = null;

function getPool(): Pool {
  if (!_pool) {
    const connectionString = process.env["DATABASE_URL"];
    if (!connectionString) {
      throw new Error("DATABASE_URL is not configured — cannot access vault_jobs.");
    }
    _pool = new Pool({ connectionString, max: 5, ssl: pgSslConfig(connectionString) });
  }
  return _pool;
}

function db() {
  return drizzle(getPool());
}

const JOB_COLUMNS = sql`id, user_id, state, stage, progress, result, error, attempts, created_at, updated_at`;

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

function toVaultJob(row: Record<string, unknown>): VaultJob {
  const result = asRecord(row["result"]);
  return {
    id: String(row["id"]),
    userId: String(row["user_id"]),
    state: row["state"] as VaultJobState,
    stage: String(row["stage"] ?? "queued"),
    progress: Number(row["progress"] ?? 0),
    result: result ? (result as unknown as VaultJobResult) : null,
    error: asRecord(row["error"]) as VaultJob["error"],
    attempts: Number(row["attempts"] ?? 0),
    createdAt: new Date(row["created_at"] as string).getTime(),
    updatedAt: new Date(row["updated_at"] as string).getTime(),
  };
}

/** Create the durable job row. Returns the job (state=queued). */
export async function createVaultJob(userId: string): Promise<VaultJob> {
  const d = db();
  // Best-effort prune of old terminal jobs; never blocks creation.
  d.execute(
    sql`DELETE FROM vault_jobs WHERE state IN ('done', 'failed') AND created_at < now() - interval '7 days'`,
  ).catch((err) => logger.warn({ err }, "[vault-jobs] prune failed"));
  const res = await d.execute(sql`
    INSERT INTO vault_jobs (user_id)
    VALUES (${userId})
    RETURNING ${JOB_COLUMNS}
  `);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error("createVaultJob: INSERT returned no row");
  return toVaultJob(row);
}

export async function getVaultJob(id: string): Promise<VaultJob | undefined> {
  if (!id || typeof id !== "string") return undefined;
  const res = await db().execute(sql`SELECT ${JOB_COLUMNS} FROM vault_jobs WHERE id = ${id} LIMIT 1`);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  return row ? toVaultJob(row) : undefined;
}

/** The user's most recent job in a non-terminal state, if one exists —
 *  the route uses it to answer "a Vault is already packaging" honestly
 *  instead of stacking duplicate archives. */
export async function getActiveVaultJobForUser(userId: string): Promise<VaultJob | undefined> {
  const res = await db().execute(sql`
    SELECT ${JOB_COLUMNS} FROM vault_jobs
    WHERE user_id = ${userId} AND state IN ('queued', 'active')
    ORDER BY created_at DESC LIMIT 1
  `);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  return row ? toVaultJob(row) : undefined;
}

/**
 * Claim a job for a worker run: queued → active, attempts + 1.
 * Single atomic UPDATE — exactly one worker wins, mirroring export jobs.
 */
export async function claimVaultJobForRun(id: string): Promise<VaultJob | undefined> {
  const res = await db().execute(sql`
    UPDATE vault_jobs
    SET state = 'active', stage = 'collecting', attempts = attempts + 1, updated_at = now()
    WHERE id = ${id} AND state = 'queued'
    RETURNING ${JOB_COLUMNS}
  `);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  return row ? toVaultJob(row) : undefined;
}

/** Persist a stage + progress change. */
export async function updateVaultJobStage(id: string, stage: string, progress: number): Promise<void> {
  await db().execute(sql`
    UPDATE vault_jobs SET stage = ${stage}, progress = ${progress}, updated_at = now() WHERE id = ${id}
  `);
}

export async function completeVaultJob(id: string, result: VaultJobResult): Promise<void> {
  await db().execute(sql`
    UPDATE vault_jobs
    SET state = 'done', stage = 'completed', progress = 100,
        result = ${JSON.stringify(result ?? {})}::jsonb, updated_at = now()
    WHERE id = ${id} AND state IN ('queued', 'active')
  `);
}

export async function failVaultJob(id: string, error: { message: string; code?: string }): Promise<void> {
  await db().execute(sql`
    UPDATE vault_jobs
    SET state = 'failed', stage = 'failed', progress = 0,
        error = ${JSON.stringify(error ?? {})}::jsonb, updated_at = now()
    WHERE id = ${id}
  `);
}

const MAX_ATTEMPTS = 3;

/**
 * Boot recovery: jobs left queued/active belong to a dead process. The
 * packaging itself cannot resume mid-archive, but a re-run needs only
 * the userId, so the job simply starts over. Jobs that already burned
 * MAX_ATTEMPTS are marked failed with an honest "interrupted" error.
 */
export async function recoverInterruptedVaultJobs(
  onRecover: (job: VaultJob) => Promise<void>,
): Promise<void> {
  let rows: Record<string, unknown>[];
  try {
    const res = await db().execute(sql`
      SELECT ${JOB_COLUMNS} FROM vault_jobs
      WHERE state IN ('queued', 'active')
      ORDER BY created_at ASC
    `);
    rows = res.rows as Record<string, unknown>[];
  } catch (err) {
    logger.warn({ err }, "[vault-jobs] recovery select failed; skipping");
    return;
  }
  for (const r of rows) {
    const job = toVaultJob(r);
    try {
      if (job.attempts >= MAX_ATTEMPTS) {
        await failVaultJob(job.id, {
          message: "This Vault export was interrupted by a server restart and could not be recovered. Please start a new one.",
          code: "interrupted",
        });
        logger.warn({ jobId: job.id }, "[vault-jobs] interrupted job exceeded retry limit; marked failed");
        continue;
      }
      await db().execute(sql`
        UPDATE vault_jobs SET state = 'queued', stage = 'queued', updated_at = now()
        WHERE id = ${job.id}
      `);
      await onRecover({ ...job, state: "queued", stage: "queued" });
      logger.info({ jobId: job.id, attempts: job.attempts }, "[vault-jobs] re-queued interrupted job");
    } catch (err) {
      logger.error({ err, jobId: job.id }, "[vault-jobs] recovery failed for job");
    }
  }
}

/* ── In-memory FIFO packaging queue (single node) ── */

const waitQueue: Array<() => Promise<void>> = [];
let activeCount = 0;

const MAX_CONCURRENT_VAULTS = 1;

/** Enqueue a packaging run. FIFO, one at a time — archives are heavy. */
export function enqueueVault(run: () => Promise<void>): void {
  waitQueue.push(run);
  pumpQueue();
}

function pumpQueue(): void {
  while (activeCount < MAX_CONCURRENT_VAULTS && waitQueue.length > 0) {
    const run = waitQueue.shift()!;
    activeCount++;
    run()
      .catch(() => {
        /* run() handles its own errors; last-resort guard. */
      })
      .finally(() => {
        activeCount--;
        pumpQueue();
      });
  }
}

/** User-facing stage label + progress for the polling response. */
export function describeVaultProgress(job: Pick<VaultJob, "state" | "stage" | "progress">): {
  stage: string;
  progress: number;
} {
  if (job.state === "done") return { stage: "Your Vault is ready", progress: 100 };
  if (job.state === "failed") return { stage: "Vault packaging failed", progress: 0 };
  const stage = job.stage;
  if (stage === "queued") return { stage: "Queued — waiting to package…", progress: 2 };
  if (stage === "collecting") return { stage: "Collecting everything you own…", progress: 8 };
  if (stage === "uploading") return { stage: "Saving your archive…", progress: 94 };
  const m = /^packaging media (\d+)\/(\d+)$/.exec(stage);
  if (m) {
    const done = Math.min(parseInt(m[1]!, 10), parseInt(m[2]!, 10));
    const total = Math.max(parseInt(m[2]!, 10), 1);
    return {
      stage: `Packaging your originals (${done} of ${total})…`,
      progress: Math.round(10 + 80 * (done / total)),
    };
  }
  return { stage, progress: job.progress };
}
