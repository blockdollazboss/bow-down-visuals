import { eq, and, lt } from "drizzle-orm";
import {
  db as defaultDb,
  clipChargeObligationsTable,
  generatedClipsTable,
  type ClipChargeObligationRow,
} from "@workspace/db";
import { refundCredits } from "./credits";
import { logger } from "./logger";

/* Durable charge→refund obligations for generated video clips
   (payments defect D3; migration 0183; table clip_charge_obligations).

   The gap this closes: the Runway/Veo poll handlers charge credits on
   SUCCEEDED and remembered the charge in an in-memory map
   (chargedTasks in routes/generate/runway-clip.ts) so the follow-up
   POST /api/generated-clips save could refund when its insert failed.
   A server restart between the charge and the save lost the map
   entry — the member was charged for a clip that never landed and
   nothing gave the credits back. The map also expired after 1 hour,
   silently dropping the refund right for a save that came later.

   The durable discipline (the operator_pending_actions /
   social-publish-attempts pattern, applied to a refund obligation):

   1. RECORD — at charge time the poll handler writes one 'pending'
      row (task_id UNIQUE: a re-poll can never record it twice). The
      row carries the member and the amount actually charged, so every
      later refund reads them from the row — never from a price
      constant that may have changed since.
   2. DELIVER — a successful save marks the row 'delivered'. If that
      marking itself is lost (crash between insert and mark), the
      sweeper completes the bookkeeping instead: it finds the landed
      generated_clips row by runway_job_id and marks 'delivered'
      without refunding.
   3. REFUND — every refund path CLAIMS the row first with a single
      UPDATE … WHERE status='pending' (the save-failure handler also
      scopes by user_id). Only the claim winner refunds, so a restart,
      a second sweeper, or a racing handler can never double-refund.
      Charges that predate the durable record (or whose record insert
      failed — logged CRITICAL at record time) fall back to the
      in-memory map entry, exactly as before this lane.
   4. SWEEP — a stale sweeper (once shortly after boot, then on an
      interval — the social-sweeper shape) resolves 'pending' rows
      older than the stale cutoff: landed clip → 'delivered'; no clip
      → claim + refund. The cutoff defaults to 1 hour, the lifetime
      the in-memory map used to promise.

   Crash window, documented honestly (same shape as the social
   sweeper): if the process dies between the claim UPDATE and the
   refund call, the row reads 'refunded' without a refund. That
   window is one refund call wide, the claim is logged with the
   amount, and the row stays in the table for reconciliation. */

export const CLIP_CHARGE_STALE_MS =
  Number(process.env["CLIP_CHARGE_STALE_MS"]) || 60 * 60 * 1000;
const SWEEP_INTERVAL_MS =
  Number(process.env["CLIP_CHARGE_SWEEP_INTERVAL_MS"]) || 10 * 60 * 1000;
const SWEEP_STARTUP_DELAY_MS =
  Number(process.env["CLIP_CHARGE_SWEEP_STARTUP_DELAY_MS"]) || 30 * 1000;

export interface ClipChargeStore {
  /** Insert one 'pending' obligation. task_id is UNIQUE — a duplicate
      record (re-poll of an already-charged task) is a no-op. */
  recordPending(input: {
    taskId: string;
    userId: string;
    credits: number;
    projectId?: string | null;
  }): Promise<void>;
  /** Move 'pending' → 'delivered'. Returns true when this call moved
      the row (false = already resolved or never recorded). */
  markDelivered(taskId: string, resolution: string): Promise<boolean>;
  /** Atomically claim one 'pending' row for refund, scoped to its
      owner. Returns the claimed row, or null when the row is absent
      or already resolved — the exactly-once gate for refund paths. */
  claimForRefund(
    taskId: string,
    userId: string,
    resolution: string,
  ): Promise<ClipChargeObligationRow | null>;
  /** Every 'pending' row created before the cutoff, oldest first. */
  listStalePending(cutoff: Date): Promise<ClipChargeObligationRow[]>;
  /** Atomically claim a stale row for refund by id (the sweeper read
      the row first; the claim re-checks status='pending'). */
  claimStaleById(id: string, resolution: string): Promise<ClipChargeObligationRow | null>;
  /** True when a generated_clips row landed for this task id. */
  hasLandedClip(taskId: string): Promise<boolean>;
}

type Db = typeof defaultDb;

export function createDrizzleClipChargeStore(db: Db = defaultDb): ClipChargeStore {
  const T = clipChargeObligationsTable;
  return {
    async recordPending(input) {
      await db
        .insert(T)
        .values({
          task_id: input.taskId,
          user_id: input.userId,
          credits: input.credits,
          project_id: input.projectId ?? null,
          status: "pending",
        })
        .onConflictDoNothing({ target: T.task_id });
    },

    async markDelivered(taskId, resolution) {
      const rows = await db
        .update(T)
        .set({ status: "delivered", resolution, resolved_at: new Date() })
        .where(and(eq(T.task_id, taskId), eq(T.status, "pending")))
        .returning({ id: T.id });
      return rows.length > 0;
    },

    async claimForRefund(taskId, userId, resolution) {
      const rows = await db
        .update(T)
        .set({ status: "refunded", resolution, resolved_at: new Date() })
        .where(
          and(
            eq(T.task_id, taskId),
            eq(T.user_id, userId),
            eq(T.status, "pending"),
          ),
        )
        .returning();
      return rows[0] ?? null;
    },

    async listStalePending(cutoff) {
      return db
        .select()
        .from(T)
        .where(and(eq(T.status, "pending"), lt(T.created_at, cutoff)))
        .orderBy(T.created_at);
    },

    async claimStaleById(id, resolution) {
      const rows = await db
        .update(T)
        .set({ status: "refunded", resolution, resolved_at: new Date() })
        .where(and(eq(T.id, id), eq(T.status, "pending")))
        .returning();
      return rows[0] ?? null;
    },

    async hasLandedClip(taskId) {
      const rows = await db
        .select({ id: generatedClipsTable.id })
        .from(generatedClipsTable)
        .where(eq(generatedClipsTable.runway_job_id, taskId))
        .limit(1);
      return rows.length > 0;
    },
  };
}

export interface ClipChargeDeps {
  store?: ClipChargeStore;
  refund?: typeof refundCredits;
  staleMs?: number;
  now?: Date;
}

function deps(depsIn: ClipChargeDeps): Required<ClipChargeDeps> {
  return {
    store: depsIn.store ?? createDrizzleClipChargeStore(),
    refund: depsIn.refund ?? refundCredits,
    staleMs: depsIn.staleMs ?? CLIP_CHARGE_STALE_MS,
    now: depsIn.now ?? new Date(),
  };
}

/**
 * Record the charge→refund obligation at charge time. Callers wrap
 * this so a failed insert is logged CRITICAL and the in-memory map
 * remains the fallback — never let bookkeeping break the delivery.
 */
export async function recordClipCharge(
  input: { taskId: string; userId: string; credits: number; projectId?: string | null },
  depsIn: ClipChargeDeps = {},
): Promise<void> {
  const { store } = deps(depsIn);
  await store.recordPending(input);
}

/** Mark the obligation delivered after the clip row landed. */
export async function markClipChargeDelivered(
  taskId: string,
  depsIn: ClipChargeDeps = {},
): Promise<boolean> {
  const { store } = deps(depsIn);
  return store.markDelivered(taskId, "saved");
}

export interface SaveFailureRefundResult {
  refunded: boolean;
  credits: number;
  /** 'durable' when the obligation row carried the refund, 'memory'
      when the pre-durability in-memory entry did, null when neither
      had anything to refund. */
  source: "durable" | "memory" | null;
}

/**
 * The save-failure refund (POST /api/generated-clips insert failed):
 * claim the durable obligation and refund from the row. When no
 * durable row answers (charge predates this lane, or its record
 * insert failed), fall back to the in-memory chargedTasks entry —
 * the caller passes it in and owns its refunded flag.
 *
 * Throws only when a CLAIMED refund itself fails (the row already
 * reads 'refunded'; the caller logs it CRITICAL — the documented
 * one-call-wide window in the header).
 */
export async function refundClipChargeOnSaveFailure(
  taskId: string,
  opts: {
    userId: string;
    projectId?: string | null;
    memoryCharge?: { userId: string; credits: number; refunded: boolean } | null;
  },
  depsIn: ClipChargeDeps = {},
): Promise<SaveFailureRefundResult> {
  const { store, refund } = deps(depsIn);

  const claimed = await store.claimForRefund(taskId, opts.userId, "save_failed");
  if (claimed) {
    await refund(claimed.user_id, claimed.credits, {
      action: "Runway Video Clip — Refund (save failed)",
      projectId: opts.projectId ?? claimed.project_id ?? null,
    });
    logger.info(
      { taskId, userId: claimed.user_id, refundedCredits: claimed.credits },
      "[generated-clips] refund completed (durable obligation)",
    );
    return { refunded: true, credits: claimed.credits, source: "durable" };
  }

  const mem = opts.memoryCharge ?? null;
  if (mem && mem.userId === opts.userId && !mem.refunded) {
    mem.refunded = true; /* mark immediately to prevent double-refund */
    await refund(opts.userId, mem.credits, {
      action: "Runway Video Clip — Refund (save failed)",
      projectId: opts.projectId ?? null,
    });
    logger.info(
      { taskId, userId: opts.userId, refundedCredits: mem.credits },
      "[generated-clips] refund completed (in-memory fallback)",
    );
    return { refunded: true, credits: mem.credits, source: "memory" };
  }

  return { refunded: false, credits: 0, source: null };
}

export interface ClipChargeSweepResult {
  scanned: number;
  delivered: number;
  refunded: number;
  refundFailures: number;
}

/**
 * Resolve every stale 'pending' obligation: a clip that landed gets
 * its bookkeeping completed ('delivered', no refund); a clip that
 * never landed gets its charge refunded exactly once (claim-first).
 * This is the restart recovery: a fresh process reads only the
 * durable store, so obligations survive the restart that used to
 * erase them.
 */
export async function sweepStaleClipCharges(
  depsIn: ClipChargeDeps = {},
): Promise<ClipChargeSweepResult> {
  const { store, refund, staleMs, now } = deps(depsIn);
  const cutoff = new Date(now.getTime() - staleMs);
  const stale = await store.listStalePending(cutoff);

  let delivered = 0;
  let refunded = 0;
  let refundFailures = 0;

  for (const row of stale) {
    try {
      if (await store.hasLandedClip(row.task_id)) {
        if (await store.markDelivered(row.task_id, "swept_delivered")) {
          delivered += 1;
          logger.info(
            { taskId: row.task_id, userId: row.user_id },
            "[generated-clips] sweeper completed delivery bookkeeping for a landed clip — no refund owed",
          );
        }
        continue;
      }
    } catch (err) {
      logger.error(
        { err, taskId: row.task_id },
        "[generated-clips] sweeper delivery check failed — leaving the obligation pending for the next sweep",
      );
      continue;
    }

    const claimed = await store.claimStaleById(row.id, "swept_refunded");
    if (!claimed) continue; /* a racing path resolved it first */
    try {
      await refund(claimed.user_id, claimed.credits, {
        action: "Runway Video Clip — Refund (clip never saved)",
        projectId: claimed.project_id ?? null,
      });
      refunded += 1;
      logger.info(
        { taskId: claimed.task_id, userId: claimed.user_id, refundedCredits: claimed.credits },
        "[generated-clips] sweeper refunded a charge whose clip never landed",
      );
    } catch (err) {
      refundFailures += 1;
      logger.error(
        { err, taskId: claimed.task_id, userId: claimed.user_id, credits: claimed.credits },
        "[generated-clips] CRITICAL: sweeper claimed an obligation but the refund failed — row reads 'refunded', reconcile manually",
      );
    }
  }

  if (stale.length > 0) {
    logger.info(
      { scanned: stale.length, delivered, refunded, refundFailures },
      "[generated-clips] stale clip-charge sweep complete",
    );
  }
  return { scanned: stale.length, delivered, refunded, refundFailures };
}

/* Starts the stale-obligation sweeper: one run shortly after boot
   (the deploy-restart case — obligations orphaned by the previous
   process), then on the configured interval. A sweep that throws is
   logged, never fatal to the server. */
export function startClipChargeSweeper(
  depsIn: ClipChargeDeps = {},
): { stop: () => void } {
  const run = () =>
    sweepStaleClipCharges(depsIn).catch((err) =>
      logger.error({ err }, "[generated-clips] stale clip-charge sweep crashed"),
    );
  const startupTimer = setTimeout(run, SWEEP_STARTUP_DELAY_MS);
  const intervalTimer = setInterval(run, SWEEP_INTERVAL_MS);
  logger.info(
    { intervalMs: SWEEP_INTERVAL_MS, startupDelayMs: SWEEP_STARTUP_DELAY_MS },
    "[generated-clips] stale clip-charge sweeper started",
  );
  return {
    stop: () => {
      clearTimeout(startupTimer);
      clearInterval(intervalTimer);
    },
  };
}
