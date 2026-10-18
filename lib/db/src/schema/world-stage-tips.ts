import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * World stage tips (Ring 3, program item 3.3) — the ledger of VB
 * tips from a seat to the stage performer, sent from inside a World
 * room. One row per LANDED tip: the transfer (lib/world-stage-tips
 * in the api-server) debits the tipper through the house charge
 * rails, inserts this row, then credits the performer; any failure
 * after the debit refunds the tipper and deletes the row, so a row
 * that stands means the money moved.
 *
 * `idempotencyKey` is the transfer's scoped charge key (built by
 * credits.buildChargeIdempotencyKey) — unique, so a resumed
 * transfer finds its row instead of paying twice.
 * `creatorCreditedAt` stamps when the performer's credit landed;
 * a standing row with it null is an in-flight (or crashed)
 * transfer the resume gate completes rather than duplicates.
 */
export const worldStageTipsTable = pgTable(
  "world_stage_tips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromUserId: text("from_user_id").notNull(),
    toUserId: text("to_user_id").notNull(),
    amountVb: integer("amount_vb").notNull(),
    roomId: text("room_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    creatorCreditedAt: timestamp("creator_credited_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("world_stage_tips_key_uq").on(table.idempotencyKey),
    index("world_stage_tips_to_user_idx").on(table.toUserId, table.createdAt),
    check("world_stage_tips_amount_positive", sql`${table.amountVb} > 0`),
  ],
);

export type WorldStageTip = typeof worldStageTipsTable.$inferSelect;
export type NewWorldStageTip = typeof worldStageTipsTable.$inferInsert;
