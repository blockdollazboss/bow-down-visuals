import { pgTable, uuid, text, jsonb, timestamp, unique } from "drizzle-orm/pg-core";

export const projectDraftsTable = pgTable("project_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  workflow_type: text("workflow_type").notNull(),
  title: text("title"),
  draft_data: jsonb("draft_data").notNull().$type<Record<string, unknown>>(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("project_drafts_user_workflow_uniq").on(t.user_id, t.workflow_type),
]);

export type ProjectDraftRow = typeof projectDraftsTable.$inferSelect;
