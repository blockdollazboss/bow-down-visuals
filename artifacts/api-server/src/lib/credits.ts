import { logger } from "./logger";
import { getSupabaseAdmin } from "./supabase-admin";

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
