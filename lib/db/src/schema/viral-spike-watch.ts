import { pgTable, uuid, text, integer, doublePrecision, timestamp, primaryKey, check, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Viral Spike Watch — episode state (Stack-100 #3, Wave 3, Lane 11).
 *
 * One row per published track/video that has ever spiked. This table is
 * the alert-fatigue ledger for lib/viral-spike-watch: while a row is
 * `episode_state='active'` the item is inside a spike episode and its
 * creator must NOT be alerted again; the row flips to `'rearmed'` only
 * when the item's daily plays fall back near its own baseline, after
 * which a fresh spike may alert once more.
 *
 * `baseline_daily` / `last_current_plays` are the REAL computed values
 * from play_events at the last evaluation (baseline_daily = plays in the
 * trailing 7 days ÷ 7; last_current_plays = plays in the current 24h
 * window) — stored so the episode record shows exactly what fired it,
 * never a synthesized metric.
 *
 * MIGRATION HELD FOR JOIN NUMBERING: the CREATE TABLE SQL lives in the
 * lane's MIGRATION-NEEDED.md (next free number is assigned at join —
 * 0205+ is already claimed by parallel stack29 lanes). Until it lands,
 * the detector's queries fail and its poller phase logs + skips
 * (fail-closed, never a crash, never a phantom alert).
 */
export const viralSpikeEpisodesTable = pgTable(
  "viral_spike_episodes",
  {
    kind: text("kind").notNull(),
    mediaId: uuid("media_id").notNull(),
    profileId: uuid("profile_id").notNull(),
    ownerUserId: uuid("owner_user_id").notNull(),
    /** 'active' = inside a spike episode (alert sent, muted);
     *  'rearmed' = fell back near baseline (a new spike may alert). */
    episodeState: text("episode_state").notNull().default("active"),
    /** Trailing-7-day plays ÷ 7 at the moment the episode fired. */
    baselineDaily: doublePrecision("baseline_daily").notNull().default(0),
    /** Plays in the current 24h window at the last evaluation. */
    lastCurrentPlays: integer("last_current_plays").notNull().default(0),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    rearmedAt: timestamp("rearmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.kind, t.mediaId] }),
    check("viral_spike_episodes_kind_check", sql`${t.kind} IN ('track','video')`),
    check("viral_spike_episodes_state_check", sql`${t.episodeState} IN ('active','rearmed')`),
    index("viral_spike_episodes_state_idx").on(t.episodeState),
    index("viral_spike_episodes_owner_idx").on(t.ownerUserId),
  ],
);

export type ViralSpikeEpisode = typeof viralSpikeEpisodesTable.$inferSelect;
