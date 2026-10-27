/**
 * trend-radar.test.ts — UPGRADE #178 (Trend Radar, on Trends).
 *
 * Pins the honest-data rule the audit made absolute:
 * - a trend needs real mass (≥25 plays in 24h) AND real lift (≥2.5×
 *   its own baseline pace) — big-but-flat and tiny-but-spiky both fail;
 * - a cold start qualifies only at ≥50 plays in 24h;
 * - ranking is velocity first, then mass; cold starts rank as the
 *   hottest lift;
 * - NOTHING is padded: rows that don't qualify produce an empty
 *   family, never a filled one;
 * - one-tap links attach the actual sound / scaffold the actual
 *   genre or format — built only from the row's own data.
 */
import { describe, expect, it } from "vitest";
import {
  evaluateTrend,
  formatCreateLink,
  rankFormatTrends,
  rankSoundTrends,
  rankTopicTrends,
  soundCreateLink,
  topicCreateLink,
  type FormatWindowRow,
  type SoundWindowRow,
  type TopicWindowRow,
} from "../trend-radar";

describe("evaluateTrend — mass AND lift, or nothing", () => {
  it("qualifies at 25 plays and exactly 2.5x pace", () => {
    // 70 baseline plays = 10/day; 25 today = 2.5x.
    expect(evaluateTrend(25, 70)).toMatchObject({ velocity: 2.5, coldStart: false });
  });

  it("rejects big-but-flat: 1,000 plays at its usual pace is not a trend", () => {
    expect(evaluateTrend(1000, 7000)).toBeNull(); // 1000/day baseline, 1000 today
  });

  it("rejects spiky-but-tiny: 10x lift on 12 plays is under the mass floor", () => {
    expect(evaluateTrend(12, 8)).toBeNull();
  });

  it("cold start needs 50: 49 fails, 50 qualifies with null velocity", () => {
    expect(evaluateTrend(49, 0)).toBeNull();
    expect(evaluateTrend(50, 0)).toMatchObject({ coldStart: true, velocity: null, baselineDaily: 0 });
  });
});

const sound = (over: Partial<SoundWindowRow>): SoundWindowRow => ({
  mediaId: "trk-1",
  title: "Riser",
  genre: "Drill",
  slug: "steady-creator",
  currentPlays: 100,
  baselinePlays: 70, // 10/day → 10x
  ...over,
});

describe("rankSoundTrends — rising sounds only", () => {
  it("keeps qualifiers, drops the flat and the tiny, hottest lift first", () => {
    const rows = [
      sound({ mediaId: "flat", currentPlays: 900, baselinePlays: 6300 }),
      sound({ mediaId: "tiny", currentPlays: 20, baselinePlays: 7 }),
      sound({ mediaId: "warm", currentPlays: 100, baselinePlays: 70 }),
      sound({ mediaId: "cold", currentPlays: 60, baselinePlays: 0 }),
      sound({ mediaId: "hot", currentPlays: 300, baselinePlays: 70 }),
    ];
    const out = rankSoundTrends(rows);
    expect(out.map((r) => r.mediaId)).toEqual(["cold", "hot", "warm"]);
    expect(out[1]!.createLink).toBe("/create?panel=video&sound=track:hot&intent=trend");
  });

  it("an all-quiet catalog answers EMPTY — the feed is never padded", () => {
    expect(rankSoundTrends([sound({ currentPlays: 5, baselinePlays: 700 })])).toEqual([]);
    expect(rankSoundTrends([])).toEqual([]);
  });

  it("soundCreateLink attaches the track itself", () => {
    expect(soundCreateLink("abc")).toBe("/create?panel=video&sound=track:abc&intent=trend");
  });
});

describe("rankTopicTrends — genres on real combined plays", () => {
  const topic = (over: Partial<TopicWindowRow>): TopicWindowRow => ({
    genre: "Drill",
    currentPlays: 400,
    baselinePlays: 700, // 100/day → 4x
    ...over,
  });

  it("qualifies, skips blank genres, and scaffolds the genre into Create", () => {
    const out = rankTopicTrends([
      topic({ genre: "Drill" }),
      topic({ genre: "  ", currentPlays: 5000, baselinePlays: 0 }),
      topic({ genre: "Ambient", currentPlays: 30, baselinePlays: 700 }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.genre).toBe("Drill");
    expect(out[0]!.createLink).toContain("/create?panel=song&concept=");
    expect(decodeURIComponent(out[0]!.createLink)).toContain("Drill");
    expect(decodeURIComponent(out[0]!.createLink)).toContain("4.0x");
  });

  it("topicCreateLink states the real pace for a cold start", () => {
    const link = topicCreateLink("Gospel", { currentPlays: 80, baselineDaily: 0, velocity: null, coldStart: true });
    expect(decodeURIComponent(link)).toContain("80 plays in its first 24 hours");
  });
});

describe("rankFormatTrends — formats from real video classes", () => {
  const fmt = (over: Partial<FormatWindowRow>): FormatWindowRow => ({
    format: "short",
    currentPlays: 500,
    baselinePlays: 700, // 100/day → 5x
    ...over,
  });

  it("qualifies rising formats and scaffolds the format into Create", () => {
    const out = rankFormatTrends([
      fmt({ format: "short" }),
      fmt({ format: "full", currentPlays: 800, baselinePlays: 5600 }), // flat
      fmt({ format: "duet", currentPlays: 90, baselinePlays: 0 }), // cold start
    ]);
    expect(out.map((r) => r.format)).toEqual(["duet", "short"]);
    expect(decodeURIComponent(out[1]!.createLink)).toContain("Shorts");
  });

  it("formatCreateLink names the format and the real numbers", () => {
    const link = formatCreateLink("stitch", { currentPlays: 120, baselineDaily: 10, velocity: 12, coldStart: false });
    const decoded = decodeURIComponent(link);
    expect(decoded).toContain("Stitches");
    expect(decoded).toContain("120 plays in 24 hours, 12.0x");
    expect(link.startsWith("/create?panel=video&concept=")).toBe(true);
  });
});
