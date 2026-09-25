/* Pure helpers for the Tour Planner (/tour).
   Kept in a lib module so they are unit-testable without React. */

export const TOUR_DATES_KEY = "bdv-tour-dates";
export const TOUR_PLAN_KEY = "bdv-tour-plan";

export interface TourDate {
  id: string;
  city: string;
  venue: string;
  show_date: string; // ISO
  notes?: string | null;
  status: "upcoming" | "confirmed" | "completed" | "cancelled";
}

export interface OptimizedStop {
  date_id: string;
  city: string;
  venue: string;
  show_date: string;
  order: number;
  travel_from_previous: string;
  estimated_travel_miles: number | null;
}

export interface BudgetBreakdown {
  travel: number;
  lodging: number;
  venues: number;
  crew: number;
  food_per_diem: number;
  contingency: number;
  total: number;
  currency: string;
  notes: string[];
}

export interface TourPlan {
  stops: OptimizedStop[];
  budget: BudgetBreakdown;
  routing_notes: string;
  created_at: string;
}

/** "Sat, Nov 15" style label for an ISO date. */
export function showDateLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "Sat, Nov 15 · 8:00 PM" for datetime-local prefill or display. */
export function showDateTimeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Convert a datetime-local input value to an ISO string with offset. */
export function datetimeLocalToIso(local: string): string {
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/** Convert an ISO date to a datetime-local input value (local tz). */
export function isoToDatetimeLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Sort dates chronologically (ascending). Never mutates the input. */
export function sortDatesChronologically(dates: TourDate[]): TourDate[] {
  return [...dates].sort(
    (a, b) => new Date(a.show_date).getTime() - new Date(b.show_date).getTime(),
  );
}

/** Days until a show (negative = past). */
export function daysUntil(iso: string, now: number = Date.now()): number {
  const ms = new Date(iso).getTime() - now;
  return Math.floor(ms / 86_400_000);
}

/** Format a money value with 0 decimals. */
export function formatMoney(amount: number, currency: string = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount).toLocaleString("en-US")}`;
  }
}

/** Sum of estimated travel miles across optimized stops. */
export function totalMiles(stops: OptimizedStop[]): number {
  return stops.reduce((sum, s) => sum + (s.estimated_travel_miles ?? 0), 0);
}

/** Validate a new/edited tour date form. Returns an error string or null. */
export function validateTourDateForm(input: {
  city: string;
  venue: string;
  show_date: string;
}): string | null {
  if (!input.city.trim()) return "City is required.";
  if (!input.venue.trim()) return "Venue is required.";
  if (!input.show_date) return "Show date is required.";
  const d = new Date(input.show_date);
  if (Number.isNaN(d.getTime())) return "Show date is invalid.";
  return null;
}

/** Load the cached plan from localStorage; never throws. */
export function loadTourPlan(
  storage: Pick<Storage, "getItem"> = localStorage,
): TourPlan | null {
  try {
    const raw = storage.getItem(TOUR_PLAN_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const p = parsed as Partial<TourPlan>;
    if (!Array.isArray(p.stops) || typeof p.budget !== "object") return null;
    return parsed as TourPlan;
  } catch {
    return null;
  }
}

/** Persist the plan; never throws. */
export function saveTourPlan(
  plan: TourPlan,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  try {
    storage.setItem(TOUR_PLAN_KEY, JSON.stringify(plan));
  } catch {
    /* ignore */
  }
}

/** Clear the cached plan; never throws. */
export function clearTourPlan(
  storage: Pick<Storage, "removeItem"> = localStorage,
): void {
  try {
    storage.removeItem(TOUR_PLAN_KEY);
  } catch {
    /* ignore */
  }
}

/* Promo checklist items generated per city — static templates, no AI cost. */
export interface PromoChecklistItem {
  id: string;
  label: string;
  detail: string;
  link?: { label: string; href: string };
}

export function buildPromoChecklist(city: string, showDate: string): PromoChecklistItem[] {
  return [
    {
      id: "announce",
      label: "Announce the show",
      detail: `Post the ${city} date with venue, date, and ticket link. Tag the venue.`,
      link: { label: "Open Content Scheduler", href: "/scheduler" },
    },
    {
      id: "teaser",
      label: "Drop a teaser clip",
      detail: "Cut a 15-30s performance teaser for Reels/TikTok/Shorts.",
      link: { label: "Open Promo Clips", href: "/promo-clips" },
    },
    {
      id: "local",
      label: "Hit local pages",
      detail: `DM ${city} event pages, local blogs, and playlist curators about the show.`,
    },
    {
      id: "reminder",
      label: "48-hour reminder",
      detail: "Story + post reminder 2 days before the show. Pin it.",
      link: { label: "Open Content Scheduler", href: "/scheduler" },
    },
    {
      id: "recap",
      label: "Post-show recap",
      detail: `Film crowd shots at the ${city} show (${showDate}) — recap content performs.`,
    },
  ];
}
