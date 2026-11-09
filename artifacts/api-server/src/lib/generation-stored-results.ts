import { eq } from "drizzle-orm";
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
