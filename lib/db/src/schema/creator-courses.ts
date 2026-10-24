import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  check,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { storeProductsTable } from "./storefront";
import { profileVideosTable } from "./creator-platform";

/**
 * Creator Courses — PENDING MIGRATION (do not assume this schema is live).
 *
 * The exact SQL for these tables + the store_products kind widening lives
 * in the lane evidence file .lane/MIGRATION-NEEDED.md; the migration
 * NUMBER is assigned at stack join (0205 is held by other lanes). Until
 * that migration lands, every course read/write in the API fails closed
 * (lib/courses.ts catches the missing-table error and answers 503
 * COURSES_NOT_LIVE) — a course can never half-exist or leak content.
 *
 * Shape (built on rails, never a new LMS):
 *   store_products (kind='course')  the sellable thing: creator-set
 *                                    price, existing storefront checkout /
 *                                    verify / claim rails, flat 5% fee.
 *   course_sections                ordered sections of one course.
 *   course_lessons                 ordered lessons in a section: a video
 *                                    lesson points at an existing
 *                                    profile_videos row (the site's
 *                                    existing video hosting); a text
 *                                    lesson carries its body; either may
 *                                    carry ONE attachment (title + URL —
 *                                    the tutorial_resources pattern,
 *                                    kept to one so the tree stays cheap).
 *                                    drip_day_offset unlocks the lesson
 *                                    that many days after purchase;
 *                                    is_preview makes it the free sample
 *                                    (Paid Series' preview-episode rule).
 *   course_lesson_progress         per-buyer lesson progress, the
 *                                    tutorial_progress shape (status
 *                                    derived server-side, resume point =
 *                                    last position) so course lessons play
 *                                    through the Academy tutorial player
 *                                    pattern with the same resume rules.
 *
 * ENTITLEMENT: no enrollment table — a completed store_orders row for
 * the course product IS the unlock, exactly as a completed
 * digital_sales row is the unlock for a Paid Series. A refunded order
 * stops unlocking the moment its status flips.
 */

export const COURSE_LESSON_KINDS = ["video", "text"] as const;
export type CourseLessonKind = (typeof COURSE_LESSON_KINDS)[number];

export const courseSectionsTable = pgTable("course_sections", {
  id:        uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id").notNull().references(() => storeProductsTable.id, { onDelete: "cascade" }),
  title:     text("title").notNull(),
  position:  integer("position").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("course_sections_product_idx").on(t.productId),
  uniqueIndex("course_sections_position_unique").on(t.productId, t.position),
]);

export const insertCourseSectionSchema = createInsertSchema(courseSectionsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertCourseSection = z.infer<typeof insertCourseSectionSchema>;
export type CourseSection = typeof courseSectionsTable.$inferSelect;

export const courseLessonsTable = pgTable("course_lessons", {
  id:             uuid("id").primaryKey().defaultRandom(),
  sectionId:      uuid("section_id").notNull().references(() => courseSectionsTable.id, { onDelete: "cascade" }),
  title:          text("title").notNull(),
  position:       integer("position").notNull().default(0),
  kind:           text("kind").$type<CourseLessonKind>().notNull().default("video"),
  /** The lesson's video on the existing hosting (profile_videos).
      NULL for text lessons and for videos still in production. */
  videoId:        uuid("video_id").references(() => profileVideosTable.id, { onDelete: "set null" }),
  /** The lesson itself for text lessons; notes for video lessons. */
  body:           text("body").notNull().default(""),
  attachmentTitle: text("attachment_title"),
  attachmentUrl:   text("attachment_url"),
  /** Days after purchase when this lesson unlocks. 0 = at purchase. */
  dripDayOffset:  integer("drip_day_offset").notNull().default(0),
  /** The free sample: readable/watchable without buying. */
  isPreview:      boolean("is_preview").notNull().default(false),
  createdAt:      timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("course_lessons_kind_check", sql`${t.kind} IN ('video','text')`),
  check("course_lessons_drip_check", sql`${t.dripDayOffset} >= 0`),
  index("course_lessons_section_idx").on(t.sectionId),
  uniqueIndex("course_lessons_position_unique").on(t.sectionId, t.position),
]);

export const insertCourseLessonSchema = createInsertSchema(courseLessonsTable).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertCourseLesson = z.infer<typeof insertCourseLessonSchema>;
export type CourseLesson = typeof courseLessonsTable.$inferSelect;

export const COURSE_PROGRESS_STATUSES = ["started", "in_progress", "completed"] as const;
export type CourseProgressStatus = (typeof COURSE_PROGRESS_STATUSES)[number];

export const courseLessonProgressTable = pgTable("course_lesson_progress", {
  id:              uuid("id").primaryKey().defaultRandom(),
  userId:          uuid("user_id").notNull(),
  lessonId:        uuid("lesson_id").notNull().references(() => courseLessonsTable.id, { onDelete: "cascade" }),
  /** Denormalized course product so a buyer's whole-course progress
      reads in one query (the My Courses shelf %). */
  productId:       uuid("product_id").notNull().references(() => storeProductsTable.id, { onDelete: "cascade" }),
  status:          text("status").$type<CourseProgressStatus>().notNull().default("started"),
  lastPositionSec: integer("last_position_sec").notNull().default(0),
  startedAt:       timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt:     timestamp("completed_at", { withTimezone: true }),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("course_lesson_progress_status_check", sql`${t.status} IN ('started','in_progress','completed')`),
  uniqueIndex("course_lesson_progress_user_lesson_unique").on(t.userId, t.lessonId),
  index("course_lesson_progress_user_product_idx").on(t.userId, t.productId),
]);

export const insertCourseLessonProgressSchema = createInsertSchema(courseLessonProgressTable).omit({
  id: true, startedAt: true, updatedAt: true,
});
export type InsertCourseLessonProgress = z.infer<typeof insertCourseLessonProgressSchema>;
export type CourseLessonProgress = typeof courseLessonProgressTable.$inferSelect;
