import { describe, it, expect } from "vitest";
import {
  LOOK_RAIL_KEYS,
  applicableLookClauses,
  composeLookContextText,
  normalizeLookPicks,
  sceneLookPicksSchema,
  weaveLookIntoPrompt,
} from "../scene-look";

/* Server mirror of the frontend composer (artifacts/bow-down-visuals/src/lib/
   scene-look.ts). The key lists pinned here are pinned identically in the
   frontend tests — changing one side without the other fails a suite. */

describe("vocabularies — exact key lists (mirror-pinned)", () => {
  it("pins every rail's keys", () => {
    expect(LOOK_RAIL_KEYS).toEqual({
      genre: ["drama", "noir", "documentary", "commercial", "horror", "romance", "action", "musicVideo"],
      era: ["contemporary", "seventies", "eighties", "nineties", "period", "futuristic"],
      lens: ["natural35", "portrait50", "tele85", "wide24", "anamorphic", "macro"],
      lighting: ["goldenHour", "neonNight", "softWindow", "hardNoon", "candlelit", "studioThreePoint", "overcast"],
      emotion: ["calm", "tense", "euphoric", "melancholic", "urgent"],
    });
  });

  it("the wire schema accepts valid picks, rejects bad keys, strips unknown rails", () => {
    expect(sceneLookPicksSchema.safeParse({ genre: "noir", lens: "tele85" }).success).toBe(true);
    expect(sceneLookPicksSchema.safeParse({ genre: "western" }).success).toBe(false);
    const stripped = sceneLookPicksSchema.safeParse({ aperture: "f1.8", genre: "noir" });
    expect(stripped.success).toBe(true);
    if (stripped.success) expect(stripped.data).toEqual({ genre: "noir" });
  });

  it("normalizeLookPicks drops unknown rails/keys from untrusted data", () => {
    expect(
      normalizeLookPicks({ genre: "noir", era: "1890s", lens: "tele85", mood: "sad", emotion: 42 }),
    ).toEqual({ genre: "noir", lens: "tele85" });
    expect(normalizeLookPicks(null)).toEqual({});
    expect(normalizeLookPicks("noir")).toEqual({});
    expect(normalizeLookPicks(undefined)).toEqual({});
  });
});

describe("weaveLookIntoPrompt — the locked-pack path", () => {
  it("returns the base byte-identical when there are no picks", () => {
    const base = "The artist steps out of a vintage car, slow dolly-in.";
    expect(weaveLookIntoPrompt(base, {})).toBe(base);
    expect(weaveLookIntoPrompt(base, { look: {} })).toBe(base);
    expect(weaveLookIntoPrompt(base, { look: { genre: "western" } })).toBe(base);
  });

  it("weaves the picks onto the locked prompt as a new sentence", () => {
    const out = weaveLookIntoPrompt("The artist steps out of a vintage car.", {
      look: { genre: "noir", lighting: "neonNight" },
    });
    expect(out).toBe(
      "The artist steps out of a vintage car. Film noir style, neon night light with saturated reflections.",
    );
  });

  it("dedupes against the locked prompt's own words", () => {
    const base = "A neon-drenched alley chase, anamorphic streaks everywhere";
    const out = weaveLookIntoPrompt(base, { look: { lighting: "neonNight", lens: "anamorphic" } });
    expect(out).toBe(base);
  });
});

describe("composeLookContextText — the improve-prompt context line", () => {
  it("is empty with no picks", () => {
    expect(composeLookContextText({ action: "performs" })).toBe("");
    expect(composeLookContextText({ action: "performs", look: {} })).toBe("");
  });

  it("lists the surviving picks as phrases in rail order", () => {
    expect(
      composeLookContextText({
        aiVideoPrompt: "rooftop performance",
        look: { emotion: "tense", genre: "noir", lighting: "goldenHour" },
      }),
    ).toBe("film noir style; golden-hour light with warm low sun; tense, suspenseful pacing");
  });

  it("honors free-text precedence: a written Lighting field hides the lighting pick", () => {
    const text = composeLookContextText({
      aiVideoPrompt: "rooftop performance",
      lighting: "harsh fluorescent green",
      look: { lighting: "goldenHour", genre: "noir" },
    });
    expect(text).toBe("film noir style");
  });

  it("honors free-text precedence for Mood vs the emotion pick", () => {
    const text = composeLookContextText({
      action: "stares out the train window",
      mood: "quietly hopeful",
      look: { emotion: "melancholic", era: "nineties" },
    });
    expect(text).toBe("1990s period styling");
  });
});

describe("applicableLookClauses", () => {
  it("returns clauses in rail order regardless of pick object order", () => {
    const clauses = applicableLookClauses(
      { look: { emotion: "calm", genre: "drama" } },
      "a quiet performance",
    );
    expect(clauses.map((c) => c.rail)).toEqual(["genre", "emotion"]);
  });
});
