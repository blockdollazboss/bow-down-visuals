/**
 * palace-calendar.ts — the Palace Calendar (UPGRADE-PROGRAM 3.9):
 * the Kingdom Board's one view over every happening in the World —
 * stage shows, listening parties, drops, contests and office hours —
 * grouped by palace day, with the week just past behind it.
 *
 * The palace day is the UTC day (the day-turn the King's daily
 * moment and the Daily Quest Trio turn on), so an event's group is
 * the palace day of its start; only the TIMES inside a row render
 * in the viewer's local time. Grouping here is pure and pinned;
 * the component (PalaceCalendarBlock) owns the fetch and the rows.
 *
 * The read is the public slate's own (GET /api/world/events with
 * the server's opt-in look back, ?recent=1): live + upcoming for
 * the days ahead, done events from the last RECENT_WINDOW_DAYS
 * days for the look back. Nothing here invents a time: the rail's
 * rows always carry real startsAt/endsAt (the table's columns are
 * NOT NULL), and a row whose times don't parse is dropped rather
 * than placed under a made-up day.
 */

export interface CalendarEvent {
  id: string;
  kind: string;
  title: string;
  roomId: string;
  hostName: string;
  startsAt: string;
  endsAt: string;
  status: "scheduled" | "live" | "done";
  /** Contest only: the theme works are entered under. */
  theme: string | null;
  /** Office hours only: the host's optional agenda line. */
  note: string | null;
}

/** The look back's bound — the server's window, named in the copy. */
export const CALENDAR_RECENT_WINDOW_DAYS = 7;
/** The look back never renders more rows than the server sends. */
export const CALENDAR_RECENT_CAP = 20;
/** The days ahead: today plus the six palace days after it. */
export const CALENDAR_DAY_WINDOW = 7;

/* ── Defensive reading (DTO drift is this repo's #1 bug family) ── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function parseable(iso: string): boolean {
  return iso !== "" && !Number.isNaN(Date.parse(iso));
}

/** One slate row → a calendar event, or null when it can't stand
 *  honestly (cancelled rows are not happenings; a row without real
 *  times can't be placed on a day). */
export function calendarEvent(v: unknown): CalendarEvent | null {
  if (!isRecord(v)) return null;
  if (v.status !== "scheduled" && v.status !== "live" && v.status !== "done") return null;
  const id = str(v.id);
  const title = str(v.title);
  const startsAt = str(v.startsAt);
  const endsAt = str(v.endsAt);
  if (!id || !title || !parseable(startsAt) || !parseable(endsAt)) return null;
  const payload = isRecord(v.payload) ? v.payload : {};
  return {
    id,
    kind: str(v.kind),
    title,
    roomId: str(v.roomId),
    hostName: str(v.hostName),
    startsAt,
    endsAt,
    status: v.status,
    theme: typeof payload["theme"] === "string" && payload["theme"] ? payload["theme"] : null,
    note: typeof payload["note"] === "string" && payload["note"] ? payload["note"] : null,
  };
}

/** Normalize a slate read (the { events } payload or a bare array). */
export function normalizeCalendarEvents(raw: unknown): CalendarEvent[] {
  const list =
    isRecord(raw) && Array.isArray(raw.events) ? raw.events : Array.isArray(raw) ? raw : null;
  if (!list) return [];
  const out: CalendarEvent[] = [];
  for (const e of list) {
    const shaped = calendarEvent(e);
    if (shaped) out.push(shaped);
  }
  return out;
}

/* ── Palace days (UTC — the day-turn) ───────────────────────────── */

/** The palace day key (UTC YYYY-MM-DD) a timestamp falls on. */
export function palaceDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function dayKeyPlus(dayKey: string, days: number): string {
  const ms = Date.parse(`${dayKey}T00:00:00.000Z`);
  return palaceDayKey(ms + days * 24 * 3600_000);
}

const DAY_LABEL_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/** A day group's name: Today / Tomorrow in the palace's own count,
 *  else the day itself ("Tue, Oct 21" — read off the UTC day, so
 *  the label always names the group it heads). */
export function calendarDayLabel(dayKey: string, nowMs: number): string {
  const today = palaceDayKey(nowMs);
  if (dayKey === today) return "Today";
  if (dayKey === dayKeyPlus(today, 1)) return "Tomorrow";
  const ms = Date.parse(`${dayKey}T00:00:00.000Z`);
  return Number.isNaN(ms) ? dayKey : DAY_LABEL_FMT.format(new Date(ms));
}

/* ── Grouping ───────────────────────────────────────────────────── */

export interface CalendarDayGroup {
  dayKey: string;
  label: string;
  events: CalendarEvent[];
}

export interface PalaceCalendar {
  /** Today first, then the coming palace days — only days that
   *  hold a happening stand as groups. */
  days: CalendarDayGroup[];
  /** Happenings booked past the day window — counted, never
   *  silently dropped, so the board can say so. */
  laterCount: number;
  /** The look back: what already happened, most recent first. */
  recent: CalendarEvent[];
}

export function groupPalaceCalendar(
  events: CalendarEvent[],
  recentEvents: CalendarEvent[],
  nowMs: number,
): PalaceCalendar {
  const todayKey = palaceDayKey(nowMs);
  const lastKey = dayKeyPlus(todayKey, CALENDAR_DAY_WINDOW - 1);

  const byDay = new Map<string, CalendarEvent[]>();
  let laterCount = 0;
  for (const e of events) {
    if (e.status === "done") continue;
    if (Date.parse(e.endsAt) <= nowMs) continue;
    /* The event's palace day; a happening already standing (live,
       or a start the scheduler hasn't turned yet) reads as
       today's, the board's standing rule for live rows. */
    let dayKey = palaceDayKey(Date.parse(e.startsAt));
    if (dayKey < todayKey) dayKey = todayKey;
    if (dayKey > lastKey) {
      laterCount += 1;
      continue;
    }
    const list = byDay.get(dayKey);
    if (list) list.push(e);
    else byDay.set(dayKey, [e]);
  }

  const days: CalendarDayGroup[] = [...byDay.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([dayKey, dayEvents]) => ({
      dayKey,
      label: calendarDayLabel(dayKey, nowMs),
      events: dayEvents.sort((a, b) => {
        if ((a.status === "live") !== (b.status === "live")) return a.status === "live" ? -1 : 1;
        return Date.parse(a.startsAt) - Date.parse(b.startsAt);
      }),
    }));

  /* The look back, re-checked on this side of the wire: done,
     already ended, inside the named window, newest first, and
     never more than the cap — the server's bounds, kept honest
     even if the payload drifts. */
  const since = nowMs - CALENDAR_RECENT_WINDOW_DAYS * 24 * 3600_000;
  const recent = recentEvents
    .filter((e) => {
      if (e.status !== "done") return false;
      const ends = Date.parse(e.endsAt);
      return ends <= nowMs && ends >= since;
    })
    .sort((a, b) => Date.parse(b.endsAt) - Date.parse(a.endsAt))
    .slice(0, CALENDAR_RECENT_CAP);

  return { days, laterCount, recent };
}

/* ── Actions: where a row walks ─────────────────────────────────── */

/** A calendar row's walk, resolved from the event's kind alone:
 *  - "room": the happening stands in a palace or creator room —
 *    the page walks the member there (creator rooms ride the
 *    doorway transfer; the page resolves the id).
 *  - "station": the happening's desk — a contest is entered at
 *    the Winners' Circle station, where its panel stands.
 *  - "none": a kind this client doesn't know — the row reads
 *    look-only rather than wearing a button that goes nowhere. */
export type CalendarEventAction =
  | { type: "room"; roomId: string }
  | { type: "station"; stationId: string }
  | { type: "none" };

export function calendarEventAction(e: CalendarEvent): CalendarEventAction {
  switch (e.kind) {
    case "stage_show":
    case "listening_party":
    case "drop":
    case "office_hours":
      return e.roomId ? { type: "room", roomId: e.roomId } : { type: "none" };
    case "contest":
      return { type: "station", stationId: "winners-circle" };
    default:
      return { type: "none" };
  }
}
