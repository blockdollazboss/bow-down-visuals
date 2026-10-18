/**
 * daily-quests.ts — The Daily Quest Trio (World Ring 4, THE-GAME).
 *
 * The weekly quests (lib/retention's QUEST_DEFS) run Monday to
 * Monday. The trio is the palace's DAY game: three day-scoped
 * quests, active for one palace day (the UTC day — the same
 * day-turn the King's daily moment fires on), drawn from a pool
 * of definitions by a rotation every client and the server compute
 * identically from the date alone. No scheduler writes the slate;
 * the date IS the slate.
 *
 * Progress rides the SAME creation hook as the weekly quests
 * (lib/retention's recordCreation / recordShareEvent call
 * advanceDailyQuestsForUser right after the weekly update), so
 * doing the verb anywhere — a palace desk, the studio, the 2D
 * site — counts toward today's trio exactly as it counts toward
 * the week. Rows live in daily_quest_progress (migration 0150),
 * one per member × quest × day: yesterday's progress never leaks
 * into today's slate, and a completion left unclaimed at the
 * day-turn expires with its day.
 *
 * THE MONEY RULE (owner-approved, THE-GAME §5 Q4 — the same law
 * the King's gift and the tutorial reward ride): a daily claim is
 * NOT new issuance. It pays out of the shared weekly quest pool
 * (lib/quest-pool: weekly quest claims + King gifts + tutorial
 * rewards + daily claims ≤ 300 VB per member per week), checked
 * BEFORE the claim stamps. A member who already drew the whole
 * pool from the weekly slate is told the pool is spent (reason
 * "pool") — the trio still shows, still completes; its VB simply
 * has nothing left to draw from this week. Alongside the VB, each
 * claim banks MARKS — the trio's non-VB counter, recorded on the
 * claim row (the King's-gift pattern: the row records what was
 * actually paid) and summed honestly from those rows ever since.
 * Marks are not money: they never convert, they only accumulate.
 *
 * Guests hold no hand (access law): both routes are members-only
 * (requireAuth), the progress hook only ever runs for a signed-in
 * member's own creation events, and the Objective Strip never
 * fetches a guest's trio — there is no guest trio to fetch.
 *
 * Everything DB-shaped sits behind DailyQuestStore so the
 * rotation, the tracker and the claimer are unit-tested against
 * fakes; the route layer wires the db store + the pool.
 */

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db, dailyQuestProgressTable } from "@workspace/db";
import { addCreditsAtomic } from "./supabase-admin";
import {
  questPoolSpendVb,
  questPoolWeekStart,
  dbQuestPoolStore,
  WEEKLY_QUEST_POOL_VB,
  type QuestPoolStore,
} from "./quest-pool";
import type { CreationKind } from "./retention";
import { logger } from "./logger";

/* ── The definitions ────────────────────────────────────────────── */

export interface DailyQuestDef {
  key: string;
  /** Display name — spoken by server surfaces (the completion
   *  bell, the witnessed moment) from this def, the weekly
   *  QuestDef.name pattern. */
  name: string;
  /** The weekly quest whose desk performs this verb — the board's
   *  "Go do it" resolves its station/door from this key, so a
   *  daily quest can never point at a dead button. */
  baseKey: string;
  target: number;
  /** VB paid on claim, from the shared weekly pool. Deliberately
   *  small against the 300 envelope — a day's garnish on the
   *  week's meal, never a second quest system. */
  rewardVb: number;
  /** Non-VB marks banked on claim. Not money; never converts. */
  marks: number;
  kinds: CreationKind[];
}

/** The trio's definition pool: the four creation verbs the weekly
 *  slate runs on, dealt at day size — a quick single, then the same
 *  verb doubled. Seven defs, three a day (see the rotation). */
export const DAILY_QUEST_DEFS: DailyQuestDef[] = [
  { key: "daily-first-frame",  name: "First Frame",   baseKey: "make-thumbnail", target: 1, rewardVb: 10, marks: 5, kinds: ["thumbnail"] },
  { key: "daily-song-spark",   name: "Song Spark",    baseKey: "generate-song",  target: 1, rewardVb: 10, marks: 5, kinds: ["song"] },
  { key: "daily-ship-it",      name: "Ship It",       baseKey: "export-video",   target: 1, rewardVb: 10, marks: 5, kinds: ["export"] },
  { key: "daily-double-frame", name: "Double Frame",  baseKey: "make-thumbnail", target: 2, rewardVb: 10, marks: 5, kinds: ["thumbnail"] },
  { key: "daily-second-verse", name: "Second Verse",  baseKey: "generate-song",  target: 2, rewardVb: 10, marks: 5, kinds: ["song"] },
  { key: "daily-loudmouth",    name: "Loudmouth",     baseKey: "viral-sharer",   target: 2, rewardVb: 10, marks: 5, kinds: ["share"] },
  { key: "daily-marathon-cut", name: "Marathon Cut",  baseKey: "export-video",   target: 2, rewardVb: 10, marks: 5, kinds: ["export"] },
];

/** How many of the pool stand on a day's slate. */
export const DAILY_TRIO_SIZE = 3;

export function dailyQuestDef(key: string): DailyQuestDef | null {
  return DAILY_QUEST_DEFS.find((d) => d.key === key) ?? null;
}

/* ── The palace day + the rotation (pure) ───────────────────────── */

/** The palace day: the UTC date, YYYY-MM-DD — the same day key
 *  the King's moment and the site's daily claim run on. */
export function dailyQuestDayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/** Whole days since the epoch for a YYYY-MM-DD key — the
 *  rotation's only input, so any two readers of the same date
 *  deal the same trio. */
export function dailyQuestDayIndex(dayKey: string): number {
  const [y, m, d] = dayKey.split("-").map((p) => Number(p));
  return Math.floor(Date.UTC(y!, (m ?? 1) - 1, d ?? 1) / 86_400_000);
}

/**
 * The trio standing on a palace day: three consecutive defs from
 * the pool, the window's start advancing by a full trio each day
 * (start = dayIndex × 3, mod pool size). Deterministic from the
 * date alone — server, strip and board all deal the same hand —
 * and because the step (3) and the pool (7) are coprime, the
 * start cycles through every residue: consecutive days never
 * repeat a slate, and every def stands within any 3-day span.
 */
export function dailyTrioForDay(dayKey: string): DailyQuestDef[] {
  const n = DAILY_QUEST_DEFS.length;
  const start = (((dailyQuestDayIndex(dayKey) * DAILY_TRIO_SIZE) % n) + n) % n;
  return Array.from({ length: DAILY_TRIO_SIZE }, (_, i) => DAILY_QUEST_DEFS[(start + i) % n]!);
}

/** Today's trio for a moment in time. */
export function dailyTrioFor(now: Date): DailyQuestDef[] {
  return dailyTrioForDay(dailyQuestDayKey(now));
}

/** Is this def on the given day's slate? (A completion from a
 *  past day is NOT claimable today — the slate moved on.) */
export function isDailyQuestActiveOn(key: string, dayKey: string): boolean {
  return dailyTrioForDay(dayKey).some((d) => d.key === key);
}

/* ── The store ──────────────────────────────────────────────────── */

export interface DailyQuestRow {
  questKey: string;
  progress: number;
  target: number;
  completed: boolean;
  rewardVb: number | null;
  marks: number;
  claimedAt: Date | null;
}

export interface DailyQuestStore {
  /** The member's rows for one palace day (any subset of the trio). */
  getDayRows(userId: string, dayKey: string): Promise<DailyQuestRow[]>;
  /** Advance one def by one event (the weekly updateQuests upsert,
   *  day-scoped): progress caps at target; completed flips at the
   *  cap. Returns the row's completion state AFTER the event and
   *  whether it stood completed BEFORE it — the flip is the
   *  caller's bell. */
  advance(
    userId: string,
    def: DailyQuestDef,
    dayKey: string,
  ): Promise<{ completed: boolean; wasCompleted: boolean }>;
  /** One row, or null when the member never touched it that day. */
  getRow(userId: string, questKey: string, dayKey: string): Promise<DailyQuestRow | null>;
  /** The conditional claim stamp: reward + marks + time, only
   *  where the row is completed and still unclaimed. Returns false
   *  when the claim was already taken (a race, or a retry). */
  markClaimed(
    userId: string,
    questKey: string,
    dayKey: string,
    rewardVb: number,
    marks: number,
    now: Date,
  ): Promise<boolean>;
  /** Roll a claim stamp back (the grant failed after the stamp). */
  unmarkClaimed(userId: string, questKey: string, dayKey: string): Promise<void>;
  /** Pay the VB — the site's atomic credit grant. */
  grant(userId: string, amountVb: number): Promise<void>;
  /** Every mark the member has ever banked from the trio — a sum
   *  of the amounts the claim rows recorded, never a stored
   *  figure of our own. */
  marksTotal(userId: string): Promise<number>;
}

function rowOf(r: typeof dailyQuestProgressTable.$inferSelect): DailyQuestRow {
  return {
    questKey: r.questKey,
    progress: r.progress,
    target: r.target,
    completed: r.completed,
    rewardVb: r.rewardVb ?? null,
    marks: r.marks,
    claimedAt: r.claimedAt ? new Date(r.claimedAt) : null,
  };
}

export const dbDailyQuestStore: DailyQuestStore = {
  async getDayRows(userId, dayKey) {
    const rows = await db
      .select()
      .from(dailyQuestProgressTable)
      .where(
        and(
          eq(dailyQuestProgressTable.userId, userId),
          eq(dailyQuestProgressTable.dayDate, dayKey),
        ),
      );
    return rows.map(rowOf);
  },

  async advance(userId, def, dayKey) {
    const [prior] = await db
      .select({ completed: dailyQuestProgressTable.completed })
      .from(dailyQuestProgressTable)
      .where(
        and(
          eq(dailyQuestProgressTable.userId, userId),
          eq(dailyQuestProgressTable.questKey, def.key),
          eq(dailyQuestProgressTable.dayDate, dayKey),
        ),
      )
      .limit(1);
    const [row] = await db
      .insert(dailyQuestProgressTable)
      .values({
        userId,
        questKey: def.key,
        dayDate: dayKey,
        progress: 1,
        target: def.target,
        completed: 1 >= def.target,
      })
      .onConflictDoUpdate({
        target: [
          dailyQuestProgressTable.userId,
          dailyQuestProgressTable.questKey,
          dailyQuestProgressTable.dayDate,
        ],
        set: {
          progress: sql`LEAST(${dailyQuestProgressTable.progress} + 1, ${dailyQuestProgressTable.target})`,
          completed: sql`LEAST(${dailyQuestProgressTable.progress} + 1, ${dailyQuestProgressTable.target}) >= ${dailyQuestProgressTable.target}`,
          updatedAt: new Date(),
        },
      })
      .returning({ completed: dailyQuestProgressTable.completed });
    return { completed: row?.completed ?? false, wasCompleted: prior?.completed ?? false };
  },

  async getRow(userId, questKey, dayKey) {
    const [row] = await db
      .select()
      .from(dailyQuestProgressTable)
      .where(
        and(
          eq(dailyQuestProgressTable.userId, userId),
          eq(dailyQuestProgressTable.questKey, questKey),
          eq(dailyQuestProgressTable.dayDate, dayKey),
        ),
      )
      .limit(1);
    return row ? rowOf(row) : null;
  },

  async markClaimed(userId, questKey, dayKey, rewardVb, marks, now) {
    const updated = await db
      .update(dailyQuestProgressTable)
      .set({ rewardVb, marks, claimedAt: now, updatedAt: now })
      .where(
        and(
          eq(dailyQuestProgressTable.userId, userId),
          eq(dailyQuestProgressTable.questKey, questKey),
          eq(dailyQuestProgressTable.dayDate, dayKey),
          eq(dailyQuestProgressTable.completed, true),
          sql`${dailyQuestProgressTable.claimedAt} IS NULL`,
        ),
      )
      .returning({ userId: dailyQuestProgressTable.userId });
    return updated.length > 0;
  },

  async unmarkClaimed(userId, questKey, dayKey) {
    await db
      .update(dailyQuestProgressTable)
      .set({ rewardVb: null, marks: 0, claimedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(dailyQuestProgressTable.userId, userId),
          eq(dailyQuestProgressTable.questKey, questKey),
          eq(dailyQuestProgressTable.dayDate, dayKey),
        ),
      );
  },

  async grant(userId, amountVb) {
    await addCreditsAtomic(userId, amountVb);
  },

  async marksTotal(userId) {
    const rows = await db
      .select({ marks: dailyQuestProgressTable.marks })
      .from(dailyQuestProgressTable)
      .where(
        and(
          eq(dailyQuestProgressTable.userId, userId),
          isNotNull(dailyQuestProgressTable.claimedAt),
        ),
      );
    return rows.reduce((sum, r) => sum + r.marks, 0);
  },
};

/* ── Progress (the creation hook's daily half) ──────────────────── */

/**
 * Advance today's trio by one creation event. Only defs standing
 * on TODAY's slate whose kinds include the event move — a verb
 * the palace didn't ask for today banks nothing. Returns the defs
 * THIS event flipped to complete (the caller's bell rings for
 * them, once). Never throws: the hook is fire-and-forget, exactly
 * like the weekly tracker it rides beside.
 */
export async function advanceDailyQuests(
  store: DailyQuestStore,
  userId: string,
  kind: CreationKind,
  now: Date = new Date(),
): Promise<DailyQuestDef[]> {
  try {
    const dayKey = dailyQuestDayKey(now);
    const applicable = dailyTrioForDay(dayKey).filter((d) => d.kinds.includes(kind));
    const flipped: DailyQuestDef[] = [];
    for (const def of applicable) {
      const { completed, wasCompleted } = await store.advance(userId, def, dayKey);
      if (completed && !wasCompleted) flipped.push(def);
    }
    return flipped;
  } catch (err) {
    logger.warn({ err, userId, kind }, "[daily-quests] progress advance failed");
    return [];
  }
}

/** The hook entry lib/retention calls — the db store, today's
 *  slate, never throws. */
export async function advanceDailyQuestsForUser(
  userId: string,
  kind: CreationKind,
): Promise<DailyQuestDef[]> {
  return advanceDailyQuests(dbDailyQuestStore, userId, kind);
}

/* ── Status (pure shaping over the store's rows) ────────────────── */

export interface DailyQuestStatusRow {
  key: string;
  name: string;
  baseKey: string;
  target: number;
  rewardVb: number;
  marks: number;
  progress: number;
  completed: boolean;
  claimed: boolean;
}

export interface DailyQuestsStatus {
  /** The palace day this slate belongs to (YYYY-MM-DD, UTC). */
  date: string;
  quests: DailyQuestStatusRow[];
  /** Marks banked from the trio, all-time — the claim rows' sum. */
  marksTotal: number;
  /** The shared weekly pool as the server counts it: the cap and
   *  what this member has already drawn from it this week across
   *  every source — so the board can say plainly when a finished
   *  trio quest's VB must wait for next week. */
  pool: { capVb: number; spentVb: number; remainingVb: number };
}

/** Status from rows — today's trio in slate order, untouched defs
 *  reading as zero progress. Pure: the route's read is this plus
 *  the store + pool reads. */
export function dailyStatusOf(
  dayKey: string,
  rows: DailyQuestRow[],
  marksTotal: number,
  poolSpentVb: number,
): DailyQuestsStatus {
  const byKey = new Map(rows.map((r) => [r.questKey, r]));
  return {
    date: dayKey,
    quests: dailyTrioForDay(dayKey).map((def) => {
      const r = byKey.get(def.key);
      return {
        key: def.key,
        name: def.name,
        baseKey: def.baseKey,
        target: def.target,
        rewardVb: def.rewardVb,
        marks: def.marks,
        progress: r?.progress ?? 0,
        completed: r?.completed ?? false,
        claimed: r?.claimedAt != null,
      };
    }),
    marksTotal,
    pool: {
      capVb: WEEKLY_QUEST_POOL_VB,
      spentVb: poolSpentVb,
      remainingVb: Math.max(0, WEEKLY_QUEST_POOL_VB - poolSpentVb),
    },
  };
}

export async function getDailyQuestsStatus(
  store: DailyQuestStore,
  pool: QuestPoolStore,
  userId: string,
  now: Date = new Date(),
): Promise<DailyQuestsStatus> {
  const dayKey = dailyQuestDayKey(now);
  const [rows, marksTotal, spentVb] = await Promise.all([
    store.getDayRows(userId, dayKey),
    store.marksTotal(userId),
    questPoolSpendVb(pool, userId, questPoolWeekStart(now)),
  ]);
  return dailyStatusOf(dayKey, rows, marksTotal, spentVb);
}

/* ── The claimer ────────────────────────────────────────────────── */

export type DailyClaimResult =
  | { ok: true; amountVb: number; marks: number }
  | {
      ok: false;
      reason: "unknown" | "not-active" | "not-completed" | "already" | "pool" | "disabled" | "error";
    };

/**
 * Build the trio's claim rail: the whole money rule in one place,
 * in the King's-gift order — slate, completion, pool, then the
 * idempotency anchor (the conditional stamp), then the grant; a
 * failed grant rolls the stamp back so the member may retry. The
 * claim reads ONLY today's row: a completion from a past day
 * expired with its day and refuses as "not-active" (its def isn't
 * on today's slate) or "not-completed" (it is, but today's row
 * hasn't finished) — never paid late.
 */
export function createDailyClaimer(
  store: DailyQuestStore = dbDailyQuestStore,
  pool: QuestPoolStore = dbQuestPoolStore,
) {
  return async (
    userId: string,
    questKey: string,
    opts: { enabled: boolean; now?: Date } = { enabled: true },
  ): Promise<DailyClaimResult> => {
    const now = opts.now ?? new Date();
    try {
      if (!opts.enabled) return { ok: false, reason: "disabled" };
      const def = dailyQuestDef(questKey);
      if (!def) return { ok: false, reason: "unknown" };
      const dayKey = dailyQuestDayKey(now);
      if (!isDailyQuestActiveOn(questKey, dayKey)) return { ok: false, reason: "not-active" };
      const row = await store.getRow(userId, questKey, dayKey);
      if (!row?.completed) return { ok: false, reason: "not-completed" };
      if (row.claimedAt) return { ok: false, reason: "already" };
      /* The pool is the shared envelope (lib/quest-pool): weekly
       * quest claims + King gifts + tutorial rewards + daily
       * claims all count, so no rail pays past the member's week. */
      const spentVb = await questPoolSpendVb(pool, userId, questPoolWeekStart(now));
      if (spentVb + def.rewardVb > WEEKLY_QUEST_POOL_VB) {
        return { ok: false, reason: "pool" };
      }
      const stamped = await store.markClaimed(userId, questKey, dayKey, def.rewardVb, def.marks, now);
      if (!stamped) return { ok: false, reason: "already" };
      try {
        await store.grant(userId, def.rewardVb);
      } catch (err) {
        await store.unmarkClaimed(userId, questKey, dayKey).catch(() => undefined);
        logger.error({ err, userId, questKey }, "[daily-quests] grant failed — claim rolled back");
        return { ok: false, reason: "error" };
      }
      logger.info({ userId, questKey, rewardVb: def.rewardVb, marks: def.marks }, "[daily-quests] reward claimed");
      return { ok: true, amountVb: def.rewardVb, marks: def.marks };
    } catch (err) {
      logger.error({ err, userId, questKey }, "[daily-quests] claim failed");
      return { ok: false, reason: "error" };
    }
  };
}
