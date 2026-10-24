import { pgTable, uuid, text, integer, timestamp, check, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { storeProductsTable } from "./storefront";
import { creatorProfilesTable } from "./creator-platform";

/* ── Timed product drops (Stack-100 #3, item #25) ────────────────────────
   A creator schedules a storefront product to publish at a future moment
   (product_drops.drop_at, stored as timestamptz — always UTC on the wire).
   Before that moment the product's public page IS the drop page: a
   countdown (rendered in the viewer's local time from the UTC instant)
   plus an email capture. Captures land in product_drop_captures AND are
   subscribed to the creator's existing email list (email_subscribers,
   source 'drop') — the presave_follows discipline, never a parallel list.

   At the drop moment the sweeper (api-server lib/product-drop-notify.ts)
   flips the drop scheduled → live exactly once (status-guarded UPDATE)
   and emails every captured fan exactly once through
   product_drop_deliveries — the insert-first claim ledger copied from
   presave_release_deliveries (migration 0186): only a claim that lands
   may send, so a retried sweep, a racing sweeper, or a restart can
   never email a fan twice, and the product can never go live early
   because every public read also gates on drop_at > now().

   MIGRATION: HELD — see .lane/MIGRATION-NEEDED.md in the lane worktree.
   Numbering is assigned at join (0205 is already held by another lane).
   Until the migration lands, every drop read/write in the API degrades
   gracefully (undefined-table → "no drop"), so products behave exactly
   as they did before this feature. */

export const PRODUCT_DROP_STATUSES = ["scheduled", "live", "cancelled"] as const;
export type ProductDropStatus = (typeof PRODUCT_DROP_STATUSES)[number];

export const productDropsTable = pgTable("product_drops", {
  id: uuid("id").primaryKey().defaultRandom(),
  productId: uuid("product_id")
    .notNull()
    .references(() => storeProductsTable.id, { onDelete: "cascade" }),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
  /* The creator's auth user id, denormalized for owner-scoped reads. */
  userId: uuid("user_id").notNull(),
  /* The drop moment. timestamptz: stored in UTC, rendered local. */
  dropAt: timestamp("drop_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("scheduled").$type<ProductDropStatus>(),
  /* When the drop-time fan-out completed (null until the sweeper runs). */
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("product_drops_status_check", sql`${t.status} IN ('scheduled', 'live', 'cancelled')`),
  /* One drop row per product: re-scheduling updates the row in place. */
  uniqueIndex("product_drops_product_ux").on(t.productId),
  index("product_drops_due_idx").on(t.status, t.dropAt),
  index("product_drops_profile_idx").on(t.profileId),
]);

export type ProductDrop = typeof productDropsTable.$inferSelect;

/* One row per (drop, email) capture on the public drop page — the
   product-drop twin of presave_follows. The email is ALSO subscribed to
   the creator's email list server-side (source 'drop'). */
export const productDropCapturesTable = pgTable("product_drop_captures", {
  id: uuid("id").primaryKey().defaultRandom(),
  dropId: uuid("drop_id")
    .notNull()
    .references(() => productDropsTable.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => storeProductsTable.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  name: text("name"),
  source: text("source").notNull().default("drop"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("product_drop_captures_drop_email_ux").on(t.dropId, t.email),
  index("product_drop_captures_drop_idx").on(t.dropId),
]);

export type ProductDropCapture = typeof productDropCapturesTable.$inferSelect;

export const PRODUCT_DROP_DELIVERY_STATUSES = ["pending", "sent", "failed", "dead"] as const;
export type ProductDropDeliveryStatus = (typeof PRODUCT_DROP_DELIVERY_STATUSES)[number];

/* Drop-day fan notifications: the delivery ledger for the "one email
   when the drop goes live" promise. One row per (drop, fan email),
   claimed insert-first (ON CONFLICT DO NOTHING on the unique
   (drop_id, email) index) before any send — the
   presave_release_deliveries discipline (migration 0186).
     pending → a claim landed; the send has not resolved yet.
     sent    → the provider accepted the email (provider_id recorded).
     failed  → the send attempt failed (last_error recorded); a later
               sweep may retry while attempts < the cap.
     dead    → attempts exhausted; terminal, never retried. */
export const productDropDeliveriesTable = pgTable("product_drop_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  dropId: uuid("drop_id")
    .notNull()
    .references(() => productDropsTable.id, { onDelete: "cascade" }),
  /* The capture row this delivery answers. Set-null on delete: the
     ledger row (and its email) is the durable record of the one
     allowed send even if the capture row later disappears. */
  captureId: uuid("capture_id").references(() => productDropCapturesTable.id, { onDelete: "set null" }),
  email: text("email").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  providerId: text("provider_id"),
  lastError: text("last_error"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check(
    "product_drop_deliveries_status_check",
    sql`${t.status} IN ('pending', 'sent', 'failed', 'dead')`,
  ),
  uniqueIndex("product_drop_deliveries_drop_email_idx").on(t.dropId, t.email),
  index("product_drop_deliveries_drop_idx").on(t.dropId),
]);

export type ProductDropDelivery = typeof productDropDeliveriesTable.$inferSelect;
