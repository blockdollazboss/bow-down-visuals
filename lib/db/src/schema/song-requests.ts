import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { liveStreamsTable } from "./live-streams";
import { songsTable } from "./songs";

/* ── Song Requests, Live (Stack-200 N18, migration 9999 provisional) ──────
   Mid-stream, a fan requests a song from the creator's own catalog with
   a Visual Bucs tip attached, and the request joins an ordered queue
   the creator runs from the broadcast surface (play-next / skip /
   close). The Stage Manager (List 2 #166, not yet built) will run this
   same queue later — queue state and operations live in the API
   service layer (lib/song-requests.ts), never welded to one UI.

   Money shape (the live-tips rail, routes/live-tips.ts, reused — no
   second charge path): the fan is DEBITED exactly once at submission
   via chargeCredits under a scoped idempotency key. The tip is a tip
   for a PLAY: the creator is credited exactly once (addCreditsAtomic +
   strict ledger row under a derived key, the live-tips step-3 shape)
   only when the request actually starts playing. A request that never
   plays — skipped per the creator's rules, or still queued when the
   stream ends or the queue closes — is refunded in full to the fan,
   exactly once, via refundCredits. That consequence is printed on the
   request surface BEFORE anyone tips.

   Rules are per creator, persisted, set before the stream and edited
   between streams: requests open/closed, catalog-only, excluded
   catalog songs, and an optional creator-set minimum tip (a creator
   number or none — the platform invents no minimum of its own; the
   live-tip rail's own amount bounds still apply because the charge
   rides that rail). Rule-checkable declines (requests closed,
   off-catalog, excluded song, below the creator's minimum) are refused
   BEFORE any charge, so no refund is ever needed for them. */

export const songRequestRulesTable = pgTable(
  "song_request_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /* One rules row per creator. */
    creator_user_id: uuid("creator_user_id").notNull(),
    requests_open: boolean("requests_open").notNull().default(true),
    /* Requests must be songs from the creator's own catalog (songs
       rows owned by the creator). The spec's default. When off, any
       song row in the house catalog may be requested. */
    catalog_only: boolean("catalog_only").notNull().default(true),
    /* Catalog song ids the creator has taken out of requests. */
    excluded_song_ids: jsonb("excluded_song_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /* Creator-set minimum tip in VB, or NULL = no creator minimum. */
    min_tip_vb: integer("min_tip_vb"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("song_request_rules_creator_idx").on(t.creator_user_id)],
);

export const insertSongRequestRulesSchema = createInsertSchema(songRequestRulesTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type InsertSongRequestRules = z.infer<typeof insertSongRequestRulesSchema>;
export type SongRequestRules = typeof songRequestRulesTable.$inferSelect;

/* One row per request; the row IS the transition record:
   queued → playing → played, or queued → skipped (rule decline by the
   creator, tip refunded), or queued → expired (stream ended / queue
   closed before it played, tip refunded). played_at / decided_at /
   refunded_at / creator_credited_at stamp each transition. */
export const songRequestsTable = pgTable(
  "song_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stream_id: uuid("stream_id")
      .notNull()
      .references(() => liveStreamsTable.id, { onDelete: "cascade" }),
    creator_user_id: uuid("creator_user_id").notNull(),
    fan_user_id: uuid("fan_user_id").notNull(),
    /* The requested song + a title snapshot, so the queue still reads
       honestly if the song row is later removed. */
    song_id: uuid("song_id").references(() => songsTable.id, { onDelete: "set null" }),
    song_title: text("song_title").notNull(),
    amount_vb: integer("amount_vb").notNull(),
    /* queued | playing | played | skipped | expired */
    status: text("status").notNull().default("queued"),
    /* Scoped charge idempotency key (buildChargeIdempotencyKey) — the
       UNIQUE gate that makes a retried submission one charge. */
    idempotency_key: text("idempotency_key").notNull(),
    creator_credited_at: timestamp("creator_credited_at", { withTimezone: true }),
    played_at: timestamp("played_at", { withTimezone: true }),
    decided_at: timestamp("decided_at", { withTimezone: true }),
    refunded_at: timestamp("refunded_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("song_requests_idempotency_idx").on(t.idempotency_key),
    index("song_requests_stream_status_idx").on(t.stream_id, t.status, t.created_at),
    index("song_requests_creator_idx").on(t.creator_user_id, t.created_at),
    index("song_requests_fan_idx").on(t.fan_user_id, t.created_at),
  ],
);

export const insertSongRequestSchema = createInsertSchema(songRequestsTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type InsertSongRequest = z.infer<typeof insertSongRequestSchema>;
export type SongRequest = typeof songRequestsTable.$inferSelect;
