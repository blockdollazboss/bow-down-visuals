import { pgTable, uuid, text, integer, timestamp, date, jsonb } from "drizzle-orm/pg-core";

/* Wave 8 tables — content calendar, royalty splits, sponsor pipeline, merch drops. */

export const wave8CalendarSlotsTable = pgTable("wave8_calendar_slots", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  week_start: date("week_start").notNull(),
  day_index: integer("day_index").notNull().default(0),
  position: integer("position").notNull().default(0),
  title: text("title").notNull().default(""),
  post_type: text("post_type").notNull().default("post"),
  notes: text("notes").notNull().default(""),
  status: text("status").notNull().default("draft"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const wave8RoyaltySplitsTable = pgTable("wave8_royalty_splits", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  song_title: text("song_title").notNull().default(""),
  collaborators: jsonb("collaborators").notNull().default([]),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const wave8SponsorDealsTable = pgTable("wave8_sponsor_deals", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  sponsor_name: text("sponsor_name").notNull().default(""),
  stage: text("stage").notNull().default("pitched"),
  deal_value_cents: integer("deal_value_cents").notNull().default(0),
  contact: text("contact").notNull().default(""),
  notes: text("notes").notNull().default(""),
  last_followup_at: timestamp("last_followup_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const wave8MerchDropsTable = pgTable("wave8_merch_drops", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  plan_name: text("plan_name").notNull().default(""),
  concepts: jsonb("concepts").notNull().default([]),
  launch_posts: jsonb("launch_posts").notNull().default([]),
  status: text("status").notNull().default("draft"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
