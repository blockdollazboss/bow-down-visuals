/**
 * The Crowns client seam (lib/the-crowns) — the awards' read of
 * GET /api/crowns. Pinned: the parser is defensive (a malformed
 * payload degrades, never invents a crown), decided years sort
 * newest-first whatever the wire order, and a winner-less
 * category stays in the record but wears no crown.
 */
import { describe, it, expect } from "vitest";
import {
  parseCrownsRead,
  crownedAwards,
  crownMetricLabel,
  crownsPath,
  type CrownAward,
} from "./the-crowns";

const award = (partial: Partial<CrownAward> = {}): Record<string, unknown> => ({
  category: "top-seller",
  categoryTitle: "Top Seller",
  metricLabel: "sales",
  metricValue: 12,
  winnerUserId: "u-ada",
  displayName: "Ada",
  slug: "ada",
  stars: 4,
  title: "Shot Caller",
  expiresAt: "2028-01-01T00:00:00.000Z",
  standings: [
    { place: 1, userId: "u-ada", displayName: "Ada", slug: "ada", metric: 12, points: 300 },
  ],
  ...partial,
});

const payload = {
  categories: [
    { key: "creator-of-the-year", title: "Creator of the Year", blurb: "The highest score.", metricLabel: "rank points" },
    { key: "top-seller", title: "Top Seller", blurb: "The most sales.", metricLabel: "sales" },
  ],
  current: {
    year: 2027,
    crownKey: "crowns-2027",
    name: "The Crowns of 2027",
    startsAt: "2027-01-01T00:00:00.000Z",
    endsAt: "2028-01-01T00:00:00.000Z",
    leaders: [
      {
        key: "creator-of-the-year", title: "Creator of the Year", blurb: "The highest score.", metricLabel: "rank points",
        leaders: [{ userId: "u-bo", displayName: "Bo", slug: "bo", metric: 900, points: 900 }],
      },
    ],
  },
  years: [
    {
      year: 2026, crownKey: "crowns-2026", name: "The Crowns of 2026",
      startsAt: "2026-01-01T00:00:00.000Z", endsAt: "2027-01-01T00:00:00.000Z",
      decidedAt: "2027-01-01T00:01:00.000Z",
      awards: [award(), award({ category: "top-streamer", categoryTitle: "Top Streamer", metricLabel: "streams hosted", metricValue: 0, winnerUserId: null, displayName: "", slug: "", standings: [] })],
      heraldText: "The Crowns of 2026 are decided.",
    },
  ],
};

describe("parseCrownsRead", () => {
  it("parses the read: categories, the year in progress with its leaders, the frozen record", () => {
    const read = parseCrownsRead(payload)!;
    expect(read.categories.map((c) => c.key)).toEqual(["creator-of-the-year", "top-seller"]);
    expect(read.current.year).toBe(2027);
    expect(read.current.leaders[0]!.leaders[0]!.displayName).toBe("Bo");
    expect(read.years).toHaveLength(1);
    expect(read.years[0]!.awards[0]).toMatchObject({ category: "top-seller", metricValue: 12, winnerUserId: "u-ada" });
  });

  it("sorts decided years newest-first whatever the wire order", () => {
    const y2025 = { ...payload.years[0]!, year: 2025, crownKey: "crowns-2025", name: "The Crowns of 2025" };
    const read = parseCrownsRead({ ...payload, years: [y2025, payload.years[0]] })!;
    expect(read.years.map((y) => y.year)).toEqual([2026, 2025]);
  });

  it("degrades instead of inventing: junk payloads and junk rows fall away", () => {
    expect(parseCrownsRead(null)).toBeNull();
    expect(parseCrownsRead("nope")).toBeNull();
    expect(parseCrownsRead({})).toBeNull();
    expect(parseCrownsRead({ current: null })).toBeNull();
    const read = parseCrownsRead({
      ...payload,
      categories: [{ key: "x" }, { key: "ok", title: "OK" }],
      years: [{ year: "junk" }, payload.years[0]],
    })!;
    expect(read.categories.map((c) => c.key)).toEqual(["ok"]);
    expect(read.years).toHaveLength(1);
  });
});

describe("display helpers", () => {
  it("crownedAwards keeps only the categories a winner actually took", () => {
    const read = parseCrownsRead(payload)!;
    const crowned = crownedAwards(read.years[0]!);
    expect(crowned.map((a) => a.category)).toEqual(["top-seller"]);
  });

  it("the metric label joins the deciding number with its published unit", () => {
    const read = parseCrownsRead(payload)!;
    expect(crownMetricLabel(read.years[0]!.awards[0]!)).toBe("12 sales");
  });

  it("the endpoint path is the awards' one read", () => {
    expect(crownsPath()).toBe("/api/crowns");
  });
});
