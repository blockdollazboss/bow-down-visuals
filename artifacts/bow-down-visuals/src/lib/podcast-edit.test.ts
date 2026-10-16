/* Stack 6 #5 — transcript-cut mapping tests: deleting words/silences in
 * text must produce exactly the cut list the render applies. */
import { describe, it, expect } from "vitest";
import {
  cutsForDeletedWords,
  buildTranscriptRenderCuts,
  buildTranscriptFlow,
  editedTimeSaved,
  fillerWordIndices,
  type TranscriptWord,
  type TranscriptCut,
} from "@/lib/podcast-edit";

const words: TranscriptWord[] = [
  { word: "hello", start: 0.0, end: 0.4 },
  { word: "um", start: 0.5, end: 0.7 },
  { word: "world", start: 0.8, end: 1.2 },
  { word: "this", start: 1.3, end: 1.6 },
  { word: "is", start: 1.7, end: 1.9 },
  { word: "great", start: 2.0, end: 2.5 },
];

describe("cutsForDeletedWords", () => {
  it("a single deleted word cuts its span plus padding", () => {
    const cuts = cutsForDeletedWords(words, new Set([1]));
    expect(cuts).toHaveLength(1);
    expect(cuts[0]).toMatchObject({ kind: "filler", label: "um" });
    expect(cuts[0]!.start).toBeCloseTo(0.35);
    expect(cuts[0]!.end).toBeCloseTo(0.85);
  });
  it("consecutive deletions fuse into one cut", () => {
    const cuts = cutsForDeletedWords(words, new Set([3, 4]));
    expect(cuts).toHaveLength(1);
    expect(cuts[0]!.label).toBe("this is");
    expect(cuts[0]!.start).toBeCloseTo(1.15);
    expect(cuts[0]!.end).toBeCloseTo(2.05);
  });
  it("padding never goes below zero", () => {
    const cuts = cutsForDeletedWords(words, new Set([0]));
    expect(cuts[0]!.start).toBe(0);
  });
  it("nothing deleted → no cuts", () => {
    expect(cutsForDeletedWords(words, new Set())).toEqual([]);
  });
});

describe("buildTranscriptRenderCuts + editedTimeSaved", () => {
  const silence: TranscriptCut = { id: "s1", start: 3.0, end: 4.2, kind: "silence", label: "silence · 1.2s" };
  it("disabled silences are excluded", () => {
    const cuts = buildTranscriptRenderCuts(words, new Set([1]), [silence], new Set());
    expect(cuts.map((c) => c.kind)).toEqual(["filler"]);
  });
  it("enabled silences join and merge with near word cuts", () => {
    const nearSilence: TranscriptCut = { id: "s2", start: 0.95, end: 1.1, kind: "silence", label: "silence" };
    const cuts = buildTranscriptRenderCuts(words, new Set([1]), [nearSilence], new Set(["s2"]));
    /* word cut ends 0.85, silence starts 0.95 — gap 0.1 ≤ merge gap → fused */
    expect(cuts).toHaveLength(1);
    expect(cuts[0]!.end).toBeCloseTo(1.1);
  });
  it("time saved sums merged cuts clamped to duration", () => {
    const cuts = buildTranscriptRenderCuts(words, new Set([1]), [silence], new Set(["s1"]));
    /* 0.5 (um±pad) + 1.2 (silence) = 1.7 */
    expect(editedTimeSaved(cuts, 10)).toBeCloseTo(1.7);
  });
});

describe("buildTranscriptFlow", () => {
  it("silence chips sit where the pause falls", () => {
    const silence: TranscriptCut = { id: "s1", start: 1.25, end: 2.6, kind: "silence", label: "silence" };
    const flow = buildTranscriptFlow(words, [silence]);
    const kinds = flow.map((f) => f.type);
    /* silence at 1.25 falls after "world" (ends 1.2), before "this" (1.3) */
    expect(kinds).toEqual(["word", "word", "word", "silence", "word", "word", "word"]);
  });
});

describe("fillerWordIndices", () => {
  it("marks the words the detector's filler cuts cover", () => {
    const fillerCuts: TranscriptCut[] = [
      { id: "f1", start: 0.35, end: 0.85, kind: "filler", label: "um" },
      { id: "s1", start: 3, end: 4, kind: "silence", label: "silence" },
    ];
    expect([...fillerWordIndices(words, fillerCuts)]).toEqual([1]);
  });
});
