import { describe, it, expect } from "vitest";
import {
  formatClipTimestamp,
  buildTimestampExport,
  cutCostFor,
  CUT_CREDITS_PER_CLIP,
  ANALYZE_CREDITS,
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

describe("pricing", () => {
  it("analysis costs 3 credits, cuts cost 2 per clip", () => {
    expect(ANALYZE_CREDITS).toBe(3);
    expect(CUT_CREDITS_PER_CLIP).toBe(2);
    expect(cutCostFor(0)).toBe(0);
    expect(cutCostFor(3)).toBe(6);
    expect(cutCostFor(5)).toBe(10);
  });
});
