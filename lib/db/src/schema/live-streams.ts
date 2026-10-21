import { pgTable, uuid, text, integer, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { creatorProfilesTable } from "./creator-platform";
import { generatedClipsTable } from "./generated-clips";

/* Native on-site broadcasts — the "Go Live" stream studio (migration 0129).
   Deliberately separate from discord_streams: those rows are schedule /
   announce records for Discord webhook posts. A live_streams row is a real
   broadcast session with a provider lifecycle (a Cloudflare Stream live
   input created at go-live, deleted at end), playback identifiers, live
   viewer counts, and the browser-recorded VOD registered back onto the row
   (and into generated_clips) when the stream wraps. */

export const liveStreamsTable = pgTable(
  "live_streams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: uuid("user_id").notNull(),
    profile_id: uuid("profile_id")
      .notNull()
      .references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /* 'live' | 'ended' */
    status: text("status").notNull().default("live"),
    provider: text("provider").notNull().default("cloudflare-stream"),
    /* Cloudflare Stream live input uid. */
    provider_input_id: text("provider_input_id"),
    /* Cloudflare Stream playback uid (for live inputs, the input uid). */
    playback_id: text("playback_id"),
    /* Broadcaster-only WHIP publish URL. Never exposed in public DTOs. */
    whip_url: text("whip_url"),
    /* How the program feed reaches the stage (migration 0194):
       'camera' — the browser studio (MediaRecorder chunks / WHIP);
       'rtmp' — an external encoder (OBS, VirtualDJ, Serato…) pushing
       RTMP to the creator's personal ingest key. Playback, chat and
       fan-out are identical either way; this is the honest source
       label surfaces may show where sources are labeled. */
    ingest_source: text("ingest_source").notNull().default("camera"),
    /* Multistream destinations: [{ platform, label, status,
       save_recording, vod_url, vod_state }] — each destination carries
       its save-a-recording preference and, after the stream, where its
       recording ended up. V1 only ever activates the site destination;
       fan-out platforms land here later without a model change. The API
       normalizes on write/read. */
    destinations: jsonb("destinations")
      .$type<
        Array<{
          platform: string;
          label: string;
          status: string;
          save_recording?: boolean;
          vod_url?: string | null;
          vod_state?: string | null;
        }>
      >()
      .notNull()
      .default(sql`'[{"platform":"site","label":"Your profile","status":"active","save_recording":true,"vod_url":null,"vod_state":null}]'::jsonb`),
    /* The creator's Visual Bucs tip goal for this stream (0133);
       null = no goal set. Drives the overlay goal bar. */
    tip_goal_vb: integer("tip_goal_vb"),
    viewer_count: integer("viewer_count").notNull().default(0),
    peak_viewers: integer("peak_viewers").notNull().default(0),
    vod_url: text("vod_url"),
    vod_clip_id: uuid("vod_clip_id").references(() => generatedClipsTable.id, {
      onDelete: "set null",
    }),
    started_at: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    ended_at: timestamp("ended_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("live_streams_status_started_idx").on(t.status, t.started_at.desc()),
    index("live_streams_user_id_idx").on(t.user_id),
    index("live_streams_profile_id_idx").on(t.profile_id),
    uniqueIndex("live_streams_one_live_per_user_idx")
      .on(t.user_id)
      .where(sql`${t.status} = 'live'`),
  ],
);

export const insertLiveStreamSchema = createInsertSchema(liveStreamsTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type InsertLiveStream = z.infer<typeof insertLiveStreamSchema>;
export type LiveStream = typeof liveStreamsTable.$inferSelect;
