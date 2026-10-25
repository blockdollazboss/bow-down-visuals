/**
 * grant-ledger.ts — strict ledger rows for the two free grants that used
 * to move balances invisibly (payments lane, board item 58).
 *
 * The referral fix cured this disease for referral grants only: every
 * grant writes a credit_usage row via recordCreditUsageStrict, keyed
 * `referral-welcome:${userId}` / `referral-payout:${sessionId}`, with
 * creditsUsed NEGATIVE (the ledger's grant convention — a grant is a
 * negative spend). Starter (300 VB, written by the require-auth
 * first-profile insert) and trial (1,000 VB, POST /credits/claim-trial)
 * only bumped profiles.credits, so /credit-history — which reads
 * credit_usage — showed a balance with no rows behind it.
 *
 * This module applies the referral pattern to both grants:
 *   starter → action "Starter Grant", key `starter-grant:${userId}`
 *   trial   → action "Trial Grant",   key `trial-grant:${userId}`
 *
 * The credit_usage idempotency_key UNIQUE index makes the row itself
 * the claim: recording the same grant twice resolves as
 * "already-recorded", never a second row. Callers decide what a thrown
 * (genuinely failed) ledger write means for their grant — the trial
 * route follows the referral pattern (claw the credits back, release
 * the claim flag, surface the failure); require-auth must never fail
 * authentication over bookkeeping, so it logs loudly instead.
 */
import { db, creditUsageTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { recordCreditUsageStrict } from "./payment-record";
import { isUniqueViolation } from "./pg-errors";
import { logger } from "./logger";

export const STARTER_GRANT_CREDITS = 300;
export const TRIAL_GRANT_CREDITS = 1000;

export type GrantKind = "starter" | "trial";

const GRANT_DEFS: Record<
  GrantKind,
  { action: string; credits: number; keyPrefix: string }
> = {
  starter: {
    action: "Starter Grant",
    credits: STARTER_GRANT_CREDITS,
    keyPrefix: "starter-grant",
  },
  trial: {
    action: "Trial Grant",
    credits: TRIAL_GRANT_CREDITS,
    keyPrefix: "trial-grant",
  },
};

export function grantLedgerKey(kind: GrantKind, userId: string): string {
  return `${GRANT_DEFS[kind].keyPrefix}:${userId}`;
}

export interface GrantLedgerDeps {
  /** True when a ledger row already carries this idempotency key. */
  exists: (idempotencyKey: string) => Promise<boolean>;
  /** The strict (throwing) ledger insert — recordCreditUsageStrict. */
  insertStrict: (record: {
    userId: string;
    action: string;
    creditsUsed: number;
    idempotencyKey: string;
  }) => Promise<void>;
}

const defaultDeps: GrantLedgerDeps = {
  exists: async (idempotencyKey) => {
    const [row] = await db
      .select({ id: creditUsageTable.id })
      .from(creditUsageTable)
      .where(eq(creditUsageTable.idempotencyKey, idempotencyKey))
      .limit(1);
    return !!row;
  },
  insertStrict: async (record) => {
    await recordCreditUsageStrict(record);
  },
};

function isDuplicateKeyError(err: unknown): boolean {
  /* Drizzle wraps pg errors (the D6 lesson — see pg-errors.ts), so the
     23505 code may ride on .cause; a message match covers injected
     fakes in tests. Either signal means the keyed row already exists. */
  if (isUniqueViolation(err)) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /duplicate key|unique constraint|credit_usage_idempotency_key_uidx/i.test(
    msg,
  );
}

export type GrantLedgerOutcome = "recorded" | "already-recorded";

/**
 * Write the strict ledger row for a starter/trial grant that has ALREADY
 * landed on the profile balance. Resolves "already-recorded" when the
 * keyed row exists (idempotent replay — e.g. a retry after a crash
 * between grant and ledger). Throws when the write genuinely fails so
 * the caller can run its clawback/claim-release leg.
 */
export async function recordGrantLedger(
  kind: GrantKind,
  userId: string,
  deps: GrantLedgerDeps = defaultDeps,
): Promise<GrantLedgerOutcome> {
  const def = GRANT_DEFS[kind];
  const idempotencyKey = grantLedgerKey(kind, userId);
  if (await deps.exists(idempotencyKey)) return "already-recorded";
  try {
    await deps.insertStrict({
      userId,
      action: def.action,
      creditsUsed: -def.credits,
      idempotencyKey,
    });
    return "recorded";
  } catch (err) {
    /* The UNIQUE index fired between the pre-check and the insert —
       the row exists, which is the state we wanted. */
    if (isDuplicateKeyError(err)) return "already-recorded";
    logger.error(
      { err, userId, kind, idempotencyKey },
      "[grant-ledger] strict ledger write failed for a landed grant",
    );
    throw err;
  }
}
