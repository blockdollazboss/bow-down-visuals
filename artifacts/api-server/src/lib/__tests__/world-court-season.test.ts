/**
 * Court seasons (lib/world-court-season, Ring 4, migration 0153).
 *
 * Pinned contract:
 * - The season calendar is pure and deterministic: one UTC calendar
 *   month per season, Season I = October 2026 (the palace game
 *   layer's opening month), named in sequence with Roman numerals
 *   and a courtly subtitle from a fixed cycle.
 * - Season standing is the earned-rank ladder, windowed: counts go
 *   through rankFromCounts untouched (same weights/caps/gates),
 *   zero-point creators never stand, and the placement order is
 *   total — points, business results, published works, user id —
 *   so a tie freezes the same way every time.
 * - The settling freezes the top of the court with each creator's
 *   lifetime earned rank at the turn, and it is idempotent by the
 *   settlement row's primary key: a re-run changes nothing, a
 *   twin tick that loses the insert race stays silent, and the
 *   herald fires exactly once — for the tick that settled, and
 *   only when the court scored.
 */
import { describe, it, expect } from "vitest";
import {
  CourtSeasonScheduler,
  rankSeasonStandings,
  seasonForDate,
  seasonHeraldText,
  seasonSpan,
  settleCourtSeason,
  toRoman,
  COURT_SEASON_MARKS_NAMED,
  type CourtSeasonStore,
  type SeasonStandingInput,
} from "../world-court-season";
import { EMPTY_RANK_COUNTS, type RankCounts } from "../creator-rank";
import type {
  CourtSeasonSettlement as SettlementRow,
  CourtSeasonStanding,
} from "@workspace/db";
import type { PalaceAnnouncement } from "../world-room";

/* ── Fakes ──────────────────────────────────────────────────────── */

function counts(partial: Partial<RankCounts>): RankCounts {
  return { ...EMPTY_RANK_COUNTS, ...partial };
}

function input(
  userId: string,
  partial: Partial<RankCounts>,
  name = `Creator ${userId}`,
): SeasonStandingInput {
  return { userId, displayName: name, slug: `slug-${userId}`, counts: counts(partial) };
}

class FakeStore implements CourtSeasonStore {
  settlements = new Map<string, SettlementRow>();
  inputsByStart = new Map<string, SeasonStandingInput[]>();
  ranks = new Map<string, { stars: number; title: string }>();
  /** When true, markSettled always loses the race (a twin won). */
  loseRace = false;

  async getSettlement(seasonKey: string) {
    return this.settlements.get(seasonKey) ?? null;
  }
  async listSettlements() {
    return [...this.settlements.values()].sort((a, b) => b.ordinal - a.ordinal);
  }
  async markSettled(row: Parameters<CourtSeasonStore["markSettled"]>[0]) {
    if (this.loseRace) return false;
    if (this.settlements.has(row.seasonKey)) return false;
    this.settlements.set(row.seasonKey, {
      ...row,
      standings: row.standings as never,
      settledAt: row.settledAt,
    } as SettlementRow);
    return true;
  }
  async seasonStandings(start: Date) {
    return this.inputsByStart.get(start.toISOString()) ?? [];
  }
  async lifetimeRank(userId: string) {
    return this.ranks.get(userId) ?? { stars: 1, title: "Street Punk" };
  }
}

function fakePalace() {
  const announcements: PalaceAnnouncement[] = [];
  return {
    announcements,
    palace: {
      announce: (a: PalaceAnnouncement) => {
        announcements.push(a);
      },
    },
  };
}

const OCT_2026 = new Date("2026-10-01T00:00:00.000Z");

/* ── The calendar ───────────────────────────────────────────────── */

describe("the season calendar", () => {
  it("Season I is October 2026, the epoch month", () => {
    const s = seasonForDate(new Date("2026-10-18T12:00:00Z"));
    expect(s.ordinal).toBe(1);
    expect(s.seasonKey).toBe("2026-10");
    expect(s.name).toBe("Season I");
    expect(s.subtitle).toBe("of the First Bells");
    expect(s.startsAt.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    expect(s.endsAt.toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });

  it("turns on the UTC month boundary, to the millisecond", () => {
    expect(seasonForDate(new Date("2026-10-31T23:59:59.999Z")).ordinal).toBe(1);
    expect(seasonForDate(new Date("2026-11-01T00:00:00.000Z")).ordinal).toBe(2);
    expect(seasonForDate(new Date("2026-11-01T00:00:00.000Z")).seasonKey).toBe("2026-11");
    expect(seasonForDate(new Date("2026-11-01T00:00:00.000Z")).subtitle).toBe(
      "of the Gilded Ledger",
    );
  });

  it("rolls over the year end in sequence", () => {
    expect(seasonForDate(new Date("2026-12-15T00:00:00Z")).name).toBe("Season III");
    const jan = seasonForDate(new Date("2027-01-01T00:00:00Z"));
    expect(jan.ordinal).toBe(4);
    expect(jan.seasonKey).toBe("2027-01");
    expect(jan.name).toBe("Season IV");
    expect(jan.subtitle).toBe("of the Winter Hearth");
    expect(jan.endsAt.toISOString()).toBe("2027-02-01T00:00:00.000Z");
  });

  it("the subtitle cycle wraps every twelve seasons", () => {
    const s13 = seasonForDate(new Date("2027-10-01T00:00:00Z"));
    expect(s13.ordinal).toBe(13);
    expect(s13.name).toBe("Season XIII");
    expect(s13.subtitle).toBe("of the First Bells");
  });

  it("anything before the epoch reads as Season I, whose span still starts at the epoch", () => {
    const s = seasonForDate(new Date("2026-03-01T00:00:00Z"));
    expect(s.ordinal).toBe(1);
    expect(s.startsAt.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  it("seasonSpan and seasonForDate agree across two years of turns", () => {
    for (let ord = 1; ord <= 24; ord++) {
      const span = seasonSpan(ord);
      expect(seasonForDate(span.startsAt).seasonKey).toBe(span.seasonKey);
      expect(seasonForDate(new Date(span.endsAt.getTime() - 1)).ordinal).toBe(ord);
      expect(seasonForDate(span.endsAt).ordinal).toBe(ord + 1);
      // Spans tile: each season ends where the next begins.
      expect(seasonSpan(ord + 1).startsAt.getTime()).toBe(span.endsAt.getTime());
    }
  });

  it("roman numerals", () => {
    expect(toRoman(1)).toBe("I");
    expect(toRoman(2)).toBe("II");
    expect(toRoman(4)).toBe("IV");
    expect(toRoman(9)).toBe("IX");
    expect(toRoman(14)).toBe("XIV");
    expect(toRoman(40)).toBe("XL");
    expect(toRoman(58)).toBe("LVIII");
  });
});

/* ── The ranking ────────────────────────────────────────────────── */

describe("rankSeasonStandings — the ladder, windowed", () => {
  it("scores counts with the ladder's own weights (a track is 10, a video 15)", () => {
    const ranked = rankSeasonStandings([
      input("a", { publishedTracks: 1 }),
      input("b", { publishedVideos: 1 }),
      input("c", { publishedTracks: 1, publishedVideos: 1 }),
    ]);
    expect(ranked.map((r) => [r.userId, r.points])).toEqual([
      ["c", 25],
      ["b", 15],
      ["a", 10],
    ]);
  });

  it("the ladder's caps bind a season exactly as they bind a lifetime", () => {
    const ranked = rankSeasonStandings([input("a", { publishedTracks: 100 })]);
    expect(ranked[0]!.points).toBe(300); // 10/track, capped at 300
  });

  it("zero-point creators never stand", () => {
    expect(rankSeasonStandings([input("a", {})])).toEqual([]);
  });

  it("ties break deterministically: business results, published works, then user id", () => {
    // All three score 20 points: 1 sale (20) vs 2 tracks (2×10) vs 4 exports (4×5).
    const ranked = rankSeasonStandings([
      input("z-exports", { exports: 4 }),
      input("a-tracks", { publishedTracks: 2 }),
      input("m-sale", { sales: 1 }),
    ]);
    expect(ranked.map((r) => r.userId)).toEqual(["m-sale", "a-tracks", "z-exports"]);
    // Identical everything → user id ascending.
    const dead = rankSeasonStandings([
      input("b", { publishedTracks: 1 }),
      input("a", { publishedTracks: 1 }),
    ]);
    expect(dead.map((r) => r.userId)).toEqual(["a", "b"]);
  });

  it("freezes at most the top of the court", () => {
    const inputs = Array.from({ length: 14 }, (_, i) =>
      input(`u${String(i).padStart(2, "0")}`, { publishedTracks: i + 1 }),
    );
    const ranked = rankSeasonStandings(inputs);
    expect(ranked.length).toBe(COURT_SEASON_MARKS_NAMED);
    expect(ranked[0]!.userId).toBe("u13");
    expect(ranked[ranked.length - 1]!.userId).toBe("u04");
  });
});

/* ── The herald ─────────────────────────────────────────────────── */

describe("the settling herald", () => {
  const standings: CourtSeasonStanding[] = [
    { place: 1, userId: "a", displayName: "Ada", slug: "ada", points: 90, stars: 3, title: "Gangster" },
    { place: 2, userId: "b", displayName: "Bo", slug: "bo", points: 50, stars: 2, title: "Hustler" },
    { place: 3, userId: "c", displayName: "Cy", slug: "cy", points: 30, stars: 2, title: "Hustler" },
    { place: 4, userId: "d", displayName: "Di", slug: "di", points: 10, stars: 1, title: "Street Punk" },
  ];

  it("names the season and the first three of the court, and points at the wall", () => {
    const text = seasonHeraldText(seasonSpan(1), standings);
    expect(text).toContain("Season I, of the First Bells, is settled");
    expect(text).toContain("First of the court: Ada, Bo, Cy.");
    expect(text).not.toContain("Di");
    expect(text).toContain("Season Marks Wall in the Royal Court Chamber");
  });

  it("an empty court still gets its settling line, with nobody named", () => {
    const text = seasonHeraldText(seasonSpan(2), []);
    expect(text).toContain("Season II, of the Gilded Ledger, is settled");
    expect(text).not.toContain("First of the court");
  });
});

/* ── The settling ───────────────────────────────────────────────── */

describe("settleCourtSeason — the freeze", () => {
  it("freezes placements with places, season points, and the lifetime rank at the turn", async () => {
    const store = new FakeStore();
    store.inputsByStart.set(OCT_2026.toISOString(), [
      input("a", { publishedTracks: 3 }, "Ada"),
      input("b", { publishedVideos: 1 }, "Bo"),
      input("c", {}, "Cy"), // scored nothing — no mark
    ]);
    store.ranks.set("a", { stars: 4, title: "Shot Caller" });
    store.ranks.set("b", { stars: 2, title: "Hustler" });

    const outcome = await settleCourtSeason(store, seasonSpan(1), new Date("2026-11-01T00:00:30Z"));
    expect(outcome.inserted).toBe(true);
    expect(outcome.standings).toEqual([
      { place: 1, userId: "a", displayName: "Ada", slug: "slug-a", points: 30, stars: 4, title: "Shot Caller" },
      { place: 2, userId: "b", displayName: "Bo", slug: "slug-b", points: 15, stars: 2, title: "Hustler" },
    ]);
    const row = store.settlements.get("2026-10")!;
    expect(row.ordinal).toBe(1);
    expect(row.name).toBe("Season I");
    expect(row.standings).toEqual(outcome.standings);
    expect(row.heraldText).toBe(outcome.heraldText);
    expect(row.heraldText).toContain("First of the court: Ada, Bo.");
  });

  it("is idempotent: a re-run settling changes nothing", async () => {
    const store = new FakeStore();
    store.inputsByStart.set(OCT_2026.toISOString(), [input("a", { publishedTracks: 1 }, "Ada")]);
    const first = await settleCourtSeason(store, seasonSpan(1), new Date("2026-11-01T00:01:00Z"));
    const frozenRow = store.settlements.get("2026-10");
    // The world moves on — more work lands in the (now past) window.
    store.inputsByStart.set(OCT_2026.toISOString(), [
      input("a", { publishedTracks: 9 }, "Ada"),
      input("b", { publishedTracks: 5 }, "Bo"),
    ]);
    const second = await settleCourtSeason(store, seasonSpan(1), new Date("2026-11-02T00:00:00Z"));
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(store.settlements.get("2026-10")).toBe(frozenRow);
    expect((store.settlements.get("2026-10")!.standings as CourtSeasonStanding[])[0]!.points).toBe(10);
  });
});

/* ── The scheduler ──────────────────────────────────────────────── */

describe("CourtSeasonScheduler — one ceremony per season", () => {
  it("does nothing while the first season still runs", async () => {
    const store = new FakeStore();
    const { palace, announcements } = fakePalace();
    const scheduler = new CourtSeasonScheduler({ palace, store });
    await scheduler.tick(new Date("2026-10-18T12:00:00Z").getTime());
    expect(store.settlements.size).toBe(0);
    expect(announcements).toEqual([]);
  });

  it("settles the season at its turn and heralds the court exactly once", async () => {
    const store = new FakeStore();
    store.inputsByStart.set(OCT_2026.toISOString(), [input("a", { publishedTracks: 2 }, "Ada")]);
    const { palace, announcements } = fakePalace();
    const scheduler = new CourtSeasonScheduler({ palace, store });

    await scheduler.tick(new Date("2026-11-01T00:00:05Z").getTime());
    expect(store.settlements.has("2026-10")).toBe(true);
    expect(announcements.length).toBe(1);
    expect(announcements[0]!.kind).toBe("king");
    expect(announcements[0]!.roomId).toBe("world:royal-court");
    expect(announcements[0]!.roomName).toBe("Royal Court Chamber");
    expect(announcements[0]!.name).toBe("Ada");
    expect(announcements[0]!.text).toContain("Season I, of the First Bells, is settled");

    // Every later tick: the row stands, the herald does not repeat.
    await scheduler.tick(new Date("2026-11-01T00:01:00Z").getTime());
    await scheduler.tick(new Date("2026-11-15T00:00:00Z").getTime());
    expect(announcements.length).toBe(1);
  });

  it("a scheduler that loses the settling race stays silent", async () => {
    const store = new FakeStore();
    store.loseRace = true;
    store.inputsByStart.set(OCT_2026.toISOString(), [input("a", { publishedTracks: 2 }, "Ada")]);
    const { palace, announcements } = fakePalace();
    const scheduler = new CourtSeasonScheduler({ palace, store });
    await scheduler.tick(new Date("2026-11-01T00:00:05Z").getTime());
    expect(announcements).toEqual([]);
  });

  it("an empty season records its settlement but sounds no herald", async () => {
    const store = new FakeStore();
    const { palace, announcements } = fakePalace();
    const scheduler = new CourtSeasonScheduler({ palace, store });
    await scheduler.tick(new Date("2026-11-01T00:00:05Z").getTime());
    expect(store.settlements.has("2026-10")).toBe(true);
    expect((store.settlements.get("2026-10")!.standings as CourtSeasonStanding[])).toEqual([]);
    expect(announcements).toEqual([]);
    // …and the empty row still counts as settled: no retry storm.
    await scheduler.tick(new Date("2026-11-02T00:00:00Z").getTime());
    expect(store.settlements.size).toBe(1);
  });

  it("catches up one season per tick, oldest first, after a long sleep", async () => {
    const store = new FakeStore();
    store.inputsByStart.set(OCT_2026.toISOString(), [input("a", { publishedTracks: 1 }, "Ada")]);
    const { palace, announcements } = fakePalace();
    const scheduler = new CourtSeasonScheduler({ palace, store });
    const midJan = new Date("2027-01-15T00:00:00Z").getTime();

    await scheduler.tick(midJan);
    expect([...store.settlements.keys()]).toEqual(["2026-10"]);
    await scheduler.tick(midJan);
    expect([...store.settlements.keys()]).toEqual(["2026-10", "2026-11"]);
    await scheduler.tick(midJan);
    expect([...store.settlements.keys()]).toEqual(["2026-10", "2026-11", "2026-12"]);
    await scheduler.tick(midJan);
    expect(store.settlements.size).toBe(3);
    // Only Season I had a court; the quiet seasons settled silently.
    expect(announcements.length).toBe(1);
    expect(announcements[0]!.text).toContain("Season I");
  });
});
