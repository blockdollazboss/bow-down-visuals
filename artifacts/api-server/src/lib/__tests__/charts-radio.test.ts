/**
 * charts-radio.test.ts — Stack-200 #156: the house station's rotation
 * builder + tuned-in prefs.
 *
 * Pins: the rotation interleaves the REAL week chart with the newest
 * drops (chart rank preserved, dedupe with rank winning), unplayable
 * rows (no audio URL) never enter, nothing is invented (plays pass
 * through from the rows), the autoplay pin stays false, and the prefs
 * contract mirrors sound_prefs (no row = default, accounts isolated).
 */
import { describe, expect, it } from "vitest";
import {
  RADIO_AUTOPLAY_WITH_SOUND,
  buildRadioRotation,
  getChartsRadioPrefs,
  setChartsRadioPrefs,
  type ChartsRadioPrefsStore,
  type ChartsRadioPrefsWire,
  type RadioTrackRow,
} from "../charts-radio";

function row(partial: Partial<RadioTrackRow> & { id: string }): RadioTrackRow {
  return {
    title: `Track ${partial.id}`,
    audio_url: `https://cdn.example/${partial.id}.mp3`,
    artwork_url: null,
    duration_sec: 180,
    genre: "hip-hop",
    play_count: 10,
    display_name: "Thy Cheat Code",
    slug: "thy-cheat-code",
    ...partial,
  };
}

describe("buildRadioRotation", () => {
  it("interleaves chart and new drops, chart first, positions sequential", () => {
    const rot = buildRadioRotation(
      [row({ id: "c1" }), row({ id: "c2" })],
      [row({ id: "n1" }), row({ id: "n2" })],
    );
    expect(rot.map((e) => e.track_id)).toEqual(["c1", "n1", "c2", "n2"]);
    expect(rot.map((e) => e.position)).toEqual([1, 2, 3, 4]);
    expect(rot.map((e) => e.source)).toEqual(["chart", "new-drop", "chart", "new-drop"]);
  });

  it("chart entries carry their real 1-based rank; drops carry none", () => {
    const rot = buildRadioRotation([row({ id: "c1" }), row({ id: "c2" })], [row({ id: "n1" })]);
    expect(rot.find((e) => e.track_id === "c2")?.chart_rank).toBe(2);
    expect(rot.find((e) => e.track_id === "n1")?.chart_rank).toBeNull();
  });

  it("a track that is both charting and new appears once, as the chart entry", () => {
    const rot = buildRadioRotation([row({ id: "both" })], [row({ id: "both" }), row({ id: "n1" })]);
    expect(rot.filter((e) => e.track_id === "both")).toHaveLength(1);
    expect(rot.find((e) => e.track_id === "both")?.source).toBe("chart");
  });

  it("rows without an audio URL never enter the rotation", () => {
    const rot = buildRadioRotation(
      [row({ id: "silent", audio_url: null }), row({ id: "c1" })],
      [row({ id: "silent2", audio_url: null })],
    );
    expect(rot.map((e) => e.track_id)).toEqual(["c1"]);
  });

  it("plays pass through from the rows — window plays win, nothing invented", () => {
    const rot = buildRadioRotation(
      [row({ id: "c1", play_count: 900, window_plays: 42 })],
      [row({ id: "n1", play_count: 7, window_plays: undefined })],
    );
    expect(rot.find((e) => e.track_id === "c1")?.plays).toBe(42);
    expect(rot.find((e) => e.track_id === "n1")?.plays).toBe(7);
  });

  it("respects the limit and tolerates empty sources", () => {
    const many = Array.from({ length: 40 }, (_, i) => row({ id: `c${i}` }));
    expect(buildRadioRotation(many, [], 10)).toHaveLength(10);
    expect(buildRadioRotation([], [])).toEqual([]);
  });
});

describe("the smart-law pin", () => {
  it("autoplay-with-sound is pinned off", () => {
    expect(RADIO_AUTOPLAY_WITH_SOUND).toBe(false);
  });
});

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

function memoryStore(): ChartsRadioPrefsStore {
  const rows = new Map<string, ChartsRadioPrefsWire>();
  return {
    async getRow(userId) {
      const r = rows.get(userId);
      return r ? { ...r } : null;
    },
    async upsertRow(userId, prefs) {
      rows.set(userId, { ...prefs });
    },
  };
}

describe("charts radio prefs", () => {
  it("no row yet: not tuned in (the default)", async () => {
    expect(await getChartsRadioPrefs(memoryStore(), USER_A)).toEqual({ tuned_in: false });
  });

  it("tuning in persists and reads back exactly", async () => {
    const store = memoryStore();
    const saved = await setChartsRadioPrefs(store, USER_A, { tuned_in: true });
    expect(saved).toEqual({ tuned_in: true });
    expect(await getChartsRadioPrefs(store, USER_A)).toEqual({ tuned_in: true });
  });

  it("accounts are isolated", async () => {
    const store = memoryStore();
    await setChartsRadioPrefs(store, USER_A, { tuned_in: true });
    expect(await getChartsRadioPrefs(store, USER_B)).toEqual({ tuned_in: false });
  });
});
