import { pgTable, uuid, text, integer, boolean, timestamp, check, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Pitch & Fix (Stack-200 UPGRADES 196 + 180, migration 0244).
 *
 * One intake for three kinds of submission:
 *  - "pitch"    — an idea pitch from the Pitch an idea door (category).
 *  - "fix"      — a fix report from the Report a fix door (page + severity).
 *  - "feedback" — a Feedback Pop-Up submission (star rating + one optional
 *                 line); it is fix-side intake: once it passes moderation
 *                 it surfaces on the Fix Board like any other fix item.
 *
 * MODERATION GATE: every row is born moderation_status = 'pending' and
 * NOTHING is public until a team member approves it through the admin
 * surface (GET/PATCH /api/admin/pitch-fix/*). The public board queries
 * filter moderation_status = 'approved' in the store layer — there is
 * no code path that lists a pending or rejected row publicly.
 *
 * Statuses are set by the team only:
 *  pitch:    reviewing → approved → building → shipped
 *  fix/feedback: received → confirmed → fixing → fixed
 *
 * NO PRICES, NO REWARDS: this schema deliberately has no price, credit,
 * or reward column and no rail reads it — the reward question was never
 * ruled by the owner and stays uninvented (board item 196).
 */

export const PITCH_FIX_KINDS = ["pitch", "fix", "feedback"] as const;
export type PitchFixKind = (typeof PITCH_FIX_KINDS)[number];

export const PITCH_FIX_SOURCES = ["door", "feedback_popup"] as const;
export type PitchFixSource = (typeof PITCH_FIX_SOURCES)[number];

export const PITCH_CATEGORIES = ["create", "world", "money", "social", "other"] as const;
export type PitchCategory = (typeof PITCH_CATEGORIES)[number];

/** Pages a fix can be reported against (the preview's Where list). */
export const FIX_PAGES = [
  "video_editor",
  "make_song_video",
  "audio_studio",
  "thumbnail_studio",
  "branding_kit",
  "the_world",
  "go_live",
  "earnings",
  "profile",
  "somewhere_else",
] as const;
export type FixPage = (typeof FIX_PAGES)[number];

export const FIX_SEVERITIES = ["blocks_me", "annoying", "small"] as const;
export type FixSeverity = (typeof FIX_SEVERITIES)[number];

export const PITCH_BOARD_STATUSES = ["reviewing", "approved", "building", "shipped"] as const;
export type PitchBoardStatus = (typeof PITCH_BOARD_STATUSES)[number];

export const FIX_BOARD_STATUSES = ["received", "confirmed", "fixing", "fixed"] as const;
export type FixBoardStatus = (typeof FIX_BOARD_STATUSES)[number];

export const PITCH_FIX_MODERATION_STATUSES = ["pending", "approved", "rejected"] as const;
export type PitchFixModerationStatus = (typeof PITCH_FIX_MODERATION_STATUSES)[number];

export const pitchFixSubmissionsTable = pgTable("pitch_fix_submissions", {
  id:               uuid("id").primaryKey().defaultRandom(),
  kind:             text("kind").notNull(),
  source:           text("source").notNull().default("door"),
  submitterUserId:  uuid("submitter_user_id").notNull(),
  /** Display-name snapshot at filing time, so the board and the shipped
   *  strip keep crediting the pitcher even if they rename later. */
  submitterName:    text("submitter_name").notNull().default("Creator"),
  title:            text("title").notNull(),
  body:             text("body").notNull().default(""),
  why:              text("why"),
  category:         text("category"),
  page:             text("page"),
  severity:         text("severity"),
  /** Feedback Pop-Ups only: 1–5 stars. */
  rating:           integer("rating"),
  status:           text("status").notNull(),
  moderationStatus: text("moderation_status").notNull().default("pending"),
  upvoteCount:      integer("upvote_count").notNull().default(0),
  moderatedByUserId: uuid("moderated_by_user_id"),
  moderatedAt:      timestamp("moderated_at", { withTimezone: true }),
  /** Set when the team moves a pitch to shipped / a fix to fixed —
   *  drives the RECENTLY SHIPPED strip ordering. */
  shippedAt:        timestamp("shipped_at", { withTimezone: true }),
  createdAt:        timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:        timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  check("pitch_fix_submissions_kind_check", sql`${t.kind} IN ('pitch', 'fix', 'feedback')`),
  check("pitch_fix_submissions_source_check", sql`${t.source} IN ('door', 'feedback_popup')`),
  check("pitch_fix_submissions_category_check", sql`${t.category} IS NULL OR ${t.category} IN ('create', 'world', 'money', 'social', 'other')`),
  check("pitch_fix_submissions_page_check", sql`${t.page} IS NULL OR ${t.page} IN ('video_editor', 'make_song_video', 'audio_studio', 'thumbnail_studio', 'branding_kit', 'the_world', 'go_live', 'earnings', 'profile', 'somewhere_else')`),
  check("pitch_fix_submissions_severity_check", sql`${t.severity} IS NULL OR ${t.severity} IN ('blocks_me', 'annoying', 'small')`),
  check("pitch_fix_submissions_rating_check", sql`${t.rating} IS NULL OR (${t.rating} >= 1 AND ${t.rating} <= 5)`),
  check("pitch_fix_submissions_status_check", sql`${t.status} IN ('reviewing', 'approved', 'building', 'shipped', 'received', 'confirmed', 'fixing', 'fixed')`),
  check("pitch_fix_submissions_moderation_check", sql`${t.moderationStatus} IN ('pending', 'approved', 'rejected')`),
  index("pitch_fix_submissions_board_idx").on(t.moderationStatus, t.kind, t.status, t.createdAt),
  index("pitch_fix_submissions_submitter_idx").on(t.submitterUserId, t.createdAt),
]);

export const pitchFixVotesTable = pgTable("pitch_fix_votes", {
  submissionId: uuid("submission_id").notNull(),
  userId:       uuid("user_id").notNull(),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("pitch_fix_votes_unique_idx").on(t.submissionId, t.userId),
  index("pitch_fix_votes_submission_idx").on(t.submissionId),
]);

/**
 * Feedback Pop-Up state per account (UPGRADES 180): the Settings ON/OFF
 * toggle plus the hard frequency cap. One row per account; no row = the
 * default (prompts ON, never prompted yet). last_prompted_at is stamped
 * when a prompt is actually SHOWN — submit or dismiss, the cap counts
 * the showing, so a prompt can never appear more than once per 7 days.
 */
export const feedbackPromptPrefsTable = pgTable("feedback_prompt_prefs", {
  userId:         uuid("user_id").primaryKey(),
  enabled:        boolean("enabled").notNull().default(true),
  lastPromptedAt: timestamp("last_prompted_at", { withTimezone: true }),
  promptCount:    integer("prompt_count").notNull().default(0),
  updatedAt:      timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type PitchFixSubmission = typeof pitchFixSubmissionsTable.$inferSelect;
export type FeedbackPromptPrefs = typeof feedbackPromptPrefsTable.$inferSelect;
