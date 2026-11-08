import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

/**
 * AI promotion boosts ledger (migration 0326, stack300 plans-boosts).
 *
 * One row per consumed boost. The plan quotas themselves (Free 3 /
 * Pro 25 / Elite 100 per month) live in the api-server's
 * lib/platform-fees.ts (TIER_AI_BOOSTS — ratified plan terms) and are
 * resolved from the caller's tier at request time; this table only
 * records consumption. periodMonth is 'YYYY-MM' (UTC): the monthly
 * reset is structural — a new month has no rows — never a cron.
 *
 * idempotencyKey is the Post Assist rail's server-derived charge
 * key, UNIQUE: a double-submit of the same draft request consumes
 * exactly one boost, mirroring credit_usage's exactly-once rule.
 * A provider failure after consumption deletes the row (the boost
 * refund), so a failed assist costs nothing either way.
 */
export const aiBoostUsageTable = pgTable(
  "ai_boost_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    periodMonth: text("period_month").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("ai_boost_usage_idempotency_key_ux").on(t.idempotencyKey),
    index("ai_boost_usage_user_period_idx").on(t.userId, t.periodMonth),
  ],
);
