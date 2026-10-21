/**
 * Unit tests for lib/for-you-discovery — the For-You v1 ranking law
 * for GET /discovery/feed (Wave 3 #19): affinity weights, the capped
 * score, discovery qualification, the bounded share, and the honest
 * per-item "why" (present only when a real signal earned it, naming
 * the actual dominant signal).
 */
import { describe, it, expect } from "vitest";
import {
  discoveryAffinityScore,
  discoveryEventTotal,
  dominantSignal,
  discoveryFeedScore,
  discoveryQualifies,
  discoveryCap,
  discoveryWhy,
  DISCOVERY_AFFINITY_WEIGHTS,
  FOLLOW_BOOST,
  CREATOR_AFFINITY_CAP,
  GENRE_AFFINITY_CAP,
  type DiscoveryAffinityCounts,
} from "../../lib/for-you-discovery";

const counts = (p: Partial<DiscoveryAffinityCounts>): DiscoveryAffinityCounts => ({
  play: 0,
  like: 0,
  save: 0,
  reaction: 0,
  repost: 0,
  ...p,
});

const NOW = 1_760_000_000_000;
const H = 3600_000;

describe("discoveryAffinityScore — the named weights", () => {
  it("weights each recorded signal exactly as the header law says", () => {
    expect(discoveryAffinityScore(counts({ play: 1 }))).toBe(DISCOVERY_AFFINITY_WEIGHTS.play);
    expect(discoveryAffinityScore(counts({ like: 1 }))).toBe(DISCOVERY_AFFINITY_WEIGHTS.like);
    expect(discoveryAffinityScore(counts({ save: 1 }))).toBe(DISCOVERY_AFFINITY_WEIGHTS.save);
    expect(discoveryAffinityScore(counts({ reaction: 1 }))).toBe(DISCOVERY_AFFINITY_WEIGHTS.reaction);
    expect(discoveryAffinityScore(counts({ repost: 1 }))).toBe(DISCOVERY_AFFINITY_WEIGHTS.repost);
    expect(discoveryAffinityScore(counts({ play: 10, like: 5, save: 3 }))).toBe(10 + 10 + 9);
    expect(discoveryAffinityScore(counts({}))).toBe(0);
  });

  it("discoveryEventTotal counts raw events, not weighted points (the cold-start probe)", () => {
    expect(discoveryEventTotal(counts({ play: 2, save: 1 }))).toBe(3);
    expect(discoveryEventTotal(counts({}))).toBe(0);
  });
});

describe("dominantSignal — the signal the why line must name", () => {
  it("is null when the viewer never engaged", () => {
    expect(dominantSignal(counts({}))).toBeNull();
  });
  it("picks the largest weighted contribution", () => {
    expect(dominantSignal(counts({ play: 3, like: 1 }))).toBe("play"); // 3 > 2
    expect(dominantSignal(counts({ play: 1, like: 2 }))).toBe("like"); // 4 > 1
    expect(dominantSignal(counts({ play: 9, save: 4 }))).toBe("save"); // 12 > 9
  });
  it("breaks ties toward the stronger-commitment signal", () => {
    expect(dominantSignal(counts({ play: 3, save: 1 }))).toBe("save"); // 3 = 3 → save
    expect(dominantSignal(counts({ save: 1, repost: 1 }))).toBe("repost"); // 3 = 3 → repost
    expect(dominantSignal(counts({ like: 3, reaction: 2 }))).toBe("reaction"); // 6 = 6 → reaction
  });
});

describe("discoveryFeedScore — recency backbone, capped affinity pull", () => {
  const base = { isFollowed: true, creatorAffinity: 0, genreAffinity: 0, createdAtMs: NOW };

  it("following is worth exactly FOLLOW_BOOST over an identical non-followed item", () => {
    const followed = discoveryFeedScore(base, NOW);
    const stranger = discoveryFeedScore({ ...base, isFollowed: false }, NOW);
    expect(followed - stranger).toBe(FOLLOW_BOOST);
  });

  it("affinity raises the score — and caps at CREATOR_AFFINITY_CAP", () => {
    expect(discoveryFeedScore({ ...base, creatorAffinity: 10 }, NOW)).toBeGreaterThan(discoveryFeedScore(base, NOW));
    expect(discoveryFeedScore({ ...base, creatorAffinity: CREATOR_AFFINITY_CAP }, NOW)).toBe(
      discoveryFeedScore({ ...base, creatorAffinity: 10_000 }, NOW),
    );
  });

  it("genre affinity counts at half weight, capped at GENRE_AFFINITY_CAP", () => {
    const at20 = discoveryFeedScore({ ...base, genreAffinity: 20 }, NOW);
    const at2000 = discoveryFeedScore({ ...base, genreAffinity: 2000 }, NOW);
    expect(at20).toBe(discoveryFeedScore(base, NOW) + GENRE_AFFINITY_CAP * 0.5);
    expect(at2000).toBe(at20);
  });

  it("age costs 1 point per hour — affinity pulls forward, never infinitely", () => {
    const fresh = discoveryFeedScore(base, NOW);
    const dayOld = discoveryFeedScore({ ...base, createdAtMs: NOW - 24 * H }, NOW);
    expect(fresh - dayOld).toBe(24);
    /* A max-affinity week-old followed drop cannot bury a brand-new one. */
    const oldBeloved = discoveryFeedScore(
      { ...base, creatorAffinity: 10_000, genreAffinity: 10_000, createdAtMs: NOW - 7 * 24 * H },
      NOW,
    );
    expect(oldBeloved).toBeLessThan(fresh);
  });
});

describe("discoveryQualifies — a non-followed creator must be earned", () => {
  it("creator leg: affinity at the threshold qualifies, below it doesn't", () => {
    expect(discoveryQualifies({ creatorAffinity: 3, genreAffinity: 0 })).toBe("creator");
    expect(discoveryQualifies({ creatorAffinity: 2, genreAffinity: 0 })).toBeNull();
  });
  it("genre leg: needs the deeper habit, and the creator leg wins ties", () => {
    expect(discoveryQualifies({ creatorAffinity: 0, genreAffinity: 12 })).toBe("genre");
    expect(discoveryQualifies({ creatorAffinity: 0, genreAffinity: 11 })).toBeNull();
    expect(discoveryQualifies({ creatorAffinity: 5, genreAffinity: 50 })).toBe("creator");
  });
});

describe("discoveryCap — the bounded share", () => {
  it("is a floored quarter of the returned limit", () => {
    expect(discoveryCap(40)).toBe(10);
    expect(discoveryCap(20)).toBe(5);
    expect(discoveryCap(50)).toBe(12);
    expect(discoveryCap(4)).toBe(1);
  });
});

describe("discoveryWhy — a reason only when a signal earned it", () => {
  const base = {
    isDiscovery: false,
    movedUp: false,
    dominant: null as null,
    creatorName: "Cara",
    genre: "soul" as string | null,
    viaGenre: false,
  };

  it("an ordinary followed drop in its recency place gets NO why", () => {
    expect(discoveryWhy({ ...base, dominant: "play" as const })).toBeNull();
  });

  it("a surfaced discovery item always explains itself, naming the dominant signal", () => {
    expect(discoveryWhy({ ...base, isDiscovery: true, dominant: "play" as const })).toEqual({
      kind: "affinity-creator",
      label: "Because you play Cara",
    });
    expect(discoveryWhy({ ...base, isDiscovery: true, dominant: "save" as const })?.label).toBe(
      "Because you save Cara's drops",
    );
    expect(discoveryWhy({ ...base, isDiscovery: true, dominant: "like" as const })?.label).toBe(
      "Because you like Cara's drops",
    );
    expect(discoveryWhy({ ...base, isDiscovery: true, dominant: "repost" as const })?.label).toBe(
      "Because you repost Cara",
    );
    expect(discoveryWhy({ ...base, isDiscovery: true, dominant: "reaction" as const })?.label).toBe(
      "Because you react to Cara",
    );
  });

  it("possessive handles names ending in s", () => {
    expect(
      discoveryWhy({ ...base, isDiscovery: true, dominant: "like" as const, creatorName: "James" })?.label,
    ).toBe("Because you like James' drops");
  });

  it("a followed drop affinity pulled up explains the pull", () => {
    expect(discoveryWhy({ ...base, movedUp: true, dominant: "play" as const })).toEqual({
      kind: "affinity-creator",
      label: "Because you play Cara",
    });
  });

  it("the genre leg names the genre, not a creator the viewer never engaged", () => {
    expect(discoveryWhy({ ...base, isDiscovery: true, viaGenre: true, dominant: "play" as const })).toEqual({
      kind: "affinity-genre",
      label: "Because you play a lot of soul",
    });
  });

  it("no dominant signal and no genre leg — no fabricated reason", () => {
    expect(discoveryWhy({ ...base, isDiscovery: true, dominant: null, genre: null })).toBeNull();
  });
});
