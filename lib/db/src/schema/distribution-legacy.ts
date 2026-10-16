import { pgTable, uuid, text, timestamp, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

/* ── Stack 11 "Distribution & Legacy" — in-house half (migration 0139) ────
   Everything here lives at the END of the chain (the standalone release
   flow + Business/Get Paid + Promote + Settings), never inside an editor.
   Money never moves in this stack: split statements are read-only
   accounting over recorded royalties, takedown/edit requests are our
   records until a delivery pipe exists, and permanence elections record
   the creator's on-platform election only. */

export const RELEASE_LANDING_SOCIAL_KEYS = ["instagram", "tiktok", "youtube", "x", "website"] as const;

/** #1 Release landing extras: the presave page persists after release day
 *  as the release's smartlink — video, store and social links ride beside
 *  the existing presave platform links. One row per release. */
export const releaseLandingContentTable = pgTable("release_landing_content", {
  id: uuid("id").primaryKey().defaultRandom(),
  release_id: uuid("release_id").notNull(),
  user_id: uuid("user_id").notNull(),
  video_url: text("video_url"),
  store_url: text("store_url"),
  social_links: jsonb("social_links").$type<Record<string, string>>().notNull().default({}),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("release_landing_content_release_uidx").on(t.release_id), index("release_landing_content_user_idx").on(t.user_id)]);

/** #2 Real account pre-saves: one row per (release, fan account, platform),
 *  written ONLY after the platform's own API confirmed the library save.
 *  A row is never written for a follow/email capture. */
export const presaveAccountActionsTable = pgTable("presave_account_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  release_id: uuid("release_id").notNull(),
  user_id: uuid("user_id").notNull(),
  platform: text("platform").notNull().default("spotify"),
  item_kind: text("item_kind").notNull(), // track | album
  item_id: text("item_id").notNull(),
  status: text("status").notNull().default("saved"), // saved
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("presave_account_actions_uidx").on(t.release_id, t.user_id, t.platform), index("presave_account_actions_release_idx").on(t.release_id)]);

/** #4a Lyrics as a named release-package step: the lyrics plus the synced
 *  timing lines (the house lyric-timing shape: {text, start, end}) that
 *  ship with the release package. One row per release. */
export interface ReleaseTimedLyricLine { text: string; start: number; end: number }
export const releaseLyricsPackagesTable = pgTable("release_lyrics_packages", {
  id: uuid("id").primaryKey().defaultRandom(),
  release_id: uuid("release_id").notNull(),
  user_id: uuid("user_id").notNull(),
  lyrics: text("lyrics").notNull().default(""),
  timed_lines: jsonb("timed_lines").$type<ReleaseTimedLyricLine[]>().notNull().default([]),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("release_lyrics_packages_release_uidx").on(t.release_id)]);

export const RELEASE_CHANGE_KINDS = ["takedown", "edit"] as const;
export type ReleaseChangeKind = (typeof RELEASE_CHANGE_KINDS)[number];
export const RELEASE_CHANGE_STATUSES = ["requested", "acknowledged", "sent_to_partner"] as const;
export type ReleaseChangeStatus = (typeof RELEASE_CHANGE_STATUSES)[number];

/** #4b Takedown/edit REQUESTS. The request flow is ours; `sent_to_partner`
 *  is reachable only when a real delivery pipe exists — nothing in this
 *  stack moves a request past `acknowledged`. */
export const releaseChangeRequestsTable = pgTable("release_change_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  release_id: uuid("release_id").notNull(),
  user_id: uuid("user_id").notNull(),
  kind: text("kind").notNull().$type<ReleaseChangeKind>(),
  reason: text("reason").notNull().default(""),
  details: text("details").notNull().default(""),
  status: text("status").notNull().default("requested").$type<ReleaseChangeStatus>(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("release_change_requests_release_idx").on(t.release_id, t.created_at), index("release_change_requests_user_idx").on(t.user_id, t.created_at)]);

export const PERMANENCE_SCOPES = ["release", "catalog"] as const;
export type PermanenceScope = (typeof PERMANENCE_SCOPES)[number];
export const PERMANENCE_ELECTIONS = ["permanent", "standard"] as const;
export type PermanenceElection = (typeof PERMANENCE_ELECTIONS)[number];

/** #5 Permanence elections, recorded beside Stack 10's succession
 *  designation (same Settings area). An election records the creator's
 *  on-platform guarantee choice; it binds this platform only. */
export const releasePermanenceElectionsTable = pgTable("release_permanence_elections", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  release_id: uuid("release_id"),
  scope: text("scope").notNull().$type<PermanenceScope>(),
  election: text("election").notNull().default("permanent").$type<PermanenceElection>(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("release_permanence_user_idx").on(t.user_id, t.scope), uniqueIndex("release_permanence_release_uidx").on(t.user_id, t.release_id)]);

export const ROSTER_STATUSES = ["invited", "accepted", "declined", "removed"] as const;
export type RosterStatus = (typeof ROSTER_STATUSES)[number];

/** #7 Label roster v1. PERMISSION RULE (implemented in the routes):
 *  the roster manager may invite and may see roster status only. An
 *  artist's releases become visible to the manager (READ-ONLY list +
 *  detail) only when the artist has BOTH accepted the roster invite AND
 *  switched on `distribution_access`. The manager can never edit, submit,
 *  split, or delete an artist's release — those stay owner-only. */
export const labelRosterMembersTable = pgTable("label_roster_members", {
  id: uuid("id").primaryKey().defaultRandom(),
  manager_user_id: uuid("manager_user_id").notNull(),
  team_id: uuid("team_id"),
  artist_user_id: uuid("artist_user_id"),
  artist_name: text("artist_name").notNull().default(""),
  artist_email: text("artist_email").notNull(),
  status: text("status").notNull().default("invited").$type<RosterStatus>(),
  distribution_access: boolean("distribution_access").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("label_roster_manager_email_uidx").on(t.manager_user_id, t.artist_email), index("label_roster_artist_idx").on(t.artist_user_id), index("label_roster_manager_idx").on(t.manager_user_id)]);

export const UNLOCK_GATE_ACTIONS = ["follow", "share"] as const;
export type UnlockGateAction = (typeof UNLOCK_GATE_ACTIONS)[number];

/** #8 Generalized social-unlock gates (Promote). The content URL is never
 *  served until the gate verifies: follow gates check the real follows
 *  graph; share gates check a recorded share action by the signed-in fan. */
export const socialUnlockGatesTable = pgTable("social_unlock_gates", {
  id: uuid("id").primaryKey().defaultRandom(),
  owner_user_id: uuid("owner_user_id").notNull(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  action: text("action").notNull().$type<UnlockGateAction>(),
  target_profile_id: uuid("target_profile_id"),
  content_url: text("content_url").notNull(),
  content_label: text("content_label").notNull().default(""),
  active: boolean("active").notNull().default(true),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("social_unlock_gates_slug_uidx").on(t.slug), index("social_unlock_gates_owner_idx").on(t.owner_user_id)]);

/** A share action WE recorded for a signed-in fan on a specific gate.
 *  Anonymous or unrecorded shares never unlock anything. */
export const socialUnlockShareRecordsTable = pgTable("social_unlock_share_records", {
  id: uuid("id").primaryKey().defaultRandom(),
  gate_id: uuid("gate_id").notNull(),
  user_id: uuid("user_id").notNull(),
  channel: text("channel").notNull().default(""),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("social_unlock_shares_gate_user_uidx").on(t.gate_id, t.user_id), index("social_unlock_shares_gate_idx").on(t.gate_id)]);

export type ReleaseLandingContent = typeof releaseLandingContentTable.$inferSelect;
export type PresaveAccountAction = typeof presaveAccountActionsTable.$inferSelect;
export type ReleaseLyricsPackage = typeof releaseLyricsPackagesTable.$inferSelect;
export type ReleaseChangeRequest = typeof releaseChangeRequestsTable.$inferSelect;
export type ReleasePermanenceElection = typeof releasePermanenceElectionsTable.$inferSelect;
export type LabelRosterMember = typeof labelRosterMembersTable.$inferSelect;
export type SocialUnlockGate = typeof socialUnlockGatesTable.$inferSelect;
