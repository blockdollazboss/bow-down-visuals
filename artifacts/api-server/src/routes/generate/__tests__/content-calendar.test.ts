/**
 * Tests for the AI Content Calendar backend.
 *
 * Covers: the 1-credit price, 30-day date math, posting-day target math,
 * input schema validation, and the model-output parser (sanitization,
 * platform fallback, rest-day padding, and failure modes that trigger
 * the credit refund).
 */
import { describe, expect, it } from "vitest";
import {
  CALENDAR_CREDIT_COST,
  CALENDAR_DAYS,
  buildCalendarDates,
  targetPostCount,
  dayLabel,
  parseCalendarDays,
  contentCalendarSchema,
} from "../content-calendar";

describe("CALENDAR_CREDIT_COST", () => {
  it("charges 1 credit per calendar", () => {
    expect(CALENDAR_CREDIT_COST).toBe(1);
  });
});

describe("buildCalendarDates", () => {
  it("builds 30 consecutive UTC dates from the start date", () => {
    const dates = buildCalendarDates("2026-09-25");
    expect(dates).toHaveLength(CALENDAR_DAYS);
    expect(dates[0]).toBe("2026-09-25");
    expect(dates[1]).toBe("2026-09-26");
    expect(dates[29]).toBe("2026-10-24");
  });

  it("crosses month boundaries correctly", () => {
    const dates = buildCalendarDates("2026-01-30");
    expect(dates[0]).toBe("2026-01-30");
    expect(dates[1]).toBe("2026-01-31");
    expect(dates[2]).toBe("2026-02-01");
  });

  it("handles leap years", () => {
    const dates = buildCalendarDates("2028-02-28");
    expect(dates[1]).toBe("2028-02-29");
    expect(dates[2]).toBe("2028-03-01");
  });
});

describe("targetPostCount", () => {
  it("scales posting days with weekly cadence", () => {
    expect(targetPostCount(7)).toBe(30); // daily → every day
    expect(targetPostCount(3)).toBe(13); // 3/7 * 30 ≈ 12.86
    expect(targetPostCount(1)).toBe(4); // 1/7 * 30 ≈ 4.29
  });

  it("clamps to the 30-day window", () => {
    expect(targetPostCount(14)).toBe(30);
    expect(targetPostCount(1)).toBeGreaterThanOrEqual(1);
  });
});

describe("dayLabel", () => {
  it("formats a readable weekday label", () => {
    expect(dayLabel("2026-09-25")).toBe("Fri, Sep 25");
    expect(dayLabel("2026-09-28")).toBe("Mon, Sep 28");
  });
});

describe("contentCalendarSchema", () => {
  const valid = {
    niche: "Music",
    platforms: ["tiktok", "instagram"],
    postsPerWeek: 3,
    startDate: "2026-09-25",
  };

  it("accepts a valid request", () => {
    expect(contentCalendarSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects an empty niche", () => {
    expect(contentCalendarSchema.safeParse({ ...valid, niche: "" }).success).toBe(false);
  });

  it("rejects zero platforms", () => {
    expect(contentCalendarSchema.safeParse({ ...valid, platforms: [] }).success).toBe(false);
  });

  it("rejects unknown platforms", () => {
    expect(
      contentCalendarSchema.safeParse({ ...valid, platforms: ["myspace"] }).success,
    ).toBe(false);
  });

  it("rejects out-of-range cadence", () => {
    expect(contentCalendarSchema.safeParse({ ...valid, postsPerWeek: 0 }).success).toBe(false);
    expect(contentCalendarSchema.safeParse({ ...valid, postsPerWeek: 15 }).success).toBe(false);
    expect(contentCalendarSchema.safeParse({ ...valid, postsPerWeek: 2.5 }).success).toBe(false);
  });

  it("rejects malformed dates", () => {
    expect(contentCalendarSchema.safeParse({ ...valid, startDate: "09/25/2026" }).success).toBe(false);
    expect(contentCalendarSchema.safeParse({ ...valid, startDate: "2026-13-01" }).success).toBe(false);
  });
});

describe("parseCalendarDays", () => {
  const dates = buildCalendarDates("2026-09-25");
  const platforms = ["tiktok", "instagram"] as const;

  function modelJson(days: unknown[]) {
    return JSON.stringify({ days });
  }

  it("parses posting days and attaches dates by index", () => {
    const raw = modelJson([
      {
        post: true,
        title: "Studio tour",
        format: "video",
        platform: "tiktok",
        hook: "You've never seen a home studio like this",
        bestTime: "6:00 PM",
      },
      { post: false },
    ]);
    const days = parseCalendarDays(raw, dates, platforms);
    expect(days).toHaveLength(30);
    expect(days[0]).toMatchObject({
      date: "2026-09-25",
      dayLabel: "Fri, Sep 25",
      post: true,
      title: "Studio tour",
      format: "video",
      platform: "tiktok",
      hook: "You've never seen a home studio like this",
      bestTime: "6:00 PM",
    });
    expect(days[1]).toMatchObject({ post: false, title: "", platform: "" });
  });

  it("pads short model output with rest days", () => {
    const raw = modelJson([
      { post: true, title: "A", format: "video", platform: "tiktok", hook: "H", bestTime: "5 PM" },
    ]);
    const days = parseCalendarDays(raw, dates, platforms);
    expect(days).toHaveLength(30);
    expect(days.filter((d) => d.post)).toHaveLength(1);
    expect(days[29]).toMatchObject({ date: "2026-10-24", post: false });
  });

  it("falls back to a requested platform when the model invents one", () => {
    const raw = modelJson([
      { post: true, title: "A", format: "video", platform: "myspace", hook: "H", bestTime: "5 PM" },
    ]);
    const days = parseCalendarDays(raw, dates, platforms);
    expect(["tiktok", "instagram"]).toContain(days[0]!.platform);
  });

  it("rejects unknown formats and trims overlong strings", () => {
    const raw = modelJson([
      {
        post: true,
        title: "x".repeat(500),
        format: "hologram",
        platform: "tiktok",
        hook: "y".repeat(500),
        bestTime: "6:00 PM",
      },
    ]);
    const days = parseCalendarDays(raw, dates, platforms);
    expect(days[0]!.format).toBe("");
    expect(days[0]!.title.length).toBeLessThanOrEqual(120);
    expect(days[0]!.hook.length).toBeLessThanOrEqual(200);
  });

  it("defaults bestTime when the model omits it", () => {
    const raw = modelJson([{ post: true, title: "A", format: "video", platform: "tiktok", hook: "H" }]);
    const days = parseCalendarDays(raw, dates, platforms);
    expect(days[0]!.bestTime).toBe("6:00 PM");
  });

  it("throws on invalid JSON (triggers the credit refund)", () => {
    expect(() => parseCalendarDays("not json", dates, platforms)).toThrow("invalid JSON");
  });

  it("throws when the model returns zero posting days", () => {
    const raw = modelJson([{ post: false }, { post: false }]);
    expect(() => parseCalendarDays(raw, dates, platforms)).toThrow("no posting days");
  });

  it("throws when days is not an array", () => {
    expect(() => parseCalendarDays(JSON.stringify({ days: "nope" }), dates, platforms)).toThrow();
  });
});
