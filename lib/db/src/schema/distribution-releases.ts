import { pgTable, uuid, text, jsonb, timestamp, integer } from "drizzle-orm/pg-core";

/* Music distribution releases (DistroKid-style).
   v1 is "prepare + track": the release package (metadata, platform checklist,
   status) is assembled and stored here. Real platform delivery (Spotify/Apple
   API submissions) is a future integration — statuses never claim a platform
   accepted anything until a real delivery integration reports back. */
export const distributionReleasesTable = pgTable("distribution_releases", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  title: text("title").notNull(),
  artist_name: text("artist_name").notNull(),
  release_date: text("release_date"),
  /* Platforms the creator wants to distribute to (subset of DISTRIBUTION_PLATFORMS). */
  platforms: jsonb("platforms").notNull().$type<string[]>().default([]),
  audio_url: text("audio_url"),
  artwork_url: text("artwork_url"),
  /* AI-generated metadata package: { titleOptions, description, genreTags } */
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  /* AI-generated pre-release strategy: { timing, promoPlan, checklist } */
  strategy: jsonb("strategy").$type<Record<string, unknown>>(),
  /* draft → packaged (distribution fee paid, release package prepared).
     "delivered" is reserved for the future real-delivery integration. */
  status: text("status").notNull().default("draft"),
  credits_charged: integer("credits_charged").notNull().default(0),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  /* ── Pre-save page upgrades (HyperFollow parity, migration 0082) ───────
     presave_headline: artist-written hero line on the public page.
     presave_platform_links: { spotify: url, apple_music: url, ... } pasted
       by the artist — rendered as tappable platform buttons.
     presave_bonus_url: bonus content unlocked when a fan shares the page. */
  presave_headline: text("presave_headline"),
  presave_platform_links: jsonb("presave_platform_links")
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
  presave_bonus_url: text("presave_bonus_url"),
});

export type DistributionReleaseRow = typeof distributionReleasesTable.$inferSelect;
