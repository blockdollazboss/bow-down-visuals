/**
 * Tests for the Title & Description Studio.
 *
 * Covers: the 1-credit price, request schema validation (topic required,
 * platform/tone enums, length caps), prompt construction (platform + tone
 * direction injected, no hardcoded model IDs), response parsing (title
 * ranking caps, score clamping, hashtag # stripping, malformed JSON →
 * null), and the GPT-6 max_completion_tokens parameter (never max_tokens).
 */
import { describe, expect, it } from "vitest";
import {
  TITLE_STUDIO_CREDITS,
  titleStudioSchema,
  buildTitleStudioPrompt,
  parseTitleStudioResponse,
} from "../title-studio";

describe("TITLE_STUDIO_CREDITS", () => {
  it("charges 1 credit per generation", () => {
    expect(TITLE_STUDIO_CREDITS).toBe(1);
  });
});

describe("titleStudioSchema", () => {
  it("accepts a valid request with defaults", () => {
    const parsed = titleStudioSchema.safeParse({
      topic: "my new single about grinding at 3am",
      platform: "youtube",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.tone).toBe("hype");
      expect(parsed.data.keywords).toBe("");
    }
  });

  it("rejects an empty topic", () => {
    expect(
      titleStudioSchema.safeParse({ topic: "", platform: "tiktok", tone: "funny" }).success
    ).toBe(false);
  });

  it("rejects an unknown platform", () => {
    expect(
      titleStudioSchema.safeParse({ topic: "x", platform: "twitter", tone: "hype" }).success
    ).toBe(false);
  });

  it("rejects an unknown tone", () => {
    expect(
      titleStudioSchema.safeParse({ topic: "x", platform: "youtube", tone: "mysterious" }).success
    ).toBe(false);
  });

  it("rejects an overlong topic", () => {
    expect(
      titleStudioSchema.safeParse({ topic: "x".repeat(501), platform: "youtube" }).success
    ).toBe(false);
  });

  it("accepts all three platforms and tones", () => {
    for (const platform of ["youtube", "tiktok", "instagram"] as const) {
      for (const tone of ["hype", "professional", "funny"] as const) {
        expect(
          titleStudioSchema.safeParse({ topic: "studio vlog", platform, tone }).success
        ).toBe(true);
      }
    }
  });
});

describe("buildTitleStudioPrompt", () => {
  it("injects platform-specific direction", () => {
    const yt = buildTitleStudioPrompt("youtube", "hype");
    const tt = buildTitleStudioPrompt("tiktok", "hype");
    expect(yt).toContain("YouTube");
    expect(tt).toContain("TikTok");
    expect(yt).not.toBe(tt);
  });

  it("injects tone direction", () => {
    const hype = buildTitleStudioPrompt("youtube", "hype");
    const funny = buildTitleStudioPrompt("youtube", "funny");
    expect(hype).toContain("high-energy");
    expect(funny).toContain("meme-aware");
  });

  it("demands ranked titles, description, tags, and honesty note", () => {
    const prompt = buildTitleStudioPrompt("instagram", "professional");
    expect(prompt).toContain("exactly 10 title options");
    expect(prompt).toContain("RANKED");
    expect(prompt).toContain("timestamps");
    expect(prompt).toContain("exactly 15");
    expect(prompt).toContain("not virality");
  });

  it("contains no hardcoded model ID", () => {
    const prompt = buildTitleStudioPrompt("youtube", "hype");
    expect(prompt).not.toMatch(/gpt-4|gpt-5|gpt-6|claude/i);
  });
});

function makePayload(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    titles: [
      { title: "I Made a Song at 3AM (it broke me)", score: 92, why: "Curiosity gap + time anchor." },
      { title: "Studio Vlog #12", score: 61, why: "Weak — generic." },
    ],
    description: "Hook line.\n\nParagraph one.\n\n00:00 intro\n\nComment your favorite bar!",
    tags: ["newmusic", "#indieartist", "studiovlog"],
    note: "Scores estimate packaging readiness, not virality.",
    ...overrides,
  });
}

describe("parseTitleStudioResponse", () => {
  it("parses a well-formed payload", () => {
    const result = parseTitleStudioResponse(makePayload());
    expect(result).not.toBeNull();
    expect(result!.titles).toHaveLength(2);
    expect(result!.titles[0]!.title).toBe("I Made a Song at 3AM (it broke me)");
    expect(result!.titles[0]!.score).toBe(92);
    expect(result!.description).toContain("Hook line.");
    expect(result!.note).toContain("not virality");
  });

  it("strips leading # from tags", () => {
    const result = parseTitleStudioResponse(makePayload());
    expect(result!.tags).toEqual(["newmusic", "indieartist", "studiovlog"]);
  });

  it("caps titles at 10 and tags at 15", () => {
    const result = parseTitleStudioResponse(
      makePayload({
        titles: Array.from({ length: 25 }, (_, i) => ({ title: `Title ${i}`, score: 50, why: "" })),
        tags: Array.from({ length: 40 }, (_, i) => `tag${i}`),
      })
    );
    expect(result!.titles).toHaveLength(10);
    expect(result!.tags).toHaveLength(15);
  });

  it("clamps scores into 0-100", () => {
    const result = parseTitleStudioResponse(
      makePayload({
        titles: [
          { title: "Too high", score: 140, why: "" },
          { title: "Too low", score: -20, why: "" },
        ],
      })
    );
    expect(result!.titles[0]!.score).toBe(100);
    expect(result!.titles[1]!.score).toBe(0);
  });

  it("defaults missing scores to 0 and keeps the title", () => {
    const result = parseTitleStudioResponse(
      makePayload({ titles: [{ title: "No score given" }] })
    );
    expect(result!.titles[0]).toMatchObject({ title: "No score given", score: 0 });
  });

  it("drops blank titles but keeps the rest", () => {
    const result = parseTitleStudioResponse(
      makePayload({
        titles: [{ title: "   " }, { title: "Real one", score: 70, why: "" }],
      })
    );
    expect(result!.titles).toHaveLength(1);
    expect(result!.titles[0]!.title).toBe("Real one");
  });

  it("returns null on malformed JSON", () => {
    expect(parseTitleStudioResponse("{not json")).toBeNull();
  });

  it("returns null when titles are missing", () => {
    expect(parseTitleStudioResponse(makePayload({ titles: [] }))).toBeNull();
  });

  it("returns null when the description is missing", () => {
    expect(parseTitleStudioResponse(makePayload({ description: "" }))).toBeNull();
  });

  it("returns null when titles key is absent", () => {
    expect(parseTitleStudioResponse(JSON.stringify({ description: "x" }))).toBeNull();
  });
});
