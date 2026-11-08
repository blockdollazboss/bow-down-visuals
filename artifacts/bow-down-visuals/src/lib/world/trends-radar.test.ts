/**
 * trends-radar — stack200 world parity lane B1, census item 1
 * pins. The Trend Radar bench is the radar's native form, and
 * the radar's whole point is honest numbers, so the pins
 * hold: the seam reads the ONE free rail the website rail
 * reads; a payload that isn't the feed parses to null (the
 * bench's error state — never a dressed-up empty list); a
 * genuine quiet day parses with three empty families; rows
 * with missing or malformed numbers are DROPPED, never
 * estimated; C-30's outside family stays a labeled snapshot
 * (no velocity is ever computed from it) and its dormancy is
 * total — no honestly-labelable videos, no family.
 *
 * TRANSLATION STATUS: the desk's palace framing
 * (worldTrendsRadar.*) is en-source; the other nine catalogs
 * carry the English VERBATIM, flagged UNREVIEWED here and in
 * the components pin — they are not translations. The family
 * labels ride the website rail's own trends.radar.* keys,
 * which carry their own translation state.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  TREND_RADAR_PATH,
  radarAllEmpty,
  trendRadarFeedOf,
} from "./trends-radar";

const apiSrc = (rel: string) =>
  readFileSync(new URL(`../../../../api-server/src/${rel}`, import.meta.url), "utf8");

const VELOCITY = { currentPlays: 120, baselineDaily: 30, velocity: 4, coldStart: false };

const FEED = {
  generatedAt: "2026-11-06T12:00:00.000Z",
  window: "last_24h_vs_prior_7d",
  sounds: [
    { mediaId: "m1", title: "Golden Hour Loop", genre: "Soul", slug: "thycheatcode", trend: VELOCITY, createLink: "/create?panel=video" },
    { mediaId: "m2", title: "", genre: null, slug: "x", trend: VELOCITY },
    { mediaId: "m3", title: "No Numbers", genre: null, slug: "x", trend: { currentPlays: "many" } },
  ],
  topics: [
    { genre: " drill ", trend: { currentPlays: 55, baselineDaily: 0, velocity: null, coldStart: true } },
    { genre: "", trend: VELOCITY },
  ],
  formats: [
    { format: "short", trend: VELOCITY },
    { format: "hologram", trend: VELOCITY },
  ],
  outsideHeat: null,
};

describe("the rail — the website's own, free and read-only", () => {
  it("reads GET /api/trend-radar, the authed feed the Trends page reads", () => {
    expect(TREND_RADAR_PATH).toBe("/api/trend-radar");
    const route = apiSrc("routes/trend-radar.ts");
    expect(route).toContain('router.get("/trend-radar", requireAuth');
    expect(route).toContain("outsideHeat");
  });
});

describe("the parse — honesty guards", () => {
  it("a well-formed feed parses; malformed rows drop, never estimate", () => {
    const feed = trendRadarFeedOf(FEED)!;
    expect(feed.sounds).toHaveLength(1);
    expect(feed.sounds[0]).toMatchObject({ mediaId: "m1", title: "Golden Hour Loop", genre: "Soul" });
    /* Stack300 item 107: rows carry the server's createLink
       through the parse (the website rail links it; this bench
       never renders it). A row without one parses with "" —
       never an invented link. */
    expect(feed.sounds[0]!.createLink).toBe("/create?panel=video");
    expect(feed.topics[0]!.createLink).toBe("");
    expect(feed.formats[0]!.createLink).toBe("");
    expect(feed.topics).toHaveLength(1);
    expect(feed.topics[0]).toMatchObject({ genre: "drill", trend: { velocity: null, coldStart: true } });
    expect(feed.formats).toHaveLength(1);
    expect(feed.formats[0]!.format).toBe("short");
    expect(feed.outsideHeat).toBeNull();
    expect(radarAllEmpty(feed)).toBe(false);
  });

  it("a payload that is not the feed parses to null — the error state, not an empty radar", () => {
    expect(trendRadarFeedOf(null)).toBeNull();
    expect(trendRadarFeedOf({ error: "Could not build the trend feed" })).toBeNull();
    expect(trendRadarFeedOf({ sounds: [] })).toBeNull();
    expect(trendRadarFeedOf("feed")).toBeNull();
  });

  it("a genuine quiet day parses with three empty families", () => {
    const feed = trendRadarFeedOf({ generatedAt: "t", sounds: [], topics: [], formats: [], outsideHeat: null })!;
    expect(radarAllEmpty(feed)).toBe(true);
  });
});

describe("the outside family — labeled snapshot, total dormancy", () => {
  const HEAT = {
    source: "YouTube — most popular music videos right now",
    region: "US",
    videos: [
      { videoId: "v1", title: "Chart Topper", channelTitle: "Some Channel", viewCount: 1234567, thumbnailUrl: null, url: "https://www.youtube.com/watch?v=v1", source: "YouTube — most popular music videos right now" },
      { videoId: "v2", title: "No Count", channelTitle: "X", viewCount: "lots", thumbnailUrl: null, url: "u", source: "s" },
      { videoId: "", title: "No Id", channelTitle: "X", viewCount: 10, thumbnailUrl: null, url: "u", source: "s" },
    ],
  };

  it("keeps only honestly-labelable rows and computes no velocity from them", () => {
    const feed = trendRadarFeedOf({ ...FEED, outsideHeat: HEAT })!;
    expect(feed.outsideHeat).not.toBeNull();
    expect(feed.outsideHeat!.videos).toHaveLength(1);
    expect(feed.outsideHeat!.videos[0]).toMatchObject({ videoId: "v1", viewCount: 1234567 });
    expect(feed.outsideHeat!.videos[0]).not.toHaveProperty("trend");
    expect(feed.outsideHeat!.source).toContain("YouTube");
  });

  it("an outside family with no labelable videos is dormant — null, section absent", () => {
    const feed = trendRadarFeedOf({ ...FEED, outsideHeat: { source: "s", region: "US", videos: [{ videoId: "", title: "" }] } })!;
    expect(feed.outsideHeat).toBeNull();
    const empty = trendRadarFeedOf({ ...FEED, outsideHeat: { source: "s", region: "US", videos: [] } })!;
    expect(empty.outsideHeat).toBeNull();
  });
});

describe("the copy — the rail's own labels, verbatim in every catalog", () => {
  it("the reused trends.radar keys carry YouTube's name on the family and every row", () => {
    const readJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as Record<string, any>;
    const en = readJson("../../locales/en.json");
    expect(en.trends.radar.outsideBadge).toBe("YouTube");
    expect(en.trends.radar.outsideViews).toContain("views on YouTube");
    expect(en.trends.radar.outsideNote).toContain("never mixes with the counted Bow Down plays");
    expect(en.worldTrendsRadar.title).toBe("Trend Radar");
    /* UNREVIEWED: the palace framing rides English verbatim in
       the other nine catalogs until a reviewer translates it. */
    for (const loc of ["ar", "de", "es", "fr", "hi", "it", "ja", "ko", "pt"]) {
      const cat = readJson(`../../locales/${loc}.json`);
      expect(cat.worldTrendsRadar, loc).toEqual(en.worldTrendsRadar);
    }
  });
});
