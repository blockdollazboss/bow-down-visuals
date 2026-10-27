import { describe, it, expect } from "vitest";
import { parseLrc, activeLyricIndex, formatLyricTime } from "./karaoke";

describe("karaoke FE helpers", () => {
  it("parses LRC stamps into sorted timed lines", () => {
    const lines = parseLrc("[0:12.50] second line\n[0:05] first line\nnot timed");
    expect(lines).toEqual([
      { startSec: 5, text: "first line" },
      { startSec: 12.5, text: "second line" },
    ]);
    expect(parseLrc("")).toEqual([]);
  });

  it("tracks the active line as playback moves", () => {
    const lines = parseLrc("[0:05] one\n[0:12] two");
    expect(activeLyricIndex(lines, 0)).toBe(-1);
    expect(activeLyricIndex(lines, 5)).toBe(0);
    expect(activeLyricIndex(lines, 11.9)).toBe(0);
    expect(activeLyricIndex(lines, 12)).toBe(1);
  });

  it("formats times as m:ss", () => {
    expect(formatLyricTime(0)).toBe("0:00");
    expect(formatLyricTime(75)).toBe("1:15");
  });
});
