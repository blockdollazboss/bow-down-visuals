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
   * Temporary-first spend order (migration 0306): how much of this
   * charge came out of the temporary (bonus) pool — deductions draw
   * the temporary pool first, and this records the split so a refund
   * restores the same pools. A refund row carries the negative of the
   * amount it restored INTO the pool. NULL = split never recorded
   * (legacy rows, team-pool charges).
   */
  bonusCreditsUsed: integer("bonus_credits_used"),
  /** The temporary pool's expiry at the moment of the charge. */
  bonusExpiresAt: timestamp("bonus_expires_at", { withTimezone: true }),
  /**
   * Idempotency key for retry-safe operations. When set, the database
   * enforces uniqueness — duplicate submissions return the original result
   * instead of double-charging.
   */
  idempotencyKey: text("idempotency_key"),
  createdAt:  timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

const insertCreditUsageSchema = createInsertSchema(creditUsageTable).omit({ id: true, createdAt: true });
