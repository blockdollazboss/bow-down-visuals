import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { pgSslConfig } from "@workspace/db";
import { logger } from "./logger";
import { canUseCredits, CreditsDisabledError, refundCredits, deductCreditsDetailed, type CreditPoolSplit } from "./credits";

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

type ExportJobState = "queued" | "active" | "done" | "failed" | "cancelled";

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
  /** Temporary-first split of the standing reserve/charge (migration
   *  0306): how much came out of the temporary pool, and that pool's
   *  expiry at deduction time. Null when no split is recorded. */
  creditsFromBonus: number | null;
  creditsBonusExpiresAt: string | null;
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
    _pool = new Pool({ connectionString, max: 5, ssl: pgSslConfig(connectionString) });
  }
  return _pool;
}

function db() {
  return drizzle(getPool());
}

const JOB_COLUMNS = sql`id, user_id, project_id, state, stage, progress, params, result, error, credits_charged, credits_from_bonus, credits_bonus_expires_at, attempts, created_at, updated_at`;

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
    creditsFromBonus:
      row["credits_from_bonus"] == null ? null : Number(row["credits_from_bonus"]),
    creditsBonusExpiresAt:
      row["credits_bonus_expires_at"] == null
        ? null
        : row["credits_bonus_expires_at"] instanceof Date
          ? (row["credits_bonus_expires_at"] as Date).toISOString()
          : String(row["credits_bonus_expires_at"]),
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
    sql`DELETE FROM export_jobs WHERE state IN ('done', 'failed', 'cancelled') AND created_at < now() - interval '2 hours'`,
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
 * The claim is a single atomic UPDATE, so even if two processes ever
 * raced (e.g. overlapping deploys), exactly one wins the render —
 * the loser gets no row and skips. Returns undefined when the job is
 * gone or already terminal.
 */
export async function claimJobForRun(id: string): Promise<ExportJob | undefined> {
  const res = await db().execute(sql`
    UPDATE export_jobs
    SET state = 'active', stage = 'starting', attempts = attempts + 1, updated_at = now()
    WHERE id = ${id} AND state = 'queued'
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
 * Record a deduction's pool split on the job row (migration 0306), so
 * the settle ledger write and any later release — possibly in a
 * different process after a restart — restore the same pools the
 * deduction drew from. Best-effort by design: the deduction already
 * landed, and a missing split only degrades a future refund to the
 * historical all-permanent restore, never to a wrong amount.
 */
async function recordJobChargeSplit(jobId: string, split: CreditPoolSplit): Promise<void> {
  await db()
    .execute(sql`
      UPDATE export_jobs
      SET credits_from_bonus = ${split.fromBonus},
          credits_bonus_expires_at = ${split.bonusExpiresAt},
          updated_at = now()
      WHERE id = ${jobId}
    `)
    .catch((err) =>
      logger.error({ err, jobId }, "[export-jobs] failed to record the charge pool split — a later release will restore to permanent credits"),
    );
}

/**
 * Exactly-once credit charge for a successful render.
 *
 * The credits_charged flag flip in the export_jobs row is the idempotency
 * gate: only the worker that flips it false→true proceeds to deduct, so a
 * boot-recovery re-run of the same job can never double-charge.
 *
 * The deduction itself is the house deduction (deductCreditsDetailed):
 * it targets Supabase `profiles` — the table the auth middleware reads,
 * the UI displays, and every other charge path writes — and it spends
 * the temporary pool FIRST (temporary-first spend order, stack1100 Z1;
 * the rail's former private deduction read only the permanent column,
 * which is the exact Gate #5 defect: a clean export debited permanent
 * 87,195 → 86,795 while 300 temporary Bucs sat untouched). The pool
 * split is recorded on the job row with the charge.
 *
 * Throws OutOfCreditsError when the spendable balance is insufficient
 * (the render itself already succeeded; the caller decides how to
 * report that).
 */
export async function chargeCreditsForJob(
  jobId: string,
  userId: string,
  cost: number,
): Promise<{ charged: boolean; creditsAfter: number }> {
  if (!Number.isFinite(cost) || cost <= 0) {
    throw new Error(`chargeCreditsForJob: invalid cost ${cost}`);
  }
  // Admin-only mode: block users who haven't been explicitly approved.
  if (!(await canUseCredits(userId))) {
    logger.warn({ jobId, userId, cost }, "[export] blocked non-whitelisted spend (admin-only mode)");
    throw new CreditsDisabledError();
  }
  const flag = await db().execute(sql`
    UPDATE export_jobs SET credits_charged = true, updated_at = now()
    WHERE id = ${jobId} AND credits_charged = false
    RETURNING id
  `);
  if (flag.rows.length === 0) {
    return { charged: false, creditsAfter: -1 };
  }
  const { balance, split } = await deductCreditsDetailed(userId, cost);
  await recordJobChargeSplit(jobId, split);
  return { charged: true, creditsAfter: balance };
}

/**
 * A-07 (Stack-100 #3): RESERVE the export price when a job STARTS.
 *
 * Before A-07 the rail charged only after a successful render, so a
 * mid-render balance drop made the completion charge throw
 * OutOfCreditsError and the finished render was discarded undelivered.
 * The worker now holds the clean-export price up front through this
 * function; the render can then only fail for render reasons, never for
 * money that moved during the render.
 *
 * The reservation rides the SAME credits_charged flag as
 * chargeCreditsForJob — the flag means "the rail's price is currently
 * taken for this job", whether held (reserved) or settled (charged).
 * The atomic false→true flip keeps exactly-once semantics across
 * boot-recovery re-runs: a re-run of a job whose reservation already
 * stands gets { reserved: false } and treats the hold as its own.
 *
 * Throws OutOfCreditsError when the balance cannot cover the hold (the
 * flag is rolled back first, so the row never claims a hold that does
 * not exist).
 */
export async function reserveCreditsForJob(
  jobId: string,
  userId: string,
  cost: number,
): Promise<{ reserved: boolean; creditsAfter: number }> {
  if (!Number.isFinite(cost) || cost <= 0) {
    throw new Error(`reserveCreditsForJob: invalid cost ${cost}`);
  }
  if (!(await canUseCredits(userId))) {
    logger.warn({ jobId, userId, cost }, "[export] blocked non-whitelisted reserve (admin-only mode)");
    throw new CreditsDisabledError();
  }
  const flag = await db().execute(sql`
    UPDATE export_jobs SET credits_charged = true, updated_at = now()
    WHERE id = ${jobId} AND credits_charged = false
    RETURNING id
  `);
  if (flag.rows.length === 0) {
    // A reservation (or a settled charge) already stands for this job.
    return { reserved: false, creditsAfter: -1 };
  }
  try {
    // The hold is the house deduction (temporary pool first — see
    // chargeCreditsForJob): the affordability check and the debit both
    // run against the spendable balance, never the permanent column
    // alone. The split is recorded on the job row with the hold.
    const { balance, split } = await deductCreditsDetailed(userId, cost);
    await recordJobChargeSplit(jobId, split);
    return { reserved: true, creditsAfter: balance };
  } catch (err) {
    // The hold never landed — roll the flag back so the row stays honest
    // and a later attempt can reserve again.
    await clearJobChargeFlag(jobId).catch(() => undefined);
    throw err;
  }
}

/**
 * Atomically claim the right to release this job's standing charge:
 * flips credits_charged true→false and reports whether THIS caller won
 * the flip. The cancel endpoint and the worker can both reach a release
 * for the same job (a cancel lands while the render is finishing); the
 * flip is the exactly-once gate — only the winner refunds.
 */
/**
 * The claim, with the standing charge's recorded pool split: the row
 * the winner gets back carries credits_from_bonus /
 * credits_bonus_expires_at (migration 0306), so the release restores
 * the same pools the reserve/charge drew from — even when the release
 * runs in a different process than the deduction. A null split means
 * no split was recorded (a legacy job, or a zero-bonus charge).
 */
async function claimChargeReleaseWithSplit(
  id: string,
): Promise<{ claimed: boolean; split: CreditPoolSplit | null }> {
  const res = await db().execute(sql`
    UPDATE export_jobs SET credits_charged = false, updated_at = now()
    WHERE id = ${id} AND credits_charged = true
    RETURNING id, credits_from_bonus, credits_bonus_expires_at
  `);
  const row = res.rows[0] as
    | { credits_from_bonus?: number | null; credits_bonus_expires_at?: unknown }
    | undefined;
  if (!row) return { claimed: false, split: null };
  if (row.credits_from_bonus == null) return { claimed: true, split: null };
  const rawExpiry = row.credits_bonus_expires_at;
  return {
    claimed: true,
    split: {
      fromBonus: Number(row.credits_from_bonus),
      fromRegular: 0,
      bonusExpiresAt:
        rawExpiry == null
          ? null
          : rawExpiry instanceof Date
            ? rawExpiry.toISOString()
            : String(rawExpiry),
    },
  };
}

export async function claimChargeRelease(id: string): Promise<boolean> {
  return (await claimChargeReleaseWithSplit(id)).claimed;
}

/**
 * A-07: RELEASE a standing reservation in full — the render failed, or the
 * finished output turned out branded (branded exports are free, A-01), so
 * no charge may stand. Refunds through the ledger-aware refundCredits and
 * clears the flag, mirroring the completion-save failure path (D5 G2).
 * Only call when this job's flag is set by a reservation/charge this run
 * is responsible for.
 *
 * Payfix lane 6: the release is claimed through claimChargeRelease first,
 * so concurrent releasers (cancel endpoint vs worker) refund EXACTLY
 * ONCE — a caller that loses the flip refunds nothing. If the refund
 * itself throws, the flag is re-armed so a later attempt can retry.
 */
export async function releaseJobReservation(
  jobId: string,
  userId: string,
  cost: number,
  action: string,
): Promise<void> {
  const { claimed, split } = await claimChargeReleaseWithSplit(jobId);
  if (!claimed) return;
  try {
    /* Temporary-first: the refund restores the pools the claim row
       recorded (refundCredits applies the expiry rule — an expired
       pool diverts its portion to permanent). No recorded split →
       refundCredits' own ledger pairing / permanent fallback. The
       split's fromRegular is completed by refundCredits from the
       refund amount, so only the recorded bonus portion is passed. */
    await refundCredits(
      userId,
      cost,
      { action },
      split ? { split: { ...split, fromRegular: Math.max(0, cost - split.fromBonus) } } : undefined,
    );
  } catch (err) {
    await db()
      .execute(sql`
        UPDATE export_jobs SET credits_charged = true, updated_at = now()
        WHERE id = ${jobId} AND credits_charged = false
      `)
      .catch(() => undefined);
    throw err;
  }
}

/**
 * Cancel a queued/active job (payfix lane 6): a single atomic UPDATE, so
 * a job that raced to a terminal state (done/failed) is never clobbered
 * — the caller gets undefined and reports the terminal state instead.
 * `state` is a text column, so "cancelled" needs no migration. The
 * worker cooperates: claimJobForRun only claims 'queued', completeJob
 * only completes queued/active, failJob only fails queued/active, and
 * the settle path re-reads the row before charging — a cancelled job is
 * never settled and its result is discarded.
 */
export async function cancelExportJob(id: string): Promise<ExportJob | undefined> {
  const res = await db().execute(sql`
    UPDATE export_jobs
    SET state = 'cancelled', stage = 'cancelled', updated_at = now()
    WHERE id = ${id} AND state IN ('queued', 'active')
    RETURNING ${JOB_COLUMNS}
  `);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  return row ? toExportJob(row) : undefined;
}

/**
 * Clear the credits_charged flag after a charge has been REFUNDED.
 *
 * The flag means "a standing, un-refunded charge exists for this job".
 * When the completion save fails after a successful charge, the worker
 * refunds the deduction; clearing the flag keeps the row honest and lets
 * a boot-recovery re-run of the same job charge again (exactly once)
 * instead of skipping the deduction and delivering free (D5 sweep G2).
 */
export async function clearJobChargeFlag(id: string): Promise<void> {
  await db().execute(sql`
    UPDATE export_jobs
    SET credits_charged = false, updated_at = now()
    WHERE id = ${id} AND credits_charged = true
  `);
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
  /* State-guarded (payfix lane 6): a job the user cancelled — or one
     that already completed — must never be overwritten to "failed" by a
     late worker error path. */
  await db().execute(sql`
    UPDATE export_jobs
    SET state = 'failed', stage = 'failed', progress = 0,
        error = ${JSON.stringify(error ?? {})}::jsonb, updated_at = now()
    WHERE id = ${id} AND state IN ('queued', 'active')
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

/** Queue depth snapshot for the deep-health probe (lib/deep-health):
 * how many renders wait and how many run, right now. Read-only — the
 * pump's behaviour is unchanged. */
export function getExportQueueDepth(): { waiting: number; active: number } {
  return { waiting: waitQueue.length, active: activeCount };
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
  } else if (job.state === "failed" || job.state === "cancelled") {
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
  } else if (stage === "fetching audio") {
    progress = 58;
  } else if (stage === "building render") {
    progress = 60;
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
    case "fetching audio":
      return "Fetching the song…";
    case "building render":
      return "Building the render…";
    case "combining":
      return "Stitching video with FFmpeg…";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    default:
      if (stage.startsWith("normalizing clip")) return `Preparing ${stage.replace("normalizing ", "")}…`;
      return stage;
  }
}

/** Kept for tests/callers that need a job id without a DB round-trip. */
/* Removed 2026-10-10: newJobId was dead (zero imports). */
