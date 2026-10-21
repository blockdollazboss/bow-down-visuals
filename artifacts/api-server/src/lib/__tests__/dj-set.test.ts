/**
 * dj-set.test.ts — harmonic ordering + DJ library export, pure logic.
 * Pins: Camelot geometry, the proposal contract (permutation, opens low,
 * energy arc on same-key tracks, deterministic, proposal ≠ mutation),
 * and that both export formats actually carry BPM/key and the crate's
 * play order — the metadata is the product.
 */
import { describe, it, expect } from "vitest";
import {
  camelotDistance,
  bpmDistance,
  proposeSetOrder,
  buildRekordboxXml,
  buildM3u,
  exportFileName,
  type DjTrackMeta,
} from "../dj-set";

function track(partial: Partial<DjTrackMeta> & { songId: string }): DjTrackMeta {
  return {
    title: partial.songId,
    audioUrl: `https://cdn.example.com/audio/${partial.songId}.mp3`,
    durationSec: 200,
    bpm: null,
    keyLabel: null,
    camelot: null,
    tonality: null,
    keyConfidence: null,
    ...partial,
  };
}

describe("camelot geometry", () => {
  it("scores the wheel's smooth moves as close and clashes as far", () => {
    expect(camelotDistance("8A", "8A")).toBe(0);
    expect(camelotDistance("8A", "9A")).toBe(1); // energy shift up
    expect(camelotDistance("8A", "7A")).toBe(1); // energy shift down
    expect(camelotDistance("8A", "8B")).toBe(1); // relative major
    expect(camelotDistance("12A", "1A")).toBe(1); // wraps around
    expect(camelotDistance("8A", "10A")).toBe(2);
    expect(camelotDistance("8A", "2B")).toBe(3); // a clash
  });

  it("tempo distance is half/double-time aware", () => {
    expect(bpmDistance(70, 140)).toBe(0);
    expect(bpmDistance(128, 64)).toBe(0);
    expect(bpmDistance(120, 124)).toBe(4);
  });
});

describe("proposeSetOrder", () => {
  const crate = [
    track({ songId: "peak", bpm: 130, camelot: "8A", keyLabel: "A minor" }),
    track({ songId: "opener", bpm: 118, camelot: "8A", keyLabel: "A minor" }),
    track({ songId: "mid", bpm: 124, camelot: "8A", keyLabel: "A minor" }),
    track({ songId: "relative", bpm: 126, camelot: "8B", keyLabel: "C major" }),
    track({ songId: "stray", bpm: null, camelot: null }),
  ];

  it("returns a permutation of the input — nothing lost, nothing invented", () => {
    const { order } = proposeSetOrder(crate);
    expect([...order].sort()).toEqual(crate.map((t) => t.songId).sort());
    expect(order).toHaveLength(crate.length);
  });

  it("opens on the lowest-tempo track and annotates every transition", () => {
    const { order, transitions } = proposeSetOrder(crate);
    expect(order[0]).toBe("opener");
    expect(transitions).toHaveLength(order.length - 1);
    expect(transitions[0]!.note).toContain("8A → 8A");
  });

  it("flags tracks without analysis instead of pretending", () => {
    const { unanalyzed } = proposeSetOrder(crate);
    expect(unanalyzed).toEqual(["stray"]);
  });

  it("is deterministic — same crate, same proposal", () => {
    expect(proposeSetOrder(crate).order).toEqual(proposeSetOrder(crate).order);
  });

  it("builds a rising energy arc when every key matches", () => {
    const arc = [
      track({ songId: "c", bpm: 130, camelot: "5A" }),
      track({ songId: "a", bpm: 120, camelot: "5A" }),
      track({ songId: "b", bpm: 125, camelot: "5A" }),
    ];
    expect(proposeSetOrder(arc).order).toEqual(["a", "b", "c"]);
  });

  it("prefers the harmonic neighbor over a same-tempo key clash", () => {
    const choice = [
      track({ songId: "start", bpm: 120, camelot: "8A" }),
      track({ songId: "clash", bpm: 121, camelot: "3B" }),
      track({ songId: "smooth", bpm: 126, camelot: "9A" }),
    ];
    const { order } = proposeSetOrder(choice);
    expect(order).toEqual(["start", "smooth", "clash"]);
  });

  it("handles empty and single-track crates", () => {
    expect(proposeSetOrder([])).toEqual({ order: [], transitions: [], unanalyzed: [] });
    const one = proposeSetOrder([track({ songId: "x", bpm: 120, camelot: "8A" })]);
    expect(one.order).toEqual(["x"]);
    expect(one.transitions).toEqual([]);
  });
});

describe("rekordbox XML export", () => {
  const tracks = [
    track({
      songId: "s1",
      title: "Midnight & Gold",
      bpm: 128,
      keyLabel: "A minor",
      camelot: "8A",
      tonality: "Am",
      keyConfidence: "high",
      durationSec: 187,
    }),
    track({
      songId: "s2",
      title: "Second Song",
      bpm: 130,
      keyLabel: "C major",
      camelot: "8B",
      tonality: "C",
      keyConfidence: "low",
      durationSec: 201,
    }),
  ];

  it("carries BPM, tonality, durations, and the crate order", () => {
    const xml = buildRekordboxXml("Friday Warm-Up", tracks);
    expect(xml).toContain(`<COLLECTION Entries="2">`);
    expect(xml).toContain(`AverageBpm="128.00"`);
    expect(xml).toContain(`AverageBpm="130.00"`);
    expect(xml).toContain(`Tonality="Am"`);
    expect(xml).toContain(`Tonality="C"`);
    expect(xml).toContain(`TotalTime="187"`);
    expect(xml).toContain(`Name="Friday Warm-Up"`);
    const playlist = xml.slice(xml.indexOf("<PLAYLISTS>"));
    expect(playlist.indexOf(`<TRACK Key="1"/>`)).toBeLessThan(playlist.indexOf(`<TRACK Key="2"/>`));
  });

  it("escapes titles and labels a low-confidence key as estimated", () => {
    const xml = buildRekordboxXml("Set", tracks);
    expect(xml).toContain(`Name="Midnight &amp; Gold"`);
    expect(xml).toContain("Camelot 8B");
    expect(xml).toContain("low confidence");
  });

  it("omits BPM/tonality for unanalyzed tracks instead of inventing them", () => {
    const xml = buildRekordboxXml("Set", [track({ songId: "raw" })]);
    expect(xml).not.toContain("AverageBpm");
    expect(xml).not.toContain("Tonality");
  });
});

describe("M3U export", () => {
  it("carries entries in order with BPM/key in comment lines", () => {
    const m3u = buildM3u("Friday Warm-Up", [
      track({ songId: "s1", title: "First", bpm: 128, keyLabel: "A minor", camelot: "8A", durationSec: 187 }),
      track({ songId: "s2", title: "Second", bpm: null, keyLabel: null, camelot: null }),
    ]);
    const lines = m3u.split("\n");
    expect(lines[0]).toBe("#EXTM3U");
    expect(m3u).toContain("#EXTINF:187,First");
    expect(m3u).toContain("# Bow Down Visuals: 128 BPM · A minor · Camelot 8A");
    expect(m3u).toContain("https://cdn.example.com/audio/s1.mp3");
    expect(m3u.indexOf("First")).toBeLessThan(m3u.indexOf("Second"));
    // Unanalyzed track: entry present, no fabricated metadata comment.
    expect(m3u).not.toContain("null BPM");
  });

  it("derives a filename from the audio URL for rekordbox Location", () => {
    expect(exportFileName(track({ songId: "x", audioUrl: "https://cdn.example.com/songs/u/abc-123.mp3?sig=1" })))
      .toBe("abc-123.mp3");
    expect(exportFileName(track({ songId: "x", title: "My Song!", audioUrl: "https://example.com/play/xyz" })))
      .toBe("My Song.mp3");
  });
});
