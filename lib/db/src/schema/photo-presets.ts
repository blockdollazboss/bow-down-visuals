import { pgTable, uuid, text, jsonb, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * photo_presets — user preset packs for the Photo desk (Stack 7 #8).
 * A preset is one look: the develop recipe (the same camelCase recipe
 * JSON batch look-sync consumes). Public presets are readable by share
 * slug (the public preset page). store_product_id is the linkage slot
 * for listing a pack through the store machinery — set only when a
 * real store product exists for the pack.
 */
export const photoPresetsTable = pgTable("photo_presets", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  name: text("name").notNull(),
  recipe: jsonb("recipe").notNull().$type<Record<string, unknown>>(),
  is_public: boolean("is_public").notNull().default(false),
  share_slug: text("share_slug").unique(),
  store_product_id: text("store_product_id"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PhotoPresetRow = typeof photoPresetsTable.$inferSelect;
