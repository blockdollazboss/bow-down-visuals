/**
 * quest-leaderboard.ts — the Quest Marks standings (World Ring 2,
 * item 2.22): who has banked the most quest marks, kingdom-wide.
 *
 * The marks are the Daily Quest Trio's honor counter (lib/daily-
 * quests): every trio claim stamps the marks it paid onto its
 * daily_quest_progress row. This board is a sum of THOSE recorded
 * stamps — claimed rows only, all-time — never a derived score and
 * never a balance. Marks are not money: they never convert to
 * Visual Bucs, and no payout path exists here (status only, the
 * retention leaderboard's law).
 *
 * The company rules are the site's leaderboard rules, mirrored
 * from routes/retention-delight's weekly board and the arcade:
 *   - a member who switched their leaderboard visibility off
 *     (retention_prefs.leaderboard_visible = false) never stands
 *     on the board — but their OWN marks total is still reported
 *     back to them (their private tally is not a public standing);
 *   - display names come from Supabase profiles (display_name),
 *     falling back to "Creator" — the same resolution the other
 *     boards use;
 *   - the order is total and deterministic: marks, then claims,
 *     then name, then user id — a tie freezes the same way every
 *     time it is computed.
 *
 * Everything DB-shaped sits behind QuestLeaderboardStore so the
 * aggregation + ranking are unit-tested against fakes; the route
 * wires the db store.
 */

import { inArray, isNotNull } from "drizzle-orm";
import { db, dailyQuestProgressTable, retentionPrefsTable } from "@workspace/db";
import { getSupabaseAdmin } from "./supabase-admin";
import { logger } from "./logger";

/** How many standings the board names. */
export const QUEST_MARKS_BOARD_SIZE = 10;

/* ── The store ──────────────────────────────────────────────────── */

export interface QuestLeaderboardStore {
  /** Every CLAIMED trio row's (userId, marks) — the raw stamps the
   *  standings sum. Unclaimed rows carry no banked marks (their
   *  marks column is the untouched default) and never reach here. */
  claimedMarkRows(): Promise<{ userId: string; marks: number }[]>;
  /** Of the given users, the ones who opted OUT of leaderboards. */
  hiddenUserIds(userIds: string[]): Promise<Set<string>>;
  /** Display names for the given users (absent = unnamed). */
  displayNames(userIds: string[]): Promise<Map<string, string>>;
}

export const dbQuestLeaderboardStore: QuestLeaderboardStore = {
  async claimedMarkRows() {
    const rows = await db
      .select({
        userId: dailyQuestProgressTable.userId,
        marks: dailyQuestProgressTable.marks,
      })
      .from(dailyQuestProgressTable)
      .where(isNotNull(dailyQuestProgressTable.claimedAt));
    return rows.map((r) => ({ userId: r.userId, marks: r.marks ?? 0 }));
  },

  async hiddenUserIds(userIds) {
    if (userIds.length === 0) return new Set();
    const prefRows = await db
      .select({
        userId: retentionPrefsTable.userId,
        visible: retentionPrefsTable.leaderboardVisible,
      })
      .from(retentionPrefsTable)
      .where(inArray(retentionPrefsTable.userId, userIds));
    return new Set(prefRows.filter((p) => p.visible === false).map((p) => p.userId));
  },

  async displayNames(userIds) {
    const nameMap = new Map<string, string>();
    if (userIds.length === 0) return nameMap;
    const { data: profiles } = await getSupabaseAdmin()
      .from("profiles")
      .select("id, display_name")
      .in("id", userIds);
    for (const p of profiles ?? []) {
      const dn = (p as { display_name?: string | null }).display_name;
      if (dn) nameMap.set((p as { id: string }).id, dn);
    }
    return nameMap;
  },
};

/* ── Aggregation + ranking (pure) ───────────────────────────────── */

export interface QuestMarksStanding {
  userId: string;
  /** Marks banked — the sum of the member's claim stamps. */
  marks: number;
  /** Trio claims banked — the stamp count behind the marks. */
  claims: number;
}

/** Sum claimed rows into per-member standings. Rows with no marks
 *  banked (a claim always stamps marks > 0 today, but a recorded 0
 *  must never stand) are dropped: only members who banked stand. */
export function aggregateQuestMarks(
  rows: { userId: string; marks: number }[],
): QuestMarksStanding[] {
  const byUser = new Map<string, QuestMarksStanding>();
  for (const r of rows) {
    const cur = byUser.get(r.userId) ?? { userId: r.userId, marks: 0, claims: 0 };
    cur.marks += r.marks;
    cur.claims += 1;
    byUser.set(r.userId, cur);
  }
  return [...byUser.values()].filter((s) => s.marks > 0);
}

export interface QuestMarksBoardRow {
  rank: number;
  userId: string;
  name: string;
  marks: number;
  claims: number;
  isYou: boolean;
}

export interface QuestMarksBoard {
  rows: QuestMarksBoardRow[];
  viewer: {
    /** The viewer's own banked marks — reported even when their
     *  standing is hidden by their own privacy choice. */
    marks: number;
    claims: number;
    /** Place on the visible board, or null when the viewer has
     *  banked nothing or opted out of leaderboards. */
    rank: number | null;
    /** Whether the viewer stands on the public board. */
    listed: boolean;
  };
}

/**
 * Rank the standings into the board: opted-out members removed,
 * names resolved (fallback "Creator"), the top QUEST_MARKS_BOARD_
 * SIZE named, and the viewer's own place computed over the FULL
 * visible ranking (not just the named rows) so a member outside
 * the top ten still reads their true standing.
 */
export function rankQuestMarks(
  standings: QuestMarksStanding[],
  hidden: Set<string>,
  names: Map<string, string>,
  viewerId: string,
): QuestMarksBoard {
  const nameOf = (userId: string) => names.get(userId) ?? "Creator";
  const visible = standings
    .filter((s) => !hidden.has(s.userId))
    .sort(
      (a, b) =>
        b.marks - a.marks ||
        b.claims - a.claims ||
        nameOf(a.userId).localeCompare(nameOf(b.userId)) ||
        (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
    );
  const rows: QuestMarksBoardRow[] = visible
    .slice(0, QUEST_MARKS_BOARD_SIZE)
    .map((s, i) => ({
      rank: i + 1,
      userId: s.userId,
      name: nameOf(s.userId),
      marks: s.marks,
      claims: s.claims,
      isYou: s.userId === viewerId,
    }));
  const mine = standings.find((s) => s.userId === viewerId);
  const viewerIdx = visible.findIndex((s) => s.userId === viewerId);
  return {
    rows,
    viewer: {
      marks: mine?.marks ?? 0,
      claims: mine?.claims ?? 0,
      rank: viewerIdx >= 0 ? viewerIdx + 1 : null,
      listed: viewerIdx >= 0,
    },
  };
}

/** The route's read: store → aggregate → resolve → rank. */
export async function getQuestMarksBoard(
  store: QuestLeaderboardStore,
  viewerId: string,
): Promise<QuestMarksBoard> {
  const standings = aggregateQuestMarks(await store.claimedMarkRows());
  const userIds = standings.map((s) => s.userId);
  const [hidden, names] = await Promise.all([
    store.hiddenUserIds(userIds),
    store.displayNames(userIds),
  ]);
  const board = rankQuestMarks(standings, hidden, names, viewerId);
  logger.debug(
    { viewerId, standings: board.rows.length },
    "[quest-leaderboard] marks board read",
  );
  return board;
}
