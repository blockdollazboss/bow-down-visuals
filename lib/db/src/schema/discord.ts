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
