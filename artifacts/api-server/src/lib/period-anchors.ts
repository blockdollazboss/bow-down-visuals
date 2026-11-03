/* ─── Period anchors — ONE anchor everywhere (stack1400 ruling #8,
   W6 OD-1) ──────────────────────────────────────────────────────────
   Every period key on the server rolls at midnight in
   America/New_York — never at server-local midnight and never at
   UTC midnight. Before this module the anchors disagreed:
     - the Bow Race month used the server's local calendar,
     - the away digest's Bow Race lookup used the UTC month
       (now.toISOString().slice(0, 7)) — a SECOND month key for the
       same race,
     - the weekly envelopes (retention quests, the quest pool,
       Pitch & Fix rewards) anchored on Monday-UTC.
   Around a boundary those clocks named different periods for the
   same moment, so a race/quest/pool week could split in two. Now
   every consumer derives its key here:

     nyMonthKey(now)     → "YYYY-MM"    (the month containing `now`)
     nyWeekStartKey(now) → "YYYY-MM-DD" (Monday of `now`'s NY week)
     nyWeekWindow(...)   → the [start, end) INSTANTS of that week:
                           NY midnight on the Monday key to NY
                           midnight on the next Monday key, as ISO
                           strings — NOT weekStart + "T00:00:00Z"
                           and NOT start + 7×24h. A NY week that
                           contains a DST switch is 167 or 169
                           hours long; its midnights still exist
                           (US switches happen at 02:00 local, never
                           at midnight), so the keys stay stable
                           plain date strings and only the window's
                           UTC offset moves (EST = UTC-5, EDT = UTC-4).

   No new dependencies: Intl.DateTimeFormat with an explicit
   timeZone does the zone math, so results never depend on the
   host's TZ. */

export const PERIOD_TIME_ZONE = "America/New_York";

const nyPartsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: PERIOD_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const nyClockFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: PERIOD_TIME_ZONE,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

interface Ymd {
  y: number;
  m: number; // 1-12
  d: number; // 1-31
}

function partsOf(fmt: Intl.DateTimeFormat, date: Date): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out;
}

/** The calendar date `date` falls on in New York. */
export function nyDateParts(date: Date): Ymd {
  const p = partsOf(nyPartsFmt, date);
  return { y: p["year"]!, m: p["month"]!, d: p["day"]! };
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

function ymdToKey({ y, m, d }: Ymd): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

function keyToYmd(key: string): Ymd {
  const [y, m, d] = key.split("-").map((p) => Number(p));
  return { y: y!, m: m ?? 1, d: d ?? 1 };
}

/** Pure calendar math on a Ymd (carried as a UTC-midnight Date so the
 *  host zone can never leak in): shift by whole days. */
function shiftYmd(ymd: Ymd, days: number): Ymd {
  const t = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d + days));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

/** Day of week for a calendar date: Monday = 0 … Sunday = 6. */
function mondayIndex(ymd: Ymd): number {
  const dow = new Date(Date.UTC(ymd.y, ymd.m - 1, ymd.d)).getUTCDay(); // Sun = 0
  return (dow + 6) % 7;
}

/** YYYY-MM-DD of the calendar date `date` falls on in New York. */
export function nyDateKey(date: Date): string {
  return ymdToKey(nyDateParts(date));
}

/** YYYY-MM of the month containing `date`, on the New York calendar.
 *  THE month key: the Bow Race period and every lookup of it. */
export function nyMonthKey(date: Date): string {
  const { y, m } = nyDateParts(date);
  return `${y}-${pad2(m)}`;
}

/** YYYY-MM-DD of the first day (the 1st) of `date`'s New York month. */
export function nyMonthStartKey(date: Date): string {
  const { y, m } = nyDateParts(date);
  return `${y}-${pad2(m)}-01`;
}

/** Monday (YYYY-MM-DD, New York calendar) of the week containing a
 *  YYYY-MM-DD day key. Pure calendar math on the key itself — the
 *  key is already a NY date, so no zone conversion is involved. */
export function nyWeekStartOfDayKey(dayKey: string): string {
  const ymd = keyToYmd(dayKey);
  return ymdToKey(shiftYmd(ymd, -mondayIndex(ymd)));
}

/** Monday (YYYY-MM-DD) of the week containing `date`, on the New
 *  York calendar. THE week key: retention quests, the quest pool,
 *  and every envelope that mirrors them anchor here, so a moment
 *  like Sunday 23:30 NY (= Monday 04:30 UTC) still belongs to the
 *  week that is ending in New York — the new week opens at NY
 *  midnight, not four-plus hours earlier at UTC midnight. */
export function nyWeekStartKey(date: Date): string {
  return nyWeekStartOfDayKey(nyDateKey(date));
}

/** Offset of New York from UTC at `date`, in ms (negative: NY is
 *  behind UTC). Derived by reading the NY wall clock for the same
 *  instant and comparing it to the instant read as UTC. */
function nyOffsetMs(date: Date): number {
  const p = partsOf(nyClockFmt, date);
  const hour = p["hour"]! % 24; // hour12:false can render midnight as 24
  const wallAsUtc = Date.UTC(p["year"]!, p["month"]! - 1, p["day"]!, hour, p["minute"]!, p["second"]!);
  return wallAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant of New York midnight at the START of a YYYY-MM-DD
 *  NY day key: 04:00Z in EDT, 05:00Z in EST. Midnight is never
 *  skipped or repeated by a US DST switch (both happen at 02:00
 *  local), so this is always well-defined. Iterating the offset
 *  lookup twice settles the guess even beside a switch. */
export function nyMidnightInstant(dayKey: string): Date {
  const { y, m, d } = keyToYmd(dayKey);
  const wall = Date.UTC(y, m - 1, d, 0, 0, 0);
  let utc = wall - nyOffsetMs(new Date(wall));
  utc = wall - nyOffsetMs(new Date(utc));
  utc = wall - nyOffsetMs(new Date(utc));
  return new Date(utc);
}

export interface NyWeekWindow {
  /** Monday key (YYYY-MM-DD, NY calendar). */
  weekStart: string;
  /** The NEXT Monday key — the window's exclusive end day. */
  weekEnd: string;
  /** ISO instant of NY midnight on `weekStart`. */
  startIso: string;
  /** ISO instant of NY midnight on `weekEnd` (exclusive). Across a
   *  DST switch this is 167h or 169h after startIso, never 168h. */
  endIso: string;
}

/** The [start, end) window of the NY week containing `date` (or,
 *  given a string, of the week whose Monday key it is). Spend
 *  windows over timestamped rows must use THESE instants — pinning
 *  `${weekStart}T00:00:00.000Z` would open the window at UTC
 *  midnight, hours before the NY week it names. */
export function nyWeekWindow(dateOrWeekStart: Date | string): NyWeekWindow {
  const weekStart =
    typeof dateOrWeekStart === "string"
      ? nyWeekStartOfDayKey(dateOrWeekStart)
      : nyWeekStartKey(dateOrWeekStart);
  const weekEnd = ymdToKey(shiftYmd(keyToYmd(weekStart), 7));
  return {
    weekStart,
    weekEnd,
    startIso: nyMidnightInstant(weekStart).toISOString(),
    endIso: nyMidnightInstant(weekEnd).toISOString(),
  };
}
