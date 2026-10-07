import { pgTable, uuid, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export const voicePersonasTable = pgTable("voice_personas", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  gender: text("gender"),
  settings: jsonb("settings").notNull().default({}),
  isPublic: boolean("is_public").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
