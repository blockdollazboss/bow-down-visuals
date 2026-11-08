import { db, aiBoostUsageTable } from "@workspace/db";
import { and, count, eq, sql } from "drizzle-orm";
import { TIER_AI_BOOSTS, type CreatorTier } from "./platform-fees";

/* ── AI promotion boosts — the real allowance (stack300 plans-boosts) ──
   Plan copy has sold "AI promotion boosts" since 2026-10-07 — Free 3 /
   Pro 25 / Elite 100 per month (TIER_AI_BOOSTS, ratified plan terms) —
   but no rail granted, counted, or consumed one: the figure lived only
   in plan DTO serialization, and Post Assist charged everyone a flat
   100 Bucs. This lib is the allowance itself, backed by the
   ai_boost_usage ledger (migration 0326): one row per consumed boost,
   keyed by the consuming rail's charge idempotency key.

   The quota is NEVER stored: it is read from TIER_AI_BOOSTS by the
   caller's resolved tier at request time, so a mid-month tier change
   prices the rest of the month at the new tier against the same
   month's usage. The monthly reset is structural (period = 'YYYY-MM',
   UTC — a new month simply has no rows), never a cron.

   Admin accounts (ADMIN_EMAILS) bypass this lib entirely — the
   standing admin-unrestricted ruling: no row is written for them and
   their price is unchanged (the flat 100 VB charge path, exactly as
   before this rail existed). Callers make that call; see
   fundingFor() and the Post Assist route. */

export interface AiBoostState {
  tier: CreatorTier;
  /** The tier's ratified monthly quota (TIER_AI_BOOSTS). */
  allowance: number;
  /** Boosts consumed in the current period. */
  used: number;
  /** allowance − used, floored at 0. */
  remaining: number;
  /** 'YYYY-MM' (UTC) the counts belong to. */
  period: string;
}

/** The current boost period for a moment in time: 'YYYY-MM', UTC. */
export function boostPeriodFor(now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

/** Pure state assembly — the quota always comes from the tier. */
export function computeBoostState(tier: CreatorTier, used: number, period: string): AiBoostState {
  const allowance = TIER_AI_BOOSTS[tier];
  const safeUsed = Math.max(0, Math.floor(used) || 0);
  return {
    tier,
    allowance,
    used: safeUsed,
    remaining: Math.max(0, allowance - safeUsed),
    period,
  };
}

export type AssistFunding = "admin" | "boost" | "charge";

/**
 * The Post Assist funding decision, in order:
 *   admin   → the counter never applies (admin-unrestricted ruling);
 *             the route takes the unchanged 100 VB charge path.
 *   boost   → a plan boost covers this assist; no credit charge.
 *   charge  → the allowance is spent; the flat 100 VB charge applies.
 */
export function fundingFor(args: { isAdmin: boolean; remaining: number }): AssistFunding {
  if (args.isAdmin) return "admin";
  return args.remaining > 0 ? "boost" : "charge";
}

async function countUsedBoosts(userId: string, period: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(aiBoostUsageTable)
    .where(and(eq(aiBoostUsageTable.userId, userId), eq(aiBoostUsageTable.periodMonth, period)));
  return row?.value ?? 0;
}

/**
 * The caller's boost state for the current period. Throws on a DB
 * failure — callers degrade deliberately (the assist route falls back
 * to the charge path; the /me DTO omits the fields) rather than
 * inventing a count.
 */
export async function getAiBoostState(
  userId: string,
  tier: CreatorTier,
  now: Date = new Date(),
): Promise<AiBoostState> {
  const period = boostPeriodFor(now);
  const used = await countUsedBoosts(userId, period);
  return computeBoostState(tier, used, period);
}

export type ConsumeBoostOutcome =
  /** A boost was consumed by this call. */
  | "consumed"
  /** This idempotency key already consumed its boost (a resubmit of
      the same request) — the assist is boost-funded, count unchanged. */
  | "replay"
  /** The month's allowance is spent — the caller charges instead. */
  | "exhausted";

/**
 * Consume one boost for an assist, exactly once per idempotency key.
 * Serialized per (user, period) with a transaction advisory lock so
 * two parallel assists can never both take the month's last boost.
 * Returns the outcome plus the post-call state (on "exhausted", the
 * state that proved it).
 */
export async function tryConsumeAiBoost(
  userId: string,
  tier: CreatorTier,
  idempotencyKey: string,
  now: Date = new Date(),
): Promise<{ outcome: ConsumeBoostOutcome; state: AiBoostState }> {
  const period = boostPeriodFor(now);
  const allowance = TIER_AI_BOOSTS[tier];
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:${period}`}, 0))`);
    const [existing] = await tx
      .select({ id: aiBoostUsageTable.id })
      .from(aiBoostUsageTable)
      .where(eq(aiBoostUsageTable.idempotencyKey, idempotencyKey))
      .limit(1);
    if (existing) {
      const [replayRow] = await tx
        .select({ value: count() })
        .from(aiBoostUsageTable)
        .where(and(eq(aiBoostUsageTable.userId, userId), eq(aiBoostUsageTable.periodMonth, period)));
      return { outcome: "replay" as const, state: computeBoostState(tier, replayRow?.value ?? 0, period) };
    }
    const [row] = await tx
      .select({ value: count() })
      .from(aiBoostUsageTable)
      .where(and(eq(aiBoostUsageTable.userId, userId), eq(aiBoostUsageTable.periodMonth, period)));
    const used = row?.value ?? 0;
    if (used >= allowance) {
      return { outcome: "exhausted" as const, state: computeBoostState(tier, used, period) };
    }
    await tx.insert(aiBoostUsageTable).values({ userId, periodMonth: period, idempotencyKey });
    return { outcome: "consumed" as const, state: computeBoostState(tier, used + 1, period) };
  });
}

/**
 * Give a consumed boost back — the boost twin of the credit refund,
 * called when the assist fails after consumption. Idempotent: a
 * missing row (already refunded, never consumed) is a no-op.
 */
export async function refundAiBoost(userId: string, idempotencyKey: string): Promise<void> {
  await db
    .delete(aiBoostUsageTable)
    .where(and(eq(aiBoostUsageTable.userId, userId), eq(aiBoostUsageTable.idempotencyKey, idempotencyKey)));
}
