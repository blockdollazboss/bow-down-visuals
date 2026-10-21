import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";

export const voiceClonesTable = pgTable("voice_clones", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  elevenlabsVoiceId: text("elevenlabs_voice_id"),
  sampleRef: text("sample_ref"),
  source: text("source").notNull().default("elevenlabs"),
  baseVoice: text("base_voice"),
  analysis: jsonb("analysis").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
