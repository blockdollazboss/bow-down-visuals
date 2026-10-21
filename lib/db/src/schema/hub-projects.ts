import { pgTable, uuid, text, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const hubProjectsTable = pgTable("hub_projects", {
  /** Surrogate PK (migration 0142, DE-20): user_id used to BE the PK,
      which capped a creator at one commingled project. Now a user holds
      many projects; user_id is a plain owner column. */
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  /** The hub client's local project id (migration 0142): saves upsert
      by (user_id, client_ref), so each local project maps to exactly
      one server row. Null for rows predating the multi-project hub. */
  client_ref: text("client_ref"),
  name: text("name").notNull().default("Untitled Project"),
  type: text("type").notNull().default("song"),
  assets: jsonb("assets").notNull().default([]),
  concept: text("concept").notNull().default(""),
  templateKey: text("template_key"),
  /** "Made with Bow Down Visuals" credit toggle — project-level, default ON.
      Flows into every export/share output from every tool in the project. */
  attribution: boolean("attribution").notNull().default(true),
  /** The Creative Vault character this project is made as (migration
      0142, G8). Nullable: no character pick = null. */
  artist_vault_id: uuid("artist_vault_id"),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertHubProjectSchema = createInsertSchema(hubProjectsTable).omit({
  created_at: true,
});

export const selectHubProjectSchema = createSelectSchema(hubProjectsTable);

export type HubProjectRow = typeof hubProjectsTable.$inferSelect;
export type InsertHubProject = z.infer<typeof insertHubProjectSchema>;
