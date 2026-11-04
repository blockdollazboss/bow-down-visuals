import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getCreditCost } from "../credit-costs";
import {
  EMPTY_TOUR_DRAFT,
  MAX_TOUR_DATES,
  TOUR_OPTIMIZE_COST,
  TOUR_OPTIMIZE_FEATURE,
  TOUR_OPTIMIZE_PATH,
  TOUR_STATUSES,
  TOUR_TRANSPORTS,
  buildOptimizePayload,
  buildTourDatePayload,
  clampCrewSize,
  draftOfDate,
  optimizeReady,
  planOfResponse,
  tourDateOfResponse,
  tourDatePath,
  tourDatesOfResponse,
  tourDraftError,
  withoutTourDate,
  type TourDateDraft,
} from "./tour-desk";
import type { TourDate } from "../tour";

const routeSrc = readFileSync(
  resolve(process.cwd(), "../api-server/src/routes/generate/tour-planner.ts"),
  "utf-8",
);
const schemaSrc = readFileSync(
  resolve(process.cwd(), "../../lib/db/src/schema/tour.ts"),
  "utf-8",
);

function railCostDefault(): number {
  const m = routeSrc.match(/TOUR_PLANNER_CREDIT_COST[^\n]*\|\|\s*(\d+)/);
  if (!m) throw new Error("could not derive TOUR_PLANNER_CREDIT_COST from the route");
  return Number(m[1]);
}

function date(id: string, over: Partial<TourDate> = {}): TourDate {
  return {
    id,
    city: "Atlanta",
    venue: "The Loft",
    show_date: "2026-11-15T20:00:00.000Z",
    notes: null,
    status: "upcoming",
    ...over,
  };
}

const GOOD_BUDGET = {
  travel: 900,
  lodging: 600,
  venues: 400,
  crew: 500,
  food_per_diem: 300,
  contingency: 270,
  total: 2970,
  currency: "USD",
  notes: ["Fuel at current prices."],
};

function goodPlanBody(ids: string[]) {
  return {
    stops: ids.map((id, i) => ({
      date_id: id,
      city: "Atlanta",
      venue: "The Loft",
      show_date: "2026-11-15T20:00:00.000Z",
      order: i + 1,
      travel_from_previous: i === 0 ? "Departure from home base" : "Drive east",
      estimated_travel_miles: i === 0 ? 0 : 420,
    })),
    budget: GOOD_BUDGET,
    routing_notes: "Run the coast in order.",
    creditsUsed: 300,
    creditsRemaining: 700,
  };
}

describe("tour-desk — the registry row the desk quotes (stack1600 wave 4)", () => {
  it("registered at the rail's own cost under its ledger action", () => {
    expect(railCostDefault()).toBe(300);
    expect(getCreditCost(TOUR_OPTIMIZE_PATH)).toEqual({
      cost: railCostDefault(),
      feature: "Tour Planner — AI routing + budget",
    });
    expect(TOUR_OPTIMIZE_COST).toBe(railCostDefault());
    expect(TOUR_OPTIMIZE_FEATURE).toBe("Tour Planner — AI routing + budget");
  });

  it("the rail charges under exactly that ledger action", () => {
    expect(routeSrc).toContain(`"${TOUR_OPTIMIZE_FEATURE}"`);
  });

  it("the rail refunds a failed provider call (the desk's honesty copy rides on it)", () => {
    expect(routeSrc).toContain("refundCredits");
    expect(routeSrc).toMatch(/out_of_credits/);
  });
});

describe("tour-desk — enums mirror the rail + schema", () => {
  it("statuses match the db schema's TOUR_STATUSES", () => {
    const m = schemaSrc.match(/TOUR_STATUSES\s*=\s*\[([^\]]+)\]/);
    if (!m) throw new Error("TOUR_STATUSES not found in the schema");
    const fromSchema = [...m[1]!.matchAll(/"([a-z]+)"/g)].map((x) => x[1]);
    expect([...TOUR_STATUSES]).toEqual(fromSchema);
  });

  it("transports match the route's optimizer schema enum", () => {
    expect(routeSrc).toContain('z.enum(["van", "bus", "flights", "mixed"])');
    expect([...TOUR_TRANSPORTS]).toEqual(["van", "bus", "flights", "mixed"]);
  });

  it("bounds match the rail (30 dates, crew 1..50)", () => {
    expect(routeSrc).toContain("MAX_TOUR_DATES = 30");
    expect(MAX_TOUR_DATES).toBe(30);
    expect(routeSrc).toMatch(/crew_size[\s\S]{0,120}?\.min\(1\)\.max\(50\)/);
  });
});

describe("tour-desk — payloads (the page's exact bodies)", () => {
  it("date payload trims and converts the local datetime to ISO", () => {
    const draft: TourDateDraft = {
      city: " Atlanta ",
      venue: " The Loft ",
      showDateLocal: "2026-11-15T20:00",
      notes: " load-in 5pm ",
      status: "confirmed",
    };
    const body = buildTourDatePayload(draft);
    expect(Object.keys(body).sort()).toEqual(["city", "notes", "show_date", "status", "venue"]);
    expect(body.city).toBe("Atlanta");
    expect(body.venue).toBe("The Loft");
    expect(body.notes).toBe("load-in 5pm");
    expect(body.status).toBe("confirmed");
    expect(body.show_date).toBe(new Date("2026-11-15T20:00").toISOString());
  });

  it("optimize payload sends every date id in list order", () => {
    const body = buildOptimizePayload([date("a"), date("b"), date("c")], {
      homeBase: " Nashville ",
      transport: "bus",
      crewSize: 6,
    });
    expect(body).toEqual({
      home_base: "Nashville",
      transport: "bus",
      crew_size: 6,
      date_ids: ["a", "b", "c"],
    });
  });

  it("crew size clamps to the rail schema", () => {
    expect(clampCrewSize(0)).toBe(1);
    expect(clampCrewSize(99)).toBe(50);
    expect(clampCrewSize(4.7)).toBe(4);
    expect(clampCrewSize(Number.NaN)).toBe(4);
  });

  it("optimizeReady enforces the rail's bar", () => {
    const two = [date("a"), date("b")];
    expect(optimizeReady(two, { homeBase: "Nashville", transport: "van", crewSize: 4 })).toBe(true);
    expect(optimizeReady([date("a")], { homeBase: "Nashville", transport: "van", crewSize: 4 })).toBe(false);
    expect(optimizeReady(two, { homeBase: "  ", transport: "van", crewSize: 4 })).toBe(false);
  });
});

describe("tour-desk — the draft guard mirrors the rail schema", () => {
  const ok: TourDateDraft = {
    city: "Atlanta",
    venue: "The Loft",
    showDateLocal: "2026-11-15T20:00",
    notes: "",
    status: "upcoming",
  };
  it("accepts a rail-shaped draft", () => {
    expect(tourDraftError(ok)).toBeNull();
  });
  it("refuses the blanks the schema refuses", () => {
    expect(tourDraftError({ ...ok, city: " " })).toBe("City is required.");
    expect(tourDraftError({ ...ok, venue: "" })).toBe("Venue is required.");
    expect(tourDraftError({ ...ok, showDateLocal: "" })).toBe("Show date is required.");
    expect(tourDraftError({ ...ok, showDateLocal: "not-a-date" })).toBe("Show date is invalid.");
  });
  it("refuses over-ceiling fields", () => {
    expect(tourDraftError({ ...ok, city: "x".repeat(121) })).toBe("City is too long.");
    expect(tourDraftError({ ...ok, venue: "x".repeat(201) })).toBe("Venue is too long.");
    expect(tourDraftError({ ...ok, notes: "x".repeat(1001) })).toBe("Notes are too long.");
  });
  it("the edit draft round-trips a row back to a local datetime", () => {
    const d = draftOfDate(date("a", { notes: "soundcheck", status: "confirmed" }));
    expect(d.city).toBe("Atlanta");
    expect(d.status).toBe("confirmed");
    expect(d.notes).toBe("soundcheck");
    expect(d.showDateLocal).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(EMPTY_TOUR_DRAFT.status).toBe("upcoming");
  });
});

describe("tour-desk — response guards (drift discipline)", () => {
  it("keeps good rows, drops drifted ones, never dresses a broken envelope", () => {
    const rows = tourDatesOfResponse({
      dates: [
        date("a"),
        { id: "b", city: "", venue: "V", show_date: "2026-11-16T20:00:00.000Z", status: "upcoming" },
        { id: "c", city: "X", venue: "V", show_date: "junk", status: "upcoming" },
        { id: "d", city: "X", venue: "V", show_date: "2026-11-17T20:00:00.000Z", status: "pending" },
        "nope",
      ],
    });
    expect(rows?.map((r) => r.id)).toEqual(["a"]);
    expect(tourDatesOfResponse({})).toBeNull();
    expect(tourDatesOfResponse(null)).toBeNull();
    expect(tourDatesOfResponse({ dates: "nope" })).toBeNull();
  });

  it("a saved row reads back; a drifted one does not", () => {
    expect(tourDateOfResponse({ date: date("a") })?.id).toBe("a");
    expect(tourDateOfResponse({ date: { id: "a" } })).toBeNull();
    expect(tourDateOfResponse({})).toBeNull();
  });

  it("the plan must re-key exactly onto the requested dates", () => {
    const plan = planOfResponse(goodPlanBody(["a", "b"]), ["a", "b"]);
    expect(plan?.stops.map((s) => s.date_id)).toEqual(["a", "b"]);
    expect(plan?.stops.map((s) => s.order)).toEqual([1, 2]);
    expect(plan?.budget.total).toBe(2970);
    expect(plan?.routingNotes).toBe("Run the coast in order.");
    // A stop the member never asked for, a missing stop, a dupe,
    // or a broken budget all read as failure — never a plan.
    expect(planOfResponse(goodPlanBody(["a", "zzz"]), ["a", "b"])).toBeNull();
    expect(planOfResponse(goodPlanBody(["a"]), ["a", "b"])).toBeNull();
    expect(planOfResponse(goodPlanBody(["a", "a"]), ["a", "b"])).toBeNull();
    const noBudget = { ...goodPlanBody(["a", "b"]), budget: { travel: 1 } };
    expect(planOfResponse(noBudget, ["a", "b"])).toBeNull();
    expect(planOfResponse({}, ["a", "b"])).toBeNull();
  });

  it("delete removes exactly one row and paths encode ids", () => {
    expect(withoutTourDate([date("a"), date("b")], "a").map((d) => d.id)).toEqual(["b"]);
    expect(tourDatePath("a b")).toBe("/api/tour/dates/a%20b");
  });
});
