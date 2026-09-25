/**
 * Unit tests for the Tour Planner lib helpers (/tour page).
 * Pure functions — no React, no network.
 */
import { describe, expect, it } from "vitest";
import {
  showDateLabel,
  showDateTimeLabel,
  datetimeLocalToIso,
  isoToDatetimeLocal,
  sortDatesChronologically,
  daysUntil,
  formatMoney,
  totalMiles,
  validateTourDateForm,
  loadTourPlan,
  saveTourPlan,
  clearTourPlan,
  buildPromoChecklist,
  TOUR_PLAN_KEY,
  type TourDate,
  type TourPlan,
} from "./tour";

function memStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  };
}

describe("showDateLabel", () => {
  it("formats an ISO date with weekday, month, and day", () => {
    /* Use a UTC noon date so the calendar day is stable in any timezone. */
    const label = showDateLabel("2026-11-15T12:00:00Z");
    expect(label).toMatch(/Nov 1[45]/);
    expect(label).toMatch(/^(Mon|Sun),/);
  });

  it("returns the raw input for garbage", () => {
    expect(showDateLabel("garbage")).toBe("garbage");
  });
});

describe("showDateTimeLabel", () => {
  it("includes a time", () => {
    const label = showDateTimeLabel("2026-11-15T12:00:00Z");
    expect(label).toMatch(/Nov 1[45]/);
    expect(label).toMatch(/PM|AM/);
  });
});

describe("datetimeLocalToIso / isoToDatetimeLocal", () => {
  it("round-trips a datetime", () => {
    const local = "2026-11-15T20:00";
    const iso = datetimeLocalToIso(local);
    expect(iso).toMatch(/2026-11-1/);
    const back = isoToDatetimeLocal(iso);
    expect(back).toBe(local);
  });

  it("returns empty string for invalid input", () => {
    expect(datetimeLocalToIso("nope")).toBe("");
    expect(isoToDatetimeLocal("nope")).toBe("");
  });
});

describe("sortDatesChronologically", () => {
  it("sorts ascending without mutating", () => {
    const a: TourDate = {
      id: "a",
      city: "B",
      venue: "V",
      show_date: "2026-12-01T20:00:00Z",
      status: "upcoming",
    };
    const b: TourDate = {
      id: "b",
      city: "A",
      venue: "V",
      show_date: "2026-11-01T20:00:00Z",
      status: "upcoming",
    };
    const input = [a, b];
    const out = sortDatesChronologically(input);
    expect(out[0]?.id).toBe("b");
    expect(out[1]?.id).toBe("a");
    expect(input[0]?.id).toBe("a"); // untouched
  });
});

describe("daysUntil", () => {
  it("computes days until a future show", () => {
    const now = Date.parse("2026-11-01T00:00:00Z");
    expect(daysUntil("2026-11-06T20:00:00Z", now)).toBe(5);
  });

  it("is negative for past shows", () => {
    const now = Date.parse("2026-11-10T00:00:00Z");
    expect(daysUntil("2026-11-06T20:00:00Z", now)).toBeLessThan(0);
  });
});

describe("formatMoney", () => {
  it("formats USD with no decimals", () => {
    expect(formatMoney(5635, "USD")).toBe("$5,635");
  });

  it("falls back for unknown currency", () => {
    expect(formatMoney(100, "XXX")).toMatch(/100/);
  });
});

describe("totalMiles", () => {
  it("sums estimated miles, treating null as 0", () => {
    expect(
      totalMiles([
        {
          date_id: "a",
          city: "A",
          venue: "V",
          show_date: "2026-11-01T20:00:00Z",
          order: 1,
          travel_from_previous: "",
          estimated_travel_miles: 250,
        },
        {
          date_id: "b",
          city: "B",
          venue: "V",
          show_date: "2026-11-02T20:00:00Z",
          order: 2,
          travel_from_previous: "",
          estimated_travel_miles: null,
        },
      ]),
    ).toBe(250);
  });
});

describe("validateTourDateForm", () => {
  it("accepts a complete form", () => {
    expect(
      validateTourDateForm({
        city: "Atlanta",
        venue: "Masquerade",
        show_date: "2026-11-15T20:00",
      }),
    ).toBeNull();
  });

  it("rejects missing city / venue / date", () => {
    expect(
      validateTourDateForm({ city: "", venue: "V", show_date: "2026-11-15T20:00" }),
    ).toBe("City is required.");
    expect(
      validateTourDateForm({ city: "A", venue: " ", show_date: "2026-11-15T20:00" }),
    ).toBe("Venue is required.");
    expect(
      validateTourDateForm({ city: "A", venue: "V", show_date: "" }),
    ).toBe("Show date is required.");
  });

  it("rejects an invalid date", () => {
    expect(
      validateTourDateForm({ city: "A", venue: "V", show_date: "nope" }),
    ).toBe("Show date is invalid.");
  });
});

describe("tour plan storage", () => {  const plan: TourPlan = {
    stops: [],
    budget: {
      travel: 0,
      lodging: 0,
      venues: 0,
      crew: 0,
      food_per_diem: 0,
      contingency: 0,
      total: 0,
      currency: "USD",
      notes: [],
    },
    routing_notes: "",
    created_at: new Date().toISOString(),
  };

  it("saves and loads a plan", () => {
    const s = memStorage();
    saveTourPlan(plan, s);
    expect(s.getItem(TOUR_PLAN_KEY)).not.toBeNull();
    expect(loadTourPlan(s)).toEqual(plan);
  });

  it("returns null when nothing is stored", () => {
    expect(loadTourPlan(memStorage())).toBeNull();
  });

  it("returns null for corrupt JSON", () => {
    const s = memStorage();
    s.setItem(TOUR_PLAN_KEY, "{nope");
    expect(loadTourPlan(s)).toBeNull();
  });

  it("clears the plan", () => {
    const s = memStorage();
    saveTourPlan(plan, s);
    clearTourPlan(s);
    expect(loadTourPlan(s)).toBeNull();
  });
});

describe("buildPromoChecklist", () => {
  it("builds 5 checklist items mentioning the city", () => {
    const items = buildPromoChecklist("Atlanta", "Sat, Nov 15");
    expect(items).toHaveLength(5);
    expect(items.map((i) => i.id)).toEqual([
      "announce",
      "teaser",
      "local",
      "reminder",
      "recap",
    ]);
    expect(items[0]?.detail).toContain("Atlanta");
    expect(items[4]?.detail).toContain("Sat, Nov 15");
  });

  it("links scheduler and promo clips where relevant", () => {
    const items = buildPromoChecklist("Atlanta", "Sat, Nov 15");
    const linked = items.filter((i) => i.link);
    expect(linked.length).toBeGreaterThanOrEqual(2);
    expect(linked.every((i) => i.link!.href.startsWith("/"))).toBe(true);
  });
});
