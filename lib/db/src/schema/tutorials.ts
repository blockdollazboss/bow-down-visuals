import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  jsonb,
  timestamp,
  check,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { creatorProfilesTable, profileVideosTable } from "./creator-platform";

/**
 * Tutorials V1 (migration 0201) — the two-sided how-to system, built
 * INSIDE the Creator Academy (never a separate island):
 *
 *   tutorial_series   an ordered shelf of tutorials. Official series
 *                     are the site's operating-flow paths (Start Here →
 *                     Create → Brand → Promote → Money, seeded lazily
 *                     by the API from these category keys); creator
 *                     series group one creator's tutorials for fans.
 *   tutorials         ONE designated published video (or, while its
 *                     video is still in production, a structured
 *                     walkthrough) plus the three doors' targets:
 *                     guideRoute fires the page's GuideMe tour ("Walk
 *                     me through it"), tryRoute is the "Try it now"
 *                     deep link. videoId NULL = media in production —
 *                     the surface must say so, never fake a player.
 *   tutorial_chapters ordered chapters per tutorial: timestamp +
 *                     the walkthrough text (the script). A chapter is
 *                     both a player marker AND the readable lesson,
 *                     so a tutorial teaches fully before its video
 *                     exists.
 *   tutorial_resources downloadable/linked attachments per tutorial,
 *                     optionally pinned to one chapter.
 *   tutorial_progress server-side fan progress: started / in-progress
 *                     / completed per tutorial, the completed chapter
 *                     set, and the resume point (last chapter +
 *                     position) so a returning fan lands where they
 *                     left off.
 *
 * V2/V3 docking (shape only — V1 never writes these):
 *   tutorials.access reserves the V3 access ladder ('free' is the
 *   only value V1 writes; followers/members/paid arrive with V3's
 *   gating on the existing shop/digital-sales rails). ownerUserId +
 *   profileId carry the creator dimension from day one so the V2
 *   Tutorial Maker publishes into the same tables.
 *
 * FREE LAW: official tutorials are free for fans and V1 has no
 * credits path anywhere — no price columns, no charge hooks.
 */

/** The closed category set: the five operating-flow paths + creator. */
export const TUTORIAL_CATEGORIES = [
  "start-here",
  "create",
  "brand",
  "promote",
  "money",
  "creator",
] as const;
export type TutorialCategory = (typeof TUTORIAL_CATEGORIES)[number];

/** The V3 access ladder, reserved. V1 writes 'free' only. */
export const TUTORIAL_ACCESS_LEVELS = ["free", "followers", "members", "paid"] as const;
export type TutorialAccess = (typeof TUTORIAL_ACCESS_LEVELS)[number];

export const tutorialSeriesTable = pgTable("tutorial_series", {
  id:           uuid("id").primaryKey().defaultRandom(),
  /** The account that owns the series (house admin for official). */
  ownerUserId:  uuid("owner_user_id").notNull(),
  /** The profile shelf this series lists under; NULL = Academy-only. */
  profileId:    uuid("profile_id").references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
  title:        text("title").notNull(),
  slug:         text("slug").notNull().unique(),
  description:  text("description").notNull().default(""),
  category:     text("category").$type<TutorialCategory>().notNull().default("creator"),
  /** Official = designated by an admin (ADMIN_EMAILS), badged as
      Bow Down Visuals. A member can never set this on their own row. */
  isOfficial:   boolean("is_official").notNull().default(false),
  position:     integer("position").notNull().default(0),
  isPublished:  boolean("is_published").notNull().default(true),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("tutorial_series_category_check", sql`${t.category} IN ('start-here', 'create', 'brand', 'promote', 'money', 'creator')`),
  index("tutorial_series_profile_idx").on(t.profileId),
]);

export const insertTutorialSeriesSchema = createInsertSchema(tutorialSeriesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTutorialSeries = z.infer<typeof insertTutorialSeriesSchema>;
export type TutorialSeries = typeof tutorialSeriesTable.$inferSelect;

export const tutorialsTable = pgTable("tutorials", {
  id:           uuid("id").primaryKey().defaultRandom(),
  seriesId:     uuid("series_id").references(() => tutorialSeriesTable.id, { onDelete: "set null" }),
  ownerUserId:  uuid("owner_user_id").notNull(),
  /** The profile whose shelf lists this tutorial (= the video's
      profile at designation time). */
  profileId:    uuid("profile_id").references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
  /** The designated published video. NULL while the tutorial's own
      video is in production — the walkthrough still teaches. Set
      null (never cascade) if the video is later removed. */
  videoId:      uuid("video_id").references(() => profileVideosTable.id, { onDelete: "set null" }),
  title:        text("title").notNull(),
  slug:         text("slug").notNull().unique(),
  description:  text("description").notNull().default(""),
  category:     text("category").$type<TutorialCategory>().notNull().default("creator"),
  /** Order inside the series (or the catalog for standalones). */
  position:     integer("position").notNull().default(0),
  isOfficial:   boolean("is_official").notNull().default(false),
  /** V1 writes 'free' only — see the access ladder note above. */
  access:       text("access").$type<TutorialAccess>().notNull().default("free"),
  /** "Walk me through it": the route whose GuideMe tour fires. */
  guideRoute:   text("guide_route"),
  /** "Try it now": the deep link into the real tool. */
  tryRoute:     text("try_route"),
  /** Full transcript (captions' source text), when production lands. */
  transcript:   text("transcript"),
  isPublished:  boolean("is_published").notNull().default(true),
  createdAt:    timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("tutorials_category_check", sql`${t.category} IN ('start-here', 'create', 'brand', 'promote', 'money', 'creator')`),
  check("tutorials_access_check", sql`${t.access} IN ('free', 'followers', 'members', 'paid')`),
  /* One tutorial per designated video in V1. */
  uniqueIndex("tutorials_video_unique").on(t.videoId).where(sql`${t.videoId} IS NOT NULL`),
  index("tutorials_series_idx").on(t.seriesId),
  index("tutorials_profile_idx").on(t.profileId),
]);

export const insertTutorialSchema = createInsertSchema(tutorialsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTutorial = z.infer<typeof insertTutorialSchema>;
export type Tutorial = typeof tutorialsTable.$inferSelect;

export const tutorialChaptersTable = pgTable("tutorial_chapters", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tutorialId: uuid("tutorial_id").notNull().references(() => tutorialsTable.id, { onDelete: "cascade" }),
  position:   integer("position").notNull(),
  title:      text("title").notNull(),
  /** Player marker in seconds; NULL for a text-only chapter. */
  startSec:   integer("start_sec"),
  /** The walkthrough text — the lesson itself, readable without video. */
  body:       text("body").notNull().default(""),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("tutorial_chapters_position_unique").on(t.tutorialId, t.position),
]);

export const insertTutorialChapterSchema = createInsertSchema(tutorialChaptersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTutorialChapter = z.infer<typeof insertTutorialChapterSchema>;
export type TutorialChapter = typeof tutorialChaptersTable.$inferSelect;

export const tutorialResourcesTable = pgTable("tutorial_resources", {
  id:         uuid("id").primaryKey().defaultRandom(),
  tutorialId: uuid("tutorial_id").notNull().references(() => tutorialsTable.id, { onDelete: "cascade" }),
  /** Optionally pinned to one chapter of the same tutorial. */
  chapterId:  uuid("chapter_id").references(() => tutorialChaptersTable.id, { onDelete: "cascade" }),
  title:      text("title").notNull(),
  url:        text("url").notNull(),
  kind:       text("kind").$type<"download" | "link">().notNull().default("link"),
  position:   integer("position").notNull().default(0),
  createdAt:  timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("tutorial_resources_kind_check", sql`${t.kind} IN ('download', 'link')`),
  index("tutorial_resources_tutorial_idx").on(t.tutorialId),
]);

export const insertTutorialResourceSchema = createInsertSchema(tutorialResourcesTable).omit({ id: true, createdAt: true });
export type InsertTutorialResource = z.infer<typeof insertTutorialResourceSchema>;
export type TutorialResource = typeof tutorialResourcesTable.$inferSelect;

export const TUTORIAL_PROGRESS_STATUSES = ["started", "in_progress", "completed"] as const;
export type TutorialProgressStatus = (typeof TUTORIAL_PROGRESS_STATUSES)[number];

export const tutorialProgressTable = pgTable("tutorial_progress", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  userId:             uuid("user_id").notNull(),
  tutorialId:         uuid("tutorial_id").notNull().references(() => tutorialsTable.id, { onDelete: "cascade" }),
  status:             text("status").$type<TutorialProgressStatus>().notNull().default("started"),
  /** Chapter ids the fan has marked complete (a set, stored as jsonb). */
  completedChapters:  jsonb("completed_chapters").$type<string[]>().notNull().default([]),
  /** Resume point: the chapter the fan was last on. */
  lastChapterId:      uuid("last_chapter_id").references(() => tutorialChaptersTable.id, { onDelete: "set null" }),
  /** Resume point inside the video, seconds. */
  lastPositionSec:    integer("last_position_sec").notNull().default(0),
  startedAt:          timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt:        timestamp("completed_at", { withTimezone: true }),
  updatedAt:          timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("tutorial_progress_status_check", sql`${t.status} IN ('started', 'in_progress', 'completed')`),
  uniqueIndex("tutorial_progress_user_tutorial_unique").on(t.userId, t.tutorialId),
]);

export const insertTutorialProgressSchema = createInsertSchema(tutorialProgressTable).omit({ id: true, startedAt: true, updatedAt: true });
export type InsertTutorialProgress = z.infer<typeof insertTutorialProgressSchema>;
export type TutorialProgress = typeof tutorialProgressTable.$inferSelect;
