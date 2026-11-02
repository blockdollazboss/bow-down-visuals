/**
 * drop-booking.test.ts — the admin drop-spectacle booking seam
 * (UPGRADE-PROGRAM 3.4's booking half, stack1300).
 *
 * Pins: the room fold is exactly the palace's rooms; the request
 * builder mirrors the server's sanitize + window rules — including
 * the money numbers in the rail's own bounds (100–1,000 Visual Bucs
 * per claim, 1–30 claims); the refusal map (ADMIN_REQUIRED is the
 * gate); and the strict slate parse (a malformed answer is a failed
 * read — null — never a painted-empty list).
 */
import { describe, expect, it } from "vitest";
import {
  buildDropBody,
  dropBookingError,
  dropRooms,
  isDropRoomId,
  parseUpcomingDrops,
  DROP_MAX_AMOUNT_VB,
  DROP_WEEKLY_BUDGET_VB,
} from "./drop-booking";

const NOW = Date.parse("2026-11-02T12:00:00.000Z");
const HOUR = 3600_000;

describe("drop-booking — the room fold", () => {
  it("offers exactly the palace's 14 rooms, named by the layout", () => {
    const rooms = dropRooms();
    expect(rooms).toHaveLength(14);
    expect(rooms.map((r) => r.id)).toContain("world:kings-hall");
    expect(rooms.map((r) => r.id)).toContain("world:courtyard");
    expect(rooms.find((r) => r.id === "world:kings-hall")?.name).toBe("The King's Hall");
    for (const r of rooms) expect(r.name.length).toBeGreaterThan(0);
  });

  it("a creator room is never a drop room (spectacles land in the palace)", () => {
    expect(isDropRoomId("creator:someone")).toBe(false);
    expect(isDropRoomId("world:music-hall")).toBe(true);
    expect(isDropRoomId("")).toBe(false);
  });
});

describe("drop-booking — the request builder mirrors the server's rules", () => {
  const draft = (over: Partial<Parameters<typeof buildDropBody>[0]> = {}) => ({
    title: "Crown Drop",
    roomId: "world:courtyard",
    startsAtMs: NOW + 2 * HOUR,
    durationMin: 60,
    amountVb: 250,
    claimCap: 10,
    ...over,
  });

  it("books a spectacle with the rail's payload shape", () => {
    expect(buildDropBody(draft(), NOW)).toEqual({
      ok: true,
      body: {
        kind: "drop",
        roomId: "world:courtyard",
        title: "Crown Drop",
        startsAt: new Date(NOW + 2 * HOUR).toISOString(),
        endsAt: new Date(NOW + 3 * HOUR).toISOString(),
        payload: { amountVb: 250, claimCap: 10 },
      },
    });
  });

  it("holds the money bounds exactly as the rail states them", () => {
    expect(DROP_MAX_AMOUNT_VB).toBe(1000);
    expect(DROP_WEEKLY_BUDGET_VB).toBe(1000);
    expect(buildDropBody(draft({ amountVb: 99 }), NOW)).toEqual({ ok: false, error: "amountRange" });
    expect(buildDropBody(draft({ amountVb: 1001 }), NOW)).toEqual({ ok: false, error: "amountRange" });
    expect(buildDropBody(draft({ amountVb: 250.5 }), NOW)).toEqual({ ok: false, error: "amountRange" });
    expect(buildDropBody(draft({ amountVb: 100 }), NOW).ok).toBe(true);
    expect(buildDropBody(draft({ amountVb: 1000 }), NOW).ok).toBe(true);
    expect(buildDropBody(draft({ claimCap: 0 }), NOW)).toEqual({ ok: false, error: "claimRange" });
    expect(buildDropBody(draft({ claimCap: 31 }), NOW)).toEqual({ ok: false, error: "claimRange" });
    expect(buildDropBody(draft({ claimCap: 30 }), NOW).ok).toBe(true);
  });

  it("refuses unknown rooms, bad titles and bad windows by their codes", () => {
    expect(buildDropBody(draft({ roomId: "creator:me" }), NOW)).toEqual({ ok: false, error: "roomUnknown" });
    expect(buildDropBody(draft({ title: " " }), NOW)).toEqual({ ok: false, error: "titleRequired" });
    expect(buildDropBody(draft({ title: "y".repeat(121) }), NOW)).toEqual({ ok: false, error: "titleTooLong" });
    expect(buildDropBody(draft({ durationMin: 3 }), NOW)).toEqual({ ok: false, error: "durationTooShort" });
    expect(buildDropBody(draft({ durationMin: 300 }), NOW)).toEqual({ ok: false, error: "durationTooLong" });
    expect(buildDropBody(draft({ startsAtMs: Number.NaN }), NOW)).toEqual({ ok: false, error: "startRequired" });
    expect(buildDropBody(draft({ startsAtMs: NOW - HOUR }), NOW)).toEqual({ ok: false, error: "startPast" });
    expect(buildDropBody(draft({ startsAtMs: NOW + 31 * 24 * HOUR }), NOW)).toEqual({ ok: false, error: "startTooFar" });
  });
});

describe("drop-booking — the booking-rule gate: the house-only refusal", () => {
  it("ADMIN_REQUIRED resolves to the refusal words", () => {
    expect(
      dropBookingError(403, { error: "ADMIN_REQUIRED", message: "Drop spectacles are booked by the house." }),
    ).toEqual({ kind: "key", key: "refusedAdmin" });
  });

  it("slot-taken resolves to its key; payload refusals keep the server's sentence", () => {
    expect(dropBookingError(409, { error: "SLOT_TAKEN" })).toEqual({ kind: "key", key: "slotTaken" });
    expect(
      dropBookingError(400, { error: "INVALID_PAYLOAD", message: "A drop pays between 100 and 1000 Visual Bucs per claim." }),
    ).toEqual({ kind: "message", message: "A drop pays between 100 and 1000 Visual Bucs per claim." });
    expect(dropBookingError(401, null)).toEqual({ kind: "key", key: "signIn" });
    expect(dropBookingError(500, null)).toEqual({ kind: "key", key: "failed" });
  });
});

describe("drop-booking — the strict slate parse", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: "d1",
    kind: "drop",
    roomId: "world:courtyard",
    title: "Crown Drop",
    hostName: "The House",
    startsAt: new Date(NOW + HOUR).toISOString(),
    endsAt: new Date(NOW + 2 * HOUR).toISOString(),
    status: "scheduled",
    payload: { amountVb: 250, claimCap: 10 },
    ...over,
  });

  it("keeps open upcoming drops with their money figures, soonest first", () => {
    const parsed = parseUpcomingDrops(
      {
        events: [
          row({ id: "later", startsAt: new Date(NOW + 5 * HOUR).toISOString(), endsAt: new Date(NOW + 6 * HOUR).toISOString() }),
          row({ id: "show", kind: "stage_show" }),
          row({ id: "over", startsAt: new Date(NOW - 2 * HOUR).toISOString(), endsAt: new Date(NOW - HOUR).toISOString() }),
          row({ id: "soon", status: "live" }),
          row({ id: "cancelled", status: "cancelled" }),
        ],
      },
      NOW,
    );
    expect(parsed?.map((d) => d.id)).toEqual(["soon", "later"]);
    expect(parsed?.[0]).toMatchObject({ amountVb: 250, claimCap: 10, status: "live" });
  });

  it("a malformed answer is a FAILED read (null), never an empty list", () => {
    expect(parseUpcomingDrops(null, NOW)).toBeNull();
    expect(parseUpcomingDrops({}, NOW)).toBeNull();
    expect(parseUpcomingDrops({ events: "nope" }, NOW)).toBeNull();
    expect(parseUpcomingDrops({ events: [] }, NOW)).toEqual([]);
  });
});
