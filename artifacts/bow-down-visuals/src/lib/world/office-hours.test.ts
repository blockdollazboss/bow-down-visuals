/**
 * Office Hours (UPGRADE-PROGRAM 3.7, stack-20 #17) — the client
 * seam's pins:
 * - the room detail DTO's officeHours field parses defensively
 *   (a malformed field is null, never a crash or a fake session);
 * - the marker speaks SCHEDULE, never presence: "in session" is
 *   the booked window holding the clock, and an ended session
 *   names no marker at all;
 * - the current-or-next pick is window truth: open statuses only,
 *   ended windows excluded, soonest first;
 * - the booking builder mirrors the server's window rules and
 *   anchors the booking to the host's own creator room id;
 * - refusals read in plain words, the server's honest message
 *   first;
 * - wiring pins: the Kingdom Board labels the kind and names the
 *   room for its host; the room panel carries the marker for
 *   everyone and the booking form for the owner only.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildOfficeHoursBooking,
  currentOrNextSession,
  nextHourLocalValue,
  officeHoursErrorCopy,
  officeHoursMarker,
  officeHoursSessionWhen,
  parseCreatorRoomOfficeHours,
  parseOfficeHoursEvents,
  plusDaysLocalValue,
  type OfficeHoursSession,
} from "./office-hours";
import { parseCreatorRoomDetail } from "./creator-rooms";

const NOW = Date.parse("2026-10-18T12:20:00.000Z");
const HOUR = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();

function session(over: Partial<OfficeHoursSession & { status: string }> = {}): OfficeHoursSession & { status: string } {
  return {
    id: "evt-1",
    title: "Office hours — ask me anything",
    note: "Mixing questions welcome",
    hostName: "Ada",
    startsAt: iso(NOW + 2 * HOUR),
    endsAt: iso(NOW + 3 * HOUR),
    status: "scheduled",
    ...over,
  };
}

describe("the detail DTO's officeHours field", () => {
  it("parses a well-formed field and coerces an unknown state to upcoming", () => {
    expect(
      parseCreatorRoomOfficeHours({
        id: "evt-1",
        title: "Hours",
        note: "Bring demos",
        startsAt: iso(NOW),
        endsAt: iso(NOW + HOUR),
        state: "in-session",
      }),
    ).toEqual({
      id: "evt-1",
      title: "Hours",
      note: "Bring demos",
      startsAt: iso(NOW),
      endsAt: iso(NOW + HOUR),
      state: "in-session",
    });
    expect(
      parseCreatorRoomOfficeHours({ id: "e", startsAt: iso(NOW), endsAt: iso(NOW + HOUR), state: "weird" })!.state,
    ).toBe("upcoming");
  });

  it("a missing or malformed field is null — the room simply has no hours standing", () => {
    expect(parseCreatorRoomOfficeHours(null)).toBeNull();
    expect(parseCreatorRoomOfficeHours("nope")).toBeNull();
    expect(parseCreatorRoomOfficeHours({ id: "e" })).toBeNull();
    expect(parseCreatorRoomOfficeHours({ startsAt: iso(NOW), endsAt: iso(NOW + HOUR) })).toBeNull();
  });

  it("rides parseCreatorRoomDetail: present when booked, null when not", () => {
    const base = { slug: "ada", displayName: "Ada" };
    const booked = parseCreatorRoomDetail({
      room: {
        ...base,
        officeHours: {
          id: "evt-9",
          title: "Hours",
          note: null,
          startsAt: iso(NOW + HOUR),
          endsAt: iso(NOW + 2 * HOUR),
          state: "upcoming",
        },
      },
    });
    expect(booked!.officeHours).toMatchObject({ id: "evt-9", state: "upcoming", note: null });
    const none = parseCreatorRoomDetail({ room: { ...base } });
    expect(none!.officeHours).toBeNull();
  });
});

describe("slate parsing + the current-or-next pick", () => {
  it("keeps only office-hours rows, carrying the note out of the payload", () => {
    const rows = parseOfficeHoursEvents({
      events: [
        {
          id: "e1",
          kind: "office_hours",
          title: "Hours",
          hostName: "Ada",
          startsAt: iso(NOW + HOUR),
          endsAt: iso(NOW + 2 * HOUR),
          status: "scheduled",
          payload: { note: "Demos" },
        },
        { id: "e2", kind: "stage_show", title: "Show", startsAt: iso(NOW), endsAt: iso(NOW + HOUR), status: "live", payload: {} },
        { id: "e3", kind: "office_hours", title: "Broken" },
      ],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "e1", note: "Demos", hostName: "Ada" });
    expect(parseOfficeHoursEvents(null)).toEqual([]);
    expect(parseOfficeHoursEvents({ events: "nope" })).toEqual([]);
  });

  it("picks the in-window session over a later one, and the soonest upcoming otherwise", () => {
    const later = session({ id: "later", startsAt: iso(NOW + 5 * HOUR), endsAt: iso(NOW + 6 * HOUR) });
    const inWindow = session({
      id: "now",
      status: "live",
      startsAt: iso(NOW - 30 * 60_000),
      endsAt: iso(NOW + 30 * 60_000),
    });
    expect(currentOrNextSession([later, inWindow], NOW)!.id).toBe("now");
    expect(currentOrNextSession([later], NOW)!.id).toBe("later");
  });

  it("ended windows and closed statuses name nothing", () => {
    const ended = session({ startsAt: iso(NOW - 3 * HOUR), endsAt: iso(NOW - 2 * HOUR), status: "live" });
    const cancelled = session({ status: "cancelled" });
    const done = session({ status: "done" });
    expect(currentOrNextSession([ended, cancelled, done], NOW)).toBeNull();
    expect(currentOrNextSession([], NOW)).toBeNull();
  });
});

describe("the marker — schedule truth, never a presence claim", () => {
  it("an upcoming session names the host, the title, the note and the next start", () => {
    const m = officeHoursMarker(session(), "Ada", NOW)!;
    expect(m.inSession).toBe(false);
    expect(m.headline).toBe("Office hours — Ada");
    expect(m.detail).toContain("Office hours — ask me anything");
    expect(m.detail).toContain("Mixing questions welcome");
    expect(m.detail).toContain("next session");
  });

  it("inside the window the marker says the session is on and when it ends", () => {
    const live = session({ startsAt: iso(NOW - 30 * 60_000), endsAt: iso(NOW + 30 * 60_000) });
    const m = officeHoursMarker(live, "Ada", NOW)!;
    expect(m.inSession).toBe(true);
    expect(m.detail).toContain("in session until");
    /* The words claim the SESSION, never the host's body. */
    expect(m.detail).not.toContain("is here");
    expect(m.detail).not.toContain("is in the room");
  });

  it("no session — or one whose window has closed — names no marker", () => {
    expect(officeHoursMarker(null, "Ada", NOW)).toBeNull();
    const ended = session({ startsAt: iso(NOW - 3 * HOUR), endsAt: iso(NOW - 2 * HOUR) });
    expect(officeHoursMarker(ended, "Ada", NOW)).toBeNull();
  });

  it("a session with no agenda line carries no dangling dash", () => {
    const m = officeHoursMarker(session({ note: null }), "Ada", NOW)!;
    expect(m.detail).not.toContain("—  ·");
    expect(m.detail).toContain("Office hours — ask me anything · next session");
  });

  it("schedule rows read as a day and a span", () => {
    const when = officeHoursSessionWhen(session(), NOW);
    expect(when).toContain("–");
    expect(when).toContain(new Date(NOW + 2 * HOUR).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
  });
});

describe("the booking builder", () => {
  it("builds the calendar body anchored to the host's own room", () => {
    const built = buildOfficeHoursBooking(
      "ada",
      { title: "  My hours  ", note: "  Demos welcome ", startLocal: nextHourLocalValue(NOW), durationMin: 60 },
      NOW,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.body.kind).toBe("office_hours");
    expect(built.body.roomId).toBe("creator:ada");
    expect(built.body.title).toBe("My hours");
    expect(built.body.payload).toEqual({ note: "Demos welcome" });
    expect(Date.parse(built.body.endsAt) - Date.parse(built.body.startsAt)).toBe(HOUR);
  });

  it("an empty title defaults to the honest name and an empty note drops the key", () => {
    const built = buildOfficeHoursBooking(
      "ada",
      { title: "   ", note: " ", startLocal: nextHourLocalValue(NOW), durationMin: 30 },
      NOW,
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.body.title).toBe("Office hours");
    expect(built.body.payload).toEqual({});
  });

  it("refuses what the server would refuse: past starts, silly lengths, far futures, no date", () => {
    const past = buildOfficeHoursBooking(
      "ada",
      { title: "", note: "", startLocal: "2026-10-18T08:00", durationMin: 60 },
      NOW,
    );
    expect(past).toEqual({ ok: false, error: expect.stringContaining("already past") });

    const short = buildOfficeHoursBooking(
      "ada",
      { title: "", note: "", startLocal: nextHourLocalValue(NOW), durationMin: 2 },
      NOW,
    );
    expect(short.ok).toBe(false);

    const long = buildOfficeHoursBooking(
      "ada",
      { title: "", note: "", startLocal: nextHourLocalValue(NOW), durationMin: 300 },
      NOW,
    );
    expect(long.ok).toBe(false);

    const far = buildOfficeHoursBooking(
      "ada",
      { title: "", note: "", startLocal: "2026-12-25T10:00", durationMin: 60 },
      NOW,
    );
    expect(far).toEqual({ ok: false, error: expect.stringContaining("30 days") });

    const none = buildOfficeHoursBooking(
      "ada",
      { title: "", note: "", startLocal: "", durationMin: 60 },
      NOW,
    );
    expect(none.ok).toBe(false);
  });

  it("the next-week helper keeps the wall-clock time", () => {
    expect(plusDaysLocalValue("2026-10-18T19:00", 7)).toBe("2026-10-25T19:00");
    /* The next-hour expectation is derived from NOW's LOCAL wall
     * clock: the helper speaks datetime-local, so its answer is the
     * next full hour on the runner's own clock. A literal here only
     * passes in the author's zone (it read "2026-10-18T13:00" under
     * UTC, "2026-10-18T09:00" under America/New_York) — derive it
     * zone-safely instead; the :00 minutes and the +1 hour stay
     * pinned. */
    const next = new Date(NOW);
    next.setMinutes(0, 0, 0);
    next.setHours(next.getHours() + 1);
    const pad = (n: number) => String(n).padStart(2, "0");
    const expectedNext = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}T${pad(next.getHours())}:00`;
    expect(nextHourLocalValue(NOW)).toBe(expectedNext);
  });
});

describe("refusal copy", () => {
  it("a taken slot reads plainly; the server's own message otherwise wins", () => {
    expect(officeHoursErrorCopy(409, { error: "SLOT_TAKEN", message: "That room already has an event in that window." })).toContain("already has something booked");
    expect(officeHoursErrorCopy(403, { error: "NOT_YOUR_ROOM", message: "Office hours are held in your own room." })).toBe(
      "Office hours are held in your own room.",
    );
    expect(officeHoursErrorCopy(401, {})).toContain("Sign in");
    expect(officeHoursErrorCopy(500, {})).toContain("try again");
  });
});

describe("source pins — the surfaces carry the feature", () => {
  const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

  it("the Kingdom Board labels office hours and names a creator room for its host", () => {
    const board = read("../../components/world/native/KingdomBoardBlocks.tsx");
    expect(board).toContain('office_hours: "Office hours"');
    expect(board).toContain('roomId.startsWith("creator:")');
    expect(board).toContain("roomNameFor(e.roomId, e.hostName)");
  });

  it("the room panel carries the marker, the upcoming list and the host's form", () => {
    const rooms = read("../../components/world/native/CreatorRooms.tsx");
    expect(rooms).toContain('data-testid="world-creator-room-office-hours"');
    expect(rooms).toContain('data-testid="world-creator-room-office-hours-upcoming"');
    expect(rooms).toContain('data-testid="world-creator-room-office-hours-host"');
    expect(rooms).toContain('data-testid="world-office-hours-book"');
    expect(rooms).toContain('data-testid="world-office-hours-cancel"');
    /* The form is owner-gated in the component, and booking rides
     * the calendar's rails — never a parallel store. */
    expect(rooms).toContain("isOwnRoom={!!mySlug && mySlug === slug}");
    expect(rooms).toContain("OFFICE_HOURS_BOOK_PATH");
    expect(rooms).toContain("officeHoursSlatePath(detail.roomId)");
  });

  it("the station panel threads the walker's slug into the room stations", () => {
    const panel = read("../../components/world/StationPanel.tsx");
    expect(panel).toContain("mySlug={props.mySlug ?? null}");
  });
});
