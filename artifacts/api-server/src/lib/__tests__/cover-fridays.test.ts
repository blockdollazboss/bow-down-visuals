import { describe, it, expect } from "vitest";
import { coverFridayCycle, rankCoverEntries, coverFridayWinner, COVER_FRIDAY_THEMES } from "../cover-fridays";

/* 2026-10-30 is a Friday; 2026-10-27 is a Tuesday (America/New_York). */
const FRI_NOON_NY = Date.UTC(2026, 9, 30, 16, 0); // Fri 12:00 EDT
const TUE_NOON_NY = Date.UTC(2026, 9, 27, 16, 0); // Tue 12:00 EDT
const SAT_NOON_NY = Date.UTC(2026, 9, 31, 16, 0); // Sat 12:00 EDT

describe("cover-fridays cycle", () => {
  it("is open on Friday with a 3-day window", () => {
    const c = coverFridayCycle(FRI_NOON_NY);
    expect(c.phase).toBe("open");
    expect(c.closesAt - c.opensAt).toBe(3 * 24 * 3600_000 - 1);
  });
  it("Saturday belongs to the same Friday cycle", () => {
    expect(coverFridayCycle(SAT_NOON_NY).weekKey).toBe(coverFridayCycle(FRI_NOON_NY).weekKey);
  });
  it("Tuesday points at the coming Friday, phase before", () => {
    const c = coverFridayCycle(TUE_NOON_NY);
    expect(c.phase).toBe("before");
    expect(c.opensAt).toBeGreaterThan(TUE_NOON_NY);
  });
  it("theme always comes from the rotation", () => {
    expect(COVER_FRIDAY_THEMES).toContain(coverFridayCycle(FRI_NOON_NY).theme);
  });
});

describe("cover-fridays winner", () => {
  it("crowns the most-played entry, earliest post wins ties", () => {
    const w = coverFridayWinner([
      { id: "b", plays: 10, createdAt: 2 },
      { id: "a", plays: 10, createdAt: 1 },
      { id: "c", plays: 3, createdAt: 0 },
    ]);
    expect(w?.id).toBe("a");
  });
  it("no plays means no crown", () => {
    expect(coverFridayWinner([{ id: "a", plays: 0, createdAt: 1 }])).toBeNull();
    expect(rankCoverEntries([])).toEqual([]);
  });
});
