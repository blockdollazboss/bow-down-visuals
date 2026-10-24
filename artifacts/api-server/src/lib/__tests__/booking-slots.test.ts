/**
 * booking-slots engine — pure timezone/slot math.
 *
 * Anchors (verified calendar facts):
 *  - 2026-01-05 is a Monday; America/New_York is EST (UTC-5) in January.
 *  - 2026-07-06 is a Monday; America/New_York is EDT (UTC-4) in July.
 *  - Pacific/Auckland is NZDT (UTC+13) in January.
 */
import { describe, it, expect } from "vitest";
import {
  generateOpenSlots,
  isGridSlot,
  isValidAvailability,
  windowsForDate,
  zonedTimeToUtc,
  ymdInTimeZone,
  type BookingAvailability,
} from "../booking-slots";

const MON_9_TO_11_NY: BookingAvailability = {
  timezone: "America/New_York",
  weekly: [{ weekday: 1, start: "09:00", end: "11:00" }],
};

const NOW_JAN = new Date("2026-01-01T00:00:00.000Z");
const JAN_RANGE = {
  fromUtc: new Date("2026-01-04T00:00:00.000Z"),
  toUtc: new Date("2026-01-07T00:00:00.000Z"),
};

describe("zonedTimeToUtc / ymdInTimeZone", () => {
  it("resolves a winter wall time in New York to UTC-5", () => {
    expect(zonedTimeToUtc("2026-01-05", "09:00", "America/New_York").toISOString())
      .toBe("2026-01-05T14:00:00.000Z");
  });
  it("resolves a summer wall time in New York to UTC-4 (DST)", () => {
    expect(zonedTimeToUtc("2026-07-06", "09:00", "America/New_York").toISOString())
      .toBe("2026-07-06T13:00:00.000Z");
  });
  it("resolves Auckland wall time across the UTC date line", () => {
    // Mon 09:00 NZDT (+13) is Sunday 20:00 UTC.
    expect(zonedTimeToUtc("2026-01-05", "09:00", "Pacific/Auckland").toISOString())
      .toBe("2026-01-04T20:00:00.000Z");
  });
  it("ymdInTimeZone reports the local calendar date", () => {
    expect(ymdInTimeZone(new Date("2026-01-05T01:00:00.000Z"), "America/New_York"))
      .toBe("2026-01-04");
    expect(ymdInTimeZone(new Date("2026-01-05T01:00:00.000Z"), "Pacific/Auckland"))
      .toBe("2026-01-05");
  });
});

describe("generateOpenSlots", () => {
  it("lays out back-to-back slots inside a weekly window, in UTC", () => {
    const slots = generateOpenSlots({
      availability: MON_9_TO_11_NY, durationMin: 30, taken: [], ...JAN_RANGE, now: NOW_JAN,
    });
    expect(slots.map((s) => s.startUtc)).toEqual([
      "2026-01-05T14:00:00.000Z",
      "2026-01-05T14:30:00.000Z",
      "2026-01-05T15:00:00.000Z",
      "2026-01-05T15:30:00.000Z",
    ]);
    expect(slots[0]!.endUtc).toBe("2026-01-05T14:30:00.000Z");
  });

  it("keeps the same wall clock across the DST change (summer Monday)", () => {
    const slots = generateOpenSlots({
      availability: MON_9_TO_11_NY, durationMin: 60, taken: [],
      fromUtc: new Date("2026-07-05T00:00:00.000Z"),
      toUtc: new Date("2026-07-08T00:00:00.000Z"),
      now: new Date("2026-07-01T00:00:00.000Z"),
    });
    expect(slots.map((s) => s.startUtc)).toEqual([
      "2026-07-06T13:00:00.000Z", // 09:00 EDT
      "2026-07-06T14:00:00.000Z", // 10:00 EDT
    ]);
  });

  it("subtracts taken bookings", () => {
    const slots = generateOpenSlots({
      availability: MON_9_TO_11_NY, durationMin: 30,
      taken: [{ startUtc: "2026-01-05T14:30:00.000Z", endUtc: "2026-01-05T15:00:00.000Z" }],
      ...JAN_RANGE, now: NOW_JAN,
    });
    expect(slots.map((s) => s.startUtc)).toEqual([
      "2026-01-05T14:00:00.000Z",
      "2026-01-05T15:00:00.000Z",
      "2026-01-05T15:30:00.000Z",
    ]);
  });

  it("buffer widens the blocked span around taken bookings and the step", () => {
    const av: BookingAvailability = { ...MON_9_TO_11_NY, buffer_min: 15 };
    const slots = generateOpenSlots({
      availability: av, durationMin: 30,
      taken: [{ startUtc: "2026-01-05T14:30:00.000Z", endUtc: "2026-01-05T15:00:00.000Z" }],
      ...JAN_RANGE, now: NOW_JAN,
    });
    // Step defaults to duration+buffer = 45m: grid 14:00, 14:45, 15:30.
    // The taken span widens to [14:15, 15:15): 14:45 sits inside it, and
    // 14:00–14:30 would leave the creator zero breather before the 14:30
    // booking (buffer applies on BOTH sides) → both blocked; only 15:30,
    // which starts after the widened span ends, survives.
    expect(slots.map((s) => s.startUtc)).toEqual([
      "2026-01-05T15:30:00.000Z",
    ]);
  });

  it("an override with windows:null closes the day; custom windows replace weekly", () => {
    const off: BookingAvailability = {
      ...MON_9_TO_11_NY,
      overrides: [{ date: "2026-01-05", windows: null }],
    };
    expect(generateOpenSlots({
      availability: off, durationMin: 30, taken: [], ...JAN_RANGE, now: NOW_JAN,
    })).toEqual([]);

    const custom: BookingAvailability = {
      ...MON_9_TO_11_NY,
      overrides: [{ date: "2026-01-05", windows: [{ start: "18:00", end: "19:00" }] }],
    };
    const slots = generateOpenSlots({
      availability: custom, durationMin: 30, taken: [], ...JAN_RANGE, now: NOW_JAN,
    });
    expect(slots.map((s) => s.startUtc)).toEqual([
      "2026-01-05T23:00:00.000Z", // 18:00 EST
      "2026-01-05T23:30:00.000Z",
    ]);
  });

  it("enforces min notice and max advance", () => {
    const av: BookingAvailability = { ...MON_9_TO_11_NY, min_notice_min: 60 * 24 * 8 }; // 8 days
    const slots = generateOpenSlots({
      availability: av, durationMin: 30, taken: [], ...JAN_RANGE, now: NOW_JAN,
    });
    expect(slots).toEqual([]); // Jan 5 is only 4 days out

    const capped: BookingAvailability = { ...MON_9_TO_11_NY, max_advance_days: 3 };
    expect(generateOpenSlots({
      availability: capped, durationMin: 30, taken: [], ...JAN_RANGE, now: NOW_JAN,
    })).toEqual([]);
  });

  it("windowsForDate picks by creator-local weekday", () => {
    expect(windowsForDate(MON_9_TO_11_NY, "2026-01-05")).toEqual([{ start: "09:00", end: "11:00" }]);
    expect(windowsForDate(MON_9_TO_11_NY, "2026-01-06")).toEqual([]);
  });
});

describe("isGridSlot", () => {
  it("accepts an on-grid start and rejects an off-grid one", () => {
    expect(isGridSlot({
      availability: MON_9_TO_11_NY, durationMin: 30,
      startUtc: new Date("2026-01-05T14:30:00.000Z"), now: NOW_JAN,
    })).toBe(true);
    expect(isGridSlot({
      availability: MON_9_TO_11_NY, durationMin: 30,
      startUtc: new Date("2026-01-05T14:15:00.000Z"), now: NOW_JAN,
    })).toBe(false);
    expect(isGridSlot({
      availability: MON_9_TO_11_NY, durationMin: 30,
      startUtc: new Date("2026-01-06T14:00:00.000Z"), now: NOW_JAN, // Tuesday: no window
    })).toBe(false);
  });
});

describe("isValidAvailability", () => {
  it("accepts a well-formed availability and rejects broken ones", () => {
    expect(isValidAvailability(MON_9_TO_11_NY)).toBe(true);
    expect(isValidAvailability({ timezone: "Not/AZone", weekly: [] })).toBe(false);
    expect(isValidAvailability({ timezone: "UTC", weekly: [{ weekday: 7, start: "09:00", end: "10:00" }] })).toBe(false);
    expect(isValidAvailability({ timezone: "UTC", weekly: [{ weekday: 1, start: "10:00", end: "09:00" }] })).toBe(false);
    expect(isValidAvailability({ timezone: "UTC", weekly: [{ weekday: 1, start: "9am", end: "10:00" }] })).toBe(false);
    expect(isValidAvailability(null)).toBe(false);
  });
});
