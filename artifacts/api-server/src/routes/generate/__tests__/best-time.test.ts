/**
 * Tests for the Best Time to Post optimizer route's pure logic.
 *
 * Covers: pricing constant, request schema, benchmark scoring, AI
 * niche-window sanitization, heatmap/slot building, personalization
 * boosting, and graceful degradation (no AI key → benchmark slots).
 */
import { describe, expect, it } from "vitest";
import {
  BEST_TIME_CREDIT_COST,
  BEST_TIME_PLATFORMS,
  bestTimeSchema,
  benchmarkScore,
  parseNicheWindows,
  buildScoredCells,
  daysInTimezone,
} from "../best-time";

describe("BEST_TIME_CREDIT_COST", () => {
  it("charges 75 Visual Bucs", () => {
    expect(BEST_TIME_CREDIT_COST).toBe(75);
  });
});

describe("BEST_TIME_PLATFORMS", () => {
  it("covers tiktok, instagram, youtube and x", () => {
    expect([...BEST_TIME_PLATFORMS].sort()).toEqual(["instagram", "tiktok", "x", "youtube"]);
  });
});

describe("bestTimeSchema", () => {
  it("accepts a valid request", () => {
    const parsed = bestTimeSchema.safeParse({
      platforms: ["tiktok", "instagram"],
      niche: "fitness",
      timezone: "America/New_York",
      postsPerWeek: 3,
      analytics: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects an empty platform list and unknown platforms", () => {
    expect(bestTimeSchema.safeParse({ platforms: [] }).success).toBe(false);
    expect(bestTimeSchema.safeParse({ platforms: ["myspace"] }).success).toBe(false);
  });

  it("defaults timezone and analytics", () => {
    const parsed = bestTimeSchema.safeParse({ platforms: ["x"] });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.timezone).toBe("America/New_York");
      expect(parsed.data.analytics).toEqual([]);
    }
  });
});

describe("benchmarkScore", () => {
  it("scores the TikTok Tuesday evening peak high", () => {
    // Tuesday = 2
    const { score, label } = benchmarkScore("tiktok", 2, 20);
    expect(score).toBeGreaterThanOrEqual(90);
    expect(label).toMatch(/evening/i);
  });

  it("scores overnight hours low", () => {
    const { score } = benchmarkScore("instagram", 3, 3);
    expect(score).toBeLessThan(30);
  });

  it("never exceeds 100", () => {
    for (const p of BEST_TIME_PLATFORMS) {
      for (let d = 0; d < 7; d++) {
        for (let h = 0; h < 24; h++) {
          expect(benchmarkScore(p, d, h).score).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});

describe("daysInTimezone", () => {
  it("returns 7 consecutive days in YYYY-MM-DD form", () => {
    const days = daysInTimezone("America/New_York");
    expect(days).toHaveLength(7);
    for (const d of days) {
      expect(d.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(d.weekday).toBeGreaterThanOrEqual(0);
      expect(d.weekday).toBeLessThanOrEqual(6);
    }
  });

  it("falls back to America/New_York on a bogus timezone", () => {
    const days = daysInTimezone("Not/AZone");
    expect(days).toHaveLength(7);
    expect(days[0]!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("parseNicheWindows", () => {
  it("accepts a well-formed AI payload", () => {
    const out = parseNicheWindows({
      windows: [
        { platform: "tiktok", weekday: 2, startHour: 18, endHour: 21, boost: 10, reason: "Gym crowd after work" },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ platform: "tiktok", weekday: 2, boost: 10 });
  });

  it("drops malformed or out-of-range windows", () => {
    const out = parseNicheWindows({
      windows: [
        { platform: "tiktok", weekday: 9, startHour: 18, endHour: 21, boost: 10 }, // bad weekday
        { platform: "myspace", weekday: 2, startHour: 18, endHour: 21, boost: 10 }, // bad platform
        { platform: "x", weekday: 2, startHour: 21, endHour: 18, boost: 10 }, // end <= start
        { platform: "x", weekday: 2, startHour: 18, endHour: 21, boost: 99 }, // boost too high
        null,
        "nope",
      ],
    });
    expect(out).toEqual([]);
  });

  it("returns [] for non-object input", () => {
    expect(parseNicheWindows(null)).toEqual([]);
    expect(parseNicheWindows("garbage")).toEqual([]);
  });
});

describe("buildScoredCells", () => {
  it("builds a 7x24 heatmap per platform with top slots", () => {
    const { heatmap, slots } = buildScoredCells(["tiktok", "instagram"], "America/New_York", "fitness", [], []);
    expect(Object.keys(heatmap).sort()).toEqual(["instagram", "tiktok"]);
    expect(heatmap["tiktok"]!.dates).toHaveLength(7);
    expect(heatmap["tiktok"]!.scores).toHaveLength(7);
    expect(heatmap["tiktok"]!.scores[0]).toHaveLength(24);
    // 3 slots per platform, sorted by score desc
    expect(slots).toHaveLength(6);
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i - 1]!.score).toBeGreaterThanOrEqual(slots[i]!.score);
    }
    for (const s of slots) {
      expect(s.time).toMatch(/^\d{2}:00$/);
      expect(s.source).toBe("benchmark");
      expect(s.reason).toMatch(/fitness/);
    }
  });

  it("labels every slot benchmark when no analytics are passed (graceful degradation)", () => {
    const { slots } = buildScoredCells(["youtube"], "America/New_York", undefined, [], []);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.every((s) => s.source === "benchmark")).toBe(true);
  });

  it("boosts slots matching the user's own high-engagement history and labels them personalized", () => {
    // Find a future TikTok evening-peak cell: use the heatmap to pick a real date/hour.
    const { heatmap } = buildScoredCells(["tiktok"], "America/New_York", undefined, [], []);
    const dates = heatmap["tiktok"]!.dates;
    // Tuesday (weekday 2) 20:00 is a 94 benchmark — find the matching date.
    const tuesdayIdx = dates.findIndex((_, i) => {
      const wd = new Date(dates[i]! + "T12:00:00").getDay();
      return wd === 2;
    });
    const date = dates[tuesdayIdx === -1 ? 0 : tuesdayIdx]!;
    const analytics = [
      { platform: "tiktok" as const, postedAt: `${date}T20:15:00-04:00`, engagement: 85 },
      { platform: "tiktok" as const, postedAt: `${date}T20:40:00-04:00`, engagement: 90 },
    ];
    const res = buildScoredCells(["tiktok"], "America/New_York", undefined, analytics, []);
    const match = res.slots.find((s) => s.date === date && s.time === "20:00");
    expect(match).toBeDefined();
    expect(match!.source).toBe("personalized");
    expect(match!.score).toBeGreaterThan(94); // 94 benchmark + boost
    expect(match!.reason).toMatch(/average .*% engagement/i);
  });

  it("clamps scores to 0-100 even with stacked boosts", () => {
    const { heatmap } = buildScoredCells(
      ["tiktok"],
      "America/New_York",
      "fitness",
      [],
      [{ platform: "tiktok", weekday: 2, startHour: 19, endHour: 22, boost: 15, reason: "niche" }],
    );
    for (const row of heatmap["tiktok"]!.scores) {
      for (const s of row) {
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(100);
      }
    }
  });
});
