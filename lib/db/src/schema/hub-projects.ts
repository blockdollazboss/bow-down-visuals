import { pgTable, uuid, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const hubProjectsTable = pgTable("hub_projects", {
  user_id: uuid("user_id").primaryKey(),
  name: text("name").notNull().default("Untitled Project"),
  type: text("type").notNull().default("song"),
  assets: jsonb("assets").notNull().default([]),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertHubProjectSchema = createInsertSchema(hubProjectsTable).omit({
  created_at: true,
});

export const selectHubProjectSchema = createSelectSchema(hubProjectsTable);

export type HubProjectRow = typeof hubProjectsTable.$inferSelect;
export type InsertHubProject = z.infer<typeof insertHubProjectSchema>;
