import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userLutsTable = pgTable("user_luts", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  name: text("name").notNull(),
  format: text("format").notNull().default("cube"),
  lut_size: integer("lut_size"),
  storage_ref: text("storage_ref").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUserLutSchema = createInsertSchema(userLutsTable).omit({
  id: true,
  created_at: true,
});

export const selectUserLutSchema = createSelectSchema(userLutsTable);

export type UserLutRow = typeof userLutsTable.$inferSelect;
export type InsertUserLut = z.infer<typeof insertUserLutSchema>;
