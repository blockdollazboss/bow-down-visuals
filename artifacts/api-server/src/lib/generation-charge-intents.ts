import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import {
  db as defaultDb,
  generationChargeIntentsTable,
  type GenerationChargeIntentRow,
} from "@workspace/db";
import {
  chargeCredits,
  refundCredits,
  LedgerWriteError,
  OutOfCreditsError,
  CreditsDisabledError,
} from "./credits";
import { logger } from "./logger";

/* Durable submit-time charge intents for poll-charged generations
   (Stack400 Lane 4, charge integrity; migration 0298).

   The defect (payments gate Pass 3, proven live): the Runway-family
   rails — generate-runway-clip, artist-image, intro-outro, logo —
   charge on SUCCEEDED at poll time and kept the obligation ONLY in an
   in-memory Map. This service restarts on every deploy; a restart
   between submit and the success poll lost the entry, and the poll
   delivered the finished generation with no charge and no ledger row.
   runway-clip and artist-image even logged the false claim "SUCCEEDED
   poll after charge already processed" for the missing entry.

   The discipline (the clip_charge_obligations pattern, moved one step
   earlier — from charge time to SUBMIT time):
   1. RECORD — at submit, the rail writes one 'awaiting' intent row
      (task_id UNIQUE) carrying owner, quoted amount, ledger action,
      and rail recovery data (extra). The in-memory map stays as the
      fast path; the row is the source of truth.
   2. SETTLE — at the success poll, the charge resolves from memory or
      from the row, always through chargeCredits with idempotency key
      'gen-charge:<task_id>' (credit_usage carries a UNIQUE partial
      index on the key), so poll and sweeper can race without ever
      double-charging. Success marks the row 'charged'.
   3. DELIVER — delivery is never held hostage to a charge hiccup: if
      the settle throws, the poll still delivers, stamps delivered_at,
      and leaves the row 'awaiting'. The sweeper retries exactly those
      rows (delivered but uncharged) until the charge lands.
   4. RESOLVE — provider failure marks the row 'failed' (no charge is
      ever owed). Intents never delivered within the retention window
      are marked 'expired' for bookkeeping; a late poll can still
      settle an expired row, exactly once, via the same key.

   Crash window, stated honestly: if the process dies between a
   successful charge and markCharged, the row still reads 'awaiting' —
   the sweeper's retry then hits the idempotency key, chargeCredits
   returns the balance WITHOUT charging again, and the row is marked
   'charged'. No double charge, no lost charge.

   ── RESERVE-AT-SUBMIT (stack1400 ruling #43 Part A; migration 0317) ──
   The four intent rails (runway-clip, artist-image, intro-outro, logo)
   reversed to the stack1000 music-rail precedent: the charge lands at
   SUBMIT, before the provider call, through chargeCredits with a
   fresh balance read — the balance itself now paces concurrent
   submits, closing the Owner-Decision-2 concurrency window (a member
   whose balance drained mid-flight could previously receive a success
   whose poll-time charge never landed). The intent row flips role:
   it is the RESERVE RECORD (status 'reserved', charged amount, and
   the charge idempotency key in extra.chargeKey).
     · charge key — 'gen-charge:<taskId>' whenever the task id is ours
       (Veo veo-<uuid>, sync rails' sync-<uuid>); when the provider
       mints the task id (Runway/Seedance), the submit mints a local
       job id first ('job-<uuid>') and charges under
       'gen-charge:<jobId>' BEFORE the provider submission — the
       provider task id keys the intent row as before, and the row's
       extra.chargeKey names the charge.
     · submit — a refused charge (insufficient / disabled / ledger)
       refuses the submit with the rail's existing 402/500 shape and
       the provider is never called.
     · success poll — CONFIRM: 'reserved' → 'charged'. No money moves;
       there is no second charge to suppress.
     · failure / no-output / save failure — REFUND the exact reserve,
       exactly once: the 'reserved' → 'refunded' flip is the claim
       (refundCredits carries no idempotency key, so the row is the
       gate — the clip-charge-obligations discipline). If the refund
       call itself throws after the claim, the claim is released back
       to 'reserved' so a later poll/sweep retries it.
     · provider submission failure AFTER the reserve (the provider
       call throws) — the submit refunds its own reserve immediately
       in-request, so no orphan reserve waits for a poll that will
       never come; a failed refund logs CRITICAL under the job/task
       id, with the charge's ledger row as the reconciliation trail.
     · sweeper — reserve reconciliation, never late-charging a
       reserve: delivered reserves are confirmed, abandoned reserves
       (never delivered past the stale window) are claim-refunded.
   Legacy 'awaiting' rows (submitted before this reversal) keep the
   settle discipline above untouched. */

const GEN_CHARGE_IDEMPOTENCY_PREFIX = "gen-charge:";

export const GEN_CHARGE_RETRY_AFTER_MS =
  Number(process.env["GEN_CHARGE_RETRY_AFTER_MS"]) || 2 * 60 * 1000;
export const GEN_CHARGE_EXPIRE_AFTER_MS =
  Number(process.env["GEN_CHARGE_EXPIRE_AFTER_MS"]) || 24 * 60 * 60 * 1000;
/* A reserve that was never delivered within this window is abandoned:
   the sweeper claim-refunds it in full. Defaults to the retention
   window — provider tasks on these rails resolve in minutes, so a
   full day without a delivery poll means nobody is coming back. */
export const GEN_CHARGE_RESERVE_STALE_MS =
  Number(process.env["GEN_CHARGE_RESERVE_STALE_MS"]) || GEN_CHARGE_EXPIRE_AFTER_MS;
const SWEEP_INTERVAL_MS =
  Number(process.env["GEN_CHARGE_SWEEP_INTERVAL_MS"]) || 10 * 60 * 1000;
const SWEEP_STARTUP_DELAY_MS =
  Number(process.env["GEN_CHARGE_SWEEP_STARTUP_DELAY_MS"]) || 30 * 1000;

export interface GenerationChargeIntentStore {
  /** Insert one intent. task_id is UNIQUE — a duplicate record
      (re-submit race) is a no-op. `status` defaults to the legacy
      'awaiting'; reserve-at-submit records pass 'reserved' (the
      charge already landed — see recordGenerationReserve). */
  recordIntent(input: {
    taskId: string;
    rail: string;
    userId: string;
    credits: number;
    projectId?: string | null;
    action: string;
    extra?: Record<string, unknown> | null;
    status?: "awaiting" | "reserved";
  }): Promise<void>;
  getIntent(taskId: string): Promise<GenerationChargeIntentRow | null>;
  /** Move 'awaiting'|'expired' → 'charged'. Returns true when this call
      moved the row. */
  markCharged(taskId: string): Promise<boolean>;
  /** Move 'awaiting' → 'failed' (provider task failed; no charge owed). */
  markFailed(taskId: string): Promise<boolean>;
  /** Stamp delivered_at (first delivery only). */
  markDelivered(taskId: string): Promise<void>;
  /** Delivered but still uncharged intents whose delivery is older
      than the cutoff — the sweeper's retry set. */
  listDeliveredUncharged(cutoff: Date): Promise<GenerationChargeIntentRow[]>;
  /** Claim undelivered 'awaiting' intents older than the cutoff for
      expiry bookkeeping. Returns the rows it expired. */
  expireUndelivered(cutoff: Date): Promise<GenerationChargeIntentRow[]>;
  /* ── Reserve-at-submit (0317) ── */
  /** Move 'reserved' → 'charged' (success poll confirms the reserve;
      no money moves). Returns true when this call moved the row. */
  confirmReserve(taskId: string): Promise<boolean>;
  /** Atomically claim a reserve for refund: 'reserved' → 'refunded'.
      Returns the claimed row, or null when the row is absent or not
      in 'reserved' — the exactly-once gate for every refund path. */
  claimReserveRefund(taskId: string): Promise<GenerationChargeIntentRow | null>;
  /** Release a refund claim whose refund call threw ('refunded' →
      'reserved') so a later poll or sweep can retry the refund. */
  releaseReserveRefundClaim(taskId: string): Promise<boolean>;
  /** Reserves that were delivered but never confirmed, delivery older
      than the cutoff — the sweeper confirms these (no money moves). */
  listDeliveredReserves(cutoff: Date): Promise<GenerationChargeIntentRow[]>;
  /** Reserves never delivered and older than the cutoff — the
      sweeper's abandoned-reserve refund set. */
  listStaleReserves(cutoff: Date): Promise<GenerationChargeIntentRow[]>;
}

type Db = typeof defaultDb;

function createDrizzleGenerationChargeIntentStore(db: Db = defaultDb): GenerationChargeIntentStore {
  const T = generationChargeIntentsTable;
  return {
    async recordIntent(input) {
      await db
        .insert(T)
        .values({
          task_id: input.taskId,
          rail: input.rail,
          user_id: input.userId,
          credits: input.credits,
          project_id: input.projectId ?? null,
          action: input.action,
          extra: input.extra ?? null,
          status: input.status ?? "awaiting",
        })
        .onConflictDoNothing({ target: T.task_id });
    },

    async getIntent(taskId) {
      const [row] = await db.select().from(T).where(eq(T.task_id, taskId)).limit(1);
      return row ?? null;
    },

    async markCharged(taskId) {
      const rows = await db
        .update(T)
        .set({ status: "charged", resolved_at: new Date() })
        .where(
          and(
            eq(T.task_id, taskId),
            or(eq(T.status, "awaiting"), eq(T.status, "expired")),
          ),
        )
        .returning({ id: T.id });
      return rows.length > 0;
    },

    async markFailed(taskId) {
      const rows = await db
        .update(T)
        .set({ status: "failed", resolved_at: new Date() })
        .where(and(eq(T.task_id, taskId), eq(T.status, "awaiting")))
        .returning({ id: T.id });
      return rows.length > 0;
    },

    async markDelivered(taskId) {
      await db
        .update(T)
        .set({ delivered_at: new Date() })
        .where(and(eq(T.task_id, taskId), isNull(T.delivered_at)));
    },

    async listDeliveredUncharged(cutoff) {
      return db
        .select()
        .from(T)
        .where(
          and(
            or(eq(T.status, "awaiting"), eq(T.status, "expired")),
            isNotNull(T.delivered_at),
            lt(T.delivered_at, cutoff),
          ),
        )
        .orderBy(T.created_at);
    },

    async expireUndelivered(cutoff) {
      return db
        .update(T)
        .set({ status: "expired", resolved_at: new Date() })
        .where(
          and(
            eq(T.status, "awaiting"),
            isNull(T.delivered_at),
            lt(T.created_at, cutoff),
          ),
        )
        .returning();
    },

    async confirmReserve(taskId) {
      const rows = await db
        .update(T)
        .set({ status: "charged", resolved_at: new Date() })
        .where(and(eq(T.task_id, taskId), eq(T.status, "reserved")))
        .returning({ id: T.id });
      return rows.length > 0;
    },

    async claimReserveRefund(taskId) {
      const rows = await db
        .update(T)
        .set({ status: "refunded", resolved_at: new Date() })
        .where(and(eq(T.task_id, taskId), eq(T.status, "reserved")))
        .returning();
      return rows[0] ?? null;
    },

    async releaseReserveRefundClaim(taskId) {
      const rows = await db
        .update(T)
        .set({ status: "reserved", resolved_at: null })
        .where(and(eq(T.task_id, taskId), eq(T.status, "refunded")))
        .returning({ id: T.id });
      return rows.length > 0;
    },

    async listDeliveredReserves(cutoff) {
      return db
        .select()
        .from(T)
        .where(
          and(
            eq(T.status, "reserved"),
            isNotNull(T.delivered_at),
            lt(T.delivered_at, cutoff),
          ),
        )
        .orderBy(T.created_at);
    },

    async listStaleReserves(cutoff) {
      return db
        .select()
        .from(T)
        .where(
          and(
            eq(T.status, "reserved"),
            isNull(T.delivered_at),
            lt(T.created_at, cutoff),
          ),
        )
        .orderBy(T.created_at);
    },
  };
}

/* The shared store instance the rails and the sweeper use. */
export const generationChargeIntentStore = createDrizzleGenerationChargeIntentStore();

/** Record a submit-time intent without ever failing the generation:
    a failed record is logged CRITICAL (the in-memory path still
    covers this task; the gap is visible for reconciliation). */
export async function recordGenerationChargeIntent(
  store: GenerationChargeIntentStore,
  input: Parameters<GenerationChargeIntentStore["recordIntent"]>[0],
): Promise<void> {
  try {
    await store.recordIntent(input);
  } catch (err) {
    logger.error(
      { err, taskId: input.taskId, rail: input.rail, userId: input.userId, credits: input.credits },
      "[gen-charge] CRITICAL: submit-time charge intent record failed — this task's charge is in-memory only",
    );
  }
}

/** Stamp an intent delivered without ever failing the delivery: a
    failed stamp only means the retry sweeper won't see this intent —
    logged CRITICAL so the gap is reconcilable. */
export async function markGenerationIntentDelivered(
  store: GenerationChargeIntentStore,
  taskId: string,
): Promise<void> {
  try {
    await store.markDelivered(taskId);
  } catch (err) {
    logger.error({ err, taskId }, "[gen-charge] CRITICAL: failed to stamp intent delivered — sweeper retry may miss this task");
  }
}

/** Mark an intent failed (provider task failed/cancelled — no charge
    is ever owed). Never throws; bookkeeping only. */
export async function markGenerationIntentFailed(
  store: GenerationChargeIntentStore,
  taskId: string,
): Promise<void> {
  try {
    await store.markFailed(taskId);
  } catch (err) {
    logger.error({ err, taskId }, "[gen-charge] failed to mark intent failed — bookkeeping gap only");
  }
}

/* ── Settle ─────────────────────────────────────────────────────────── */

export interface ResolvedPendingCharge {
  userId: string;
  credits: number;
  projectId: string | null;
  action: string;
  extra: Record<string, unknown> | null;
  /** The durable row's status at resolve time; null when no row exists
      (a task submitted before migration 0298, or a failed record). */
  intentStatus: string | null;
  source: "memory" | "intent";
  /** Reserve-at-submit: true when the charge already landed at submit
      (the row reads 'reserved', or the in-memory entry says so when
      the row's record failed). A reserved resolution CONFIRMS on
      success and REFUNDS on failure — it never charges again. */
  reserved: boolean;
  /** The charge's idempotency key ('gen-charge:<taskOrJobId>'), when
      known — recorded on the reserve row's extra and carried by the
      in-memory entry. Bookkeeping/reconciliation only: the refund
      gate is the row's status flip, not this key. */
  chargeKey: string | null;
}

function chargeKeyOf(extra: Record<string, unknown> | null | undefined): string | null {
  const k = extra?.["chargeKey"];
  return typeof k === "string" && k.length > 0 ? k : null;
}

/** What a rail's poll handler charges from: its in-memory pending entry
    when present (the fast path), otherwise the durable intent row.
    Returns null when neither exists — the caller must then treat the
    delivery as unchargeable and say so loudly (never silently assume
    a charge already happened). A 'failed' intent resolves to null:
    the provider task failed, no charge is owed. */
export async function resolvePendingCharge(
  store: GenerationChargeIntentStore,
  taskId: string,
  memory: {
    userId: string;
    credits: number;
    projectId?: string | null;
    action: string;
    extra?: Record<string, unknown> | null;
    reserved?: boolean;
    chargeKey?: string | null;
  } | null,
): Promise<ResolvedPendingCharge | null> {
  let intent: GenerationChargeIntentRow | null = null;
  try {
    intent = await store.getIntent(taskId);
  } catch (err) {
    logger.error({ err, taskId }, "[gen-charge] intent lookup failed — falling back to the in-memory entry only");
  }
  if (intent?.status === "failed") return null;
  if (memory) {
    return {
      userId: memory.userId,
      credits: memory.credits,
      projectId: memory.projectId ?? null,
      action: memory.action,
      extra: memory.extra ?? null,
      intentStatus: intent?.status ?? null,
      source: "memory",
      reserved: intent?.status === "reserved" || intent?.status === "refunded"
        ? true
        : (memory.reserved ?? false),
      chargeKey: chargeKeyOf(intent?.extra) ?? memory.chargeKey ?? chargeKeyOf(memory.extra),
    };
  }
  if (intent) {
    return {
      userId: intent.user_id,
      credits: intent.credits,
      projectId: intent.project_id ?? null,
      action: intent.action,
      extra: intent.extra ?? null,
      intentStatus: intent.status,
      source: "intent",
      reserved: intent.status === "reserved" || intent.status === "refunded",
      chargeKey: chargeKeyOf(intent.extra),
    };
  }
  return null;
}

export type ChargeFn = (
  userId: string,
  credits: number,
  record: { action: string; projectId: string | null },
  opts: { idempotencyKey: string; rollbackOnLedgerFailure: boolean },
) => Promise<number>;

const defaultChargeFn: ChargeFn = (userId, credits, record, opts) =>
  chargeCredits(userId, credits, record, opts);

export type SettleOutcome = "charged" | "charged_unledgered" | "already" | "charge_failed";

/** Charge a resolved pending charge exactly once and mark the intent.
    Never throws. Outcomes:
      charged            — deduction + ledger row landed.
      charged_unledgered — the deduction STANDS but the ledger write
                           failed (chargeCredits' LedgerWriteError with
                           rollback disabled). The money moved exactly
                           once, so the intent is marked charged — the
                           sweeper must NEVER retry this (a retry would
                           double-charge: the idempotency lookup finds
                           no row to suppress it). The missing row is
                           the pre-existing CRITICAL manual-reconcile
                           path inside chargeCredits.
      already            — a previous settle landed this charge.
      charge_failed      — the deduction did NOT land (insufficient
                           balance, profile/store error). The intent
                           stays 'awaiting'; after delivery the sweeper
                           retries — safe, because nothing was taken. */
export async function settleGenerationCharge(
  store: GenerationChargeIntentStore,
  taskId: string,
  resolved: ResolvedPendingCharge,
  chargeFn: ChargeFn = defaultChargeFn,
): Promise<SettleOutcome> {
  if (resolved.intentStatus === "charged") return "already";
  let unledgered = false;
  try {
    await chargeFn(resolved.userId, resolved.credits, {
      action: resolved.action,
      projectId: resolved.projectId,
    }, {
      idempotencyKey: `${GEN_CHARGE_IDEMPOTENCY_PREFIX}${taskId}`,
      /* The generation is being (or has been) delivered — on ledger
         failure the deduction stands and chargeCredits logs CRITICAL;
         the intent retry below reconciles the row state. */
      rollbackOnLedgerFailure: false,
    });
  } catch (err) {
    if (err instanceof LedgerWriteError) {
      unledgered = true;
      logger.error(
        { err, taskId, userId: resolved.userId, credits: resolved.credits, action: resolved.action },
        "[gen-charge] CRITICAL: deduction stands but the ledger row is missing — marking intent charged so no retry can double-charge; row gap is manual-reconcile",
      );
    } else {
      logger.error(
        { err, taskId, userId: resolved.userId, credits: resolved.credits, action: resolved.action },
        "[gen-charge] CRITICAL: charge failed at settle — delivery proceeds, intent stays awaiting for the retry sweeper",
      );
      return "charge_failed";
    }
  }
  try {
    await store.markCharged(taskId);
  } catch (err) {
    /* The charge landed (idempotency-keyed); a lost mark only means the
       sweeper retries later and chargeCredits suppresses the replay. */
    logger.error({ err, taskId }, "[gen-charge] CRITICAL: charge landed but markCharged failed — sweeper will reconcile via the idempotency key");
  }
  return unledgered ? "charged_unledgered" : "charged";
}

/* ── Reserve-at-submit (0317) ─────────────────────────────────────── */

export type RefundFn = (
  userId: string,
  credits: number,
  record: { action: string; projectId: string | null },
) => Promise<void>;

const defaultRefundFn: RefundFn = (userId, credits, record) =>
  refundCredits(userId, credits, record);

export function generationChargeKey(taskOrJobId: string): string {
  return `${GEN_CHARGE_IDEMPOTENCY_PREFIX}${taskOrJobId}`;
}

export type ReserveOutcome =
  | { ok: true; balance: number }
  | { ok: false; reason: "insufficient" | "disabled" | "ledger" | "error"; err: unknown };

/** Charge the reserve at submit, BEFORE the provider call. Goes
    through chargeCredits only (fresh balance read — the balance is
    the pace), keyed by the caller-minted task/job id. The value is
    NOT delivered yet, so a ledger failure rolls the deduction back
    (rollbackOnLedgerFailure: true): a LedgerWriteError here means
    nothing was taken and the submit is refused, exactly like an
    insufficient balance. Never throws — the rail maps the outcome
    onto its existing 402/403/500 response shapes. */
export async function chargeGenerationReserve(
  input: {
    userId: string;
    credits: number;
    projectId?: string | null;
    action: string;
    chargeKey: string;
  },
  chargeFn: ChargeFn = defaultChargeFn,
): Promise<ReserveOutcome> {
  try {
    const balance = await chargeFn(input.userId, input.credits, {
      action: input.action,
      projectId: input.projectId ?? null,
    }, {
      idempotencyKey: input.chargeKey,
      rollbackOnLedgerFailure: true,
    });
    return { ok: true, balance };
  } catch (err) {
    /* instanceof against the real classes, with a name fallback so a
       partially-mocked credits module in a test can never turn the
       mapping itself into a TypeError. */
    const errName = (err as { name?: unknown } | null)?.name;
    if ((typeof OutOfCreditsError === "function" && err instanceof OutOfCreditsError) || errName === "OutOfCreditsError") {
      return { ok: false, reason: "insufficient", err };
    }
    if ((typeof CreditsDisabledError === "function" && err instanceof CreditsDisabledError) || errName === "CreditsDisabledError") {
      return { ok: false, reason: "disabled", err };
    }
    if ((typeof LedgerWriteError === "function" && err instanceof LedgerWriteError) || errName === "LedgerWriteError") {
      return { ok: false, reason: "ledger", err };
    }
    return { ok: false, reason: "error", err };
  }
}

/** Record the reserve row after the charge landed (and, for
    provider-minted task ids, after the provider submission returned
    the id). Never throws: a failed record is logged CRITICAL — the
    in-memory entry still carries the reserve for this process, and
    the charge's ledger row (under chargeKey) is the reconciliation
    trail. The charge key rides extra.chargeKey. */
export async function recordGenerationReserve(
  store: GenerationChargeIntentStore,
  input: Parameters<GenerationChargeIntentStore["recordIntent"]>[0] & { chargeKey: string },
): Promise<void> {
  const { chargeKey, ...rest } = input;
  try {
    await store.recordIntent({
      ...rest,
      status: "reserved",
      extra: { ...(rest.extra ?? {}), chargeKey },
    });
  } catch (err) {
    logger.error(
      { err, taskId: input.taskId, rail: input.rail, userId: input.userId, credits: input.credits, chargeKey },
      "[gen-charge] CRITICAL: reserve record failed after the submit charge landed — this task's reserve is in-memory only; reconcile via the charge ledger key",
    );
  }
}

export type ConfirmOutcome = "confirmed" | "already" | "refunded" | "not_reserved";

/** Confirm a reserve on success: the money stays, NO second charge.
    'already' = a previous poll/sweep confirmed it. 'refunded' = the
    reserve was already returned (a failure path resolved first) —
    the caller delivers but must not treat it as paid. Returns
    'not_reserved' for legacy resolutions so the caller falls back to
    settleGenerationCharge. Never throws. */
export async function confirmGenerationReserve(
  store: GenerationChargeIntentStore,
  taskId: string,
  resolved: ResolvedPendingCharge,
): Promise<ConfirmOutcome> {
  if (resolved.intentStatus === "charged") return "already";
  if (resolved.intentStatus === "refunded") return "refunded";
  if (resolved.intentStatus === "reserved") {
    try {
      const moved = await store.confirmReserve(taskId);
      return moved ? "confirmed" : "already";
    } catch (err) {
      /* The reserve stays 'reserved'; the sweeper confirms delivered
         reserves later. Delivery is never hostage to this flip. */
      logger.error({ err, taskId }, "[gen-charge] CRITICAL: reserve confirm failed — sweeper will confirm the delivered reserve");
      return "confirmed";
    }
  }
  if (resolved.intentStatus === null && resolved.reserved && resolved.source === "memory") {
    /* Memory-only reserve (the durable record failed at submit): the
       caller's map entry is the record; consuming it confirms. */
    return "confirmed";
  }
  return "not_reserved";
}

export type ReserveRefundOutcome = "refunded" | "already" | "not_reserved" | "refund_failed";

/** Refund a reserve in full, exactly once. The claim is the row flip
    'reserved' → 'refunded': only the claim winner calls refundFn.
    The refund action follows the house convention
    "<charge action> — Refund (<reason>)" so refundCredits' pool
    pairing finds the charge it reverses. If refundFn throws after
    the claim, the claim is released back to 'reserved' so a later
    poll or the sweeper retries (refundCredits restores the balance
    before its ledger write and only swallows ledger failures, so a
    throw means the restore itself did not complete). For a
    memory-only reserve (no durable row), the caller must consume
    its map entry around this call — that consumption is its claim.
    Never throws. */
export async function refundGenerationReserve(
  store: GenerationChargeIntentStore,
  taskId: string,
  resolved: ResolvedPendingCharge,
  reason: string,
  refundFn: RefundFn = defaultRefundFn,
): Promise<ReserveRefundOutcome> {
  if (resolved.intentStatus === "refunded") return "already";
  if (resolved.intentStatus === "charged") {
    logger.error(
      { taskId, userId: resolved.userId, credits: resolved.credits },
      "[gen-charge] CRITICAL: refund requested for a CONFIRMED reserve — refusing (a confirmed generation was delivered; reconcile manually)",
    );
    return "already";
  }
  const refundRecord = {
    action: `${resolved.action} — Refund (${reason})`,
    projectId: resolved.projectId,
  };
  if (resolved.intentStatus === "reserved") {
    let claimed: GenerationChargeIntentRow | null = null;
    try {
      claimed = await store.claimReserveRefund(taskId);
    } catch (err) {
      logger.error({ err, taskId }, "[gen-charge] CRITICAL: reserve refund claim failed — reserve stays reserved for the sweeper");
      return "refund_failed";
    }
    if (!claimed) return "already"; /* a racing path claimed it first */
    try {
      await refundFn(claimed.user_id, claimed.credits, {
        action: `${claimed.action} — Refund (${reason})`,
        projectId: claimed.project_id ?? null,
      });
      return "refunded";
    } catch (err) {
      logger.error(
        { err, taskId, userId: claimed.user_id, credits: claimed.credits },
        "[gen-charge] CRITICAL: reserve refund failed after claim — releasing the claim so a later poll/sweep retries",
      );
      try {
        await store.releaseReserveRefundClaim(taskId);
      } catch (releaseErr) {
        logger.error({ err: releaseErr, taskId }, "[gen-charge] CRITICAL: failed to release a failed refund claim — row reads 'refunded' without a refund; reconcile manually");
      }
      return "refund_failed";
    }
  }
  if (resolved.intentStatus === null && resolved.reserved && resolved.source === "memory") {
    try {
      await refundFn(resolved.userId, resolved.credits, refundRecord);
      return "refunded";
    } catch (err) {
      logger.error({ err, taskId, userId: resolved.userId, credits: resolved.credits }, "[gen-charge] CRITICAL: memory-only reserve refund failed");
      return "refund_failed";
    }
  }
  return "not_reserved";
}

/** Bookkeeping for a task that will never be polled with a reserve
    held (provider submission failed after the reserve, or a sync
    rail's provider call failed in-request): refund via the reserve
    machinery when a row exists, else mark a legacy intent failed.
    Never throws. */
export async function refundOrFailGenerationIntent(
  store: GenerationChargeIntentStore,
  taskId: string,
  resolved: ResolvedPendingCharge,
  reason: string,
  refundFn: RefundFn = defaultRefundFn,
): Promise<ReserveRefundOutcome | "failed_bookkeeping"> {
  if (resolved.reserved) {
    return refundGenerationReserve(store, taskId, resolved, reason, refundFn);
  }
  await markGenerationIntentFailed(store, taskId);
  return "failed_bookkeeping";
}

/* ── Sweeper ────────────────────────────────────────────────────────── */

interface GenerationChargeSweepDeps {
  store?: GenerationChargeIntentStore;
  chargeFn?: ChargeFn;
  refundFn?: RefundFn;
  now?: () => number;
}

export interface GenerationChargeSweepResult {
  retried: number;
  charged: number;
  stillFailing: number;
  expired: number;
  reservesConfirmed: number;
  reservesRefunded: number;
  reserveRefundFailures: number;
}

/** One sweep:
    LEGACY — retry charges for generations that were DELIVERED but
    never charged (a poll-time charge failure, or a crash between the
    charge and its bookkeeping), then expire intents that were never
    delivered inside the retention window (no charge is owed on those —
    expiry is bookkeeping so the table stays honest).
    RESERVES (0317) — reconciliation only, never a late charge:
    delivered-but-unconfirmed reserves are confirmed (no money moves —
    a success poll's confirm flip was lost), and abandoned reserves
    (never delivered past the stale window) are claim-refunded in
    full, exactly once. */
export async function sweepGenerationChargeIntents(
  depsIn: GenerationChargeSweepDeps = {},
): Promise<GenerationChargeSweepResult> {
  const store = depsIn.store ?? generationChargeIntentStore;
  const chargeFn = depsIn.chargeFn ?? defaultChargeFn;
  const refundFn = depsIn.refundFn ?? defaultRefundFn;
  const now = depsIn.now ? depsIn.now() : Date.now();

  let charged = 0;
  let stillFailing = 0;
  const retryCutoff = new Date(now - GEN_CHARGE_RETRY_AFTER_MS);
  const retrySet = await store.listDeliveredUncharged(retryCutoff);
  for (const row of retrySet) {
    const outcome = await settleGenerationCharge(store, row.task_id, {
      userId: row.user_id,
      credits: row.credits,
      projectId: row.project_id ?? null,
      action: row.action,
      extra: row.extra ?? null,
      intentStatus: row.status,
      source: "intent",
      reserved: false,
      chargeKey: chargeKeyOf(row.extra),
    }, chargeFn);
    if (outcome === "charged" || outcome === "charged_unledgered" || outcome === "already") {
      charged += 1;
      logger.info(
        { taskId: row.task_id, userId: row.user_id, credits: row.credits },
        "[gen-charge] sweeper settled a delivered-but-uncharged generation",
      );
    } else {
      stillFailing += 1;
    }
  }

  /* Reserves delivered but never confirmed — confirm, no money moves. */
  let reservesConfirmed = 0;
  const deliveredReserves = await store.listDeliveredReserves(retryCutoff);
  for (const row of deliveredReserves) {
    try {
      if (await store.confirmReserve(row.task_id)) {
        reservesConfirmed += 1;
        logger.info(
          { taskId: row.task_id, userId: row.user_id, credits: row.credits },
          "[gen-charge] sweeper confirmed a delivered reserve",
        );
      }
    } catch (err) {
      logger.error({ err, taskId: row.task_id }, "[gen-charge] sweeper reserve confirm failed — will retry next sweep");
    }
  }

  /* Abandoned reserves — claim + refund in full, exactly once. */
  let reservesRefunded = 0;
  let reserveRefundFailures = 0;
  const staleCutoff = new Date(now - GEN_CHARGE_RESERVE_STALE_MS);
  const staleReserves = await store.listStaleReserves(staleCutoff);
  for (const row of staleReserves) {
    const outcome = await refundGenerationReserve(store, row.task_id, {
      userId: row.user_id,
      credits: row.credits,
      projectId: row.project_id ?? null,
      action: row.action,
      extra: row.extra ?? null,
      intentStatus: row.status,
      source: "intent",
      reserved: true,
      chargeKey: chargeKeyOf(row.extra),
    }, "abandoned — never delivered", refundFn);
    if (outcome === "refunded") {
      reservesRefunded += 1;
      logger.info(
        { taskId: row.task_id, userId: row.user_id, credits: row.credits },
        "[gen-charge] sweeper refunded an abandoned reserve",
      );
    } else if (outcome === "refund_failed") {
      reserveRefundFailures += 1;
    }
  }

  const expireCutoff = new Date(now - GEN_CHARGE_EXPIRE_AFTER_MS);
  const expiredRows = await store.expireUndelivered(expireCutoff);
  if (expiredRows.length > 0) {
    logger.warn(
      { count: expiredRows.length, taskIds: expiredRows.map((r) => r.task_id) },
      "[gen-charge] expired submit intents never delivered through a poll — no charge owed; rows kept for audit",
    );
  }

  if (retrySet.length > 0 || expiredRows.length > 0 || deliveredReserves.length > 0 || staleReserves.length > 0) {
    logger.info(
      { retried: retrySet.length, charged, stillFailing, expired: expiredRows.length, reservesConfirmed, reservesRefunded, reserveRefundFailures },
      "[gen-charge] intent sweep complete",
    );
  }
  return {
    retried: retrySet.length,
    charged,
    stillFailing,
    expired: expiredRows.length,
    reservesConfirmed,
    reservesRefunded,
    reserveRefundFailures,
  };
}

/* Starts the intent sweeper: one run shortly after boot (the
   deploy-restart case — charges orphaned by the previous process),
   then on the configured interval. A crashing sweep is logged, never
   fatal to the server. */
export function startGenerationChargeSweeper(
  depsIn: GenerationChargeSweepDeps = {},
): { stop: () => void } {
  const run = () =>
    sweepGenerationChargeIntents(depsIn).catch((err) =>
      logger.error({ err }, "[gen-charge] intent sweep crashed"),
    );
  const startupTimer = setTimeout(run, SWEEP_STARTUP_DELAY_MS);
  const intervalTimer = setInterval(run, SWEEP_INTERVAL_MS);
  logger.info(
    { intervalMs: SWEEP_INTERVAL_MS, startupDelayMs: SWEEP_STARTUP_DELAY_MS },
    "[gen-charge] intent sweeper started",
  );
  return {
    stop: () => {
      clearTimeout(startupTimer);
      clearInterval(intervalTimer);
    },
  };
}
