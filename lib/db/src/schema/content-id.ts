import { pgTable, uuid, text, timestamp, boolean, date } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* ── Content ID Monitor ──────────────────────────────────────────────────
   YouTube Content ID opt-in management + manually-logged detected uses.
   Powers the "Content ID" tab in /analytics-hub (DistroKid YouTube
   Content ID parity).

   HONESTY: real Content ID claiming requires a distribution/CMS partnership
   we do NOT have. Opt-ins start at status 'pending_partner'; the claim
   endpoint refuses with a clear message naming the missing partnership. */

export const CONTENT_ID_OPTIN_STATUSES = [
  "pending_partner",
  "active",
  "paused",
  "opted_out",
] as const;
export type ContentIdOptinStatus = (typeof CONTENT_ID_OPTIN_STATUSES)[number];

export const CONTENT_ID_DETECTION_STATUSES = [
  "detected",
  "claim_pending",
  "claimed",
  "disputed",
  "released",
] as const;
export type ContentIdDetectionStatus = (typeof CONTENT_ID_DETECTION_STATUSES)[number];

export const contentIdOptinsTable = pgTable("content_id_optins", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  release_id: uuid("release_id"),
  track_title: text("track_title").notNull().default(""),
  artist_name: text("artist_name"),
  opted_in: boolean("opted_in").notNull().default(true),
  status: text("status").notNull().default("pending_partner").$type<ContentIdOptinStatus>(),
  opted_in_at: timestamp("opted_in_at", { withTimezone: true }).notNull().defaultNow(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const contentIdDetectionsTable = pgTable("content_id_detections", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  optin_id: uuid("optin_id"),
  video_url: text("video_url").notNull().default(""),
  channel_name: text("channel_name").notNull().default(""),
  status: text("status").notNull().default("detected").$type<ContentIdDetectionStatus>(),
  notes: text("notes").notNull().default(""),
  detected_at: date("detected_at"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertContentIdOptinSchema = createInsertSchema(contentIdOptinsTable)
  .omit({ id: true, created_at: true, updated_at: true, opted_in_at: true })
  .extend({
    status: z.enum(CONTENT_ID_OPTIN_STATUSES).default("pending_partner"),
    track_title: z.string().trim().min(1).max(200),
    artist_name: z.string().trim().max(200).optional().nullable(),
    release_id: z.string().uuid().optional().nullable(),
  });

export const insertContentIdDetectionSchema = createInsertSchema(contentIdDetectionsTable)
  .omit({ id: true, created_at: true, updated_at: true })
  .extend({
    status: z.enum(CONTENT_ID_DETECTION_STATUSES).default("detected"),
    video_url: z.string().trim().max(500).default(""),
    channel_name: z.string().trim().min(1).max(200),
    notes: z.string().trim().max(1000).default(""),
    optin_id: z.string().uuid().optional().nullable(),
    detected_at: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "detected_at must be YYYY-MM-DD")
      .optional()
      .nullable(),
  });

export const selectContentIdOptinSchema = createSelectSchema(contentIdOptinsTable);
export const selectContentIdDetectionSchema = createSelectSchema(contentIdDetectionsTable);

export type InsertContentIdOptin = z.infer<typeof insertContentIdOptinSchema>;
export type ContentIdOptin = typeof contentIdOptinsTable.$inferSelect;
export type InsertContentIdDetection = z.infer<typeof insertContentIdDetectionSchema>;
export type ContentIdDetection = typeof contentIdDetectionsTable.$inferSelect;
