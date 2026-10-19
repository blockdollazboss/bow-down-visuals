/**
 * treasury-quests.ts — the Quest Board's depth (World Ring 2,
 * items 2.20–2.22): where a quest is DONE in the palace, and the
 * shaping behind the Treasury's trophy ledger + full catalog.
 *
 * 2.20 — Completable quests. The quest catalog is the server's
 * (QUEST_DEFS in the API's retention lib, served by
 * GET /api/retention/quests): four weekly quests. Each maps to the
 * in-world surface that performs it:
 *
 *   make-thumbnail → the Thumbnail Desk (Create Wing, native create)
 *   generate-song  → the Song Desk (Create Wing, native create)
 *   export-video   → the Visual Vibes Editor door (step-through —
 *                    exporting is the editor's job, and the editor
 *                    is the palace's one full-screen step-through)
 *   viral-sharer   → the Cover Art Desk (Create Wing, native
 *                    create): the desk's share chip performs a real
 *                    share and records it on the tracked share rail
 *                    (POST /api/shares — the rail the quest engine's
 *                    recordShareEvent hooks), so sharing the cover
 *                    you just made counts in-world like any creation
 *                    at its desk. (Round 2: this mapping used to send
 *                    the walker out to /my-projects on the claim
 *                    that no native panel hosts a share — the Cover
 *                    Desk's share chip proved that stale, once the
 *                    share rail accepted the clients' "image"
 *                    content type again.)
 *
 * An unknown quest key resolves to null and the board falls back
 * to the quest's website transfer — a future quest can never strand
 * a walker on a button that does nothing. Completion itself is
 * counted server-side (the quest engine hooks the real feature
 * routes), so doing the action at the desk counts wherever the
 * member stands; the board re-reads server truth on return.
 *
 * 2.21 / 2.22 — GET /api/retention/quests/history serves the claim
 * ledger (weekly quest rewards, Daily Quest Trio rewards, the
 * King's gifts, the "Your First 10 Minutes" tutorial reward, shark
 * drops, hourly crates — every claim the tables record with its
 * paid amount stamped; daily-drop claims keep no per-claim row
 * anywhere, so they are not entries), the full catalog, and past
 * weeks. GET /api/retention/leaderboard is the site's weekly
 * creation leaderboard (status only, no VB). Everything here is
 * pure shaping: malformed payloads normalize to null so the panel
 * shows its honest error state — never invented rows, never a
 * hardcoded reward.
 */

import { STATION_BY_ID } from "./stations";

/* ─── 2.20: quest → in-world destination ─────────────────────────── */

export type QuestDestination =
  | { kind: "station"; stationId: string; stationName: string; roomName: string }
  | { kind: "transfer"; href: string };

const STATION_DESTINATIONS: Record<string, string> = {
  "make-thumbnail": "thumbnail-desk",
  "generate-song": "song-desk",
  "export-video": "visual-vibes-editor",
  "viral-sharer": "cover-art-desk",
};

/* Quests whose verb genuinely has no in-world performer keep an
   explicit website transfer here — the board labels them "On the
   website" instead of dressing an exit as an in-world action.
   Empty today: every quest in the server's catalog completes at
   a palace desk. A future quest with no desk lands here, never
   on a dead button. */
const TRANSFER_DESTINATIONS: Record<string, string> = {};

const STATION_ROOM_NAMES: Record<string, string> = {
  "world:create-wing": "the Create Wing",
  "world:music-hall": "the Music Hall",
  "world:game-rooms": "the Game Rooms",
  "world:kings-hall": "the King's Hall",
  "world:treasury": "the Treasury",
  "world:courtyard": "the Courtyard",
  "world:royal-court": "the Royal Court Chamber",
  "world:branding-atelier": "the Branding Atelier",
};

/** Where "Go do it" takes this quest, or null when the quest key
 *  is unknown to the palace (the board then uses the quest's own
 *  website transfer — never a dead button). Station names and
 *  rooms resolve from the station registry itself, so the label
 *  can never drift from the door it opens. */
export function questDestination(questKey: string): QuestDestination | null {
  const stationId = STATION_DESTINATIONS[questKey];
  if (stationId) {
    const station = STATION_BY_ID.get(stationId);
    if (station) {
      return {
        kind: "station",
        stationId,
        stationName: station.name,
        roomName: STATION_ROOM_NAMES[station.roomId] ?? "the palace",
      };
    }
  }
  const href = TRANSFER_DESTINATIONS[questKey];
  if (href) return { kind: "transfer", href };
  return null;
}

/** The quest keys the palace can complete in-world today — the
 *  test surface pins this list against the server catalog. */
export const IN_WORLD_QUEST_KEYS = Object.keys(STATION_DESTINATIONS);

/* ─── Shared quest display meta ────────────────────────────────────
   The i18n keys + website door per quest key — the same titles the
   website's QuestsWidget renders (retention.quest_* in the locale
   files). Kept here so the catalog and ledger name quests exactly
   as the board does. */
export const QUEST_DISPLAY: Record<string, { titleKey: string; href: string }> = {
  "make-thumbnail": { titleKey: "retention.quest_make_thumbnail_title", href: "/thumbnail-maker" },
  "generate-song": { titleKey: "retention.quest_generate_song_title", href: "/make-song" },
  "export-video": { titleKey: "retention.quest_export_video_title", href: "/video-editor" },
  "viral-sharer": { titleKey: "retention.quest_viral_sharer_title", href: "/my-projects" },
};

/* ─── 2.21 + 2.22: history / catalog shaping ─────────────────────── */

export interface TreasuryHistoryEntry {
  kind: "quest" | "daily-quest" | "king-gift" | "tutorial" | "shark-drop" | "crate";
  key: string | null;
  amount: number;
  at: string;
}

export interface TreasuryHistoryQuest {
  key: string;
  target: number;
  reward: number;
  progress: number;
  completed: boolean;
  claimed: boolean;
  claimedAt: string | null;
}

export interface TreasuryHistoryWeek {
  weekStart: string;
  quests: TreasuryHistoryQuest[];
}

export interface TreasuryCatalogQuest {
  key: string;
  target: number;
  reward: number;
}

export interface TreasuryHistory {
  catalog: TreasuryCatalogQuest[];
  weeks: TreasuryHistoryWeek[];
  entries: TreasuryHistoryEntry[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Normalize the history payload; null when it isn't one — the
 *  panel's error state, never a half-shaped ledger. */
export function normalizeTreasuryHistory(raw: unknown): TreasuryHistory | null {
  if (!isRecord(raw)) return null;
  if (!Array.isArray(raw.catalog) || !Array.isArray(raw.weeks) || !Array.isArray(raw.entries)) return null;

  const catalog: TreasuryCatalogQuest[] = [];
  for (const c of raw.catalog) {
    if (!isRecord(c)) return null;
    const key = str(c.key);
    const target = num(c.target);
    const reward = num(c.reward);
    if (!key || target === null || reward === null) return null;
    catalog.push({ key, target, reward });
  }

  const weeks: TreasuryHistoryWeek[] = [];
  for (const w of raw.weeks) {
    if (!isRecord(w) || !Array.isArray(w.quests)) return null;
    const weekStart = str(w.weekStart);
    if (!weekStart) return null;
    const quests: TreasuryHistoryQuest[] = [];
    for (const q of w.quests) {
      if (!isRecord(q)) return null;
      const key = str(q.key);
      const target = num(q.target);
      const reward = num(q.reward);
      const progress = num(q.progress);
      if (!key || target === null || reward === null || progress === null) return null;
      quests.push({
        key,
        target,
        reward,
        progress,
        completed: q.completed === true,
        claimed: q.claimed === true,
        claimedAt: typeof q.claimedAt === "string" ? q.claimedAt : null,
      });
    }
    weeks.push({ weekStart, quests });
  }

  const entries: TreasuryHistoryEntry[] = [];
  for (const e of raw.entries) {
    if (!isRecord(e)) return null;
    if (
      e.kind !== "quest" &&
      e.kind !== "daily-quest" &&
      e.kind !== "king-gift" &&
      e.kind !== "tutorial" &&
      e.kind !== "shark-drop" &&
      e.kind !== "crate"
    )
      return null;
    const amount = num(e.amount);
    const at = str(e.at);
    if (amount === null || !at) return null;
    entries.push({ kind: e.kind, key: typeof e.key === "string" ? e.key : null, amount, at });
  }

  return { catalog, weeks, entries };
}

/** Total Visual Bucs the ledger records — a sum of server amounts,
 *  never a stored figure of our own. */
export function historyTotalVb(entries: TreasuryHistoryEntry[]): number {
  return entries.reduce((s, e) => s + e.amount, 0);
}

/** The ledger row's plain name for an entry kind. Quest entries
 *  name the quest (via its display key, resolved by the renderer);
 *  drops and crates name themselves. */
export function ledgerEntryKindLabel(kind: TreasuryHistoryEntry["kind"]): string {
  switch (kind) {
    case "quest":
      return "Quest reward";
    case "daily-quest":
      return "Daily quest";
    case "king-gift":
      return "The King's gift";
    case "tutorial":
      return "Tutorial reward";
    case "shark-drop":
      return "Shark drop";
    case "crate":
      return "Hourly crate";
  }
}

/** The Daily Quest Trio's names, verbatim from the server's defs
 *  (DAILY_QUEST_DEFS in the API's daily-quests lib). The board
 *  itself reads names off the daily status payload; the ledger
 *  payload carries only the quest key, so the shelf resolves the
 *  name here — a key the palace doesn't know falls back to the
 *  kind label, never a blank row. */
export const DAILY_QUEST_TITLES: Record<string, string> = {
  "daily-first-frame": "First Frame",
  "daily-song-spark": "Song Spark",
  "daily-ship-it": "Ship It",
  "daily-double-frame": "Double Frame",
  "daily-second-verse": "Second Verse",
  "daily-loudmouth": "Loudmouth",
  "daily-marathon-cut": "Marathon Cut",
};

export function dailyQuestTitle(key: string | null): string {
  if (!key) return ledgerEntryKindLabel("daily-quest");
  return DAILY_QUEST_TITLES[key] ?? key;
}

/** The tutorial's name — the shelf's title for a "tutorial" entry
 *  (its kind label, "Tutorial reward", rides the detail line). */
export const TUTORIAL_LEDGER_TITLE = "Your First 10 Minutes";

/* ─── The current week's objectives, game-style ────────────────────
   The board's active quests as objectives: fraction + percent from
   server progress/target only. */

export interface QuestObjective {
  key: string;
  progress: number;
  target: number;
  percent: number;
  state: "active" | "claimable" | "claimed";
}

export function questObjective(q: {
  key: string;
  progress: number;
  target: number;
  completed: boolean;
  claimed: boolean;
}): QuestObjective {
  const percent = q.target > 0 ? Math.min(100, Math.round((q.progress / q.target) * 100)) : 0;
  return {
    key: q.key,
    progress: q.progress,
    target: q.target,
    percent,
    state: q.claimed ? "claimed" : q.completed ? "claimable" : "active",
  };
}

/** VB waiting on the board right now: completed, unclaimed, and
 *  payable (reward > 0) — summed from the server payload only. */
export function claimableVb(
  quests: { reward: number; completed: boolean; claimed: boolean }[],
): number {
  return quests
    .filter((q) => q.completed && !q.claimed && q.reward > 0)
    .reduce((s, q) => s + q.reward, 0);
}

/* ─── 2.22: the site's weekly leaderboard ────────────────────────── */

export interface LeaderboardRow {
  rank: number;
  name: string;
  creations: number;
  exports: number;
  score: number;
  isYou: boolean;
}

export interface Leaderboard {
  weekStart: string;
  rows: LeaderboardRow[];
  viewerRank: number | null;
  viewerScore: number;
}

export function normalizeLeaderboard(raw: unknown): Leaderboard | null {
  if (!isRecord(raw) || !Array.isArray(raw.rows)) return null;
  const rows: LeaderboardRow[] = [];
  for (const r of raw.rows) {
    if (!isRecord(r)) return null;
    const rank = num(r.rank);
    const name = str(r.name);
    const creations = num(r.creations);
    const exportsCount = num(r.exports);
    const score = num(r.score);
    if (rank === null || !name || creations === null || exportsCount === null || score === null) return null;
    rows.push({ rank, name, creations, exports: exportsCount, score, isYou: r.isYou === true });
  }
  return {
    weekStart: typeof raw.weekStart === "string" ? raw.weekStart : "",
    rows,
    viewerRank: typeof raw.viewerRank === "number" ? raw.viewerRank : null,
    viewerScore: typeof raw.viewerScore === "number" ? raw.viewerScore : 0,
  };
}
