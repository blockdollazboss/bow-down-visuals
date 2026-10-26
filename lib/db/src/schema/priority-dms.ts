import { pgTable, uuid, text, integer, boolean, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { conversationsTable, messagesTable } from "./community";

/**
 * Paid Priority DMs (Wave-4 #44, migration 9999 PROVISIONAL — renumber at join).
 *
 * A fan pays Visual Bucs (TEST MODE rail, existing credit ledger) to land
 * one message in a creator's priority inbox lane inside Messages.
 * The honesty rule is the feature:
 *   - the price is CREATOR-SET (their own minimum) — there is no platform
 *     default or floor price anywhere in this schema or the code;
 *   - the reply window is stated before the fan pays;
 *   - if the creator does not reply inside that window, the fan is
 *     refunded in full, exactly once;
 *   - a block always wins: a blocked fan can never buy priority, and a
 *     delivery refused by a block refunds exactly once.
 *
 * Escrow shape: the charge is HELD while status = 'held'. It settles to
 * the creator only when a creator reply lands inside the window
 * (status 'replied'), and returns to the fan on 'refunded_expired' /
 * 'refunded_blocked'. Status transitions are the exactly-once guard —
 * money moves only on the held -> terminal transition, and every ledger
 * row carries a deterministic idempotency key derived from the row id.
 */

export const PRIORITY_DM_STATUSES = [
  "held",              // charged, delivered, waiting for a creator reply
  "replied",           // creator replied in window — escrow paid to creator
  "refunded_expired",  // window closed unanswered — fan refunded in full
  "refunded_blocked",  // delivery refused by a block — fan refunded in full
] as const;
export type PriorityDmStatus = (typeof PRIORITY_DM_STATUSES)[number];

/* One settings row per creator (keyed by the creator's user id). A
   creator with no row — or opted_in = false — sells nothing. There is
   deliberately NO default price column value: min_price_vb stays NULL
   until the creator types their own number. */
export const priorityDmSettingsTable = pgTable("priority_dm_settings", {
  creatorUserId:    uuid("creator_user_id").primaryKey(),
  optedIn:          boolean("opted_in").notNull().default(false),
  /* Creator-entered minimum (and charged) price in Visual Bucs. NULL =
     the creator has not set a price, so priority is not sellable even
     when opted in — the platform never invents one. */
  minPriceVb:       integer("min_price_vb"),
  /* Creator-stated reply window in hours (12–168), shown to the fan
     before they pay. Default 48 is a window, never a price. */
  replyWindowHours: integer("reply_window_hours").notNull().default(48),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertPriorityDmSettingsSchema = createInsertSchema(priorityDmSettingsTable);
export type PriorityDmSettings = typeof priorityDmSettingsTable.$inferSelect;

export const priorityDmsTable = pgTable("priority_dms", {
  id:             uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id").references(() => conversationsTable.id, { onDelete: "set null" }),
  messageId:      uuid("message_id").references(() => messagesTable.id, { onDelete: "set null" }),
  senderUserId:   uuid("sender_user_id").notNull(),
  creatorUserId:  uuid("creator_user_id").notNull(),
  /* The exact Visual Bucs charged — locked at purchase from the
     creator's stated minimum, so a later price change never rewrites
     what an in-flight message cost or refunds. */
  amountVb:       integer("amount_vb").notNull(),
  status:         text("status").notNull().default("held"),
  /* Client intent key (scoped server-side with the sender id). UNIQUE:
     a retried purchase can never create a second row or a second
     charge — the original row is returned instead. */
  idempotencyKey: text("idempotency_key").notNull(),
  replyDeadline:  timestamp("reply_deadline", { withTimezone: true }).notNull(),
  repliedAt:      timestamp("replied_at", { withTimezone: true }),
  settledAt:      timestamp("settled_at", { withTimezone: true }),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("priority_dms_idempotency_uidx").on(t.idempotencyKey),
  index("priority_dms_creator_status_idx").on(t.creatorUserId, t.status, t.createdAt),
  index("priority_dms_sender_idx").on(t.senderUserId, t.createdAt),
  index("priority_dms_conversation_idx").on(t.conversationId),
]);

export const insertPriorityDmSchema = createInsertSchema(priorityDmsTable).omit({ id: true, createdAt: true });
export type InsertPriorityDm = z.infer<typeof insertPriorityDmSchema>;
export type PriorityDm = typeof priorityDmsTable.$inferSelect;
