import { describe, it, expect } from "vitest";
import { formatBudgetRange, daysLeftLabel, clampScore } from "./sponsors";

describe("formatBudgetRange", () => {
  it("formats a normal range", () => {
    expect(formatBudgetRange(500, 2000)).toBe("$500–$2,000");
  });
  it("handles equal min and max", () => {
    expect(formatBudgetRange(1000, 1000)).toBe("$1,000–$1,000");
  });
  it("floors fractional dollars", () => {
    expect(formatBudgetRange(99.9, 250.4)).toBe("$99–$250");
  });
});

describe("daysLeftLabel", () => {
  const now = new Date("2026-09-25T12:00:00Z").getTime();

  it("says Closed for past deadlines", () => {
    expect(daysLeftLabel("2026-09-20T00:00:00Z", now)).toBe("Closed");
  });
  it("says Ends today for a deadline an hour away", () => {
    expect(daysLeftLabel("2026-09-25T13:00:00Z", now)).toBe("Ends today");
  });
  it("says 1 day left for tomorrow", () => {
    expect(daysLeftLabel("2026-09-26T12:00:00Z", now)).toBe("1 day left");
  });
  it("counts multiple days", () => {
    expect(daysLeftLabel("2026-10-02T12:00:00Z", now)).toBe("7 days left");
  });
  it("handles an unparseable date", () => {
    expect(daysLeftLabel("not-a-date", now)).toBe("No deadline");
  });
});

describe("clampScore", () => {
  it("clamps above 100", () => {
    expect(clampScore(150)).toBe(100);
  });
  it("clamps below 0", () => {
    expect(clampScore(-5)).toBe(0);
  });
  it("rounds", () => {
    expect(clampScore(92.6)).toBe(93);
  });
  it("passes sane scores through", () => {
    expect(clampScore(78)).toBe(78);
  });
});
