import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const humRecordingsTable = pgTable("hum_recordings", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  audioRef: text("audio_ref").notNull(),
  audioUrl: text("audio_url"),
  analysis: jsonb("analysis").notNull().default({}),
  songUrl: text("song_url"),
  songRef: text("song_ref"),
  influence: text("influence").notNull().default("text-reference"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
