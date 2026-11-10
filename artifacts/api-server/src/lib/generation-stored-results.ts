import { and, eq } from "drizzle-orm";
import { db, generationStoredResultsTable } from "@workspace/db";
import { logger } from "./logger";
import { isMissingSchemaError } from "./pg-errors";

/**
 * Durable stored results for the generation rails (migration 0333,
 * stack400 s400-stored-results) — the storage layer shared by
 * bg-generate, thumbnail-generator and bio-generator.
 *
 * The semantics are the contract rail's (0329) and post-assist's
 * (0330), exactly:
 *  - one row per PAID intent, keyed by the charge's idempotency key
 *    (the same key the credit ledger dedups on, migration 0049);
 *  - a stored-result PRE-CHECK runs before any funding: a replay
 *    under a landed key is answered from the row — the stored body
 *    verbatim, plus the rail's replay marker — with no charge and
 *    no provider call;
 *  - the row is written ONLY after a success, so a key present here
 *    always belongs to a live, paid charge (a refunded failure voids
 *    its ledger key, and no row is ever written for it);
 *  - BOTH reads and writes are FAIL-OPEN against a lagging database:
 *    if generation_stored_results is not there yet (migration 0333
 *    not applied) or any storage call fails, the rail behaves
 *    exactly as it did before this layer — a stored result is an
 *    upgrade, never a gate on a paid ask, and a storage failure can
 *    never become an error response or a double charge.
 *  - Pattern B exception (audio-cleanup): a job rail must store its
 *    creation body BEFORE the job runs, so its row is not yet a
 *    success when written. When the job fails, the rail replaces
 *    that body with a durable FAILURE marker (delete + store, via
 *    deleteStoredGenerationResult below) so the failure stays
 *    readable for the row's whole life — in particular after the
 *    rail's in-memory job record is TTL-evicted, when the marker is
 *    the only thing that keeps a retry from mistaking the stale
 *    creation body for a finished result. Deletes are fail-open
 *    exactly like reads and writes.
 */

/**
 * The stored payload for a (rail, key) pair, or null when no row
 * exists for this rail, this key AND this user. The key is
 * user-scoped and rail-scoped by construction; both are re-checked
 * here (defense in depth, not an expected path).
 */
export async function findStoredGenerationResult(
  rail: string,
  idempotencyKey: string,
  userId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const [row] = await db
      .select({
        userId: generationStoredResultsTable.userId,
        rail: generationStoredResultsTable.rail,
        result: generationStoredResultsTable.result,
      })
      .from(generationStoredResultsTable)
      .where(eq(generationStoredResultsTable.idempotencyKey, idempotencyKey))
      .limit(1);
    if (!row || row.userId !== userId || row.rail !== rail || !row.result) return null;
    return row.result;
  } catch (err) {
    if (!isMissingSchemaError(err)) {
      logger.warn(
        { err, rail, idempotencyKey },
        "[generation-stored-results] stored-result lookup failed — generating fresh (fail-open)",
      );
    }
    return null;
  }
}

/**
 * Persist a successful generation's response payload under its
 * charge key. Conflict-do-nothing: the first landed row wins, so a
 * concurrent twin can never overwrite the result the first caller
 * was served. Never throws — a failed write only means a later
 * replay degrades to the pre-0333 behavior.
 */
export async function storeGenerationResult(
  rail: string,
  idempotencyKey: string,
  userId: string,
  result: Record<string, unknown>,
): Promise<void> {
  try {
    await db
      .insert(generationStoredResultsTable)
      .values({ userId, rail, idempotencyKey, result })
      .onConflictDoNothing({ target: generationStoredResultsTable.idempotencyKey });
  } catch (err) {
    /* Never fail a paid, successful generation over its bookkeeping:
       the member holds their result; the worst case is a later
       replay generating fresh. Log loudly. */
    logger.error(
      { err, rail, idempotencyKey },
      "[generation-stored-results] failed to store the generation result — a replay of this intent would generate fresh",
    );
  }
}

/**
 * Remove the stored row for a (rail, key, user) pair. Scoped by all
 * three, like the read: a rail can only ever clear its own rows.
 *
 * Used by the Pattern B job rail (audio-cleanup) in exactly two
 * places: when a job fails, to replace its creation body with a
 * durable failure marker (delete + storeGenerationResult), and when
 * a retry falls through past a failure record, to clear the stale
 * row before the fresh charge so the new job's body can be stored
 * under the key (the store is conflict-do-nothing — a leftover row
 * would shadow the new body forever). Never throws — fail-open,
 * like every operation in this layer: a failed delete only means
 * the pre-existing row keeps being read, never an error response.
 */
export async function deleteStoredGenerationResult(
  rail: string,
  idempotencyKey: string,
  userId: string,
): Promise<void> {
  try {
    await db
      .delete(generationStoredResultsTable)
      .where(
        and(
          eq(generationStoredResultsTable.idempotencyKey, idempotencyKey),
          eq(generationStoredResultsTable.userId, userId),
          eq(generationStoredResultsTable.rail, rail),
        ),
      );
  } catch (err) {
    if (!isMissingSchemaError(err)) {
      logger.warn(
        { err, rail, idempotencyKey },
        "[generation-stored-results] stored-result delete failed — the existing row keeps being read (fail-open)",
      );
    }
  }
}
