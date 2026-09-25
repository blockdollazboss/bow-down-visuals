/**
 * Tests for the Collab Finder endpoints' pure logic.
 *
 * Covers: 1-credit match pricing, request validation schemas, the AI match
 * prompt builder (injection capping), the match-report JSON parser (good,
 * malformed, and empty outputs), and follower-count formatting.
 */
import { describe, expect, it } from "vitest";
import {
  COLLAB_MATCH_CREDITS,
  buildMatchPrompt,
  parseMatchJson,
  formatFollowers,
  isCollabNicheKey,
  isCollabPlatformKey,
  COLLAB_NICHES,
  COLLAB_PLATFORMS,
} from "../collabs";

describe("COLLAB_MATCH_CREDITS", () => {
  it("charges 1 credit per AI match report", () => {
    expect(COLLAB_MATCH_CREDITS).toBe(1);
  });
});

describe("niche / platform keys", () => {
  it("accepts known niches", () => {
    expect(isCollabNicheKey("music")).toBe(true);
    expect(isCollabNicheKey("gaming")).toBe(true);
  });

  it("rejects unknown niches", () => {
    expect(isCollabNicheKey("astronaut")).toBe(false);
    expect(isCollabNicheKey("")).toBe(false);
    expect(isCollabNicheKey(undefined)).toBe(false);
  });

  it("accepts known platforms", () => {
    expect(isCollabPlatformKey("tiktok")).toBe(true);
    expect(isCollabPlatformKey("youtube")).toBe(true);
  });

  it("rejects unknown platforms", () => {
    expect(isCollabPlatformKey("myspace")).toBe(false);
  });

  it("has a non-empty niche and platform list", () => {
    expect(COLLAB_NICHES.length).toBeGreaterThan(5);
    expect(COLLAB_PLATFORMS.length).toBeGreaterThan(3);
  });
});

describe("formatFollowers", () => {
  it("formats thousands and millions", () => {
    expect(formatFollowers(500)).toBe("500");
    expect(formatFollowers(1500)).toBe("1.5K");
    expect(formatFollowers(12000)).toBe("12K");
    expect(formatFollowers(2500000)).toBe("2.5M");
  });

  it("drops trailing .0", () => {
    expect(formatFollowers(2000)).toBe("2K");
    expect(formatFollowers(1000000)).toBe("1M");
  });
});

const me = {
  displayName: "Shark Beats",
  niche: "music",
  platforms: [{ platform: "tiktok", followers: 50000 }],
  collabInterests: "Looking for vocalists for hooks",
  bio: "Producer making dark trap beats",
};

const them = {
  displayName: "Vox Queen",
  niche: "music",
  platforms: [{ platform: "instagram", followers: 80000 }],
  collabInterests: "Want beats for my next EP",
  bio: "Singer-songwriter",
};

describe("buildMatchPrompt", () => {
  it("includes both creators' key facts", () => {
    const p = buildMatchPrompt(me, them);
    expect(p).toContain("Shark Beats");
    expect(p).toContain("Vox Queen");
    expect(p).toContain("50K");
    expect(p).toContain("80K");
  });

  it("caps long fields (injection hygiene)", () => {
    const evil = {
      ...me,
      bio: "x".repeat(5000),
      collabInterests: "y".repeat(5000),
      displayName: "z".repeat(5000),
    };
    const p = buildMatchPrompt(evil, them);
    expect(p.length).toBeLessThan(3000);
    expect(p).not.toContain("x".repeat(501));
  });

  it("handles creators with no platforms listed", () => {
    const p = buildMatchPrompt({ ...me, platforms: [] }, them);
    expect(p).toContain("none listed");
  });
});

describe("parseMatchJson", () => {
  const good = JSON.stringify({
    score: 87,
    verdict: "Great fit — complementary audiences.",
    strengths: ["Same niche", "Similar size"],
    risks: ["Different time zones"],
    ideas: ["Joint EP", "Live beat battle", "Remix swap"],
  });

  it("parses a well-formed report", () => {
    const r = parseMatchJson(good);
    expect(r).not.toBeNull();
    expect(r!.score).toBe(87);
    expect(r!.verdict).toContain("Great fit");
    expect(r!.strengths).toHaveLength(2);
    expect(r!.ideas).toHaveLength(3);
  });

  it("clamps the score to 0-100", () => {
    const r = parseMatchJson(JSON.stringify({ score: 150, verdict: "ok", strengths: [], risks: [], ideas: [] }));
    expect(r!.score).toBe(100);
    const r2 = parseMatchJson(JSON.stringify({ score: -5, verdict: "ok", strengths: [], risks: [], ideas: [] }));
    expect(r2!.score).toBe(0);
  });

  it("returns null on malformed JSON", () => {
    expect(parseMatchJson("not json at all")).toBeNull();
    expect(parseMatchJson("")).toBeNull();
  });

  it("returns null when score or verdict is missing", () => {
    expect(parseMatchJson(JSON.stringify({ verdict: "ok" }))).toBeNull();
    expect(parseMatchJson(JSON.stringify({ score: 50 }))).toBeNull();
  });

  it("strips non-string list entries and caps length", () => {
    const r = parseMatchJson(
      JSON.stringify({
        score: 60,
        verdict: "Solid",
        strengths: ["good", 42, null, "  ", "x".repeat(999)],
        risks: [],
        ideas: [],
      }),
    );
    expect(r!.strengths).toEqual(["good", "x".repeat(300)]);
  });
});
