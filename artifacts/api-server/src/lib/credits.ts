import { logger } from "./logger";
import { getSupabaseAdmin, addCreditsToProfile } from "./supabase-admin";
import { recordCreditUsageStrict } from "./payment-record";
import { getUserActiveTeam, deductTeamCredits } from "./teams";
import { db, teamsTable, creditUsageTable } from "@workspace/db";
import { eq, sql, and } from "drizzle-orm";

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
 * Thrown by deductCredits() when CREDITS_ADMIN_ONLY is set and the user
 * is not an admin. Routes translate this into a 403 response.
 */
export class CreditsDisabledError extends Error {
  readonly status = 403;
  constructor() {
    super("credits_disabled");
    this.name = "CreditsDisabledError";
  }
}

/**
 * Returns true if CREDITS_ADMIN_ONLY is set to "true".
 * When enabled, only admin users (per ADMIN_EMAILS) can spend credits.
 */
function isAdminOnlyMode(): boolean {
  return process.env["CREDITS_ADMIN_ONLY"] === "true";
}

/**
 * Checks if a user is an admin by looking up their email and comparing
 * against ADMIN_EMAILS (comma-separated, case-insensitive).
 */
async function isAdminUser(userId: string): Promise<boolean> {
  const adminEmails = (process.env["ADMIN_EMAILS"] ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (adminEmails.length === 0) return false;

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .single();
  if (error || !data) return false;
  const email = (data as { email?: string }).email?.toLowerCase() ?? "";
  return adminEmails.includes(email);
}

/**
 * Checks if a user has ever received an admin credit grant.
 * Used in admin-only mode to whitelist users the admin has explicitly approved.
 * Note: the credit ledger lives in Render Postgres (not Supabase).
 */
async function hasAdminGrant(userId: string): Promise<boolean> {
  try {
    const rows = await db
      .select({ id: creditUsageTable.id })
      .from(creditUsageTable)
      .where(
        and(
          eq(creditUsageTable.userId, userId),
          eq(creditUsageTable.action, "Admin Credit Grant")
        )
      )
      .limit(1);
    return rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Returns true if the user can spend credits.
 * In normal mode: everyone. In admin-only mode (CREDITS_ADMIN_ONLY=true):
 * only admins and users who've received an admin grant.
 */
export async function canUseCredits(userId: string): Promise<boolean> {
  if (!isAdminOnlyMode()) return true;
  if (await isAdminUser(userId)) return true;
  return await hasAdminGrant(userId);
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
  // Admin-only mode: block users who haven't been explicitly approved
  if (!(await canUseCredits(userId))) {
    logger.warn({ userId, cost }, "[credits] blocked non-whitelisted spend (admin-only mode)");
    throw new CreditsDisabledError();
  }
  const admin = getSupabaseAdmin();
  const { data: profile, error: readErr } = await admin
    .from("profiles")
    .select("credits, bonus_credits, bonus_credits_expires_at")
    .eq("id", userId)
    .single();
  if (readErr) {
    logger.warn({ userId, cost, err: readErr.message }, "[credits] failed to read profile for deduction");
    throw new OutOfCreditsError();
  }
  const typed = profile as { credits?: number; bonus_credits?: number; bonus_credits_expires_at?: string | null } | null;
  const current = typed?.credits ?? 0;
  // Bonus pool: spend first, but only if not expired. Expired bonus is
  // treated as zero (and cleared below so it never resurrects).
  let bonus = typed?.bonus_credits ?? 0;
  const bonusExpired = !!typed?.bonus_credits_expires_at && new Date(typed.bonus_credits_expires_at).getTime() < Date.now();
  if (bonusExpired) bonus = 0;
  const total = current + bonus;
  if (total < cost) {
    logger.warn({ userId, cost, current, bonus }, "[credits] insufficient balance");
    throw new OutOfCreditsError();
  }
  const fromBonus = Math.min(bonus, cost);
  const fromRegular = cost - fromBonus;
  const bonusAfter = bonus - fromBonus;
  const creditsAfter = current - fromRegular;
  const update: Record<string, unknown> = { credits: creditsAfter, bonus_credits: bonusAfter };
  if (bonusAfter <= 0 || bonusExpired) update.bonus_credits_expires_at = null;
  const { error: updateErr } = await admin
    .from("profiles")
    .update(update)
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
  // Admin-only mode: block users who haven't been explicitly approved.
  // This check sits BEFORE team-pool handling so team members can't
  // bypass the lockdown by spending from the shared pool.
  if (!(await canUseCredits(userId))) {
    logger.warn({ userId, cost }, "[credits] blocked non-whitelisted spend (admin-only mode)");
    throw new CreditsDisabledError();
  }
  // Team pool first: if the user is an active member of a team, the spend
  // comes from the shared pool — not their personal balance — unless the
  // team's policy allows falling back to personal credits.
  let teamId: string | null = null;
  let creditsAfter: number;
  const activeTeam = await getUserActiveTeam(userId);
  if (activeTeam) {
    const tid: string = activeTeam.team.id;
    const poolBalance: number = activeTeam.team.credits;
    const allowFallback: boolean = activeTeam.team.allowPersonalFallback ?? true;
    if (poolBalance >= cost) {
      try {
        teamId = tid;
        creditsAfter = await deductTeamCredits(tid, cost);
      } catch (e) {
        // Race: pool dropped below cost between the check and the deduction.
        // Honor the team's fallback policy instead of silently charging personal.
        if (!allowFallback) throw e;
        logger.warn({ userId, cost, teamId: tid, err: e instanceof Error ? e.message : String(e) }, "[credits] team pool race lost, falling back to personal balance per team policy");
        teamId = null;
        creditsAfter = await deductCredits(userId, cost);
      }
    } else if (allowFallback) {
      // Pool insufficient and team allows it: explicit (logged) personal fallback.
      logger.info({ userId, cost, teamId: tid, poolBalance }, "[credits] team pool insufficient, using personal balance per team policy");
      creditsAfter = await deductCredits(userId, cost);
    } else {
      // Pool insufficient and team forbids personal fallback: fail loudly.
      logger.warn({ userId, cost, teamId: tid, poolBalance }, "[credits] team pool insufficient and personal fallback disabled — rejecting charge");
      throw new OutOfCreditsError();
    }
  } else {
    creditsAfter = await deductCredits(userId, cost);
  }
  const rollback = opts?.rollbackOnLedgerFailure ?? true;
  try {
    await recordCreditUsageStrict({
      userId,
      action: record.action,
      creditsUsed: cost,
      projectId: record.projectId ?? null,
      teamId,
    });
  } catch (err) {
    if (rollback) {
      logger.error(
        { userId, cost, action: record.action, err },
        "[credits] ledger write failed after deduction — rolling back the charge",
      );
      try {
        if (teamId) {
          await db.update(teamsTable)
            .set({ credits: sql`${teamsTable.credits} + ${cost}`, updatedAt: new Date() })
            .where(eq(teamsTable.id, teamId));
        } else {
          await addCreditsToProfile(userId, cost);
        }
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
