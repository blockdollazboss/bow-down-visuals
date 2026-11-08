/**
 * randomizer-bench — Stack 300 world parity (Lane B item 8)
 * seam pins. The bench rolls the page's own dice: the
 * category keys are the route's enum, the free lists are
 * the page's lists verbatim (pinned against pages/hooks.tsx
 * itself so the two can never silently drift), the AI roll
 * posts the page's body at the registry's price.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  RANDOMIZER_CATEGORIES,
  RANDOMIZER_FREE_IDEAS,
  RANDOMIZER_PATH,
  buildRandomizerPayload,
  freeRollIdea,
  pickRandomIdea,
  randomizerCost,
  randomizerIdeasOf,
} from "./randomizer-bench";
import { getCreditCost } from "../credit-costs";

describe("the rail + the price", () => {
  it("posts where the page posts, at the registry's 100", () => {
    expect(RANDOMIZER_PATH).toBe("/api/randomizer");
    expect(getCreditCost(RANDOMIZER_PATH)?.cost).toBe(100);
    expect(randomizerCost()).toBe(100);
    expect(buildRandomizerPayload("hooks")).toEqual({ category: "hooks" });
  });

  it("carries the route's category enum verbatim", () => {
    expect(RANDOMIZER_CATEGORIES).toEqual([
      "video-ideas",
      "hooks",
      "thumbnails",
      "song-concepts",
      "niche-picker",
      "challenges",
    ]);
  });
});

describe("the free lists — the page's own dice", () => {
  it("every category carries the page's 12 ideas, verbatim in hooks.tsx", () => {
    const page = readFileSync(new URL("../../pages/hooks.tsx", import.meta.url), "utf8");
    for (const cat of RANDOMIZER_CATEGORIES) {
      const list = RANDOMIZER_FREE_IDEAS[cat];
      expect(list, cat).toHaveLength(12);
      for (const idea of list) {
        expect(page, `${cat}: ${idea.slice(0, 40)}`).toContain(idea);
      }
    }
  });

  it("a free roll never repeats the current idea when the list has more", () => {
    const rolls = [0, 0, 0.5];
    let i = 0;
    const roll = () => rolls[Math.min(i++, rolls.length - 1)];
    const list = RANDOMIZER_FREE_IDEAS.hooks;
    const pick = pickRandomIdea(list, list[0], roll);
    expect(pick).toBe(list[6]);
    expect(RANDOMIZER_FREE_IDEAS.challenges).toContain(freeRollIdea("challenges"));
  });
});

describe("the AI answer guard", () => {
  it("takes a non-empty string list and nothing else", () => {
    expect(randomizerIdeasOf({ ideas: ["a", "b"] })).toEqual(["a", "b"]);
    expect(randomizerIdeasOf({ ideas: [] })).toBeNull();
    expect(randomizerIdeasOf({ ideas: [1, 2] })).toBeNull();
    expect(randomizerIdeasOf({})).toBeNull();
    expect(randomizerIdeasOf(null)).toBeNull();
  });
});
