import { describe, it, expect } from "vitest";
import {
  flattenLessons,
  resumeLesson,
  progressPct,
  unlockLabel,
  curriculumSummary,
  usd,
  type CourseLearn,
  type CourseLesson,
} from "./courses";

/* Creator Courses — the pure helpers the three docked surfaces render
   from. The pins: the resume point is the first unlocked unfinished
   lesson (the tutorial player's rule), a fully-locked course has no
   resume, progress % is honest for empty courses, and drip labels
   only ever come from a real server unlock date. */

function lesson(partial: Partial<CourseLesson> = {}): CourseLesson {
  return {
    id: "l1",
    title: "Lesson",
    position: 1,
    kind: "video",
    dripDayOffset: 0,
    isPreview: false,
    hasVideo: true,
    durationSec: 60,
    locked: false,
    lockReason: null,
    unlockAt: null,
    body: null,
    video: null,
    attachment: null,
    progress: null,
    ...partial,
  };
}

function course(lessons: CourseLesson[]): CourseLearn {
  return {
    product: {
      id: "p1", title: "C", description: "", priceCents: 100, free: false,
      isActive: true, profileId: "pr1", creatorSlug: "nova", creatorName: "Nova",
      productUrl: "/storefront/product/p1", buyUrl: "/storefront/product/p1",
    },
    access: "purchased",
    purchasedAt: null,
    lessonCount: lessons.length,
    sections: [{ id: "s1", title: "S", position: 1, lessons }],
    completedLessons: 0,
    progressPct: 0,
  };
}

describe("courses client helpers", () => {
  it("flattenLessons keeps curriculum order across sections", () => {
    const c = course([lesson({ id: "a" }), lesson({ id: "b" })]);
    c.sections.push({ id: "s2", title: "S2", position: 2, lessons: [lesson({ id: "c" })] });
    expect(flattenLessons(c).map((l) => l.id)).toEqual(["a", "b", "c"]);
  });

  it("resumeLesson lands on the first unlocked unfinished lesson", () => {
    const done = lesson({ id: "done", progress: { status: "completed", lastPositionSec: 60, completedAt: "x" } });
    const next = lesson({ id: "next", progress: { status: "in_progress", lastPositionSec: 12, completedAt: null } });
    expect(resumeLesson(course([done, next]))?.id).toBe("next");
  });

  it("resumeLesson skips locked lessons and returns null when everything is locked", () => {
    const locked = lesson({ id: "locked", locked: true, lockReason: "drip", unlockAt: "2026-11-01T00:00:00.000Z" });
    const open = lesson({ id: "open" });
    expect(resumeLesson(course([locked, open]))?.id).toBe("open");
    expect(resumeLesson(course([locked]))).toBeNull();
  });

  it("resumeLesson on a finished course reopens the first lesson", () => {
    const done = lesson({ id: "done", progress: { status: "completed", lastPositionSec: 60, completedAt: "x" } });
    expect(resumeLesson(course([done]))?.id).toBe("done");
  });

  it("progressPct is honest: empty course is 0, over-complete clamps to 100", () => {
    expect(progressPct(0, 0)).toBe(0);
    expect(progressPct(3, 1)).toBe(33);
    expect(progressPct(2, 5)).toBe(100);
  });

  it("unlockLabel formats a real date and ignores junk", () => {
    expect(unlockLabel(null)).toBeNull();
    expect(unlockLabel("not-a-date")).toBeNull();
    expect(unlockLabel("2026-11-01T12:00:00.000Z")).toMatch(/^Unlocks /);
  });

  it("curriculumSummary + usd", () => {
    expect(curriculumSummary([
      { id: "s", title: "S", position: 1, lessons: [lesson(), lesson()] },
    ])).toBe("1 section · 2 lessons");
    expect(usd(4900)).toBe("$49.00");
    expect(usd(0)).toBe("$0.00");
  });
});
