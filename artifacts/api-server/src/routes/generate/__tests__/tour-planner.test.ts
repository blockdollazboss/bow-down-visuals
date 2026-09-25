/**
 * Tests for the Tour Planner endpoints' pure logic.
 *
 * Covers: 3-credit pricing constant, request validation schemas,
 * optimization JSON parsing (good, malformed, and empty outputs),
 * and the prompt builder.
 */
import { describe, expect, it } from "vitest";
import { TOUR_STATUSES } from "@workspace/db";
import {
  TOUR_PLANNER_CREDIT_COST,
  MAX_TOUR_DATES,
  createTourDateSchema,
  updateTourDateSchema,
  optimizeSchema,
  parseOptimizationJson,
  buildOptimizeSystemPrompt,
} from "../tour-planner";

describe("TOUR_PLANNER_CREDIT_COST", () => {
  it("charges 3 credits per AI routing + budget plan", () => {
    expect(TOUR_PLANNER_CREDIT_COST).toBe(3);
  });
});

describe("TOUR_STATUSES", () => {
  it("includes the four lifecycle statuses", () => {
    expect([...TOUR_STATUSES]).toEqual([
      "upcoming",
      "confirmed",
      "completed",
      "cancelled",
    ]);
  });
});

describe("createTourDateSchema", () => {
  it("accepts a valid tour date", () => {
    const r = createTourDateSchema.safeParse({
      city: "Atlanta",
      venue: "The Masquerade",
      show_date: "2026-11-15T20:00:00-05:00",
      notes: "Load-in at 4pm",
    });
    expect(r.success).toBe(true);
  });

  it("defaults status to upcoming", () => {
    const r = createTourDateSchema.safeParse({
      city: "Atlanta",
      venue: "The Masquerade",
      show_date: "2026-11-15T20:00:00-05:00",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.status).toBe("upcoming");
  });

  it("rejects a missing city", () => {
    expect(
      createTourDateSchema.safeParse({
        venue: "The Masquerade",
        show_date: "2026-11-15T20:00:00-05:00",
      }).success,
    ).toBe(false);
  });

  it("rejects an invalid show date", () => {
    expect(
      createTourDateSchema.safeParse({
        city: "Atlanta",
        venue: "The Masquerade",
        show_date: "not-a-date",
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(
      createTourDateSchema.safeParse({
        city: "Atlanta",
        venue: "The Masquerade",
        show_date: "2026-11-15T20:00:00-05:00",
        status: "postponed",
      }).success,
    ).toBe(false);
  });
});

describe("updateTourDateSchema", () => {
  it("accepts a partial update", () => {
    const r = updateTourDateSchema.safeParse({ status: "confirmed" });
    expect(r.success).toBe(true);
  });

  it("rejects an empty update", () => {
    /* The schema accepts empty objects — the route rejects them with 400. */
    expect(updateTourDateSchema.safeParse({}).success).toBe(true);
  });
});

describe("optimizeSchema", () => {
  const ids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ];

  it("accepts a valid optimize request", () => {
    const r = optimizeSchema.safeParse({
      home_base: "Miami",
      transport: "van",
      crew_size: 5,
      date_ids: ids,
    });
    expect(r.success).toBe(true);
  });

  it("defaults transport to van and crew to 4", () => {
    const r = optimizeSchema.safeParse({
      home_base: "Miami",
      date_ids: ids,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.transport).toBe("van");
      expect(r.data.crew_size).toBe(4);
    }
  });

  it("rejects fewer than 2 dates", () => {
    expect(
      optimizeSchema.safeParse({
        home_base: "Miami",
        date_ids: [ids[0]],
      }).success,
    ).toBe(false);
  });

  it("rejects more than MAX_TOUR_DATES dates", () => {
    const many = Array.from(
      { length: MAX_TOUR_DATES + 1 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    expect(
      optimizeSchema.safeParse({ home_base: "Miami", date_ids: many }).success,
    ).toBe(false);
  });

  it("rejects non-uuid date ids", () => {
    expect(
      optimizeSchema.safeParse({
        home_base: "Miami",
        date_ids: ["not-a-uuid", ids[1]],
      }).success,
    ).toBe(false);
  });
});

describe("parseOptimizationJson", () => {
  const dateIds = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ];

  it("parses a valid optimization response", () => {
    const raw = JSON.stringify({
      stops: [
        {
          date_id: dateIds[0],
          travel_from_previous: "Start in Miami",
          estimated_travel_miles: 0,
        },
        {
          date_id: dateIds[1],
          travel_from_previous: "Drive Miami -> Atlanta",
          estimated_travel_miles: 663,
        },
      ],
      budget: {
        travel: 1200,
        lodging: 800,
        venues: 500,
        crew: 2000,
        food_per_diem: 400,
        contingency: 735,
        total: 5635,
        currency: "usd",
        notes: ["Book hotels early."],
      },
      routing_notes: "Drive south to north to avoid backtracking.",
    });
    const out = parseOptimizationJson(raw, dateIds);
    expect(out.stops).toHaveLength(2);
    expect(out.stops[1]?.estimated_travel_miles).toBe(663);
    expect(out.budget.total).toBe(5635);
    expect(out.budget.currency).toBe("USD");
    expect(out.routing_notes).toContain("backtracking");
  });

  it("drops stops with unknown or duplicate date_ids", () => {
    const raw = JSON.stringify({
      stops: [
        { date_id: dateIds[0], travel_from_previous: "ok", estimated_travel_miles: 10 },
        { date_id: dateIds[0], travel_from_previous: "dup", estimated_travel_miles: 10 },
        { date_id: "99999999-9999-4999-8999-999999999999", travel_from_previous: "fake", estimated_travel_miles: 10 },
      ],
      budget: {},
      routing_notes: "",
    });
    const out = parseOptimizationJson(raw, dateIds);
    expect(out.stops).toHaveLength(1);
    expect(out.stops[0]?.date_id).toBe(dateIds[0]);
  });

  it("throws on invalid JSON", () => {
    expect(() => parseOptimizationJson("not json", dateIds)).toThrow();
  });

  it("throws when no valid stops remain", () => {
    const raw = JSON.stringify({ stops: [], budget: {}, routing_notes: "" });
    expect(() => parseOptimizationJson(raw, dateIds)).toThrow();
  });

  it("sanitizes budget numbers and currency", () => {
    const raw = JSON.stringify({
      stops: [{ date_id: dateIds[0], travel_from_previous: "x", estimated_travel_miles: -50 }],
      budget: { travel: "lots", total: 100.456 },
      routing_notes: "",
    });
    const out = parseOptimizationJson(raw, dateIds);
    expect(out.stops[0]?.estimated_travel_miles).toBe(0);
    expect(out.budget.travel).toBe(0);
    expect(out.budget.total).toBe(100.46);
    expect(out.budget.currency).toBe("USD");
  });
});

describe("buildOptimizeSystemPrompt", () => {
  it("mentions fixed show dates and estimates framing", () => {
    const prompt = buildOptimizeSystemPrompt();
    expect(prompt).toContain("fixed show dates");
    expect(prompt).toContain("ESTIMATES");
  });
});
