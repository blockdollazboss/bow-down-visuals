import { pgTable, uuid, text, integer, boolean, timestamp, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";
import { creatorProfilesTable } from "./creator-platform";
import { liveStreamsTable } from "./live-streams";
import { generatedClipsTable } from "./generated-clips";

/* Stack 9 — "Reach" (migration 0137).
   Multistream destination secrets, premieres, raids, stream-linked
   drops, per-channel loyalty, close-friends circles and broadcast
   channels. Stream keys are SECRETS: they live only in
   live_destination_keys, are write-only from the creator's settings,
   and no DTO ever returns them. Loyalty points are NOT Visual Bucs
   and are never convertible — there is deliberately no column or
   path that turns them into credits. */

/* ── #1 Multistream destination keys (server-side only) ─────────────── */
export const liveDestinationKeysTable = pgTable(
  "live_destination_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(),
    profile_id: uuid("profile_id").notNull().references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
    /* Destination platform slug, matching live_streams.destinations[].platform. */
    platform: text("platform").notNull(),
    /* RTMP ingest base URL the creator pasted from the destination. */
    ingest_url: text("ingest_url").notNull(),
    /* The stream key. Stored server-side (encrypted at rest when
       SOCIAL_TOKEN_KEY is configured — see lib/multistream.ts).
       NEVER selected into any DTO. */
    stream_key: text("stream_key").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("live_destination_keys_user_platform_uidx").on(t.user_id, t.platform),
    index("live_destination_keys_profile_idx").on(t.profile_id),
  ],
);
export type LiveDestinationKey = typeof liveDestinationKeysTable.$inferSelect;

/* ── #1b RTMP ingest keys (migration 0193) ──────────────────────────
   The mirror image of destination keys: a personal key an external
   encoder (OBS, VirtualDJ, Serato, djay) uses to push RTMP INTO the
   creator's Go Live stage. One active key per creator. The plain key
   is NEVER stored: key_lookup, a one-way SHA-256 of it, is the only
   key material at rest — the publish path authenticates by hash so
   the lookup never needs the plain text, and a database read alone
   doesn't hand out working keys. The plain key is shown to its owner
   exactly once, in the create/regenerate response that mints it, and
   is NEVER present in any stream DTO; a lost key is replaced by
   regenerating, never re-shown. revoked_at set = the key is dead;
   the publish path re-checks on every connect, and revocation also
   drops any live encoder connection for the creator. */
export const liveIngestKeysTable = pgTable(
  "live_ingest_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(),
    profile_id: uuid("profile_id").notNull().references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
    /* SHA-256 hex of the plain key — the publish-auth lookup column,
       and the ONLY key material stored. */
    key_lookup: text("key_lookup").notNull(),
    /* Last 4 characters of the plain key: safe for the owner to
       recognize which key a program holds. Not a secret. */
    key_hint: text("key_hint").notNull(),
    /* The creator's standing title for encoder-started streams
       (an encoder can't type one); null → the stage falls back to
       "<display name> live". */
    stream_title: text("stream_title"),
    /* Set when the creator revokes the key. Revocation is immediate:
       new publishes are refused and a live connection is dropped. */
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("live_ingest_keys_user_uidx").on(t.user_id),
    uniqueIndex("live_ingest_keys_lookup_uidx").on(t.key_lookup),
    index("live_ingest_keys_profile_idx").on(t.profile_id),
  ],
);
export type LiveIngestKey = typeof liveIngestKeysTable.$inferSelect;

/* ── #2 Premieres ───────────────────────────────────────────────────────
   A finished video scheduled to play as a live event. The chat room is
   a real live_streams row (provider 'premiere') created when the
   premiere enters its live window, so chat/heartbeat machinery is the
   live machinery, keyed to that row. Playback position is derived
   from the server clock (scheduled_at), never from a client claim. */
export const premieresTable = pgTable(
  "premieres",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    owner_user_id: uuid("owner_user_id").notNull(),
    profile_id: uuid("profile_id").notNull().references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
    clip_id: uuid("clip_id").references(() => generatedClipsTable.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    video_url: text("video_url").notNull(),
    duration_seconds: integer("duration_seconds").notNull(),
    scheduled_at: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    /* 'scheduled' | 'live' | 'ended' | 'cancelled' — 'live'/'ended' are
       also derived from the clock on read; the stored value is the
       last transition the server recorded. */
    status: text("status").notNull().default("scheduled"),
    stream_id: uuid("stream_id").references(() => liveStreamsTable.id, { onDelete: "set null" }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("premieres_scheduled_idx").on(t.scheduled_at),
    index("premieres_profile_idx").on(t.profile_id),
    index("premieres_owner_idx").on(t.owner_user_id),
  ],
);
export type Premiere = typeof premieresTable.$inferSelect;

/* ── #3 Raids ─────────────────────────────────────────────────────────── */
export const liveRaidsTable = pgTable(
  "live_raids",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source_stream_id: uuid("source_stream_id").notNull().references(() => liveStreamsTable.id, { onDelete: "cascade" }),
    source_profile_id: uuid("source_profile_id").notNull().references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
    target_stream_id: uuid("target_stream_id").notNull().references(() => liveStreamsTable.id, { onDelete: "cascade" }),
    target_profile_id: uuid("target_profile_id").notNull().references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
    /* Real viewer count from the heartbeat tracker at raid time. */
    viewer_count: integer("viewer_count").notNull().default(0),
    /* 'announced' | 'failed' */
    status: text("status").notNull().default("announced"),
    failure_reason: text("failure_reason"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("live_raids_source_idx").on(t.source_stream_id, t.created_at),
    index("live_raids_target_idx").on(t.target_stream_id, t.created_at),
  ],
);
export type LiveRaid = typeof liveRaidsTable.$inferSelect;

/* ── #5 Stream-linked drops ─────────────────────────────────────────────
   Watch progress is accrued server-side from heartbeat deltas (the
   client never dictates seconds). Awards are the cap ledger: the sum
   of amount_vb for a week_start across ALL users is the platform
   stream-drop spend, capped at the retention drop budget. */
export const streamWatchProgressTable = pgTable(
  "stream_watch_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(),
    stream_id: uuid("stream_id").notNull().references(() => liveStreamsTable.id, { onDelete: "cascade" }),
    seconds_watched: integer("seconds_watched").notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("stream_watch_progress_user_stream_uidx").on(t.user_id, t.stream_id)],
);
export type StreamWatchProgress = typeof streamWatchProgressTable.$inferSelect;

export const streamDropAwardsTable = pgTable(
  "stream_drop_awards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(),
    stream_id: uuid("stream_id").notNull().references(() => liveStreamsTable.id, { onDelete: "cascade" }),
    threshold_seconds: integer("threshold_seconds").notNull(),
    amount_vb: integer("amount_vb").notNull(),
    /* Monday (UTC) of the award week — the budget window key. */
    week_start: text("week_start").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("stream_drop_awards_user_stream_threshold_uidx").on(t.user_id, t.stream_id, t.threshold_seconds),
    index("stream_drop_awards_week_idx").on(t.week_start),
  ],
);
export type StreamDropAward = typeof streamDropAwardsTable.$inferSelect;

/* ── #6 Per-channel loyalty ───────────────────────────────────────────── */
export const loyaltySettingsTable = pgTable("loyalty_settings", {
  profile_id: uuid("profile_id").primaryKey().references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(true),
  /* Earn rules — chosen from the fixed menu in lib/loyalty.ts; the
     stored values can only ever be menu values (validated on write). */
  watch_points_per_10min: integer("watch_points_per_10min").notNull().default(10),
  chat_points: integer("chat_points").notNull().default(2),
  tip_points_per_100vb: integer("tip_points_per_100vb").notNull().default(5),
  /* Creator's custom reward (fixed-menu perk 'custom'): the text the
     creator fulfills manually + its cost from the allowed cost menu. */
  custom_reward_label: text("custom_reward_label"),
  custom_reward_cost: integer("custom_reward_cost"),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export type LoyaltySettings = typeof loyaltySettingsTable.$inferSelect;

export const loyaltyBalancesTable = pgTable(
  "loyalty_balances",
  {
    user_id: uuid("user_id").notNull(),
    profile_id: uuid("profile_id").notNull().references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
    points: integer("points").notNull().default(0),
    /* Watch minutes already converted to points (prevents re-paying
       the same minutes on every heartbeat). */
    watch_minutes_credited: integer("watch_minutes_credited").notNull().default(0),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.user_id, t.profile_id] })],
);
export type LoyaltyBalance = typeof loyaltyBalancesTable.$inferSelect;

export const loyaltyRedemptionsTable = pgTable(
  "loyalty_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(),
    profile_id: uuid("profile_id").notNull().references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
    /* 'shoutout' | 'priority_chat' | 'custom' — the fixed perk menu. */
    perk_kind: text("perk_kind").notNull(),
    perk_label: text("perk_label").notNull(),
    points_cost: integer("points_cost").notNull(),
    /* 'pending' | 'fulfilled' | 'declined' — the creator resolves it;
       a decline refunds the points. */
    status: text("status").notNull().default("pending"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolved_at: timestamp("resolved_at", { withTimezone: true }),
    resolved_by: uuid("resolved_by"),
  },
  (t) => [
    index("loyalty_redemptions_profile_status_idx").on(t.profile_id, t.status),
    index("loyalty_redemptions_user_idx").on(t.user_id),
  ],
);
export type LoyaltyRedemption = typeof loyaltyRedemptionsTable.$inferSelect;

/* ── #7 Close-friends circles ───────────────────────────────────────────
   Membership is by user (the viewer's auth id), enforced at READ time
   on every surface that serves posts/stories with audience
   'close_friends'. */
export const closeFriendsTable = pgTable(
  "close_friends",
  {
    owner_user_id: uuid("owner_user_id").notNull(),
    owner_profile_id: uuid("owner_profile_id").notNull().references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
    friend_user_id: uuid("friend_user_id").notNull(),
    friend_profile_id: uuid("friend_profile_id").references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.owner_user_id, t.friend_user_id] }),
    index("close_friends_friend_idx").on(t.friend_user_id),
    index("close_friends_owner_profile_idx").on(t.owner_profile_id),
  ],
);
export type CloseFriend = typeof closeFriendsTable.$inferSelect;

/* ── #8 Broadcast channels (one-to-many) ──────────────────────────────── */
export const broadcastChannelsTable = pgTable(
  "broadcast_channels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    profile_id: uuid("profile_id").notNull().unique().references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
    owner_user_id: uuid("owner_user_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("broadcast_channels_owner_idx").on(t.owner_user_id)],
);
export type BroadcastChannel = typeof broadcastChannelsTable.$inferSelect;

export const broadcastMembersTable = pgTable(
  "broadcast_members",
  {
    channel_id: uuid("channel_id").notNull().references(() => broadcastChannelsTable.id, { onDelete: "cascade" }),
    user_id: uuid("user_id").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.channel_id, t.user_id] }),
    index("broadcast_members_user_idx").on(t.user_id),
  ],
);
export type BroadcastMember = typeof broadcastMembersTable.$inferSelect;

export const broadcastPostsTable = pgTable(
  "broadcast_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    channel_id: uuid("channel_id").notNull().references(() => broadcastChannelsTable.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("broadcast_posts_channel_created_idx").on(t.channel_id, t.created_at)],
);
export type BroadcastPost = typeof broadcastPostsTable.$inferSelect;
