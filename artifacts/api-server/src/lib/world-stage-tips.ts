/**
 * World stage tips — the money movement (Ring 3, program item 3.3).
 *
 * A member in the audience tips the stage performer Visual Bucs
 * from inside the room. The ROOM (lib/world-room) owns the moment:
 * members only, a stage actually held, never your own stage, the
 * house tip bounds (lib/live-config — the same 100–1,000,000 VB
 * the live-stream tips run), and a per-member pace. THIS module
 * owns the transfer itself, and it moves money exactly the way
 * the live-stream tips do (routes/live-tips.ts is the template):
 *
 *   1. Debit the tipper through chargeCredits (personal balance
 *      only — a tip never draws a team pool) under a scoped
 *      idempotency key the room mints per attempt.
 *   2. Insert the world_stage_tips ledger row (migration 0148).
 *      A failure here refunds the tipper in full and voids the
 *      charge key, so a retry starts clean.
 *   3. Credit the performer ONCE: the derived `:credit` ledger key
 *      is checked first, the balance credit and its credit_usage
 *      entry are compensated as a pair (a landed credit whose
 *      ledger write fails is reversed), then the tip row is
 *      stamped creator_credited_at. A failure refunds the tipper,
 *      voids the key, and deletes the tip row — the old live-tips
 *      bug (performer paid AND tipper refunded) is designed out.
 *
 * NO FEE is taken: no house rule prices a cut of VB tips (the
 * live-stream VB tips move the full amount too; the fee law prices
 * memberships, beats, live shopping and marketplace sales — not
 * tips). The full amount moves, always.
 *
 * The store is injectable so the transfer's compensation paths are
 * unit-testable without a database; the default store is the real
 * rails.
 */

import { eq } from "drizzle-orm";
import { db, worldStageTipsTable, creditUsageTable } from "@workspace/db";
import {
  addCreditsAtomic,
} from "./supabase-admin";
import {
  chargeCredits,
  refundCredits,
  voidChargeIdempotencyKey,
  buildChargeIdempotencyKey,
  OutOfCreditsError,
  CreditsDisabledError,
} from "./credits";
import { recordCreditUsageStrict } from "./payment-record";
import { logger } from "./logger";

export type StageTipResult =
  | { ok: true }
  | { ok: false; reason: "insufficient" | "disabled" | "error" };

export interface StageTipRow {
  id: string;
  creatorCreditedAt: Date | null;
}

/** The transfer's data + rails surface (the default store below is
 *  the real one; tests drive a fake). */
export interface StageTipStore {
  findTipByKey(key: string): Promise<StageTipRow | null>;
  /** Debit the tipper (chargeCredits; personalOnly). Throws
   *  OutOfCreditsError / CreditsDisabledError / anything else. */
  charge(fromUserId: string, amountVb: number, key: string): Promise<void>;
  insertTip(input: {
    fromUserId: string;
    toUserId: string;
    amountVb: number;
    roomId: string;
    key: string;
  }): Promise<StageTipRow | null>;
  deleteTip(id: string): Promise<void>;
  markCredited(id: string): Promise<void>;
  /** True when the performer's `:credit` ledger entry already
   *  stands (a resumed transfer must not pay twice). */
  creditAlreadyRecorded(creditKey: string): Promise<boolean>;
  creditPerformer(toUserId: string, amountVb: number): Promise<void>;
  recordCredit(toUserId: string, amountVb: number, creditKey: string): Promise<void>;
  reverseCredit(toUserId: string, amountVb: number): Promise<void>;
  refund(fromUserId: string, amountVb: number, action: string): Promise<void>;
  voidKey(key: string): Promise<void>;
}

export const dbStageTipStore: StageTipStore = {
  async findTipByKey(key) {
    const rows = await db
      .select({ id: worldStageTipsTable.id, creatorCreditedAt: worldStageTipsTable.creatorCreditedAt })
      .from(worldStageTipsTable)
      .where(eq(worldStageTipsTable.idempotencyKey, key))
      .limit(1);
    return rows[0] ?? null;
  },
  async charge(fromUserId, amountVb, key) {
    await chargeCredits(
      fromUserId,
      amountVb,
      { action: "World Stage Tip" },
      { personalOnly: true, idempotencyKey: key },
    );
  },
  async insertTip(input) {
    const rows = await db
      .insert(worldStageTipsTable)
      .values({
        fromUserId: input.fromUserId,
        toUserId: input.toUserId,
        amountVb: input.amountVb,
        roomId: input.roomId,
        idempotencyKey: input.key,
      })
      .returning({ id: worldStageTipsTable.id, creatorCreditedAt: worldStageTipsTable.creatorCreditedAt });
    return rows[0] ?? null;
  },
  async deleteTip(id) {
    await db.delete(worldStageTipsTable).where(eq(worldStageTipsTable.id, id));
  },
  async markCredited(id) {
    await db
      .update(worldStageTipsTable)
      .set({ creatorCreditedAt: new Date() })
      .where(eq(worldStageTipsTable.id, id));
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
  async creditPerformer(toUserId, amountVb) {
    await addCreditsAtomic(toUserId, amountVb);
  },
  async recordCredit(toUserId, amountVb, creditKey) {
    await recordCreditUsageStrict({
      userId: toUserId,
      action: "World Stage Tip — Received",
      creditsUsed: -amountVb,
      idempotencyKey: creditKey,
    });
  },
  async reverseCredit(toUserId, amountVb) {
    await addCreditsAtomic(toUserId, -amountVb);
  },
  async refund(fromUserId, amountVb, action) {
    await refundCredits(fromUserId, amountVb, { action });
  },
  async voidKey(key) {
    await voidChargeIdempotencyKey(key);
  },
};

/**
 * Build the room's tipper. `attemptKey` is a fresh random key per
 * attempt (the room mints it): the scoped charge key derived from
 * it makes the debit, the ledger row and the performer's credit
 * entry all name the same transfer.
 */
export function createStageTipper(store: StageTipStore = dbStageTipStore) {
  return async function tipStagePerformer(input: {
    fromUserId: string;
    toUserId: string;
    amountVb: number;
    roomId: string;
    attemptKey: string;
  }): Promise<StageTipResult> {
    const { fromUserId, toUserId, amountVb, roomId } = input;
    const key = buildChargeIdempotencyKey("stage-tip", fromUserId, input.attemptKey, {
      roomId,
      toUserId,
      amountVb,
    });
    try {
      /* Resume gate: a row for this key means a previous attempt
       * already debited (chargeCredits dedupes the debit too). */
      let tip = await store.findTipByKey(key);
      const isRetry = !!tip;

      if (!tip) {
        /* 1) Debit the tipper. */
        try {
          await store.charge(fromUserId, amountVb, key);
        } catch (err) {
          if (err instanceof OutOfCreditsError) return { ok: false, reason: "insufficient" };
          if (err instanceof CreditsDisabledError) return { ok: false, reason: "disabled" };
          throw err;
        }
        /* 2) The ledger row. The debit has landed — a failure here
         * refunds in full and voids the key (live-tips F6). */
        try {
          tip = await store.insertTip({ fromUserId, toUserId, amountVb, roomId, key });
          if (!tip) throw new Error("stage tip insert returned no row");
        } catch (insertErr) {
          logger.error({ insertErr }, "[stage-tip] record failed after debit — refunding the tipper");
          let refundOk = false;
          try {
            await store.refund(fromUserId, amountVb, "World Stage Tip — Refund (record failed)");
            refundOk = true;
          } catch (refundErr) {
            logger.error({ refundErr }, "[stage-tip] CRITICAL refund after record failure also failed — manual reconciliation required");
          }
          if (refundOk) await store.voidKey(key).catch(() => {});
          return { ok: false, reason: "error" };
        }
      }

      /* 3) Credit the performer — once. */
      if (!tip.creatorCreditedAt) {
        const creditKey = `${key}:credit`;
        let creditLanded = false;
        try {
          if (!(await store.creditAlreadyRecorded(creditKey))) {
            await store.creditPerformer(toUserId, amountVb);
            creditLanded = true;
            await store.recordCredit(toUserId, amountVb, creditKey);
          }
          await store.markCredited(tip.id);
        } catch (err) {
          logger.error({ err, tipId: tip.id }, "[stage-tip] performer credit failed — reversing any landed credit, refunding the tipper");
          if (creditLanded) {
            try {
              await store.reverseCredit(toUserId, amountVb);
            } catch (revErr) {
              logger.error({ revErr, tipId: tip.id }, "[stage-tip] CRITICAL credit reversal failed — duplicated value possible, manual reconciliation required");
            }
          }
          if (!isRetry) {
            let refundOk = false;
            try {
              await store.refund(fromUserId, amountVb, "World Stage Tip — Refund (credit failed)");
              refundOk = true;
            } catch (refundErr) {
              logger.error({ refundErr, tipId: tip.id }, "[stage-tip] CRITICAL refund after credit failure also failed");
            }
            if (refundOk) {
              /* Fully unwound: remove the row + void the debit key
               * so a fresh attempt starts clean (live-tips F1). */
              await store.deleteTip(tip.id).catch(() => {});
              await store.voidKey(key).catch(() => {});
            }
          }
          return { ok: false, reason: "error" };
        }
      }
      return { ok: true };
    } catch (err) {
      logger.error({ err }, "[stage-tip] transfer failed");
      return { ok: false, reason: "error" };
    }
  };
}

export type StageTipper = ReturnType<typeof createStageTipper>;
