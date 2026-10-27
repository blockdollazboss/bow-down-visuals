/**
 * Karaoke Mode (N9) — timed-lyrics rules. The lit lyrics are the song's
 * OWN: a timed line whose words do not appear in the song's lyrics fails
 * the whole set, so a wrong lyric can never light up.
 */
import { describe, it, expect } from "vitest";
import {
  parseLrc,
  lyricLineMatches,
  validateTimedLyrics,
  activeLyricIndex,
} from "../karaoke-lyrics";

const LYRICS = "Shine bright over the city lights\nWe ride until the morning comes";
const LRC = "[0:05] Shine bright over the city lights\n[00:12.50] We ride until the morning comes";

describe("karaoke parseLrc", () => {
  it("parses [m:ss] and [mm:ss.xx] stamps into sorted seconds", () => {
    const lines = parseLrc(LRC);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toEqual({ startSec: 5, text: "Shine bright over the city lights" });
    expect(lines[1]).toEqual({ startSec: 12.5, text: "We ride until the morning comes" });
    const unsorted = parseLrc("[0:20] later\n[0:01] earlier");
    expect(unsorted.map((l) => l.text)).toEqual(["earlier", "later"]);
  });

  it("ignores untimed and empty lines", () => {
    expect(parseLrc("just some words\n[0:03] \n\n[ti:Title]")).toHaveLength(0);
    expect(parseLrc("")).toEqual([]);
  });
});

describe("karaoke lyric matching", () => {
  it("matches a line whose words appear in order in the song's lyrics", () => {
    expect(lyricLineMatches("Shine bright over the city lights", LYRICS)).toBe(true);
    expect(lyricLineMatches("shine BRIGHT over the city lights!", LYRICS)).toBe(true);
    expect(lyricLineMatches("We ride until the morning comes", LYRICS)).toBe(true);
  });

  it("rejects words the artist never wrote", () => {
    expect(lyricLineMatches("Shine bright under the ocean waves", LYRICS)).toBe(false);
    expect(lyricLineMatches("", LYRICS)).toBe(false);
  });
});

describe("karaoke validateTimedLyrics", () => {
  it("accepts a set whose lines all match the song's lyrics", () => {
    const v = validateTimedLyrics(LRC, LYRICS);
    expect(v.ok).toBe(true);
    expect(v.lines).toHaveLength(2);
    expect(v.errors).toEqual([]);
  });

  it("one wrong line fails the whole set", () => {
    const bad = "[0:05] Shine bright over the city lights\n[0:12] Totally different words here";
    const v = validateTimedLyrics(bad, LYRICS);
    expect(v.ok).toBe(false);
    expect(v.errors.length).toBeGreaterThan(0);
  });

  it("needs at least two timed lines", () => {
    const v = validateTimedLyrics("[0:05] Shine bright over the city lights", LYRICS);
    expect(v.ok).toBe(false);
  });

  it("with no stored song lyrics, the artist's timed set stands as the record", () => {
    const v = validateTimedLyrics(LRC, null);
    expect(v.ok).toBe(true);
    expect(validateTimedLyrics(LRC, "  ").ok).toBe(true);
  });
});

describe("karaoke activeLyricIndex", () => {
  const lines = parseLrc(LRC);
  it("is -1 before the first line, then tracks the latest started line", () => {
    expect(activeLyricIndex(lines, 0)).toBe(-1);
    expect(activeLyricIndex(lines, 5)).toBe(0);
    expect(activeLyricIndex(lines, 12.4)).toBe(0);
    expect(activeLyricIndex(lines, 12.5)).toBe(1);
    expect(activeLyricIndex(lines, 999)).toBe(1);
  });
});
