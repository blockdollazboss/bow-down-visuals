import {
  createDrizzleAttemptStore,
  STALE_PROCESSING_MS,
  type AttemptStore,
} from "./social-idempotency";
import { addCreditsToProfile } from "./supabase-admin";
import { logger } from "./logger";

/* Stale publish-attempt sweeper (Instagram auto-post).

   The gap it closes: POST /social/instagram/publish claims an attempt row,
   deducts credits, then spends up to ~5 minutes polling Meta. If the Node
   process dies in that window (OOM, deploy restart), the row stays
   `processing` with credits deducted and no refund — and the in-process
   refund never runs. Retrying with the same idempotency key reclaims the
   row, but a user who never retries (closed tab, new key) would lose the
   credits forever.

   The sweeper runs periodically (and once shortly after boot, which covers
   the deploy-restart case) and, for every `processing` attempt older than
   the stale cutoff:

   1. Atomically claims it via claimStaleProcessing() — a single
      UPDATE … WHERE status='processing' AND updated_at < cutoff — moving it
      to `failed`. Concurrent sweepers (or a racing user retry) can't claim
      the same row: the loser's UPDATE matches zero rows.
   2. Refunds the deducted credits through the same addCreditsToProfile()
      path the publish route's own refund uses, and logs attempt id, user
      id, and the amount.

   Coordination with the retry path (the airtight part): a swept row is
   `failed`, and every `failed` row in this system implies "already
   refunded". claimPublishAttempt() therefore reports creditsAlreadyDeducted
   = false for reclaimed `failed` rows, so a later retry with the same
   idempotency key charges fresh — exactly once. No double charge (the
   retry deducts anew), no double refund (the sweeper refunded once, and
   the retry's deduction is a new charge, not a second refund).

   Crash window, documented honestly: if the process dies between the
   failed-marking UPDATE and the refund call, the row is `failed` without a
   refund. A later retry re-charges (failed ⇒ charge fresh), so the user is
   down the original deduction. That window is one Supabase call wide — the
   same shape as the publish route's own failAttempt→refund sequence.

   The refund amount comes from INSTAGRAM_POST_CREDITS (default 2), the same
   env var the publish route deducts. If that value changed between the
   deduction and the sweep, the refund would differ — in practice it's set
   once and left alone. */

const SWEEP_CREDIT_COST = Number(process.env["INSTAGRAM_POST_CREDITS"]) || 2;
const SWEEP_INTERVAL_MS = Number(process.env["SOCIAL_SWEEP_INTERVAL_MS"]) || 10 * 60 * 1000;
const SWEEP_STALE_MS = Number(process.env["SOCIAL_SWEEP_STALE_MS"]) || STALE_PROCESSING_MS;
const SWEEP_STARTUP_DELAY_MS =
  Number(process.env["SOCIAL_SWEEP_STARTUP_DELAY_MS"]) || 30 * 1000;

export interface SweepDeps {
  store?: AttemptStore;
  refundCredits?: (userId: string, amount: number) => Promise<void>;
  creditCost?: number;
  staleMs?: number;
  now?: Date;
}

export interface SweepResult {
  claimed: number;
  refunded: number;
  refundFailures: number;
}

export async function sweepStalePublishAttempts(deps: SweepDeps = {}): Promise<SweepResult> {
  const {
    store = createDrizzleAttemptStore(),
    refundCredits = (userId, amount) =>
      addCreditsToProfile(userId, amount).then(() => undefined),
    creditCost = SWEEP_CREDIT_COST,
    staleMs = SWEEP_STALE_MS,
    now = new Date(),
  } = deps;

  const cutoff = new Date(now.getTime() - staleMs);
  const claimed = await store.claimStaleProcessing(
    cutoff,
    "stale_sweeper: process died mid-publish, credits refunded",
  );

  let refunded = 0;
  let refundFailures = 0;
  for (const row of claimed) {
    if (!row.creditsDeducted) {
      /* Died between claim and deduction — nothing was charged, so there
         is nothing to refund. The row is already marked failed above. */
      logger.info(
        { attemptId: row.id, userId: row.userId },
        "[social] sweeper closed uncharged stale publish attempt",
      );
      continue;
    }
    try {
      await refundCredits(row.userId, creditCost);
      refunded += 1;
      logger.info(
        { attemptId: row.id, userId: row.userId, creditsRefunded: creditCost },
        "[social] sweeper refunded stale publish attempt",
      );
    } catch (err) {
      refundFailures += 1;
      logger.error(
        { attemptId: row.id, userId: row.userId, err },
        "[social] sweeper FAILED to refund stale publish attempt",
      );
    }
  }

  if (claimed.length > 0) {
    logger.info(
      { claimed: claimed.length, refunded, refundFailures },
      "[social] stale publish-attempt sweep complete",
    );
  }
  return { claimed: claimed.length, refunded, refundFailures };
}

/* Starts the periodic sweeper: one run shortly after boot (catches orphans
   from a crash/restart — the main case is a deploy restart killing a
   mid-publish process), then on the configured interval. The interval keeps
   the event loop alive by design; call stop() in tests. A sweep that throws
   is logged, never fatal to the server. */
export function startPublishAttemptSweeper(deps: SweepDeps = {}): { stop: () => void } {
  const run = () =>
    sweepStalePublishAttempts(deps).catch((err) =>
      logger.error({ err }, "[social] stale publish-attempt sweep crashed"),
    );
  const startupTimer = setTimeout(run, SWEEP_STARTUP_DELAY_MS);
  const intervalTimer = setInterval(run, SWEEP_INTERVAL_MS);
  logger.info(
    { intervalMs: SWEEP_INTERVAL_MS, startupDelayMs: SWEEP_STARTUP_DELAY_MS },
    "[social] stale publish-attempt sweeper started",
  );
  return {
    stop: () => {
      clearTimeout(startupTimer);
      clearInterval(intervalTimer);
    },
  };
}
