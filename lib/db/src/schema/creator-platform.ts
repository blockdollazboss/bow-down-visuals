import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Creator Streaming Platform — profiles + media (migrations 0085, 0086, 0089).
 *
 * creator_profiles: one public creator page per user, ALL creator lanes
 * (music | video | gaming | podcast | film | tv | influencer | education | other).
 * profile_tracks / profile_videos: GENERIC audio/video content — a
 * podcaster's episodes live in profile_tracks, a YouTuber's uploads in
 * profile_videos (table names stay stable for the contract).
 * playlists: mixes OR episodic series (kind 'playlist' | 'series').
 */

export const creatorProfilesTable = pgTable("creator_profiles", {
  id:              uuid("id").primaryKey().defaultRandom(),
  userId:          uuid("user_id").notNull().unique(),
  slug:            text("slug").notNull().unique(),
  displayName:     text("display_name").notNull(),
  bio:             text("bio").notNull().default(""),
  avatarUrl:       text("avatar_url"),
  bannerUrl:       text("banner_url"),
  themeId:         text("theme_id").notNull().default("gold-lux"),
  /** Creator lane: music | video | gaming | podcast | film | tv | influencer | education | other */
  vertical:        text("vertical").notNull().default("music"),
  /** Stream schedule for gamers/streamers: array of {day, time, title}. twitch/youtube/kick URLs live in social_links. */
  streamSchedule:  jsonb("stream_schedule").$type<Array<{ day: string; time: string; title?: string }>>().notNull().default([]),
  /** Influencer media kit: {audience_size, engagement_rate, rates, niches} — brand-deal one-pager data. */
  mediaKit:        jsonb("media_kit").$type<Record<string, unknown> | null>(),
  themeConfig:     jsonb("theme_config").$type<Record<string, unknown>>().notNull().default({}),
  sections:        jsonb("sections").$type<Array<Record<string, unknown>>>().notNull().default([]),
  /** Block layout model (migration 0134, Stack 3 item 2 plumbing): an
      ordered list of {type, title, visible, config} blocks. Empty means
      "no saved layout" — reads derive the default from the profile's
      current section order, so an untouched profile renders as today. */
  layoutBlocks:    jsonb("layout_blocks").$type<Array<Record<string, unknown>>>().notNull().default([]),
  /** Spotlight pin (migration 0134, Stack 3 item 5): ONE featured item —
      kind 'track' | 'video' + the content's id. Both null = no pin. */
  pinnedKind:      text("pinned_kind").$type<"track" | "video" | null>(),
  pinnedItemId:    uuid("pinned_item_id"),
  /** Fan collection privacy (migration 0134, Stack 3 item 6): 'public'
      (house default — profiles/achievements are public by default) or
      'private'. */
  collectionVisibility: text("collection_visibility").$type<"public" | "private">().notNull().default("public"),
  featuredMedia:   jsonb("featured_media").$type<Record<string, unknown> | null>(),
  /** Extension fields (migration 0142, DE-20): edited in artist-setup
      and rendered defensively by the public page; the save schemas used
      to strip them, so merch / events / series / social posts never
      persisted. Free-form entry arrays, like the client types. */
  merchItems:      jsonb("merch_items").$type<Array<Record<string, unknown>>>().notNull().default([]),
  profileEvents:   jsonb("events").$type<Array<Record<string, unknown>>>().notNull().default([]),
  series:          jsonb("series").$type<Array<Record<string, unknown>>>().notNull().default([]),
  socialPosts:     jsonb("social_posts").$type<Array<Record<string, unknown>>>().notNull().default([]),
  socialLinks:     jsonb("social_links").$type<Record<string, string>>().notNull().default({}),
  topCreators:     jsonb("top_creators").$type<Array<Record<string, unknown>>>().notNull().default([]),
  tipJarEnabled:   boolean("tip_jar_enabled").notNull().default(true),
  /** Commerce tracking pixels (migration 0240, wave-4 #41): the
      creator's OWN Meta / TikTok / Google ad-platform IDs for their
      storefront — the same fields the release rail carries on
      distribution_releases (migration 0186). Validated server-side on
      save; all null = no pixel ever fires from the storefront. */
  metaPixelId:     text("meta_pixel_id"),
  tiktokPixelId:   text("tiktok_pixel_id"),
  googleTagId:     text("google_tag_id"),
  aiDesign:        jsonb("ai_design").$type<Record<string, unknown> | null>(),
  isPublic:        boolean("is_public").notNull().default(true),
  /** Gold checkmark: staff-verified creator (Worker 8, migration 0091). */
  isVerified:      boolean("is_verified").notNull().default(false),
  /** Official house/company account (migration 0125). Today exactly one:
      Thy Cheat Code (slug "thy-cheat-code") — the site's host and every
      creator's first friend. */
  isOfficial:      boolean("is_official").notNull().default(false),
  followerCount:   integer("follower_count").notNull().default(0),
  totalPlays:      integer("total_plays").notNull().default(0),
  /** Stripe Connect (Express) money-out. account id set at onboarding;
      flags synced from the account.updated webhook. */
  stripeConnectAccountId:     text("stripe_connect_account_id"),
  stripeConnectOnboarded:     boolean("stripe_connect_onboarded").notNull().default(false),
  stripeConnectChargesEnabled: boolean("stripe_connect_charges_enabled").notNull().default(false),
  stripeConnectPayoutsEnabled: boolean("stripe_connect_payouts_enabled").notNull().default(false),
  createdAt:       timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  /* Migration 0134: the pin is a track or a video; collection visibility
     is a closed set. Same names + predicates as the SQL constraints. */
  check("creator_profiles_pinned_kind_check", sql`${t.pinnedKind} IS NULL OR ${t.pinnedKind} IN ('track', 'video')`),
  check("creator_profiles_collection_visibility_check", sql`${t.collectionVisibility} IN ('public', 'private')`),
]);

export const insertCreatorProfileSchema = createInsertSchema(creatorProfilesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCreatorProfile = z.infer<typeof insertCreatorProfileSchema>;
export type CreatorProfile = typeof creatorProfilesTable.$inferSelect;

export const profileTracksTable = pgTable("profile_tracks", {
  id:                uuid("id").primaryKey().defaultRandom(),
  profileId:         uuid("profile_id").notNull().references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
  title:             text("title").notNull(),
  audioUrl:          text("audio_url").notNull(),
  artworkUrl:        text("artwork_url"),
  genre:             text("genre"),
  tags:              text("tags").array().notNull().default([]),
  isrc:              text("isrc"),
  durationSec:       integer("duration_sec").notNull().default(0),
  /** 0 = stream-only, >0 = paid download (Stripe, see digital_sales). */
  downloadPriceCents: integer("download_price_cents").notNull().default(0),
  /** Name-your-price (migration 0132): when enabled, buyers may pay any
      amount >= pwywMinCents instead of the fixed download price. */
  pwywEnabled:       boolean("pwyw_enabled").notNull().default(false),
  pwywMinCents:      integer("pwyw_min_cents").notNull().default(0),
  playCount:         integer("play_count").notNull().default(0),
  likeCount:         integer("like_count").notNull().default(0),
  repostCount:       integer("repost_count").notNull().default(0),
  commentCount:      integer("comment_count").notNull().default(0),
  isPublished:       boolean("is_published").notNull().default(false),
  createdAt:         timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertProfileTrackSchema = createInsertSchema(profileTracksTable).omit({ id: true, createdAt: true });
export type InsertProfileTrack = z.infer<typeof insertProfileTrackSchema>;
export type ProfileTrack = typeof profileTracksTable.$inferSelect;

export const profileVideosTable = pgTable("profile_videos", {
  id:                uuid("id").primaryKey().defaultRandom(),
  profileId:         uuid("profile_id").notNull().references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
  title:             text("title").notNull(),
  videoUrl:          text("video_url").notNull(),
  thumbnailUrl:      text("thumbnail_url"),
  /** Accessibility description of the cover frame (#29, Stack-100 #3):
   *  creator-written or AI-suggested at the publish door, editable before
   *  it ships, rendered as the cover image's alt on public surfaces.
   *  Column lands via the held migration in this lane's
   *  .lane/MIGRATION-NEEDED.md — write doors probe for it and degrade
   *  gracefully (publish/shorts keep working) until it lands. */
  thumbnailAltText:  text("thumbnail_alt_text"),
  description:       text("description").notNull().default(""),
  genre:             text("genre"),
  tags:              text("tags").array().notNull().default([]),
  durationSec:       integer("duration_sec").notNull().default(0),
  /** Optional episodic numbering for film/TV (series live as playlists with kind='series'). */
  season:            integer("season"),
  episode:           integer("episode"),
  /** Sound linkage: the track this video uses (nullable). Lets UI link video <-> track both ways. */
  soundTrackId:      uuid("sound_track_id").references(() => profileTracksTable.id, { onDelete: "set null" }),
  /** 0 = stream-only, >0 = paid download (Stripe, see digital_sales). */
  downloadPriceCents: integer("download_price_cents").notNull().default(0),
  /** Name-your-price (migration 0132): when enabled, buyers may pay any
      amount >= pwywMinCents instead of the fixed download price. */
  pwywEnabled:       boolean("pwyw_enabled").notNull().default(false),
  pwywMinCents:      integer("pwyw_min_cents").notNull().default(0),
  viewCount:         integer("view_count").notNull().default(0),
  likeCount:         integer("like_count").notNull().default(0),
  repostCount:       integer("repost_count").notNull().default(0),
  commentCount:      integer("comment_count").notNull().default(0),
  isPublished:       boolean("is_published").notNull().default(false),
  /** Shorts mechanics (0091): TikTok-style vertical short flag. */
  isShort:           boolean("is_short").notNull().default(false),
  /** Duet parent (the original short being duetted). NULL = original. */
  /* Self-FK note (Worker 10): the `as unknown` breaks a type-inference cycle
     that fails declaration emit (`tsc -b`, which the Docker build typecheck
     needs). Runtime is unchanged — the thunk still returns this table's id. */
  duetWith:          uuid("duet_with").references((): AnyPgColumn => (profileVideosTable as unknown as { id: AnyPgColumn }).id, { onDelete: "set null" }),
  /** Stitch parent (the original short being stitched). NULL = original. */
  stitchWith:        uuid("stitch_with").references((): AnyPgColumn => (profileVideosTable as unknown as { id: AnyPgColumn }).id, { onDelete: "set null" }),
  /** Sound used by this short: free-text id (slug) + display metadata. */
  soundId:           text("sound_id"),
  soundTitle:        text("sound_title"),
  soundUrl:          text("sound_url"),
  /** Denormalized count of videos using this sound_id. */
  soundUseCount:     integer("sound_use_count").notNull().default(0),
  createdAt:         timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertProfileVideoSchema = createInsertSchema(profileVideosTable).omit({ id: true, createdAt: true });
export type InsertProfileVideo = z.infer<typeof insertProfileVideoSchema>;
export type ProfileVideo = typeof profileVideosTable.$inferSelect;

export const playlistsTable = pgTable("playlists", {
  id:             uuid("id").primaryKey().defaultRandom(),
  ownerProfileId: uuid("owner_profile_id").notNull().references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
  title:          text("title").notNull(),
  description:    text("description").notNull().default(""),
  coverUrl:       text("cover_url"),
  isPublic:       boolean("is_public").notNull().default(true),
  /** 'playlist' = mix, 'series' = episodic film/TV series (ordered items = episode order). */
  kind:           text("kind").notNull().default("playlist"),
  /** Paid Series (migration 0192): the creator's OWN one-time unlock price
      in cents — only meaningful for kind='series'. NULL/0 = free series.
      Purchases ride the digital store rail (digital_sales, item_kind
      'series'); the completed sale row IS the buyer's unlock, and a
      refunded sale (0183 clawback flips status) locks the episodes again. */
  priceCents:     integer("price_cents"),
  /** The ONE episode a non-buyer may watch free (trailer / first episode),
      stored exactly like an items entry: {kind:'track'|'video', id: uuid}.
      NULL = no free preview. */
  previewItem:    jsonb("preview_item").$type<{ kind: "track" | "video"; id: string } | null>().default(null),
  /** Ordered array of {kind:'track'|'video', id: <uuid>} entries. */
  items:          jsonb("items").$type<Array<{ kind: "track" | "video" | "series"; id: string }>>().notNull().default([]),
  followerCount:  integer("follower_count").notNull().default(0),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertPlaylistSchema = createInsertSchema(playlistsTable).omit({ id: true, createdAt: true });
export type InsertPlaylist = z.infer<typeof insertPlaylistSchema>;
export type Playlist = typeof playlistsTable.$inferSelect;
