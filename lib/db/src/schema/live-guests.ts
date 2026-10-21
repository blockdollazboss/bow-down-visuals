import { pgTable, uuid, text, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { liveStreamsTable } from "./live-streams";

/* Go Live guest invites + backstage (migration 0198) — the StreamYard
   mechanic on our own pipe (competitor study G3). Three tables:

   live_guest_invites — a shareable link the host mints for ONE stream.
     The plain token is NEVER stored: token_lookup is its SHA-256 hex
     (same one-way treatment as the RTMP ingest keys, 0193), so a
     database read alone yields no working link. The plain token exists
     only in the host's mint response and in the link itself.
     expires_at NULL = the link lives until the stream ends or the
     host revokes it; max_joins NULL = no join cap beyond the room cap.
     revoked_at set = dead link: join AND every live guest session
     minted from it die at once (checked on every guest call).

   live_guest_sessions — one row per guest who joined through a link.
     The guest holds a session token (again stored only as a SHA-256
     lookup). state: 'backstage' (in the greenroom, audience sees and
     hears nothing) → 'on_stage' (host promoted them; their feed rides
     the host's program canvas) → 'left' | 'removed'. A guest is NOT a
     member: no user_id exists on this row, and every surface labels
     them "Guest" — identity stays honest by construction.

   live_backstage_messages — the greenroom's own chat. A separate
     table from live_chat_messages BY DESIGN: the audience chat rail
     can never serve a backstage row, because it never reads this
     table. author_kind is 'host' | 'guest'; a guest row carries its
     session id + the display-name snapshot from join time. */

export const liveGuestInvitesTable = pgTable(
  "live_guest_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stream_id: uuid("stream_id")
      .notNull()
      .references(() => liveStreamsTable.id, { onDelete: "cascade" }),
    /* The host's auth user id (matches live_streams.user_id). */
    host_user_id: uuid("host_user_id").notNull(),
    token_lookup: text("token_lookup").notNull(),
    /* Last 4 chars of the plain token — lets the host recognize a link. */
    token_hint: text("token_hint").notNull(),
    label: text("label"),
    expires_at: timestamp("expires_at", { withTimezone: true }),
    max_joins: integer("max_joins"),
    join_count: integer("join_count").notNull().default(0),
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("live_guest_invites_lookup_uidx").on(t.token_lookup),
    index("live_guest_invites_stream_idx").on(t.stream_id, t.created_at),
  ],
);

export const liveGuestSessionsTable = pgTable(
  "live_guest_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    invite_id: uuid("invite_id")
      .notNull()
      .references(() => liveGuestInvitesTable.id, { onDelete: "cascade" }),
    stream_id: uuid("stream_id")
      .notNull()
      .references(() => liveStreamsTable.id, { onDelete: "cascade" }),
    display_name: text("display_name").notNull(),
    session_lookup: text("session_lookup").notNull(),
    /* 'backstage' | 'on_stage' | 'left' | 'removed' */
    state: text("state").notNull().default("backstage"),
    joined_at: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    last_seen_at: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    ended_at: timestamp("ended_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("live_guest_sessions_lookup_uidx").on(t.session_lookup),
    index("live_guest_sessions_stream_state_idx").on(t.stream_id, t.state),
    index("live_guest_sessions_invite_idx").on(t.invite_id),
  ],
);

export const liveBackstageMessagesTable = pgTable(
  "live_backstage_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stream_id: uuid("stream_id")
      .notNull()
      .references(() => liveStreamsTable.id, { onDelete: "cascade" }),
    /* 'host' | 'guest' */
    author_kind: text("author_kind").notNull(),
    /* Host rows carry the host's auth user id; guest rows carry null. */
    author_user_id: uuid("author_user_id"),
    guest_session_id: uuid("guest_session_id").references(() => liveGuestSessionsTable.id, {
      onDelete: "set null",
    }),
    /* Display-name snapshot at send time ("Guest" labeling is added by
       surfaces, from author_kind — never baked into the name). */
    author_name: text("author_name").notNull(),
    body: text("body").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("live_backstage_messages_stream_created_idx").on(t.stream_id, t.created_at)],
);

export const insertLiveGuestInviteSchema = createInsertSchema(liveGuestInvitesTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type InsertLiveGuestInvite = z.infer<typeof insertLiveGuestInviteSchema>;
export type LiveGuestInvite = typeof liveGuestInvitesTable.$inferSelect;
export type LiveGuestSession = typeof liveGuestSessionsTable.$inferSelect;
export type LiveBackstageMessage = typeof liveBackstageMessagesTable.$inferSelect;
