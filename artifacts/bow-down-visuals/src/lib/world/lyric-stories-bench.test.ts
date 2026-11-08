/**
 * lyric-stories-bench — Stack 300 world parity (Lane B
 * item 10) seam pins. Per-card pricing from the registry,
 * the section's 3–5 clamp, its post body, and a card guard
 * that never lets an unpainted card dress up as a result.
 * Copy: lyricStories is new to the catalogs with this
 * bench — en values are the section's own literals; the
 * other nine carry them English-verbatim UNREVIEWED.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  LYRIC_STORIES_PATH,
  buildLyricStoriesPayload,
  clampLyricStoryCount,
  lyricStoriesInputReady,
  lyricStoriesResultOf,
  lyricStoriesTotalCost,
  lyricStoryCardCost,
} from "./lyric-stories-bench";
import { getCreditCost } from "../credit-costs";

describe("the rail + the per-card price", () => {
  it("posts where the section posts; the registry prices a card at 200", () => {
    expect(LYRIC_STORIES_PATH).toBe("/api/lyric-stories/generate");
    expect(getCreditCost(LYRIC_STORIES_PATH)?.cost).toBe(200);
    expect(lyricStoryCardCost()).toBe(200);
    expect(lyricStoriesTotalCost(3)).toBe(600);
    expect(lyricStoriesTotalCost(5)).toBe(1000);
    expect(lyricStoriesTotalCost(99)).toBe(1000); // clamped before pricing
  });

  it("clamps counts into 3–5 like the section", () => {
    expect(clampLyricStoryCount(2)).toBe(3);
    expect(clampLyricStoryCount(4)).toBe(4);
    expect(clampLyricStoryCount(6)).toBe(5);
    expect(clampLyricStoryCount(Number.NaN)).toBe(4);
  });

  it("shapes the section's post body", () => {
    expect(buildLyricStoriesPayload({ lyrics: "  la la  ", count: 9, style: " gold " })).toEqual({
      lyrics: "la la",
      count: 5,
      style: "gold",
    });
    expect(lyricStoriesInputReady("   ")).toBe(false);
    expect(lyricStoriesInputReady("words")).toBe(true);
  });
});

describe("the answer guard", () => {
  const card = { lyricExcerpt: "we ride at dawn", imageUrl: "https://x/c.png", visualDescription: "gold" };
  it("takes whole painted cards; an unpainted card is dropped, never framed", () => {
    expect(lyricStoriesResultOf({ cards: [card], partial: true })).toEqual({ cards: [card], partial: true });
    expect(
      lyricStoriesResultOf({ cards: [card, { lyricExcerpt: "lost", imageUrl: "", visualDescription: "" }] }),
    ).toEqual({ cards: [card], partial: false });
    expect(lyricStoriesResultOf({ cards: [{ lyricExcerpt: "lost", imageUrl: "" }] })).toBeNull();
    expect(lyricStoriesResultOf({ cards: [] })).toBeNull();
    expect(lyricStoriesResultOf({ cards: [{ imageUrl: "https://x/c.png" }] })).toBeNull();
  });
});

describe("the copy — the namespace, verbatim in every catalog until reviewed", () => {
  it("lyricStories rides all ten catalogs identically", () => {
    const readJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as Record<string, any>;
    const en = readJson("../../locales/en.json");
    expect(en.lyricStories.title).toBe("Lyric Stories");
    expect(en.lyricStories.generate).toContain("{{count}}");
    expect(en.lyricStories.generate).toContain("{{cost}}");
    for (const loc of ["ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"]) {
      const cat = readJson(`../../locales/${loc}.json`);
      expect(cat.lyricStories, loc).toEqual(en.lyricStories);
    }
  });
});
