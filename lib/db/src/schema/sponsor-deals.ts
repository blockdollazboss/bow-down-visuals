import { pgTable, uuid, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Sponsor marketplace — brands post paid deals, creators apply with a pitch.
 * Bow Down Visuals takes a 15% cut of every released deal (escrow flow).
 * Must stay in sync with lib/db/migrations/0010_sponsor_deals.sql,
 * lib/db/migrations/0033_sponsor_escrow.sql and
 * lib/db/migrations/0309_sponsor_applications_deal_user_unique.sql.
 * The (deal_id, user_id) unique index below is load-bearing: the apply
 * route's INSERT ... ON CONFLICT (deal_id, user_id) throws SQLSTATE
 * 42P10 on any database missing it (stack1200 apply fix, 2026-11-01).
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
  /* Direct profile sponsorship (payfix sponsor-purchase lane, provisional
     migration 9999): the creator this deal was bought for from their
     /artist/:slug profile. NULL = a marketplace deal (brand posted it to
     the open board). A direct deal is born with acceptedUserId set to the
     same creator and an accepted application row, so the existing escrow
     lifecycle (fund → start → complete → release) applies unchanged. */
  targetCreatorUserId:    text("target_creator_user_id"),
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
}, (t) => [
  /* One application per creator per deal — also the arbiter index the
     apply route's ON CONFLICT (deal_id, user_id) requires. Created by
     0010 as a table constraint and healed as this named index by 0309
     for databases whose table came from this schema (which previously
     declared no unique here — the stack1200 staging apply failure). */
  uniqueIndex("sponsor_applications_deal_user_ux").on(t.dealId, t.userId),
]);

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
  /** Connect settlement (migration 0142, DE-14): the creator_payouts row
      that paid this ledger line out. Null = not yet settled through the
      Connect payout rail. A payout whose status is 'failed' does NOT
      settle — pendingPayoutCents checks the linked payout's status. */
  settledPayoutId: uuid("settled_payout_id"),
  settledAt:     timestamp("settled_at", { withTimezone: true }),
  createdAt:     timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type SponsorPayout = typeof sponsorPayoutsTable.$inferSelect;
