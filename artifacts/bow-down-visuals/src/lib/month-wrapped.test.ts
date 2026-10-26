/**
 * month-wrapped.test.ts — idea #170 client contract: the card renders
 * exactly the metrics the server sent; absent metrics never appear;
 * share text never invents a number (or a dollar figure).
 */
import { describe, expect, it } from "vitest";
import {
  buildMonthWrappedShareText,
  monthWrappedMetrics,
  type MonthWrappedRecap,
} from "./month-wrapped";

function recap(overrides: Partial<MonthWrappedRecap> = {}): MonthWrappedRecap {
  return {
    month: "2026-09",
    monthLabel: "September 2026",
    periodComplete: true,
    displayName: "Test Creator",
    slug: "test-creator",
    plays: 120,
    newFans: 14,
    salesCount: 3,
    salesCreatorCents: 4500,
    newReleases: 2,
    bestMoment: { kind: "track", mediaId: "m1", title: "First Song", plays: 70 },
    hasActivity: true,
    ...overrides,
  };
}

describe("monthWrappedMetrics", () => {
  it("shows every measured metric in order", () => {
    expect(monthWrappedMetrics(recap()).map((m) => m.key)).toEqual([
      "plays",
      "newFans",
      "sales",
      "newReleases",
    ]);
  });

  it("omits metrics the server did not send", () => {
    const metrics = monthWrappedMetrics(recap({ plays: undefined, salesCount: undefined, salesCreatorCents: undefined }));
    expect(metrics.map((m) => m.key)).toEqual(["newFans", "newReleases"]);
  });

  it("sales without a cents figure shows the count only", () => {
    const metrics = monthWrappedMetrics(recap({ salesCreatorCents: undefined }));
    expect(metrics.find((m) => m.key === "sales")?.value).toBe("3");
  });
});

describe("buildMonthWrappedShareText (client fallback)", () => {
  it("matches the honest shape: only present metrics, best moment last", () => {
    const text = buildMonthWrappedShareText(recap({ plays: undefined }));
    expect(text).not.toMatch(/▶ .* plays/);
    expect(text).toContain("14 new fans");
    expect(text).toContain("3 sales ($45.00 earned)");
    expect(text).toContain('Best moment: "First Song"');
  });

  it("no best moment → no best-moment line", () => {
    expect(buildMonthWrappedShareText(recap({ bestMoment: null }))).not.toContain("Best moment");
  });
});
