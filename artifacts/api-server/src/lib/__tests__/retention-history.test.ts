/**
 * retention-history.test.ts — the Treasury history read (World
 * Ring 2, items 2.21 + 2.22).
 *
 * getTreasuryHistory folds three claim tables into one ledger:
 * quest_progress (claimed rows, amount = the quest def's reward),
 * shark_drops (claimed rows, amount = the recorded drop amount),
 * hourly_crate_claims (rows claimed BY this user, amount = the
 * recorded prize). Past weeks come from the same quest rows.
 * Daily-drop claims are deliberately absent: the bonus system
 * keeps no per-claim row for them (only profiles.last_daily_claim),
 * and this read invents nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  state: {
    questRows: [] as any[],
    dropRows: [] as any[],
    crateRows: [] as any[],
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
  const { questProgressTable, sharkDropsTable, hourlyCrateClaimsTable } = actual;
  const state = h.state;
  const readFor = (table: unknown) => {
    if (table === questProgressTable) return state.questRows;
    if (table === sharkDropsTable) return state.dropRows;
    if (table === hourlyCrateClaimsTable) return state.crateRows;
    return [];
  };
  const fakeDb = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (_cond: unknown) => {
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

const USER = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  h.state.questRows = [];
  h.state.dropRows = [];
  h.state.crateRows = [];
});

describe("getTreasuryHistory", () => {
  it("the catalog is the server's quest defs, verbatim", async () => {
    const out = await getTreasuryHistory(USER);
    expect(out.catalog).toEqual(
      QUEST_DEFS.map((q) => ({ key: q.key, target: q.target, reward: q.reward, kinds: [...q.kinds] })),
    );
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
