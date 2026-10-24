import { pgTable, uuid, text, integer, jsonb, timestamp, check, primaryKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Creator Streaming Platform — digital sales + DMCA intake (migrations 0088, 0090).
 *
 * The store sells ALL kinds of digital content, not just music — the item_kind
 * is an OPEN set: track | video | album | pack | digital. The checkout,
 * fee-split, delivery, and dashboard pipelines are kind-agnostic; each catalog
 * entity opts in by exposing download_price_cents + a file URL.
 */

/** Every digital content kind the store can sell. Keep in sync with
    migrations 0090 + 0192 ('series' = a paid Series unlock on a
    kind='series' playlist; the sale row is the buyer's entitlement). */
export const DIGITAL_ITEM_KINDS = ["track", "video", "album", "pack", "digital", "series", "bundle"] as const;
export type DigitalItemKind = (typeof DIGITAL_ITEM_KINDS)[number];

export const digitalSalesTable = pgTable("digital_sales", {
  id:                 uuid("id").primaryKey().defaultRandom(),
  buyerUserId:        uuid("buyer_user_id").notNull(),
  profileId:          uuid("profile_id").notNull(),
  itemKind:           text("item_kind").notNull().$type<DigitalItemKind>(),
  itemId:             uuid("item_id").notNull(),
  stripeSessionId:    text("stripe_session_id").unique(),
  amountCents:        integer("amount_cents").notNull(),
  platformFeeCents:   integer("platform_fee_cents").notNull().default(0),
  creatorAmountCents: integer("creator_amount_cents").notNull().default(0),
  /* Reversal state (migration 0183, defect D1): 'completed' | 'refunded'.
     A refunded sale drops out of payout/earnings sums and its download
     links are expired by the clawback engine. Mirrors store_orders.status. */
  status:             text("status").notNull().default("completed"),
  refundedAt:         timestamp("refunded_at", { withTimezone: true }),
  /* Order bump (feature #13, migration 0219): the purchased add-on as
     its own line ON the sale row; the amount columns above stay
     SESSION TOTALS so existing readers keep reconciling untouched. */
  bumpItemKind:           text("bump_item_kind"),
  bumpItemId:             uuid("bump_item_id"),
  bumpTitle:              text("bump_title"),
  bumpAmountCents:        integer("bump_amount_cents"),
  bumpPlatformFeeCents:   integer("bump_platform_fee_cents"),
  bumpCreatorAmountCents: integer("bump_creator_amount_cents"),
  createdAt:          timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [check("digital_sales_item_kind_check", sql`${t.itemKind} IN ('track','video','album','pack','digital','series','bundle')`)]);

/** Order-bump attachments for digital-store items (migration 0219):
    items span three catalog tables, so the attachment lives in one
    keyed table instead of columns on each catalog. */
export const digitalBumpOffersTable = pgTable("digital_bump_offers", {
  itemKind:   text("item_kind").notNull().$type<DigitalItemKind>(),
  itemId:     uuid("item_id").notNull(),
  bumpKind:   text("bump_kind").notNull().$type<DigitalItemKind>(),
  bumpItemId: uuid("bump_item_id").notNull(),
  percentOff: integer("percent_off").notNull().default(0),
  createdAt:  timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt:  timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.itemKind, t.itemId] }),
  check("digital_bump_offers_percent_off_range", sql`${t.percentOff} >= 0 AND ${t.percentOff} <= 90`),
]);

export const insertDigitalSaleSchema = createInsertSchema(digitalSalesTable).omit({ id: true, createdAt: true });
export type InsertDigitalSale = z.infer<typeof insertDigitalSaleSchema>;
export type DigitalSale = typeof digitalSalesTable.$inferSelect;

export const downloadLinksTable = pgTable("download_links", {
  token:     text("token").primaryKey(),
  saleId:    uuid("sale_id").notNull().references(() => digitalSalesTable.id, { onDelete: "cascade" }),
  fileUrl:   text("file_url").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedCount: integer("used_count").notNull().default(0),
});

export const insertDownloadLinkSchema = createInsertSchema(downloadLinksTable).omit({ usedCount: true });
export type InsertDownloadLink = z.infer<typeof insertDownloadLinkSchema>;
export type DownloadLink = typeof downloadLinksTable.$inferSelect;

export const dmcaReportsTable = pgTable("dmca_reports", {
  id:              uuid("id").primaryKey().defaultRandom(),
  reporterName:    text("reporter_name").notNull(),
  reporterEmail:   text("reporter_email").notNull(),
  reporterOrg:     text("reporter_org"),
  infringingUrls:  jsonb("infringing_urls").$type<string[]>().notNull().default([]),
  originalUrls:    jsonb("original_urls").$type<string[]>().notNull().default([]),
  description:     text("description").notNull(),
  agreeUnderPenalty: text("agree_under_penalty").notNull().default(""),
  status:          text("status").notNull().default("new"),
  createdAt:       timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertDmcaReportSchema = createInsertSchema(dmcaReportsTable).omit({ id: true, createdAt: true, status: true });
export type InsertDmcaReport = z.infer<typeof insertDmcaReportSchema>;
export type DmcaReport = typeof dmcaReportsTable.$inferSelect;
