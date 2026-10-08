import { pgTable, uuid, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

/* Wave 9A tables — song structure builder + remix chain version bookkeeping. */

export const wave9aSongStructuresTable = pgTable("wave9a_song_structures", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  song_id: uuid("song_id"),
  name: text("name").notNull().default(""),
  sections: jsonb("sections").notNull().default([]),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const wave9aSongVersionsTable = pgTable("wave9a_song_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  song_id: uuid("song_id"),
  parent_version_id: uuid("parent_version_id"),
  label: text("label").notNull().default(""),
  notes: text("notes").notNull().default(""),
  audio_url: text("audio_url").notNull().default(""),
  promoted: boolean("promoted").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
