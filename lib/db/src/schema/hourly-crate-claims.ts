import { pgTable, text, uuid, timestamp, integer } from "drizzle-orm/pg-core";

/**
 * Global hourly crate claims — one row per UTC hour, first come first served.
 * Primary key on hour_slot makes the claim atomic (race-safe).
 */
export const hourlyCrateClaimsTable = pgTable("hourly_crate_claims", {
  hour_slot: text("hour_slot").primaryKey(),
  claimed_by: uuid("claimed_by").notNull(),
  claimed_at: timestamp("claimed_at", { withTimezone: true }).notNull().defaultNow(),
  prize_credits: integer("prize_credits").notNull(),
});

export type HourlyCrateClaimRow = typeof hourlyCrateClaimsTable.$inferSelect;
