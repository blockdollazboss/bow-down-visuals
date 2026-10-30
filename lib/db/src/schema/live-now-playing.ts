import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { liveStreamsTable } from "./live-streams";

/* ── Live Now Playing (stack900 lane D3, migration 0302) ───────────────
   The server-side "now playing" state for ONE live stream: the track
   the creator's studio reports as playing on the program right now.

   Why this table exists: the studio's media playback is client-side
   canvas state (the stream-kit stage pool) that was never reported
   anywhere, so the stream overlays (lane C2) had NO truthful feed for
   a now-playing widget — C2 scoped the overlay out rather than fake
   one. This row is the feed: the studio reports track start / refresh
   / stop (POST + DELETE /api/live/:id/now-playing, owner-only), and
   the public overlay read (GET /api/overlay/now-playing?token=…)
   carries title + artist only.

   ONE row per stream (stream_id is the PK): a new track REPLACES the
   row, a stop DELETES it, a stream end deletes it with the stream's
   close-out. There is deliberately no history — this is a "what is
   playing right now" fact, not a log.

   expires_at is the honesty bound: every report sets it a bounded
   time ahead (track duration + grace when the duration is known, a
   short fixed window when it isn't — see lib/now-playing.ts for the
   TTL defence). A crashed or closed studio tab sends no more
   reports, so a dead "now playing" can never outlive its bound; a
   live studio heartbeats and the state stays truthful. Reads treat
   an expired row as nothing playing and clear it opportunistically. */
export const liveNowPlayingTable = pgTable(
  "live_now_playing",
  {
    stream_id: uuid("stream_id")
      .primaryKey()
      .references(() => liveStreamsTable.id, { onDelete: "cascade" }),
    /* Denormalized owner — the read path resolves creator → live
       stream → row, and the report path checks the caller against
       the stream row; keeping the owner on the row makes the
       creator-keyed read a single indexed lookup. */
    creator_user_id: uuid("creator_user_id").notNull(),
    title: text("title").notNull(),
    artist: text("artist").notNull(),
    /* The track's length in seconds when the studio knows it (the
       library row's duration). Null = unknown: the overlay shows no
       progress bar rather than a guessed one, and the TTL falls back
       to the short unknown-duration window. */
    duration_sec: integer("duration_sec"),
    /* When the CURRENT track started (first report of this title +
       artist). Refresh reports for the same track keep it; a track
       change resets it. */
    started_at: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    /* The honesty bound described above. */
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("live_now_playing_creator_idx").on(t.creator_user_id)],
);

export const insertLiveNowPlayingSchema = createInsertSchema(liveNowPlayingTable);
export type InsertLiveNowPlaying = z.infer<typeof insertLiveNowPlayingSchema>;
export type LiveNowPlaying = typeof liveNowPlayingTable.$inferSelect;
