import { pgTable, uuid, text, integer, timestamp, jsonb, check, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Durable submit-time charge intents for poll-charged generations
 * (migration 0298, Stack400 Lane 4 — charge integrity).
 *
 * The defect: the Runway-family rails (runway-clip, artist-image,
 * intro-outro, logo) charge credits when the provider task SUCCEEDS
 * and remembered the obligation only in an in-memory Map. A server
 * restart between submit and the success poll lost the entry and the
 * finished generation was delivered with no charge and no ledger row.
 *
 * One row per submitted task, written at SUBMIT time:
 *   awaiting  → the provider work is in flight (or its poll was lost);
 *               the success poll settles the charge from this row when
 *               the in-memory entry is gone.
 *   charged   → the charge landed (the credit_usage row carries the
 *               idempotency key 'gen-charge:<task_id>').
 *   failed    → the provider task failed/cancelled; no charge is owed.
 *   expired   → bookkeeping only: never delivered through a poll inside
 *               the retention window. A late poll may still settle it —
 *               exactly once, via the same idempotency key.
 *
 * delivered_at is stamped when a poll hands over the finished work;
 * the retry sweeper re-charges only delivered-but-uncharged intents.
 */
export const GENERATION_CHARGE_INTENT_STATUSES = ["awaiting", "charged", "failed", "expired"] as const;
export type GenerationChargeIntentStatus = (typeof GENERATION_CHARGE_INTENT_STATUSES)[number];

export const generationChargeIntentsTable = pgTable("generation_charge_intents", {
  id: uuid("id").primaryKey().defaultRandom(),
  task_id: text("task_id").notNull(),
  rail: text("rail").notNull(),
  user_id: uuid("user_id").notNull(),
  credits: integer("credits").notNull(),
  project_id: uuid("project_id"),
  action: text("action").notNull(),
  extra: jsonb("extra").$type<Record<string, unknown>>(),
  status: text("status").notNull().default("awaiting"),
  delivered_at: timestamp("delivered_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolved_at: timestamp("resolved_at", { withTimezone: true }),
}, (t) => [
  check("generation_charge_intents_status_check", sql`${t.status} IN ('awaiting', 'charged', 'failed', 'expired')`),
  uniqueIndex("generation_charge_intents_task_idx").on(t.task_id),
  index("generation_charge_intents_status_idx").on(t.status, t.created_at),
]);

export const insertGenerationChargeIntentSchema = createInsertSchema(generationChargeIntentsTable).omit({
  id: true,
  created_at: true,
  resolved_at: true,
});
export const selectGenerationChargeIntentSchema = createSelectSchema(generationChargeIntentsTable);

export type GenerationChargeIntentRow = typeof generationChargeIntentsTable.$inferSelect;
export type InsertGenerationChargeIntent = z.infer<typeof insertGenerationChargeIntentSchema>;
