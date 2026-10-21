import { pgTable, uuid, text, integer, timestamp, jsonb, check, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Server-side persistence for AI Website Builder projects
 * (migration 0195; competitor dossier ai-builders.md gap G2).
 *
 * Before this, a build lived only in React state on the builder page:
 * refresh and the paid-for site was gone, and the edit endpoint had to
 * re-receive the whole file map from the browser on every call.
 *
 * website_builder_projects — one row per saved build, owner-scoped:
 *   client_ref  the builder client's per-build id (the hub_projects
 *               0142 upsert pattern): saves key on (user_id,
 *               client_ref) so a retried save after a lost response
 *               lands on the same project. Null when the caller sent
 *               no client id; Postgres unique indexes treat NULLs as
 *               distinct, so null rows never collide.
 *   brief       the settings that produced the CURRENT head version,
 *               mirrored from the head version row on every append.
 *
 * website_builder_versions — APPEND-ONLY history. A generation, a
 * re-generation, a conversational edit, a restore, and an explicit
 * save each write a NEW row; no version is ever updated in place, so
 * restoring an old version can never destroy the ones after it.
 *
 * There is deliberately no thumbnail/preview column: no preview image
 * is rendered server-side, and the UI says so (a labeled live-preview
 * affordance) instead of faking a screenshot.
 */
export const WEBSITE_BUILD_SOURCES = ["generate", "regenerate", "edit", "restore", "save"] as const;
export type WebsiteBuildSource = (typeof WEBSITE_BUILD_SOURCES)[number];

/** The brief/settings that produced a build (or one version of it). */
export interface WebsiteBuildBrief {
  description: string;
  style: string;
  colorScheme: string;
}

/** The generated site payload: file path -> full file contents. */
export type WebsiteBuildFiles = Record<string, string>;

export const websiteBuilderProjectsTable = pgTable("website_builder_projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  client_ref: text("client_ref"),
  /* The site/business name the build was generated for. */
  name: text("name").notNull(),
  /* One of the builder's template keys (artist-site, press-kit,
     link-in-bio, tour-page) — validated at the route, kept as text so
     a future template never needs a migration to be saveable. */
  template: text("template").notNull(),
  brief: jsonb("brief").$type<WebsiteBuildBrief>().notNull().default({ description: "", style: "", colorScheme: "" }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("website_builder_projects_client_ref_idx").on(t.user_id, t.client_ref),
  index("website_builder_projects_user_idx").on(t.user_id, t.updated_at),
]);

export const websiteBuilderVersionsTable = pgTable("website_builder_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  project_id: uuid("project_id")
    .notNull()
    .references(() => websiteBuilderProjectsTable.id, { onDelete: "cascade" }),
  /* 1-based sequence within the project. */
  version: integer("version").notNull(),
  source: text("source").notNull(),
  /* The edit request for source='edit', "Restored from version N" for
     source='restore'; null otherwise. */
  note: text("note"),
  brief: jsonb("brief").$type<WebsiteBuildBrief>().notNull().default({ description: "", style: "", colorScheme: "" }),
  /* The full generated site payload, stored verbatim — a re-open
     round-trips byte-identical. */
  files: jsonb("files").$type<WebsiteBuildFiles>().notNull(),
  /* Object.keys(files).length at write time, so list views never
     need to load the payload. */
  file_count: integer("file_count").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("website_builder_versions_source_check", sql`${t.source} IN ('generate', 'regenerate', 'edit', 'restore', 'save')`),
  uniqueIndex("website_builder_versions_project_version_idx").on(t.project_id, t.version),
]);

export const insertWebsiteBuilderProjectSchema = createInsertSchema(websiteBuilderProjectsTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export const selectWebsiteBuilderProjectSchema = createSelectSchema(websiteBuilderProjectsTable);

export const insertWebsiteBuilderVersionSchema = createInsertSchema(websiteBuilderVersionsTable).omit({
  id: true,
  created_at: true,
});
export const selectWebsiteBuilderVersionSchema = createSelectSchema(websiteBuilderVersionsTable);

export type WebsiteBuilderProjectRow = typeof websiteBuilderProjectsTable.$inferSelect;
export type InsertWebsiteBuilderProject = z.infer<typeof insertWebsiteBuilderProjectSchema>;
export type WebsiteBuilderVersionRow = typeof websiteBuilderVersionsTable.$inferSelect;
export type InsertWebsiteBuilderVersion = z.infer<typeof insertWebsiteBuilderVersionSchema>;
