import { describe, expect, it } from "vitest";
import {
  FIRST100_MILESTONES,
  celebrationHeadline,
  nextMilestoneFor,
  nextStepOf,
  progressPctFor,
  shouldShowFirst100Card,
  type First100Status,
} from "./first100";

function status(partial: Partial<First100Status>): First100Status {
  return {
    fanCount: 0,
    goal: 100,
    progressPct: 0,
    milestones: [],
    currentMilestone: null,
    nextMilestone: 1,
    fansToNext: 1,
    pendingCelebrations: [],
    steps: [],
    nextStep: null,
    earlyFans: [],
    surface: true,
    completed: false,
    completedAt: null,
    snoozeUntil: null,
    ...partial,
  };
}

describe("first100 client math", () => {
  it("carries the ruled ladder", () => {
    expect([...FIRST100_MILESTONES]).toEqual([1, 10, 25, 50, 100]);
  });

  it("next milestone walks the ladder and ends at 100", () => {
    expect(nextMilestoneFor(0)).toBe(1);
    expect(nextMilestoneFor(9)).toBe(10);
    expect(nextMilestoneFor(10)).toBe(25);
    expect(nextMilestoneFor(99)).toBe(100);
    expect(nextMilestoneFor(100)).toBeNull();
    expect(nextMilestoneFor(101)).toBeNull();
  });

  it("progress is honest and clamped at exactly 100", () => {
    expect(progressPctFor(0)).toBe(0);
    expect(progressPctFor(37)).toBe(37);
    expect(progressPctFor(100)).toBe(100);
    expect(progressPctFor(240)).toBe(100);
  });

  it("celebration headlines exist for every milestone", () => {
    for (const m of FIRST100_MILESTONES) {
      expect(celebrationHeadline(m)).toContain(String(m === 1 ? 1 : m));
    }
    expect(celebrationHeadline(100)).toContain("100");
  });
});

describe("shouldShowFirst100Card (smart law, client side)", () => {
  it("hides without a status or when the server says not to surface", () => {
    expect(shouldShowFirst100Card(null, false)).toBe(false);
    expect(shouldShowFirst100Card(status({ surface: false }), false)).toBe(false);
  });

  it("shows a live, unsnoozed journey", () => {
    expect(shouldShowFirst100Card(status({ fanCount: 4 }), false)).toBe(true);
  });

  it("a local dismissal hides the card until a celebration is pending", () => {
    expect(shouldShowFirst100Card(status({ fanCount: 4 }), true)).toBe(false);
    expect(shouldShowFirst100Card(status({ fanCount: 10, pendingCelebrations: [10] }), true)).toBe(true);
  });

  it("a completed, fully celebrated program never renders", () => {
    expect(shouldShowFirst100Card(status({ completed: true, fanCount: 100 }), false)).toBe(false);
    expect(shouldShowFirst100Card(status({ completed: true, fanCount: 100, pendingCelebrations: [100] }), false)).toBe(true);
  });
});

describe("nextStepOf", () => {
  it("returns the step the server named, or null when the path is done", () => {
    const steps = [
      { key: "finish_profile", title: "Finish your profile", blurb: "", href: "/artist-setup", done: true },
      { key: "drop_first_work", title: "Drop your first work", blurb: "", href: "/create", done: false },
    ];
    expect(nextStepOf(status({ steps, nextStep: "drop_first_work" }))?.key).toBe("drop_first_work");
    expect(nextStepOf(status({ steps, nextStep: null }))).toBeNull();
  });
});
