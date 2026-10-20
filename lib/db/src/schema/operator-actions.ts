import { pgTable, uuid, text, integer, timestamp, jsonb, check, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Cloud Operator Phase 2 — the hands (migration 0177, Lane A).
 *
 * operator_actions is the ACTION trail: one row per operator action
 * attempt, written by the server-side executor (api-server
 * lib/operator-executor.ts) FROM THE RAIL'S RESULT — never from the
 * model's words. The credit ledger (credit_usage) stays the money
 * trail; this table answers "what did Thy Cheat Code do, for whom,
 * through which channel, at what quoted/charged price, and how did
 * it end". Charged actions land in BOTH trails (their ledger rows
 * carry the rail's action labels, as every charge does today).
 *
 * operator_pending_actions is the confirmation protocol's store:
 * propose -> pending row (member, tool, args hash, quoted price,
 * short expiry) -> confirm -> consumed EXACTLY ONCE. The executor's
 * consume is guarded on status='pending', so a replayed confirmation
 * finds nothing to consume and refuses (confirmation_replayed).
 * One charged step per confirmation, always.
 */

/* 'automatic' (migration 0180, Lane G) is the duties' channel: rows
   the operator's scheduled peace-keeping duties write when they
   fire on their own watch. It exists ONLY on operator_actions —
   pending confirmations are a member protocol and never carry it. */
export const OPERATOR_CHANNELS = ["chat_text", "voice", "admin_command", "automatic"] as const;
export type OperatorChannel = (typeof OPERATOR_CHANNELS)[number];

export const OPERATOR_ACTION_RESULTS = ["done", "refused", "failed"] as const;
export type OperatorActionResult = (typeof OPERATOR_ACTION_RESULTS)[number];

export const OPERATOR_PENDING_STATUSES = ["pending", "consumed", "expired", "cancelled"] as const;
export type OperatorPendingStatus = (typeof OPERATOR_PENDING_STATUSES)[number];

export const operatorActionsTable = pgTable("operator_actions", {
  id:             uuid("id").primaryKey().defaultRandom(),
  userId:         uuid("user_id").notNull(),
  adminEmail:     text("admin_email"),
  tier:           integer("tier").notNull(),
  toolId:         text("tool_id").notNull(),
  summary:        text("summary").notNull().default(""),
  target:         text("target"),
  channel:        text("channel").notNull().default("chat_text"),
  priceQuoted:    integer("price_quoted"),
  priceCharged:   integer("price_charged"),
  idempotencyKey: text("idempotency_key"),
  result:         text("result").notNull(),
  resultReason:   text("result_reason"),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("operator_actions_tier_check", sql`${t.tier} IN (0, 1, 2, 3, 4)`),
  check("operator_actions_channel_check", sql`${t.channel} IN ('chat_text', 'voice', 'admin_command', 'automatic')`),
  check("operator_actions_result_check", sql`${t.result} IN ('done', 'refused', 'failed')`),
  index("operator_actions_user_idx").on(t.userId, t.createdAt),
  index("operator_actions_recent_idx").on(t.createdAt),
]);

export const operatorPendingActionsTable = pgTable("operator_pending_actions", {
  id:         uuid("id").primaryKey().defaultRandom(),
  userId:     uuid("user_id").notNull(),
  toolId:     text("tool_id").notNull(),
  args:       jsonb("args").notNull().default({}),
  argsHash:   text("args_hash").notNull(),
  priceQuoted: integer("price_quoted").notNull(),
  channel:    text("channel").notNull().default("chat_text"),
  status:     text("status").notNull().default("pending"),
  createdAt:  timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt:  timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
}, (t) => [
  check("operator_pending_actions_channel_check", sql`${t.channel} IN ('chat_text', 'voice', 'admin_command')`),
  check("operator_pending_actions_status_check", sql`${t.status} IN ('pending', 'consumed', 'expired', 'cancelled')`),
  index("operator_pending_actions_user_idx").on(t.userId, t.status, t.createdAt),
]);

export const insertOperatorActionSchema = createInsertSchema(operatorActionsTable).omit({ id: true, createdAt: true });
export type InsertOperatorAction = z.infer<typeof insertOperatorActionSchema>;
export type OperatorAction = typeof operatorActionsTable.$inferSelect;

export const insertOperatorPendingActionSchema = createInsertSchema(operatorPendingActionsTable).omit({ id: true, createdAt: true, consumedAt: true });
export type InsertOperatorPendingAction = z.infer<typeof insertOperatorPendingActionSchema>;
export type OperatorPendingAction = typeof operatorPendingActionsTable.$inferSelect;
