import { createHash } from "crypto";
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

export interface ChargeCreditsOpts {
  rollbackOnLedgerFailure?: boolean;
  /**
   * Idempotency key for this charge. If a credit_usage row already exists
   * with this key, the charge is skipped and the current balance is returned
   * (idempotent success — safe for client retries). The key is written into
   * the ledger row on success.
   */
  idempotencyKey?: string | null;
  /**
   * Force the deduction from the personal balance, skipping team-pool
   * routing. Use for endpoints where the spend must be personal (e.g.
   * funding a team pool from personal credits).
   */
  personalOnly?: boolean;
}

/**
 * Build the stable idempotency key for a charge: one key per
 * (user, endpoint scope, request-intent), so a double-tap or a client
 * retry of the SAME request can never double-charge.
 *
 * A client-supplied key (the thumbnail-generator pattern: the client
 * generates one key per user intent) wins when present; it is scoped
 * by endpoint + user so a key reused across endpoints or users can't
 * cross-suppress a legitimate charge. Without a client key, the key
 * is derived from a hash of the request intent itself (the validated
 * payload / file bytes hash the caller passes in `intent`) — an
 * identical retry hashes to the identical key.
 *
 * Trade-off of the derived form: a deliberate re-run with byte-identical
 * inputs is treated as the same purchase and is not charged again.
 * That errs on the customer's side (never an overcharge), which is the
 * direction the money rules require.
 */
export function buildChargeIdempotencyKey(
  scope: string,
  userId: string,
  clientKey: unknown,
  intent: unknown,
): string {
  if (typeof clientKey === "string" && clientKey.trim().length >= 8) {
    return `${scope}:${userId}:client:${clientKey.trim()}`;
  }
  const intentJson = typeof intent === "string" ? intent : (JSON.stringify(intent) ?? "");
  const hash = createHash("sha256").update(intentJson).digest("hex").slice(0, 32);
  return `${scope}:${userId}:${hash}`;
}

/**
 * Check whether an idempotency key was already charged. Returns the existing
 * ledger row's id and teamId if found (teamId null = the original charge hit
 * the personal balance), null otherwise. The teamId lets the replay path
 * report the balance of the pool the original charge actually drew from.
 */
async function findExistingCharge(
  idempotencyKey: string,
): Promise<{ id: string; teamId: string | null } | null> {
  try {
    const [row] = await db
      .select({ id: creditUsageTable.id, teamId: creditUsageTable.teamId })
      .from(creditUsageTable)
      .where(eq(creditUsageTable.idempotencyKey, idempotencyKey))
      .limit(1);
    return row ? { id: row.id, teamId: row.teamId ?? null } : null;
  } catch {
    // Table/column missing on a lagging DB — fail open (no dedup) rather
    // than blocking the charge. Logged by the caller.
    return null;
  }
}

/**
 * Read a team's current pool balance by id — the same teams-table read the
 * team charge path uses (teams.ts getUserActiveTeam selects the row by id
 * and reads .credits off it). Returns null when the team row is gone or the
 * read fails, so callers can fall back rather than throw.
 */
async function readTeamPoolBalance(teamId: string): Promise<number | null> {
  try {
    const [team] = await db
      .select()
      .from(teamsTable)
      .where(eq(teamsTable.id, teamId))
      .limit(1);
    return team?.credits ?? null;
  } catch {
    return null;
  }
}

/**
 * Read the user's current personal credit balance (fresh, no cache).
 * This is THE balance read the credits rail serves from (requireAuth
 * stamps the same profiles.credits value onto the request); the
 * Cloud Operator's balance tool calls it through getCreditBalance.
 */
async function readPersonalBalance(userId: string): Promise<number> {
  const admin = getSupabaseAdmin();
  const { data } = await admin.from("profiles").select("credits").eq("id", userId).single();
  return (data as { credits?: number } | null)?.credits ?? 0;
}

/** Public balance read for rails that answer "how many Visual Bucs do
 *  I have" (the operator's Tier-0 balance tool). Same read, same
 *  source — never a second balance implementation. */
export async function getCreditBalance(userId: string): Promise<number> {
  return readPersonalBalance(userId);
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
  opts?: ChargeCreditsOpts,
): Promise<number> {
  // Admin-only mode: block users who haven't been explicitly approved.
  // This check sits BEFORE team-pool handling so team members can't
  // bypass the lockdown by spending from the shared pool.
  if (!(await canUseCredits(userId))) {
    logger.warn({ userId, cost }, "[credits] blocked non-whitelisted spend (admin-only mode)");
    throw new CreditsDisabledError();
  }
  // P0-23 idempotency: if this exact charge already landed, don't charge
  // again — return the current balance as an idempotent success.
  const idempotencyKey = opts?.idempotencyKey?.trim() || null;
  if (idempotencyKey) {
    const existing = await findExistingCharge(idempotencyKey);
    if (existing) {
      logger.info({ userId, cost, action: record.action, idempotencyKey }, "[credits] duplicate charge suppressed by idempotency key");
      // A replayed TEAM charge must report the pool balance — that's the
      // balance the original charge returned and the one the client is
      // displaying. If the team is gone or its balance is unreadable, fall
      // back to the personal balance (fail-open, same as the lookup itself).
      if (existing.teamId) {
        const poolBalance = await readTeamPoolBalance(existing.teamId);
        if (poolBalance !== null) return poolBalance;
      }
      return readPersonalBalance(userId);
    }
  }
  // Team pool first (unless forced personal): if the user is an active
  // member of a team, the spend comes from the shared pool — not their
  // personal balance — unless the team's policy allows falling back.
  let teamId: string | null = null;
  let creditsAfter: number;
  const useTeamPool = !opts?.personalOnly;
  const activeTeam = useTeamPool ? await getUserActiveTeam(userId) : null;
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
      idempotencyKey,
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
 * Void a charge's idempotency key (Lane V3 F1): after a charge is
 * refunded, its ledger row keeps the key — so a retry with the same
 * key is suppressed as a "replay" and runs FREE while costing real
 * provider money. Voiding nulls the key on the charge row (the row
 * itself stays for audit; the refund row carries the reversal), so
 * the next attempt with that key charges again. Returns true when a
 * row was voided. Never throws — a failed void is logged loudly and
 * the caller still reports the refund honestly.
 */
export async function voidChargeIdempotencyKey(
  idempotencyKey: string,
): Promise<boolean> {
  if (!idempotencyKey) return false;
  try {
    /* Raw SQL for the lookups: a literal LIMIT (some drivers reject a
       bound LIMIT parameter). The void counts only when a row existed
       AND the key no longer answers afterwards. */
    const before = await db.execute(
      sql`SELECT id FROM credit_usage WHERE idempotency_key = ${idempotencyKey} LIMIT 1`,
    );
    if (!before.rows.length) return false;
    await db
      .update(creditUsageTable)
      .set({ idempotencyKey: null })
      .where(eq(creditUsageTable.idempotencyKey, idempotencyKey));
    const after = await db.execute(
      sql`SELECT id FROM credit_usage WHERE idempotency_key = ${idempotencyKey} LIMIT 1`,
    );
    return after.rows.length === 0;
  } catch (err) {
    logger.error(
      { idempotencyKey, err },
      "[credits] CRITICAL: failed to void a refunded charge's idempotency key — a retry could run free; manual reconciliation required",
    );
    return false;
  }
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
