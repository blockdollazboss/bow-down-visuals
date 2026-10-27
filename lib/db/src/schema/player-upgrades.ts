import { pgTable, uuid, text, timestamp, integer, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { showcaseItemsTable } from "./showcase-items";
import { songsTable } from "./songs";

/* ── Player-surface upgrades (Stack-200 upgrade-deltas wave, lane upg-player) ──
   #174 Thumbnail Duels · N5 Auto Chapters · N9 Karaoke Mode.
   Provisional migration: lib/db/migrations/9999-upg-player.sql */

/* ── N5: Auto Chapters for a published (showcase) video ──────────────────────
   Chapters + summary generated from the video's own transcript, stored as a
   DRAFT. Nothing shows on the watch surface until the creator approves;
   status "off" is the creator's off switch (automated-behavior law). */
export const videoAutoChaptersTable = pgTable("video_auto_chapters", {
  id: uuid("id").primaryKey().defaultRandom(),
  showcase_item_id: uuid("showcase_item_id")
    .notNull()
    .unique()
    .references(() => showcaseItemsTable.id, { onDelete: "cascade" }),
  user_id: uuid("user_id").notNull(),
  chapters: jsonb("chapters")
    .$type<Array<{ title: string; startSec: number; endSec: number }>>()
    .notNull()
    .default([]),
  summary: text("summary").notNull().default(""),
  /** draft | approved | off */
  status: text("status").notNull().default("draft"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVideoAutoChaptersSchema = createInsertSchema(videoAutoChaptersTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export const selectVideoAutoChaptersSchema = createSelectSchema(videoAutoChaptersTable);
export type VideoAutoChaptersRow = typeof videoAutoChaptersTable.$inferSelect;

/* ── #174: Thumbnail Duels ───────────────────────────────────────────────────
   A creator ships cover A + cover B for one published video. The audience is
   served both in rotation; real views (cover served) and clicks (cover
   clicked through to the video) are counted per cover. When total views reach
   the target AND one cover leads on clicks, the duel resolves and the winner
   takes over as the item's thumbnail automatically. Counts are the platform's
   own records — results are always shown as real numbers. */
export const thumbnailDuelsTable = pgTable("thumbnail_duels", {
  id: uuid("id").primaryKey().defaultRandom(),
  showcase_item_id: uuid("showcase_item_id")
    .notNull()
    .references(() => showcaseItemsTable.id, { onDelete: "cascade" }),
  user_id: uuid("user_id").notNull(),
  cover_a_url: text("cover_a_url").notNull(),
  cover_b_url: text("cover_b_url").notNull(),
  /** running | resolved | cancelled */
  status: text("status").notNull().default("running"),
  /** a | b | null */
  winner: text("winner"),
  views_a: integer("views_a").notNull().default(0),
  views_b: integer("views_b").notNull().default(0),
  clicks_a: integer("clicks_a").notNull().default(0),
  clicks_b: integer("clicks_b").notNull().default(0),
  /** Total cover views (A+B) at which the duel may resolve. */
  target_views: integer("target_views").notNull().default(100),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolved_at: timestamp("resolved_at", { withTimezone: true }),
});

export const insertThumbnailDuelSchema = createInsertSchema(thumbnailDuelsTable).omit({
  id: true,
  created_at: true,
  resolved_at: true,
});
export const selectThumbnailDuelSchema = createSelectSchema(thumbnailDuelsTable);
export type ThumbnailDuelRow = typeof thumbnailDuelsTable.$inferSelect;

/* One counted click per audience member per cover (same voter-fingerprint
   dedupe the showcase like rail uses). */
export const thumbnailDuelClicksTable = pgTable(
  "thumbnail_duel_clicks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    duel_id: uuid("duel_id")
      .notNull()
      .references(() => thumbnailDuelsTable.id, { onDelete: "cascade" }),
    cover: text("cover").notNull(),
    voter_key: text("voter_key").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("thumbnail_duel_clicks_uq").on(t.duel_id, t.cover, t.voter_key)],
);

export type ThumbnailDuelClickRow = typeof thumbnailDuelClicksTable.$inferSelect;

/* ── N9: Karaoke sing-alongs ─────────────────────────────────────────────────
   A fan's recorded sing-along over a song whose creator enabled Karaoke
   Mode. Shared sing-alongs publish to the fan's showcase ONLY when the
   creator's song settings allow shares. */
export const karaokeSingalongsTable = pgTable("karaoke_singalongs", {
  id: uuid("id").primaryKey().defaultRandom(),
  song_id: uuid("song_id")
    .notNull()
    .references(() => songsTable.id, { onDelete: "cascade" }),
  /** The fan who sang. */
  user_id: uuid("user_id").notNull(),
  audio_url: text("audio_url").notNull(),
  /** private | shared */
  status: text("status").notNull().default("private"),
  showcase_item_id: uuid("showcase_item_id").references(() => showcaseItemsTable.id, {
    onDelete: "set null",
  }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertKaraokeSingalongSchema = createInsertSchema(karaokeSingalongsTable).omit({
  id: true,
  created_at: true,
});
export const selectKaraokeSingalongSchema = createSelectSchema(karaokeSingalongsTable);
export type KaraokeSingalongRow = typeof karaokeSingalongsTable.$inferSelect;

export const karaokeSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  shareEnabled: z.boolean().optional(),
  timedLyrics: z.string().max(20000).optional(),
});
