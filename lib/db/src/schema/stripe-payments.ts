import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const stripePaymentsTable = pgTable("stripe_payments", {
  id:                   uuid("id").primaryKey().defaultRandom(),
  stripeSessionId:      text("stripe_session_id").unique().notNull(),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  userId:               uuid("user_id").notNull(),
  creditPack:           text("credit_pack"),
  creditsAmount:        integer("credits_amount").notNull(),
  amountTotal:          integer("amount_total"),
  currency:             text("currency"),
  status:               text("status").default("completed"),
  createdAt:            timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertStripePaymentSchema = createInsertSchema(stripePaymentsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertStripePayment = z.infer<typeof insertStripePaymentSchema>;
export type StripePayment = typeof stripePaymentsTable.$inferSelect;
