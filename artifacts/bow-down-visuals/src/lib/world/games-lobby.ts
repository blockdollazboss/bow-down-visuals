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
 *   Ring 2 (the game loop): party invite deep links are /world
 *     links (/world?party=CODE, parsed by the world page on entry);
 *     table homes ride the same POST body the page builds from
 *     ?stream=/?profile= — sourced in-world from
 *     GET /api/creator-profiles/me + GET /api/live-streams/status;
 *     contests + the Winners' Circle read the challenge rails
 *     (GET /api/challenges/weekly, /api/challenges/:slug,
 *     /api/challenges/hall-of-fame).
 */
import {
  ARCADE_GAME_META,
  DROP_QUALIFYING_SCORE,
  type ArcadeGameId,
  type ArcadeRunResult,
} from "../arcade-games";
import {
  isPartyRoomCode,
  normalizePartyCode,
  type PartyGame,
} from "../party-client";

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

function partyOpenRoomFromRow(r: unknown): PartyOpenRoom | null {
  const row = r as {
    code?: unknown;
    game?: unknown;
    players?: unknown;
    streamId?: unknown;
    profileSlug?: unknown;
  };
  if (typeof row?.code !== "string" || (row.game !== "trivia" && row.game !== "duel")) {
    return null;
  }
  const players = Array.isArray(row.players)
    ? (row.players as { displayName?: unknown; isHost?: unknown }[])
    : [];
  const host = players.find((p) => p.isHost === true);
  return {
    code: row.code,
    game: row.game,
    hostName: typeof host?.displayName === "string" ? host.displayName : "Creator",
    players: players.length,
    streamId: typeof row.streamId === "string" ? row.streamId : null,
    profileSlug: typeof row.profileSlug === "string" ? row.profileSlug : null,
  };
}

/** GET /api/party/rooms → open tables as cards. Malformed rows are
 *  dropped, never rendered as phantom tables. */
export function parsePartyRooms(data: unknown): PartyOpenRoom[] {
  const rooms = (data as { rooms?: unknown })?.rooms;
  if (!Array.isArray(rooms)) return [];
  const out: PartyOpenRoom[] = [];
  for (const r of rooms) {
    const room = partyOpenRoomFromRow(r);
    if (room) out.push(room);
  }
  return out;
}

/** GET /api/party/rooms/:code → one table's snapshot ({ room }), the
 *  shape the summons reads: whose table it is, straight from the
 *  server's own room state — never guessed from the link alone. */
export function parsePartyRoomSnapshot(data: unknown): PartyOpenRoom | null {
  return partyOpenRoomFromRow((data as { room?: unknown })?.room);
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

/* ─── Table homes (2.25) ──────────────────────────────────────────
   The page flow homes a table by forwarding ?stream= / ?profile=
   from its URL into the same POST body. In-world there is no such
   URL, so the Marble Table offers the choice directly: plain, homed
   to your profile (your creator profile's slug), or homed to your
   live stream (your live stream's id, from the same status endpoint
   the Go Live studio and the stage remote read). The server schema
   accepts exactly { game, streamId?, profileSlug? } — a homed body
   carries ONE home, never both. */
export type PartyTableHome =
  | { kind: "plain" }
  | { kind: "profile"; slug: string }
  | { kind: "stream"; streamId: string; title: string | null };

export const PLAIN_TABLE_HOME: PartyTableHome = { kind: "plain" };

/** The POST /api/party/rooms body for opening a table in-world,
 *  plain or homed (2.25). */
export function createPartyRoomBody(
  game: PartyGame,
  home: PartyTableHome = PLAIN_TABLE_HOME,
): { game: PartyGame; streamId?: string; profileSlug?: string } {
  if (home.kind === "profile" && home.slug) return { game, profileSlug: home.slug };
  if (home.kind === "stream" && home.streamId) return { game, streamId: home.streamId };
  return { game };
}

/** GET /api/creator-profiles/me → my profile slug, or null when I
 *  have no creator profile yet (the profile home just doesn't
 *  offer itself — never a fake slug). */
export function parseMyProfileSlug(data: unknown): string | null {
  const d = data as { slug?: unknown; profile?: { slug?: unknown } } | null;
  if (typeof d?.slug === "string" && d.slug.length > 0) return d.slug;
  if (typeof d?.profile?.slug === "string" && d.profile.slug.length > 0) {
    return d.profile.slug;
  }
  return null;
}

/** GET /api/live-streams/status → my live stream, or null when I'm
 *  not live (the stream home only offers itself while a stream is
 *  actually running — a table can't home to a stream that isn't). */
export function parseMyLiveStream(
  data: unknown,
): { id: string; title: string | null } | null {
  const s = (data as { live_stream?: { id?: unknown; title?: unknown } | null })
    ?.live_stream;
  if (!s || typeof s.id !== "string" || s.id.length === 0) return null;
  return { id: s.id, title: typeof s.title === "string" ? s.title : null };
}

/** How a table's home reads on its card — the same words the page
 *  lobby and the room header use. */
export function partyTableHomeLine(room: PartyOpenRoom): string {
  if (room.profileSlug) return `Playing at @${room.profileSlug}`;
  if (room.streamId) return "Live stream room";
  return `Table ${room.code}`;
}

/** POST /api/party/rooms → the new table's code, or null. */
export function parseCreatedPartyRoom(data: unknown): string | null {
  const code = (data as { room?: { code?: unknown } })?.room?.code;
  return typeof code === "string" && code.length > 0 ? code : null;
}

/* ─── Party invite deep links (2.23) ──────────────────────────────
   A party invite that lands IN THE WORLD: /world?party=CODE.
   The world page reads the param on entry (parsePartyInvite), the
   server re-verifies the table itself (GET /api/party/rooms/:code),
   and the walker is summoned to the Game Rooms with the Marble
   Table's join pre-filled. The /party?room=CODE link still exists
   on the website's own lobby — this is the World's own door, not a
   replacement for it. Codes are the party client's own shape
   (6 chars, its alphabet); an invalid code is no invite at all. */
export const WORLD_PARTY_INVITE_PARAM = "party";

/** The in-world invite path for a table code (null: not a code). */
export function partyInvitePath(code: string): string | null {
  const normalized = normalizePartyCode(code ?? "");
  if (!isPartyRoomCode(normalized)) return null;
  return `/world?${WORLD_PARTY_INVITE_PARAM}=${normalized}`;
}

/** The absolute invite link a player copies to summon friends. */
export function partyInviteUrl(origin: string, code: string): string | null {
  const path = partyInvitePath(code);
  if (!path) return null;
  return `${origin.replace(/\/$/, "")}${path}`;
}

/** A landing URL's search string → the invited table code, or null.
 *  Mirrors how pages/party.tsx reads ?room= — same normalizer, same
 *  validity gate, so a link that works there parses here. */
export function parsePartyInvite(search: string): string | null {
  let raw: string | null = null;
  try {
    raw = new URLSearchParams(search).get(WORLD_PARTY_INVITE_PARAM);
  } catch {
    return null;
  }
  if (!raw) return null;
  const code = normalizePartyCode(raw);
  return isPartyRoomCode(code) ? code : null;
}

/** The summons headline, from the SERVER's room snapshot — whose
 *  table, which game, how full. Never built from the link alone:
 *  a link can be stale; the room state is the truth. */
export function partySummonsHeadline(room: PartyOpenRoom): string {
  const meta = PARTY_GAME_META[room.game];
  return `${room.hostName} summoned you to their ${meta.title} table`;
}

/* ─── Contests + the Winners' Circle (2.24) ───────────────────────
   The Game Rooms' wall of stakes and crowns, read from the rails
   that exist (all public, all server-shaped):
   - GET /api/challenges/weekly — this week's challenge contest:
     status, entry count, prize pool + per-place prizes, and last
     week's crowned winners. (The fan-contest rail, /api/contests,
     lists only the CALLER's own contests — a creator dashboard,
     not a palace wall — so it is not the presence source.)
   - GET /api/challenges/:slug — the current contest's entries,
     server-ordered by views with vote counts: the live standings
     (who's ahead, by how much).
   - GET /api/challenges/hall-of-fame — all-time winners: the
     Winners' Circle itself.
   Numbers are the server's, verbatim — the wall never computes a
   standing, a prize, or a count of its own. */
export interface ContestPrize {
  place: number;
  prizeCredits: number;
}

export interface ContestWinnerStanding {
  place: number;
  prizeCredits: number;
  creatorName: string;
  creatorSlug: string | null;
  challengeTitle: string;
  entryTitle: string;
}

export interface WeeklyContest {
  slug: string;
  title: string;
  hashtag: string;
  status: string;
  entryCount: number;
  prizePoolCredits: number;
  endsAt: string | null;
  prizes: ContestPrize[];
  winners: ContestWinnerStanding[];
}

export interface ContestStanding {
  rank: number;
  creatorName: string;
  creatorSlug: string | null;
  entryTitle: string;
  votes: number;
  views: number;
}

function winnerStandingFromRow(r: unknown, fallbackChallengeTitle: string): ContestWinnerStanding | null {
  const row = r as {
    place?: unknown;
    prize_credits?: unknown;
    challenge?: { title?: unknown };
    video?: { title?: unknown };
    creator?: { slug?: unknown; display_name?: unknown };
  };
  if (typeof row?.place !== "number") return null;
  return {
    place: row.place,
    prizeCredits: typeof row.prize_credits === "number" ? row.prize_credits : 0,
    creatorName:
      typeof row.creator?.display_name === "string" && row.creator.display_name
        ? row.creator.display_name
        : "Creator",
    creatorSlug: typeof row.creator?.slug === "string" ? row.creator.slug : null,
    challengeTitle:
      typeof row.challenge?.title === "string" && row.challenge.title
        ? row.challenge.title
        : fallbackChallengeTitle,
    entryTitle: typeof row.video?.title === "string" ? row.video.title : "",
  };
}

function winnerStandings(rows: unknown, fallbackChallengeTitle: string): ContestWinnerStanding[] {
  if (!Array.isArray(rows)) return [];
  const out: ContestWinnerStanding[] = [];
  for (const r of rows) {
    const w = winnerStandingFromRow(r, fallbackChallengeTitle);
    if (w) out.push(w);
  }
  return out.sort((a, b) => a.place - b.place);
}

export interface WeeklyContestPresence {
  weekly: WeeklyContest | null;
  lastWeek: { challengeTitle: string; winners: ContestWinnerStanding[] } | null;
}

/** GET /api/challenges/weekly → the current contest + last week's
 *  crowns. `weekly` is null in a week with no contest launched —
 *  the wall says so honestly instead of inventing one. */
export function parseWeeklyContest(data: unknown): WeeklyContestPresence {
  const d = data as {
    challenge?: {
      slug?: unknown;
      title?: unknown;
      hashtag?: unknown;
      status?: unknown;
      entry_count?: unknown;
      prize_pool_credits?: unknown;
      ends_at?: unknown;
      prizes?: unknown;
      winners?: unknown;
    } | null;
    last_week?: { challenge_title?: unknown; winners?: unknown } | null;
  };
  let weekly: WeeklyContest | null = null;
  const ch = d?.challenge;
  if (ch && typeof ch.slug === "string" && typeof ch.title === "string") {
    const prizes: ContestPrize[] = [];
    if (Array.isArray(ch.prizes)) {
      for (const p of ch.prizes) {
        const row = p as { place?: unknown; prize_credits?: unknown };
        if (typeof row.place === "number") {
          prizes.push({
            place: row.place,
            prizeCredits: typeof row.prize_credits === "number" ? row.prize_credits : 0,
          });
        }
      }
    }
    weekly = {
      slug: ch.slug,
      title: ch.title,
      hashtag: typeof ch.hashtag === "string" ? ch.hashtag : "",
      status: typeof ch.status === "string" ? ch.status : "",
      entryCount: typeof ch.entry_count === "number" ? ch.entry_count : 0,
      prizePoolCredits: typeof ch.prize_pool_credits === "number" ? ch.prize_pool_credits : 0,
      endsAt: typeof ch.ends_at === "string" ? ch.ends_at : null,
      prizes: prizes.sort((a, b) => a.place - b.place),
      winners: winnerStandings(ch.winners, ch.title),
    };
  }
  let lastWeek: WeeklyContestPresence["lastWeek"] = null;
  const lw = d?.last_week;
  if (lw && typeof lw.challenge_title === "string") {
    const winners = winnerStandings(lw.winners, lw.challenge_title);
    if (winners.length > 0) lastWeek = { challengeTitle: lw.challenge_title, winners };
  }
  return { weekly, lastWeek };
}

/** GET /api/challenges/:slug → the live standings: the server's own
 *  order (entries ranked by views), capped for the wall. Rank is
 *  position in that server order, never re-sorted here. */
export function parseChallengeStandings(data: unknown, limit = 3): ContestStanding[] {
  const entries = (data as { entries?: unknown })?.entries;
  if (!Array.isArray(entries)) return [];
  const out: ContestStanding[] = [];
  for (const e of entries) {
    if (out.length >= limit) break;
    const row = e as {
      title?: unknown;
      vote_count?: unknown;
      view_count?: unknown;
      creator?: { slug?: unknown; display_name?: unknown };
    };
    out.push({
      rank: out.length + 1,
      creatorName:
        typeof row.creator?.display_name === "string" && row.creator.display_name
          ? row.creator.display_name
          : "Creator",
      creatorSlug: typeof row.creator?.slug === "string" ? row.creator.slug : null,
      entryTitle: typeof row.title === "string" ? row.title : "",
      votes: typeof row.vote_count === "number" ? row.vote_count : 0,
      views: typeof row.view_count === "number" ? row.view_count : 0,
    });
  }
  return out;
}

/** GET /api/challenges/hall-of-fame → the Winners' Circle wall,
 *  newest crowns first as the server sends them, capped. */
export function parseHallOfFame(data: unknown, limit = 5): ContestWinnerStanding[] {
  const winners = (data as { winners?: unknown })?.winners;
  if (!Array.isArray(winners)) return [];
  const out: ContestWinnerStanding[] = [];
  for (const r of winners) {
    if (out.length >= limit) break;
    const w = winnerStandingFromRow(r, "");
    if (w) out.push(w);
  }
  return out;
}

/** A challenge contest's status, in wall words. */
export function contestStatusLine(status: string): string {
  switch (status) {
    case "live":
      return "Live now — entries are in, votes are counting";
    case "upcoming":
      return "Opens soon";
    case "judging":
      return "Judging — the crown is being decided";
    case "winners":
      return "Winners crowned";
    default:
      return status ? status : "This week's contest";
  }
}
