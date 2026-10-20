import { pgTable, uuid, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* ── Coach Action Tracker (migration 0173, Stack-3 coach depth) ──────────
   The Monetization Coach's plan produced 3 money moves that vanished on
   reload — advice with nowhere to live. These two tables give the coach
   a persistent tracker next to the Money Tracker ledger:
     coach_action_items — the creator's checkable action items. Rows come
       from a built plan (source 'plan'), a niche analysis ('niche'), or
       the creator's own hand ('custom'). Done items keep completed_at so
       progress is a fact, not a vibe.
     coach_goals — ONE row per user: the typed monthly income goal the
       plan-numbers math measures against. Null goal = not set yet.
   Pure per-user data — every read/write is owner-scoped by user_id. */

export const COACH_ACTION_SOURCES = ["plan", "niche", "custom"] as const;
export type CoachActionSource = (typeof COACH_ACTION_SOURCES)[number];

export const coachActionItemsTable = pgTable("coach_action_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  title: text("title").notNull(),
  source: text("source").notNull().default("custom").$type<CoachActionSource>(),
  done: boolean("done").notNull().default(false),
  completed_at: timestamp("completed_at", { withTimezone: true }),
  sort_order: integer("sort_order").notNull().default(0),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const coachGoalsTable = pgTable("coach_goals", {
  user_id: uuid("user_id").primaryKey(),
  monthly_goal_cents: integer("monthly_goal_cents"),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCoachActionItemSchema = createInsertSchema(coachActionItemsTable)
  .omit({ id: true, created_at: true, updated_at: true, completed_at: true })
  .extend({
    title: z.string().trim().min(1).max(300),
    source: z.enum(COACH_ACTION_SOURCES).default("custom"),
    done: z.boolean().default(false),
    sort_order: z.number().int().min(0).max(100000).default(0),
  });

export const selectCoachActionItemSchema = createSelectSchema(coachActionItemsTable);
export const selectCoachGoalSchema = createSelectSchema(coachGoalsTable);

export type CoachActionItem = typeof coachActionItemsTable.$inferSelect;
export type CoachGoal = typeof coachGoalsTable.$inferSelect;
