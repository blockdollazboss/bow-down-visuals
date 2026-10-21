/**
 * Creator Room evolution — client dressing (creator-room-tier)
 * + the DTO parse + wiring pins (Ring 3, Phase 5).
 *
 * Pinned: the ladder's NAMES never live client-side — they arrive
 * on the DTO from lib/creator-rank. This module owns only the
 * look (a six-step gold progression, clamped), the star row, and
 * the lines. An unmeasured room (evolution null — the server
 * couldn't read the rank) gets NO dressing and NO line: a tier is
 * never fabricated. A malformed evolution at the fetch boundary
 * (stars off the ladder, no name) parses to null the same way.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CREATOR_TIER_TRIMS,
  creatorRoomTierDressing,
  creatorRoomStars,
  creatorRoomRankLine,
  creatorRoomEvolutionLine,
} from "./creator-room-tier";
import {
  parseCreatorRoomEvolution,
  parseCreatorRoomDetail,
  parseCreatorRoomDirectory,
  type CreatorRoomEvolution,
} from "./creator-rooms";

const EVO: CreatorRoomEvolution = {
  stars: 3,
  tierName: "Gangster",
  nextTierName: "Shot Caller",
  pointsNeeded: 120,
};

describe("the tier dressing", () => {
  it("six tiers, six distinct trims, warming in order", () => {
    expect(CREATOR_TIER_TRIMS).toHaveLength(6);
    expect(new Set(CREATOR_TIER_TRIMS).size).toBe(6);
    for (let stars = 1; stars <= 6; stars++) {
      expect(creatorRoomTierDressing(stars).tierIndex).toBe(stars - 1);
      expect(creatorRoomTierDressing(stars).trimHex).toBe(CREATOR_TIER_TRIMS[stars - 1]);
    }
  });

  it("clamps out-of-range counts to the nearest real rung", () => {
    expect(creatorRoomTierDressing(0).tierIndex).toBe(0);
    expect(creatorRoomTierDressing(42).tierIndex).toBe(5);
  });

  it("the star row repeats the earned count", () => {
    expect(creatorRoomStars(1)).toBe("★");
    expect(creatorRoomStars(4)).toBe("★★★★");
    expect(creatorRoomStars(6)).toBe("★★★★★★");
  });
});

describe("the lines", () => {
  it("the rank line is stars + the DTO's own rung name", () => {
    expect(creatorRoomRankLine(EVO)).toBe("★★★ Gangster");
    expect(creatorRoomRankLine(null)).toBeNull();
  });

  it("the evolution line names the next rung + points; the top says so; unmeasured is silent", () => {
    expect(creatorRoomEvolutionLine(EVO)).toBe("★★★ Gangster — next: Shot Caller · 120 pts to go");
    expect(
      creatorRoomEvolutionLine({ stars: 6, tierName: "Kingpin", nextTierName: null, pointsNeeded: null }),
    ).toBe("★★★★★★ Kingpin — the top of the ladder");
    expect(
      creatorRoomEvolutionLine({ stars: 2, tierName: "Hustler", nextTierName: "Gangster", pointsNeeded: null }),
    ).toBe("★★ Hustler — next: Gangster");
    expect(creatorRoomEvolutionLine(null)).toBeNull();
  });
});

describe("the boundary parse", () => {
  it("a well-formed evolution parses; off-ladder or nameless shapes read unmeasured", () => {
    expect(parseCreatorRoomEvolution(EVO)).toEqual(EVO);
    expect(parseCreatorRoomEvolution({ stars: 7, tierName: "God" })).toBeNull();
    expect(parseCreatorRoomEvolution({ stars: 0, tierName: "Nobody" })).toBeNull();
    expect(parseCreatorRoomEvolution({ stars: 2 })).toBeNull();
    expect(parseCreatorRoomEvolution(null)).toBeNull();
    expect(parseCreatorRoomEvolution("★★")).toBeNull();
  });

  it("directory + detail payloads carry the evolution through", () => {
    const dir = parseCreatorRoomDirectory({
      rooms: [
        {
          slug: "nova",
          displayName: "Nova",
          roomName: "Nova's Room",
          theme: null,
          hasContent: true,
          occupantCount: 0,
          evolution: EVO,
        },
      ],
    });
    expect(dir[0]?.evolution).toEqual(EVO);
    const detail = parseCreatorRoomDetail({
      room: { slug: "nova", displayName: "Nova", evolution: EVO },
    });
    expect(detail?.evolution).toEqual(EVO);
    const bare = parseCreatorRoomDetail({ room: { slug: "nova", displayName: "Nova" } });
    expect(bare?.evolution).toBeNull();
  });
});

describe("wiring pins", () => {
  const page = readFileSync(resolve(__dirname, "../../pages/world.tsx"), "utf8");
  const scene = readFileSync(resolve(__dirname, "./hall-scene.ts"), "utf8");
  const rooms = readFileSync(
    resolve(__dirname, "../../components/world/native/CreatorRooms.tsx"),
    "utf8",
  );

  it("the page dresses the room with the rank line + tier trim off the detail DTO", () => {
    expect(page).toContain("creatorRoomRankLine(detail.evolution)");
    expect(page).toContain("creatorRoomTierDressing(detail.evolution.stars)");
  });

  it("the scene lays a rank plate + tier trim bar in the dressing", () => {
    expect(scene).toContain("d.rankLine");
    expect(scene).toContain("d.tierTrimHex");
  });

  it("the panels show the evolution line in the directory + the room stations", () => {
    expect(rooms).toContain('data-testid="world-creator-room-evolution"');
    expect(rooms).toContain('data-testid="world-creator-room-station-evolution"');
    expect(rooms).toContain("creatorRoomEvolutionLine");
  });
});
