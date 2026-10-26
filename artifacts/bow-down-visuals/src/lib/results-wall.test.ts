/**
 * Public Results Wall (#177) — FE honesty pins.
 *
 * The wall's promise survives the trip to the screen only if the client
 * (a) labels every kind with words that match the verified number,
 * (b) refuses to render anything it cannot label honestly, and
 * (c) never lets the labeled example pose as a real result.
 */
import { describe, expect, it } from "vitest";
import {
  EXAMPLE_WALL_EVENTS,
  isResultsWallKind,
  milestoneHeadline,
  shapeWallForDisplay,
  visibleKinds,
  type WallEventWire,
} from "./results-wall";

const ev = (over: Partial<WallEventWire> = {}): WallEventWire => ({
  id: "e1",
  kind: "followers",
  threshold: 100,
  value: 100,
  detail: { source: "follows" },
  occurredAt: "2026-10-01T12:00:00.000Z",
  verifiedAt: "2026-10-01T13:00:00.000Z",
  creator: { profileId: "p1", slug: "nova", displayName: "Nova", avatarUrl: null },
  ...over,
});

describe("milestoneHeadline — words match the verified number", () => {
  it("first sale", () => {
    expect(milestoneHeadline(ev({ kind: "first_sale", threshold: 1, value: 1, detail: { source: "digital_sales" } })))
      .toBe("Made their first sale");
  });

  it("sales / followers / VB milestones carry the threshold, formatted", () => {
    expect(milestoneHeadline(ev({ kind: "sales", threshold: 25, value: 25, detail: { source: "digital_sales" } })))
      .toBe("Reached 25 sales");
    expect(milestoneHeadline(ev({ kind: "followers", threshold: 1000, value: 1000 })))
      .toBe("Reached 1,000 followers");
    expect(milestoneHeadline(ev({ kind: "vb_earned", threshold: 5000, value: 5000, detail: { source: "credit_usage" } })))
      .toBe("Earned 5,000 Visual Bucs");
  });

  it("VB earnings never render as cash", () => {
    const line = milestoneHeadline(ev({ kind: "vb_earned", threshold: 100, value: 100, detail: { source: "credit_usage" } }));
    expect(line).not.toMatch(/\$/);
    expect(line).toContain("Visual Bucs");
  });

  it("chart placement names the rank and the track when the record has one", () => {
    expect(milestoneHeadline(ev({
      kind: "chart_placement", threshold: 7, value: 7,
      detail: { source: "play_events_chart", window: "week", trackTitle: "Midnight Run" },
    }))).toBe("Charted at #7 with “Midnight Run”");
    expect(milestoneHeadline(ev({
      kind: "chart_placement", threshold: 3, value: 3,
      detail: { source: "play_events_chart", window: "week" },
    }))).toBe("Charted at #3 on the weekly chart");
  });
});

describe("shapeWallForDisplay — nothing unlabelable reaches the screen", () => {
  it("sorts newest first and caps the wall", () => {
    const rows = [
      ev({ id: "old", occurredAt: "2026-09-01T12:00:00.000Z" }),
      ev({ id: "new", occurredAt: "2026-10-02T12:00:00.000Z" }),
      ev({ id: "mid", occurredAt: "2026-09-15T12:00:00.000Z" }),
    ];
    expect(shapeWallForDisplay(rows).map((e) => e.id)).toEqual(["new", "mid", "old"]);
    expect(shapeWallForDisplay(rows, 2).map((e) => e.id)).toEqual(["new", "mid"]);
  });

  it("drops unknown kinds, malformed rows and non-arrays", () => {
    const rows = [
      ev({ id: "ok" }),
      { ...ev({ id: "bad-kind" }), kind: "lottery_win" },
      { ...ev({ id: "bad-date" }), occurredAt: "not a date" },
      { id: "no-creator" },
      null,
      "junk",
    ];
    expect(shapeWallForDisplay(rows).map((e) => e.id)).toEqual(["ok"]);
    expect(shapeWallForDisplay(undefined)).toEqual([]);
    expect(shapeWallForDisplay({ events: [] })).toEqual([]);
  });
});

describe("kinds + visibility helpers", () => {
  it("isResultsWallKind accepts only the five verified kinds", () => {
    for (const k of ["first_sale", "sales", "followers", "vb_earned", "chart_placement"]) {
      expect(isResultsWallKind(k)).toBe(true);
    }
    for (const k of ["views", "lottery_win", "", null, 7]) {
      expect(isResultsWallKind(k)).toBe(false);
    }
  });

  it("visibleKinds subtracts hidden kinds, keeping display order", () => {
    expect(visibleKinds(["vb_earned"])).toEqual(["first_sale", "sales", "followers", "chart_placement"]);
    expect(visibleKinds([])).toHaveLength(5);
    expect(visibleKinds(["bogus"])).toHaveLength(5);
  });
});

describe("the labeled example — Thy Cheat Code, flagged, never real", () => {
  it("every example is flagged example:true and uses the official account", () => {
    expect(EXAMPLE_WALL_EVENTS.length).toBeGreaterThan(0);
    for (const e of EXAMPLE_WALL_EVENTS) {
      expect(e.example).toBe(true);
      expect(e.creator.slug).toBe("thy-cheat-code");
      expect(e.creator.displayName).toBe("Thy Cheat Code");
    }
  });

  it("example ids are namespaced so they can never collide with a real event", () => {
    for (const e of EXAMPLE_WALL_EVENTS) {
      expect(e.id.startsWith("example-")).toBe(true);
    }
  });
});
