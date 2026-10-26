import {
  pgTable,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/* ─── Wave-4 remainder #48–#49 storage (Stack-200 rem-wave4850) ──────────
   *** PROVISIONAL MIGRATION *** These tables are created by
   lib/db/migrations/9999-wave4850.sql (provisional number — renumbered
   at join). Until it lands, every WRITE route for these features
   answers an honest 503 ("not ready") and every READ path treats a
   missing table as "feature has no stored state yet" — behaviour is
   identical to today. Pure logic lives in the api-server:
   lib/evergreen.ts (#48) and lib/supporter-board.ts (#49).

   #50 (co-posts / co-releases) needs NO new tables: post_co_authors
   (migration 0207) and co_releases / co_release_sides (migration 0222)
   already exist at base; this lane only adds the missing profile
   surface that reads their by-profile endpoints. */

/* ── #48 Evergreen recycling ─────────────────────────────────────────────
   One settings row per creator account. `enabled` is the per-creator
   on/off (default OFF — nothing is ever queued for a creator who has
   not turned it on). Approval is NOT a setting: a proposal can only
   become a scheduled-post DRAFT after the creator approves it, by
   design (see api-server lib/evergreen.ts) — evergreen never posts
   anything on its own. */
export interface EvergreenWindows {
  /** Days of week the creator allows re-posts on: 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** Local hour the window opens (0–23). */
  startHour: number;
  /** Local hour the window closes (1–24, after startHour). */
  endHour: number;
  /** IANA timezone the hours are read in. */
  timezone: string;
}

export const evergreenSettingsTable = pgTable(
  "evergreen_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull().unique(),
    enabled: boolean("enabled").notNull().default(false),
    windows: jsonb("windows").$type<EvergreenWindows>().notNull(),
    /* Base per-platform spacing in days before a post may resurface;
       the effective spacing DOUBLES each cycle (the decay stop —
       see spacingDaysForCycle in api-server lib/evergreen.ts). */
    base_spacing_days: integer("base_spacing_days").notNull().default(7),
    /* Hard stop: a post is never recycled more than this many times. */
    max_cycles: integer("max_cycles").notNull().default(3),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("evergreen_settings_user_uidx").on(t.user_id)],
);

export type EvergreenSettingsRow = typeof evergreenSettingsTable.$inferSelect;

/* One proposed resurfacing of one already-posted scheduled post.
   Born `pending_approval`; the creator's approve turns it into a free
   scheduled-post DRAFT (status recorded here as `approved` with the
   draft's id) — the creator still presses Schedule in the Scheduler
   themselves, on the scheduler's normal rail. Nothing here can post. */
export const EVERGREEN_PROPOSAL_STATUSES = [
  "pending_approval",
  "approved",
  "rejected",
  "expired",
] as const;
export type EvergreenProposalStatus = (typeof EVERGREEN_PROPOSAL_STATUSES)[number];

export const evergreenProposalsTable = pgTable(
  "evergreen_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(),
    /* The back-catalog post being resurfaced (scheduled_posts.id). */
    source_post_id: uuid("source_post_id").notNull(),
    /* 1-based recycle cycle this proposal would be. */
    cycle: integer("cycle").notNull(),
    /* The in-window slot proposed for the resurfacing. */
    proposed_slot: timestamp("proposed_slot", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("pending_approval"),
    /* Set on approve: the scheduled_posts draft the approval created. */
    draft_post_id: uuid("draft_post_id"),
    decided_at: timestamp("decided_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("evergreen_proposals_user_status_idx").on(t.user_id, t.status),
    index("evergreen_proposals_source_idx").on(t.source_post_id),
  ],
);

export type EvergreenProposalRow = typeof evergreenProposalsTable.$inferSelect;

/* ── #49 Top-supporter recognition ───────────────────────────────────────
   Per-creator board settings: whether the board shows on the profile
   and the creator's OWN perk words, stated on the board in plain
   words (the N6 Front Row Boards delta). Perks are free text the
   creator writes — the house invents no perks and no prices here. */
export const supporterBoardSettingsTable = pgTable(
  "supporter_board_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profile_id: uuid("profile_id").notNull().unique(),
    enabled: boolean("enabled").notNull().default(true),
    perks_text: text("perks_text").notNull().default(""),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("supporter_board_settings_profile_uidx").on(t.profile_id)],
);

export type SupporterBoardSettingsRow = typeof supporterBoardSettingsTable.$inferSelect;

/* A fan's opt-out from ONE creator's public supporter board. The fan's
   support still counts in the creator's private Fan Graph — opting
   out only removes the fan's name from the PUBLIC board and badge. */
export const supporterBoardOptOutsTable = pgTable(
  "supporter_board_opt_outs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profile_id: uuid("profile_id").notNull(),
    supporter_user_id: uuid("supporter_user_id").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("supporter_board_opt_outs_pair_uidx").on(t.profile_id, t.supporter_user_id),
    index("supporter_board_opt_outs_profile_idx").on(t.profile_id),
  ],
);

export type SupporterBoardOptOutRow = typeof supporterBoardOptOutsTable.$inferSelect;
