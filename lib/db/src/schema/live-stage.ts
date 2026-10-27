import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { liveStreamsTable } from "./live-streams";
import { liveChatMessagesTable } from "./live-chat";

/* Live-stage upgrades (dedupe-audit deltas #172 / #166 / #153) —
   provisional migration 9999-live-stage-upgrades.sql (number assigned
   at stack join).

   creator_live_prefs — per-creator automation switches for the live
   surfaces, the sound_prefs pattern: one row per account, no row =
   the all-on defaults the lib reader returns. Every automated
   behavior the house runs on a creator's stream (auto-highlights,
   the Stage Manager co-host and each of its actions) carries its own
   user-facing on/off here, per the automated-behavior law.

   stream_highlight_proposals — Auto-Highlights (#172): when a stream
   ends and its recording registers, the house cuts its best-3 moments
   from the stream's OWN signals (chat spikes, tip moments, viewer
   peaks) and proposes them here. A proposal is a draft, never a post:
   status 'proposed' until the creator approves (the cut renders) or
   dismisses. Nothing publishes unapproved, ever. UNIQUE
   (stream_id, start_sec) makes the trigger exactly-once per window.

   live_stage_manager_state — Stage Manager (#166): the per-stream
   co-host runtime state that must survive across requests — the
   creator's mid-stream mute (the creator is always the senior host)
   and the co-host's current pin. Cooldown bookkeeping stays
   in-memory in the lib (single instance, like chat pacing). */

export interface StageManagerLinkRule {
  keyword: string;
  label: string;
  url: string;
}

export const creatorLivePrefsTable = pgTable("creator_live_prefs", {
  userId: uuid("user_id").primaryKey(),
  /* Auto-Highlights (#172): cut best-3 proposals when a stream ends. */
  autoHighlightsEnabled: boolean("auto_highlights_enabled").notNull().default(true),
  /* Stage Manager (#166) master + per-action switches. */
  stageManagerEnabled: boolean("stage_manager_enabled").notNull().default(true),
  stageManagerPinEnabled: boolean("stage_manager_pin_enabled").notNull().default(true),
  stageManagerLinksEnabled: boolean("stage_manager_links_enabled").notNull().default(true),
  stageManagerStingEnabled: boolean("stage_manager_sting_enabled").notNull().default(true),
  stageManagerFlagsEnabled: boolean("stage_manager_flags_enabled").notNull().default(true),
  /* The creator's own link-drop rules for the co-host: when chat
     mentions a keyword, the co-host drops the matching link. Set by
     the creator in the Stream Copilot desk; validated in the lib. */
  stageManagerLinkRules: jsonb("stage_manager_link_rules")
    .$type<StageManagerLinkRule[]>()
    .notNull()
    .default(sql`'[]'::jsonb`),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type CreatorLivePrefs = typeof creatorLivePrefsTable.$inferSelect;

export const HIGHLIGHT_PROPOSAL_STATUSES = ["proposed", "approved", "dismissed", "posted"] as const;
export type HighlightProposalStatus = (typeof HIGHLIGHT_PROPOSAL_STATUSES)[number];

export const streamHighlightProposalsTable = pgTable(
  "stream_highlight_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stream_id: uuid("stream_id")
      .notNull()
      .references(() => liveStreamsTable.id, { onDelete: "cascade" }),
    creator_user_id: uuid("creator_user_id").notNull(),
    start_sec: integer("start_sec").notNull(),
    end_sec: integer("end_sec").notNull(),
    title: text("title").notNull(),
    /* Honest provenance, written from the signals that picked the
       window — rendered to the creator as-is ("house pick from a
       chat spike + a 500 VB tip"), never dressed as anything else. */
    reason: text("reason").notNull(),
    /* The raw signal read: { chatPeak, tipVb, viewerPeak }. */
    signals: jsonb("signals")
      .$type<{ chatPeak: number; tipVb: number; viewerPeak: number }>()
      .notNull()
      .default(sql`'{"chatPeak":0,"tipVb":0,"viewerPeak":0}'::jsonb`),
    score: integer("score").notNull().default(0),
    status: text("status").$type<HighlightProposalStatus>().notNull().default("proposed"),
    /* The streamer-clips cut job that approval started, and where
       the rendered clip landed once it finished. */
    cut_job_id: text("cut_job_id"),
    output_ref: text("output_ref"),
    output_url: text("output_url"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("stream_highlight_proposals_stream_start_uniq").on(t.stream_id, t.start_sec),
    index("stream_highlight_proposals_stream_idx").on(t.stream_id, t.created_at),
    index("stream_highlight_proposals_creator_idx").on(t.creator_user_id, t.status),
  ],
);
export type StreamHighlightProposal = typeof streamHighlightProposalsTable.$inferSelect;

export const liveStageManagerStateTable = pgTable("live_stage_manager_state", {
  stream_id: uuid("stream_id")
    .primaryKey()
    .references(() => liveStreamsTable.id, { onDelete: "cascade" }),
  /* The creator muted the co-host mid-stream: every co-host action
     stops until they unmute. The creator is always the senior host. */
  muted: boolean("muted").notNull().default(false),
  /* The co-host's current pin (a chat message), if one is up. */
  pinned_message_id: uuid("pinned_message_id").references(() => liveChatMessagesTable.id, {
    onDelete: "set null",
  }),
  pinned_until: timestamp("pinned_until", { withTimezone: true }),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type LiveStageManagerState = typeof liveStageManagerStateTable.$inferSelect;
