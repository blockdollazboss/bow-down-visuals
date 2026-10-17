/**
 * retention-quest-bell.test.ts — DE-18: completed quests (and reached
 * streak milestones) ring the bell.
 *
 * THE DEFECT: quest completion is event-based and deep-linked, but
 * the earned VB sat unclaimed — silently — if the creator never
 * opened the dashboard widget. updateQuests now observes the
 * completion flip (pre-read + upsert .returning) and inserts a
 * kind:'quest' notification linking /dashboard (where the claim
 * button lives); updateStreak rings the same bell when the streak
 * lands exactly on an unclaimed milestone day.
 *
 * The fake db applies the upsert's real semantics (progress +1
 * capped at target, completed derived) so the flip is exercised
 * honestly: first finishing event rings, later events don't.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const USER = "11111111-1111-4111-8111-111111111111";

const h = vi.hoisted(() => ({
  state: {
    streakRow: null as any,
    questRows: [] as Array<Record<string, unknown>>,
    notifications: [] as Array<Record<string, unknown>>,
  },
}));

const dialect = new PgDialect();
function renderParams(cond: unknown): unknown[] {
  return dialect.sqlToQuery(cond as never).params as unknown[];
}

vi.mock("../supabase-admin", () => ({
  addCreditsAtomic: vi.fn(async () => ({ oldCredits: 0, newCredits: 0, created: false })),
  getSupabaseAdmin: () => null,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { creationStreaksTable, questProgressTable, retentionPrefsTable, notificationsTable } = actual;
  const state = h.state;

  function rowsFor(table: unknown, cond: unknown): unknown[] {
    if (table === retentionPrefsTable) return []; // defaults: everything enabled
    if (table === creationStreaksTable) return state.streakRow ? [state.streakRow] : [];
    if (table === questProgressTable) {
      if (cond === undefined || cond === null) return state.questRows.map((r) => ({ ...r }));
      const params = renderParams(cond).map(String);
      // Copies, like a real DB read: the DE-18 pre-read must be a
      // snapshot — if it aliased the stored row, the upsert's
      // in-place progress write would rewrite "prior" too and the
      // completion flip would be invisible.
      return state.questRows
        .filter(
          (r) =>
            params.includes(String(r["userId"])) &&
            params.includes(String(r["questKey"])) &&
            params.includes(String(r["weekStart"])),
        )
        .map((r) => ({ ...r }));
    }
    return [];
  }

  function thenable(value: unknown): any {
    return { then: (res: any, rej: any) => Promise.resolve(value).then(res, rej) };
  }

  const fakeDb = {
    select: (_fields?: unknown) => ({
      from: (table: unknown) => ({
        where: (cond: unknown) => ({
          limit: async (_n: number) => rowsFor(table, cond),
          then: (res: any, rej: any) => Promise.resolve(rowsFor(table, cond)).then(res, rej),
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        if (table === questProgressTable) {
          // The upsert, with its real semantics: insert progress 1,
          // or progress+1 capped at target; completed is derived.
          const existing = state.questRows.find(
            (r) => r["userId"] === v["userId"] && r["questKey"] === v["questKey"] && r["weekStart"] === v["weekStart"],
          );
          let row: Record<string, unknown>;
          if (!existing) {
            row = { claimedAt: null, ...v };
            state.questRows.push(row);
          } else {
            const target = Number(existing["target"]);
            const progress = Math.min(Number(existing["progress"]) + 1, target);
            existing["progress"] = progress;
            existing["completed"] = progress >= target;
            row = existing;
          }
          return {
            onConflictDoUpdate: (_cfg: unknown) => ({ returning: async (_f?: unknown) => [{ ...row }] }),
            returning: async (_f?: unknown) => [{ ...row }],
            then: (res: any, rej: any) => Promise.resolve([{ ...row }]).then(res, rej),
          };
        }
        if (table === notificationsTable) {
          state.notifications.push({ ...v });
          return thenable([]);
        }
        if (table === creationStreaksTable) {
          state.streakRow = { ...v };
          return thenable([]);
        }
        return thenable([]);
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: (_cond: unknown) => {
          if (table === creationStreaksTable && state.streakRow) {
            Object.assign(state.streakRow, patch);
          }
          return { returning: async () => [], then: (res: any, rej: any) => Promise.resolve([]).then(res, rej) };
        },
      }),
    }),
  };
  return { ...actual, db: fakeDb };
});

import { recordCreation, recordShareEvent, QUEST_DEFS } from "../retention";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}
function yesterdayKey(): string {
  const today = todayKey();
  return new Date(Date.UTC(
    Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)),
  ) - 86400000).toISOString().slice(0, 10);
}

beforeEach(() => {
  h.state.streakRow = null;
  h.state.questRows = [];
  h.state.notifications = [];
});

describe("DE-18 — the quest bell", () => {
  it("rings exactly once when a quest completes — the finishing event, not later ones", async () => {
    await recordCreation(USER, "song");
    expect(h.state.notifications).toHaveLength(1);
    expect(h.state.notifications[0]).toMatchObject({ userId: USER, kind: "quest", link: "/dashboard" });
    expect(String(h.state.notifications[0]!["title"])).toContain("Quest complete");
    expect(String(h.state.notifications[0]!["body"])).toContain("Generate a song");
    expect(String(h.state.notifications[0]!["body"])).toContain("80");

    await recordCreation(USER, "song");
    expect(h.state.notifications).toHaveLength(1);
  });

  it("a multi-step quest rings only on the step that finishes it", async () => {
    await recordShareEvent(USER);
    await recordShareEvent(USER);
    expect(h.state.notifications).toHaveLength(0);
    await recordShareEvent(USER);
    expect(h.state.notifications).toHaveLength(1);
    expect(String(h.state.notifications[0]!["body"])).toContain("Viral Sharer");
    expect(String(h.state.notifications[0]!["body"])).toContain("60");
  });

  it("each quest rings its own bell, naming itself and its reward", async () => {
    await recordCreation(USER, "thumbnail");
    await recordCreation(USER, "export");
    expect(h.state.notifications).toHaveLength(2);
    const bodies = h.state.notifications.map((n) => String(n["body"]));
    expect(bodies.some((b) => b.includes("Make a thumbnail") && b.includes("40"))).toBe(true);
    expect(bodies.some((b) => b.includes("Export a video") && b.includes("120"))).toBe(true);
  });

  it("a streak landing on an unclaimed milestone day rings the bell once", async () => {
    h.state.streakRow = {
      userId: USER,
      currentStreak: 2,
      longestStreak: 2,
      lastCreationDate: yesterdayKey(),
      milestonesClaimed: [],
    };
    await recordCreation(USER, "project"); // "project" advances no quest — isolates the streak
    expect(h.state.notifications).toHaveLength(1);
    expect(h.state.notifications[0]).toMatchObject({ userId: USER, kind: "quest", link: "/dashboard" });
    expect(String(h.state.notifications[0]!["title"])).toContain("Streak milestone");
    expect(String(h.state.notifications[0]!["body"])).toContain("3 days");
    expect(String(h.state.notifications[0]!["body"])).toContain("100");

    // Same-day repeat: the streak doesn't move, no second ring.
    await recordCreation(USER, "project");
    expect(h.state.notifications).toHaveLength(1);
  });

  it("an already-claimed milestone does not ring when the streak passes it again", async () => {
    h.state.streakRow = {
      userId: USER,
      currentStreak: 2,
      longestStreak: 9,
      lastCreationDate: yesterdayKey(),
      milestonesClaimed: [3],
    };
    await recordCreation(USER, "project");
    expect(h.state.notifications).toHaveLength(0);
  });
});

/**
 * Stack-30 C2 — one updateQuests call rings at most one bell.
 *
 * When a single event finishes two quests at once (two defs sharing
 * the event's kind, both flipping false → true in the same loop),
 * the old code rang one bell per finished quest — two notifications
 * for one action. updateQuests now latches: the bell names the first
 * quest the call finished; the second quest still completes (its
 * reward waits on the same /dashboard claim surface), it just
 * doesn't ring a second bell for the same event. Streak-milestone
 * bells ring from updateStreak and are NOT capped by the latch.
 */
describe("Stack-30 C2 — the per-call bell dedupe", () => {
  const BONUS_DEF = { key: "song-bonus", target: 1, reward: 10, kinds: ["song"] as const };

  beforeEach(() => {
    QUEST_DEFS.push(BONUS_DEF as never);
  });

  afterEach(() => {
    const i = QUEST_DEFS.indexOf(BONUS_DEF as never);
    if (i >= 0) QUEST_DEFS.splice(i, 1);
  });

  it("two quests finished by one event produce exactly one bell, naming the first", async () => {
    await recordCreation(USER, "song");
    /* Both quests completed — progress semantics unchanged… */
    const completed = h.state.questRows.filter((r) => r["completed"] === true);
    expect(completed.map((r) => r["questKey"]).sort()).toEqual(["generate-song", "song-bonus"]);
    /* …but only one bell rang, naming the first quest finished. */
    const bells = h.state.notifications.filter((n) => String(n["title"]).includes("Quest complete"));
    expect(bells).toHaveLength(1);
    expect(String(bells[0]!["body"])).toContain("Generate a song");
    expect(String(bells[0]!["body"])).toContain("80");
  });

  it("the silently-finished second quest does not ring on a later event either (flip already spent)", async () => {
    await recordCreation(USER, "song");
    await recordCreation(USER, "song");
    const bells = h.state.notifications.filter((n) => String(n["title"]).includes("Quest complete"));
    expect(bells).toHaveLength(1);
  });

  it("a streak-milestone bell in the same call is separate and still rings", async () => {
    h.state.streakRow = {
      userId: USER,
      currentStreak: 2,
      longestStreak: 2,
      lastCreationDate: yesterdayKey(),
      milestonesClaimed: [],
    };
    await recordCreation(USER, "song"); // finishes two quests AND lands the 3-day milestone
    const questBells = h.state.notifications.filter((n) => String(n["title"]).includes("Quest complete"));
    const milestoneBells = h.state.notifications.filter((n) => String(n["title"]).includes("Streak milestone"));
    expect(questBells).toHaveLength(1);
    expect(milestoneBells).toHaveLength(1);
    expect(h.state.notifications).toHaveLength(2);
  });
});
