import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Submission tracker for Label Pitch (/label-pitch).
   One row per demo submission a creator sends to a record label — tracks
   the outreach pipeline: sent → pending → signed (or passed).
   Deleting a row removes ONLY this row; nothing else references it. */

export const LABEL_PITCH_STATUSES = ["sent", "pending", "signed", "passed"] as const;
export type LabelPitchStatus = (typeof LABEL_PITCH_STATUSES)[number];

export const labelPitchesTable = pgTable("label_pitches", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  song_title: text("song_title").notNull(),
  artist_name: text("artist_name"),
  label_name: text("label_name").notNull(),
  status: text("status").notNull().default("sent"),
  notes: text("notes"),
  contacted_at: timestamp("contacted_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLabelPitchSchema = createInsertSchema(labelPitchesTable).omit({
  id: true,
  user_id: true,
  created_at: true,
  updated_at: true,
});

export const selectLabelPitchSchema = createSelectSchema(labelPitchesTable);

export type LabelPitchRow = typeof labelPitchesTable.$inferSelect;
export type InsertLabelPitch = z.infer<typeof insertLabelPitchSchema>;
