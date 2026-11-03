/**
 * release-deadlines.test.ts — org wave #2, rank 6c.
 *
 * Pins the deadline engine the release calendar now watches, and the
 * Scheduler wiring that renders its flags (due strip + per-post chip
 * styling in the calendar grid).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  deadlineFlagFor,
  deadlineFlagLabel,
  flaggedDeadlines,
  type DeadlinePost,
} from "./release-deadlines";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

// Fixed "now": a Wednesday noon, local time.
const NOW = new Date(2026, 10, 4, 12, 0, 0).getTime();
const iso = (ms: number) => new Date(ms).toISOString();
const H = 3_600_000;

const post = (patch: Partial<DeadlinePost>): DeadlinePost => ({
  id: "p1",
  status: "scheduled",
  scheduledAt: iso(NOW + 7 * 24 * H),
  ...patch,
});

describe("deadlineFlagFor — the clock rules", () => {
  it("flags a scheduled post whose moment has passed as overdue", () => {
    expect(deadlineFlagFor(post({ scheduledAt: iso(NOW - H) }), NOW)).toBe("overdue");
  });

  it("flags a failed post whose moment has passed as overdue (needs a human)", () => {
    expect(deadlineFlagFor(post({ status: "failed", scheduledAt: iso(NOW - 2 * H) }), NOW)).toBe("overdue");
  });

  it("flags a post landing later today as due-today", () => {
    expect(deadlineFlagFor(post({ scheduledAt: iso(NOW + 3 * H) }), NOW)).toBe("due-today");
  });

  it("flags a post inside 48 hours (but not today) as due-soon", () => {
    expect(deadlineFlagFor(post({ scheduledAt: iso(NOW + 30 * H) }), NOW)).toBe("due-soon");
  });

  it("leaves a comfortably future post unflagged", () => {
    expect(deadlineFlagFor(post({}), NOW)).toBeNull();
  });

  it("never flags drafts, posted, canceled, publishing, or unscheduled posts", () => {
    expect(deadlineFlagFor(post({ status: "draft", scheduledAt: iso(NOW - H) }), NOW)).toBeNull();
    expect(deadlineFlagFor(post({ status: "posted", scheduledAt: iso(NOW - H) }), NOW)).toBeNull();
    expect(deadlineFlagFor(post({ status: "canceled", scheduledAt: iso(NOW - H) }), NOW)).toBeNull();
    expect(deadlineFlagFor(post({ status: "publishing", scheduledAt: iso(NOW - H) }), NOW)).toBeNull();
    expect(deadlineFlagFor(post({ scheduledAt: null }), NOW)).toBeNull();
    expect(deadlineFlagFor(post({ scheduledAt: "not-a-date" }), NOW)).toBeNull();
  });
});

describe("flaggedDeadlines — the calendar's due list", () => {
  it("returns only flagged posts, worst first, with hours late counted", () => {
    const posts = [
      post({ id: "future", scheduledAt: iso(NOW + 9 * 24 * H) }),
      post({ id: "soon", scheduledAt: iso(NOW + 30 * H) }),
      post({ id: "late-old", scheduledAt: iso(NOW - 26 * H) }),
      post({ id: "today", scheduledAt: iso(NOW + 2 * H) }),
      post({ id: "late-new", scheduledAt: iso(NOW - 2 * H) }),
    ];
    const flagged = flaggedDeadlines(posts, NOW);
    expect(flagged.map((f) => f.post.id)).toEqual(["late-old", "late-new", "today", "soon"]);
    expect(flagged[0]!.hoursLate).toBe(26);
    expect(flagged[2]!.flag).toBe("due-today");
  });

  it("labels read plainly", () => {
    expect(deadlineFlagLabel("overdue", 5)).toBe("Overdue 5h");
    expect(deadlineFlagLabel("overdue", 0)).toBe("Overdue");
    expect(deadlineFlagLabel("due-today")).toBe("Due today");
    expect(deadlineFlagLabel("due-soon")).toBe("Due soon");
  });
});

describe("scheduler wiring — the calendar watches the clock", () => {
  const src = read("../pages/scheduler.tsx");

  it("imports the deadline engine", () => {
    expect(src).toContain('from "@/lib/release-deadlines"');
    expect(src).toContain("flaggedDeadlines");
    expect(src).toContain("deadlineFlagFor");
  });

  it("renders a due strip in the calendar tab, fed by the engine", () => {
    expect(src).toContain('data-testid="scheduler-deadline-strip"');
    expect(src).toContain("deadlineFlagLabel");
  });

  it("styles overdue posts distinctly in the calendar grid", () => {
    expect(src).toContain('flag === "overdue"');
  });
});
