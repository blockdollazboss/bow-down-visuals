import { and, eq, lt } from "drizzle-orm";
import { db, generationJobsTable } from "@workspace/db";
import { logger } from "./logger";
import { isMissingSchemaError } from "./pg-errors";

/**
 * Generalized durable job storage for the generation rails
 * (migration 0335, lane stack1600/durable-jobs) — the shared
 * storage layer behind lib/durable-job-store.ts, generalizing
 * the avatar-presenter layer (migration 0334,
 * lib/avatar-presenter-jobs.ts) to every remaining job-Map rail
 * that charges credits.
 *
 * Before this layer, those rails' job records lived only in
 * in-process Maps (2h TTL): a restart between submit and
 * completion orphaned the charge — no job left to complete, none
 * to refund from, and polls answered 404 for a paid job. This
 * layer mirrors every job into generation_jobs, one row per
 * (rail, job id):
 *
 *  - a job is INSERTED the moment it is created (after its charge
 *    lands) and UPDATED on every mutation (status transitions,
 *    result refs, the exactly-once refund claim);
 *  - a lookup that misses the rail's Map reads the row back, so a
 *    job — including a still-running one — survives any restart;
 *    the rail rehydrates it into the Map and resumes its worker
 *    (or settles it: fail + refund exactly once, when its inputs
 *    did not survive);
 *  - TTL eviction is a DELETE on created_at over the SAME 2h
 *    clock the in-memory sweeper uses — rows expire by query,
 *    not by a process forgetting them;
 *  - EVERY function here is FAIL-OPEN: a missing table (0335 not
 *    applied yet) or any storage error degrades to the pre-0335
 *    in-process behavior. A storage failure can never error a
 *    rail, block a paid ask, or double-charge.
 */

/** The persisted shape — the extracted columns + the rail's full
 *  job record as payload. */
export interface GenerationJobRecord {
  rail: string;
  id: string;
  userId: string;
  status: string;
  creditsCharged: number;
  chargeKey: string | null;
  creditsRefunded: boolean;
  createdAt: number;
  payload: Record<string, unknown>;
}

type JobRow = typeof generationJobsTable.$inferSelect;

function rowToRecord(row: JobRow): GenerationJobRecord {
  return {
    rail: row.rail,
    id: row.id,
    userId: row.userId,
    status: row.status,
    creditsCharged: row.creditsCharged,
    chargeKey: row.chargeKey ?? null,
    creditsRefunded: row.creditsRefunded,
    createdAt: row.createdAt.getTime(),
    payload: row.payload ?? {},
  };
}

function recordValues(job: GenerationJobRecord) {
  return {
    rail: job.rail,
    userId: job.userId,
    status: job.status,
    creditsCharged: job.creditsCharged,
    chargeKey: job.chargeKey,
    creditsRefunded: job.creditsRefunded,
    payload: job.payload,
    createdAt: new Date(job.createdAt),
    updatedAt: new Date(),
  };
}

function jobKey(rail: string, id: string) {
  return and(eq(generationJobsTable.rail, rail), eq(generationJobsTable.id, id));
}

/**
 * Insert a freshly created job. Conflict-do-nothing: the row is
 * keyed by (rail, job id), so a concurrent twin's insert can
 * never clobber the first job's record. Never throws.
 */
export async function persistGenerationJob(job: GenerationJobRecord): Promise<void> {
  try {
    await db
      .insert(generationJobsTable)
      .values({ id: job.id, ...recordValues(job) })
      .onConflictDoNothing({ target: [generationJobsTable.rail, generationJobsTable.id] });
  } catch (err) {
    if (!isMissingSchemaError(err)) {
      logger.error(
        { err, rail: job.rail, jobId: job.id },
        "[generation-jobs] failed to persist the job — it lives in-process only (fail-open)",
      );
    }
  }
}

/**
 * Mirror a job mutation (status transition, result refs, refund
 * claim) into its row. Upsert on (rail, id): a mutation for a job
 * whose insert was lost to a storage outage re-creates the row
 * rather than losing the update. Never throws.
 */
export async function syncGenerationJob(job: GenerationJobRecord): Promise<void> {
  try {
    const values = recordValues(job);
    await db
      .insert(generationJobsTable)
      .values({ id: job.id, ...values })
      .onConflictDoUpdate({
        target: [generationJobsTable.rail, generationJobsTable.id],
        set: values,
      });
  } catch (err) {
    if (!isMissingSchemaError(err)) {
      logger.warn(
        { err, rail: job.rail, jobId: job.id },
        "[generation-jobs] failed to sync the job — continuing in-process (fail-open)",
      );
    }
  }
}

/**
 * Read one job back by (rail, id) — the post-restart path.
 * Returns null when no row exists AND on any storage failure
 * (fail-open: the caller behaves exactly as the in-process rail
 * did on a miss).
 */
export async function loadGenerationJob(
  rail: string,
  id: string,
): Promise<GenerationJobRecord | null> {
  try {
    const [row] = await db
      .select()
      .from(generationJobsTable)
      .where(jobKey(rail, id))
      .limit(1);
    return row ? rowToRecord(row) : null;
  } catch (err) {
    if (!isMissingSchemaError(err)) {
      logger.warn(
        { err, rail, jobId: id },
        "[generation-jobs] job lookup failed — treating as not found (fail-open)",
      );
    }
    return null;
  }
}

/**
 * Read one job back by (rail, charge key) — for rails whose job
 * ids are NOT derived from the charge key (e.g. singing-voice's
 * randomUUID ids): a twin POST after a restart finds the in-flight
 * job by the key it was charged under, exactly like the in-process
 * scan over the Map's values did before the restart. Returns null
 * when no row exists AND on any storage failure (fail-open).
 */
export async function loadGenerationJobByChargeKey(
  rail: string,
  chargeKey: string,
): Promise<GenerationJobRecord | null> {
  try {
    const [row] = await db
      .select()
      .from(generationJobsTable)
      .where(
        and(eq(generationJobsTable.rail, rail), eq(generationJobsTable.chargeKey, chargeKey)),
      )
      .limit(1);
    return row ? rowToRecord(row) : null;
  } catch (err) {
    if (!isMissingSchemaError(err)) {
      logger.warn(
        { err, rail, chargeKey },
        "[generation-jobs] job-by-key lookup failed — treating as not found (fail-open)",
      );
    }
    return null;
  }
}

/**
 * TTL eviction as a query: delete a rail's rows older than the
 * in-memory sweeper's TTL (2h from creation, the job-map-sweeper
 * default). Returns how many rows were deleted. Never throws.
 */
export async function sweepExpiredGenerationJobs(
  rail: string,
  ttlMs: number,
  now: number = Date.now(),
): Promise<number> {
  try {
    const deleted = await db
      .delete(generationJobsTable)
      .where(
        and(
          eq(generationJobsTable.rail, rail),
          lt(generationJobsTable.createdAt, new Date(now - ttlMs)),
        ),
      )
      .returning({ id: generationJobsTable.id });
    return deleted.length;
  } catch (err) {
    if (!isMissingSchemaError(err)) {
      logger.warn(
        { err, rail },
        "[generation-jobs] TTL sweep failed — rows persist until the next sweep (fail-open)",
      );
    }
    return 0;
  }
}
