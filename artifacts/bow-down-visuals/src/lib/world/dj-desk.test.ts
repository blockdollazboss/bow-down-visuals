/**
 * dj-desk — stack1500 world parity wave #3 item 29 pins.
 *
 * The DJ Set Prep desk is the set-prep page's native form.
 * These pins hold: analysis is FREE in the registry (cost 0);
 * the analyze batching respects the schema's 20-song bound; the
 * guards accept the rails' real shapes (string durations from
 * the DB read as numbers, null analysis stays null — never
 * zeros); outcomes fold into the library without touching
 * failed tracks; crate membership/order helpers compute exactly
 * what the wholesale PATCH sends; a drifted proposal is a
 * failure, never an invented order.
 */
import { describe, expect, it } from "vitest";
import {
  DJ_ANALYZE_BATCH,
  DJ_ANALYZE_COST,
  DJ_ANALYZE_PATH,
  DJ_CRATES_PATH,
  analysisLine,
  analyzeOutcomesOf,
  applyAnalyzeOutcomes,
  buildAnalyzePayload,
  chunkSongIds,
  crateOfResponse,
  cratesOfResponse,
  djCratePath,
  djExportPath,
  djProposePath,
  durationLabel,
  libraryOfResponse,
  moved,
  proposalOfResponse,
  withAdded,
  withoutId,
  type DjLibraryTrack,
} from "./dj-desk";
import { getCreditCost } from "../credit-costs";

describe("free rail + paths", () => {
  it("the analyze registry row is cost 0 (DJ Set Prep (free))", () => {
    expect(getCreditCost(DJ_ANALYZE_PATH)?.cost).toBe(0);
    expect(getCreditCost(DJ_ANALYZE_PATH)?.feature).toBe("DJ Set Prep (free)");
    expect(DJ_ANALYZE_COST).toBe(0);
  });

  it("crate sub-paths encode the id and the export format", () => {
    expect(djCratePath("c 1")).toBe(`${DJ_CRATES_PATH}/c%201`);
    expect(djProposePath("c1")).toBe("/api/dj/crates/c1/propose-order");
    expect(djExportPath("c1", "rekordbox")).toBe("/api/dj/crates/c1/export?format=rekordbox");
    expect(djExportPath("c1", "m3u")).toBe("/api/dj/crates/c1/export?format=m3u");
  });
});

describe("analyze batching — the schema's 1–20 bound", () => {
  it("chunks at 20 and keeps every id exactly once", () => {
    const ids = Array.from({ length: 45 }, (_, i) => `s${i}`);
    const chunks = chunkSongIds(ids);
    expect(chunks.map((c) => c.length)).toEqual([20, 20, 5]);
    expect(chunks.flat()).toEqual(ids);
    expect(DJ_ANALYZE_BATCH).toBe(20);
    expect(chunkSongIds([])).toEqual([]);
  });

  it("the payload carries force only when asked", () => {
    expect(buildAnalyzePayload(["a"])).toEqual({ songIds: ["a"] });
    expect(buildAnalyzePayload(["a"], true)).toEqual({ songIds: ["a"], force: true });
  });
});

const ANALYSIS = {
  bpm: 122.4,
  bpmConfidence: "high",
  keyLabel: "A minor",
  camelot: "8A",
  keyConfidence: "high",
  keyScore: 0.9,
  durationSec: 187,
  analyzedAt: "2026-11-03T10:00:00.000Z",
};

const LIBRARY = {
  tracks: [
    { id: "s1", title: "One", audioUrl: "https://x/1.mp3", durationSec: "187", analysis: ANALYSIS },
    { id: "s2", title: "Two", audioUrl: "https://x/2.mp3", durationSec: null, analysis: null },
    { title: "No id — dropped", audioUrl: "", durationSec: null, analysis: null },
  ],
};

describe("library guard", () => {
  it("string durations read as numbers; null analysis stays null; id-less rows drop", () => {
    const tracks = libraryOfResponse(LIBRARY)!;
    expect(tracks).toHaveLength(2);
    expect(tracks[0]!.durationSec).toBe(187);
    expect(tracks[0]!.analysis?.camelot).toBe("8A");
    expect(tracks[1]!.analysis).toBeNull();
    expect(libraryOfResponse({})).toBeNull();
    expect(libraryOfResponse(null)).toBeNull();
  });

  it("the analysis line prints only facts that exist", () => {
    expect(analysisLine(null)).toBe("Not analyzed yet");
    expect(analysisLine({ ...ANALYSIS, bpm: 122.4 })).toBe("122 BPM · 8A · A minor");
    expect(
      analysisLine({ bpm: null, bpmConfidence: null, keyLabel: null, camelot: null, keyConfidence: null, keyScore: null, durationSec: null, analyzedAt: null }),
    ).toBe("Analyzed — no tempo or key found");
    expect(durationLabel(187)).toBe("3:07");
    expect(durationLabel(null)).toBe("");
  });
});

describe("analyze outcomes fold into the library", () => {
  it("analyzed/cached replace; failed keeps the old state", () => {
    const tracks = libraryOfResponse(LIBRARY)!;
    const outcomes = analyzeOutcomesOf({
      results: [
        { songId: "s2", status: "analyzed", analysis: { ...ANALYSIS, bpm: 98 } },
        { songId: "s1", status: "failed", error: "no audio" },
      ],
    })!;
    const next = applyAnalyzeOutcomes(tracks, outcomes);
    expect(next[1]!.analysis?.bpm).toBe(98);
    expect(next[0]!.analysis?.bpm).toBe(122.4);
    expect(analyzeOutcomesOf({ results: [{ songId: "s9", status: "weird" }] })).toEqual([]);
    expect(analyzeOutcomesOf({})).toBeNull();
  });
});

const CRATE = {
  id: "c1",
  name: "Friday set",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  tracks: [
    { songId: "s2", title: "Two", durationSec: 200, bpm: null, keyLabel: null, camelot: null, position: 2 },
    { songId: "s1", title: "One", durationSec: 187, bpm: 122, keyLabel: "A minor", camelot: "8A", position: 1 },
  ],
};

describe("crate guard + order helpers", () => {
  it("crate tracks come back in position order", () => {
    const crate = crateOfResponse({ crate: CRATE })!;
    expect(crate.tracks.map((t) => t.songId)).toEqual(["s1", "s2"]);
    expect(cratesOfResponse({ crates: [CRATE, { name: "no id" }] })).toHaveLength(1);
    expect(crateOfResponse({ crate: { name: "x" } })).toBeNull();
    expect(crateOfResponse({})).toBeNull();
  });

  it("membership helpers compute the wholesale PATCH list", () => {
    expect(withAdded(["a"], "b")).toEqual(["a", "b"]);
    expect(withAdded(["a"], "a")).toEqual(["a"]);
    expect(withoutId(["a", "b"], "a")).toEqual(["b"]);
  });

  it("moves swap neighbours and refuse the edges as no-ops", () => {
    expect(moved(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moved(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moved(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(moved(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});

describe("proposal guard", () => {
  it("accepts a real proposal with its transitions + unanalyzed list", () => {
    const p = proposalOfResponse({
      proposal: {
        order: ["s2", "s1"],
        transitions: [{ fromSongId: "s2", toSongId: "s1", note: "Same key · +2 BPM", keyDistance: 0, bpmDelta: 2 }],
        unanalyzed: ["s9"],
      },
    })!;
    expect(p.order).toEqual(["s2", "s1"]);
    expect(p.transitions[0]!.note).toBe("Same key · +2 BPM");
    expect(p.unanalyzed).toEqual(["s9"]);
  });

  it("a drifted order is a failure, never an invented one", () => {
    expect(proposalOfResponse({ proposal: { order: "s1,s2" } })).toBeNull();
    expect(proposalOfResponse({ proposal: { order: [1, 2] } })).toBeNull();
    expect(proposalOfResponse({})).toBeNull();
    const t: DjLibraryTrack[] = [];
    expect(t).toEqual([]);
  });
});
