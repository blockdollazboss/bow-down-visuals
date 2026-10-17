/**
 * games-lobby.ts — the Game Rooms' native lobbies, as pure logic.
 *
 * NATIVE-PLAN §3.5: the Arcade Cabinets and the Marble Table are
 * BOARDS in-world (cabinet cards / table cards + leaderboards);
 * PLAYING steps through full-screen inside /world on the editor's
 * sanctioned class (§3.8). This module is the testable seam both
 * lobbies in `components/world/native/GamesPanels.tsx` read from:
 * which surface a games station opens, the cabinet list, and the
 * parsers/shapers for the exact payloads the website pages already
 * consume — no new server endpoints, no re-invented shapes.
 *
 * Endpoints (all existing):
 *   Arcade: GET /api/arcade/me, GET /api/arcade/leaderboard
 *     (the leaderboard component fetches it itself),
 *     POST /api/arcade/scores, and the Shark Drop rail
 *     GET /api/retention/shark-drop + POST …/claim — the rail
 *     alone decides drops; this module only shapes what it said.
 *   Party: GET /api/party/rooms, POST /api/party/rooms,
 *     GET /api/party/me, GET /api/party/leaderboard; the room
 *     itself rides lib/party-client.ts over /api/party/ws.
 */
import {
  ARCADE_GAME_META,
  DROP_QUALIFYING_SCORE,
  type ArcadeGameId,
  type ArcadeRunResult,
} from "../arcade-games";
import type { PartyGame } from "../party-client";

/* ─── Which native surface a "games" station opens ──────────────────
   Both Game Rooms stations carry pattern "games"; the station id
   says which lobby. Anything else under the pattern is not a
   games surface (null — the host falls back to the placeholder). */
export type GamesSurface = "arcade" | "marble";

export function gamesSurfaceForStation(stationId: string): GamesSurface | null {
  if (stationId === "arcade-cabinets") return "arcade";
  if (stationId === "marble-table") return "marble";
  return null;
}

/* ─── The Arcade ──────────────────────────────────────────────────── */

export interface ArcadeCabinet {
  id: ArcadeGameId;
  title: string;
  tagline: string;
}

/** The cabinets on the arcade floor, in house order — the same
 *  two self-contained game components the /arcade page hosts. */
export const ARCADE_CABINETS: ArcadeCabinet[] = (
  Object.keys(ARCADE_GAME_META) as ArcadeGameId[]
).map((id) => ({
  id,
  title: ARCADE_GAME_META[id].title,
  tagline: ARCADE_GAME_META[id].tagline,
}));

/** GET /api/arcade/me → my best per game (null = never played). */
export function parseArcadeMe(
  data: unknown,
): Partial<Record<ArcadeGameId, number | null>> {
  const out: Partial<Record<ArcadeGameId, number | null>> = {};
  const games = (data as { games?: unknown })?.games;
  if (!Array.isArray(games)) return out;
  for (const g of games) {
    const row = g as { game?: unknown; best?: unknown };
    if (row.game !== "runner" && row.game !== "skeet") continue;
    out[row.game] = typeof row.best === "number" ? row.best : null;
  }
  return out;
}

/** What the lobby shows after a run, shaped exactly as the /arcade
 *  page shapes it — a saved outcome or an honest failure line. */
export interface ArcadeScoreOutcome {
  score: number;
  saved: boolean;
  personalBest?: number;
  isPersonalBest?: boolean;
  rank?: number | null;
  error?: string;
}

export function outcomeForSavedScore(
  score: number,
  data: unknown,
): ArcadeScoreOutcome {
  const d = (data ?? {}) as {
    personalBest?: unknown;
    isPersonalBest?: unknown;
    rank?: unknown;
  };
  return {
    score,
    saved: true,
    personalBest: typeof d.personalBest === "number" ? d.personalBest : undefined,
    isPersonalBest: d.isPersonalBest === true,
    rank: typeof d.rank === "number" ? d.rank : null,
  };
}

export function outcomeForFailedScore(score: number, error: string): ArcadeScoreOutcome {
  return { score, saved: false, error };
}

/* ─── The Shark Drop rail (arcade follow-on, in-world) ──────────────
   After a qualifying run the arcade checks the EXISTING rail —
   the rail decides (dice, ≤2 drops per rolling 7 days, prefs);
   the lobby never promises or mints. The threshold here is only
   the UX gate so throwaway runs don't burn the dice roll — the
   same gate the /arcade page applies. */
export function dropQualifies(result: ArcadeRunResult): boolean {
  return result.score >= DROP_QUALIFYING_SCORE[result.game];
}

export interface PendingSharkDrop {
  id: string;
  amount: number;
}

/** GET /api/retention/shark-drop → the held drop, or null. */
export function parseSharkDrop(data: unknown): PendingSharkDrop | null {
  const drop = (data as { drop?: unknown })?.drop as
    | { id?: unknown; amount?: unknown }
    | null
    | undefined;
  if (!drop || typeof drop.id !== "string" || typeof drop.amount !== "number") {
    return null;
  }
  return { id: drop.id, amount: drop.amount };
}

/* ─── The Marble Table (party) ────────────────────────────────────── */

export const PARTY_GAME_META: Record<
  PartyGame,
  { title: string; tagline: string; seats: number }
> = {
  trivia: {
    title: "Party Trivia",
    tagline: "Up to 8 at the table. Timed questions, speed scores, one crown.",
    seats: 8,
  },
  duel: {
    title: "Court Battle",
    tagline: "A 1v1 duel. Trade category picks, fastest correct answer takes the round — first to 3 rounds.",
    seats: 2,
  },
};

export interface PartyOpenRoom {
  code: string;
  game: PartyGame;
  hostName: string;
  players: number;
  streamId: string | null;
  profileSlug: string | null;
}

/** GET /api/party/rooms → open tables as cards. Malformed rows are
 *  dropped, never rendered as phantom tables. */
export function parsePartyRooms(data: unknown): PartyOpenRoom[] {
  const rooms = (data as { rooms?: unknown })?.rooms;
  if (!Array.isArray(rooms)) return [];
  const out: PartyOpenRoom[] = [];
  for (const r of rooms) {
    const row = r as {
      code?: unknown;
      game?: unknown;
      players?: unknown;
      streamId?: unknown;
      profileSlug?: unknown;
    };
    if (typeof row.code !== "string" || (row.game !== "trivia" && row.game !== "duel")) {
      continue;
    }
    const players = Array.isArray(row.players)
      ? (row.players as { displayName?: unknown; isHost?: unknown }[])
      : [];
    const host = players.find((p) => p.isHost === true);
    out.push({
      code: row.code,
      game: row.game,
      hostName: typeof host?.displayName === "string" ? host.displayName : "Creator",
      players: players.length,
      streamId: typeof row.streamId === "string" ? row.streamId : null,
      profileSlug: typeof row.profileSlug === "string" ? row.profileSlug : null,
    });
  }
  return out;
}

export interface PartyBoardRow {
  rank: number;
  userId: string;
  name: string;
  wins: number;
  matches: number;
  points: number;
  isYou: boolean;
}

export interface PartyLeaderboard {
  rows: PartyBoardRow[];
  viewerRank: number | null;
}

/** GET /api/party/leaderboard → the palace board beside the table. */
export function parsePartyLeaderboard(data: unknown): PartyLeaderboard {
  const d = (data ?? {}) as { rows?: unknown; viewerRank?: unknown };
  const rows: PartyBoardRow[] = [];
  if (Array.isArray(d.rows)) {
    for (const r of d.rows) {
      const row = r as Partial<PartyBoardRow>;
      if (typeof row.userId !== "string" || typeof row.name !== "string") continue;
      rows.push({
        rank: typeof row.rank === "number" ? row.rank : rows.length + 1,
        userId: row.userId,
        name: row.name,
        wins: typeof row.wins === "number" ? row.wins : 0,
        matches: typeof row.matches === "number" ? row.matches : 0,
        points: typeof row.points === "number" ? row.points : 0,
        isYou: row.isYou === true,
      });
    }
  }
  return { rows, viewerRank: typeof d.viewerRank === "number" ? d.viewerRank : null };
}

export interface PartyMyRecord {
  totalMatches: number;
  totalWins: number;
  games: { game: PartyGame; matches: number; wins: number; points: number; bestScore: number }[];
}

/** GET /api/party/me → my party record strip (null when the payload
 *  isn't the record shape — the strip just stays quiet). */
export function parsePartyMe(data: unknown): PartyMyRecord | null {
  const d = (data ?? {}) as { totalMatches?: unknown; games?: unknown };
  if (typeof d.totalMatches !== "number" || !Array.isArray(d.games)) return null;
  const games: PartyMyRecord["games"] = [];
  for (const g of d.games) {
    const row = g as Partial<PartyMyRecord["games"][number]>;
    if (row.game !== "trivia" && row.game !== "duel") continue;
    games.push({
      game: row.game,
      matches: typeof row.matches === "number" ? row.matches : 0,
      wins: typeof row.wins === "number" ? row.wins : 0,
      points: typeof row.points === "number" ? row.points : 0,
      bestScore: typeof row.bestScore === "number" ? row.bestScore : 0,
    });
  }
  return {
    totalMatches: d.totalMatches,
    totalWins: games.reduce((n, g) => n + g.wins, 0),
    games,
  };
}

/** The POST /api/party/rooms body for opening a table in-world.
 *  The page version also forwards ?stream=/?profile= homes from
 *  its URL — the palace table has no such URL context, so an
 *  in-world table is opened plain (see the follow-on log). */
export function createPartyRoomBody(game: PartyGame): { game: PartyGame } {
  return { game };
}

/** POST /api/party/rooms → the new table's code, or null. */
export function parseCreatedPartyRoom(data: unknown): string | null {
  const code = (data as { room?: { code?: unknown } })?.room?.code;
  return typeof code === "string" && code.length > 0 ? code : null;
}
