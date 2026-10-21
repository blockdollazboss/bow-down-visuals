/**
 * charts-brands — the /charts For Brands tab's shaping seam.
 *
 * Pins:
 * - the scouting stats line renders ONLY the fields the /brands DTO
 *   actually sent (top genre, published track/video counts) — a
 *   missing field is omitted, never zero-filled; a real 0 renders;
 * - the outreach doors are the existing member-locked rails and
 *   nothing else (no invented hrefs, no new system);
 * - the page source: the tab types its rows with the seam, renders
 *   the stats strip, docks the doors + the two shared takeover
 *   inquiry modals, and carries the briefs board's no-money note.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { brandScoutStats, BRAND_OUTREACH_DOORS, type BrandCreatorLite } from "./charts-brands";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const chartsPageSrc = read("../pages/discovery/charts.tsx");

const base: BrandCreatorLite = {
  id: "c1",
  slug: "ada-gold",
  display_name: "Ada Gold",
  avatar_url: null,
  vertical: "music",
  follower_count: 1200,
  total_plays: 34000,
};

describe("brandScoutStats", () => {
  it("shapes genre + both counts in reading order", () => {
    expect(brandScoutStats({ ...base, top_genre: "Hip-Hop", track_count: 14, video_count: 3 })).toEqual([
      "Hip-Hop",
      "14 tracks",
      "3 videos",
    ]);
  });

  it("a real zero the server sent renders — no published work yet is scouting information", () => {
    expect(brandScoutStats({ ...base, top_genre: null, track_count: 0, video_count: 0 })).toEqual([
      "0 tracks",
      "0 videos",
    ]);
  });

  it("missing fields are omitted, never zero-filled or guessed", () => {
    expect(brandScoutStats(base)).toEqual([]);
    expect(brandScoutStats({ ...base, top_genre: "  ", track_count: undefined })).toEqual([]);
  });

  it("singular counts read singular", () => {
    expect(brandScoutStats({ ...base, track_count: 1, video_count: 1 })).toEqual(["1 track", "1 video"]);
  });
});

describe("the outreach doors", () => {
  it("are exactly the two existing link rails — Brand Deals hub and the Promote briefs board", () => {
    expect(BRAND_OUTREACH_DOORS.map((d) => d.href)).toEqual(["/brand-deals", "/promote"]);
  });
});

describe("the /charts For Brands tab (source pins)", () => {
  it("rides the one brands read and types its rows with the seam", () => {
    expect(chartsPageSrc).toContain("/api/discovery/brands?limit=12");
    expect(chartsPageSrc).toContain("BrandCreatorLite");
    expect(chartsPageSrc).toContain("brandScoutStats");
    expect(chartsPageSrc).toContain('data-testid="brand-scout-stats"');
  });

  it("docks the outreach doors from the seam — no invented hrefs", () => {
    expect(chartsPageSrc).toContain("BRAND_OUTREACH_DOORS");
    expect(chartsPageSrc).toContain('data-testid="brand-outreach-panel"');
  });

  it("the takeover doors open the shared inquiry modals on the tab itself", () => {
    expect(chartsPageSrc).toContain("SpotlightModal");
    expect(chartsPageSrc).toContain("LoadingScreenModal");
    expect(chartsPageSrc).toContain('data-testid="brand-takeover-spotlight"');
    expect(chartsPageSrc).toContain('data-testid="brand-takeover-loading"');
  });

  it("carries the briefs board's no-money note, imported from the one seam", () => {
    expect(chartsPageSrc).toContain("UGC_PAYMENT_NOTE");
    expect(chartsPageSrc).toContain('from "@/lib/ugc-ads"');
  });
});
