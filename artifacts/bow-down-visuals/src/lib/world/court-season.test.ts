/**
 * Court seasons client seam (lib/world/court-season) — the marks
 * wall's read of GET /api/world/court-season. Pinned: the parser
 * is defensive (a malformed payload degrades, never invents), the
 * frozen seasons sort newest-first whatever the wire order, and
 * standings keep their frozen places.
 */
import { describe, it, expect } from "vitest";
import {
  parseCourtSeasonWall,
  seasonDisplayName,
  seasonTurnLabel,
  courtSeasonPath,
} from "./court-season";

const standing = (place: number, name: string, points: number) => ({
  place,
  userId: `u-${name}`,
  displayName: name,
  slug: name.toLowerCase(),
  points,
  stars: 3,
  title: "Gangster",
});

const payload = {
  current: {
    seasonKey: "2026-11",
    ordinal: 2,
    name: "Season II",
    subtitle: "of the Gilded Ledger",
    startsAt: "2026-11-01T00:00:00.000Z",
    endsAt: "2026-12-01T00:00:00.000Z",
    standings: [standing(2, "Bo", 40), standing(1, "Ada", 90)],
  },
  seasons: [
    {
      seasonKey: "2026-10",
      ordinal: 1,
      name: "Season I",
      subtitle: "of the First Bells",
      startsAt: "2026-10-01T00:00:00.000Z",
      endsAt: "2026-11-01T00:00:00.000Z",
      settledAt: "2026-11-01T00:01:00.000Z",
      standings: [standing(1, "Ada", 116)],
      heraldText: "The season has turned.",
    },
  ],
};

describe("parseCourtSeasonWall", () => {
  it("parses the wall: current season sorted by place, frozen seasons kept whole", () => {
    const wall = parseCourtSeasonWall(payload)!;
    expect(wall.current.name).toBe("Season II");
    expect(wall.current.standings.map((s) => s.displayName)).toEqual(["Ada", "Bo"]);
    expect(wall.seasons).toHaveLength(1);
    expect(wall.seasons[0]!.standings[0]).toMatchObject({ place: 1, points: 116, stars: 3 });
    expect(wall.seasons[0]!.heraldText).toBe("The season has turned.");
  });

  it("sorts settled seasons newest-first whatever the wire order", () => {
    const older = { ...payload.seasons[0]! };
    const newer = {
      ...older,
      seasonKey: "2026-11",
      ordinal: 2,
      name: "Season II",
    };
    const wall = parseCourtSeasonWall({ current: payload.current, seasons: [older, newer] })!;
    expect(wall.seasons.map((s) => s.ordinal)).toEqual([2, 1]);
  });

  it("degrades instead of inventing: junk payloads and junk rows fall away", () => {
    expect(parseCourtSeasonWall(null)).toBeNull();
    expect(parseCourtSeasonWall("nope")).toBeNull();
    expect(parseCourtSeasonWall({})).toBeNull();
    expect(parseCourtSeasonWall({ current: null, seasons: [] })).toBeNull();
    const wall = parseCourtSeasonWall({
      current: { ...payload.current, standings: [{ place: 1 }, standing(1, "Ada", 5)] },
      seasons: "junk",
    })!;
    expect(wall.current.standings.map((s) => s.displayName)).toEqual(["Ada"]);
    expect(wall.seasons).toEqual([]);
  });

  it("clamps out-of-range numbers to the ladder's shape (stars 1–6, points ≥ 0)", () => {
    const wall = parseCourtSeasonWall({
      current: {
        ...payload.current,
        standings: [{ ...standing(1, "Ada", -4), stars: 99 }],
      },
      seasons: [],
    })!;
    expect(wall.current.standings[0]!.points).toBe(0);
    expect(wall.current.standings[0]!.stars).toBe(6);
  });
});

describe("display helpers", () => {
  it("the season's full style joins name and subtitle", () => {
    expect(seasonDisplayName({ name: "Season IV", subtitle: "of the Winter Hearth" })).toBe(
      "Season IV · of the Winter Hearth",
    );
    expect(seasonDisplayName({ name: "Season IV", subtitle: "" })).toBe("Season IV");
  });

  it("the turn label names the day the season turns; junk reads blank", () => {
    expect(seasonTurnLabel("2026-12-01T00:00:00.000Z")).toMatch(/^Turns (Nov 30|Dec 1)$/);
    expect(seasonTurnLabel("not-a-date")).toBe("");
  });

  it("the endpoint path is the wall's one read", () => {
    expect(courtSeasonPath()).toBe("/api/world/court-season");
  });
});
