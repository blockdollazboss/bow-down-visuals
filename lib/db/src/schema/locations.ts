import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

/* ── Locations library ─────────────────────────────────────────────────────
   The user's own library of scene locations for music video creation
   ("Golden Throne Room", "Black-Ocean Stage", ...). Each location is a
   named place with an image. Locations are video-making assets — they are
   user-scoped and have nothing to do with artist vaults. */

export const locationsTable = pgTable("locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  label: text("label").notNull(),
  /** Public (signed) URL of the location image. */
  image_url: text("image_url").notNull(),
  /** Supabase storage reference for the image file (if uploaded). */
  image_path: text("image_path"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertLocationSchema = createInsertSchema(locationsTable).omit({
  id: true,
  created_at: true,
});

export const selectLocationSchema = createSelectSchema(locationsTable);

export type Location = typeof locationsTable.$inferSelect;
