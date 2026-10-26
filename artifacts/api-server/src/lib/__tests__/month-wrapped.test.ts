/**
 * month-wrapped.test.ts — Stack-200 idea #170 "Your Month, Wrapped".
 *
 * Pins the honesty + smart-law contract:
 *  - opt-out prefs: no row = enabled; opt-out persists; accounts isolated
 *  - month keys: default is the LAST COMPLETE month; future rejected
 *  - the builder omits metrics the site cannot support (null in →
 *    key absent out) and never estimates; zero is real and shows
 *  - best moment = the creator's own most-played item, deterministic
 *    tie-break, none when there were no plays
 *  - share text carries ONLY the metrics present in the recap
 */
import { describe, expect, it } from "vitest";
import {
  buildMonthWrapped,
  buildMonthWrappedShareText,
  getMonthWrappedPrefs,
  isFutureMonth,
  isMonthComplete,
  isValidMonthKey,
  monthLabel,
  monthRangeUtc,
  pickBestMoment,
  previousMonthKey,
  setMonthWrappedPrefs,
  type MonthWrappedPrefsStore,
  type MonthWrappedPrefsWire,
  type MonthWrappedRaw,
} from "../month-wrapped";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-25T12:00:00Z");

function memoryPrefsStore(): MonthWrappedPrefsStore {
  const rows = new Map<string, MonthWrappedPrefsWire>();
  return {
    async getRow(userId) {
      const row = rows.get(userId);
      return row ? { ...row } : null;
    },
    async upsertRow(userId, prefs) {
      rows.set(userId, { ...prefs });
    },
  };
}

function raw(overrides: Partial<MonthWrappedRaw> = {}): MonthWrappedRaw {
  return {
    month: "2026-09",
    displayName: "Test Creator",
    slug: "test-creator",
    plays: 120,
    newFans: 14,
    salesCount: 3,
    salesCreatorCents: 4500,
    newReleases: 2,
    mediaPlays: [
      { kind: "track", mediaId: "m1", title: "First Song", plays: 70 },
      { kind: "video", mediaId: "m2", title: "Big Video", plays: 50 },
    ],
    ...overrides,
  };
}

describe("month-wrapped prefs (opt-out)", () => {
  it("no row yet: enabled by default", async () => {
    expect(await getMonthWrappedPrefs(memoryPrefsStore(), USER_A)).toEqual({ enabled: true });
  });

  it("opt-out persists and reads back", async () => {
    const store = memoryPrefsStore();
    expect(await setMonthWrappedPrefs(store, USER_A, { enabled: false })).toEqual({ enabled: false });
    expect(await getMonthWrappedPrefs(store, USER_A)).toEqual({ enabled: false });
    expect(await setMonthWrappedPrefs(store, USER_A, { enabled: true })).toEqual({ enabled: true });
  });

  it("an empty patch is a no-op; accounts are isolated", async () => {
    const store = memoryPrefsStore();
    await setMonthWrappedPrefs(store, USER_A, { enabled: false });
    expect(await setMonthWrappedPrefs(store, USER_A, {})).toEqual({ enabled: false });
    expect(await getMonthWrappedPrefs(store, USER_B)).toEqual({ enabled: true });
  });
});

describe("month keys", () => {
  it("validates YYYY-MM strictly", () => {
    expect(isValidMonthKey("2026-09")).toBe(true);
    expect(isValidMonthKey("2026-13")).toBe(false);
    expect(isValidMonthKey("2026-9")).toBe(false);
    expect(isValidMonthKey("September 2026")).toBe(false);
  });

  it("the default recap month is the previous, complete month", () => {
    expect(previousMonthKey(NOW)).toBe("2026-09");
    expect(previousMonthKey(new Date("2026-01-10T00:00:00Z"))).toBe("2025-12");
    expect(isMonthComplete("2026-09", NOW)).toBe(true);
    expect(isMonthComplete("2026-10", NOW)).toBe(false);
  });

  it("future months are rejected; the current month is not future", () => {
    expect(isFutureMonth("2026-11", NOW)).toBe(true);
    expect(isFutureMonth("2026-10", NOW)).toBe(false);
    expect(isFutureMonth("2026-09", NOW)).toBe(false);
  });

  it("ranges are [start, end) in UTC and labels are human", () => {
    const { start, end } = monthRangeUtc("2026-02");
    expect(start.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-03-01T00:00:00.000Z");
    expect(monthLabel("2026-09")).toBe("September 2026");
  });
});

describe("buildMonthWrapped", () => {
  it("carries every measured metric and flags a complete period", () => {
    const recap = buildMonthWrapped(raw(), NOW);
    expect(recap).toMatchObject({
      month: "2026-09",
      monthLabel: "September 2026",
      periodComplete: true,
      plays: 120,
      newFans: 14,
      salesCount: 3,
      salesCreatorCents: 4500,
      newReleases: 2,
      hasActivity: true,
    });
    expect(recap.bestMoment).toEqual({ kind: "track", mediaId: "m1", title: "First Song", plays: 70 });
  });

  it("a metric the site cannot support (null) is ABSENT, never zero-filled or estimated", () => {
    const recap = buildMonthWrapped(raw({ plays: null, salesCount: null, salesCreatorCents: null }), NOW);
    expect("plays" in recap).toBe(false);
    expect("salesCount" in recap).toBe(false);
    expect("salesCreatorCents" in recap).toBe(false);
    expect(recap.newFans).toBe(14);
  });

  it("measured zeros are real and show; zero activity is honest", () => {
    const recap = buildMonthWrapped(
      raw({ plays: 0, newFans: 0, salesCount: 0, salesCreatorCents: 0, newReleases: 0, mediaPlays: [] }),
      NOW,
    );
    expect(recap.plays).toBe(0);
    expect(recap.salesCount).toBe(0);
    expect(recap.hasActivity).toBe(false);
    expect(recap.bestMoment).toBeNull();
  });

  it("the current month is flagged as still in progress", () => {
    const recap = buildMonthWrapped(raw({ month: "2026-10" }), NOW);
    expect(recap.periodComplete).toBe(false);
  });
});

describe("pickBestMoment", () => {
  it("picks the most-played item; ties break by title then id", () => {
    expect(
      pickBestMoment([
        { kind: "track", mediaId: "b", title: "Beta", plays: 10 },
        { kind: "track", mediaId: "a", title: "Alpha", plays: 10 },
      ])?.title,
    ).toBe("Alpha");
  });

  it("no plays → no best moment (never invented)", () => {
    expect(pickBestMoment([])).toBeNull();
    expect(pickBestMoment([{ kind: "video", mediaId: "x", title: "Zero", plays: 0 }])).toBeNull();
  });
});

describe("buildMonthWrappedShareText", () => {
  it("includes only the metrics present in the recap", () => {
    const recap = buildMonthWrapped(raw({ plays: null, newReleases: 0 }), NOW);
    const text = buildMonthWrappedShareText(recap);
    expect(text).toContain("September 2026");
    expect(text).not.toMatch(/▶ .* plays/);
    expect(text).toContain("14 new fans");
    expect(text).toContain("3 sales ($45.00 earned)");
    expect(text).not.toContain("new release");
    expect(text).toContain('Best moment: "First Song"');
  });

  it("a sales count without a cents figure never invents money", () => {
    const recap = buildMonthWrapped(raw({ salesCreatorCents: null }), NOW);
    expect(buildMonthWrappedShareText(recap)).toContain("3 sales");
    expect(buildMonthWrappedShareText(recap)).not.toContain("$");
  });
});
