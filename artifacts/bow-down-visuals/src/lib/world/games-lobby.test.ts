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
  contestStatusLine,
  createPartyRoomBody,
  dropQualifies,
  gamesSurfaceForStation,
  outcomeForFailedScore,
  outcomeForSavedScore,
  parseArcadeMe,
  parseChallengeStandings,
  parseCreatedPartyRoom,
  parseHallOfFame,
  parseMyLiveStream,
  parseMyProfileSlug,
  parsePartyInvite,
  parsePartyLeaderboard,
  parsePartyMe,
  parsePartyRoomSnapshot,
  parsePartyRooms,
  parseSharkDrop,
  parseWeeklyContest,
  partyInvitePath,
  partyInviteUrl,
  partySummonsHeadline,
  partyTableHomeLine,
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

describe("party invite deep links (2.23)", () => {
  it("builds /world deep links, normalizing the code like the party client", () => {
    expect(partyInvitePath("abc234")).toBe("/world?party=ABC234");
    expect(partyInvitePath("ABC234")).toBe("/world?party=ABC234");
    expect(partyInviteUrl("https://bowdownvisuals.com", "ABC234")).toBe(
      "https://bowdownvisuals.com/world?party=ABC234",
    );
    expect(partyInviteUrl("https://bowdownvisuals.com/", "ABC234")).toBe(
      "https://bowdownvisuals.com/world?party=ABC234",
    );
  });

  it("refuses to build an invite from a non-code", () => {
    expect(partyInvitePath("nope")).toBeNull();
    expect(partyInvitePath("")).toBeNull();
    expect(partyInviteUrl("https://x.example", "toolongcode")).toBeNull();
  });

  it("parses the invite param off a landing URL's search string", () => {
    expect(parsePartyInvite("?party=ABC234")).toBe("ABC234");
    expect(parsePartyInvite("?party=abc234&other=1")).toBe("ABC234");
    expect(parsePartyInvite("party=XYZ789")).toBe("XYZ789");
  });

  it("parses no invite from a bare visit or a malformed code", () => {
    expect(parsePartyInvite("")).toBeNull();
    expect(parsePartyInvite("?room=ABC234")).toBeNull();
    expect(parsePartyInvite("?party=nope")).toBeNull();
    expect(parsePartyInvite("?party=")).toBeNull();
  });

  it("reads one table's snapshot for the summons — server truth, not the link", () => {
    const room = parsePartyRoomSnapshot({
      room: {
        code: "ABC234",
        game: "duel",
        players: [{ displayName: "Host One", isHost: true }],
        streamId: null,
        profileSlug: "host-one",
      },
    });
    expect(room?.hostName).toBe("Host One");
    expect(room?.profileSlug).toBe("host-one");
    expect(parsePartyRoomSnapshot({ room: null })).toBeNull();
    expect(parsePartyRoomSnapshot({})).toBeNull();
    expect(parsePartyRoomSnapshot({ room: { code: "ABC234", game: "chess" } })).toBeNull();
  });

  it("writes the summons headline from the room snapshot", () => {
    expect(
      partySummonsHeadline({
        code: "ABC234",
        game: "trivia",
        hostName: "Host One",
        players: 3,
        streamId: null,
        profileSlug: null,
      }),
    ).toBe("Host One summoned you to their Party Trivia table");
  });
});

describe("homed tables (2.25)", () => {
  it("builds plain, profile-homed, and stream-homed create payloads", () => {
    expect(createPartyRoomBody("trivia")).toEqual({ game: "trivia" });
    expect(createPartyRoomBody("trivia", { kind: "plain" })).toEqual({ game: "trivia" });
    expect(
      createPartyRoomBody("duel", { kind: "profile", slug: "king-shark" }),
    ).toEqual({ game: "duel", profileSlug: "king-shark" });
    expect(
      createPartyRoomBody("trivia", { kind: "stream", streamId: "s1", title: "Live" }),
    ).toEqual({ game: "trivia", streamId: "s1" });
  });

  it("never sends both homes, and falls back to plain on an empty home", () => {
    const body = createPartyRoomBody("trivia", { kind: "profile", slug: "" });
    expect(body).toEqual({ game: "trivia" });
    expect(
      createPartyRoomBody("trivia", { kind: "stream", streamId: "", title: null }),
    ).toEqual({ game: "trivia" });
  });

  it("parses my profile slug from the me payload, null when profile-less", () => {
    expect(parseMyProfileSlug({ slug: "king-shark" })).toBe("king-shark");
    expect(parseMyProfileSlug({ profile: { slug: "nested" } })).toBe("nested");
    expect(parseMyProfileSlug({})).toBeNull();
    expect(parseMyProfileSlug(null)).toBeNull();
  });

  it("parses my live stream only while one is actually live", () => {
    expect(parseMyLiveStream({ live_stream: { id: "s1", title: "Friday Live" } })).toEqual({
      id: "s1",
      title: "Friday Live",
    });
    expect(parseMyLiveStream({ live_stream: null })).toBeNull();
    expect(parseMyLiveStream({})).toBeNull();
  });

  it("labels a table's home the way the page does", () => {
    const base = { code: "ABC234", game: "trivia" as const, hostName: "H", players: 1 };
    expect(partyTableHomeLine({ ...base, streamId: null, profileSlug: "sluggy" })).toBe(
      "Playing at @sluggy",
    );
    expect(partyTableHomeLine({ ...base, streamId: "s1", profileSlug: null })).toBe(
      "Live stream room",
    );
    expect(partyTableHomeLine({ ...base, streamId: null, profileSlug: null })).toBe(
      "Table ABC234",
    );
  });
});

describe("contests + the Winners' Circle (2.24)", () => {
  const weeklyPayload = {
    week_key: "2026-W42",
    challenge: {
      slug: "golden-hour-glow",
      title: "Golden Hour Glow",
      hashtag: "goldenhourglow",
      status: "live",
      entry_count: 14,
      prize_pool_credits: 1000,
      ends_at: "2026-10-18T23:59:59Z",
      prizes: [
        { place: 2, prize_credits: 300 },
        { place: 1, prize_credits: 500 },
        { place: 3, prize_credits: 200 },
      ],
      winners: [],
    },
    last_week: {
      challenge_title: "Night Drive",
      winners: [
        {
          place: 1,
          prize_credits: 500,
          creator: { slug: "nova", display_name: "Nova" },
          video: { id: "v1", title: "Midnight Run" },
        },
      ],
    },
  };

  it("parses the weekly contest with prizes in place order", () => {
    const { weekly, lastWeek } = parseWeeklyContest(weeklyPayload);
    expect(weekly?.slug).toBe("golden-hour-glow");
    expect(weekly?.entryCount).toBe(14);
    expect(weekly?.prizePoolCredits).toBe(1000);
    expect(weekly?.prizes.map((p) => p.place)).toEqual([1, 2, 3]);
    expect(lastWeek?.challengeTitle).toBe("Night Drive");
    expect(lastWeek?.winners[0]).toEqual({
      place: 1,
      prizeCredits: 500,
      creatorName: "Nova",
      creatorSlug: "nova",
      challengeTitle: "Night Drive",
      entryTitle: "Midnight Run",
    });
  });

  it("renders the empty state honestly: no contest launched, no crowns", () => {
    expect(parseWeeklyContest({ challenge: null, last_week: null })).toEqual({
      weekly: null,
      lastWeek: null,
    });
    expect(parseWeeklyContest({})).toEqual({ weekly: null, lastWeek: null });
    expect(parseHallOfFame({ winners: [] })).toEqual([]);
    expect(parseHallOfFame({})).toEqual([]);
    expect(parseChallengeStandings({ entries: [] })).toEqual([]);
  });

  it("keeps the server's standings order — who's ahead is the server's call", () => {
    const standings = parseChallengeStandings({
      entries: [
        { title: "Leader Vid", vote_count: 9, view_count: 900, creator: { slug: "a", display_name: "Ahead" } },
        { title: "Second Vid", vote_count: 4, view_count: 500, creator: { slug: "b", display_name: "Behind" } },
        { title: "Third Vid", vote_count: 1, view_count: 100, creator: { slug: null, display_name: null } },
        { title: "Fourth Vid", vote_count: 0, view_count: 10, creator: { slug: "d", display_name: "Cut Off" } },
      ],
    });
    expect(standings.map((s) => s.creatorName)).toEqual(["Ahead", "Behind", "Creator"]);
    expect(standings[0]).toMatchObject({ rank: 1, votes: 9, views: 900 });
  });

  it("parses the hall of fame as winner standings with their crowns", () => {
    const fame = parseHallOfFame({
      winners: [
        {
          place: 2,
          prize_credits: 300,
          challenge: { slug: "flip", title: "The Flip", hashtag: "theflip" },
          video: { id: "v9", title: "Flipped It" },
          creator: { slug: "rex", display_name: "Rex" },
        },
      ],
    });
    expect(fame).toEqual([
      {
        place: 2,
        prizeCredits: 300,
        creatorName: "Rex",
        creatorSlug: "rex",
        challengeTitle: "The Flip",
        entryTitle: "Flipped It",
      },
    ]);
  });

  it("speaks contest statuses in wall words", () => {
    expect(contestStatusLine("live")).toContain("Live now");
    expect(contestStatusLine("winners")).toBe("Winners crowned");
    expect(contestStatusLine("judging")).toContain("Judging");
  });
});
