import { logger } from "./logger";
import { getSupabaseAdmin, addCreditsToProfile } from "./supabase-admin";
import { recordCreditUsageStrict } from "./payment-record";

/**
 * Thrown by deductCredits() when the profile is missing or the balance is
 * below `cost`. Routes translate this into the existing 402
 * { error: "out_of_credits" } response shape.
 */
export class OutOfCreditsError extends Error {
  readonly status = 402;
  constructor() {
    super("out_of_credits");
    this.name = "OutOfCreditsError";
  }
}

/**
 * Thrown by chargeCredits() when the ledger insert fails after the balance
 * was already deducted. The deduction is rolled back first; this error
 * signals the route to fail loudly (500) instead of silently swallowing
 * the ledger gap. Routes translate this into a generic 500 JSON response.
 */
export class LedgerWriteError extends Error {
  readonly status = 500;
  constructor() {
    super("ledger_write_failed");
    this.name = "LedgerWriteError";
  }
}

/**
 * Deducts `cost` credits from a user's profile.
 *
 * Balances live in Supabase `profiles` — that is the table the auth
 * middleware reads, the UI displays, and every other charge path
 * (runway-clip, thumbnail, pre-production) writes. The Render Postgres
 * behind DATABASE_URL has no profiles table, so a direct UPDATE there
 * throws `relation "profiles" does not exist`.
 *
 * Read-modify-write via the service-role client (fresh read first, so we
 * never deduct from a stale middleware balance). Single-user contention
 * is negligible; callers needing strict exactly-once semantics should
 * gate on their own idempotency flag first (see chargeCreditsForJob).
 *
 * Returns the new balance. Throws OutOfCreditsError on missing profile
 * or insufficient balance.
 */
export async function deductCredits(userId: string, cost: number): Promise<number> {
  if (!Number.isFinite(cost) || cost <= 0) {
    throw new Error(`deductCredits: invalid cost ${cost}`);
  }
  const admin = getSupabaseAdmin();
  const { data: profile, error: readErr } = await admin
    .from("profiles")
    .select("credits")
    .eq("id", userId)
    .single();
  if (readErr) {
    logger.warn({ userId, cost, err: readErr.message }, "[credits] failed to read profile for deduction");
    throw new OutOfCreditsError();
  }
  const current = (profile as { credits?: number } | null)?.credits ?? 0;
  if (current < cost) {
    logger.warn({ userId, cost, current }, "[credits] insufficient balance");
    throw new OutOfCreditsError();
  }
  const creditsAfter = current - cost;
  const { error: updateErr } = await admin
    .from("profiles")
    .update({ credits: creditsAfter })
    .eq("id", userId);
  if (updateErr) {
    logger.error({ userId, cost, err: updateErr.message }, "[credits] deduction write failed");
    throw updateErr;
  }
  return creditsAfter;
}

export interface ChargeLedgerRecord {
  action: string;
  projectId?: string | null;
}

/**
 * Charge `cost` credits with a guaranteed ledger trace.
 *
 * Money-integrity path — every charge site must use this instead of calling
 * deductCredits() + fire-and-forget recordCreditUsage() separately. The two
 * writes go to two different databases (Supabase profiles vs Render Postgres
 * credit_usage), so they cannot share a transaction. Instead:
 *
 *  1. Deduct first (throws OutOfCreditsError on insufficient balance — no
 *     ledger entry is written in that case, which is correct).
 *  2. Write the ledger entry strictly (with retries). If it fails, roll the
 *     deduction back and throw LedgerWriteError so the route fails loudly
 *     instead of leaving a balance drop with no ledger trace.
 *
 * Returns the new balance. Throws OutOfCreditsError (402) or
 * LedgerWriteError (500).
 *
 * Pass { rollbackOnLedgerFailure: false } for background-job paths where the
 * value was already delivered (no user request to fail): the deduction then
 * stands and the ledger gap is logged as CRITICAL for manual reconciliation.
 */
export async function chargeCredits(
  userId: string,
  cost: number,
  record: ChargeLedgerRecord,
  opts?: { rollbackOnLedgerFailure?: boolean },
): Promise<number> {
  const creditsAfter = await deductCredits(userId, cost);
  const rollback = opts?.rollbackOnLedgerFailure ?? true;
  try {
    await recordCreditUsageStrict({
      userId,
      action: record.action,
      creditsUsed: cost,
      projectId: record.projectId ?? null,
    });
  } catch (err) {
    if (rollback) {
      logger.error(
        { userId, cost, action: record.action, err },
        "[credits] ledger write failed after deduction — rolling back the charge",
      );
      try {
        await addCreditsToProfile(userId, cost);
      } catch (rollbackErr) {
        logger.error(
          { userId, cost, action: record.action, rollbackErr },
          "[credits] CRITICAL: ledger write failed AND rollback failed — balance and ledger have diverged, manual reconciliation required",
        );
      }
    } else {
      // Background-job path: the value was already delivered, so the
      // deduction stands. Log loudly — this needs manual reconciliation.
      logger.error(
        { userId, cost, action: record.action, err },
        "[credits] CRITICAL: ledger write failed after deduction (no rollback) — charge stands without a ledger trace, manual reconciliation required",
      );
    }
    throw new LedgerWriteError();
  }
  return creditsAfter;
}

/**
 * Refund `amount` credits with a ledger trace.
 *
 * Writes the refund as a negative-amount credit_usage entry (the existing
 * convention, e.g. "Runway Video Clip — Refund (save failed)") so the
 * credit history reconciles. The balance is restored first; if the ledger
 * write then fails it is logged loudly (the money is already back — this
 * is a reporting gap, not a loss).
 */
export async function refundCredits(
  userId: string,
  amount: number,
  record: ChargeLedgerRecord,
): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`refundCredits: invalid amount ${amount}`);
  }
  await addCreditsToProfile(userId, amount);
  try {
    await recordCreditUsageStrict({
      userId,
      action: record.action,
      creditsUsed: -amount,
      projectId: record.projectId ?? null,
    });
  } catch (err) {
    logger.error(
      { userId, amount, action: record.action, err },
      "[credits] refund succeeded but ledger write failed — balance restored, ledger missing the refund entry",
    );
  }
}
