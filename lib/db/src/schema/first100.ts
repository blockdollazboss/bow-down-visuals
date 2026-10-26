import { pgTable, uuid, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * First 100 Fans (Stack-200 List 2 #155, TRULY NEW) — per-creator
 * program state. Provisional migration: lib/db/migrations/0265-first100.sql
 * (renumbered at join).
 *
 * WHAT THIS TABLE IS — and is not:
 *  - The fan COUNT is never stored here. It is derived live, on every
 *    read, from the real `follows` rows for the creator's profile
 *    (lib/first100 in the API server). This table can never drift
 *    from the truth because it holds no count at all.
 *  - What IS stored is the program's memory: which milestones the
 *    house has already CELEBRATED with the creator (so a milestone
 *    fires its recognition exactly once, never on every dashboard
 *    load), and the creator's dismissal / snooze state (smart law:
 *    the path never nags — a dismissed card stays away until the
 *    snooze lapses or a NEW milestone is reached).
 *  - No charges, no Visual Bucs, no prices live here or anywhere in
 *    this feature. Recognition rides the existing notifications rail
 *    (kind 'first100_milestone') — no new economy was invented.
 */

export const FIRST100_MILESTONES = [1, 10, 25, 50, 100] as const;
export type First100Milestone = (typeof FIRST100_MILESTONES)[number];

export const first100StateTable = pgTable("first100_state", {
  userId: uuid("user_id").primaryKey(),
  /** Milestones already celebrated (notification sent), e.g. [1, 10]. */
  celebratedMilestones: jsonb("celebrated_milestones")
    .$type<number[]>()
    .notNull()
    .default([]),
  /** Last time the creator dismissed the dashboard card (smart-law memory). */
  dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
  /** The card stays hidden until this moment, unless a new milestone lands. */
  snoozeUntil: timestamp("snooze_until", { withTimezone: true }),
  /** Stamped the first time the live count is seen at 100+. */
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertFirst100StateSchema = createInsertSchema(first100StateTable).omit({
  createdAt: true,
  updatedAt: true,
});
export type InsertFirst100State = z.infer<typeof insertFirst100StateSchema>;
export type First100State = typeof first100StateTable.$inferSelect;
