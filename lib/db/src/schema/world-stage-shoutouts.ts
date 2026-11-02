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
 * World stage shoutouts (Ring 3, program item 3.3 remainder) — the
 * ledger of VB shoutouts bought from a seat for the stage performer
 * inside a World room, the paid half of the stage applause pair
 * (stage tips are world_stage_tips). One row per LANDED shoutout:
 * the transfer (lib/world-stage-shoutouts in the api-server) reads
 * the performer's price from the site shoutout rail's own settings
 * (shoutout_settings.price_cents, charged in Visual Bucs at that
 * number — no rail anywhere names an exchange rate, so the settings
 * number IS the price), debits the fan the gross, inserts this row,
 * then credits the performer the net of the rail's flat 5% fee;
 * any failure after the debit refunds the fan and deletes the row,
 * so a row that stands means the money moved.
 *
 * `amountVb` is the gross the fan paid, `netVb` what the performer
 * was credited, `feeVb` the platform cut — fee + net = amount,
 * enforced by the split check. A free shoutout (price 0) lands
 * with all three at 0.
 *
 * `idempotencyKey` is the transfer's scoped charge key (built by
 * credits.buildChargeIdempotencyKey) — unique, so a resumed
 * transfer finds its row instead of paying twice.
 * `creatorCreditedAt` stamps when the performer's credit landed;
 * a standing row with it null is an in-flight (or crashed)
 * transfer the resume gate completes rather than duplicates.
 */
export const worldStageShoutoutsTable = pgTable(
  "world_stage_shoutouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fromUserId: text("from_user_id").notNull(),
    toUserId: text("to_user_id").notNull(),
    amountVb: integer("amount_vb").notNull(),
    feeVb: integer("fee_vb").notNull(),
    netVb: integer("net_vb").notNull(),
    message: text("message").notNull(),
    roomId: text("room_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    creatorCreditedAt: timestamp("creator_credited_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("world_stage_shoutouts_key_uq").on(table.idempotencyKey),
    index("world_stage_shoutouts_to_user_idx").on(table.toUserId, table.createdAt),
    check("world_stage_shoutouts_amount_nonnegative", sql`${table.amountVb} >= 0`),
    check(
      "world_stage_shoutouts_split_adds_up",
      sql`${table.feeVb} + ${table.netVb} = ${table.amountVb}`,
    ),
  ],
);
