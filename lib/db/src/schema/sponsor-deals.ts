import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* Sponsor marketplace — brands post paid deals, creators apply with a pitch.
 * The site takes a cut of closed deals (handled at payout time, not here).
 * Must stay in sync with lib/db/migrations/0010_sponsor_deals.sql
 * (boot-time `drizzle-kit push` derives the same shape from this schema). */

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
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertSponsorApplicationSchema = createInsertSchema(sponsorApplicationsTable).omit({ id: true, createdAt: true });
export type InsertSponsorApplication = z.infer<typeof insertSponsorApplicationSchema>;
export type SponsorApplication = typeof sponsorApplicationsTable.$inferSelect;
