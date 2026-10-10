import { pgTable, uuid, text, jsonb, timestamp, integer } from "drizzle-orm/pg-core";

/* Thy Books — AI-assisted book creation.
   Phase 1: book projects + chapters. Phase 2 adds covers, EPUB/PDF export,
   print-ready PDFs, and Lulu Print API integration. */

export const booksTable = pgTable("books", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  title: text("title").notNull(),
  subtitle: text("subtitle"),
  author_name: text("author_name"),
  genre: text("genre"),
  description: text("description"),
  /* Book-level metadata: target audience, tone, language, etc. */
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  /* Cover: URL of the generated/uploaded cover image (Phase 2). */
  cover_url: text("cover_url"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bookChaptersTable = pgTable("book_chapters", {
  id: uuid("id").primaryKey().defaultRandom(),
  book_id: uuid("book_id").notNull().references(() => booksTable.id, { onDelete: "cascade" }),
  user_id: uuid("user_id").notNull(),
  title: text("title").notNull(),
  /* Chapter body — plain text / markdown. */
  content: text("content").notNull().default(""),
  /* Position within the book (0-based). */
  position: integer("position").notNull().default(0),
  /* AI-generated outline/notes for this chapter. */
  ai_notes: text("ai_notes"),
  word_count: integer("word_count").notNull().default(0),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type BookRow = typeof booksTable.$inferSelect;
export type BookChapterRow = typeof bookChaptersTable.$inferSelect;
