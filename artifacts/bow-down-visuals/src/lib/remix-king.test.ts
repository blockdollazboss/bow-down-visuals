/**
 * remix-king.test.ts — #152 frontend vocabulary pins: the published
 * splits only count as terms when they sum to exactly 100, and the
 * page's split preview matches the API rail's amounts exactly.
 */
import { describe, expect, it } from "vitest";
import { previewSplitAmounts, splitsArePublished, type RemixKingSplit } from "./remix-king";

const SPLITS: RemixKingSplit[] = [
  { role: "winner", payeeName: "Winning remixer", payeeUserId: null, sharePct: 50 },
  { role: "king", payeeName: "Thy Cheat Code", payeeUserId: null, sharePct: 30 },
  { role: "house", payeeName: "Bow Down Visuals", payeeUserId: null, sharePct: 20 },
];

describe("remix the king — frontend splits vocabulary", () => {
  it("published means non-empty and summing to exactly 100", () => {
    expect(splitsArePublished(SPLITS)).toBe(true);
    expect(splitsArePublished([])).toBe(false);
    expect(splitsArePublished([{ role: "winner", payeeName: "W", payeeUserId: null, sharePct: 90 }])).toBe(false);
  });

  it("preview amounts match the rail: floor + leftover, exact total", () => {
    expect(previewSplitAmounts(1000, SPLITS)).toEqual([500, 300, 200]);
    expect(previewSplitAmounts(999, SPLITS)).toEqual([500, 300, 199]);
    expect(previewSplitAmounts(0, SPLITS)).toEqual([0, 0, 0]);
  });
});
