/**
 * quest-leaderboard.test.ts — the Quest Marks standings (World
 * Ring 2, item 2.22).
 *
 * The board sums the marks the Daily Quest Trio's CLAIM rows
 * recorded (lib/daily-quests stamps them at claim time): claimed
 * rows only, all-time. Pinned here: aggregation is a sum of those
 * stamps (never a derived score), the leaderboard opt-out removes
 * a member from the PUBLIC board while their own tally still
 * reports back to them, names resolve with the site's "Creator"
 * fallback, the order is total (marks → claims → name → id), and
 * the viewer's rank is computed over the full visible ranking —
 * not just the named top ten.
 */
import { describe, it, expect } from "vitest";
import {
  aggregateQuestMarks,
  getQuestMarksBoard,
  rankQuestMarks,
  QUEST_MARKS_BOARD_SIZE,
  type QuestLeaderboardStore,
} from "../quest-leaderboard";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

function fakeStore(parts: Partial<QuestLeaderboardStore>): QuestLeaderboardStore {
  return {
    claimedMarkRows: async () => [],
    hiddenUserIds: async () => new Set<string>(),
    displayNames: async () => new Map<string, string>(),
    ...parts,
  };
}

describe("aggregateQuestMarks", () => {
  it("sums the claim stamps per member and counts the claims behind them", () => {
    const out = aggregateQuestMarks([
      { userId: A, marks: 5 },
      { userId: A, marks: 5 },
      { userId: B, marks: 15 },
    ]);
    expect(out).toEqual([
      { userId: A, marks: 10, claims: 2 },
      { userId: B, marks: 15, claims: 1 },
    ]);
  });

  it("a member whose stamps sum to nothing never stands", () => {
    expect(aggregateQuestMarks([{ userId: A, marks: 0 }])).toEqual([]);
    expect(aggregateQuestMarks([])).toEqual([]);
  });
});

describe("rankQuestMarks", () => {
  const standings = [
    { userId: A, marks: 30, claims: 6 },
    { userId: B, marks: 30, claims: 4 },
    { userId: C, marks: 45, claims: 9 },
  ];

  it("orders by marks, then claims — and names the top of the board", () => {
    const board = rankQuestMarks(standings, new Set(), new Map([[C, "King"]]), A);
    expect(board.rows.map((r) => r.userId)).toEqual([C, A, B]);
    expect(board.rows[0]).toMatchObject({ rank: 1, name: "King", marks: 45, claims: 9, isYou: false });
    // Unnamed members fall back to "Creator" — the site's pattern.
    expect(board.rows[1]!.name).toBe("Creator");
    expect(board.rows[1]!.isYou).toBe(true);
  });

  it("an opted-out member leaves the public board but keeps their own tally", () => {
    const board = rankQuestMarks(standings, new Set([C]), new Map(), C);
    expect(board.rows.map((r) => r.userId)).toEqual([A, B]);
    expect(board.viewer).toEqual({ marks: 45, claims: 9, rank: null, listed: false });
  });

  it("the viewer's rank is their place in the full visible ranking", () => {
    const many = Array.from({ length: QUEST_MARKS_BOARD_SIZE + 2 }, (_, i) => ({
      userId: `user-${String(i).padStart(2, "0")}`,
      marks: 100 - i,
      claims: 1,
    }));
    const board = rankQuestMarks(many, new Set(), new Map(), "user-11");
    expect(board.rows).toHaveLength(QUEST_MARKS_BOARD_SIZE);
    expect(board.viewer).toEqual({ marks: 89, claims: 1, rank: 12, listed: true });
  });

  it("a viewer who banked nothing reads zeros — never an invented standing", () => {
    const board = rankQuestMarks(standings, new Set(), new Map(), "nobody");
    expect(board.viewer).toEqual({ marks: 0, claims: 0, rank: null, listed: false });
  });
});

describe("getQuestMarksBoard", () => {
  it("reads the store's claimed rows, resolves names + opt-outs, and ranks", async () => {
    const asked: string[][] = [];
    const store = fakeStore({
      claimedMarkRows: async () => [
        { userId: A, marks: 5 },
        { userId: A, marks: 10 },
        { userId: B, marks: 20 },
        { userId: C, marks: 25 },
      ],
      hiddenUserIds: async (ids) => {
        asked.push(ids);
        return new Set([C]);
      },
      displayNames: async () => new Map([[B, "Bea"]]),
    });
    const board = await getQuestMarksBoard(store, A);
    expect(board.rows.map((r) => [r.name, r.marks])).toEqual([
      ["Bea", 20],
      ["Creator", 15],
    ]);
    expect(board.viewer).toEqual({ marks: 15, claims: 2, rank: 2, listed: true });
    // Names + visibility are resolved for exactly the members who stand.
    expect(asked[0]).toEqual(expect.arrayContaining([A, B, C]));
  });

  it("an untouched kingdom is an empty board", async () => {
    const board = await getQuestMarksBoard(fakeStore({}), A);
    expect(board.rows).toEqual([]);
    expect(board.viewer).toEqual({ marks: 0, claims: 0, rank: null, listed: false });
  });
});
