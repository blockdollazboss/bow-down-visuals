/**
 * Unit tests for the AI Content Calendar frontend helpers.
 *
 * Covers: today's date format, localStorage key stability (platform order
 * must not matter), calendar grid leading-blank math, and posting-day
 * counts.
 */
import { describe, expect, it } from "vitest";
import {
  todayISO,
  calendarSig,
  leadBlankCount,
  postingCount,
} from "./content-calendar";

describe("todayISO", () => {
  it("returns a YYYY-MM-DD string", () => {
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("calendarSig", () => {
  it("is stable regardless of platform selection order", () => {
    const a = calendarSig("Music", ["tiktok", "instagram"], 3, "2026-09-25");
    const b = calendarSig("Music", ["instagram", "tiktok"], 3, "2026-09-25");
    expect(a).toBe(b);
  });

  it("changes when any input changes", () => {
    const base = calendarSig("Music", ["tiktok"], 3, "2026-09-25");
    expect(calendarSig("Gaming", ["tiktok"], 3, "2026-09-25")).not.toBe(base);
    expect(calendarSig("Music", ["youtube"], 3, "2026-09-25")).not.toBe(base);
    expect(calendarSig("Music", ["tiktok"], 5, "2026-09-25")).not.toBe(base);
    expect(calendarSig("Music", ["tiktok"], 3, "2026-09-26")).not.toBe(base);
  });
});

describe("leadBlankCount", () => {
  it("places 2026-09-25 (a Friday) after 5 blanks in a Sun-first grid", () => {
    expect(leadBlankCount([{ date: "2026-09-25", post: true }])).toBe(5);
  });

  it("needs no blanks when day 1 is a Sunday", () => {
    expect(leadBlankCount([{ date: "2026-09-27", post: true }])).toBe(0);
  });

  it("needs 6 blanks when day 1 is a Saturday", () => {
    expect(leadBlankCount([{ date: "2026-09-26", post: false }])).toBe(6);
  });

  it("returns 0 for an empty calendar", () => {
    expect(leadBlankCount([])).toBe(0);
  });
});

describe("postingCount", () => {
  it("counts only posting days", () => {
    const days = [
      { date: "2026-09-25", post: true },
      { date: "2026-09-26", post: false },
      { date: "2026-09-27", post: true },
    ];
    expect(postingCount(days)).toBe(2);
  });

  it("returns 0 when everything is a rest day", () => {
    expect(postingCount([{ date: "2026-09-25", post: false }])).toBe(0);
  });
});
