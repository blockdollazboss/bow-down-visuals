import { describe, it, expect } from "vitest";
import { fmtPlanMoney, fmtPlanMoneyShort, trackerProgress, parseGoalCents } from "./coach-tracker";
import type { CoachActionItemDto } from "./coach-tracker";

const item = (done: boolean): CoachActionItemDto => ({
  id: "x",
  title: "t",
  source: "custom",
  done,
  completedAt: null,
  createdAt: null,
});

describe("coach-tracker helpers", () => {
  it("formats cents like the Money Tracker panel", () => {
    expect(fmtPlanMoney(123_456)).toBe("$1,234.56");
    expect(fmtPlanMoney(-5_000)).toBe("-$50.00");
    expect(fmtPlanMoney(0)).toBe("$0.00");
    expect(fmtPlanMoneyShort(20_000)).toBe("$200");
    expect(fmtPlanMoneyShort(-1_550)).toBe("-$16");
  });

  it("progress counts done items and handles the empty tracker", () => {
    expect(trackerProgress([])).toEqual({ done: 0, total: 0, pct: 0 });
    expect(trackerProgress([item(true), item(false), item(true), item(false)])).toEqual({
      done: 2,
      total: 4,
      pct: 50,
    });
  });

  it("parses typed dollar goals and rejects junk", () => {
    expect(parseGoalCents("1500")).toBe(150_000);
    expect(parseGoalCents("$1,500.50")).toBe(150_050);
    expect(parseGoalCents("")).toBeNull();
    expect(parseGoalCents("abc")).toBeNull();
    expect(parseGoalCents("0")).toBeNull();
    expect(parseGoalCents("-50")).toBeNull();
  });
});
