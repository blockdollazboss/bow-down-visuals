import { pgTable, uuid, text, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Studio-gear orders (Branding Shop studio-gear line, owner ruling Oct 25
   2026; provisional migration 9999-studio-gear.sql).
   Made-to-order model: no inventory, a partner makes each piece and ships
   direct. Creator-custom pieces are proof-gated — production starts only
   after the creator approves the design proof (proof_status = 'approved');
   all-house orders carry proof_status = 'not_required'.
   TEST MODE: test_mode is true on every row of this rail for now and the
   checkout never takes a real charge (paid rows carry a test session id). */
export const studioGearOrdersTable = pgTable("studio_gear_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  /* [{ product, variant, option, qty, unitPriceCents, customText?,
        specNotes?, artworkUrl? }] — prices snapshotted server-side from
        the ruled catalog at order time; client totals are never trusted. */
  items: jsonb("items").notNull(),
  totalCents: integer("total_cents").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull(),
  state: text("state").notNull(),
  zip: text("zip").notNull(),
  status: text("status").notNull().default("received"),
  proofStatus: text("proof_status").notNull().default("not_required"),
  /* The design proof the creator reviews (set when a proof is sent). */
  proofUrl: text("proof_url"),
  proofNote: text("proof_note"),
  paid: boolean("paid").notNull().default(false),
  testMode: boolean("test_mode").notNull().default(true),
  stripeSessionId: text("stripe_session_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertStudioGearOrderSchema = createInsertSchema(studioGearOrdersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertStudioGearOrder = z.infer<typeof insertStudioGearOrderSchema>;
export type StudioGearOrder = typeof studioGearOrdersTable.$inferSelect;

export const STUDIO_GEAR_ORDER_STATUSES = [
  "received",
  "proof_pending",
  "proof_sent",
  "in_production",
  "shipped",
  "delivered",
  "canceled",
] as const;
export type StudioGearOrderStatus = (typeof STUDIO_GEAR_ORDER_STATUSES)[number];

export const STUDIO_GEAR_PROOF_STATUSES = [
  "not_required",
  "pending",
  "sent",
  "approved",
  "revision_requested",
] as const;
export type StudioGearProofStatus = (typeof STUDIO_GEAR_PROOF_STATUSES)[number];
