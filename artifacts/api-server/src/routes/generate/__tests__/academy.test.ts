/**
 * Money-integrity + catalog tests for the Creator Academy.
 *
 * Covers: the 1-credit price per AI call, the zod request schemas
 * (valid + invalid), the static course catalog integrity (unique ids,
 * valid levels, non-empty lessons), the catalog lookup helpers, and the
 * GPT-6 `max_completion_tokens` requirement (GPT-6 rejects `max_tokens`).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  ACADEMY_COURSES,
  getAcademyCourse,
  getAcademyLesson,
} from "../../../lib/academy-courses";
import {
  ACADEMY_CREDIT_COST,
  learningPathSchema,
  askSchema,
  lessonSchema,
} from "../academy";

describe("ACADEMY_CREDIT_COST", () => {
  it("charges 1 credit per AI academy call", () => {
    expect(ACADEMY_CREDIT_COST).toBe(1);
  });
});

describe("academy catalog integrity", () => {
  it("has at least 4 courses", () => {
    expect(ACADEMY_COURSES.length).toBeGreaterThanOrEqual(4);
  });

  it("has unique course ids", () => {
    const ids = ACADEMY_COURSES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every course has a valid level, title, description, and duration", () => {
    for (const c of ACADEMY_COURSES) {
      expect(["beginner", "intermediate", "advanced"]).toContain(c.level);
      expect(c.title.trim().length).toBeGreaterThan(0);
      expect(c.description.trim().length).toBeGreaterThan(20);
      expect(c.duration.trim().length).toBeGreaterThan(0);
      expect(c.tagline.trim().length).toBeGreaterThan(0);
    }
  });

  it("every course has 4+ lessons with unique ids, titles, summaries, minutes", () => {
    for (const c of ACADEMY_COURSES) {
      expect(c.lessons.length).toBeGreaterThanOrEqual(4);
      const lessonIds = c.lessons.map((l) => l.id);
      expect(new Set(lessonIds).size).toBe(lessonIds.length);
      for (const l of c.lessons) {
        expect(l.id.trim().length).toBeGreaterThan(0);
        expect(l.title.trim().length).toBeGreaterThan(0);
        expect(l.summary.trim().length).toBeGreaterThan(10);
        expect(l.minutes).toBeGreaterThan(0);
      }
    }
  });
});

describe("getAcademyCourse", () => {
  it("finds a course by id", () => {
    const course = getAcademyCourse("tiktok-growth");
    expect(course?.title).toBe("TikTok Growth Playbook");
  });

  it("returns undefined for an unknown id", () => {
    expect(getAcademyCourse("nope")).toBeUndefined();
  });
});

describe("getAcademyLesson", () => {
  it("finds a lesson by course + lesson id", () => {
    const found = getAcademyLesson("video-production", "lighting");
    expect(found?.course.id).toBe("video-production");
    expect(found?.lesson.title).toBe("Lighting on a Budget");
  });

  it("returns undefined for unknown course or lesson", () => {
    expect(getAcademyLesson("nope", "lighting")).toBeUndefined();
    expect(getAcademyLesson("video-production", "nope")).toBeUndefined();
  });
});

describe("learningPathSchema", () => {
  const valid = {
    goals: "Grow my music channel to 100k subscribers",
    niche: "Music",
    level: "beginner",
    platforms: ["youtube", "tiktok"],
    hoursPerWeek: 8,
  };

  it("accepts a valid learning-path request", () => {
    expect(learningPathSchema.safeParse(valid).success).toBe(true);
  });

  it("defaults hoursPerWeek when omitted", () => {
    const { hoursPerWeek, ...rest } = valid;
    const parsed = learningPathSchema.safeParse(rest);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.hoursPerWeek).toBe(5);
  });

  it("rejects missing goals, bad level, and empty platforms", () => {
    expect(learningPathSchema.safeParse({ ...valid, goals: "x" }).success).toBe(false);
    expect(learningPathSchema.safeParse({ ...valid, level: "guru" }).success).toBe(false);
    expect(learningPathSchema.safeParse({ ...valid, platforms: [] }).success).toBe(false);
    expect(learningPathSchema.safeParse({ ...valid, platforms: ["myspace"] }).success).toBe(false);
  });
});

describe("askSchema", () => {
  it("accepts a valid coach question", () => {
    expect(
      askSchema.safeParse({ courseId: "branding", question: "How do I pick brand colors?" }).success,
    ).toBe(true);
  });

  it("rejects empty course and too-short questions", () => {
    expect(askSchema.safeParse({ courseId: "", question: "How?" }).success).toBe(false);
    expect(askSchema.safeParse({ courseId: "branding", question: "Hi" }).success).toBe(false);
  });
});

describe("lessonSchema", () => {
  it("accepts a valid lesson request", () => {
    expect(
      lessonSchema.safeParse({ courseId: "monetization", lessonId: "sponsors" }).success,
    ).toBe(true);
  });

  it("rejects empty ids", () => {
    expect(lessonSchema.safeParse({ courseId: "", lessonId: "sponsors" }).success).toBe(false);
    expect(lessonSchema.safeParse({ courseId: "monetization", lessonId: "" }).success).toBe(false);
  });
});

describe("GPT-6 token parameter", () => {
  it("uses max_completion_tokens and never max_tokens in the academy route", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "..", "academy.ts"), "utf8");
    expect(src).toContain("max_completion_tokens");
    /* `max_tokens` must not appear as a bare key — the GPT-6 API rejects it.
       The negative lookbehind excludes `max_completion_tokens`. */
    expect(src).not.toMatch(/(?<!max_completion_)tokens:\s*\d/);
  });
});
