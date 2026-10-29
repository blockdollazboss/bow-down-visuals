import { describe, it, expect } from "vitest";
import {
  formatClipTimestamp,
  buildTimestampExport,
} from "./clip-maker";

describe("formatClipTimestamp", () => {
  it("formats seconds as mm:ss", () => {
    expect(formatClipTimestamp(0)).toBe("00:00");
    expect(formatClipTimestamp(61.5)).toBe("01:01");
    expect(formatClipTimestamp(3600)).toBe("60:00");
  });
  it("clamps negatives", () => {
    expect(formatClipTimestamp(-10)).toBe("00:00");
  });
});

describe("buildTimestampExport", () => {
  it("renders one line per highlight", () => {
    const out = buildTimestampExport([
      { id: "a", startSec: 61, endSec: 91, title: "Clutch win" },
      { id: "b", startSec: 200, endSec: 230, title: "Funny fail" },
    ]);
    expect(out).toBe("01:01–01:31  Clutch win\n03:20–03:50  Funny fail");
  });
  it("handles empty selection", () => {
    expect(buildTimestampExport([])).toBe("No highlights selected.");
  });
});
