import { pgTable, uuid, text, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* NFC business-card line (dropship model).
   nfc_profiles: the buyer's digital card — the tap/QR destination at /c/:slug.
   nfc_card_orders: the physical card order sent to the manufacturer.

   HONESTY CONTRACT (same as branding shop): order statuses are only ever
   "received" / "pending_fulfillment" until a real fulfillment integration
   reports otherwise. No shipped/delivered/tracking fiction. */

export const nfcProfilesTable = pgTable("nfc_profiles", {
  id:          uuid("id").primaryKey().defaultRandom(),
  slug:        text("slug").notNull().unique(),
  userId:      text("user_id").notNull(),
  displayName: text("display_name").notNull(),
  title:       text("title"),
  bio:         text("bio"),
  avatarUrl:   text("avatar_url"),
  /* [{ label: string, url: string }] — the tappable link buttons */
  links:       jsonb("links").notNull().default([]),
  theme:       text("theme").notNull().default("gold-black"),
  tapCount:    integer("tap_count").notNull().default(0),
  isActive:    boolean("is_active").notNull().default(true),
  createdAt:   timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:   timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const nfcCardOrdersTable = pgTable("nfc_card_orders", {
  id:              uuid("id").primaryKey().defaultRandom(),
  userId:          text("user_id").notNull(),
  profileId:       uuid("profile_id").references(() => nfcProfilesTable.id, { onDelete: "set null" }),
  cardStyle:       text("card_style").notNull(),
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

export const insertNfcProfileSchema = createInsertSchema(nfcProfilesTable).omit({
  id: true,
  tapCount: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertNfcProfile = z.infer<typeof insertNfcProfileSchema>;
export type NfcProfile = typeof nfcProfilesTable.$inferSelect;

export const insertNfcCardOrderSchema = createInsertSchema(nfcCardOrdersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertNfcCardOrder = z.infer<typeof insertNfcCardOrderSchema>;
export type NfcCardOrder = typeof nfcCardOrdersTable.$inferSelect;

/* One row per physical card in an order — each card links to its own
   profile so every card gets a unique NFC URL + QR. */
export const nfcOrderCardsTable = pgTable("nfc_order_cards", {
  id:        uuid("id").primaryKey().defaultRandom(),
  orderId:   uuid("order_id").notNull().references(() => nfcCardOrdersTable.id, { onDelete: "cascade" }),
  profileId: uuid("profile_id").notNull().references(() => nfcProfilesTable.id, { onDelete: "cascade" }),
  cardIndex: integer("card_index").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
export type NfcOrderCard = typeof nfcOrderCardsTable.$inferSelect;

/* Card styles: key, label, price, blurb. Backend-validated on order. */
export const NFC_CARD_STYLES = [
  { key: "pvc-matte-black", label: "Matte Black PVC", priceCents: 2900, blurb: "Stealth black plastic, gold print — the signature look" },
  { key: "pvc-white",       label: "Gloss White PVC", priceCents: 2900, blurb: "Clean white plastic, full-color print" },
  { key: "wood-bamboo",     label: "Bamboo Wood",     priceCents: 3900, blurb: "Real bamboo, laser-etched — natural premium feel" },
  { key: "metal-black",     label: "Black Metal",     priceCents: 5900, blurb: "Heavy black metal, etched — the power move" },
  { key: "metal-gold",      label: "Gold Metal",      priceCents: 6900, blurb: "Gold-finish metal, etched — pure luxury" },
] as const;

export type NfcCardStyleKey = (typeof NFC_CARD_STYLES)[number]["key"];

export function nfcCardStyleByKey(key: string) {
  return NFC_CARD_STYLES.find((s) => s.key === key);
}

export const NFC_ORDER_STATUSES = [
  "received",
  "pending_fulfillment",
  "in_production",
] as const;
