import { and, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import {
  db as defaultDb,
  generationChargeIntentsTable,
  type GenerationChargeIntentRow,
} from "@workspace/db";
import { chargeCredits } from "./credits";
import { logger } from "./logger";

/* Durable submit-time charge intents for poll-charged generations
   (Stack400 Lane 4, charge integrity; migration 0297).

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
   'charged'. No double charge, no lost charge. */

export const GEN_CHARGE_IDEMPOTENCY_PREFIX = "gen-charge:";

export const GEN_CHARGE_RETRY_AFTER_MS =
  Number(process.env["GEN_CHARGE_RETRY_AFTER_MS"]) || 2 * 60 * 1000;
export const GEN_CHARGE_EXPIRE_AFTER_MS =
  Number(process.env["GEN_CHARGE_EXPIRE_AFTER_MS"]) || 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS =
  Number(process.env["GEN_CHARGE_SWEEP_INTERVAL_MS"]) || 10 * 60 * 1000;
const SWEEP_STARTUP_DELAY_MS =
  Number(process.env["GEN_CHARGE_SWEEP_STARTUP_DELAY_MS"]) || 30 * 1000;

export interface GenerationChargeIntentStore {
  /** Insert one 'awaiting' intent. task_id is UNIQUE — a duplicate
      record (re-submit race) is a no-op. */
  recordIntent(input: {
    taskId: string;
    rail: string;
    userId: string;
    credits: number;
    projectId?: string | null;
    action: string;
    extra?: Record<string, unknown> | null;
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
}

type Db = typeof defaultDb;

export function createDrizzleGenerationChargeIntentStore(db: Db = defaultDb): GenerationChargeIntentStore {
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
          status: "awaiting",
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

/* ── Settle ─────────────────────────────────────────────────────────── */

export interface ResolvedPendingCharge {
  userId: string;
  credits: number;
  projectId: string | null;
  action: string;
  extra: Record<string, unknown> | null;
  /** The durable row's status at resolve time; null when no row exists
      (a task submitted before migration 0297, or a failed record). */
  intentStatus: string | null;
  source: "memory" | "intent";
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

export type SettleOutcome = "charged" | "already" | "charge_failed";

/** Charge a resolved pending charge exactly once and mark the intent.
    Never throws: a failed charge leaves the intent 'awaiting' (the
    sweeper retries after delivery) and reports 'charge_failed' so the
    caller delivers + stamps delivered_at instead of losing the money
    OR the generation. */
export async function settleGenerationCharge(
  store: GenerationChargeIntentStore,
  taskId: string,
  resolved: ResolvedPendingCharge,
  chargeFn: ChargeFn = defaultChargeFn,
): Promise<SettleOutcome> {
  if (resolved.intentStatus === "charged") return "already";
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
    logger.error(
      { err, taskId, userId: resolved.userId, credits: resolved.credits, action: resolved.action },
      "[gen-charge] CRITICAL: charge failed at settle — delivery proceeds, intent stays awaiting for the retry sweeper",
    );
    return "charge_failed";
  }
  try {
    await store.markCharged(taskId);
  } catch (err) {
    /* The charge landed (idempotency-keyed); a lost mark only means the
       sweeper retries later and chargeCredits suppresses the replay. */
    logger.error({ err, taskId }, "[gen-charge] CRITICAL: charge landed but markCharged failed — sweeper will reconcile via the idempotency key");
  }
  return "charged";
}

/* ── Sweeper ────────────────────────────────────────────────────────── */

export interface GenerationChargeSweepDeps {
  store?: GenerationChargeIntentStore;
  chargeFn?: ChargeFn;
  now?: () => number;
}

/** One sweep: retry charges for generations that were DELIVERED but
    never charged (a poll-time charge failure, or a crash between the
    charge and its bookkeeping), then expire intents that were never
    delivered inside the retention window (no charge is owed on those —
    expiry is bookkeeping so the table stays honest). */
export async function sweepGenerationChargeIntents(
  depsIn: GenerationChargeSweepDeps = {},
): Promise<{ retried: number; charged: number; stillFailing: number; expired: number }> {
  const store = depsIn.store ?? generationChargeIntentStore;
  const chargeFn = depsIn.chargeFn ?? defaultChargeFn;
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
    }, chargeFn);
    if (outcome === "charged" || outcome === "already") {
      charged += 1;
      logger.info(
        { taskId: row.task_id, userId: row.user_id, credits: row.credits },
        "[gen-charge] sweeper settled a delivered-but-uncharged generation",
      );
    } else {
      stillFailing += 1;
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

  if (retrySet.length > 0 || expiredRows.length > 0) {
    logger.info(
      { retried: retrySet.length, charged, stillFailing, expired: expiredRows.length },
      "[gen-charge] intent sweep complete",
    );
  }
  return { retried: retrySet.length, charged, stillFailing, expired: expiredRows.length };
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
