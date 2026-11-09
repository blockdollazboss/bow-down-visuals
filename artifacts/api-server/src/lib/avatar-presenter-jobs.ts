import { eq, lt } from "drizzle-orm";
import { db, avatarPresenterJobsTable } from "@workspace/db";
import { logger } from "./logger";
import { isMissingSchemaError } from "./pg-errors";

/**
 * Durable job storage for the avatar-presenter rail (migration
 * 0334, follow-on lane f-avatar-durable) — the storage layer
 * behind routes/generate/avatar-presenter.ts.
 *
 * The rail's job ids derive from the paid intent (CA-KEY), so
 * twin POSTs collapse to one job; before this layer the job
 * records themselves lived only in the rail's in-process Map,
 * and a restart between submit and completion orphaned the
 * reserve-at-submit charge — no job left to complete, none to
 * refund from. This layer mirrors every job into
 * avatar_presenter_jobs:
 *
 *  - a job is INSERTED the moment it is created (after its
 *    reserve lands) and UPDATED on every mutation (status
 *    transitions, provider job id, result refs, the exactly-once
 *    refund claim);
 *  - a lookup that misses the in-process Map reads the row back,
 *    so a job — including a still-running one — survives any
 *    restart; the rail rehydrates it into the Map and resumes
 *    its worker (the provider submit itself is idempotent under
 *    the same per-job key, so a resumed worker can never
 *    double-submit or double-charge);
 *  - TTL eviction is a DELETE on created_at over the SAME 2h
 *    clock the in-memory sweeper uses — rows expire by query,
 *    not by a process forgetting them;
 *  - EVERY function here is FAIL-OPEN: a missing table (0334 not
 *    applied yet) or any storage error degrades to the
 *    pre-0334 in-process behavior. A storage failure can never
 *    error the rail, block a paid ask, or double-charge.
 */

export type AvatarPresenterJobStatus = "queued" | "processing" | "done" | "failed";

export interface AvatarPresenterSubmitInput {
  voiceId?: string;
  aspectRatio?: "16:9" | "9:16" | "1:1";
  imageUrl?: string;
  audioUrl?: string;
  prompt?: string;
}

/** The persisted shape — the rail's AvatarJob record, field for field. */
export interface AvatarPresenterJobRecord {
  id: string;
  userId: string;
  status: AvatarPresenterJobStatus;
  avatarId: string;
  script: string;
  outputUrl: string | null;
  error: string | null;
  creditsCharged: number;
  providerJobId: string | null;
  createdAt: number;
  chargeKey?: string;
  creditsRefunded?: boolean;
  submitInput?: AvatarPresenterSubmitInput | null;
}

type JobRow = typeof avatarPresenterJobsTable.$inferSelect;

function rowToRecord(row: JobRow): AvatarPresenterJobRecord {
  return {
    id: row.id,
    userId: row.userId,
    status: row.status as AvatarPresenterJobStatus,
    avatarId: row.avatarId,
    script: row.script,
    outputUrl: row.outputUrl,
    error: row.error,
    creditsCharged: row.creditsCharged,
    providerJobId: row.providerJobId,
    createdAt: row.createdAt.getTime(),
    chargeKey: row.chargeKey ?? undefined,
    creditsRefunded: row.creditsRefunded,
    submitInput: row.submitInput ?? null,
  };
}

function recordValues(job: AvatarPresenterJobRecord) {
  return {
    userId: job.userId,
    status: job.status,
    avatarId: job.avatarId,
    script: job.script,
    providerJobId: job.providerJobId,
    outputUrl: job.outputUrl,
    error: job.error,
    creditsCharged: job.creditsCharged,
    chargeKey: job.chargeKey ?? null,
    creditsRefunded: job.creditsRefunded ?? false,
    submitInput: job.submitInput ?? null,
    createdAt: new Date(job.createdAt),
    updatedAt: new Date(),
  };
}

/**
 * Insert a freshly created job. Conflict-do-nothing: the row is
 * keyed by the intent-derived job id, so a concurrent twin's
 * insert can never clobber the first job's record. Never throws.
 */
export async function persistAvatarJob(job: AvatarPresenterJobRecord): Promise<void> {
  try {
    await db
      .insert(avatarPresenterJobsTable)
      .values({ id: job.id, ...recordValues(job) })
      .onConflictDoNothing({ target: avatarPresenterJobsTable.id });
  } catch (err) {
    if (!isMissingSchemaError(err)) {
      logger.error(
        { err, jobId: job.id },
        "[avatar-presenter-jobs] failed to persist the job — it lives in-process only (fail-open)",
      );
    }
  }
}

/**
 * Mirror a job mutation (status transition, provider job id,
 * result refs, refund claim) into its row. Upsert on the job id:
 * a mutation for a job whose insert was lost to a storage outage
 * re-creates the row rather than losing the update. Never throws.
 */
export async function syncAvatarJob(job: AvatarPresenterJobRecord): Promise<void> {
  try {
    const values = recordValues(job);
    await db
      .insert(avatarPresenterJobsTable)
      .values({ id: job.id, ...values })
      .onConflictDoUpdate({ target: avatarPresenterJobsTable.id, set: values });
  } catch (err) {
    if (!isMissingSchemaError(err)) {
      logger.warn(
        { err, jobId: job.id },
        "[avatar-presenter-jobs] failed to sync the job — continuing in-process (fail-open)",
      );
    }
  }
}

/**
 * Read one job back by id — the post-restart path. Returns null
 * when no row exists AND on any storage failure (fail-open: the
 * caller behaves exactly as the in-process rail did on a miss).
 */
export async function loadAvatarJob(id: string): Promise<AvatarPresenterJobRecord | null> {
  try {
    const [row] = await db
      .select()
      .from(avatarPresenterJobsTable)
      .where(eq(avatarPresenterJobsTable.id, id))
      .limit(1);
    return row ? rowToRecord(row) : null;
  } catch (err) {
    if (!isMissingSchemaError(err)) {
      logger.warn(
        { err, jobId: id },
        "[avatar-presenter-jobs] job lookup failed — treating as not found (fail-open)",
      );
    }
    return null;
  }
}

/**
 * TTL eviction as a query: delete rows older than the in-memory
 * sweeper's TTL (2h from creation, the job-map-sweeper default).
 * Returns how many rows were deleted. Never throws.
 */
export async function sweepExpiredAvatarJobs(ttlMs: number, now: number = Date.now()): Promise<number> {
  try {
    const deleted = await db
      .delete(avatarPresenterJobsTable)
      .where(lt(avatarPresenterJobsTable.createdAt, new Date(now - ttlMs)))
      .returning({ id: avatarPresenterJobsTable.id });
    return deleted.length;
  } catch (err) {
    if (!isMissingSchemaError(err)) {
      logger.warn(
        { err },
        "[avatar-presenter-jobs] TTL sweep failed — rows persist until the next sweep (fail-open)",
      );
    }
    return 0;
  }
}
