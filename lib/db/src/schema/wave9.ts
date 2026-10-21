import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";

/* Wave 9 tables — directing layer (Character Director). Planning-layer only:
   saved shot plans feed the EXISTING Scene Studio generation pipeline. */

export const wave9dDirectorPlansTable = pgTable("wave9d_director_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  name: text("name").notNull().default(""),
  castMembers: jsonb("cast_members").notNull().default([]),
  shots: jsonb("shots").notNull().default([]),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
