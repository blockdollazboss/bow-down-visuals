import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  ACADEMY_ASK_PATH,
  ACADEMY_CREDIT_COST_VISUAL_BUCS,
  ACADEMY_GUIDE_BULLETS,
  ACADEMY_GUIDE_KEYS,
  ACADEMY_LEARNING_PATH_PATH,
  ACADEMY_LESSON_CACHE_KEY,
  ACADEMY_LESSON_PATH,
  ACADEMY_LEVELS,
  ACADEMY_PLATFORMS,
  ACADEMY_PROGRESS_KEY,
  askReady,
  buildAskPayload,
  buildLearningPathPayload,
  buildLessonPayload,
  courseProgressCounts,
  learningPathReady,
  lessonCacheKey,
  parseCoachAnswer,
  parseGeneratedLesson,
  parseLearningPath,
  withLessonDone,
} from "./academy-desk";
import { ACADEMY_COURSES } from "../academy-courses";

/* ─── Academy desk seam (stack1400 world parity, wave #2 item 3) ───
   The My Studio board's Academy desk rides the 2D /academy page's
   own rails. These tests pin the seam: the paths are the page's
   endpoints, the AI cost is the SERVER constant's own default
   (read from the route file, never re-typed from memory), the
   payload builders carry the page's field names trimmed the page's
   way, the progress store is the page's OWN localStorage keys, and
   every parser maps its rail's answer field-for-field — with a
   broken or incomplete answer reading as a failed read (null),
   never painted-over content. */

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("rails + prices", () => {
  it("the paths are the academy page's own endpoints", () => {
    expect(ACADEMY_LEARNING_PATH_PATH).toBe("/api/academy/learning-path");
    expect(ACADEMY_LESSON_PATH).toBe("/api/academy/lesson");
    expect(ACADEMY_ASK_PATH).toBe("/api/academy/ask");
    const page = read("../../pages/academy.tsx");
    for (const p of ["/api/academy/learning-path", "/api/academy/lesson", "/api/academy/ask"]) {
      expect(page, p).toContain(p);
    }
    const route = read("../../../../api-server/src/routes/generate/academy.ts");
    for (const p of ["/academy/learning-path", "/academy/lesson", "/academy/ask"]) {
      expect(route, p).toContain(p);
    }
  });

  it("the AI cost is the server constant's default — 100 VB, the page's CREDIT_COST too", () => {
    const route = read("../../../../api-server/src/routes/generate/academy.ts");
    expect(route).toContain('Number(process.env["ACADEMY_CREDIT_COST"]) || 100');
    expect(ACADEMY_CREDIT_COST_VISUAL_BUCS).toBe(100);
    const page = read("../../pages/academy.tsx");
    expect(page).toContain("const CREDIT_COST = 100");
  });

  it("NAMED GAP pinned: lib/credit-costs.ts carries NO /api/academy/* rows, so the desk must override", () => {
    const registry = read("../credit-costs.ts");
    expect(registry).not.toContain("/api/academy/learning-path");
    expect(registry).not.toContain("/api/academy/lesson");
    expect(registry).not.toContain("/api/academy/ask");
  });

  it("the level + platform vocabularies are the server schemas' own enums", () => {
    expect(ACADEMY_LEVELS).toEqual(["beginner", "intermediate", "advanced"]);
    expect(ACADEMY_PLATFORMS).toEqual(["youtube", "tiktok", "instagram", "twitch", "x"]);
    const route = read("../../../../api-server/src/routes/generate/academy.ts");
    expect(route).toContain('const LEVELS = ["beginner", "intermediate", "advanced"] as const');
    expect(route).toContain('const PLATFORMS = ["youtube", "tiktok", "instagram", "twitch", "x"] as const');
  });

  it("the progress store is the page's OWN localStorage keys — progress carries both ways", () => {
    expect(ACADEMY_PROGRESS_KEY).toBe("academy-progress-v1");
    expect(ACADEMY_LESSON_CACHE_KEY).toBe("academy-lessons-v1");
    const page = read("../../pages/academy.tsx");
    expect(page).toContain('const PROGRESS_KEY = "academy-progress-v1"');
    expect(page).toContain('const LESSON_CACHE_KEY = "academy-lessons-v1"');
  });

  it("the guides shelf is the guides page's own three cards, in its order", () => {
    expect(ACADEMY_GUIDE_KEYS).toEqual(["llc", "copyright", "academy"]);
    expect(ACADEMY_GUIDE_BULLETS).toEqual([1, 2, 3, 4]);
    const guidesPage = read("../../pages/guides.tsx");
    expect(guidesPage).toContain('href: "/llc-guide"');
    expect(guidesPage).toContain('href: "/copyright"');
    expect(guidesPage).toContain('href: "/academy"');
    const en = read("../../locales/en.json");
    for (const key of ACADEMY_GUIDE_KEYS) {
      expect(en, key).toContain(`"${key}"`);
    }
  });
});

describe("payload builders", () => {
  it("the learning-path body carries the page's field names, trimmed and clamped", () => {
    const body = buildLearningPathPayload({
      goals: "  Grow my channel  ",
      niche: "  Music ",
      level: "intermediate",
      platforms: ["tiktok", "youtube"],
      hours: "99",
    });
    expect(body).toEqual({
      goals: "Grow my channel",
      niche: "Music",
      level: "intermediate",
      platforms: ["tiktok", "youtube"],
      hoursPerWeek: 80,
    });
  });

  it("an empty niche falls back to General and a blank hours field to 5, like the page", () => {
    const body = buildLearningPathPayload({
      goals: "Learn lighting",
      niche: "   ",
      level: "beginner",
      platforms: ["x"],
      hours: "",
    });
    expect(body.niche).toBe("General");
    expect(body.hoursPerWeek).toBe(5);
  });

  it("readiness is the page's own gates: a 4+ character goal and at least one platform", () => {
    expect(learningPathReady({ goals: "abc", platforms: ["x"] })).toBe(false);
    expect(learningPathReady({ goals: "abcd", platforms: [] })).toBe(false);
    expect(learningPathReady({ goals: "  abcd  ", platforms: ["x"] })).toBe(true);
  });

  it("the lesson + ask bodies carry exactly the rail's fields", () => {
    expect(buildLessonPayload("branding", "lane")).toEqual({ courseId: "branding", lessonId: "lane" });
    expect(buildAskPayload("branding", "  how do I price?  ")).toEqual({
      courseId: "branding",
      question: "how do I price?",
    });
    expect(askReady("abc")).toBe(false);
    expect(askReady("  abcd ")).toBe(true);
  });
});

describe("parsers", () => {
  it("a learning path maps field-for-field, with the rail's order kept", () => {
    const parsed = parseLearningPath({
      path: [
        { courseId: "branding", title: "Personal Branding for Creators", why: "Your lane first.", order: 2 },
        { courseId: "monetization", title: "Monetization 101", why: "Then the money.", order: 1 },
      ],
      weeklyPlan: ["Week one focus"],
      firstStep: "Film your lane statement today.",
      creditsUsed: 100,
      creditsRemaining: 900,
    });
    expect(parsed).toEqual({
      path: [
        { courseId: "branding", title: "Personal Branding for Creators", why: "Your lane first.", order: 2 },
        { courseId: "monetization", title: "Monetization 101", why: "Then the money.", order: 1 },
      ],
      weeklyPlan: ["Week one focus"],
      firstStep: "Film your lane statement today.",
      creditsRemaining: 900,
    });
  });

  it("an empty or incomplete learning path is a failed read, never a painted path", () => {
    expect(parseLearningPath(null)).toBeNull();
    expect(parseLearningPath({})).toBeNull();
    expect(parseLearningPath({ path: [], weeklyPlan: [], firstStep: "x" })).toBeNull();
    expect(
      parseLearningPath({ path: [{ courseId: "branding", title: "T", why: "w" }], firstStep: "" }),
    ).toBeNull();
    expect(
      parseLearningPath({ path: [{ courseId: "", title: "T", why: "w" }], firstStep: "go" }),
    ).toBeNull();
  });

  it("a generated lesson maps field-for-field; a section-less lesson is a failed read", () => {
    const lesson = parseGeneratedLesson({
      lesson: {
        courseId: "branding",
        courseTitle: "Personal Branding for Creators",
        lessonId: "lane",
        title: "Finding Your Lane",
        minutes: 18,
        sections: [
          { heading: "The 3 circles", body: "Draw them." },
          { heading: "", body: "dropped — no heading" },
        ],
        takeaways: ["Niche down without boxing in"],
        actionStep: "Write your lane in one sentence today.",
      },
      creditsUsed: 100,
    });
    expect(lesson).toEqual({
      courseId: "branding",
      courseTitle: "Personal Branding for Creators",
      lessonId: "lane",
      title: "Finding Your Lane",
      minutes: 18,
      sections: [{ heading: "The 3 circles", body: "Draw them." }],
      takeaways: ["Niche down without boxing in"],
      actionStep: "Write your lane in one sentence today.",
    });
    expect(parseGeneratedLesson({ lesson: { courseId: "b", lessonId: "l", title: "T", sections: [], actionStep: "x" } })).toBeNull();
    expect(parseGeneratedLesson({})).toBeNull();
    expect(parseGeneratedLesson(null)).toBeNull();
  });

  it("a coach answer is the rail's answer string or nothing", () => {
    expect(parseCoachAnswer({ answer: "  Price from your watch time. " })).toBe("Price from your watch time.");
    expect(parseCoachAnswer({ answer: "   " })).toBeNull();
    expect(parseCoachAnswer({})).toBeNull();
  });
});

describe("progress helpers", () => {
  it("withLessonDone returns a new map in the page's own update shape", () => {
    const start = { branding: { lane: true } };
    const next = withLessonDone(start, "branding", "voice", true);
    expect(next).toEqual({ branding: { lane: true, voice: true } });
    expect(start).toEqual({ branding: { lane: true } });
    expect(withLessonDone(next, "branding", "lane", false)).toEqual({
      branding: { lane: false, voice: true },
    });
  });

  it("courseProgressCounts counts done lessons over the real catalog", () => {
    const counts = courseProgressCounts(ACADEMY_COURSES, {
      branding: { lane: true, visual: true, voice: false },
    });
    const branding = ACADEMY_COURSES.find((c) => c.id === "branding")!;
    expect(counts["branding"]).toEqual({ done: 2, total: branding.lessons.length });
    expect(counts["monetization"]!.done).toBe(0);
    expect(counts["monetization"]!.total).toBeGreaterThan(0);
  });

  it("the lesson cache key is the page's own course:lesson shape", () => {
    expect(lessonCacheKey("branding", "lane")).toBe("branding:lane");
  });
});
