/**
 * booking-slots.ts — the availability → open-slots engine for paid bookings.
 *
 * Pure functions, no I/O. Availability is defined in the CREATOR's timezone
 * as weekly wall-clock windows plus per-date overrides; every instant this
 * module emits is UTC. Wall-clock ⇄ UTC conversion goes through Intl (the
 * platform tz database) — never through hand-rolled offset tables.
 *
 * Correctness rules:
 *  - A candidate slot is [start, start+duration) stepped from its window's
 *    start by the slot step (default duration + buffer).
 *  - It must end by its window's end, start no earlier than
 *    now + min_notice, and start no later than now + max_advance_days.
 *  - A taken booking blocks [start - buffer, end + buffer).
 *  - Overrides replace the weekly windows for their creator-local date;
 *    windows: null means the creator is off that day.
 *  - DST: a wall time inside a spring-forward gap resolves to the first
 *    valid instant after the gap (the offset iteration lands there).
 */

export interface BookingWindow {
  start: string; // "HH:MM" 24h wall time in the availability timezone
  end: string;   // "HH:MM", strictly after start
}

export interface BookingDayOverride {
  date: string; // "YYYY-MM-DD" in the availability timezone
  windows: BookingWindow[] | null; // null = day off
}

export interface BookingAvailability {
  timezone: string; // IANA, e.g. "America/New_York"
  weekly: Array<BookingWindow & { weekday: number }>; // weekday 0 = Sunday
  overrides?: BookingDayOverride[];
  slot_step_min?: number;
  buffer_min?: number;
  min_notice_min?: number;
  max_advance_days?: number;
}

export interface TakenRange {
  startUtc: string;
  endUtc: string;
}

export interface OpenSlot {
  startUtc: string;
  endUtc: string;
}

const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidAvailability(av: unknown): av is BookingAvailability {
  if (typeof av !== "object" || av === null) return false;
  const a = av as Record<string, unknown>;
  if (typeof a["timezone"] !== "string" || !isValidTimeZone(a["timezone"])) return false;
  if (!Array.isArray(a["weekly"])) return false;
  for (const w of a["weekly"] as Array<Record<string, unknown>>) {
    if (typeof w !== "object" || w === null) return false;
    if (!Number.isInteger(w["weekday"]) || (w["weekday"] as number) < 0 || (w["weekday"] as number) > 6) return false;
    if (typeof w["start"] !== "string" || !HHMM_RE.test(w["start"])) return false;
    if (typeof w["end"] !== "string" || !HHMM_RE.test(w["end"])) return false;
    if (hhmmToMinutes(w["end"]) <= hhmmToMinutes(w["start"])) return false;
  }
  if (a["overrides"] !== undefined) {
    if (!Array.isArray(a["overrides"])) return false;
    for (const o of a["overrides"] as Array<Record<string, unknown>>) {
      if (typeof o !== "object" || o === null) return false;
      if (typeof o["date"] !== "string" || !YMD_RE.test(o["date"])) return false;
      if (o["windows"] !== null) {
        if (!Array.isArray(o["windows"])) return false;
        for (const w of o["windows"] as Array<Record<string, unknown>>) {
          if (typeof w?.["start"] !== "string" || !HHMM_RE.test(w["start"] as string)) return false;
          if (typeof w?.["end"] !== "string" || !HHMM_RE.test(w["end"] as string)) return false;
          if (hhmmToMinutes(w["end"] as string) <= hhmmToMinutes(w["start"] as string)) return false;
        }
      }
    }
  }
  for (const k of ["slot_step_min", "buffer_min", "min_notice_min", "max_advance_days"] as const) {
    const v = a[k];
    if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) return false;
  }
  return true;
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Offset (ms) of `tz` from UTC at instant `at`: localWall = utc + offset. */
function tzOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const hour = get("hour") % 24; // hour12:false can yield 24 at midnight
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The UTC instant of a wall-clock time on a calendar date in `tz`. */
export function zonedTimeToUtc(ymd: string, hhmm: string, tz: string): Date {
  const [y, mo, d] = ymd.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  const guess = Date.UTC(y ?? 1970, (mo ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0);
  const off1 = tzOffsetMs(new Date(guess), tz);
  let utc = guess - off1;
  const off2 = tzOffsetMs(new Date(utc), tz);
  if (off2 !== off1) utc = guess - off2;
  return new Date(utc);
}

/** "YYYY-MM-DD" of an instant as seen in `tz`. */
export function ymdInTimeZone(at: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, mo, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (mo ?? 1) - 1, (d ?? 1) + days));
  return dt.toISOString().slice(0, 10);
}

function weekdayOfYmd(ymd: string): number {
  const [y, mo, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (mo ?? 1) - 1, d ?? 1)).getUTCDay();
}

/** The windows in force for one creator-local date (overrides win). */
export function windowsForDate(av: BookingAvailability, ymd: string): BookingWindow[] {
  const override = (av.overrides ?? []).find((o) => o.date === ymd);
  if (override) return override.windows ?? [];
  const wd = weekdayOfYmd(ymd);
  return av.weekly
    .filter((w) => w.weekday === wd)
    .map((w) => ({ start: w.start, end: w.end }))
    .sort((a, b) => hhmmToMinutes(a.start) - hhmmToMinutes(b.start));
}

/**
 * Open slots in [fromUtc, toUtc): generated from availability, minus taken
 * ranges (each expanded by buffer), clipped by notice/advance rules
 * (relative to `now`). Returned chronologically as UTC ISO strings.
 */
export function generateOpenSlots(args: {
  availability: BookingAvailability;
  durationMin: number;
  taken: TakenRange[];
  fromUtc: Date;
  toUtc: Date;
  now?: Date;
}): OpenSlot[] {
  const { availability: av, durationMin, taken } = args;
  const now = args.now ?? new Date();
  const bufferMin = av.buffer_min ?? 0;
  const stepMin = av.slot_step_min ?? durationMin + bufferMin;
  const minNoticeMin = av.min_notice_min ?? 0;
  const maxAdvanceDays = av.max_advance_days ?? 60;
  if (durationMin <= 0 || stepMin <= 0) return [];

  const earliestStart = now.getTime() + minNoticeMin * 60_000;
  const latestStart = now.getTime() + maxAdvanceDays * 86_400_000;
  const rangeStart = Math.max(args.fromUtc.getTime(), earliestStart);
  const rangeEnd = Math.min(args.toUtc.getTime(), latestStart + durationMin * 60_000);

  const blocked = taken.map((t) => ({
    s: Date.parse(t.startUtc) - bufferMin * 60_000,
    e: Date.parse(t.endUtc) + bufferMin * 60_000,
  }));

  const out: OpenSlot[] = [];
  /* Walk creator-local dates that could intersect the range. One day of
     slack on both sides covers every tz offset. */
  let ymd = addDaysYmd(ymdInTimeZone(new Date(rangeStart), av.timezone), -1);
  const lastYmd = addDaysYmd(ymdInTimeZone(new Date(rangeEnd), av.timezone), 1);
  while (ymd <= lastYmd) {
    for (const win of windowsForDate(av, ymd)) {
      const winStartUtc = zonedTimeToUtc(ymd, win.start, av.timezone).getTime();
      const winEndUtc = zonedTimeToUtc(ymd, win.end, av.timezone).getTime();
      for (
        let s = winStartUtc;
        s + durationMin * 60_000 <= winEndUtc;
        s += stepMin * 60_000
      ) {
        const e = s + durationMin * 60_000;
        if (s < rangeStart || s >= rangeEnd || s > latestStart) continue;
        if (blocked.some((b) => s < b.e && b.s < e)) continue;
        out.push({ startUtc: new Date(s).toISOString(), endUtc: new Date(e).toISOString() });
      }
    }
    ymd = addDaysYmd(ymd, 1);
  }
  out.sort((a, b) => Date.parse(a.startUtc) - Date.parse(b.startUtc));
  return out;
}

/** Is this exact slot start one of the slots the grid generates (before
 *  taken-subtraction)? Checkout validation uses this so a buyer can only
 *  ever book a grid slot — never an arbitrary time. */
export function isGridSlot(args: {
  availability: BookingAvailability;
  durationMin: number;
  startUtc: Date;
  now?: Date;
}): boolean {
  const slots = generateOpenSlots({
    availability: args.availability,
    durationMin: args.durationMin,
    taken: [],
    fromUtc: args.startUtc,
    toUtc: new Date(args.startUtc.getTime() + 1),
    now: args.now,
  });
  return slots.some((s) => Date.parse(s.startUtc) === args.startUtc.getTime());
}
