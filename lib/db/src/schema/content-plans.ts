import { pgTable, uuid, text, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* ─── Public content-plan shares ──────────────────────────────────────────
   Opt-in: a creator publishes their finished Content Intelligence plan to a
   public, indexable /plan/:slug page. The plan payload is free-form JSON
   (validated idea, winning hook, niche verdict, gaps, calendar days). */

export const contentPlansTable = pgTable("content_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  plan: jsonb("plan").notNull().default({}),
  creator_name: text("creator_name").notNull().default("Anonymous Creator"),
  include_credit: boolean("include_credit").notNull().default(true),
  views: integer("views").notNull().default(0),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertContentPlanSchema = createInsertSchema(contentPlansTable).omit({
  id: true,
  views: true,
  created_at: true,
});

export const selectContentPlanSchema = createSelectSchema(contentPlansTable);

export type ContentPlanRow = typeof contentPlansTable.$inferSelect;
export type InsertContentPlan = z.infer<typeof insertContentPlanSchema>;
