/**
 * scenes-desk — stack1500 world parity wave #3 item 16 pins.
 *
 * The Local Scenes desk is the declared-city directory's
 * native form. These pins hold: the rails are the public
 * /api/discovery/scenes pair the website itself rides (via
 * lib/scenes' fetchers — one counting method, never two); THE
 * DIRECTORY RULE holds in the seam (a city row with fewer
 * than one declared creator drops); the detail shaper reads
 * the rail's exact rows (creators, shows with the shared
 * date formatter, chart tracks/videos with plays+likes) and
 * drops rows missing their name/title; a null page (the
 * rail's 404) stays null — the no-scene state.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  SCENES_PATH,
  SCENE_WINDOWS,
  cityRowOf,
  sceneDetailOf,
  type ScenePage,
} from "./scenes-desk";
import type { SceneCityEntry } from "@/lib/scenes";

const CITY: SceneCityEntry = { slug: "atlanta-ga", name: "Atlanta, GA", creator_count: 4, show_count: 2 };

const PAGE: ScenePage = {
  city: { slug: "atlanta-ga", name: "Atlanta, GA" },
  creators: [
    {
      id: "p1",
      profile_id: "p1",
      slug: "king",
      display_name: "Thy Cheat Code",
      avatar_url: null,
      vertical: "Rapper",
      follower_count: 1200,
      total_plays: 34000,
      declared_city: "Atlanta, GA",
    },
  ],
  shows: [
    {
      id: "s1",
      city: "Atlanta, GA",
      venue: "The Palace",
      show_date: "2026-12-01T20:00:00.000Z",
      status: "confirmed",
      profile_id: "p1",
      slug: "king",
      display_name: "Thy Cheat Code",
      avatar_url: null,
    },
  ],
  chart: {
    window: "all",
    tracks: [{ id: "t1", profile_id: "p1", title: "Crown Heavy", genre: "Trap", artwork_url: null, play_count: 900, like_count: 40, duration_sec: 180 }],
    videos: [{ id: "v1", profile_id: "p1", title: "Crown Heavy (Video)", genre: null, thumbnail_url: null, view_count: 5000, like_count: 300, duration_sec: 200 }],
  },
  counts: { creators: 1, shows: 1, tracks: 1, videos: 1 },
};

describe("the rails — the website's own public pair", () => {
  it("the directory path is /api/discovery/scenes and lib/scenes rides it", () => {
    expect(SCENES_PATH).toBe("/api/discovery/scenes");
    const lib = readFileSync(new URL("../scenes.ts", import.meta.url), "utf8");
    expect(lib).toContain('getJson<{ cities: SceneCityEntry[] }>("/api/discovery/scenes")');
    expect(lib).toContain("/api/discovery/scenes/${encodeURIComponent(slug)}?window=${window}");
    expect(SCENE_WINDOWS.map((w) => w.key)).toEqual(["today", "week", "all"]);
  });
});

describe("THE DIRECTORY RULE in the seam", () => {
  it("a city row needs a slug, a name and at least one declared creator", () => {
    expect(cityRowOf(CITY)).toEqual({ slug: "atlanta-ga", name: "Atlanta, GA", creatorCount: 4, showCount: 2 });
    expect(cityRowOf({ ...CITY, creator_count: 0 })).toBeNull();
    expect(cityRowOf({ ...CITY, slug: "" })).toBeNull();
    expect(cityRowOf(null)).toBeNull();
  });
});

describe("the detail shaper", () => {
  it("reads creators, shows and both chart halves with the rail's counts", () => {
    const d = sceneDetailOf(PAGE)!;
    expect(d.name).toBe("Atlanta, GA");
    expect(d.creators[0]).toMatchObject({ displayName: "Thy Cheat Code", vertical: "Rapper", followerCount: 1200, totalPlays: 34000 });
    expect(d.shows[0]!.venue).toBe("The Palace");
    expect(d.shows[0]!.dateLabel).toContain("Dec");
    expect(d.tracks[0]).toMatchObject({ title: "Crown Heavy", plays: 900, likes: 40 });
    expect(d.videos[0]).toMatchObject({ title: "Crown Heavy (Video)", plays: 5000, likes: 300 });
    expect(d.counts).toEqual({ creators: 1, shows: 1, tracks: 1, videos: 1 });
  });

  it("a null page stays null; rows missing their name/title drop", () => {
    expect(sceneDetailOf(null)).toBeNull();
    const broken = {
      ...PAGE,
      creators: [{ ...PAGE.creators[0]!, display_name: "" }],
      chart: { ...PAGE.chart, tracks: [{ ...PAGE.chart.tracks[0]!, title: "" }] },
    } as unknown as ScenePage;
    const d = sceneDetailOf(broken)!;
    expect(d.creators).toHaveLength(0);
    expect(d.tracks).toHaveLength(0);
    expect(d.videos).toHaveLength(1);
  });
});
