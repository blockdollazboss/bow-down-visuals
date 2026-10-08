import { pgTable, uuid, text, integer, boolean, jsonb, timestamp, type AnyPgColumn } from "drizzle-orm/pg-core";
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
  featuredMedia:   jsonb("featured_media").$type<Record<string, unknown> | null>(),
  socialLinks:     jsonb("social_links").$type<Record<string, string>>().notNull().default({}),
  topCreators:     jsonb("top_creators").$type<Array<Record<string, unknown>>>().notNull().default([]),
  tipJarEnabled:   boolean("tip_jar_enabled").notNull().default(true),
  aiDesign:        jsonb("ai_design").$type<Record<string, unknown> | null>(),
  isPublic:        boolean("is_public").notNull().default(true),
  /** Gold checkmark: staff-verified creator (Worker 8, migration 0091). */
  isVerified:      boolean("is_verified").notNull().default(false),
  followerCount:   integer("follower_count").notNull().default(0),
  totalPlays:      integer("total_plays").notNull().default(0),
  createdAt:       timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

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
  /** Ordered array of {kind:'track'|'video', id: <uuid>} entries. */
  items:          jsonb("items").$type<Array<{ kind: "track" | "video"; id: string }>>().notNull().default([]),
  followerCount:  integer("follower_count").notNull().default(0),
  createdAt:      timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertPlaylistSchema = createInsertSchema(playlistsTable).omit({ id: true, createdAt: true });
export type InsertPlaylist = z.infer<typeof insertPlaylistSchema>;
export type Playlist = typeof playlistsTable.$inferSelect;
