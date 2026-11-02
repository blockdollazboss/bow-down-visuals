/**
 * office-hours.test.ts — pins for the Office Hours 2D door helpers.
 * The price-validity cases mirror the server rail's own suite
 * (api lib/__tests__/office-hours.test.ts) so FE and server can
 * never disagree about what a bookable Office Hours offer is.
 */
import { describe, expect, it } from "vitest";
import {
  availabilityFormFrom,
  availabilityFromForm,
  emptyAvailabilityForm,
  groupSlotsForViewer,
  isOfficeHoursFlagged,
  officeHoursPriceVb,
  weekdayShortLabel,
} from "./office-hours";
import type { BookingAvailabilityDTO } from "./storefront-api";

describe("officeHoursPriceVb mirrors the rail's officeHoursInfo", () => {
  it("returns the price for a flagged, validly priced service", () => {
    expect(officeHoursPriceVb({ office_hours: true, price_vb: 750 })).toBe(750);
  });
  it("is null without the flag, even with a price", () => {
    expect(officeHoursPriceVb({ price_vb: 750 })).toBeNull();
    expect(officeHoursPriceVb({ office_hours: false, price_vb: 750 })).toBeNull();
  });
  it("is null for every invalid price the server also refuses", () => {
    for (const sd of [
      { office_hours: true },
      { office_hours: true, price_vb: 0 },
      { office_hours: true, price_vb: -5 },
      { office_hours: true, price_vb: 7.5 },
      { office_hours: true, price_vb: "750" as unknown as number },
    ]) {
      expect(officeHoursPriceVb(sd)).toBeNull();
    }
  });
  it("handles null/undefined service details", () => {
    expect(officeHoursPriceVb(null)).toBeNull();
    expect(officeHoursPriceVb(undefined)).toBeNull();
    expect(isOfficeHoursFlagged(null)).toBe(false);
    expect(isOfficeHoursFlagged({ office_hours: true })).toBe(true);
  });
});

describe("availability form round-trip", () => {
  const av: BookingAvailabilityDTO = {
    timezone: "America/New_York",
    weekly: [
      { weekday: 1, start: "10:00", end: "12:00" },
      { weekday: 1, start: "14:00", end: "18:00" },
      { weekday: 3, start: "09:00", end: "17:00" },
    ],
  };

  it("loads a stored grid, collapsing a split day to its widest span", () => {
    const form = availabilityFormFrom(av, "UTC");
    expect(form.timezone).toBe("America/New_York");
    const mon = form.days[1]!;
    expect(mon.on).toBe(true);
    expect(mon.start).toBe("10:00");
    expect(mon.end).toBe("18:00");
    expect(form.days[3]!.on).toBe(true);
    expect(form.days[0]!.on).toBe(false);
    expect(form.days[2]!.on).toBe(false);
  });

  it("saves back to the rail shape with one window per on-day", () => {
    const out = availabilityFromForm(availabilityFormFrom(av, "UTC"));
    expect(out).toEqual({
      timezone: "America/New_York",
      weekly: [
        { weekday: 1, start: "10:00", end: "18:00" },
        { weekday: 3, start: "09:00", end: "17:00" },
      ],
    });
  });

  it("refuses grids the server would call unbookable", () => {
    const none = emptyAvailabilityForm("UTC");
    for (const d of none.days) d.on = false;
    expect(availabilityFromForm(none)).toBeNull();

    const backwards = emptyAvailabilityForm("UTC");
    backwards.days[2] = { weekday: 2, on: true, start: "17:00", end: "09:00" };
    expect(availabilityFromForm(backwards)).toBeNull();

    const badTz = emptyAvailabilityForm("Mars/Olympus");
    expect(availabilityFromForm(badTz)).toBeNull();
  });

  it("a fresh form defaults to creator-local weekdays 9–5", () => {
    const form = emptyAvailabilityForm("Europe/London");
    expect(form.timezone).toBe("Europe/London");
    expect(form.days.filter((d) => d.on).map((d) => d.weekday)).toEqual([1, 2, 3, 4, 5]);
    expect(availabilityFromForm(form)?.weekly).toHaveLength(5);
  });

  it("weekday labels start on Sunday", () => {
    expect(weekdayShortLabel(0, "en-US")).toBe("Sun");
    expect(weekdayShortLabel(6, "en-US")).toBe("Sat");
  });
});

describe("groupSlotsForViewer re-buckets instants into the viewer's dates", () => {
  /* One creator-day (New York) whose slots straddle midnight UTC. */
  const days = [{
    date: "2027-01-04",
    slots: [
      { startUtc: "2027-01-05T02:00:00.000Z", endUtc: "2027-01-05T03:00:00.000Z" }, // Mon 21:00 NY
      { startUtc: "2027-01-04T14:00:00.000Z", endUtc: "2027-01-04T15:00:00.000Z" }, // Mon 09:00 NY
    ],
  }];

  it("groups by viewer-local date and labels local times (New York viewer)", () => {
    const out = groupSlotsForViewer(days, "America/New_York", "en-US");
    expect(out).toHaveLength(1);
    expect(out[0]!.dateKey).toBe("2027-01-04");
    expect(out[0]!.label).toContain("Monday");
    expect(out[0]!.slots.map((s) => s.timeLabel)).toEqual(["9:00 AM", "9:00 PM"]);
  });

  it("the same instants land on a different date for a Tokyo viewer", () => {
    const out = groupSlotsForViewer(days, "Asia/Tokyo", "en-US");
    expect(out.map((d) => d.dateKey)).toEqual(["2027-01-04", "2027-01-05"]);
    expect(out[1]!.slots[0]!.timeLabel).toBe("11:00 AM");
  });

  it("empty input is an empty list, not an error", () => {
    expect(groupSlotsForViewer([], "UTC", "en-US")).toEqual([]);
  });
});
