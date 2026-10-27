import { pgTable, uuid, text, integer, timestamp, index, primaryKey } from "drizzle-orm/pg-core";
import { liveStreamsTable } from "./live-streams";

/* Live stream chat — migration 0130. Messages posted by signed-in
   viewers (and the streamer) while a broadcast is live; the same rows
   become the read-only "Chat replay" archive on the watch page after
   the stream ends. A delete is a soft delete: the row stays for
   moderation audit, but its body is never served again (reads filter
   deleted_at, and the delete path clears the stored body too).
   Mutes are per-stream: the stream owner can silence a chatter for
   the rest of that broadcast — the row's muted_until is set past any
   possible stream end (streams cap at 12h), and enforcement only
   applies while the stream is live anyway. */

export const liveChatMessagesTable = pgTable(
  "live_chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stream_id: uuid("stream_id")
      .notNull()
      .references(() => liveStreamsTable.id, { onDelete: "cascade" }),
    /* Supabase auth user id of the author (matches live_streams.user_id). */
    user_id: uuid("user_id").notNull(),
    body: text("body").notNull(),
    /* 'chat' | 'tip' — tip rows carry their Visual Bucs amount (0133). */
    kind: text("kind").notNull().default("chat"),
    tip_amount_vb: integer("tip_amount_vb"),
    /* Unified cross-platform chat (Round-2 #12, provisional migration
       9999): which source a message arrived from — 'site' (Bow Down's
       own chat, the only ingesting source today) | 'twitch' |
       'youtube'. External rows can only ever be written by a real
       config-gated ingestion adapter (api-server lib/unified-live-chat);
       nothing fabricates them. external_id is the platform's own
       message id (dedupe key per source); external_author_name keeps
       the platform display name for authors with no Bow Down profile
       (user_id then holds the stream owner's id as the row's anchor —
       external authors are never invented as site users). */
    source: text("source").notNull().default("site"),
    external_id: text("external_id"),
    external_author_name: text("external_author_name"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("live_chat_messages_stream_created_idx").on(t.stream_id, t.created_at)],
);

export const liveChatMutesTable = pgTable(
  "live_chat_mutes",
  {
    stream_id: uuid("stream_id")
      .notNull()
      .references(() => liveStreamsTable.id, { onDelete: "cascade" }),
    user_id: uuid("user_id").notNull(),
    muted_until: timestamp("muted_until", { withTimezone: true }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.stream_id, t.user_id] })],
);

export type LiveChatMessage = typeof liveChatMessagesTable.$inferSelect;
export type LiveChatMute = typeof liveChatMutesTable.$inferSelect;
