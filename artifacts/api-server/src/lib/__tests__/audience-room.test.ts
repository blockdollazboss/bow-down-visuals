/**
 * Audience Room pins (lib/audience-room.ts, N16).
 *
 * The panel shows only what play rows prove. These pins hold: hours
 * come from real played_at values; undeclared sources stay "untracked"
 * and are never redistributed; unknown declared sources collapse to
 * "other"; fan city reports itself unavailable with the honest reason.
 */
import { describe, it, expect } from "vitest";
import {
  normalizePlaySource,
  bestHoursHistogram,
  peakHour,
  hourLabel,
  summarizeAudienceRoom,
  FAN_CITY_UNAVAILABLE_REASON,
  type PlayRow,
} from "../audience-room";

const at = (hour: number, source: string | null = null): PlayRow => ({
  playedAt: new Date(Date.UTC(2026, 9, 26, hour, 15)),
  source,
});

describe("normalizePlaySource", () => {
  it("passes known sources, case/space-insensitively", () => {
    expect(normalizePlaySource("profile")).toBe("profile");
    expect(normalizePlaySource(" Fan_Link ")).toBe("fan_link");
  });

  it("unknown declared sources collapse to other; absent stays null", () => {
    expect(normalizePlaySource("carrier-pigeon")).toBe("other");
    expect(normalizePlaySource("")).toBeNull();
    expect(normalizePlaySource(null)).toBeNull();
    expect(normalizePlaySource(undefined)).toBeNull();
    expect(normalizePlaySource(7)).toBeNull();
  });
});

describe("best hours", () => {
  it("histograms by UTC hour and finds the peak", () => {
    const plays = [at(14), at(14), at(14), at(3), at(23), at(23)];
    const h = bestHoursHistogram(plays);
    expect(h).toHaveLength(24);
    expect(h[14]).toBe(3);
    expect(h[3]).toBe(1);
    expect(peakHour(h)).toEqual({ hour: 14, plays: 3 });
    expect(hourLabel(14)).toBe("14:00–15:00 UTC");
    expect(hourLabel(23)).toBe("23:00–00:00 UTC");
  });

  it("no plays → no peak", () => {
    expect(peakHour(bestHoursHistogram([]))).toBeNull();
  });
});

describe("summarizeAudienceRoom", () => {
  it("separates tracked from untracked and never guesses the untracked", () => {
    const plays = [
      at(10, "profile"), at(10, "profile"), at(11, "charts"),
      at(12, null), at(12, null), at(13, "mystery"),
    ];
    const s = summarizeAudienceRoom(plays);
    expect(s.totalPlays).toBe(6);
    expect(s.trackedPlays).toBe(4);
    expect(s.untrackedPlays).toBe(2);
    expect(s.sources.map((x) => x.source)).toEqual(["profile", "charts", "other"]);
    expect(s.sources[0]).toEqual({ source: "profile", plays: 2, pct: 50 });
    expect(s.peak).toEqual({ hour: 10, plays: 2, label: "10:00–11:00 UTC" });
  });

  it("fan city is honestly unavailable", () => {
    const s = summarizeAudienceRoom([]);
    expect(s.fanCity).toEqual({ available: false, reason: FAN_CITY_UNAVAILABLE_REASON });
    expect(s.totalPlays).toBe(0);
    expect(s.sources).toEqual([]);
  });
});
