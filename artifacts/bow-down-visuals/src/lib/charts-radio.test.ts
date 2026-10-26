/**
 * charts-radio.test.ts — Stack-200 #156 FE pins: payload normalize
 * (unplayable rows dropped, order by position), the wrap-around
 * next-spin math, honest badges, the resume hint, and the smart-law
 * pin — the station never starts on load.
 */
import { describe, expect, it } from "vitest";
import {
  RADIO_STARTS_ON_LOAD,
  nextRadioIndex,
  normalizeRadioPayload,
  radioEntryBadge,
  radioResumeHint,
  type RadioEntry,
} from "./charts-radio";

const rawEntry = (over: Record<string, unknown> = {}) => ({
  position: 1,
  track_id: "t1",
  title: "Song One",
  artist_name: "Thy Cheat Code",
  artist_slug: "thy-cheat-code",
  artwork_url: null,
  audio_url: "https://cdn.example/t1.mp3",
  duration_sec: 200,
  genre: "hip-hop",
  source: "chart",
  chart_rank: 1,
  plays: 42,
  ...over,
});

describe("normalizeRadioPayload", () => {
  it("normalizes the station payload and sorts by position", () => {
    const p = normalizeRadioPayload({
      station: { name: "Charts Radio", tagline: "tag", on_air: true },
      rotation: [rawEntry({ position: 2, track_id: "t2" }), rawEntry({ position: 1 })],
    });
    expect(p.onAir).toBe(true);
    expect(p.rotation.map((e) => e.trackId)).toEqual(["t1", "t2"]);
    expect(p.rotation[0]?.chartRank).toBe(1);
  });

  it("drops rows that cannot honestly play", () => {
    const p = normalizeRadioPayload({
      station: { on_air: true },
      rotation: [rawEntry({ audio_url: null }), rawEntry({ track_id: "" }), rawEntry()],
    });
    expect(p.rotation).toHaveLength(1);
  });

  it("an empty/garbage payload reads as off air, never invented content", () => {
    expect(normalizeRadioPayload(null).onAir).toBe(false);
    expect(normalizeRadioPayload({}).rotation).toEqual([]);
    const p = normalizeRadioPayload({ station: { on_air: true }, rotation: [] });
    expect(p.onAir).toBe(false);
  });
});

describe("nextRadioIndex", () => {
  const rot = [{}, {}, {}] as RadioEntry[];
  it("advances and wraps — a station doesn't end", () => {
    expect(nextRadioIndex(rot, 0)).toBe(1);
    expect(nextRadioIndex(rot, 2)).toBe(0);
    expect(nextRadioIndex(rot, -1)).toBe(0);
  });
  it("empty rotation has no next", () => {
    expect(nextRadioIndex([], 0)).toBe(-1);
  });
});

describe("badges + hint + the smart-law pin", () => {
  it("badge states the real rank or the fresh drop — nothing else", () => {
    const chart = normalizeRadioPayload({ rotation: [rawEntry()] }).rotation[0]!;
    expect(radioEntryBadge(chart)).toBe("#1 this week");
    const drop = normalizeRadioPayload({
      rotation: [rawEntry({ source: "new-drop", chart_rank: null })],
    }).rotation[0]!;
    expect(radioEntryBadge(drop)).toBe("New drop");
  });
  it("resume hint only for a member who tuned in before", () => {
    expect(radioResumeHint(true)).toContain("press play");
    expect(radioResumeHint(false)).toBeNull();
  });
  it("the station never starts on load", () => {
    expect(RADIO_STARTS_ON_LOAD).toBe(false);
  });
});
