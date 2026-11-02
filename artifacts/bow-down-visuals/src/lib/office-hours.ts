/**
 * office-hours.ts — FE helpers for the Office Hours 2D door (#167).
 *
 * Office Hours is the one VB-priced storefront service shape: the
 * server rail (api lib/office-hours.ts) owns the money and the slot
 * machine; everything here is pure presentation/form logic that
 * mirrors the rail's own rules so the door can never drift from it:
 *  - officeHoursPriceVb mirrors officeHoursInfo's validity exactly
 *    (flag on + integer price_vb > 0), so a service the server would
 *    refuse to book never renders a book button here;
 *  - the availability form model round-trips the rail's
 *    BookingAvailability shape (weekly windows in the creator's
 *    timezone, weekday 0 = Sunday). The form offers ONE window per
 *    weekday; a stored availability with several windows on one day
 *    collapses to the widest span when loaded into the form.
 *  - slot grouping re-buckets the server's creator-date days into the
 *    VIEWER's local dates — the server stores UTC instants and the
 *    booking itself is timezone-free; only the rendering converts.
 */
import type { BookingAvailabilityDTO, ServiceDetails } from "./storefront-api";

/** The VB price of an Office Hours service, or null when the service
 *  is not a valid Office Hours offer (flag off, or price missing /
 *  non-integer / non-positive — the server refuses those too). */
export function officeHoursPriceVb(
  sd: ServiceDetails | null | undefined,
): number | null {
  if (!sd || sd.office_hours !== true) return null;
  const raw = sd.price_vb;
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : null;
}

/** True when the seller flagged the service as Office Hours, valid
 *  price or not — the dashboard badge/editor key on the flag itself
 *  so a half-configured offer is visible to its owner, not hidden. */
export function isOfficeHoursFlagged(
  sd: ServiceDetails | null | undefined,
): boolean {
  return !!sd && sd.office_hours === true;
}

export function isValidTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isHhmm = (s: string) => HHMM_RE.test(s);

/* ── Availability form model ──────────────────────────────────────── */

export interface AvailabilityDayForm {
  weekday: number; // 0 = Sunday, matching the rail
  on: boolean;
  start: string; // "HH:MM"
  end: string; // "HH:MM"
}

export interface AvailabilityForm {
  timezone: string;
  days: AvailabilityDayForm[]; // exactly 7, weekday order 0..6
}

/** A starting grid for a creator who has never set availability:
 *  weekdays on, 09:00–17:00 — an editable suggestion, never a fact
 *  the server is told about until the seller saves it. */
export function emptyAvailabilityForm(timezone: string): AvailabilityForm {
  return {
    timezone,
    days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      on: weekday >= 1 && weekday <= 5,
      start: "09:00",
      end: "17:00",
    })),
  };
}

export function availabilityFormFrom(
  av: BookingAvailabilityDTO | null | undefined,
  fallbackTimeZone: string,
): AvailabilityForm {
  const form = emptyAvailabilityForm(av?.timezone || fallbackTimeZone);
  if (!av) return form;
  form.timezone = av.timezone;
  for (const day of form.days) day.on = false;
  for (const w of av.weekly ?? []) {
    const day = form.days[w.weekday];
    if (!day) continue;
    if (!day.on) {
      day.on = true;
      day.start = w.start;
      day.end = w.end;
    } else {
      /* Several stored windows on one weekday collapse to the widest
         span in the one-window-per-day form. */
      if (w.start < day.start) day.start = w.start;
      if (w.end > day.end) day.end = w.end;
    }
  }
  return form;
}

/** The rail-shaped availability for a form, or null when the form
 *  cannot produce a bookable grid (bad timezone, no day on, or a
 *  window that ends before it starts) — the caller shows the honest
 *  error instead of saving a service nobody could ever book. */
export function availabilityFromForm(
  form: AvailabilityForm,
): BookingAvailabilityDTO | null {
  if (!form.timezone || !isValidTimeZone(form.timezone)) return null;
  const weekly: BookingAvailabilityDTO["weekly"] = [];
  for (const day of form.days) {
    if (!day.on) continue;
    if (!isHhmm(day.start) || !isHhmm(day.end) || day.end <= day.start) return null;
    weekly.push({ weekday: day.weekday, start: day.start, end: day.end });
  }
  if (weekly.length === 0) return null;
  return { timezone: form.timezone, weekly };
}

/** Short weekday name for a rail weekday (0 = Sunday) in the viewer's
 *  locale — 2024-01-07 was a Sunday, so the reference week is exact. */
export function weekdayShortLabel(weekday: number, locale?: string): string {
  const ref = new Date(Date.UTC(2024, 0, 7 + weekday, 12, 0, 0));
  return new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(ref);
}

/* ── Slot display ─────────────────────────────────────────────────── */

export interface ViewerSlot {
  startUtc: string;
  endUtc: string;
  timeLabel: string;
}

export interface ViewerSlotDay {
  /** Viewer-local YYYY-MM-DD — the grouping key. */
  dateKey: string;
  /** Viewer-local long date, e.g. "Tuesday, January 5". */
  label: string;
  slots: ViewerSlot[];
}

/** Re-bucket the slots endpoint's days (grouped by the CREATOR's
 *  dates) into the viewer's own local dates, with local time labels.
 *  Instants never change — only the rendering does. */
export function groupSlotsForViewer(
  days: Array<{ date: string; slots: Array<{ startUtc: string; endUtc: string }> }>,
  viewerTimeZone: string,
  locale?: string,
): ViewerSlotDay[] {
  const dayKeyFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: viewerTimeZone, year: "numeric", month: "2-digit", day: "2-digit",
  });
  const labelFmt = new Intl.DateTimeFormat(locale, {
    timeZone: viewerTimeZone, weekday: "long", month: "long", day: "numeric",
  });
  const timeFmt = new Intl.DateTimeFormat(locale, {
    timeZone: viewerTimeZone, hour: "numeric", minute: "2-digit",
  });
  const byKey = new Map<string, ViewerSlotDay>();
  const flat = days.flatMap((d) => d.slots).sort((a, b) => a.startUtc.localeCompare(b.startUtc));
  for (const s of flat) {
    const start = new Date(s.startUtc);
    const dateKey = dayKeyFmt.format(start);
    let day = byKey.get(dateKey);
    if (!day) {
      day = { dateKey, label: labelFmt.format(start), slots: [] };
      byKey.set(dateKey, day);
    }
    day.slots.push({ startUtc: s.startUtc, endUtc: s.endUtc, timeLabel: timeFmt.format(start) });
  }
  return [...byKey.values()];
}
