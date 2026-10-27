import { pgTable, uuid, text, boolean, integer, doublePrecision, timestamp, index } from "drizzle-orm/pg-core";

/* ─── Viral-spike response kit (orphan wave) ────────────────────────────
   Three tables, one job each:

   - viral_spike_prefs: the creator's single on/off switch (Settings).
     No row = ON by default; OFF stops all sampling and surfacing.
   - viral_spike_snapshots: timestamped reads of REAL cumulative view
     counters (showcase_items.views, profile_videos.view_count). This
     history is what makes velocity honest — the site previously kept
     only cumulative totals, from which no velocity can be derived.
   - viral_spike_alerts: one row per kit actually fired. Drives the
     24h cooldown (one spike, one kit — no dumb interruptions) and the
     creator's kit history. Numbers stored are exactly the measured
     verdict numbers; multiplier is NULLABLE because first-surge and
     silent-baseline spikes have no honest multiple. */

export const viralSpikePrefsTable = pgTable("viral_spike_prefs", {
  userId:    uuid("user_id").primaryKey(),
  enabled:   boolean("enabled").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
export type ViralSpikePrefs = typeof viralSpikePrefsTable.$inferSelect;

export const viralSpikeSnapshotsTable = pgTable(
  "viral_spike_snapshots",
  {
    id:         uuid("id").primaryKey().defaultRandom(),
    userId:     uuid("user_id").notNull(),
    /** showcase | short */
    contentKind: text("content_kind").notNull(),
    contentId:  uuid("content_id").notNull(),
    /** Cumulative views read from the content's real counter at recorded_at. */
    views:      integer("views").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("viral_spike_snapshots_content_idx").on(t.userId, t.contentKind, t.contentId, t.recordedAt),
  ],
);
export type ViralSpikeSnapshot = typeof viralSpikeSnapshotsTable.$inferSelect;

export const viralSpikeAlertsTable = pgTable(
  "viral_spike_alerts",
  {
    id:         uuid("id").primaryKey().defaultRandom(),
    userId:     uuid("user_id").notNull(),
    contentKind: text("content_kind").notNull(),
    contentId:  uuid("content_id").notNull(),
    title:      text("title").notNull().default(""),
    /** measured_multiplier | baseline_silent | first_surge */
    basis:      text("basis").notNull(),
    recentGain: integer("recent_gain").notNull(),
    recentVelocityPerHour: doublePrecision("recent_velocity_per_hour").notNull(),
    baselineVelocityPerHour: doublePrecision("baseline_velocity_per_hour"),
    multiplier: doublePrecision("multiplier"),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("viral_spike_alerts_user_idx").on(t.userId, t.detectedAt),
    index("viral_spike_alerts_content_idx").on(t.userId, t.contentKind, t.contentId, t.detectedAt),
  ],
);
export type ViralSpikeAlert = typeof viralSpikeAlertsTable.$inferSelect;
