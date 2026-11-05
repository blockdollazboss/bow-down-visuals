/**
 * tour-desk — the Tour Planner desk's pure logic seam
 * (stack1600 world parity wave #4, desk #97, census item B2).
 *
 * THE FEATURE (website): the Tour Planner (pages/tour.tsx,
 * helpers in lib/tour.ts) — keep the run's dates (city, venue,
 * show date, status, notes) and, when there are at least two,
 * ask the AI for the smart route: an optimal stop order that
 * minimizes travel plus a budget estimate (travel, lodging,
 * venues, crew, food per-diem, contingency). The dates are the
 * member's real rows on the server — the desk and the page are
 * two faces of ONE list, exactly like the saves shelf.
 *
 * THE RAILS (api-server routes/generate/tour-planner.ts,
 * requireAuth):
 *   GET    /api/tour/dates → { dates: [row] } — the member's
 *          dates, show-date ascending. FREE.
 *   POST   /api/tour/dates { city, venue, show_date, notes?,
 *          status? } → 201 { date: row }. FREE.
 *   PUT    /api/tour/dates/:id (partial) → { date: row }. FREE.
 *   DELETE /api/tour/dates/:id → { deleted: true }. FREE.
 *   POST   /api/tour/optimize { home_base, transport?,
 *          crew_size?, date_ids[2..30] } → { stops, budget,
 *          routing_notes, creditsUsed, creditsRemaining }.
 *          300 VB, charged BEFORE the model call and refunded
 *          if the provider call fails (the rail's own words);
 *          402 out_of_credits when the balance can't cover it.
 *
 * PRICE — READ from the credit-cost registry: 300, the route's
 * TOUR_PLANNER_CREDIT_COST, under the ledger action
 * "Tour Planner — AI routing + budget" (the registry feature
 * carries the same words; the row was added with this desk —
 * before it, the rail charged with no registry row to quote
 * and the /tour page hardcoded its badge). Date CRUD is free,
 * exactly like the page.
 *
 * CONFIRMATION DISCIPLINE: the page posts the optimizer
 * without a spend confirmation; the desk upgrades the run to
 * confirmedFetch with the registry cost as the explicit
 * quote, exactly like the Setlist desk's flow. A decline
 * runs nothing. The desk adds no retry of its own — the
 * rail's charge-before / refund-on-failure is the
 * exactly-once story.
 *
 * PLAN DISCIPLINE, THE PAGE'S OWN: the plan is cached in
 * localStorage (lib/tour's bdv-tour-plan) shared with the
 * page; any date mutation (add / edit / delete) invalidates
 * it on both faces, because its stops may reference a date
 * that changed or went away.
 *
 * DRIFT DISCIPLINE: a listed row with no id/city/venue, an
 * unparseable show date, or a status outside the schema's
 * four is dropped — never dressed up. A plan whose stops
 * don't re-key exactly onto the requested dates, or whose
 * budget is missing a figure, reads as failure (the rail
 * refunds exactly those answers; the desk treats a drifted
 * body the same way).
 */
import { getCreditCost } from "../credit-costs";
import {
  datetimeLocalToIso,
  isoToDatetimeLocal,
  type BudgetBreakdown,
  type OptimizedStop,
  type TourDate,
} from "../tour";

function registryCost(path: string): number {
  const cost = getCreditCost(path)?.cost;
  if (typeof cost !== "number") {
    throw new Error(`tour-desk: no credit-cost registry entry for ${path}`);
  }
  return cost;
}

export const TOUR_DATES_PATH = "/api/tour/dates";
export const TOUR_OPTIMIZE_PATH = "/api/tour/optimize";

export function tourDatePath(id: string): string {
  return `${TOUR_DATES_PATH}/${encodeURIComponent(id)}`;
}

export const TOUR_OPTIMIZE_COST = registryCost(TOUR_OPTIMIZE_PATH);
export const TOUR_OPTIMIZE_FEATURE = "Tour Planner — AI routing + budget";

/** The schema's lifecycle (lib/db TOUR_STATUSES — pinned in tests). */
export const TOUR_STATUSES = ["upcoming", "confirmed", "completed", "cancelled"] as const;
export type TourStatus = (typeof TOUR_STATUSES)[number];

export const TOUR_STATUS_LABELS: Record<TourStatus, string> = {
  upcoming: "Upcoming",
  confirmed: "Confirmed",
  completed: "Completed",
  cancelled: "Cancelled",
};

/** The optimizer schema's transport modes (rail enum — pinned). */
export const TOUR_TRANSPORTS = ["van", "bus", "flights", "mixed"] as const;
export type TourTransport = (typeof TOUR_TRANSPORTS)[number];

export const TOUR_TRANSPORT_LABELS: Record<TourTransport, string> = {
  van: "Van",
  bus: "Tour bus",
  flights: "Flights",
  mixed: "Mixed",
};

/** Rail bounds (routes/generate/tour-planner.ts — pinned in tests). */
export const MAX_TOUR_DATES = 30;
export const TOUR_CREW_MIN = 1;
export const TOUR_CREW_MAX = 50;
/** The create/update schemas' field ceilings. */
export const TOUR_CITY_MAX = 120;
export const TOUR_VENUE_MAX = 200;
export const TOUR_NOTES_MAX = 1000;
export const TOUR_HOME_BASE_MAX = 120;

/* ── The date draft (the composer's working shape) ────────────────── */

export interface TourDateDraft {
  city: string;
  venue: string;
  /** A datetime-local input value ("2026-11-15T20:00"). */
  showDateLocal: string;
  notes: string;
  status: TourStatus;
}

export const EMPTY_TOUR_DRAFT: TourDateDraft = {
  city: "",
  venue: "",
  showDateLocal: "",
  notes: "",
  status: "upcoming",
};

export function draftOfDate(d: TourDate): TourDateDraft {
  return {
    city: d.city,
    venue: d.venue,
    showDateLocal: isoToDatetimeLocal(d.show_date),
    notes: d.notes ?? "",
    status: d.status,
  };
}

/**
 * The draft's problem, in the rail schema's own terms — null
 * when the rail would accept it. Mirrors createTourDateSchema /
 * updateTourDateSchema (required city/venue, a real datetime,
 * the field ceilings); the page's validateTourDateForm covers
 * the same ground in its words.
 */
export interface TourDraftErrorStrings {
  cityRequired: string;
  cityTooLong: string;
  venueRequired: string;
  venueTooLong: string;
  dateRequired: string;
  dateInvalid: string;
  notesTooLong: string;
  pickStatus: string;
}

export const TOUR_DRAFT_ERROR_DEFAULTS: TourDraftErrorStrings = {
  cityRequired: "City is required.",
  cityTooLong: "City is too long.",
  venueRequired: "Venue is required.",
  venueTooLong: "Venue is too long.",
  dateRequired: "Show date is required.",
  dateInvalid: "Show date is invalid.",
  notesTooLong: "Notes are too long.",
  pickStatus: "Pick a status.",
};

export function tourDraftError(draft: TourDateDraft, s: TourDraftErrorStrings = TOUR_DRAFT_ERROR_DEFAULTS): string | null {
  if (!draft.city.trim()) return s.cityRequired;
  if (draft.city.trim().length > TOUR_CITY_MAX) return s.cityTooLong;
  if (!draft.venue.trim()) return s.venueRequired;
  if (draft.venue.trim().length > TOUR_VENUE_MAX) return s.venueTooLong;
  if (!draft.showDateLocal) return s.dateRequired;
  if (Number.isNaN(new Date(draft.showDateLocal).getTime())) return s.dateInvalid;
  if (draft.notes.length > TOUR_NOTES_MAX) return s.notesTooLong;
  if (!(TOUR_STATUSES as readonly string[]).includes(draft.status)) return s.pickStatus;
  return null;
}

/** The page's exact save body (create POST and update PUT alike). */
export function buildTourDatePayload(draft: TourDateDraft) {
  return {
    city: draft.city.trim(),
    venue: draft.venue.trim(),
    show_date: datetimeLocalToIso(draft.showDateLocal),
    notes: draft.notes.trim(),
    status: draft.status,
  };
}

/* ── The optimizer ────────────────────────────────────────────────── */

export interface TourOptimizeInput {
  homeBase: string;
  transport: TourTransport;
  crewSize: number;
}

/** Crew size clamped to the rail schema's 1..50, whole people. */
export function clampCrewSize(n: number): number {
  if (!Number.isFinite(n)) return 4;
  return Math.min(TOUR_CREW_MAX, Math.max(TOUR_CREW_MIN, Math.floor(n)));
}

/** The rail's bar: at least 2 dates and a named home base. */
export function optimizeReady(dates: readonly TourDate[], input: TourOptimizeInput): boolean {
  return (
    dates.length >= 2 &&
    dates.length <= MAX_TOUR_DATES &&
    input.homeBase.trim().length > 0 &&
    input.homeBase.trim().length <= TOUR_HOME_BASE_MAX
  );
}

/** The page's exact optimizer body. */
export function buildOptimizePayload(dates: readonly TourDate[], input: TourOptimizeInput) {
  return {
    home_base: input.homeBase.trim(),
    transport: input.transport,
    crew_size: clampCrewSize(input.crewSize),
    date_ids: dates.map((d) => d.id),
  };
}

/* ── Response guards (drift discipline) ───────────────────────────── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function dateOf(raw: unknown): TourDate | null {
  if (!isRecord(raw)) return null;
  const id = str(raw["id"]);
  const city = str(raw["city"]);
  const venue = str(raw["venue"]);
  const showDate = str(raw["show_date"]);
  const status = str(raw["status"]);
  if (!id || !city || !venue || !showDate) return null;
  if (Number.isNaN(new Date(showDate).getTime())) return null;
  if (!(TOUR_STATUSES as readonly string[]).includes(status)) return null;
  const notes = raw["notes"];
  return {
    id,
    city,
    venue,
    show_date: showDate,
    notes: typeof notes === "string" ? notes : null,
    status: status as TourStatus,
  };
}

export function tourDatesOfResponse(data: unknown): TourDate[] | null {
  if (!isRecord(data) || !Array.isArray(data["dates"])) return null;
  const out: TourDate[] = [];
  for (const row of data["dates"]) {
    const d = dateOf(row);
    if (d) out.push(d);
  }
  return out;
}

export function tourDateOfResponse(data: unknown): TourDate | null {
  if (!isRecord(data)) return null;
  return dateOf(data["date"]);
}

export interface TourPlanResult {
  stops: OptimizedStop[];
  budget: BudgetBreakdown;
  routingNotes: string;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function budgetOf(raw: unknown): BudgetBreakdown | null {
  if (!isRecord(raw)) return null;
  const travel = num(raw["travel"]);
  const lodging = num(raw["lodging"]);
  const venues = num(raw["venues"]);
  const crew = num(raw["crew"]);
  const food = num(raw["food_per_diem"]);
  const contingency = num(raw["contingency"]);
  const total = num(raw["total"]);
  if (
    travel === null || lodging === null || venues === null || crew === null ||
    food === null || contingency === null || total === null
  ) {
    return null;
  }
  const notesRaw = raw["notes"];
  return {
    travel,
    lodging,
    venues,
    crew,
    food_per_diem: food,
    contingency,
    total,
    currency: str(raw["currency"]) || "USD",
    notes: Array.isArray(notesRaw)
      ? notesRaw.filter((n): n is string => typeof n === "string")
      : [],
  };
}

/**
 * The plan guard — the rail re-keys every stop onto the
 * member's real dates, so a body whose stops don't cover the
 * requested ids exactly (each once, in order) or whose budget
 * is incomplete is not a plan; it reads as failure.
 */
export function planOfResponse(data: unknown, requestedIds: readonly string[]): TourPlanResult | null {
  if (!isRecord(data) || !Array.isArray(data["stops"])) return null;
  const budget = budgetOf(data["budget"]);
  if (!budget) return null;
  const wanted = new Set(requestedIds);
  const seen = new Set<string>();
  const stops: OptimizedStop[] = [];
  for (const raw of data["stops"]) {
    if (!isRecord(raw)) return null;
    const dateId = str(raw["date_id"]);
    if (!wanted.has(dateId) || seen.has(dateId)) return null;
    seen.add(dateId);
    const miles = raw["estimated_travel_miles"];
    stops.push({
      date_id: dateId,
      city: str(raw["city"]),
      venue: str(raw["venue"]),
      show_date: str(raw["show_date"]),
      order: stops.length + 1,
      travel_from_previous: str(raw["travel_from_previous"]),
      estimated_travel_miles: typeof miles === "number" && Number.isFinite(miles) ? miles : null,
    });
  }
  if (stops.length === 0 || seen.size !== wanted.size) return null;
  return { stops, budget, routingNotes: str(data["routing_notes"]) };
}

/** Remove one date from the list (delete's local face). */
export function withoutTourDate(dates: readonly TourDate[], id: string): TourDate[] {
  return dates.filter((d) => d.id !== id);
}
