import { pgTable, uuid, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Discord Live integration (v1).
   The user streams on Discord via Go Live — it's their community hub.
   A per-user Discord channel webhook URL lets the site post rich "LIVE NOW"
   / "stream ended" / "new video" embeds straight to their server.

   The webhook URL is a secret: stored AES-256-GCM encrypted with
   SOCIAL_TOKEN_KEY (see social-crypto.ts) — never plaintext, never logged,
   never returned to the client. GET /discord/status only reports whether a
   webhook is configured (plus non-secret display prefs).

   Streams are lightweight records: scheduled (upcoming), live (currently
   announced), ended. The site never touches Discord's voice/video — it only
   posts webhook embeds; the user still hits Go Live in Discord itself. */

export const discordWebhooksTable = pgTable(
  "discord_webhooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull().unique(),
    /* AES-256-GCM encrypted webhook URL (encryptToken format). */
    webhook_url_encrypted: text("webhook_url_encrypted").notNull(),
    /* Display-only: the channel name shown in settings (not secret). */
    channel_name: text("channel_name"),
    mention_everyone: boolean("mention_everyone").notNull().default(false),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("discord_webhooks_user_id_idx").on(t.user_id)],
);

export const discordStreamsTable = pgTable(
  "discord_streams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(),
    title: text("title").notNull(),
    game: text("game"),
    status: text("status").notNull().default("scheduled"),
    scheduled_for: timestamp("scheduled_for", { withTimezone: true }),
    started_at: timestamp("started_at", { withTimezone: true }),
    ended_at: timestamp("ended_at", { withTimezone: true }),
    vod_url: text("vod_url"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("discord_streams_user_id_idx").on(t.user_id)],
);

export const insertDiscordWebhookSchema = createInsertSchema(discordWebhooksTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type InsertDiscordWebhook = z.infer<typeof insertDiscordWebhookSchema>;
export type DiscordWebhook = typeof discordWebhooksTable.$inferSelect;

export const insertDiscordStreamSchema = createInsertSchema(discordStreamsTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type InsertDiscordStream = z.infer<typeof insertDiscordStreamSchema>;
export type DiscordStream = typeof discordStreamsTable.$inferSelect;

/* Discord Live Companion Bot (Phase 1).
   A discord.js bot service (artifacts/discord-bot) watches the user's
   server for Go Live (VOICE_STATE_UPDATE with self_stream) and automates
   everything around the stream: announcements, watch-party threads, recaps.
   This config table holds the per-user wiring between the site and the bot;
   the bot authenticates to the API with DISCORD_BOT_SHARED_SECRET. */
export const discordBotConfigTable = pgTable(
  "discord_bot_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull().unique(),
    /* The Discord server (guild) the bot is installed on. */
    guild_id: text("guild_id"),
    /* Channel ID where LIVE announcements are posted. */
    announce_channel_id: text("announce_channel_id"),
    /* Role ID pinged on go-live (optional; falls back to @everyone if set). */
    announce_role_id: text("announce_role_id"),
    mention_everyone: boolean("mention_everyone").notNull().default(false),
    /* The streamer's Discord user ID — the bot only announces for this user. */
    streamer_discord_user_id: text("streamer_discord_user_id"),
    /* Streamer's Discord username, for display ("name#discrim" or @handle). */
    streamer_discord_username: text("streamer_discord_username"),
    enabled: boolean("enabled").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("discord_bot_config_user_id_idx").on(t.user_id)],
);

export const insertDiscordBotConfigSchema = createInsertSchema(discordBotConfigTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type InsertDiscordBotConfig = z.infer<typeof insertDiscordBotConfigSchema>;
export type DiscordBotConfig = typeof discordBotConfigTable.$inferSelect;

/* Live state, written by the bot service (POST /discord-bot/live) and read
   by the site (GET /discord-bot/live) to render the LIVE badge. One row per
   user; upserted on every transition. */
export const discordLiveStateTable = pgTable(
  "discord_live_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull().unique(),
    is_live: boolean("is_live").notNull().default(false),
    started_at: timestamp("started_at", { withTimezone: true }),
    ended_at: timestamp("ended_at", { withTimezone: true }),
    channel_id: text("channel_id"),
    channel_name: text("channel_name"),
    stream_title: text("stream_title"),
    announcement_message_id: text("announcement_message_id"),
    thread_id: text("thread_id"),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("discord_live_state_user_id_idx").on(t.user_id)],
);

export const insertDiscordLiveStateSchema = createInsertSchema(discordLiveStateTable).omit({
  id: true,
  updated_at: true,
});
export type InsertDiscordLiveState = z.infer<typeof insertDiscordLiveStateSchema>;
export type DiscordLiveState = typeof discordLiveStateTable.$inferSelect;
