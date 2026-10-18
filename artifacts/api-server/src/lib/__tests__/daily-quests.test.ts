/**
 * The Daily Quest Trio (lib/daily-quests + the lib/quest-pool
 * extension, World Ring 4).
 *
 * Pinned contract:
 * - The slate is the DATE's, not a scheduler's: three defs dealt
 *   deterministically from the pool (start = dayIndex × 3 mod 7),
 *   identical for every reader, never repeating within a day,
 *   never repeating the previous day, covering the whole pool
 *   inside any 3-day span.
 * - Progress is day-scoped and slate-scoped: only today's trio
 *   moves, only on its own verbs; yesterday's rows are another
 *   day's business.
 * - The claim pays from the SHARED weekly pool — weekly quests +
 *   King gifts + tutorial + dailies ≤ 300 VB/week (lib/quest-pool,
 *   four sources now): a spent week refuses with "pool", the
 *   boundary pays exactly, and the claim stamps BEFORE the grant
 *   so a double claim can never double-pay; a failed grant rolls
 *   the stamp back for a retry.
 * - A past day's finish is NOT claimable today: the slate moved
 *   on ("not-active") — day-scoped means day-scoped.
 * - Marks bank alongside the VB: recorded on the claim row, summed
 *   from the rows, never convertible, never in the pool's math.
 */
import { describe, it, expect } from "vitest";
import {
  DAILY_QUEST_DEFS,
  DAILY_TRIO_SIZE,
  advanceDailyQuests,
  createDailyClaimer,
  dailyQuestDayIndex,
  dailyQuestDayKey,
  dailyStatusOf,
  dailyTrioForDay,
  getDailyQuestsStatus,
  isDailyQuestActiveOn,
  type DailyQuestDef,
  type DailyQuestRow,
  type DailyQuestStore,
} from "../daily-quests";
import {
  dailyWeekWindow,
  questPoolSpendVb,
  questPoolWeekStart,
  WEEKLY_QUEST_POOL_VB,
  type QuestPoolStore,
} from "../quest-pool";

/* ── Fakes ──────────────────────────────────────────────────────── */

class FakeDailyStore implements DailyQuestStore {
  rows = new Map<string, DailyQuestRow & { dayKey: string }>();
  owners = new Map<string, string>();
  grants: { userId: string; amountVb: number }[] = [];
  grantFails = false;
  unmarks: string[] = [];

  private k(userId: string, questKey: string, dayKey: string) {
    return `${userId}|${questKey}|${dayKey}`;
  }
  async getDayRows(userId: string, dayKey: string) {
    const out: DailyQuestRow[] = [];
    for (const [key, row] of this.rows) {
      if (this.owners.get(key) === userId && row.dayKey === dayKey) out.push({ ...row });
    }
    return out;
  }
  async advance(userId: string, def: DailyQuestDef, dayKey: string) {
    const key = this.k(userId, def.key, dayKey);
    const prior = this.rows.get(key);
    const wasCompleted = prior?.completed ?? false;
    const progress = Math.min((prior?.progress ?? 0) + 1, def.target);
    const row: DailyQuestRow & { dayKey: string } = {
      questKey: def.key,
      progress,
      target: def.target,
      completed: progress >= def.target,
      rewardVb: prior?.rewardVb ?? null,
      marks: prior?.marks ?? 0,
      claimedAt: prior?.claimedAt ?? null,
      dayKey,
    };
    this.rows.set(key, row);
    this.owners.set(key, userId);
    return { completed: row.completed, wasCompleted };
  }
  async getRow(userId: string, questKey: string, dayKey: string) {
    const row = this.rows.get(this.k(userId, questKey, dayKey));
    return row ? { ...row } : null;
  }
  async markClaimed(userId: string, questKey: string, dayKey: string, rewardVb: number, marks: number, now: Date) {
    const row = this.rows.get(this.k(userId, questKey, dayKey));
    if (!row || !row.completed || row.claimedAt) return false;
    row.rewardVb = rewardVb;
    row.marks = marks;
    row.claimedAt = now;
    return true;
  }
  async unmarkClaimed(userId: string, questKey: string, dayKey: string) {
    const row = this.rows.get(this.k(userId, questKey, dayKey));
    if (row) {
      row.rewardVb = null;
      row.marks = 0;
      row.claimedAt = null;
    }
    this.unmarks.push(questKey);
  }
  async grant(userId: string, amountVb: number) {
    if (this.grantFails) throw new Error("grant boom");
    this.grants.push({ userId, amountVb });
  }
  async marksTotal(userId: string) {
    let sum = 0;
    for (const [key, row] of this.rows) {
      if (this.owners.get(key) === userId && row.claimedAt) sum += row.marks;
    }
    return sum;
  }
  /** Test helper: force a row into a state (a finished day, etc.). */
  seed(userId: string, questKey: string, dayKey: string, row: Partial<DailyQuestRow>) {
    const def = DAILY_QUEST_DEFS.find((d) => d.key === questKey)!;
    const key = this.k(userId, questKey, dayKey);
    this.rows.set(key, {
      questKey,
      progress: row.progress ?? def.target,
      target: def.target,
      completed: row.completed ?? true,
      rewardVb: row.rewardVb ?? null,
      marks: row.marks ?? 0,
      claimedAt: row.claimedAt ?? null,
      dayKey,
    });
    this.owners.set(key, userId);
  }
}

interface PoolSums {
  quests: number;
  king: number;
  tutorial: number;
  daily: number;
}

function poolOf(sums: PoolSums): QuestPoolStore {
  return {
    questClaimsVb: async () => sums.quests,
    kingClaimsVb: async () => sums.king,
    tutorialClaimsVb: async () => sums.tutorial,
    dailyClaimsVb: async () => sums.daily,
  };
}

const NO_SPEND: PoolSums = { quests: 0, king: 0, tutorial: 0, daily: 0 };

/* 2026-10-18 is a Sunday; 2026-10-19 the Monday after. */
const SUN = new Date("2026-10-18T12:00:00.000Z");
const SUN_KEY = "2026-10-18";
const MON_KEY = "2026-10-19";

/* ── The rotation ───────────────────────────────────────────────── */

describe("the trio rotation (pure, date-dealt)", () => {
  it("deals exactly three distinct defs, every day", () => {
    for (let i = 0; i < 28; i++) {
      const day = new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
      const trio = dailyTrioForDay(day);
      expect(trio).toHaveLength(DAILY_TRIO_SIZE);
      expect(new Set(trio.map((d) => d.key)).size).toBe(DAILY_TRIO_SIZE);
    }
  });

  it("is deterministic: the same date deals the same trio to every reader", () => {
    const a = dailyTrioForDay(SUN_KEY).map((d) => d.key);
    const b = dailyTrioForDay(SUN_KEY).map((d) => d.key);
    expect(a).toEqual(b);
    // …and the day key itself is the UTC date, palace-day style.
    expect(dailyQuestDayKey(new Date("2026-10-18T23:59:59.000Z"))).toBe(SUN_KEY);
    expect(dailyQuestDayKey(new Date("2026-10-19T00:00:00.000Z"))).toBe(MON_KEY);
  });

  it("turns at the day boundary: consecutive days never share a def", () => {
    for (let i = 0; i < 28; i++) {
      const d1 = new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10);
      const d2 = new Date(Date.UTC(2026, 9, 2 + i)).toISOString().slice(0, 10);
      const a = new Set(dailyTrioForDay(d1).map((d) => d.key));
      for (const def of dailyTrioForDay(d2)) expect(a.has(def.key)).toBe(false);
    }
  });

  it("covers the whole pool inside any 3-day span", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const day = new Date(Date.UTC(2026, 9, 18 + i)).toISOString().slice(0, 10);
      for (const def of dailyTrioForDay(day)) seen.add(def.key);
    }
    expect(seen.size).toBe(DAILY_QUEST_DEFS.length);
  });

  it("does not reset at the week boundary — the day is the scope", () => {
    // Sunday → Monday is a new quest WEEK; the trio just turns.
    expect(questPoolWeekStart(SUN)).toBe("2026-10-12");
    expect(questPoolWeekStart(new Date("2026-10-19T00:00:00.000Z"))).toBe(MON_KEY);
    expect(dailyQuestDayIndex(MON_KEY) - dailyQuestDayIndex(SUN_KEY)).toBe(1);
    const sun = new Set(dailyTrioForDay(SUN_KEY).map((d) => d.key));
    for (const def of dailyTrioForDay(MON_KEY)) expect(sun.has(def.key)).toBe(false);
  });

  it("the defs ride the weekly verbs at day size, priced as garnish", () => {
    const weeklyKeys = new Set(["make-thumbnail", "generate-song", "export-video", "viral-sharer"]);
    for (const def of DAILY_QUEST_DEFS) {
      expect(weeklyKeys.has(def.baseKey)).toBe(true);
      expect(def.kinds.length).toBeGreaterThan(0);
      expect(def.rewardVb).toBeGreaterThan(0);
      expect(def.rewardVb).toBeLessThanOrEqual(10);
      expect(def.marks).toBeGreaterThan(0);
    }
    // A full day of trio claims can never rival the week's slate.
    const dayMax = DAILY_TRIO_SIZE * Math.max(...DAILY_QUEST_DEFS.map((d) => d.rewardVb));
    expect(dayMax).toBeLessThanOrEqual(WEEKLY_QUEST_POOL_VB / 10);
  });
});

/* ── Progress ───────────────────────────────────────────────────── */

describe("progress (the creation hook's daily half)", () => {
  it("advances only today's trio, only on its own verbs", async () => {
    const store = new FakeDailyStore();
    const trio = dailyTrioForDay(SUN_KEY);
    const songDef = trio.find((d) => d.kinds.includes("song"));
    const shareDef = DAILY_QUEST_DEFS.find(
      (d) => d.kinds.includes("share") && !trio.some((t) => t.key === d.key),
    );
    // A song event moves the trio's song def (when the slate has one)…
    if (songDef) {
      await advanceDailyQuests(store, "user-a", "song", SUN);
      const row = await store.getRow("user-a", songDef.key, SUN_KEY);
      expect(row?.progress).toBe(1);
    }
    // …and a share event banks nothing when Loudmouth isn't dealt.
    if (shareDef) {
      const flipped = await advanceDailyQuests(store, "user-a", "share", SUN);
      expect(flipped).toEqual([]);
      expect(await store.getRow("user-a", shareDef.key, SUN_KEY)).toBeNull();
    }
  });

  it("reports the completion flip exactly once", async () => {
    const store = new FakeDailyStore();
    const trio = dailyTrioForDay(SUN_KEY);
    const single = trio.find((d) => d.target === 1)!;
    const kind = single.kinds[0]!;
    const first = await advanceDailyQuests(store, "user-a", kind, SUN);
    expect(first.map((d) => d.key)).toContain(single.key);
    const second = await advanceDailyQuests(store, "user-a", kind, SUN);
    expect(second.map((d) => d.key)).not.toContain(single.key);
    const row = await store.getRow("user-a", single.key, SUN_KEY);
    expect(row?.progress).toBe(1); // capped at target, never past
  });

  it("is day-scoped: tomorrow's slate starts from zero", async () => {
    const store = new FakeDailyStore();
    const trio = dailyTrioForDay(SUN_KEY);
    const def = trio[0]!;
    await advanceDailyQuests(store, "user-a", def.kinds[0]!, SUN);
    expect((await store.getRow("user-a", def.key, SUN_KEY))?.progress).toBe(1);
    expect(await store.getRow("user-a", def.key, MON_KEY)).toBeNull();
  });
});

/* ── Status ─────────────────────────────────────────────────────── */

describe("status shaping", () => {
  it("reads untouched defs as zero and carries the pool's state", async () => {
    const store = new FakeDailyStore();
    const status = await getDailyQuestsStatus(
      store,
      poolOf({ quests: 120, king: 25, tutorial: 30, daily: 10 }),
      "user-a",
      SUN,
    );
    expect(status.date).toBe(SUN_KEY);
    expect(status.quests).toHaveLength(DAILY_TRIO_SIZE);
    expect(status.quests.every((q) => q.progress === 0 && !q.completed && !q.claimed)).toBe(true);
    expect(status.pool).toEqual({ capVb: 300, spentVb: 185, remainingVb: 115 });
    expect(status.marksTotal).toBe(0);
  });

  it("dailyStatusOf merges rows in slate order", () => {
    const trio = dailyTrioForDay(SUN_KEY);
    const rows: DailyQuestRow[] = [
      { questKey: trio[1]!.key, progress: 1, target: trio[1]!.target, completed: false, rewardVb: null, marks: 0, claimedAt: null },
    ];
    const status = dailyStatusOf(SUN_KEY, rows, 15, 0);
    expect(status.quests.map((q) => q.key)).toEqual(trio.map((d) => d.key));
    expect(status.quests[1]?.progress).toBe(1);
    expect(status.marksTotal).toBe(15);
  });
});

/* ── The claimer ────────────────────────────────────────────────── */

describe("the claimer (the shared pool is the law)", () => {
  async function completedToday(store: FakeDailyStore, userId = "user-a") {
    const def = dailyTrioForDay(SUN_KEY).find((d) => d.target === 1)!;
    store.seed(userId, def.key, SUN_KEY, { completed: true, progress: def.target });
    return def;
  }

  it("pays the VB and banks the marks on a clean claim", async () => {
    const store = new FakeDailyStore();
    const def = await completedToday(store);
    const claim = createDailyClaimer(store, poolOf(NO_SPEND));
    const result = await claim("user-a", def.key, { enabled: true, now: SUN });
    expect(result).toEqual({ ok: true, amountVb: def.rewardVb, marks: def.marks });
    expect(store.grants).toEqual([{ userId: "user-a", amountVb: def.rewardVb }]);
    expect(await store.marksTotal("user-a")).toBe(def.marks);
  });

  it("worked example — the four sources share ONE envelope", async () => {
    // The member already drew 240 from weekly quests, 25 from a
    // King gift and 30 from the tutorial: 295 of the 300 pool.
    // A 10 VB daily claim would take the week to 305 — refused.
    const store = new FakeDailyStore();
    const def = await completedToday(store);
    const claim = createDailyClaimer(store, poolOf({ quests: 240, king: 25, tutorial: 30, daily: 0 }));
    expect(await claim("user-a", def.key, { enabled: true, now: SUN })).toEqual({
      ok: false,
      reason: "pool",
    });
    expect(store.grants).toEqual([]);
  });

  it("the boundary pays exactly: spend + reward == 300 lands", async () => {
    const store = new FakeDailyStore();
    const def = await completedToday(store);
    // 260 weekly + 30 tutorial + this claim's 10 == 300 on the nose.
    const claim = createDailyClaimer(store, poolOf({ quests: 260, king: 0, tutorial: 30, daily: 0 }));
    const result = await claim("user-a", def.key, { enabled: true, now: SUN });
    expect(result.ok).toBe(true);
  });

  it("earlier daily claims count against later ones the same week", async () => {
    const store = new FakeDailyStore();
    const def = await completedToday(store);
    // Two dailies already paid this week (20) + 275 weekly = 295.
    const claim = createDailyClaimer(store, poolOf({ quests: 275, king: 0, tutorial: 0, daily: 20 }));
    expect(await claim("user-a", def.key, { enabled: true, now: SUN })).toEqual({
      ok: false,
      reason: "pool",
    });
  });

  it("is idempotent: a second claim refuses as already, paying nothing more", async () => {
    const store = new FakeDailyStore();
    const def = await completedToday(store);
    const claim = createDailyClaimer(store, poolOf(NO_SPEND));
    expect((await claim("user-a", def.key, { enabled: true, now: SUN })).ok).toBe(true);
    expect(await claim("user-a", def.key, { enabled: true, now: SUN })).toEqual({
      ok: false,
      reason: "already",
    });
    expect(store.grants).toHaveLength(1);
    expect(await store.marksTotal("user-a")).toBe(def.marks); // marks once, too
  });

  it("refuses unfinished, unknown, disabled and off-slate claims", async () => {
    const store = new FakeDailyStore();
    const claim = createDailyClaimer(store, poolOf(NO_SPEND));
    const trio = dailyTrioForDay(SUN_KEY);
    expect(await claim("user-a", trio[0]!.key, { enabled: true, now: SUN })).toEqual({
      ok: false,
      reason: "not-completed",
    });
    expect(await claim("user-a", "daily-nope", { enabled: true, now: SUN })).toEqual({
      ok: false,
      reason: "unknown",
    });
    const def = await completedToday(store);
    expect(await claim("user-a", def.key, { enabled: false, now: SUN })).toEqual({
      ok: false,
      reason: "disabled",
    });
  });

  it("a past day's finish expires with its day — never paid late", async () => {
    const store = new FakeDailyStore();
    const def = dailyTrioForDay(SUN_KEY)[0]!;
    // Finished (and left unclaimed) on Sunday…
    store.seed("user-a", def.key, SUN_KEY, { completed: true, progress: def.target });
    // …claimed on Monday, when the def is guaranteed off-slate.
    const claim = createDailyClaimer(store, poolOf(NO_SPEND));
    const monday = new Date("2026-10-19T09:00:00.000Z");
    expect(isDailyQuestActiveOn(def.key, MON_KEY)).toBe(false);
    expect(await claim("user-a", def.key, { enabled: true, now: monday })).toEqual({
      ok: false,
      reason: "not-active",
    });
    expect(store.grants).toEqual([]);
  });

  it("a failed grant rolls the stamp back and a retry lands", async () => {
    const store = new FakeDailyStore();
    const def = await completedToday(store);
    const claim = createDailyClaimer(store, poolOf(NO_SPEND));
    store.grantFails = true;
    expect(await claim("user-a", def.key, { enabled: true, now: SUN })).toEqual({
      ok: false,
      reason: "error",
    });
    expect(store.unmarks).toContain(def.key);
    store.grantFails = false;
    expect((await claim("user-a", def.key, { enabled: true, now: SUN })).ok).toBe(true);
    expect(store.grants).toHaveLength(1);
  });
});

/* ── The pool's fourth source ───────────────────────────────────── */

describe("lib/quest-pool with the daily source", () => {
  it("sums all four sources — dailies included", async () => {
    const spent = await questPoolSpendVb(
      poolOf({ quests: 100, king: 25, tutorial: 30, daily: 20 }),
      "user-a",
      "2026-10-12",
    );
    expect(spent).toBe(175);
    expect(WEEKLY_QUEST_POOL_VB).toBe(300);
  });

  it("the daily week window is [Monday, next Monday)", () => {
    expect(dailyWeekWindow("2026-10-12")).toEqual({ from: "2026-10-12", to: "2026-10-19" });
    expect(dailyWeekWindow("2026-12-28")).toEqual({ from: "2026-12-28", to: "2027-01-04" });
  });
});
