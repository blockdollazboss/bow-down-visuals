/**
 * period-anchors.test.ts — stack1400 ruling #8 (W6 OD-1): period
 * anchors roll at America/New_York midnight, ONE anchor everywhere.
 *
 * The boundary instants below are chosen so the OLD anchors
 * (server-local month, UTC month, Monday-UTC week) and the NY anchor
 * DISAGREE — each expectation pins the NY answer. DST weeks are
 * pinned too: a NY week containing a switch is 167h (spring) or
 * 169h (fall) between its midnights, never a flat 168h, and the
 * Monday date keys stay stable plain strings throughout.
 */
import { describe, expect, it } from "vitest";
import {
  PERIOD_TIME_ZONE,
  nyDateKey,
  nyMidnightInstant,
  nyMonthKey,
  nyMonthStartKey,
  nyWeekStartKey,
  nyWeekStartOfDayKey,
  nyWeekWindow,
} from "../period-anchors";
import { currentWeekStart } from "../retention";
import { questPoolWeekStart } from "../quest-pool";

describe("the month anchor (Bow Race period)", () => {
  it("is named for New York, and only New York", () => {
    expect(PERIOD_TIME_ZONE).toBe("America/New_York");
  });

  it("month edge in EST: 04:30Z on the 1st is still the OLD month in NY (23:30 on the 30th)", () => {
    const t = new Date("2026-12-01T04:30:00.000Z"); // Mon Nov 30, 23:30 EST
    expect(nyMonthKey(t)).toBe("2026-11"); // UTC slice(0,7) would say 2026-12
    expect(nyMonthStartKey(t)).toBe("2026-11-01");
    expect(nyDateKey(t)).toBe("2026-11-30");
  });

  it("the new month opens exactly at NY midnight, not at UTC midnight", () => {
    expect(nyMonthKey(new Date("2026-12-01T04:59:59.000Z"))).toBe("2026-11");
    expect(nyMonthKey(new Date("2026-12-01T05:00:00.000Z"))).toBe("2026-12"); // Dec 1, 00:00 EST
    expect(nyMonthStartKey(new Date("2026-12-01T05:00:00.000Z"))).toBe("2026-12-01");
  });

  it("month edge in EDT: 03:30Z on the 1st is 23:30 on the last day of the old month", () => {
    expect(nyMonthKey(new Date("2026-11-01T03:30:00.000Z"))).toBe("2026-10"); // Oct 31, 23:30 EDT
    expect(nyMonthKey(new Date("2026-11-01T04:00:00.000Z"))).toBe("2026-11"); // Nov 1, 00:00 EDT
  });

  it("year edge: New Year's Day in UTC is still Dec 31 in New York until 05:00Z", () => {
    expect(nyMonthKey(new Date("2027-01-01T04:59:59.000Z"))).toBe("2026-12");
    expect(nyMonthKey(new Date("2027-01-01T05:00:00.000Z"))).toBe("2027-01");
  });
});

describe("the week anchor (Monday, New York)", () => {
  it("Sunday 23:30 NY = Monday 04:30 UTC belongs to the OLD week under NY — pinned", () => {
    const t = new Date("2026-11-09T04:30:00.000Z"); // Sunday Nov 8, 23:30 EST
    expect(nyWeekStartKey(t)).toBe("2026-11-02"); // Monday-UTC would say 2026-11-09
  });

  it("the same split in EDT: Sunday 23:30 NY = Monday 03:30 UTC is the old week", () => {
    const t = new Date("2026-10-26T03:30:00.000Z"); // Sunday Oct 25, 23:30 EDT
    expect(nyWeekStartKey(t)).toBe("2026-10-19");
  });

  it("the new week opens exactly at NY midnight Monday", () => {
    expect(nyWeekStartKey(new Date("2026-11-09T04:59:59.000Z"))).toBe("2026-11-02"); // Sun 23:59 EST
    expect(nyWeekStartKey(new Date("2026-11-09T05:00:00.000Z"))).toBe("2026-11-09"); // Mon 00:00 EST
    expect(nyWeekStartKey(new Date("2026-10-26T04:30:00.000Z"))).toBe("2026-10-26"); // Mon 00:30 EDT
  });

  it("mid-week instants keep the answers the UTC anchor gave (no gratuitous churn)", () => {
    expect(nyWeekStartKey(new Date("2026-10-14T09:00:00.000Z"))).toBe("2026-10-12"); // Wed
    expect(nyWeekStartKey(new Date("2026-10-17T12:00:00.000Z"))).toBe("2026-10-12"); // Sat
    expect(nyWeekStartKey(new Date("2026-10-18T23:00:00.000Z"))).toBe("2026-10-12"); // Sun 19:00 EDT
    expect(nyWeekStartOfDayKey("2026-10-18")).toBe("2026-10-12"); // Sunday key → its Monday
    expect(nyWeekStartOfDayKey("2026-10-19")).toBe("2026-10-19"); // Monday key → itself
  });

  it("ONE anchor: retention's currentWeekStart and the quest pool's questPoolWeekStart agree with the helper at the boundary", () => {
    const boundary = new Date("2026-11-09T04:30:00.000Z"); // Sun 23:30 NY / Mon 04:30 UTC
    expect(currentWeekStart(boundary)).toBe("2026-11-02");
    expect(questPoolWeekStart(boundary)).toBe("2026-11-02");
    expect(currentWeekStart(boundary)).toBe(questPoolWeekStart(boundary));
    const midweek = new Date("2026-10-14T09:00:00.000Z");
    expect(currentWeekStart(midweek)).toBe(questPoolWeekStart(midweek));
  });
});

describe("DST weeks and NY midnights", () => {
  it("NY midnight is 05:00Z in EST and 04:00Z in EDT", () => {
    expect(nyMidnightInstant("2026-01-15").toISOString()).toBe("2026-01-15T05:00:00.000Z");
    expect(nyMidnightInstant("2026-07-15").toISOString()).toBe("2026-07-15T04:00:00.000Z");
  });

  it("midnight exists and is unambiguous on both switch days (switches are at 02:00 local)", () => {
    // Spring-forward day: midnight is still EST (the 02:00 hour is what vanishes).
    expect(nyMidnightInstant("2026-03-08").toISOString()).toBe("2026-03-08T05:00:00.000Z");
    // Fall-back day: midnight is still EDT (the 01:00 hour is what repeats).
    expect(nyMidnightInstant("2026-11-01").toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });

  it("the spring-forward week is 167 hours between NY midnights, keys stable", () => {
    const w = nyWeekWindow(new Date("2026-03-08T12:00:00.000Z")); // Sun Mar 8, 08:00 EDT
    expect(w.weekStart).toBe("2026-03-02");
    expect(w.weekEnd).toBe("2026-03-09");
    expect(w.startIso).toBe("2026-03-02T05:00:00.000Z"); // EST
    expect(w.endIso).toBe("2026-03-09T04:00:00.000Z"); // EDT
    expect((Date.parse(w.endIso) - Date.parse(w.startIso)) / 3_600_000).toBe(167);
    // The week still turns at NY midnight on the Monday after the switch:
    expect(nyWeekStartKey(new Date("2026-03-09T03:59:59.000Z"))).toBe("2026-03-02"); // Sun 23:59 EDT
    expect(nyWeekStartKey(new Date("2026-03-09T04:00:00.000Z"))).toBe("2026-03-09"); // Mon 00:00 EDT
  });

  it("the fall-back week is 169 hours between NY midnights, keys stable", () => {
    const w = nyWeekWindow("2026-10-26");
    expect(w.weekStart).toBe("2026-10-26");
    expect(w.weekEnd).toBe("2026-11-02");
    expect(w.startIso).toBe("2026-10-26T04:00:00.000Z"); // EDT
    expect(w.endIso).toBe("2026-11-02T05:00:00.000Z"); // EST
    expect((Date.parse(w.endIso) - Date.parse(w.startIso)) / 3_600_000).toBe(169);
    expect(nyWeekStartKey(new Date("2026-11-01T12:00:00.000Z"))).toBe("2026-10-26"); // Sun Nov 1
    expect(nyWeekStartKey(new Date("2026-11-02T04:59:59.000Z"))).toBe("2026-10-26"); // Sun 23:59 EST
    expect(nyWeekStartKey(new Date("2026-11-02T05:00:00.000Z"))).toBe("2026-11-02"); // Mon 00:00 EST
  });

  it("an ordinary week is the familiar 168 hours", () => {
    const w = nyWeekWindow(new Date("2026-10-14T09:00:00.000Z"));
    expect(w).toEqual({
      weekStart: "2026-10-12",
      weekEnd: "2026-10-19",
      startIso: "2026-10-12T04:00:00.000Z",
      endIso: "2026-10-19T04:00:00.000Z",
    });
    expect((Date.parse(w.endIso) - Date.parse(w.startIso)) / 3_600_000).toBe(168);
  });
});
