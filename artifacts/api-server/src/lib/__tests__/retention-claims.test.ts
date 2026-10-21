/**
 * retention-claims.test.ts — streak-milestone + quest claim hardening.
 *
 * Two defects in the claim paths:
 *
 *  1. LOST-CLAIM OVERWRITE (double-pay). claimStreakMilestone read
 *     milestonesClaimed, appended in JS, and wrote the whole array back
 *     under a NOT-@> guard for the milestone being claimed. Two
 *     concurrent claims of DIFFERENT milestones both read the same stale
 *     array; the second write erased the first claim's marker — that
 *     milestone became claimable (and payable) a second time. The fix
 *     appends IN SQL: milestones_claimed || ARRAY[days]. These tests
 *     render the actual SET clause with PgDialect and assert it is the
 *     append expression, not a JS array.
 *
 *  2. READ-MODIFY-WRITE PAYOUTS. Both claims paid via
 *     addCreditsToProfile (fetch balance → write balance + reward), the
 *     lost-update race addCreditsAtomic exists to kill (increment_credits
 *     RPC, Supabase migration 0062). Both claims now pay atomically.
 *
 * The claim CAS itself (NOT-@> guard / claimed_at IS NULL, zero rows =
 * already claimed) was already correct and is asserted here as the
 * no-payout-on-loss contract. Fake-db style mirrors credits-team-pool.
 *
 * The milestone block also pins the per-claim record (migration
 * 0165): a paid milestone claim writes exactly one
 * retention_claim_records row (kind "streak_milestone", ref = the
 * milestone day count, amount = the reward paid); a refused claim
 * and a failed payout write none. (Quest claims stamp claimed_at on
 * their own progress row — they needed no record and write none.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const h = vi.hoisted(() => ({
  state: {
    streakRow: null as any,
    questRows: [] as any[],
    /** Rows the next claim UPDATE ... RETURNING resolves (CAS outcome). */
    claimUpdateRows: [{ userId: "u" }] as any[],
    updates: [] as Array<{ table: unknown; set: Record<string, unknown>; where: unknown }>,
    atomicCalls: [] as Array<{ userId: string; amount: number }>,
    rmwCalls: [] as Array<{ userId: string; amount: number }>,
    /** retention_claim_records rows the fake db accepted (migration
     *  0165), with the table's unique (user, kind, ref) applied. */
    claimRecords: [] as any[],
    /** When true, the atomic payout throws (payout-failure case). */
    payoutFails: false,
  },
}));

vi.mock("../supabase-admin", () => ({
  addCreditsAtomic: vi.fn(async (userId: string, amount: number) => {
    h.state.atomicCalls.push({ userId, amount });
    if (h.state.payoutFails) throw new Error("increment_credits unavailable");
    return { oldCredits: 0, newCredits: amount, created: false };
  }),
  addCreditsToProfile: vi.fn(async (userId: string, amount: number) => {
    h.state.rmwCalls.push({ userId, amount });
    return { oldCredits: 0, newCredits: amount, created: false };
  }),
  getSupabaseAdmin: () => {
    throw new Error("retention claims must not use the raw admin client");
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { creationStreaksTable, questProgressTable, retentionPrefsTable, retentionClaimRecordsTable } = actual;
  const state = h.state;
  const fakeDb = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (_cond: unknown) => {
          const read = async () => {
            if (table === retentionPrefsTable) return []; // defaults: enabled
            if (table === creationStreaksTable) return state.streakRow ? [state.streakRow] : [];
            if (table === questProgressTable) return state.questRows;
            return [];
          };
          return {
            limit: async (_n: number) => read(),
            then: (res: any, rej: any) => read().then(res, rej),
          };
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (vals: Record<string, unknown>) => ({
        where: (cond: unknown) => ({
          returning: async (_fields?: unknown) => {
            state.updates.push({ table, set: vals, where: cond });
            return state.claimUpdateRows;
          },
        }),
      }),
    }),
    insert: (table: unknown) => {
      // The only insert a claim may make is its per-claim record
      // (migration 0165) — anything else is still a defect here.
      if (table !== retentionClaimRecordsTable) {
        throw new Error("claims must not insert");
      }
      return {
        values: (v: any) => ({
          onConflictDoNothing: async () => {
            const dupe = state.claimRecords.some(
              (r) => r.userId === v.userId && r.kind === v.kind && r.refKey === v.refKey,
            );
            if (!dupe) state.claimRecords.push({ ...v });
          },
        }),
      };
    },
  };
  return { ...actual, db: fakeDb };
});

import {
  claimStreakMilestone,
  claimQuestReward,
  currentWeekStart,
} from "../retention";
import { creationStreaksTable, questProgressTable } from "@workspace/db";

const dialect = new PgDialect();
const USER = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  h.state.streakRow = {
    userId: USER,
    currentStreak: 10,
    longestStreak: 10,
    lastCreationDate: "2026-10-13",
    milestonesClaimed: [],
  };
  h.state.questRows = [];
  h.state.claimUpdateRows = [{ userId: USER }];
  h.state.updates = [];
  h.state.atomicCalls = [];
  h.state.rmwCalls = [];
  h.state.claimRecords = [];
  h.state.payoutFails = false;
});

describe("claimStreakMilestone", () => {
  it("appends the milestone IN SQL (never a JS-computed array) and pays atomically", async () => {
    const res = await claimStreakMilestone(USER, 7);
    expect(res).toEqual({ reward: 250, currentStreak: 10 });

    expect(h.state.updates).toHaveLength(1);
    const upd = h.state.updates[0]!;
    expect(upd.table).toBe(creationStreaksTable);
    const setVal = upd.set["milestonesClaimed"];
    // A plain JS array here would be the lost-claim overwrite bug.
    expect(Array.isArray(setVal)).toBe(false);
    const rendered = dialect.sqlToQuery(setVal as never);
    expect(rendered.sql).toContain("||");
    expect(rendered.sql.toLowerCase()).toContain("array");
    expect(rendered.params).toContain(7);
    // The NOT-@> guard for THIS milestone rides in the same statement.
    const whereRendered = dialect.sqlToQuery(upd.where as never);
    expect(whereRendered.sql).toContain("@>");
    expect(whereRendered.params).toContain(7);

    expect(h.state.atomicCalls).toEqual([{ userId: USER, amount: 250 }]);
    expect(h.state.rmwCalls).toHaveLength(0);
  });

  it("a paid claim writes its per-claim record (migration 0165): kind, milestone ref, stamped reward", async () => {
    await claimStreakMilestone(USER, 7);
    expect(h.state.claimRecords).toEqual([
      { userId: USER, kind: "streak_milestone", refKey: "7", amountVb: 250 },
    ]);
  });

  it("a failed payout records nothing — the record sits after the payout, not beside it", async () => {
    h.state.payoutFails = true;
    await expect(claimStreakMilestone(USER, 7)).rejects.toThrow("Visual Bucs payout failed");
    expect(h.state.claimRecords).toEqual([]);
  });

  it("CAS loss (zero rows updated) throws already-claimed and pays nothing", async () => {
    h.state.claimUpdateRows = [];
    await expect(claimStreakMilestone(USER, 3)).rejects.toThrow("Milestone already claimed");
    expect(h.state.atomicCalls).toHaveLength(0);
    expect(h.state.claimRecords).toEqual([]);
  });

  it("unreached milestone throws before any update or payout", async () => {
    h.state.streakRow.currentStreak = 2;
    await expect(claimStreakMilestone(USER, 30)).rejects.toThrow("Milestone not reached yet");
    expect(h.state.updates).toHaveLength(0);
    expect(h.state.atomicCalls).toHaveLength(0);
  });

  it("already-claimed milestone (per status) is refused up front", async () => {
    h.state.streakRow.milestonesClaimed = [3];
    await expect(claimStreakMilestone(USER, 3)).rejects.toThrow("Milestone already claimed");
    expect(h.state.updates).toHaveLength(0);
    expect(h.state.atomicCalls).toHaveLength(0);
    expect(h.state.claimRecords).toEqual([]);
  });
});

describe("claimQuestReward", () => {
  function seedQuest(overrides: Record<string, unknown> = {}) {
    h.state.questRows = [
      {
        userId: USER,
        questKey: "viral-sharer",
        weekStart: currentWeekStart(),
        progress: 3,
        target: 3,
        completed: true,
        claimedAt: null,
        ...overrides,
      },
    ];
  }

  it("claims under the claimed_at IS NULL CAS and pays atomically", async () => {
    seedQuest();
    const res = await claimQuestReward(USER, "viral-sharer");
    expect(res).toEqual({ reward: 60 });

    expect(h.state.updates).toHaveLength(1);
    const upd = h.state.updates[0]!;
    expect(upd.table).toBe(questProgressTable);
    expect(upd.set["claimedAt"]).toBeInstanceOf(Date);
    const whereRendered = dialect.sqlToQuery(upd.where as never);
    expect(whereRendered.sql.toLowerCase()).toContain("is null");
    expect(whereRendered.params).toContain("viral-sharer");

    expect(h.state.atomicCalls).toEqual([{ userId: USER, amount: 60 }]);
    expect(h.state.rmwCalls).toHaveLength(0);
  });

  it("CAS loss throws already-claimed and pays nothing", async () => {
    seedQuest();
    h.state.claimUpdateRows = [];
    await expect(claimQuestReward(USER, "viral-sharer")).rejects.toThrow(
      "Quest reward already claimed",
    );
    expect(h.state.atomicCalls).toHaveLength(0);
  });

  it("incomplete quest is refused before any update", async () => {
    seedQuest({ completed: false, progress: 1 });
    await expect(claimQuestReward(USER, "viral-sharer")).rejects.toThrow(
      "Quest not completed yet",
    );
    expect(h.state.updates).toHaveLength(0);
    expect(h.state.atomicCalls).toHaveLength(0);
  });
});
