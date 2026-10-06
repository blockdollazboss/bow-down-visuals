import { pgTable, uuid, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Custom jewelry line (dropship model — made-to-order by the manufacturer).
   HONESTY CONTRACT: reservation-only v1. Statuses are only "received" /
   "pending_fulfillment" until a real fulfillment integration reports
   otherwise. No charge is taken at reservation time. */

export const jewelryOrdersTable = pgTable("jewelry_orders", {
  id:              uuid("id").primaryKey().defaultRandom(),
  userId:          text("user_id").notNull(),
  productKey:      text("product_key").notNull(),
  finish:          text("finish").notNull(), // 'gold-10k' | 'gold-14k' | 'gold-18k'
  sizeOption:      text("size_option").notNull(),
  engraving:       text("engraving"),
  designNotes:     text("design_notes"),
  quantity:        integer("quantity").notNull().default(1),
  fullName:        text("full_name").notNull(),
  email:           text("email").notNull(),
  phone:           text("phone"),
  shippingAddress: jsonb("shipping_address").notNull(),
  status:          text("status").notNull().default("received"),
  unitPriceCents:  integer("unit_price_cents").notNull(),
  totalCents:      integer("total_cents").notNull(),
  idempotencyKey:  text("idempotency_key").unique(),
  createdAt:       timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:       timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertJewelryOrderSchema = createInsertSchema(jewelryOrdersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertJewelryOrder = z.infer<typeof insertJewelryOrderSchema>;
export type JewelryOrder = typeof jewelryOrdersTable.$inferSelect;

/* Jewelry catalog: key, label, price, blurb, size options. Backend-validated. */
export const JEWELRY_PRODUCTS = [
  {
    key: "logo-pendant",
    label: "Custom Logo Pendant",
    priceCents: 0, // premium line: final price confirmed with buyer before production
    blurb: "Your logo or mark, cast in solid gold with real diamond accents — the signature piece",
    sizes: ['18" chain', '20" chain', '22" chain', '24" chain'],
  },
  {
    key: "cuban-chain",
    label: "Cuban Link Chain",
    priceCents: 0, // premium line: final price confirmed with buyer before production
    blurb: "Heavy solid-gold Cuban link with engraved clasp and diamond accents — pure weight",
    sizes: ['18"', '20"', '22"', '24"', '26"'],
  },
  {
    key: "signet-ring",
    label: "Engraved Signet Ring",
    priceCents: 0, // premium line: final price confirmed with buyer before production
    blurb: "Your initials or emblem, deep-engraved in solid gold",
    sizes: ["6", "7", "8", "9", "10", "11", "12", "13"],
  },
  {
    key: "id-bracelet",
    label: "Engraved ID Bracelet",
    priceCents: 0, // premium line: final price confirmed with buyer before production
    blurb: "Classic ID plate in solid gold, engraved with your name or brand",
    sizes: ['S (7")', 'M (8")', 'L (9")'],
  },
] as const;

export type JewelryProductKey = (typeof JEWELRY_PRODUCTS)[number]["key"];

export function jewelryProductByKey(key: string) {
  return JEWELRY_PRODUCTS.find((p) => p.key === key);
}

export const JEWELRY_FINISHES = [
  { key: "gold-10k", label: "10K Solid Gold" },
  { key: "gold-14k", label: "14K Solid Gold" },
  { key: "gold-18k", label: "18K Solid Gold" },
] as const;

export type JewelryFinishKey = (typeof JEWELRY_FINISHES)[number]["key"];

export function jewelryFinishByKey(key: string) {
  return JEWELRY_FINISHES.find((f) => f.key === key);
}
