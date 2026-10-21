import { pgTable, uuid, text, integer, timestamp, check, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Durable charge→refund obligations for generated video clips
 * (migration 0183, payments defect D3).
 *
 * The defect: the Runway/Veo poll handlers charge credits on SUCCEEDED
 * and remembered the charge in an in-memory map (chargedTasks) so the
 * follow-up POST /api/generated-clips save could refund if its insert
 * failed. A server restart between the charge and the save lost the
 * map entry — the member was charged for a clip that never landed and
 * nothing gave the credits back.
 *
 * One row per charged task, written at charge time:
 *   pending   → the charge stands; the clip has not landed yet.
 *   delivered → a generated_clips row landed for this task (the save
 *               handler marks it, or the sweeper finds the row); the
 *               obligation is complete, no refund is owed.
 *   refunded  → the credits went back exactly once. Every refund path
 *               (save-failure handler, stale sweeper) CLAIMS the row
 *               with a single UPDATE … WHERE status='pending', so a
 *               restart, a second sweeper, or a racing handler can
 *               never refund the same charge twice.
 *
 * The refund amount and owner come from THIS row (recorded at charge
 * time), never from a current-price constant — the same discipline
 * the operator's pending-action store uses for quoted prices.
 */
export const CLIP_CHARGE_STATUSES = ["pending", "delivered", "refunded"] as const;
export type ClipChargeStatus = (typeof CLIP_CHARGE_STATUSES)[number];

export const clipChargeObligationsTable = pgTable("clip_charge_obligations", {
  id: uuid("id").primaryKey().defaultRandom(),
  /* The provider task id the charge belongs to (Runway taskId, or
     veo-<uuid> for Veo) — the same key the in-memory chargedTasks map
     used, now unique in the durable store. */
  task_id: text("task_id").notNull(),
  user_id: uuid("user_id").notNull(),
  credits: integer("credits").notNull(),
  project_id: uuid("project_id"),
  status: text("status").notNull().default("pending"),
  /* How the obligation resolved: 'saved' | 'save_failed' |
     'swept_refunded' | 'swept_delivered'. Null while pending. */
  resolution: text("resolution"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolved_at: timestamp("resolved_at", { withTimezone: true }),
}, (t) => [
  check("clip_charge_obligations_status_check", sql`${t.status} IN ('pending', 'delivered', 'refunded')`),
  uniqueIndex("clip_charge_obligations_task_idx").on(t.task_id),
  index("clip_charge_obligations_pending_idx").on(t.status, t.created_at),
]);

export const insertClipChargeObligationSchema = createInsertSchema(clipChargeObligationsTable).omit({
  id: true,
  created_at: true,
  resolved_at: true,
});
export const selectClipChargeObligationSchema = createSelectSchema(clipChargeObligationsTable);

export type ClipChargeObligationRow = typeof clipChargeObligationsTable.$inferSelect;
export type InsertClipChargeObligation = z.infer<typeof insertClipChargeObligationSchema>;
