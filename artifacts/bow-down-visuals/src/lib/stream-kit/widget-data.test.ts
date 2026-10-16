/**
 * Widget data tests — real-data-only rendering decisions: no data
 * means no lines (the stage draws nothing), the ticker rotates, and
 * goal progress clamps honestly.
 */
import { describe, it, expect } from "vitest";
import { EMPTY_WIDGET_DATA, goalProgress, widgetLines, type WidgetData } from "./widget-data";

const DATA: WidgetData = {
  latestFollower: { displayName: "Fan One", slug: "fan-one", followedAt: "2026-10-16T10:00:00.000Z" },
  recentTips: [
    { tipperName: "Fan One", amountVb: 1000, createdAt: "2026-10-16T10:01:00.000Z" },
    { tipperName: "Fan Two", amountVb: 500, createdAt: "2026-10-16T10:02:00.000Z" },
  ],
  goal: { goalVb: 5000, totalVb: 1500, tipCount: 2 },
};

describe("widgetLines", () => {
  it("empty data draws nothing for every widget kind", () => {
    expect(widgetLines("latest-follower", EMPTY_WIDGET_DATA)).toBeNull();
    expect(widgetLines("tip-ticker", EMPTY_WIDGET_DATA)).toBeNull();
    expect(widgetLines("goal-bar", EMPTY_WIDGET_DATA)).toBeNull();
  });

  it("latest follower shows the real name", () => {
    expect(widgetLines("latest-follower", DATA)).toEqual(["Latest follower", "Fan One"]);
  });

  it("the tip ticker rotates through real tips every 4 seconds", () => {
    expect(widgetLines("tip-ticker", DATA, 0)).toEqual(["Fan One tipped 1,000 Visual Bucs"]);
    expect(widgetLines("tip-ticker", DATA, 4)).toEqual(["Fan Two tipped 500 Visual Bucs"]);
    expect(widgetLines("tip-ticker", DATA, 8)).toEqual(["Fan One tipped 1,000 Visual Bucs"]);
  });

  it("the goal bar reports real progress and clamps past 100%", () => {
    expect(goalProgress(DATA)).toBeCloseTo(0.3);
    expect(widgetLines("goal-bar", DATA)).toEqual(["Tip goal: 1,500 / 5,000 Visual Bucs", "30%"]);
    const smashed: WidgetData = { ...DATA, goal: { goalVb: 1000, totalVb: 2500, tipCount: 3 } };
    expect(goalProgress(smashed)).toBe(1);
    expect(widgetLines("goal-bar", smashed)?.[1]).toBe("100%");
  });

  it("a goal of zero or unset is no goal at all", () => {
    expect(goalProgress({ ...DATA, goal: { goalVb: 0, totalVb: 10, tipCount: 1 } })).toBeNull();
    expect(goalProgress(EMPTY_WIDGET_DATA)).toBeNull();
  });
});
