/**
 * World Contests client seam (lib/world/contests) — pure pins:
 * - the wire shapes normalize defensively (drift-proof): junk
 *   rows drop, winners sort into podium order, phases fall back
 *   honestly from the event status;
 * - the words are the palace's (stage names, phase labels, place
 *   labels, the deadline line in present/past tense);
 * - "my entry" is DERIVED from the public entries list against
 *   the member's own id — never claimed, null for guests;
 * - the request builders trim, and the podium builder drops
 *   blanks + duplicates while keeping the host's order;
 * - a refusal shows the server's own plain words when it sent
 *   them, the seam's copy of the code's words when it didn't;
 * - the station + panel wiring is pinned at the source (the
 *   Winners' Circle door in the Royal Court Chamber, the
 *   StationPanel case, the Kingdom Board's contest slate label).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildContestBody,
  buildEntryBody,
  buildWinnersBody,
  contestDeadlineLine,
  contestErrorCopy,
  contestPhaseLabel,
  contestStageName,
  myContestEntry,
  normalizeContestDetail,
  normalizeContests,
  normalizeMyWorks,
  normalizeWinnersCircle,
  placeLabel,
  type WorldContestEntry,
} from "./contests";
import { STATION_BY_ID } from "./stations";

const CONTEST = {
  id: "c1",
  title: "Best Hook in the Palace",
  theme: "A hook that stops the scroll",
  roomId: "world:music-hall",
  hostUserId: "u-host",
  hostName: "Plain Pat",
  startsAt: "2026-10-20T12:00:00.000Z",
  endsAt: "2026-10-22T12:00:00.000Z",
  status: "live",
  phase: "open",
  entryCount: 2,
  winners: [
    { id: "w2", entryId: "e2", userId: "u2", place: 2, winnerName: "Bo", workKind: "video", workTitle: "Second", decidedAt: "2026-10-23T00:00:00.000Z" },
    { id: "w1", entryId: "e1", userId: "u1", place: 1, winnerName: "Ada", workKind: "track", workTitle: "First", decidedAt: "2026-10-23T00:00:00.000Z" },
  ],
};

describe("normalization", () => {
  it("reads a contest whole, winners in podium order", () => {
    const [c] = normalizeContests({ contests: [CONTEST] });
    expect(c).toMatchObject({ id: "c1", phase: "open", entryCount: 2, hostName: "Plain Pat" });
    expect(c!.winners.map((w) => w.place)).toEqual([1, 2]);
    expect(c!.winners[0]).toMatchObject({ winnerName: "Ada", workKind: "track" });
  });

  it("drops junk rows and falls back honestly on a missing phase", () => {
    const out = normalizeContests({
      contests: [null, 42, { title: "no id" }, { ...CONTEST, id: "c2", phase: undefined, status: "cancelled" }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.phase).toBe("called-off");
    expect(normalizeContests(null)).toEqual([]);
    expect(normalizeContests({})).toEqual([]);
  });

  it("detail carries the entries; garbage detail is null, never a fake contest", () => {
    const d = normalizeContestDetail({
      contest: CONTEST,
      entries: [
        { id: "e1", userId: "u1", entrantName: "Ada", workKind: "track", workTitle: "First", createdAt: "2026-10-21T00:00:00.000Z" },
        { nope: true },
      ],
    });
    expect(d!.entries).toHaveLength(1);
    expect(d!.entries[0]).toMatchObject({ entrantName: "Ada", workKind: "track" });
    expect(normalizeContestDetail(null)).toBeNull();
    expect(normalizeContestDetail({ contest: { title: "x" } })).toBeNull();
  });

  it("the Circle parses honors and drops junk", () => {
    const honors = normalizeWinnersCircle({
      honors: [
        { id: "h1", place: 1, winnerName: "Ada", workKind: "track", workTitle: "First", contestId: "c1", contestTitle: "Best Hook", roomId: "world:music-hall", decidedAt: "2026-10-23T00:00:00.000Z" },
        { place: 1 },
      ],
    });
    expect(honors).toHaveLength(1);
    expect(honors[0]).toMatchObject({ winnerName: "Ada", contestTitle: "Best Hook" });
    expect(normalizeWinnersCircle(undefined)).toEqual([]);
  });

  it("my works keep the published flag — the picker disables the rest", () => {
    const works = normalizeMyWorks({
      works: [
        { id: "t1", workKind: "track", title: "Out", isPublished: true },
        { id: "t2", workKind: "video", title: "Draft", isPublished: false },
        { workKind: "track" },
      ],
    });
    expect(works).toEqual([
      { id: "t1", workKind: "track", title: "Out", isPublished: true },
      { id: "t2", workKind: "video", title: "Draft", isPublished: false },
    ]);
  });
});

describe("words", () => {
  it("stages, phases and places speak plainly", () => {
    expect(contestStageName("world:kings-hall")).toBe("Throne Hall");
    expect(contestStageName("world:music-hall")).toBe("Music Hall");
    expect(contestStageName("world:elsewhere")).toBe("The Palace");
    expect(contestPhaseLabel("open")).toBe("Taking entries");
    expect(contestPhaseLabel("judging")).toBe("With the judges");
    expect(contestPhaseLabel("decided")).toBe("Decided");
    expect(placeLabel(1)).toBe("First place");
    expect(placeLabel(2)).toBe("Second place");
    expect(placeLabel(3)).toBe("Third place");
  });

  it("the deadline line is present tense while the window stands, past after", () => {
    const now = Date.parse("2026-10-21T12:00:00.000Z");
    expect(contestDeadlineLine({ endsAt: CONTEST.endsAt, phase: "open" }, now)).toMatch(/^Entries close /);
    expect(contestDeadlineLine({ endsAt: CONTEST.endsAt, phase: "judging" }, now)).toMatch(/^Entries closed /);
    expect(contestDeadlineLine({ endsAt: CONTEST.endsAt, phase: "decided" }, now)).toMatch(/^Decided — entries closed /);
  });

  it("my entry is derived from the entries list — null for guests and non-entrants", () => {
    const entries: WorldContestEntry[] = [
      { id: "e1", userId: "u1", entrantName: "Ada", workKind: "track", workTitle: "First", createdAt: "" },
      { id: "e2", userId: "u2", entrantName: "Bo", workKind: "video", workTitle: "Second", createdAt: "" },
    ];
    expect(myContestEntry(entries, "u2")!.id).toBe("e2");
    expect(myContestEntry(entries, null)).toBeNull();
    expect(myContestEntry(entries, "u-stranger")).toBeNull();
  });
});

describe("builders + refusal copy", () => {
  it("the contest body trims; the entry body is the work's own shape", () => {
    expect(
      buildContestBody({ title: "  Crown  ", theme: "  Hooks ", roomId: "world:music-hall", endsAtIso: "2026-10-22T12:00:00.000Z" }),
    ).toEqual({ title: "Crown", theme: "Hooks", roomId: "world:music-hall", endsAt: "2026-10-22T12:00:00.000Z" });
    expect(buildEntryBody({ id: "t1", workKind: "video" })).toEqual({ workKind: "video", workId: "t1" });
  });

  it("the podium builder keeps order, drops blanks and duplicates", () => {
    expect(buildWinnersBody(["e2", null, "e1", "e2", ""])).toEqual({ entryIds: ["e2", "e1"] });
    expect(buildWinnersBody([null, null])).toEqual({ entryIds: [] });
  });

  it("a refusal shows the server's words first, the code's words second, never silence", () => {
    expect(contestErrorCopy("ALREADY_ENTERED", "Server said it plainly.")).toBe("Server said it plainly.");
    expect(contestErrorCopy("ALREADY_ENTERED")).toMatch(/one entry each/);
    expect(contestErrorCopy("FRONT_ROW_REQUIRED")).toMatch(/Front Row/);
    expect(contestErrorCopy("WHATEVER")).toMatch(/try again/);
    expect(contestErrorCopy(null)).toMatch(/try again/);
  });
});

describe("source pins — the door and the panel are wired", () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

  it("the Winners' Circle is a custom station in the Royal Court Chamber, born world-native", () => {
    const s = STATION_BY_ID.get("winners-circle")!;
    expect(s).toBeDefined();
    expect(s.roomId).toBe("world:royal-court");
    expect(s.panel).toEqual({ kind: "custom", id: "winners-circle" });
    expect(s.websitePath).toBeNull();
    expect(s.membersOnly).toBe(false);
  });

  it("StationPanel renders the panel for the winners-circle custom", () => {
    const panel = read("../../components/world/StationPanel.tsx");
    expect(panel).toContain("WinnersCirclePanel");
    expect(panel).toContain('case "winners-circle"');
  });

  it("the panel carries the guest pitch, the judging rail and the no-purse honesty line", () => {
    const src = read("../../components/world/native/WinnersCirclePanel.tsx");
    expect(src).toContain('data-testid="world-contest-guest-pitch"');
    expect(src).toContain('data-testid="world-contest-work-picker"');
    expect(src).toContain('data-testid="world-contest-name-winners"');
    expect(src).toContain("no Visual Bucs move");
    expect(src).toContain("fetchWinnersCircle");
  });

  it("the Kingdom Board's slate labels a contest as a contest", () => {
    const board = read("../../components/world/native/KingdomBoardBlocks.tsx");
    expect(board).toContain('contest: "Contest"');
  });
});
