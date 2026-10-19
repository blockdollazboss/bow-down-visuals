/**
 * palace-calendar — the Palace Calendar (UPGRADE-PROGRAM 3.9).
 *
 * Pins the pure half of the Kingdom Board's calendar: defensive
 * normalization of the events slate, palace-day (UTC) grouping
 * with the day window and the honest later-count, the look back's
 * bounds, and the per-kind walk each row carries. Wiring pins at
 * the bottom prove the board block fetches the calendar read,
 * guests never get a walk button, and the page threads the walk.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  CALENDAR_RECENT_CAP,
  calendarDayLabel,
  calendarEvent,
  calendarEventAction,
  groupPalaceCalendar,
  normalizeCalendarEvents,
  palaceDayKey,
  type CalendarEvent,
} from "./palace-calendar";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

/* A fixed palace "now": Monday Oct 19 2026, 15:00 UTC. */
const NOW = Date.UTC(2026, 9, 19, 15, 0, 0);
const HOUR = 3600_000;
const DAY = 24 * HOUR;

const iso = (ms: number) => new Date(ms).toISOString();

function ev(over: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "e1",
    kind: "stage_show",
    title: "Big Night",
    roomId: "world:kings-hall",
    hostName: "Fran",
    startsAt: iso(NOW + 3 * HOUR),
    endsAt: iso(NOW + 4 * HOUR),
    status: "scheduled",
    theme: null,
    note: null,
    ...over,
  };
}

describe("normalization", () => {
  it("keeps scheduled, live and done; drops cancelled and the timeless", () => {
    const raw = {
      events: [
        { id: "a", kind: "stage_show", title: "A", roomId: "world:kings-hall", hostName: "Fran", startsAt: iso(NOW), endsAt: iso(NOW + HOUR), status: "scheduled", payload: {} },
        { id: "b", kind: "drop", title: "B", roomId: "world:courtyard", hostName: "", startsAt: iso(NOW), endsAt: iso(NOW + HOUR), status: "live", payload: {} },
        { id: "c", kind: "contest", title: "C", roomId: "world:music-hall", hostName: "Pat", startsAt: iso(NOW - DAY), endsAt: iso(NOW - HOUR), status: "done", payload: { theme: "Hooks" } },
        { id: "d", kind: "drop", title: "D", roomId: "world:courtyard", hostName: "", startsAt: iso(NOW), endsAt: iso(NOW + HOUR), status: "cancelled", payload: {} },
        { id: "e", kind: "stage_show", title: "E", roomId: "world:kings-hall", hostName: "", startsAt: "not-a-time", endsAt: iso(NOW + HOUR), status: "scheduled", payload: {} },
        { id: "f", kind: "stage_show", title: "", roomId: "world:kings-hall", hostName: "", startsAt: iso(NOW), endsAt: iso(NOW + HOUR), status: "scheduled", payload: {} },
        "junk",
        null,
      ],
    };
    const out = normalizeCalendarEvents(raw);
    expect(out.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(out[2]!.theme).toBe("Hooks");
  });

  it("carries the office-hours note and nothing invented", () => {
    const shaped = calendarEvent({
      id: "oh", kind: "office_hours", title: "Office Hours", roomId: "creator:fran",
      hostName: "Fran", startsAt: iso(NOW), endsAt: iso(NOW + HOUR), status: "scheduled",
      payload: { note: "Bring your hooks" },
    });
    expect(shaped?.note).toBe("Bring your hooks");
    expect(shaped?.theme).toBeNull();
    const bare = calendarEvent({
      id: "oh2", kind: "office_hours", title: "Office Hours", roomId: "creator:fran",
      hostName: "Fran", startsAt: iso(NOW), endsAt: iso(NOW + HOUR), status: "scheduled",
      payload: {},
    });
    expect(bare?.note).toBeNull();
  });

  it("reads a bare array and refuses junk payloads", () => {
    expect(normalizeCalendarEvents([ev()])).toHaveLength(1);
    expect(normalizeCalendarEvents({ nope: true })).toEqual([]);
    expect(normalizeCalendarEvents(null)).toEqual([]);
  });
});

describe("palace days", () => {
  it("keys days by the UTC date — the day-turn, not the viewer's day", () => {
    /* 01:30 UTC is still yesterday evening in New York; the palace
       day is the UTC one regardless. */
    expect(palaceDayKey(Date.UTC(2026, 9, 19, 1, 30))).toBe("2026-10-19");
    expect(palaceDayKey(Date.UTC(2026, 9, 19, 23, 59))).toBe("2026-10-19");
  });

  it("labels Today, Tomorrow, and the day itself after that", () => {
    expect(calendarDayLabel("2026-10-19", NOW)).toBe("Today");
    expect(calendarDayLabel("2026-10-20", NOW)).toBe("Tomorrow");
    expect(calendarDayLabel("2026-10-22", NOW)).toBe("Thu, Oct 22");
    expect(calendarDayLabel("2026-10-26", NOW)).toBe("Mon, Oct 26");
  });
});

describe("grouping", () => {
  it("groups by palace day, soonest first, live first within a day", () => {
    const late = ev({ id: "late", title: "Late Show", startsAt: iso(NOW + 6 * HOUR), endsAt: iso(NOW + 7 * HOUR) });
    const early = ev({ id: "early", title: "Early Show", startsAt: iso(NOW + 1 * HOUR), endsAt: iso(NOW + 2 * HOUR) });
    const live = ev({ id: "live", title: "Live Show", status: "live", startsAt: iso(NOW - 5 * HOUR), endsAt: iso(NOW + HOUR) });
    const friday = ev({ id: "fri", title: "Friday Party", kind: "listening_party", roomId: "world:music-hall", startsAt: iso(NOW + 3 * DAY), endsAt: iso(NOW + 3 * DAY + HOUR) });
    const cal = groupPalaceCalendar([late, friday, early, live], [], NOW);
    expect(cal.days.map((d) => d.dayKey)).toEqual(["2026-10-19", "2026-10-22"]);
    expect(cal.days[0]!.label).toBe("Today");
    /* The live show started yesterday by the clock but stands
       today, and leads its day. */
    expect(cal.days[0]!.events.map((e) => e.id)).toEqual(["live", "early", "late"]);
    expect(cal.days[1]!.events.map((e) => e.id)).toEqual(["fri"]);
    expect(cal.laterCount).toBe(0);
  });

  it("counts happenings past the week instead of dropping them", () => {
    const far = ev({ id: "far", startsAt: iso(NOW + 10 * DAY), endsAt: iso(NOW + 10 * DAY + HOUR) });
    const edge = ev({ id: "edge", startsAt: iso(NOW + 6 * DAY), endsAt: iso(NOW + 6 * DAY + HOUR) });
    const cal = groupPalaceCalendar([far, edge], [], NOW);
    expect(cal.days.map((d) => d.dayKey)).toEqual(["2026-10-25"]);
    expect(cal.laterCount).toBe(1);
  });

  it("leaves out what's over, what's done, and empty days", () => {
    const over = ev({ id: "over", startsAt: iso(NOW - 3 * HOUR), endsAt: iso(NOW - HOUR) });
    const done = ev({ id: "done", status: "done", startsAt: iso(NOW + HOUR), endsAt: iso(NOW + 2 * HOUR) });
    const cal = groupPalaceCalendar([over, done], [], NOW);
    expect(cal.days).toEqual([]);
    expect(cal.laterCount).toBe(0);
  });
});

describe("the look back", () => {
  it("keeps done events inside the named week, newest first", () => {
    const recent = [
      ev({ id: "r-old", status: "done", startsAt: iso(NOW - 3 * DAY), endsAt: iso(NOW - 3 * DAY + HOUR) }),
      ev({ id: "r-new", status: "done", startsAt: iso(NOW - 2 * HOUR), endsAt: iso(NOW - HOUR) }),
      ev({ id: "r-ancient", status: "done", startsAt: iso(NOW - 9 * DAY), endsAt: iso(NOW - 9 * DAY + HOUR) }),
      ev({ id: "r-scheduled", status: "scheduled", startsAt: iso(NOW - 2 * HOUR), endsAt: iso(NOW - HOUR) }),
    ];
    const cal = groupPalaceCalendar([], recent, NOW);
    expect(cal.recent.map((e) => e.id)).toEqual(["r-new", "r-old"]);
  });

  it("caps the look back at the server's bound", () => {
    const many = Array.from({ length: CALENDAR_RECENT_CAP + 5 }, (_, i) =>
      ev({ id: `m${i}`, status: "done", startsAt: iso(NOW - (i + 2) * HOUR), endsAt: iso(NOW - (i + 1) * HOUR) }),
    );
    const cal = groupPalaceCalendar([], many, NOW);
    expect(cal.recent).toHaveLength(CALENDAR_RECENT_CAP);
    expect(cal.recent[0]!.id).toBe("m0");
  });
});

describe("the walk each row carries", () => {
  it("room happenings walk to their room; contests walk to the Winners' Circle desk", () => {
    expect(calendarEventAction(ev({ kind: "stage_show" }))).toEqual({ type: "room", roomId: "world:kings-hall" });
    expect(calendarEventAction(ev({ kind: "listening_party", roomId: "world:music-hall" }))).toEqual({ type: "room", roomId: "world:music-hall" });
    expect(calendarEventAction(ev({ kind: "drop", roomId: "world:courtyard" }))).toEqual({ type: "room", roomId: "world:courtyard" });
    expect(calendarEventAction(ev({ kind: "office_hours", roomId: "creator:fran" }))).toEqual({ type: "room", roomId: "creator:fran" });
    expect(calendarEventAction(ev({ kind: "contest" }))).toEqual({ type: "station", stationId: "winners-circle" });
  });

  it("an unknown kind — or a room event with no room — wears no button", () => {
    expect(calendarEventAction(ev({ kind: "parade" }))).toEqual({ type: "none" });
    expect(calendarEventAction(ev({ kind: "stage_show", roomId: "" }))).toEqual({ type: "none" });
  });
});

describe("wiring", () => {
  const block = read("../../components/world/native/PalaceCalendarBlock.tsx");
  const boardBlocks = read("../../components/world/native/KingdomBoardBlocks.tsx");
  const panel = read("../../components/world/StationPanel.tsx");
  const page = read("../../pages/world.tsx");
  const client = read("./world-client.ts");

  it("reads the calendar rail — the public slate plus the server's look back", () => {
    expect(client).toContain('fetch("/api/world/events?recent=1"');
    expect(client).toContain("office_hours");
    expect(block).toContain("fetchWorldEventCalendar");
    expect(block).toContain("groupPalaceCalendar");
  });

  it("the block stands on the Kingdom Board, after Today", () => {
    expect(boardBlocks).toContain("<PalaceCalendarBlock");
    expect(boardBlocks.indexOf("world-kingdom-today")).toBeLessThan(
      boardBlocks.indexOf("<PalaceCalendarBlock"),
    );
  });

  it("guests read the calendar but never get a walk button", () => {
    expect(block).toContain("if (isGuest) return undefined;");
    expect(block).toContain("world-kingdom-calendar");
    expect(block).toContain("Sign in to join in");
    /* The look back's bound is named in its own title. */
    expect(block).toContain("Earlier at the palace");
    expect(block).toContain("CALENDAR_RECENT_WINDOW_DAYS");
  });

  it("member rows carry the room walk and the contest walk, by testid", () => {
    expect(block).toContain("world-calendar-goto-");
    expect(block).toContain("world-calendar-station-");
    expect(block).toContain("calendarEventAction");
  });

  it("the walk is threaded page → panel → board", () => {
    expect(page).toContain("onEnterRoom={(roomId)");
    expect(page).toContain("enterCreatorRoomRef.current(slug)");
    expect(page).toContain("clientRef.current?.enterRoom(roomId)");
    expect(panel).toContain("onEnterRoom?: (roomId: string) => void");
    expect(panel).toContain("onEnterRoom={props.onEnterRoom}");
    expect(panel).toContain("onOpenStation={props.onOpenStation}");
  });

  it("an open failure is a failure with a retry — never a fake empty week", () => {
    expect(block).toContain("NativeErrorState");
    expect(block).toContain("The calendar wouldn't open");
  });
});
