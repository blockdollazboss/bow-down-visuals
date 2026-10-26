/* ─── Remix the King — split payments rail (#152) ────────────────────
   Moves split money on the Pitch & Fix / referral pattern:
   1. CLAIM — the payment row flips pending → paid (conditional, one
      winner) BEFORE any money moves. A loser pays nothing.
   2. GRANT — addCreditsAtomic credits the payee's profile.
   3. LEDGER — a STRICT credit_usage row, creditsUsed NEGATIVE (the
      grant convention), keyed `remix-king-split:<payment_id>` — the
      unique key makes any replay resolve "already-recorded", never a
      second row, and the grant shows on /credit-history.
   4. FAILURE — grant/ledger failure after the claim claws back any
      credits that moved, RELEASES the claim (paid → pending), and
      reports failed_released; the next run retries — never a
      double-pay, never a silent loss.

   A payment whose payee has no on-platform account (payeeUserId null —
   e.g. a house share published under a name only) is SKIPPED, never
   guessed at: it stays pending and visible. Visual Bucs ONLY, TEST
   MODE — no cash path exists anywhere in this rail. */

import { db, creditUsageTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { recordCreditUsageStrict } from "./payment-record";
import { isUniqueViolation } from "./pg-errors";
import { logger } from "./logger";
import { splitLedgerKey, type RemixKingStore, type SplitPaymentWire } from "./remix-king";

export interface SplitPayDeps {
  addCredits(userId: string, amount: number): Promise<void>;
  recordLedger(record: { userId: string; action: string; creditsUsed: number; idempotencyKey: string }): Promise<"recorded" | "already-recorded">;
}

function isDuplicateKeyError(err: unknown): boolean {
  if (isUniqueViolation(err)) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /duplicate key|unique constraint|credit_usage_idempotency_key_uidx/i.test(msg);
}

export const defaultSplitPayDeps: SplitPayDeps = {
  async addCredits(userId, amount) {
    const { addCreditsAtomic } = await import("./supabase-admin");
    await addCreditsAtomic(userId, amount);
  },
  async recordLedger(record) {
    const [existing] = await db.select({ id: creditUsageTable.id }).from(creditUsageTable)
      .where(eq(creditUsageTable.idempotencyKey, record.idempotencyKey)).limit(1);
    if (existing) return "already-recorded";
    try {
      await recordCreditUsageStrict(record);
      return "recorded";
    } catch (err) {
      if (isDuplicateKeyError(err)) return "already-recorded";
      throw err;
    }
  },
};

export type SplitPayOutcome = "paid" | "already_claimed" | "skipped_no_payee" | "failed_released";

export async function paySplitPayment(store: RemixKingStore, deps: SplitPayDeps, payment: SplitPaymentWire, now: Date = new Date()): Promise<SplitPayOutcome> {
  if (payment.status !== "pending") return "already_claimed";
  if (!payment.payeeUserId) return "skipped_no_payee";
  if (payment.amountVb <= 0) return "already_claimed";
  const claimed = await store.claimPayment(payment.id, now.toISOString());
  if (!claimed) return "already_claimed";
  let granted = false;
  try {
    await deps.addCredits(payment.payeeUserId, payment.amountVb);
    granted = true;
    await deps.recordLedger({
      userId: payment.payeeUserId,
      action: `Remix the King — Official Release Split (${payment.period})`,
      creditsUsed: -payment.amountVb,
      idempotencyKey: splitLedgerKey(payment.id),
    });
    return "paid";
  } catch (err) {
    if (granted) await deps.addCredits(payment.payeeUserId, -payment.amountVb).catch(() => {});
    await store.releasePaymentClaim(payment.id);
    logger.error({ err, paymentId: payment.id, payeeUserId: payment.payeeUserId, amountVb: payment.amountVb },
      "[remix-king] split payout failed after claim — credits clawed back, claim released for retry");
    return "failed_released";
  }
}

export interface ProcessSplitsResult {
  paidIds: string[];
  paidNowVb: number;
  skippedNoPayeeIds: string[];
  failedId: string | null;
  stillPendingIds: string[];
}

export async function processSplitPayments(store: RemixKingStore, deps: SplitPayDeps, releaseId: string, now: Date = new Date()): Promise<ProcessSplitsResult> {
  const payments = await store.listPayments(releaseId);
  const result: ProcessSplitsResult = { paidIds: [], paidNowVb: 0, skippedNoPayeeIds: [], failedId: null, stillPendingIds: [] };
  for (const p of payments) {
    if (p.status !== "pending") continue;
    const outcome = await paySplitPayment(store, deps, p, now);
    if (outcome === "paid") { result.paidIds.push(p.id); result.paidNowVb += p.amountVb; }
    else if (outcome === "skipped_no_payee") result.skippedNoPayeeIds.push(p.id);
    else if (outcome === "failed_released") { result.failedId = p.id; result.stillPendingIds.push(p.id); }
  }
  return result;
}
