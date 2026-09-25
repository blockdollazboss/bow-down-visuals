import { describe, it, expect } from "vitest";
import {
  formatLyricTime,
  parseLyricTime,
  validateLineTiming,
  nudgeLine,
  countUnmatchedLines,
  splitLyricLines,
  STYLE_META,
  ALIGN_CREDITS,
  RENDER_CREDITS,
  type LyricVideoLine,
} from "../lyric-video";

function line(overrides: Partial<LyricVideoLine> = {}): LyricVideoLine {
  return {
    text: "hello world",
    startSec: 1.0,
    endSec: 1.9,
    matched: true,
    words: [
      { word: "hello", startSec: 1.0, endSec: 1.4, matched: true },
      { word: "world", startSec: 1.5, endSec: 1.9, matched: true },
    ],
    ...overrides,
  };
}

describe("formatLyricTime", () => {
  it("formats m:ss.d", () => {
    expect(formatLyricTime(0)).toBe("0:00.0");
    expect(formatLyricTime(65.5)).toBe("1:05.5");
    expect(formatLyricTime(1.85)).toBe("0:01.9");
  });

  it("clamps negatives", () => {
    expect(formatLyricTime(-3)).toBe("0:00.0");
  });
});

describe("parseLyricTime", () => {
  it("parses m:ss.d", () => {
    expect(parseLyricTime("1:05.5")).toBe(65.5);
    expect(parseLyricTime("0:01.9")).toBe(1.9);
  });

  it("parses plain seconds", () => {
    expect(parseLyricTime("90")).toBe(90);
  });

  it("returns null for garbage", () => {
    expect(parseLyricTime("abc")).toBeNull();
    expect(parseLyricTime("")).toBeNull();
    expect(parseLyricTime("-5")).toBeNull();
  });
});

describe("validateLineTiming", () => {
  it("accepts a sane line", () => {
    expect(validateLineTiming(line())).toBeNull();
  });

  it("rejects end <= start", () => {
    expect(validateLineTiming(line({ startSec: 2, endSec: 2 }))).toContain(
      "after start",
    );
    expect(validateLineTiming(line({ startSec: 3, endSec: 2 }))).toContain(
      "after start",
    );
  });
});

describe("nudgeLine", () => {
  it("shifts line and word timings together", () => {
    const nudged = nudgeLine(line(), 0.5);
    expect(nudged.startSec).toBe(1.5);
    expect(nudged.endSec).toBe(2.4);
    expect(nudged.words[0]!.startSec).toBe(1.5);
  });

  it("clamps at zero", () => {
    const nudged = nudgeLine(line(), -5);
    expect(nudged.startSec).toBe(0);
    expect(nudged.words[0]!.startSec).toBe(0);
  });
});

describe("countUnmatchedLines", () => {
  it("counts interpolated lines", () => {
    expect(
      countUnmatchedLines([line(), line({ matched: false }), line({ matched: false })]),
    ).toBe(2);
  });
});

describe("splitLyricLines", () => {
  it("drops blank lines", () => {
    expect(splitLyricLines("hello\n\n  \nworld\n")).toEqual(["hello", "world"]);
  });
});

describe("pricing + styles", () => {
  it("matches the server's credit costs", () => {
    expect(ALIGN_CREDITS).toBe(2);
    expect(RENDER_CREDITS).toBe(5);
  });

  it("covers all four style presets", () => {
    expect(Object.keys(STYLE_META)).toEqual([
      "gold-luxury",
      "neon",
      "minimal",
      "grunge",
    ]);
  });
});
