/**
 * World Contests policy (lib/world-contests + the contest arm of
 * lib/world-events' payload sanitizer) — pure pins:
 * - the stages are exactly the palace's two (Throne Hall, Music
 *   Hall) and hosting mirrors each room's standing rule;
 * - the entry window has a floor (1h) and the backbone's own
 *   30-day horizon;
 * - phase is a pure function of the event row + the clock +
 *   whether winners stand (decided outranks the clock);
 * - the winners' headline fits the palace's 140-character ear and
 *   names the first-place winner, the contest and the work;
 * - the theme payload sanitizes like every other event payload.
 */
import { describe, it, expect, vi } from "vitest";
import {
  announceContestWinners,
  contestAcceptsEntries,
  contestDeadlineError,
  contestPhase,
  contestPrivilegeForRoom,
  contestWinnersAnnouncement,
  isContestRoom,
  registerWorldContestAnnouncer,
  THRONE_HALL_ROOM_ID,
  toContestWinnerDto,
  toWinnersCircleHonorDto,
} from "../world-contests";
import { MUSIC_HALL_ROOM_ID, sanitizeEventPayload } from "../world-events";

const NOW = new Date("2026-10-20T12:00:00Z");
const HOUR = 3_600_000;

function eventRow(partial: Record<string, unknown> = {}) {
  return {
    status: "scheduled",
    startsAt: new Date(NOW.getTime() - HOUR),
    endsAt: new Date(NOW.getTime() + 24 * HOUR),
    ...partial,
  } as never;
}

describe("stages + hosting privilege", () => {
  it("the stages are the Throne Hall and the Music Hall, nothing else", () => {
    expect(isContestRoom(THRONE_HALL_ROOM_ID)).toBe(true);
    expect(isContestRoom(MUSIC_HALL_ROOM_ID)).toBe(true);
    expect(isContestRoom("world:courtyard")).toBe(false);
    expect(isContestRoom("world:royal-court")).toBe(false);
  });

  it("Throne Hall contests are Front Row + house; Music Hall contests are any member's", () => {
    expect(contestPrivilegeForRoom(THRONE_HALL_ROOM_ID)).toBe("front-row-or-admin");
    expect(contestPrivilegeForRoom(MUSIC_HALL_ROOM_ID)).toBe("member");
  });
});

describe("the entry window", () => {
  it("a deadline under an hour out is refused; an hour or more stands", () => {
    expect(contestDeadlineError(NOW, new Date(NOW.getTime() + 30 * 60_000))).toMatch(/at least an hour/);
    expect(contestDeadlineError(NOW, new Date(NOW.getTime() + HOUR))).toBeNull();
    expect(contestDeadlineError(NOW, new Date(NOW.getTime() + 24 * HOUR))).toBeNull();
  });

  it("a past deadline and a >30-day deadline are refused in plain words", () => {
    expect(contestDeadlineError(NOW, new Date(NOW.getTime() - 1000))).toMatch(/already past/);
    expect(contestDeadlineError(NOW, new Date(NOW.getTime() + 31 * 24 * HOUR))).toMatch(/30 days/);
  });
});

describe("phase", () => {
  it("walks announced → open → judging, and decided outranks the clock", () => {
    expect(
      contestPhase(eventRow({ startsAt: new Date(NOW.getTime() + HOUR) }), NOW, false),
    ).toBe("announced");
    expect(contestPhase(eventRow({}), NOW, false)).toBe("open");
    expect(
      contestPhase(eventRow({ endsAt: new Date(NOW.getTime() - 1000) }), NOW, false),
    ).toBe("judging");
    expect(contestPhase(eventRow({ status: "done" }), NOW, false)).toBe("judging");
    expect(contestPhase(eventRow({}), NOW, true)).toBe("decided");
    expect(contestPhase(eventRow({ status: "cancelled" }), NOW, true)).toBe("called-off");
  });

  it("entries stand only while the window does", () => {
    expect(contestAcceptsEntries(eventRow({}) as never, NOW)).toBe(true);
    expect(
      contestAcceptsEntries(eventRow({ endsAt: new Date(NOW.getTime()) }) as never, NOW),
    ).toBe(false);
    expect(contestAcceptsEntries(eventRow({ status: "done" }) as never, NOW)).toBe(false);
    expect(contestAcceptsEntries(eventRow({ status: "cancelled" }) as never, NOW)).toBe(false);
  });
});

describe("the theme payload (sanitizeEventPayload, contest arm)", () => {
  it("trims and keeps a real theme; drops unknown keys", () => {
    const out = sanitizeEventPayload("contest", { theme: "  A hook that stops the scroll  ", junk: 1 });
    expect(out).toEqual({ ok: true, payload: { theme: "A hook that stops the scroll" } });
  });

  it("refuses an empty theme and an over-long one in plain words", () => {
    expect(sanitizeEventPayload("contest", { theme: "   " })).toMatchObject({ ok: false });
    expect(sanitizeEventPayload("contest", {})).toMatchObject({ ok: false });
    const long = sanitizeEventPayload("contest", { theme: "x".repeat(141) });
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.error).toMatch(/140/);
  });
});

describe("DTO shaping", () => {
  const winnerRow = {
    id: "w1",
    eventId: "evt-1",
    entryId: "e1",
    userId: "u1",
    place: 1,
    winnerName: "Ada",
    workKind: "track",
    workId: "t1",
    workTitle: "Golden Hook",
    decidedBy: "host",
    createdAt: new Date("2026-10-25T00:00:00Z"),
  } as never;

  it("the winner DTO carries the frozen snapshots", () => {
    expect(toContestWinnerDto(winnerRow)).toEqual({
      id: "w1",
      entryId: "e1",
      userId: "u1",
      place: 1,
      winnerName: "Ada",
      workKind: "track",
      workTitle: "Golden Hook",
      decidedAt: "2026-10-25T00:00:00.000Z",
    });
  });

  it("the Circle honor joins the winner to its contest", () => {
    const honor = toWinnersCircleHonorDto(winnerRow, {
      id: "evt-1",
      title: "Best Hook",
      roomId: MUSIC_HALL_ROOM_ID,
    } as never);
    expect(honor).toMatchObject({
      place: 1,
      winnerName: "Ada",
      contestTitle: "Best Hook",
      roomId: MUSIC_HALL_ROOM_ID,
    });
  });
});

describe("the winners' announcement", () => {
  const winners = [
    { id: "w2", entryId: "e2", userId: "u2", place: 2, winnerName: "Bo", workKind: "video" as const, workTitle: "Second Song", decidedAt: "2026-10-25T00:00:00.000Z" },
    { id: "w1", entryId: "e1", userId: "u1", place: 1, winnerName: "Ada", workKind: "track" as const, workTitle: "Golden Hook", decidedAt: "2026-10-25T00:00:00.000Z" },
  ];

  it("names FIRST place (not array order), the contest and the work — inside 140 chars", () => {
    const a = contestWinnersAnnouncement({ title: "Best Hook in the Palace", roomId: MUSIC_HALL_ROOM_ID } as never, winners);
    expect(a).not.toBeNull();
    expect(a!.kind).toBe("show");
    expect(a!.roomId).toBe(MUSIC_HALL_ROOM_ID);
    expect(a!.name).toBe("Ada");
    expect(a!.text).toContain("Ada");
    expect(a!.text).toContain("Best Hook in the Palace");
    expect(a!.text).toContain("Golden Hook");
    expect(a!.text.length).toBeLessThanOrEqual(140);
  });

  it("long names and titles are shrunk, never spilled past the cap", () => {
    const a = contestWinnersAnnouncement(
      { title: "T".repeat(120), roomId: MUSIC_HALL_ROOM_ID } as never,
      [{ ...winners[1]!, winnerName: "N".repeat(80), workTitle: "W".repeat(90) }],
    );
    expect(a!.text.length).toBeLessThanOrEqual(140);
    expect(a!.text).toContain("…");
  });

  it("no winners, no announcement", () => {
    expect(contestWinnersAnnouncement({ title: "X", roomId: MUSIC_HALL_ROOM_ID } as never, [])).toBeNull();
  });

  it("the hook speaks only when boot wired it, and unregistering silences it", () => {
    const a = contestWinnersAnnouncement({ title: "Best Hook", roomId: MUSIC_HALL_ROOM_ID } as never, winners)!;
    expect(announceContestWinners(a)).toBe(false);
    const spy = vi.fn();
    registerWorldContestAnnouncer(spy);
    expect(announceContestWinners(a)).toBe(true);
    expect(spy).toHaveBeenCalledWith(a);
    registerWorldContestAnnouncer(null);
    expect(announceContestWinners(a)).toBe(false);
  });
});
