import { pgTable, uuid, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* ─── Sponsor invoices ────────────────────────────────────────────────────
   Creators who land brand deals generate branded invoices to bill the
   sponsor. PDF is rendered server-side from the stored row at download
   time (no blob storage), so regenerating always reflects the latest
   branding/footer. Amounts are stored in minor units (cents).

   Invoice lifecycle: draft/unpaid → paid (manually marked by the creator).
   Keep in sync with lib/db/migrations/0075_invoices.sql. */

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  rateCents: number;
}

export const INVOICE_STATUSES = ["unpaid", "paid"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const invoicesTable = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: text("user_id").notNull(),
  invoiceNumber: text("invoice_number").notNull(),
  brandName: text("brand_name").notNull(),
  brandEmail: text("brand_email"),
  creatorName: text("creator_name").notNull(),
  creatorEmail: text("creator_email"),
  paymentDetails: text("payment_details"),
  lineItems: jsonb("line_items").$type<InvoiceLineItem[]>().notNull(),
  totalCents: integer("total_cents").notNull(),
  currency: text("currency").notNull().default("USD"),
  dueDate: timestamp("due_date", { withTimezone: true }).notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("unpaid"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertInvoiceSchema = createInsertSchema(invoicesTable).omit({ id: true, createdAt: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoicesTable.$inferSelect;
