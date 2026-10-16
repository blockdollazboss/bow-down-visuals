import { pgTable, uuid, text, timestamp, boolean, integer, doublePrecision, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* ── Stack 10 "Trust, safety & the literal end" (migration 0138) ─────────
   Deepens the existing trust machinery; it does not duplicate it:
   Content ID fingerprints + symmetric claims sit beside content-id.ts,
   succession designations record intent only (no automatic transfer),
   catalog exports extend GET /account/export, the mod console unifies
   live-chat moderation, stage rooms ride the live WS gateway, group
   roles/onboarding extend community groups, and retention events feed
   the analytics area. Money paths are read-only here. */

export const CONTENT_ID_CLAIM_STATUSES = ["pending", "accepted", "disputed", "resolved"] as const;
export type ContentIdClaimStatus = (typeof CONTENT_ID_CLAIM_STATUSES)[number];

/** One landmark: hash of a spectral-peak pair + its anchor time (frames). */
export interface FingerprintLandmark { h: number; t: number }

export const contentIdFingerprintsTable = pgTable("content_id_fingerprints", {
  id: uuid("id").primaryKey().defaultRandom(),
  optin_id: uuid("optin_id"),
  user_id: uuid("user_id").notNull(),
  track_title: text("track_title").notNull().default(""),
  landmarks: jsonb("landmarks").$type<FingerprintLandmark[]>().notNull().default([]),
  duration_seconds: doublePrecision("duration_seconds").notNull().default(0),
  sample_rate: integer("sample_rate").notNull().default(8000),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("content_id_fp_user_idx").on(t.user_id), index("content_id_fp_optin_idx").on(t.optin_id)]);

/** A fingerprint match IS the claim record: both parties see the same
 *  evidence and the same states. No claimant-first monetization grab —
 *  a match changes nothing about money until it is resolved. */
export const contentIdMatchesTable = pgTable("content_id_matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  fingerprint_id: uuid("fingerprint_id").notNull(),
  owner_user_id: uuid("owner_user_id").notNull(),
  uploader_user_id: uuid("uploader_user_id").notNull(),
  source_label: text("source_label").notNull().default(""),
  offset_seconds: doublePrecision("offset_seconds").notNull().default(0),
  confidence: doublePrecision("confidence").notNull().default(0),
  matched_landmarks: integer("matched_landmarks").notNull().default(0),
  total_landmarks: integer("total_landmarks").notNull().default(0),
  status: text("status").notNull().default("pending").$type<ContentIdClaimStatus>(),
  dispute_note: text("dispute_note").notNull().default(""),
  resolution_note: text("resolution_note").notNull().default(""),
  resolved_by: uuid("resolved_by"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("content_id_matches_owner_idx").on(t.owner_user_id), index("content_id_matches_uploader_idx").on(t.uploader_user_id)]);

export const LEGACY_STATUSES = ["pending", "accepted", "declined", "revoked"] as const;
export type LegacyStatus = (typeof LEGACY_STATUSES)[number];

/** Designation ONLY. Activation is a manual, human-reviewed process;
 *  no row in this table ever triggers a transfer by itself. Heirs never
 *  inherit private messages or payout credentials — see settings copy. */
export const legacyDesignationsTable = pgTable("legacy_designations", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  heir_user_id: uuid("heir_user_id").notNull(),
  status: text("status").notNull().default("pending").$type<LegacyStatus>(),
  instructions: text("instructions").notNull().default(""),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("legacy_designations_user_uidx").on(t.user_id), index("legacy_designations_heir_idx").on(t.heir_user_id)]);

export const catalogExportJobsTable = pgTable("catalog_export_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  status: text("status").notNull().default("queued"), // queued|running|complete|failed
  progress: integer("progress").notNull().default(0),
  manifest: jsonb("manifest"),
  error: text("error"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("catalog_export_jobs_user_idx").on(t.user_id, t.created_at)]);

export const chatAutomodRulesTable = pgTable("chat_automod_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  profile_id: uuid("profile_id").notNull(),
  block_links: boolean("block_links").notNull().default(false),
  blocked_words: jsonb("blocked_words").$type<string[]>().notNull().default([]),
  caps_percent: integer("caps_percent"), // null = off; else max % caps for messages >= caps_min_length
  caps_min_length: integer("caps_min_length").notNull().default(12),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("chat_automod_rules_profile_uidx").on(t.profile_id)]);

export const chatModActionsTable = pgTable("chat_mod_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  profile_id: uuid("profile_id"),
  stream_id: uuid("stream_id"),
  actor_user_id: uuid("actor_user_id"), // null = automod
  target_user_id: uuid("target_user_id"),
  action: text("action").notNull(), // flag|delete|mute|unmute|automod_flag|automod_block
  reason: text("reason").notNull().default(""),
  rule: text("rule"),
  message_body: text("message_body"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("chat_mod_actions_profile_idx").on(t.profile_id, t.created_at), index("chat_mod_actions_stream_idx").on(t.stream_id, t.created_at)]);

export const stageRoomsTable = pgTable("stage_rooms", {
  id: uuid("id").primaryKey().defaultRandom(),
  host_user_id: uuid("host_user_id").notNull(),
  profile_id: uuid("profile_id"),
  title: text("title").notNull().default(""),
  status: text("status").notNull().default("open"), // open|closed
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  closed_at: timestamp("closed_at", { withTimezone: true }),
}, (t) => [index("stage_rooms_status_idx").on(t.status, t.created_at)]);

export const groupJoinQuestionsTable = pgTable("group_join_questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  group_id: uuid("group_id").notNull(),
  question: text("question").notNull(),
  position: integer("position").notNull().default(0),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("group_join_questions_group_idx").on(t.group_id, t.position)]);

export const groupJoinRequestsTable = pgTable("group_join_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  group_id: uuid("group_id").notNull(),
  user_id: uuid("user_id").notNull(),
  answers: jsonb("answers").$type<Array<{ questionId: string; question: string; answer: string }>>().notNull().default([]),
  status: text("status").notNull().default("pending"), // pending|approved|denied
  reviewed_by: uuid("reviewed_by"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("group_join_requests_group_idx").on(t.group_id, t.status), uniqueIndex("group_join_requests_open_uidx").on(t.group_id, t.user_id).where(sql`${t.status} = 'pending'`)]);

export const videoRetentionEventsTable = pgTable("video_retention_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  video_id: uuid("video_id").notNull(),
  owner_user_id: uuid("owner_user_id"),
  viewer_user_id: uuid("viewer_user_id"),
  position_seconds: doublePrecision("position_seconds").notNull(),
  duration_seconds: doublePrecision("duration_seconds").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("video_retention_video_idx").on(t.video_id, t.created_at), index("video_retention_viewer_idx").on(t.viewer_user_id, t.created_at)]);

export type ContentIdFingerprint = typeof contentIdFingerprintsTable.$inferSelect;
export type ContentIdMatch = typeof contentIdMatchesTable.$inferSelect;
export type LegacyDesignation = typeof legacyDesignationsTable.$inferSelect;
export type CatalogExportJob = typeof catalogExportJobsTable.$inferSelect;
export type StageRoomRow = typeof stageRoomsTable.$inferSelect;
