/**
 * Stage shoutouts in the World (Ring 3, item 3.3 remainder) — a fan
 * in the room buys a shoutout from the member holding the stage:
 * their message is called out on stage, witnessed by the room.
 * UPGRADE-PROGRAM.md item 3.3: "tip and shout out the performer
 * from your seat during a stage show, in Visual Bucs, without
 * leaving the hall."
 *
 * THE RAIL IS THE SITE'S SHOUTOUT RAIL (routes/generate/shoutouts),
 * not a new one:
 *   - PRICE SOURCE: the performer's OWN shoutout_settings row —
 *     the same row the 2D purchase flow sells from. The World
 *     charges that price in Visual Bucs at face value (the number
 *     the performer set is the number of Bucs the fan pays — the
 *     rail stores one price figure per creator; no conversion
 *     exists anywhere on the rail, so none is invented here).
 *     A creator with no settings row, or with accepting off, does
 *     not offer shoutouts — refused BEFORE any money moves.
 *   - SPLIT: the rail's flat platform fee (owner ruling
 *     2026-10-27: "shoutouts fee FLAT 5% everywhere"), read from
 *     the same env the rail reads, and the net computed with the
 *     rail's own rounding shape. The performer is credited the
 *     NET; the fee stays with the house. (Stage TIPS beside this
 *     move 100% to the performer — a tip is a gift; a shoutout is
 *     a purchase, and purchases carry the rail's fee.)
 *   - SETTLEMENT: the stage-tip discipline (lib/world-stage-tips),
 *     step for step: charge the fan the gross up front → write
 *     the ledger row → credit the performer once. Exactly-once
 *     per attempt: the debit, the row, and the performer's credit
 *     record all derive from one scoped idempotency key minted
 *     from the room's per-frame attempt key, so a replayed frame
 *     (or a retried socket write) can never double-charge,
 *     double-row, or double-credit. Failures unwind the way the
 *     tips do: a row failure after the debit refunds in full and
 *     voids the key; a credit failure reverses any landed credit,
 *     refunds (fresh attempts), drops the row, voids the key.
 *   - A price of 0 is the performer's free shoutout: no debit, no
 *     credit, the row still lands (0/0/0) so the moment is on the
 *     record, and the room still witnesses it.
 *
 * The room (lib/world-room.ts) owns the moment's gates — members
 * only, a held stage, never your own stage, the message within
 * the room's say bound, one purchase per pace window. This module
 * owns the purchase.
 */
import { eq } from "drizzle-orm";
import {
  db,
  worldStageShoutoutsTable,
  shoutoutSettingsTable,
  creditUsageTable,
  creatorProfilesTable,
} from "@workspace/db";
import { logger } from "./logger";
import {
  buildChargeIdempotencyKey,
  voidChargeIdempotencyKey,
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
  CreditsDisabledError,
} from "./credits";
import { addCreditsAtomic } from "./supabase-admin";
import { recordCreditUsageStrict } from "./payment-record";
import { notifyUserEvent, type UserEventInput } from "./push-events";

/** The stage-shoutout platform fee — the SITE RAIL's fee: same
 *  env var, same default (routes/generate/shoutouts.ts exports
 *  SHOUTOUT_PLATFORM_FEE_PCT from this exact expression; the test
 *  suite pins the two equal so the World can never drift off the
 *  rail's split). */
export const STAGE_SHOUTOUT_PLATFORM_FEE_PCT = (() => {
  const n = Number(process.env["SHOUTOUT_PLATFORM_FEE_PCT"]);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.floor(n) : 5;
})();

/** Gross → the split, with the rail's rounding (net is rounded,
 *  the fee keeps the remainder — fee + net always equals gross). */
export function stageShoutoutSplit(amountVb: number): { feeVb: number; netVb: number } {
  const netVb = Math.round((amountVb * (100 - STAGE_SHOUTOUT_PLATFORM_FEE_PCT)) / 100);
  return { feeVb: amountVb - netVb, netVb };
}

export type StageShoutoutResult =
  | { ok: true; amountVb: number }
  | { ok: false; reason: "not-offered" | "insufficient" | "disabled" | "error" };

export interface StageShoutoutRow {
  id: string;
  fromUserId: string;
  toUserId: string;
  amountVb: number;
  feeVb: number;
  netVb: number;
  message: string;
  roomId: string;
  idempotencyKey: string;
  creatorCreditedAt: Date | null;
}

/** The performer's shoutout offer, read off the rail's own
 *  settings row (snake_case is the rail table's shape). */
export interface ShoutoutOffer {
  price_cents: number;
  accepting: string;
}

/** The store seam — the db implementation below is the default;
 *  tests drive the purchase with a fake. Method-for-method the
 *  stage-tip store's shape, plus the offer read. */
export interface StageShoutoutStore {
  findOffer(toUserId: string): Promise<ShoutoutOffer | null>;
  findByIdempotencyKey(key: string): Promise<StageShoutoutRow | null>;
  insert(row: Omit<StageShoutoutRow, "id" | "creatorCreditedAt">): Promise<StageShoutoutRow>;
  creditAlreadyRecorded(creditKey: string): Promise<boolean>;
  markCredited(id: string): Promise<void>;
  deleteById(id: string): Promise<void>;
}

const dbStageShoutoutStore: StageShoutoutStore = {
  async findOffer(toUserId) {
    const rows = await db
      .select({
        price_cents: shoutoutSettingsTable.price_cents,
        accepting: shoutoutSettingsTable.accepting,
      })
      .from(shoutoutSettingsTable)
      .where(eq(shoutoutSettingsTable.user_id, toUserId))
      .limit(1);
    return rows[0] ?? null;
  },
  async findByIdempotencyKey(key) {
    const rows = await db
      .select()
      .from(worldStageShoutoutsTable)
      .where(eq(worldStageShoutoutsTable.idempotencyKey, key))
      .limit(1);
    return rows[0] ?? null;
  },
  async insert(row) {
    const rows = await db.insert(worldStageShoutoutsTable).values(row).returning();
    const inserted = rows[0];
    if (!inserted) throw new Error("stage shoutout insert returned no row");
    return inserted;
  },
  async creditAlreadyRecorded(creditKey) {
    const rows = await db
      .select({ id: creditUsageTable.id })
      .from(creditUsageTable)
      .where(eq(creditUsageTable.idempotencyKey, creditKey))
      .limit(1)
      .catch(() => [] as Array<{ id: string }>);
    return !!rows[0];
  },
  async markCredited(id) {
    await db
      .update(worldStageShoutoutsTable)
      .set({ creatorCreditedAt: new Date() })
      .where(eq(worldStageShoutoutsTable.id, id));
  },
  async deleteById(id) {
    await db.delete(worldStageShoutoutsTable).where(eq(worldStageShoutoutsTable.id, id));
  },
};

/* ── The performer tell ───────────────────────────────────────────
 * Push wiring's seam, the stage-tip shape: when a shoutout lands
 * the performer hears about it (bell + device push) — they are
 * being paid to call the message out, and "someone paid, nobody
 * told the performer" is the failure this closes. The notifier is
 * replaceable in tests; production resolves the buyer's display
 * name the way the tip rail does and fires through user-events.
 * The stream-overlay alert is deliberately NOT emitted here: the
 * overlay alert kinds are a closed FE-rendered union ("tip" is
 * its own kind with its own presentation) — a shoutout is not a
 * tip, and mislabelling it as one on the performer's overlay
 * would be a false label, so the overlay stays tip-only until it
 * grows a shoutout kind of its own. */
export type StageShoutoutEventNotifier = (event: UserEventInput) => void | Promise<void>;

let _stageShoutoutEventNotifier: StageShoutoutEventNotifier = async (event) => {
  await notifyUserEvent(event);
};

/** Test seam: replace (or clear, with null) the performer notifier. */
export function __setStageShoutoutEventNotifier(notifier: StageShoutoutEventNotifier | null): void {
  _stageShoutoutEventNotifier =
    notifier ??
    (async (event) => {
      await notifyUserEvent(event);
    });
}

/** Pure builder (exported for tests): the performer's tell for one
 *  landed stage shoutout. */
export function buildStageShoutoutEvent(input: {
  toUserId: string;
  fromName: string;
  netVb: number;
  message: string;
}): UserEventInput {
  return {
    userId: input.toUserId,
    kind: "stage_shoutout",
    category: "money",
    title: "New stage shoutout",
    body:
      input.netVb > 0
        ? `${input.fromName} bought a stage shoutout — ${input.netVb.toLocaleString("en-US")} Visual Bucs landed in your balance. Their message: “${input.message}”`
        : `${input.fromName} took your free shoutout on stage. Their message: “${input.message}”`,
    link: "/world",
  };
}

/** The money seams — production defaults ride the same credit
 *  rails the stage tips use; tests inject fakes to drive the
 *  failure paths. */
export interface StageShoutoutDeps {
  store?: StageShoutoutStore;
  charge?: (input: {
    userId: string;
    amount: number;
    reason: string;
    idempotencyKey: string;
  }) => Promise<void>;
  creditPerformer?: (userId: string, amountVb: number) => Promise<void>;
  recordCredit?: (userId: string, amountVb: number, creditKey: string) => Promise<void>;
  reverseCredit?: (userId: string, amountVb: number) => Promise<void>;
  refund?: (userId: string, amountVb: number, action: string) => Promise<void>;
  voidKey?: (key: string) => Promise<void> | void;
  /** Resolve the buyer's display name for the performer's tell. */
  resolveDisplayName?: (userId: string) => Promise<string>;
}

const defaultCharge: NonNullable<StageShoutoutDeps["charge"]> = async ({
  userId,
  amount,
  reason,
  idempotencyKey,
}) => {
  await chargeCredits(userId, amount, { action: reason }, { personalOnly: true, idempotencyKey });
};

/**
 * Build the room's shoutouter. `attemptKey` is a fresh random key
 * per attempt (the room mints it): the scoped charge key derived
 * from it makes the debit, the ledger row and the performer's
 * credit entry all name the same purchase.
 */
export function createStageShoutouter(deps: StageShoutoutDeps = {}) {
  const store = deps.store ?? dbStageShoutoutStore;
  const charge = deps.charge ?? defaultCharge;
  const creditPerformer =
    deps.creditPerformer ??
    (async (userId: string, amountVb: number) => {
      await addCreditsAtomic(userId, amountVb);
    });
  const recordCredit =
    deps.recordCredit ??
    (async (userId: string, amountVb: number, creditKey: string) => {
      await recordCreditUsageStrict({
        userId,
        action: "World Stage Shoutout — Received",
        creditsUsed: -amountVb,
        idempotencyKey: creditKey,
      });
    });
  const reverseCredit =
    deps.reverseCredit ??
    (async (userId: string, amountVb: number) => {
      await addCreditsAtomic(userId, -amountVb);
    });
  const refund =
    deps.refund ??
    (async (userId: string, amountVb: number, action: string) => {
      await refundCredits(userId, amountVb, { action });
    });
  const voidKey = deps.voidKey ?? voidChargeIdempotencyKey;
  const resolveDisplayName =
    deps.resolveDisplayName ??
    (async (userId: string) => {
      const rows = await db
        .select({ displayName: creatorProfilesTable.displayName })
        .from(creatorProfilesTable)
        .where(eq(creatorProfilesTable.userId, userId))
        .limit(1);
      return rows[0]?.displayName ?? "Someone";
    });

  return async function shoutOutStagePerformer(input: {
    fromUserId: string;
    toUserId: string;
    message: string;
    roomId: string;
    attemptKey: string;
  }): Promise<StageShoutoutResult> {
    const { fromUserId, toUserId, message, roomId } = input;
    const key = buildChargeIdempotencyKey("stage-shoutout", fromUserId, input.attemptKey, {
      roomId,
      toUserId,
      message,
    });
    try {
      /* Resume gate: a row for this key means a previous attempt
       * already debited (chargeCredits dedupes the debit too) —
       * complete what's missing, never charge again. */
      let row = await store.findByIdempotencyKey(key);
      const isRetry = !!row;

      if (!row) {
        /* 0) The offer — BEFORE any charge attempt. No settings
         * row, or not accepting, means this performer does not
         * sell shoutouts; a fan is never charged toward a
         * shoutout the performer isn't offering. */
        const offer = await store.findOffer(toUserId);
        if (!offer || offer.accepting !== "true") {
          return { ok: false, reason: "not-offered" };
        }
        const amountVb = offer.price_cents;
        const { feeVb, netVb } = stageShoutoutSplit(amountVb);

        /* 1) Debit the fan the gross (a free shoutout skips the
         * rail entirely — nothing to debit, nothing to refund). */
        if (amountVb > 0) {
          try {
            await charge({
              userId: fromUserId,
              amount: amountVb,
              reason: "World Stage Shoutout",
              idempotencyKey: key,
            });
          } catch (err) {
            if (err instanceof OutOfCreditsError) return { ok: false, reason: "insufficient" };
            if (err instanceof CreditsDisabledError) return { ok: false, reason: "disabled" };
            throw err;
          }
        }
        /* 2) The ledger row. The debit has landed — a failure
         * here refunds in full and voids the key. */
        try {
          row = await store.insert({
            fromUserId,
            toUserId,
            amountVb,
            feeVb,
            netVb,
            message,
            roomId,
            idempotencyKey: key,
          });
        } catch (insertErr) {
          logger.error({ insertErr }, "[stage-shoutout] record failed after debit — refunding the fan");
          if (amountVb > 0) {
            let refundOk = false;
            try {
              await refund(fromUserId, amountVb, "World Stage Shoutout — Refund (record failed)");
              refundOk = true;
            } catch (refundErr) {
              logger.error({ refundErr }, "[stage-shoutout] CRITICAL refund after record failure also failed — manual reconciliation required");
            }
            if (refundOk) await Promise.resolve(voidKey(key)).catch(() => {});
          }
          return { ok: false, reason: "error" };
        }
      }

      /* 3) Credit the performer the NET — once. A free shoutout
       * has nothing to credit: the row is simply stamped so the
       * moment is complete on the record. */
      if (row.creatorCreditedAt == null) {
        if (row.amountVb === 0) {
          await store.markCredited(row.id);
          if (fromUserId !== toUserId) {
            try {
              const fromName = await resolveDisplayName(fromUserId);
              await _stageShoutoutEventNotifier(
                buildStageShoutoutEvent({ toUserId, fromName, netVb: 0, message: row.message }),
              );
            } catch (notifyErr) {
              logger.warn({ notifyErr, shoutoutId: row.id }, "[stage-shoutout] performer push failed (non-fatal)");
            }
          }
        } else {
          const creditKey = `${key}:credit`;
          let creditLanded = false;
          try {
            if (!(await store.creditAlreadyRecorded(creditKey))) {
              await creditPerformer(toUserId, row.netVb);
              creditLanded = true;
              await recordCredit(toUserId, row.netVb, creditKey);
            }
            await store.markCredited(row.id);
            /* This call landed the credit — tell the performer.
             * Best-effort; the shoutout has already landed. */
            if (creditLanded && fromUserId !== toUserId) {
              try {
                const fromName = await resolveDisplayName(fromUserId);
                await _stageShoutoutEventNotifier(
                  buildStageShoutoutEvent({ toUserId, fromName, netVb: row.netVb, message: row.message }),
                );
              } catch (notifyErr) {
                logger.warn({ notifyErr, shoutoutId: row.id }, "[stage-shoutout] performer push failed (non-fatal)");
              }
            }
          } catch (err) {
            logger.error({ err, shoutoutId: row.id }, "[stage-shoutout] performer credit failed — reversing any landed credit, refunding the fan");
            if (creditLanded) {
              try {
                await reverseCredit(toUserId, row.netVb);
              } catch (revErr) {
                logger.error({ revErr, shoutoutId: row.id }, "[stage-shoutout] CRITICAL credit reversal failed — duplicated value possible, manual reconciliation required");
              }
            }
            if (!isRetry) {
              let refundOk = false;
              try {
                await refund(fromUserId, row.amountVb, "World Stage Shoutout — Refund (credit failed)");
                refundOk = true;
              } catch (refundErr) {
                logger.error({ refundErr, shoutoutId: row.id }, "[stage-shoutout] CRITICAL refund after credit failure also failed");
              }
              if (refundOk) {
                /* Fully unwound: remove the row + void the debit
                 * key so a fresh attempt starts clean. */
                await store.deleteById(row.id).catch(() => {});
                await Promise.resolve(voidKey(key)).catch(() => {});
              }
            }
            return { ok: false, reason: "error" };
          }
        }
      }
      return { ok: true, amountVb: row.amountVb };
    } catch (err) {
      logger.error({ err }, "[stage-shoutout] purchase failed");
      return { ok: false, reason: "error" };
    }
  };
}
