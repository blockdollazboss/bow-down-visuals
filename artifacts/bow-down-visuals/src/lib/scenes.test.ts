/**
 * Local Scenes (Stack-200 N10) — client-side honesty mirror.
 * The directory rule holds on the client too: a payload entry with no
 * real creators (or no slug) never renders as a city.
 */
import { describe, it, expect } from "vitest";
import { visibleCities, formatShowDate, type SceneCityEntry } from "./scenes";

const city = (over: Partial<SceneCityEntry>): SceneCityEntry => ({
  slug: "new-york",
  name: "New York",
  creator_count: 2,
  show_count: 1,
  ...over,
});

describe("visibleCities — the directory rule", () => {
  it("keeps cities with at least one real creator", () => {
    expect(visibleCities([city({})])).toHaveLength(1);
  });

  it("drops zero-creator entries — no fake cities from a bad payload", () => {
    expect(visibleCities([city({ creator_count: 0 })])).toEqual([]);
    expect(visibleCities([city({ slug: "" })])).toEqual([]);
  });

  it("tolerates null / non-array payloads as an empty directory", () => {
    expect(visibleCities(null)).toEqual([]);
    expect(visibleCities(undefined)).toEqual([]);
  });
});

describe("formatShowDate", () => {
  it("formats a real instant and never invents one for garbage input", () => {
    expect(formatShowDate("2026-11-14T20:00:00.000Z")).toContain("Nov");
    expect(formatShowDate("not-a-date")).toBe("not-a-date");
  });
});
