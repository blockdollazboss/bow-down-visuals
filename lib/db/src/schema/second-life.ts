import { pgTable, uuid, text, boolean, integer, doublePrecision, jsonb, timestamp, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Second Life (#161) — UPGRADE of Viral Spike Watch.
 *
 * Two tables:
 *
 * `second_life_prefs` — the Settings off-switch for catalog watching,
 * one row per account (mirrors sound_prefs). No row = watching ON (the
 * shipped default of the spike watch). When a creator turns watching
 * off, the watch skips their catalog entirely: no spike alerts and no
 * revival proposals for their items.
 *
 * `second_life_revivals` — one revival proposal per spike episode that
 * fired while watching was on. A proposal is a PLAN, never an action:
 * re-cut the spiking item as a short + a fresh cover, both deep-linked
 * into Create pre-loaded. Status walks proposed → approved (creator
 * tapped the one-tap revival) or proposed → dismissed. Approving never
 * posts anything — it only records the creator's yes and hands them
 * the pre-loaded Create links; the creator publishes from Create.
 *
 * `current_plays` / `baseline_daily` are the REAL computed values from
 * play_events at the moment the spike fired (copied from the spike
 * evaluation) — the proposal shows exactly what fired it, never a
 * synthesized metric.
 *
 * Migration: provisional 0286_second_life.sql (renumbered at join).
 */
export const secondLifePrefsTable = pgTable("second_life_prefs", {
  userId: uuid("user_id").primaryKey(),
  watchEnabled: boolean("watch_enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SecondLifePrefs = typeof secondLifePrefsTable.$inferSelect;

export const secondLifeRevivalsTable = pgTable(
  "second_life_revivals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerUserId: uuid("owner_user_id").notNull(),
    profileId: uuid("profile_id").notNull(),
    /** 'track' | 'video' — the spiking item's kind (play_events kind). */
    kind: text("kind").notNull(),
    mediaId: uuid("media_id").notNull(),
    /** 'proposed' | 'approved' | 'dismissed' — creator decides; the
     *  house never moves a proposal past 'proposed' on its own. */
    status: text("status").notNull().default("proposed"),
    /** The revival plan: { recut: {...}, cover: {...} } — Create
     *  deep links + source ids, built by lib/second-life. */
    plan: jsonb("plan").notNull(),
    /** Plays in the 24h window when the spike fired (real count). */
    currentPlays: integer("current_plays").notNull().default(0),
    /** Trailing-7-day plays ÷ 7 at fire time (real computed value). */
    baselineDaily: doublePrecision("baseline_daily").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    check("second_life_revivals_kind_check", sql`${t.kind} IN ('track','video')`),
    check("second_life_revivals_status_check", sql`${t.status} IN ('proposed','approved','dismissed')`),
    index("second_life_revivals_owner_status_idx").on(t.ownerUserId, t.status),
    index("second_life_revivals_media_idx").on(t.kind, t.mediaId),
  ],
);

export type SecondLifeRevival = typeof secondLifeRevivalsTable.$inferSelect;
