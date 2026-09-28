import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const creditUsageTable = pgTable("credit_usage", {
  id:         uuid("id").primaryKey().defaultRandom(),
  userId:     uuid("user_id").notNull(),
  action:     text("action").notNull(),
  creditsUsed: integer("credits_used").notNull(),
  projectId:  uuid("project_id"),
  /** When the spend came from a team pool, the team that was charged. */
  teamId:     uuid("team_id"),
  /**
   * Idempotency key for retry-safe operations. When set, the database
   * enforces uniqueness — duplicate submissions return the original result
   * instead of double-charging.
   */
  idempotencyKey: text("idempotency_key"),
  createdAt:  timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertCreditUsageSchema = createInsertSchema(creditUsageTable).omit({ id: true, createdAt: true });
export type InsertCreditUsage = z.infer<typeof insertCreditUsageSchema>;
export type CreditUsage = typeof creditUsageTable.$inferSelect;
