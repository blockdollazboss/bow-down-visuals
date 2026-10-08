import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { creatorProfilesTable } from "./creator-platform";

/**
 * Custom domains — Worker 10: creator "own website" flagship.
 * (migration 0095_custom_domains.sql)
 *
 * <slug>.bowdownvisuals.com is free by convention (no row needed). A paid-tier
 * OWN domain is a row here: CNAME → the platform target + TXT proof of
 * ownership. GET /api/domains/resolve?host= maps a verified hostname back to
 * the profile slug for Site Mode rendering.
 */
export const customDomainsTable = pgTable("custom_domains", {
  id:                uuid("id").primaryKey().defaultRandom(),
  profileId:         uuid("profile_id").notNull()
    .references(() => creatorProfilesTable.id, { onDelete: "cascade" }),
  hostname:          text("hostname").notNull().unique(),
  status:            text("status").notNull().default("pending")
    .$type<"pending" | "verifying" | "active" | "failed">(),
  verificationToken: text("verification_token").notNull(),
  verifiedAt:        timestamp("verified_at", { withTimezone: true }),
  isPrimary:         boolean("is_primary").notNull().default(false),
  createdAt:         timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertCustomDomainSchema = createInsertSchema(customDomainsTable).omit({
  id: true, verificationToken: true, verifiedAt: true, createdAt: true,
});
export type InsertCustomDomain = z.infer<typeof insertCustomDomainSchema>;
export type CustomDomain = typeof customDomainsTable.$inferSelect;
