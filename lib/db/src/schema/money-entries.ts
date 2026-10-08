import { pgTable, uuid, text, timestamp, integer, date } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* ── Creator Money Tracker ───────────────────────────────────────────────
   Per-user income/expense ledger backing the "Money Tracker" tab on /coach.
   amount_cents is always positive; entry_type ("income"|"expense") gives the
   sign. Pure UI + DB — no credits charged for any operation. */

export const MONEY_ENTRY_TYPES = ["income", "expense"] as const;
export type MoneyEntryType = (typeof MONEY_ENTRY_TYPES)[number];

/** Income categories (canonical values stored in DB; labels localized). */
export const MONEY_INCOME_CATEGORIES = [
  "sponsor_deals",
  "merch_sales",
  "streaming_royalties",
  "ad_revenue",
  "subscriptions",
  "affiliate",
  "invoice_payout",
  "other_income",
] as const;

/** Expense categories (canonical values stored in DB; labels localized). */
export const MONEY_EXPENSE_CATEGORIES = [
  "equipment",
  "software",
  "ads",
  "travel",
  "contractors",
  "production",
  "other_expense",
] as const;

export const moneyEntriesTable = pgTable("money_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: uuid("user_id").notNull(),
  entry_type: text("entry_type").notNull().$type<MoneyEntryType>(),
  category: text("category").notNull().default("other"),
  amount_cents: integer("amount_cents").notNull(),
  note: text("note").notNull().default(""),
  source: text("source"),
  entry_date: date("entry_date").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMoneyEntrySchema = createInsertSchema(moneyEntriesTable)
  .omit({ id: true, created_at: true, updated_at: true })
  .extend({
    entry_type: z.enum(MONEY_ENTRY_TYPES),
    amount_cents: z.number().int().min(1).max(100_000_000_00),
    category: z.string().trim().min(1).max(60),
    note: z.string().trim().max(280).default(""),
    entry_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
  });

export const selectMoneyEntrySchema = createSelectSchema(moneyEntriesTable);

export type InsertMoneyEntry = z.infer<typeof insertMoneyEntrySchema>;
export type MoneyEntry = typeof moneyEntriesTable.$inferSelect;
