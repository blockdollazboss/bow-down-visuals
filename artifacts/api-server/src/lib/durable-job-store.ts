import { logger } from "./logger";
import { refundCredits, voidChargeIdempotencyKey } from "./credits";
import {
  loadGenerationJob,
  loadGenerationJobByChargeKey,
  sweepExpiredGenerationJobs,
  syncGenerationJob,
  type GenerationJobRecord,
} from "./generation-jobs";

/**
 * DurableJobStore — the per-rail adapter over the generalized
 * durable job storage (migration 0335, lib/generation-jobs.ts),
 * generalizing the avatar-presenter pattern (0334,
 * routes/generate/avatar-presenter.ts + lib/avatar-presenter-jobs.ts)
 * to the remaining job-Map generation rails.
 *
 * A rail keeps its in-memory Map as its working cache and hands
 * it to a store with a small hooks object describing its job
 * shape. The store then gives the rail the avatar semantics:
 *
 *  - persist(job) at creation: the row lands before (or as) the
 *    worker fires, so the job exists on the record from its first
 *    moment;
 *  - sync(job) on every mutation the rail reports (status
 *    transitions, result refs, terminal settles);
 *  - find(id): Map first, durable store on a miss — a rehydrated
 *    job re-enters the Map and, if it never finished, is
 *    RECOVERED before it is answered from: its worker is resumed
 *    when the rail's resume hook can still run it (its inputs
 *    survived the restart), otherwise the job is SETTLED —
 *    marked failed and refunded exactly once;
 *  - claimRefund(job): the exactly-once refund claim — the flag
 *    is set on the job and synced to the row BEFORE the caller
 *    moves the refund, so a replayed/resumed completion can
 *    never double-refund (the avatar rule);
 *  - a TTL sweep over the rail's rows on the SAME 2h clock the
 *    in-memory sweeper uses.
 *
 * Everything storage-side is fail-open (lib/generation-jobs.ts):
 * with storage down, persist/sync no-op and find() misses behave
 * exactly like the pre-0335 in-process Map.
 */

export interface DurableJobHooks<J> {
  /** The rail name — the row's namespace ("audio-cleanup", …). */
  rail: string;
  /** The job's current status string (some rails call it state). */
  statusOf: (job: J) => string;
  /** Whether a status is terminal (done/failed/…) for this rail. */
  isTerminalStatus: (status: string) => boolean;
  /** Mark a job failed with an error message (the settle path). */
  setFailed: (job: J, error: string) => void;
  /** The amount charged for this job (0 for never-charged jobs). */
  amountOf: (job: J) => number;
  /** The charge's idempotency key, when the job carries one. */
  chargeKeyOf: (job: J) => string | null;
  /** Ledger action label for a settle (restart) refund. A function
   *  for rails whose label depends on the job (freeze-mask's kinds). */
  refundAction: string | ((job: J) => string);
  /** The error a settled job reports — it never completed, and
   *  its charge was refunded. */
  settleError: string;
  /**
   * Resume a rehydrated non-terminal job's worker. Return true
   * when the worker was re-fired (it settles the job itself from
   * here, including its failure refund); return false when the
   * job cannot be resumed (its inputs did not survive) and the
   * store should settle it instead. Omit for rails whose jobs are
   * completed by polling an external provider (the poll IS the
   * continuation — rehydration alone restores them).
   */
  resume?: (job: J) => Promise<boolean>;
  /** Row TTL — defaults to the job-map-sweeper's 2h. */
  ttlMs?: number;
}

type DurableJobLike = {
  id: string;
  userId: string;
  createdAt: number;
  creditsRefunded?: boolean;
};

const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000; // == job-map-sweeper default TTL

export class DurableJobStore<J extends DurableJobLike> {
  private readonly ttlMs: number;
  /** Job ids with a recovery (resume/settle) running in THIS
   *  process — keeps a rehydrated job from ever being recovered
   *  twice at once. */
  private readonly recovering = new Set<string>();

  constructor(
    private readonly map: Map<string, J>,
    private readonly hooks: DurableJobHooks<J>,
  ) {
    this.ttlMs = hooks.ttlMs ?? DEFAULT_TTL_MS;
    /* The durable TTL sweep runs on the sweeper's own cadence
       over the SAME 2h clock — rows expire by query, not by a
       process forgetting them (the avatar-presenter shape). */
    const timer = setInterval(() => {
      void sweepExpiredGenerationJobs(this.hooks.rail, this.ttlMs);
    }, 5 * 60 * 1000); // == job-map-sweeper sweep cadence
    timer.unref?.();
  }

  private toRecord(job: J): GenerationJobRecord {
    let payload: Record<string, unknown> = {};
    try {
      payload = JSON.parse(JSON.stringify(job)) as Record<string, unknown>;
    } catch (err) {
      logger.error(
        { err, rail: this.hooks.rail, jobId: job.id },
        "[generation-jobs] job record is not JSON-serializable — persisting an empty payload (fail-open)",
      );
    }
    return {
      rail: this.hooks.rail,
      id: job.id,
      userId: job.userId,
      status: this.hooks.statusOf(job),
      creditsCharged: this.hooks.amountOf(job),
      chargeKey: this.hooks.chargeKeyOf(job),
      creditsRefunded: job.creditsRefunded ?? false,
      createdAt: job.createdAt,
      payload,
    };
  }

  /**
   * Write the job's row at creation. This is an UPSERT, not
   * avatar's conflict-do-nothing insert, on purpose: several
   * rails derive the job id from the paid intent and RE-MINT the
   * job under the same id after a refunded failure (the failed
   * job's charge was voided, so the retry charges fresh and runs
   * as a new job) — the fresh creation must replace the failed
   * row, claim flag and all, or a later rehydration would answer
   * from the dead job. Concurrent twins never reach persist:
   * they collapse onto the existing job (twin check / creation
   * in-flight map) before any creation runs.
   */
  async persist(job: J): Promise<void> {
    await syncGenerationJob(this.toRecord(job));
  }

  /** Mirror a job mutation into its row (upsert). */
  async sync(job: J): Promise<void> {
    await syncGenerationJob(this.toRecord(job));
  }

  /**
   * The exactly-once refund claim (the avatar rule): returns
   * false when the job's refund was already claimed — in this
   * process or, for a rehydrated job, in the row it came from.
   * Otherwise claims synchronously and syncs the claim to the
   * row BEFORE the caller moves any refund.
   */
  async claimRefund(job: J): Promise<boolean> {
    if (job.creditsRefunded) return false;
    job.creditsRefunded = true; // claim synchronously — exactly once
    await this.sync(job); // the claim is durable before the refund moves
    return true;
  }

  /**
   * The one job lookup a converted rail uses: Map first, durable
   * store on a miss. A rehydrated job re-enters the Map and, if
   * it never finished, is recovered (resumed or settled) in the
   * background before later polls answer from it.
   */
  async find(id: string): Promise<J | undefined> {
    const cached = this.map.get(id);
    if (cached) return cached;
    const stored = await loadGenerationJob(this.hooks.rail, id);
    if (!stored) return undefined;
    const job = stored.payload as unknown as J;
    if (!job || typeof job !== "object" || job.id !== id) return undefined;
    this.map.set(job.id, job);
    if (!this.hooks.isTerminalStatus(stored.status)) {
      void this.recover(job);
    }
    return job;
  }

  /**
   * Find a job by its charge key — for rails whose job ids are not
   * derived from the key. Rehydrates (and recovers) the job exactly
   * like find() does.
   */
  async findByChargeKey(chargeKey: string): Promise<J | undefined> {
    const cached = [...this.map.values()].find(
      (j) => this.hooks.chargeKeyOf(j) === chargeKey,
    );
    if (cached) return cached;
    const stored = await loadGenerationJobByChargeKey(this.hooks.rail, chargeKey);
    if (!stored) return undefined;
    return this.find(stored.id);
  }

  /** Resume or settle a rehydrated non-terminal job, once. */
  private async recover(job: J): Promise<void> {
    if (this.recovering.has(job.id)) return;
    this.recovering.add(job.id);
    try {
      let resumed = false;
      if (this.hooks.resume) {
        resumed = await this.hooks.resume(job).catch((err) => {
          logger.warn(
            { err, rail: this.hooks.rail, jobId: job.id },
            "[generation-jobs] resume attempt failed — settling the job instead",
          );
          return false;
        });
      } else {
        /* No resume hook: the rail completes jobs by polling an
           external provider, so the rehydrated record IS the
           continuation — the next poll drives it. Nothing to do. */
        return;
      }
      if (!resumed) await this.settle(job);
    } finally {
      this.recovering.delete(job.id);
    }
  }

  /**
   * Settle a job that can never complete (a restart took its
   * worker and its inputs): mark it failed and refund its charge
   * exactly once — the claim lands in the row before the refund
   * moves, and a landed refund voids the charge key so a retry
   * charges fresh, exactly like a worker-side failure.
   */
  private async settle(job: J): Promise<void> {
    const amount = this.hooks.amountOf(job);
    if (amount > 0) {
      const claimed = await this.claimRefund(job);
      if (claimed) {
        let refunded = true;
        try {
          const action =
            typeof this.hooks.refundAction === "function"
              ? this.hooks.refundAction(job)
              : this.hooks.refundAction;
          await refundCredits(job.userId, amount, { action });
        } catch (refundErr) {
          refunded = false;
          logger.error(
            { err: refundErr, rail: this.hooks.rail, jobId: job.id, userId: job.userId },
            "[generation-jobs] CRITICAL: restart-settle refund failed — manual reconciliation required",
          );
        }
        const key = this.hooks.chargeKeyOf(job);
        if (refunded && key) {
          await voidChargeIdempotencyKey(key).catch(() => false);
        }
      }
    }
    this.hooks.setFailed(job, this.hooks.settleError);
    await this.sync(job);
  }
}
