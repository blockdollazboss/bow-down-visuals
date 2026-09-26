import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Sponsor marketplace — brands post paid deals, creators apply with a pitch.
 * Bow Down Visuals takes a 15% cut of every released deal (escrow flow).
 * Must stay in sync with lib/db/migrations/0010_sponsor_deals.sql and
 * lib/db/migrations/0033_sponsor_escrow.sql
 * (boot-time `drizzle-kit push` derives the same shape from this schema).
 *
 * Deal lifecycle:  active → funded → in_progress → completed → paid
 * Application lifecycle: pending → accepted | rejected */

export const sponsorDealsTable = pgTable("sponsor_deals", {
  id:           uuid("id").primaryKey().defaultRandom(),
  brandName:    text("brand_name").notNull(),
  budgetMin:    integer("budget_min").notNull(),
  budgetMax:    integer("budget_max").notNull(),
  niche:        text("niche").notNull(),
  deliverables: text("deliverables").notNull(),
  description:  text("description").notNull(),
  deadline:     timestamp("deadline", { withTimezone: true }).notNull(),
  postedBy:     text("posted_by").notNull(),
  status:       text("status").notNull().default("active"),
  /* v2 — escrow */
  agreedAmountCents:     integer("agreed_amount_cents"),
  escrowStatus:          text("escrow_status").notNull().default("unfunded"),
  stripeSessionId:       text("stripe_session_id"),
  stripePaymentIntentId:  text("stripe_payment_intent_id"),
  platformFeeCents:      integer("platform_fee_cents"),
  creatorPayoutCents:     integer("creator_payout_cents"),
  acceptedApplicationId:  uuid("accepted_application_id"),
  acceptedUserId:         text("accepted_user_id"),
  paidAt:                timestamp("paid_at", { withTimezone: true }),
  createdAt:    timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertSponsorDealSchema = createInsertSchema(sponsorDealsTable).omit({ id: true, createdAt: true });
export type InsertSponsorDeal = z.infer<typeof insertSponsorDealSchema>;
export type SponsorDeal = typeof sponsorDealsTable.$inferSelect;

export const sponsorApplicationsTable = pgTable("sponsor_applications", {
  id:        uuid("id").primaryKey().defaultRandom(),
  dealId:    uuid("deal_id").notNull().references(() => sponsorDealsTable.id, { onDelete: "cascade" }),
  userId:    text("user_id").notNull(),
  pitch:     text("pitch").notNull(),
  /* v2 — review workflow */
  status:       text("status").notNull().default("pending"),
  portfolioUrl: text("portfolio_url"),
  decidedAt:    timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertSponsorApplicationSchema = createInsertSchema(sponsorApplicationsTable).omit({ id: true, createdAt: true });
export type InsertSponsorApplication = z.infer<typeof insertSponsorApplicationSchema>;
export type SponsorApplication = typeof sponsorApplicationsTable.$inferSelect;

/* v2 — payout ledger: one row per released deal.
 * gross = what the brand funded, fee = the Bow Down Visuals cut (15%),
 * net = the creator's payout. */
export const sponsorPayoutsTable = pgTable("sponsor_payouts", {
  id:            uuid("id").primaryKey().defaultRandom(),
  dealId:        uuid("deal_id").notNull().references(() => sponsorDealsTable.id, { onDelete: "cascade" }).unique(),
  creatorUserId: text("creator_user_id").notNull(),
  grossCents:    integer("gross_cents").notNull(),
  feeCents:      integer("fee_cents").notNull(),
  netCents:      integer("net_cents").notNull(),
  status:        text("status").notNull().default("released"),
  stripeTransferId: text("stripe_transfer_id"),
  createdAt:     timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type SponsorPayout = typeof sponsorPayoutsTable.$inferSelect;
