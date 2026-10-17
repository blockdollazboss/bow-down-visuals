/**
 * games-lobby tests — the Game Rooms' native seam (§3.5).
 *
 * Pins: the station→surface dispatch (the host's one games
 * branch), the cabinet list (the two self-contained arcade games,
 * house order), the /api/arcade/me + score-outcome shaping the
 * /arcade page performs, the Shark Drop rail's UX gate + payload
 * parse, and the party lobby parsers (rooms / leaderboard / me /
 * create) against the exact wire shapes pages/party.tsx consumes.
 */
import { describe, it, expect } from "vitest";
import {
  ARCADE_CABINETS,
  createPartyRoomBody,
  dropQualifies,
  gamesSurfaceForStation,
  outcomeForFailedScore,
  outcomeForSavedScore,
  parseArcadeMe,
  parseCreatedPartyRoom,
  parsePartyLeaderboard,
  parsePartyMe,
  parsePartyRooms,
  parseSharkDrop,
} from "./games-lobby";

describe("gamesSurfaceForStation", () => {
  it("routes the two Game Rooms stations to their lobbies", () => {
    expect(gamesSurfaceForStation("arcade-cabinets")).toBe("arcade");
    expect(gamesSurfaceForStation("marble-table")).toBe("marble");
  });

  it("returns null for anything else (placeholder keeps the station)", () => {
    expect(gamesSurfaceForStation("jukebox")).toBeNull();
    expect(gamesSurfaceForStation("")).toBeNull();
  });
});

describe("the cabinets", () => {
  it("are the two house games, runner first, titles from the shared meta", () => {
    expect(ARCADE_CABINETS.map((c) => c.id)).toEqual(["runner", "skeet"]);
    expect(ARCADE_CABINETS[0]!.title).toBe("Shark King Endless Runner");
    expect(ARCADE_CABINETS[1]!.title).toBe("Royal Skeet");
    for (const c of ARCADE_CABINETS) expect(c.tagline.length).toBeGreaterThan(0);
  });
});

describe("parseArcadeMe", () => {
  it("reads bests per game, null for unplayed", () => {
    expect(
      parseArcadeMe({
        games: [
          { game: "runner", best: 1200 },
          { game: "skeet", best: null },
        ],
      }),
    ).toEqual({ runner: 1200, skeet: null });
  });

  it("ignores unknown games and malformed payloads", () => {
    expect(parseArcadeMe({ games: [{ game: "trivia", best: 5 }] })).toEqual({});
    expect(parseArcadeMe(null)).toEqual({});
    expect(parseArcadeMe({})).toEqual({});
  });
});

describe("score outcomes", () => {
  it("shapes a saved score with best + rank", () => {
    expect(
      outcomeForSavedScore(900, { personalBest: 900, isPersonalBest: true, rank: 3 }),
    ).toEqual({ score: 900, saved: true, personalBest: 900, isPersonalBest: true, rank: 3 });
  });

  it("tolerates a thin save payload", () => {
    const o = outcomeForSavedScore(10, {});
    expect(o.saved).toBe(true);
    expect(o.personalBest).toBeUndefined();
    expect(o.rank).toBeNull();
  });

  it("shapes a failure honestly", () => {
    expect(outcomeForFailedScore(42, "save failed")).toEqual({
      score: 42,
      saved: false,
      error: "save failed",
    });
  });
});

describe("the shark-drop rail gate", () => {
  it("qualifies at the shared thresholds, not below", () => {
    expect(dropQualifies({ game: "runner", score: 250, durationMs: 1 })).toBe(true);
    expect(dropQualifies({ game: "runner", score: 249, durationMs: 1 })).toBe(false);
    expect(dropQualifies({ game: "skeet", score: 1500, durationMs: 1 })).toBe(true);
    expect(dropQualifies({ game: "skeet", score: 1499, durationMs: 1 })).toBe(false);
  });

  it("parses a held drop and nothing else", () => {
    expect(parseSharkDrop({ drop: { id: "d1", amount: 500 } })).toEqual({
      id: "d1",
      amount: 500,
    });
    expect(parseSharkDrop({ drop: null })).toBeNull();
    expect(parseSharkDrop({})).toBeNull();
    expect(parseSharkDrop({ drop: { id: 7, amount: "x" } })).toBeNull();
  });
});

describe("parsePartyRooms", () => {
  it("maps open rooms to table cards with host + seats context", () => {
    const rooms = parsePartyRooms({
      rooms: [
        {
          code: "ABC234",
          game: "trivia",
          players: [
            { displayName: "Host One", isHost: true },
            { displayName: "Guest", isHost: false },
          ],
          streamId: null,
          profileSlug: "someone",
        },
        {
          code: "XYZ789",
          game: "duel",
          players: [{ displayName: "Lone", isHost: false }],
          streamId: "s1",
          profileSlug: null,
        },
      ],
    });
    expect(rooms).toEqual([
      { code: "ABC234", game: "trivia", hostName: "Host One", players: 2, streamId: null, profileSlug: "someone" },
      { code: "XYZ789", game: "duel", hostName: "Creator", players: 1, streamId: "s1", profileSlug: null },
    ]);
  });

  it("drops malformed rows instead of inventing tables", () => {
    expect(parsePartyRooms({ rooms: [{ code: 1, game: "trivia" }, { game: "duel" }] })).toEqual([]);
    expect(parsePartyRooms(null)).toEqual([]);
  });
});

describe("parsePartyLeaderboard", () => {
  it("reads rows + viewer rank, defaulting thin fields", () => {
    const board = parsePartyLeaderboard({
      viewerRank: 12,
      rows: [
        { rank: 1, userId: "u1", name: "King", wins: 9, matches: 10, points: 4000, isYou: false },
        { userId: "u2", name: "Thin Row" },
      ],
    });
    expect(board.viewerRank).toBe(12);
    expect(board.rows[0]).toEqual({
      rank: 1, userId: "u1", name: "King", wins: 9, matches: 10, points: 4000, isYou: false,
    });
    expect(board.rows[1]).toEqual({
      rank: 2, userId: "u2", name: "Thin Row", wins: 0, matches: 0, points: 0, isYou: false,
    });
  });

  it("handles an empty board payload", () => {
    expect(parsePartyLeaderboard({})).toEqual({ rows: [], viewerRank: null });
  });
});

describe("parsePartyMe + create", () => {
  it("totals wins across games", () => {
    const me = parsePartyMe({
      totalMatches: 7,
      games: [
        { game: "trivia", matches: 5, wins: 2, points: 900, bestScore: 300 },
        { game: "duel", matches: 2, wins: 1, points: 400, bestScore: 250 },
      ],
    });
    expect(me?.totalMatches).toBe(7);
    expect(me?.totalWins).toBe(3);
  });

  it("returns null for a non-record payload", () => {
    expect(parsePartyMe({})).toBeNull();
    expect(parsePartyMe(null)).toBeNull();
  });

  it("builds the create body and parses the created code", () => {
    expect(createPartyRoomBody("duel")).toEqual({ game: "duel" });
    expect(parseCreatedPartyRoom({ room: { code: "ABC234" } })).toBe("ABC234");
    expect(parseCreatedPartyRoom({})).toBeNull();
    expect(parseCreatedPartyRoom({ room: { code: "" } })).toBeNull();
  });
});
