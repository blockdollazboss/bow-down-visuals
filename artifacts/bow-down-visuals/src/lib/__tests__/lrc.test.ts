import { describe, it, expect } from "vitest";
import {
  formatLrcTime,
  parseLrcTag,
  isLyricSectionHeader,
  splitLrcLines,
  buildLrc,
  validateLrc,
  fromAlignedLines,
  sanitizeLrcFilename,
} from "../lrc";

describe("formatLrcTime", () => {
  it("formats [mm:ss.xx] with centiseconds", () => {
    expect(formatLrcTime(0)).toBe("[00:00.00]");
    expect(formatLrcTime(65.5)).toBe("[01:05.50]");
    expect(formatLrcTime(1.856)).toBe("[00:01.85]");
    expect(formatLrcTime(600)).toBe("[10:00.00]");
  });

  it("clamps negatives and non-finite values", () => {
    expect(formatLrcTime(-3)).toBe("[00:00.00]");
    expect(formatLrcTime(NaN)).toBe("[00:00.00]");
  });
});

describe("parseLrcTag", () => {
  it("parses [mm:ss.xx] tags", () => {
    expect(parseLrcTag("[01:05.50]hello")).toBe(65.5);
    expect(parseLrcTag("[10:00.00]")).toBe(600);
  });

  it("rejects malformed tags", () => {
    expect(parseLrcTag("no tag here")).toBeNull();
    expect(parseLrcTag("[1:5.5]")).toBeNull(); // needs 2-digit fields
    expect(parseLrcTag("[ti:Title]")).toBeNull(); // header tags are not time tags
  });
});

describe("splitLrcLines", () => {
  it("drops blanks and section headers", () => {
    const lines = splitLrcLines("Verse 1\n\n  first line  \n[Chorus]\nchorus line\nHook\n");
    expect(lines).toEqual(["first line", "chorus line"]);
  });
});

describe("buildLrc + validateLrc round-trip", () => {
  const timed = [
    { text: "First line", startSec: 1.2 },
    { text: "Second line", startSec: 5.67 },
  ];

  it("builds a valid LRC document with headers", () => {
    const lrc = buildLrc(timed, { title: "My Song", artist: "Me", lengthSec: 180 });
    expect(lrc).toContain("[ti:My Song]");
    expect(lrc).toContain("[ar:Me]");
    expect(lrc).toContain("[length:03:00]");
    expect(lrc).toContain("[by:Bow Down Visuals]");
    expect(lrc).toContain("[00:01.20]First line");
    expect(lrc).toContain("[00:05.67]Second line");
    expect(validateLrc(lrc).ok).toBe(true);
  });

  it("skips section headers in the body", () => {
    const lrc = buildLrc([{ text: "Chorus", startSec: 1 }, { text: "sing this", startSec: 2 }], {});
    expect(lrc).not.toContain("]Chorus\n");
    expect(validateLrc(lrc).ok).toBe(true);
  });

  it("flags missing timestamps and backwards time", () => {
    const bad = validateLrc("[ti:X]\nplain line with no time\n[00:05.00]later\n[00:02.00]earlier\n");
    expect(bad.ok).toBe(false);
    expect(bad.errors.some((e) => /needs a valid/.test(e))).toBe(true);
    expect(bad.errors.some((e) => /backwards/.test(e))).toBe(true);
  });

  it("rejects an empty document", () => {
    const v = validateLrc("[ti:Empty]\n\n");
    expect(v.ok).toBe(false);
    expect(v.timedLineCount).toBe(0);
  });
});

describe("fromAlignedLines", () => {
  it("maps aligned lines to timed lines, trimming text", () => {
    expect(fromAlignedLines([{ text: "  hi  ", startSec: 2 }, { text: "", startSec: 3 }])).toEqual([
      { text: "hi", startSec: 2 },
    ]);
  });
});

describe("sanitizeLrcFilename", () => {
  it("strips illegal filename characters", () => {
    expect(sanitizeLrcFilename('A/B: "Hit" <song>')).toBe('AB "Hit" song'.replace(/"/g, ""));
    expect(sanitizeLrcFilename("")).toBe("synced-lyrics");
  });
});
