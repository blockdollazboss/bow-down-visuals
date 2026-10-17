import { pgTable, uuid, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Brand kits (migration 0142, DE-5): one durable kit per creator.
   POST /api/brand-kit generates a kit with the text model; until this
   table existed the kit lived only in the response — every apply/import
   surface (vault theme, profile theme, editor branding) had nothing
   durable to read. The kit payload is the BrandKit JSON shape from
   routes/generate/brand-kit.ts, stored whole. */
export const brandKitsTable = pgTable("brand_kits", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull().unique(),
  kit: jsonb("kit").notNull().default({}),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBrandKitSchema = createInsertSchema(brandKitsTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});

export const selectBrandKitSchema = createSelectSchema(brandKitsTable);

export type BrandKitRow = typeof brandKitsTable.$inferSelect;
export type InsertBrandKit = z.infer<typeof insertBrandKitSchema>;
