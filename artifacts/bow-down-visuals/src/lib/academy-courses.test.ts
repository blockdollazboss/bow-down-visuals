/**
 * Catalog integrity tests for the Creator Academy frontend copy.
 *
 * The frontend ships its own copy of the catalog (free browsing, no API
 * round-trip) — these tests pin its shape so it can't drift from the
 * backend source of truth at
 * artifacts/api-server/src/lib/academy-courses.ts.
 */
import { describe, it, expect } from "vitest";
import { ACADEMY_COURSES, getAcademyCourse } from "./academy-courses";

describe("academy catalog (frontend copy)", () => {
  it("has 6 courses", () => {
    expect(ACADEMY_COURSES).toHaveLength(6);
  });

  it("has the expected course ids in a stable order", () => {
    expect(ACADEMY_COURSES.map((c) => c.id)).toEqual([
      "video-production",
      "tiktok-growth",
      "youtube-shorts",
      "monetization",
      "branding",
      "content-systems",
    ]);
  });

  it("has unique course and lesson ids", () => {
    const courseIds = ACADEMY_COURSES.map((c) => c.id);
    expect(new Set(courseIds).size).toBe(courseIds.length);
    for (const c of ACADEMY_COURSES) {
      const lessonIds = c.lessons.map((l) => l.id);
      expect(new Set(lessonIds).size).toBe(lessonIds.length);
    }
  });

  it("every course has a valid level and non-empty display fields", () => {
    for (const c of ACADEMY_COURSES) {
      expect(["beginner", "intermediate", "advanced"]).toContain(c.level);
      expect(c.title.trim().length).toBeGreaterThan(0);
      expect(c.tagline.trim().length).toBeGreaterThan(0);
      expect(c.description.trim().length).toBeGreaterThan(20);
      expect(c.duration.trim().length).toBeGreaterThan(0);
      expect(c.lessons.length).toBeGreaterThanOrEqual(4);
      for (const l of c.lessons) {
        expect(l.id.trim().length).toBeGreaterThan(0);
        expect(l.title.trim().length).toBeGreaterThan(0);
        expect(l.summary.trim().length).toBeGreaterThan(10);
        expect(l.minutes).toBeGreaterThan(0);
      }
    }
  });

  it("getAcademyCourse finds courses and misses cleanly", () => {
    expect(getAcademyCourse("branding")?.title).toBe("Personal Branding for Creators");
    expect(getAcademyCourse("nope")).toBeUndefined();
  });
});
