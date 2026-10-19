/**
 * retention-history.test.ts — the Treasury history read (World
 * Ring 2, items 2.21 + 2.22; sources completed by stack-20 R2 #13).
 *
 * getTreasuryHistory folds the claim tables into one ledger:
 * quest_progress (claimed rows, amount = the quest def's reward),
 * daily_quest_progress (claimed rows, amount = the reward_vb the
 * row stamped at claim time), king_moment_claims (amount = the
 * recorded gift), world_tutorial_progress (the stamped reward),
 * shark_drops (claimed rows, amount = the recorded drop amount),
 * hourly_crate_claims (rows claimed BY this user, amount = the
 * recorded prize). Past weeks come from the quest rows.
 * Daily-drop claims and streak-milestone claims fold in from
 * retention_claim_records (migration 0165 — one row per claim,
 * written by the claim path itself, amount = the claim record's
 * stamped amount_vb). Claims from before those records existed
 * stay absent: they kept no per-claim row, and this read invents
 * nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  state: {
    questRows: [] as any[],
    dailyRows: [] as any[],
    dropRows: [] as any[],
    crateRows: [] as any[],
    dailyRows: [] as any[],
    kingRows: [] as any[],
    tutorialRows: [] as any[],
    claimRecordRows: [] as any[],
    /** Every (table, where) the read issued — for scoping pins. */
    wheres: [] as Array<{ table: unknown; cond: unknown }>,
  },
}));

vi.mock("../supabase-admin", () => ({
  addCreditsAtomic: vi.fn(async () => ({ oldCredits: 0, newCredits: 0, created: false })),
  getSupabaseAdmin: () => {
    throw new Error("treasury history must not use the raw admin client");
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const {
    questProgressTable,
    sharkDropsTable,
    hourlyCrateClaimsTable,
    dailyQuestProgressTable,
    kingMomentClaimsTable,
    worldTutorialProgressTable,
    retentionClaimRecordsTable,
  } = actual;
  const state = h.state;
  const readFor = (table: unknown) => {
    if (table === questProgressTable) return state.questRows;
    if (table === dailyQuestProgressTable) return state.dailyRows;
    if (table === sharkDropsTable) return state.dropRows;
    if (table === hourlyCrateClaimsTable) return state.crateRows;
    if (table === dailyQuestProgressTable) return state.dailyRows;
    if (table === kingMomentClaimsTable) return state.kingRows;
    if (table === worldTutorialProgressTable) return state.tutorialRows;
    if (table === retentionClaimRecordsTable) return state.claimRecordRows;
    return [];
  };
  const fakeDb = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => {
          state.wheres.push({ table, cond });
          const read = async () => readFor(table);
          return {
            orderBy: (..._args: unknown[]) => ({
              limit: async (_n: number) => read(),
              then: (res: any, rej: any) => read().then(res, rej),
            }),
            limit: async (_n: number) => read(),
            then: (res: any, rej: any) => read().then(res, rej),
          };
        },
      }),
    }),
  };
  return { ...actual, db: fakeDb };
});

import { getTreasuryHistory, QUEST_DEFS } from "../retention";
import { DAILY_QUEST_DEFS, dailyQuestDayKey, dailyTrioForDay } from "../daily-quests";
import { retentionClaimRecordsTable } from "@workspace/db";
import { PgDialect } from "drizzle-orm/pg-core";

const dialect = new PgDialect();

const USER = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  h.state.questRows = [];
  h.state.dailyRows = [];
  h.state.dropRows = [];
  h.state.crateRows = [];
  h.state.dailyRows = [];
  h.state.kingRows = [];
  h.state.tutorialRows = [];
  h.state.claimRecordRows = [];
  h.state.wheres = [];
});

describe("getTreasuryHistory", () => {
  it("the catalog is the server's quest defs, verbatim", async () => {
    const out = await getTreasuryHistory(USER);
    expect(out.catalog).toEqual(
      QUEST_DEFS.map((q) => ({ key: q.key, name: q.name, target: q.target, reward: q.reward, kinds: [...q.kinds] })),
    );
  });

  it("the daily catalog is the trio's WHOLE pool, with exactly today's rotation live", async () => {
    const out = await getTreasuryHistory(USER);
    expect(out.dailyCatalog).toEqual(
      DAILY_QUEST_DEFS.map((d) => ({
        key: d.key,
        name: d.name,
        baseKey: d.baseKey,
        target: d.target,
        rewardVb: d.rewardVb,
        marks: d.marks,
        kinds: [...d.kinds],
        liveToday: dailyTrioForDay(out.today).some((t) => t.key === d.key),
      })),
    );
    expect(out.dailyCatalog).toHaveLength(7);
    expect(out.dailyCatalog.filter((d) => d.liveToday)).toHaveLength(3);
    expect(out.today).toBe(dailyQuestDayKey(new Date()));
  });

  it("daily trio days land in their week's board with the row's own recorded amounts", async () => {
    // 2026-10-14 (Wed) and 2026-10-15 (Thu) both sit in the week of
    // Mon 2026-10-12 — the same week the seeded weekly row names.
    h.state.questRows = [
      { userId: USER, questKey: "make-thumbnail", weekStart: "2026-10-12", progress: 0, target: 1, completed: false, claimedAt: null },
    ];
    h.state.dailyRows = [
      { userId: USER, questKey: "daily-song-spark", dayDate: "2026-10-14", progress: 1, target: 1, completed: true, rewardVb: 10, marks: 5, claimedAt: new Date("2026-10-14T20:00:00Z") },
      { userId: USER, questKey: "daily-first-frame", dayDate: "2026-10-15", progress: 0, target: 1, completed: false, rewardVb: null, marks: 0, claimedAt: null },
    ];
    const out = await getTreasuryHistory(USER);
    expect(out.weeks).toHaveLength(1);
    const week = out.weeks[0]!;
    expect(week.weekStart).toBe("2026-10-12");
    expect(week.daily).toEqual([
      { day: "2026-10-15", key: "daily-first-frame", progress: 0, target: 1, completed: false, claimed: false, claimedAt: null, rewardVb: null, marks: 0 },
      { day: "2026-10-14", key: "daily-song-spark", progress: 1, target: 1, completed: true, claimed: true, claimedAt: "2026-10-14T20:00:00.000Z", rewardVb: 10, marks: 5 },
    ]);
  });

  it("a week lived only at day size still stands (the week set is a union)", async () => {
    h.state.dailyRows = [
      { userId: USER, questKey: "daily-ship-it", dayDate: "2026-09-30", progress: 1, target: 1, completed: true, rewardVb: 10, marks: 5, claimedAt: new Date("2026-09-30T12:00:00Z") },
    ];
    const out = await getTreasuryHistory(USER);
    expect(out.weeks).toHaveLength(1);
    expect(out.weeks[0]!.weekStart).toBe("2026-09-28");
    expect(out.weeks[0]!.quests).toHaveLength(QUEST_DEFS.length);
    expect(out.weeks[0]!.daily).toHaveLength(1);
  });

  it("folds claimed quests, drops and crates into one newest-first ledger with recorded amounts", async () => {
    h.state.questRows = [
      { userId: USER, questKey: "generate-song", weekStart: "2026-10-12", progress: 1, target: 1, completed: true, claimedAt: new Date("2026-10-13T10:00:00Z") },
      // Completed but UNclaimed: progress for the week, never a ledger entry.
      { userId: USER, questKey: "make-thumbnail", weekStart: "2026-10-12", progress: 1, target: 1, completed: true, claimedAt: null },
    ];
    h.state.dropRows = [
      { id: "d1", userId: USER, amount: 350, droppedAt: new Date("2026-10-14T09:00:00Z"), claimedAt: new Date("2026-10-14T09:30:00Z"), expiresAt: new Date("2026-10-16T09:00:00Z") },
    ];
    h.state.crateRows = [
      { hour_slot: "2026-10-15T11", claimed_by: USER, claimed_at: new Date("2026-10-15T11:05:00Z"), prize_credits: 500 },
    ];
    const out = await getTreasuryHistory(USER);
    expect(out.entries).toEqual([
      { kind: "crate", key: null, amount: 500, at: "2026-10-15T11:05:00.000Z" },
      { kind: "shark-drop", key: null, amount: 350, at: "2026-10-14T09:30:00.000Z" },
      { kind: "quest", key: "generate-song", amount: 80, at: "2026-10-13T10:00:00.000Z" },
    ]);
  });

  it("folds daily quests, the King's gifts and the tutorial reward in with their recorded amounts", async () => {
    h.state.dailyRows = [
      { userId: USER, questKey: "daily-song-spark", dayDate: "2026-10-16", progress: 1, target: 1, completed: true, rewardVb: 10, marks: 5, claimedAt: new Date("2026-10-16T08:00:00Z") },
      // Progressed but UNclaimed: never a ledger entry.
      { userId: USER, questKey: "daily-first-frame", dayDate: "2026-10-16", progress: 1, target: 1, completed: true, rewardVb: null, marks: 0, claimedAt: null },
    ];
    h.state.kingRows = [
      { id: "k1", userId: USER, momentDate: "2026-10-15", amountVb: 25, claimedAt: new Date("2026-10-15T20:00:00Z") },
    ];
    h.state.tutorialRows = [
      { userId: USER, currentStep: 7, completedAt: new Date("2026-10-14T12:00:00Z"), rewardAmountVb: 30, rewardClaimedAt: new Date("2026-10-14T12:05:00Z") },
    ];
    const out = await getTreasuryHistory(USER);
    expect(out.entries).toEqual([
      { kind: "daily-quest", key: "daily-song-spark", amount: 10, at: "2026-10-16T08:00:00.000Z" },
      { kind: "king-gift", key: null, amount: 25, at: "2026-10-15T20:00:00.000Z" },
      { kind: "tutorial", key: null, amount: 30, at: "2026-10-14T12:05:00.000Z" },
    ]);
  });

  it("folds Daily Drop and streak-milestone claim records in with their stamped amounts, interleaved newest-first", async () => {
    h.state.crateRows = [
      { hour_slot: "2026-10-15T11", claimed_by: USER, claimed_at: new Date("2026-10-15T11:05:00Z"), prize_credits: 500 },
    ];
    h.state.claimRecordRows = [
      { id: "r1", userId: USER, kind: "daily_drop", refKey: "2026-10-16", amountVb: 200, createdAt: new Date("2026-10-16T07:00:00Z") },
      { id: "r2", userId: USER, kind: "streak_milestone", refKey: "7", amountVb: 250, createdAt: new Date("2026-10-15T18:30:00Z") },
      { id: "r3", userId: USER, kind: "daily_drop", refKey: "2026-10-15", amountVb: 1000, createdAt: new Date("2026-10-15T06:00:00Z") },
    ];
    const out = await getTreasuryHistory(USER);
    expect(out.entries).toEqual([
      { kind: "daily-drop", key: null, amount: 200, at: "2026-10-16T07:00:00.000Z" },
      { kind: "streak-milestone", key: "7", amount: 250, at: "2026-10-15T18:30:00.000Z" },
      { kind: "crate", key: null, amount: 500, at: "2026-10-15T11:05:00.000Z" },
      { kind: "daily-drop", key: null, amount: 1000, at: "2026-10-15T06:00:00.000Z" },
    ]);
  });

  it("the claim-records read is scoped to the caller — its WHERE binds this member's id on user_id", async () => {
    await getTreasuryHistory(USER);
    const recWhere = h.state.wheres.find((w) => w.table === retentionClaimRecordsTable);
    expect(recWhere).toBeTruthy();
    const rendered = dialect.sqlToQuery(recWhere!.cond as never);
    expect(rendered.sql).toContain("user_id");
    expect(rendered.params).toContain(USER);
  });

  it("a claim record with a kind this read does not know is skipped, never mislabeled", async () => {
    h.state.claimRecordRows = [
      { id: "r9", userId: USER, kind: "some_future_kind", refKey: "x", amountVb: 999, createdAt: new Date("2026-10-16T07:00:00Z") },
    ];
    const out = await getTreasuryHistory(USER);
    expect(out.entries).toEqual([]);
  });

  it("a claimed daily row with no recorded reward, and a tutorial row with no reward stamp, invent nothing", async () => {
    h.state.dailyRows = [
      { userId: USER, questKey: "daily-ship-it", dayDate: "2026-10-16", progress: 1, target: 1, completed: true, rewardVb: null, marks: 5, claimedAt: new Date("2026-10-16T09:00:00Z") },
    ];
    h.state.tutorialRows = [
      { userId: USER, currentStep: 7, completedAt: new Date("2026-10-14T12:00:00Z"), rewardAmountVb: null, rewardClaimedAt: new Date("2026-10-14T12:05:00Z") },
    ];
    const out = await getTreasuryHistory(USER);
    expect(out.entries).toEqual([]);
  });

  it("past weeks carry the full def set with per-week progress and claim state", async () => {
    h.state.questRows = [
      { userId: USER, questKey: "export-video", weekStart: "2026-10-05", progress: 1, target: 1, completed: true, claimedAt: new Date("2026-10-06T12:00:00Z") },
      { userId: USER, questKey: "viral-sharer", weekStart: "2026-10-05", progress: 2, target: 3, completed: false, claimedAt: null },
    ];
    const out = await getTreasuryHistory(USER);
    expect(out.weeks).toHaveLength(1);
    const week = out.weeks[0]!;
    expect(week.weekStart).toBe("2026-10-05");
    expect(week.quests).toHaveLength(QUEST_DEFS.length);
    const exported = week.quests.find((q) => q.key === "export-video")!;
    expect(exported).toMatchObject({ completed: true, claimed: true, claimedAt: "2026-10-06T12:00:00.000Z" });
    const sharer = week.quests.find((q) => q.key === "viral-sharer")!;
    expect(sharer).toMatchObject({ progress: 2, target: 3, completed: false, claimed: false });
    const untouched = week.quests.find((q) => q.key === "make-thumbnail")!;
    expect(untouched).toMatchObject({ progress: 0, completed: false, claimed: false, claimedAt: null });
  });

  it("an empty history is an empty ledger and no weeks — never fabricated rows", async () => {
    const out = await getTreasuryHistory(USER);
    expect(out.entries).toEqual([]);
    expect(out.weeks).toEqual([]);
    expect(out.catalog.length).toBeGreaterThan(0);
  });
});
