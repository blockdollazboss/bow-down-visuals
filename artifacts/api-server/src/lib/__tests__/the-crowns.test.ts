/**
 * The Crowns (lib/the-crowns, N8) — the yearly house awards.
 *
 * Pinned contract:
 * - The categories are PUBLISHED and fixed: the list GET
 *   /api/crowns serves is the list the deciding runs, and every
 *   metric is one of the earned-rank ladder's real sources (or
 *   the ladder's own points) — real platform records decide,
 *   never votes or estimates.
 * - The year is a UTC calendar year; the first decidable year is
 *   2026. Ranking per category is total and deterministic —
 *   metric, ladder points, business results, published works,
 *   user id — so a tie freezes the same way every time.
 * - A category nobody scored in crowns nobody (winner null).
 * - The deciding is idempotent by the year's primary key: a
 *   re-run changes nothing, a twin tick that loses the insert
 *   race stays silent, and the herald fires exactly once — for
 *   the tick that decided, and only when a crown landed.
 * - A crown is worn for the year after the win: activeCrowns is
 *   a pure read over the frozen awards, expiring at Jan 1 of
 *   year+2.
 */
import { describe, it, expect } from "vitest";
import {
  CrownsScheduler,
  activeCrowns,
  crownCategory,
  crownYearForDate,
  crownYearSpan,
  crownsHeraldText,
  currentCrownLeaders,
  decideCrownYear,
  rankCrownCategory,
  CROWN_CATEGORIES,
  type CrownsStore,
} from "../the-crowns";
import { EMPTY_RANK_COUNTS, type RankCounts } from "../creator-rank";
import type { SeasonStandingInput } from "../world-court-season";
import type {
  CrownAward,
  HouseCrownYear as CrownYearRow,
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

class FakeStore implements CrownsStore {
  years = new Map<number, CrownYearRow>();
  inputs: SeasonStandingInput[] = [];
  ranks = new Map<string, { stars: number; title: string }>();
  loseRace = false;

  async getYear(year: number) {
    return this.years.get(year) ?? null;
  }
  async listYears() {
    return [...this.years.values()].sort((a, b) => b.year - a.year);
  }
  async markDecided(row: Parameters<CrownsStore["markDecided"]>[0]) {
    if (this.loseRace || this.years.has(row.year)) return false;
    this.years.set(row.year, {
      year: row.year,
      crownKey: row.crownKey,
      name: row.name,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      decidedAt: row.decidedAt,
      awards: row.awards,
      heraldText: row.heraldText,
    } as CrownYearRow);
    return true;
  }
  async yearStandings() {
    return this.inputs;
  }
  async lifetimeRank(userId: string) {
    return this.ranks.get(userId) ?? { stars: 2, title: "Hustler" };
  }
}

function announceSpy() {
  const calls: PalaceAnnouncement[] = [];
  return { calls, palace: { announce: (a: PalaceAnnouncement) => calls.push(a) } };
}

/* ── The year ───────────────────────────────────────────────────── */

describe("crownYearSpan / crownYearForDate", () => {
  it("spans the UTC calendar year and expires crowns at Jan 1 of year+2", () => {
    const info = crownYearSpan(2026);
    expect(info.crownKey).toBe("crowns-2026");
    expect(info.name).toBe("The Crowns of 2026");
    expect(info.startsAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(info.endsAt.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(info.crownsExpireAt.toISOString()).toBe("2028-01-01T00:00:00.000Z");
  });

  it("maps a moment to its own calendar year", () => {
    expect(crownYearForDate(new Date("2027-06-15T12:00:00Z")).year).toBe(2027);
    expect(crownYearForDate(new Date("2026-12-31T23:59:59Z")).year).toBe(2026);
  });
});

/* ── The published categories ───────────────────────────────────── */

describe("CROWN_CATEGORIES", () => {
  it("publishes the headline crown first and keeps keys unique", () => {
    expect(CROWN_CATEGORIES[0]!.key).toBe("creator-of-the-year");
    const keys = CROWN_CATEGORIES.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const c of CROWN_CATEGORIES) {
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.blurb.length).toBeGreaterThan(0);
      expect(crownCategory(c.key)).toBe(c);
    }
    expect(crownCategory("not-a-category")).toBeNull();
  });

  it("reads every metric from the ladder's real counts", () => {
    const full = counts({
      publishedTracks: 3,
      publishedVideos: 2,
      sales: 7,
      membershipsSold: 4,
      streamsHosted: 5,
      tipsReceived: 6,
      followers: 9,
    });
    const byKey = new Map(CROWN_CATEGORIES.map((c) => [c.key, c.metric(full)]));
    expect(byKey.get("top-seller")).toBe(7);
    expect(byKey.get("membership-magnet")).toBe(4);
    expect(byKey.get("most-prolific")).toBe(5);
    expect(byKey.get("top-streamer")).toBe(5);
    expect(byKey.get("most-tipped")).toBe(6);
    expect(byKey.get("audience-magnet")).toBe(9);
    expect(byKey.get("creator-of-the-year")).toBeGreaterThan(0);
  });
});

/* ── Ranking ────────────────────────────────────────────────────── */

describe("rankCrownCategory", () => {
  const seller = crownCategory("top-seller")!;

  it("ranks by the category metric and drops zero scorers", () => {
    const ranked = rankCrownCategory(
      [input("a", { sales: 2 }), input("b", { sales: 9 }), input("c", {})],
      seller,
    );
    expect(ranked.map((r) => r.userId)).toEqual(["b", "a"]);
  });

  it("breaks metric ties by ladder points, then user id — total and deterministic", () => {
    const ranked = rankCrownCategory(
      [
        input("z", { sales: 5 }),
        input("y", { sales: 5, publishedTracks: 10 }),
        input("x", { sales: 5, publishedTracks: 10 }),
      ],
      seller,
    );
    // y and x both out-point z on tracks; x wins the id tie-break.
    expect(ranked.map((r) => r.userId)).toEqual(["x", "y", "z"]);
  });
});

/* ── The deciding ───────────────────────────────────────────────── */

describe("decideCrownYear", () => {
  it("crowns each category's top scorer with their frozen rank and standings", async () => {
    const store = new FakeStore();
    store.inputs = [
      input("seller", { sales: 12, membershipsSold: 1 }, "Sella"),
      input("member", { membershipsSold: 8, sales: 2 }, "Memb"),
      input("quiet", {}, "Quiet"),
    ];
    store.ranks.set("seller", { stars: 4, title: "Shot Caller" });
    const outcome = await decideCrownYear(store, crownYearSpan(2026), new Date("2027-01-01T00:01:00Z"));
    expect(outcome.inserted).toBe(true);
    const byKey = new Map(outcome.awards.map((a) => [a.category, a]));
    expect(byKey.get("top-seller")!.winnerUserId).toBe("seller");
    expect(byKey.get("top-seller")!.metricValue).toBe(12);
    expect(byKey.get("top-seller")!.stars).toBe(4);
    expect(byKey.get("top-seller")!.title).toBe("Shot Caller");
    expect(byKey.get("top-seller")!.expiresAt).toBe("2028-01-01T00:00:00.000Z");
    expect(byKey.get("membership-magnet")!.winnerUserId).toBe("member");
    // Zero scorers never win and never stand.
    expect(byKey.get("top-streamer")!.winnerUserId).toBeNull();
    expect(JSON.stringify(outcome.awards)).not.toContain("quiet");
    expect(store.years.get(2026)!.awards).toEqual(outcome.awards);
  });

  it("is idempotent: a second deciding inserts nothing", async () => {
    const store = new FakeStore();
    store.inputs = [input("a", { sales: 1 })];
    const info = crownYearSpan(2026);
    const first = await decideCrownYear(store, info, new Date("2027-01-01T00:01:00Z"));
    const second = await decideCrownYear(store, info, new Date("2027-01-01T00:02:00Z"));
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(store.years.size).toBe(1);
  });

  it("degrades a failed lifetime-rank read to ★1 instead of failing the deciding", async () => {
    const store = new FakeStore();
    store.inputs = [input("a", { sales: 3 })];
    store.lifetimeRank = async () => {
      throw new Error("rank read down");
    };
    const outcome = await decideCrownYear(store, crownYearSpan(2026));
    expect(outcome.inserted).toBe(true);
    expect(outcome.awards.find((a) => a.category === "top-seller")!.stars).toBe(1);
  });
});

/* ── The herald ─────────────────────────────────────────────────── */

describe("crownsHeraldText", () => {
  it("names each crowned winner with their category", () => {
    const award: CrownAward = {
      category: "top-seller",
      categoryTitle: "Top Seller",
      metricLabel: "sales",
      metricValue: 12,
      winnerUserId: "seller",
      displayName: "Sella",
      slug: "sella",
      stars: 4,
      title: "Shot Caller",
      expiresAt: "2028-01-01T00:00:00.000Z",
      standings: [],
    };
    const text = crownsHeraldText(crownYearSpan(2026), [award]);
    expect(text).toContain("The Crowns of 2026");
    expect(text).toContain("Top Seller: Sella.");
  });
});

/* ── Wearing ────────────────────────────────────────────────────── */

describe("activeCrowns", () => {
  it("reads crowns off the frozen awards until the expiry instant", async () => {
    const store = new FakeStore();
    store.inputs = [input("a", { sales: 3, streamsHosted: 2 })];
    await decideCrownYear(store, crownYearSpan(2026), new Date("2027-01-01T00:01:00Z"));
    const years = await store.listYears();
    const worn = activeCrowns(years, "a", new Date("2027-06-01T00:00:00Z"));
    expect(worn.map((a) => a.category)).toContain("top-seller");
    expect(worn.map((a) => a.category)).toContain("top-streamer");
    expect(activeCrowns(years, "a", new Date("2028-01-01T00:00:00Z"))).toEqual([]);
    expect(activeCrowns(years, "someone-else", new Date("2027-06-01T00:00:00Z"))).toEqual([]);
  });
});

/* ── Live leaders ───────────────────────────────────────────────── */

describe("currentCrownLeaders", () => {
  it("serves every published category with its live leaders", async () => {
    const store = new FakeStore();
    store.inputs = [input("a", { sales: 4 }), input("b", { sales: 1 })];
    const leaders = await currentCrownLeaders(store, crownYearSpan(2027));
    expect(leaders.map((l) => l.key)).toEqual(CROWN_CATEGORIES.map((c) => c.key));
    expect(leaders.find((l) => l.key === "top-seller")!.leaders[0]!.userId).toBe("a");
    expect(leaders.find((l) => l.key === "top-streamer")!.leaders).toEqual([]);
  });
});

/* ── The scheduler ──────────────────────────────────────────────── */

describe("CrownsScheduler", () => {
  it("does nothing before the first year has ended", async () => {
    const store = new FakeStore();
    const spy = announceSpy();
    const scheduler = new CrownsScheduler({ palace: spy.palace, store });
    await scheduler.tick(new Date("2026-06-01T00:00:00Z").getTime());
    expect(store.years.size).toBe(0);
    expect(spy.calls).toEqual([]);
  });

  it("decides the ended year once and heralds exactly once", async () => {
    const store = new FakeStore();
    store.inputs = [input("a", { sales: 3 })];
    const spy = announceSpy();
    const scheduler = new CrownsScheduler({ palace: spy.palace, store });
    const tickAt = new Date("2027-01-02T00:00:00Z").getTime();
    await scheduler.tick(tickAt);
    await scheduler.tick(tickAt);
    expect(store.years.size).toBe(1);
    expect(spy.calls.length).toBe(1);
    expect(spy.calls[0]!.text).toContain("The Crowns of 2026");
    expect(spy.calls[0]!.roomId).toBe("world:royal-court");
  });

  it("records a winner-less year silently", async () => {
    const store = new FakeStore();
    const spy = announceSpy();
    const scheduler = new CrownsScheduler({ palace: spy.palace, store });
    await scheduler.tick(new Date("2027-01-02T00:00:00Z").getTime());
    expect(store.years.size).toBe(1);
    expect(spy.calls).toEqual([]);
  });

  it("catches up one year per tick, oldest first", async () => {
    const store = new FakeStore();
    store.inputs = [input("a", { sales: 3 })];
    const spy = announceSpy();
    const scheduler = new CrownsScheduler({ palace: spy.palace, store });
    const tickAt = new Date("2028-03-01T00:00:00Z").getTime();
    await scheduler.tick(tickAt);
    expect([...store.years.keys()]).toEqual([2026]);
    await scheduler.tick(tickAt);
    expect([...store.years.keys()].sort()).toEqual([2026, 2027]);
  });
});
