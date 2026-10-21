/* Transcript-cut mapping tests (Stack 6 #5, shared lib since Wave 3 #17):
 * deleting words/silences in text must produce exactly the cut list the
 * render applies — and AI suggestions must contribute nothing to that
 * list until the creator accepts them. */
import { describe, it, expect } from "vitest";
import {
  cutsForDeletedWords,
  buildTranscriptRenderCuts,
  buildTranscriptFlow,
  editedTimeSaved,
  fillerWordIndices,
  rangeIndices,
  detectRepeatedTakes,
  buildCutSuggestions,
  acceptedSuggestionSets,
  type TranscriptWord,
  type TranscriptCut,
} from "@/lib/transcript-edit";

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

/* ── Wave 3 #17: range selection + AI suggestions ─────────────────────── */

describe("rangeIndices", () => {
  it("is inclusive in both directions", () => {
    expect(rangeIndices(2, 5)).toEqual([2, 3, 4, 5]);
    expect(rangeIndices(5, 2)).toEqual([2, 3, 4, 5]);
    expect(rangeIndices(3, 3)).toEqual([3]);
  });
});

const spoken = (text: string): TranscriptWord[] =>
  text.split(" ").map((word, i) => ({ word, start: i * 0.5, end: i * 0.5 + 0.4 }));

describe("detectRepeatedTakes", () => {
  it("flags the failed first attempt of a restarted phrase", () => {
    const ws = spoken("i want to tell i want to tell you about the show");
    const takes = detectRepeatedTakes(ws);
    expect(takes).toHaveLength(1);
    expect(takes[0]).toMatchObject({ startIndex: 0, endIndex: 3, repeatStartIndex: 4 });
  });
  it("swallows a double false start into one span", () => {
    const ws = spoken("i want i want to i want to go home now");
    const takes = detectRepeatedTakes(ws);
    expect(takes).toHaveLength(1);
    expect(takes[0]!.startIndex).toBe(0);
    expect(takes[0]!.repeatStartIndex).toBe(5);
    expect(takes[0]!.endIndex).toBe(4);
  });
  it("ignores repeats shorter than three words", () => {
    const ws = spoken("yeah yeah that is the whole point of it");
    expect(detectRepeatedTakes(ws)).toEqual([]);
  });
  it("ignores a hook repeated far later in the transcript", () => {
    const ws = spoken(
      "we are the champions of the whole wide world tonight and every single night we sing it loud we are the champions again",
    );
    /* "we are the champions" recurs ~15 words later — outside the restart gap */
    expect(detectRepeatedTakes(ws)).toEqual([]);
  });
  it("plain speech with no restart yields nothing", () => {
    const ws = spoken("welcome back to the channel today we are building a studio desk");
    expect(detectRepeatedTakes(ws)).toEqual([]);
  });
});

describe("buildCutSuggestions + acceptedSuggestionSets", () => {
  const ws = spoken("um welcome back uh to the show");
  /* detector cuts: "um" (word 0, incl. pad), "uh" (word 3, incl. pad), a pause */
  const detCuts: TranscriptCut[] = [
    { id: "f0", start: 0, end: 0.55, kind: "filler", label: "um" },
    { id: "f3", start: 1.35, end: 2.05, kind: "filler", label: "uh" },
    { id: "s9", start: 3.2, end: 4.4, kind: "silence", label: "silence · 1.2s" },
  ];

  it("builds one suggestion per filler run, per pause, sorted by position", () => {
    const sugs = buildCutSuggestions(ws, detCuts);
    expect(sugs.map((s) => s.kind)).toEqual(["filler", "filler", "silence"]);
    expect(sugs[0]!.wordIndices).toEqual([0]);
    expect(sugs[1]!.wordIndices).toEqual([3]);
    expect(sugs[2]!.silenceId).toBe("s9");
    expect(new Set(sugs.map((s) => s.id)).size).toBe(sugs.length);
  });

  it("consecutive filler words fuse into a single suggestion", () => {
    const ws2 = spoken("so um uh welcome back");
    const cuts2: TranscriptCut[] = [
      { id: "fa", start: 0.35, end: 1.05, kind: "filler", label: "um" },
      { id: "fb", start: 0.85, end: 1.55, kind: "filler", label: "uh" },
    ];
    const sugs = buildCutSuggestions(ws2, cuts2);
    expect(sugs).toHaveLength(1);
    expect(sugs[0]!.wordIndices).toEqual([1, 2]);
  });

  it("a repeated take becomes a suggestion over the failed attempt", () => {
    const ws3 = spoken("i want to tell i want to tell you everything");
    const sugs = buildCutSuggestions(ws3, []);
    expect(sugs).toHaveLength(1);
    expect(sugs[0]!.kind).toBe("retake");
    expect(sugs[0]!.wordIndices).toEqual([0, 1, 2, 3]);
  });

  it("SUGGESTIONS NEVER CUT ON THEIR OWN: nothing accepted → no render cuts", () => {
    const sugs = buildCutSuggestions(ws, detCuts);
    expect(sugs.length).toBeGreaterThan(0);
    const { wordIndices, silenceIds } = acceptedSuggestionSets(sugs, new Set());
    expect(wordIndices.size).toBe(0);
    expect(silenceIds.size).toBe(0);
    const renderCuts = buildTranscriptRenderCuts(ws, wordIndices, detCuts, silenceIds);
    expect(renderCuts).toEqual([]);
  });

  it("accepting resolves into exactly the manual sets", () => {
    const sugs = buildCutSuggestions(ws, detCuts);
    const accept = new Set([sugs[0]!.id, sugs[2]!.id]);
    const { wordIndices, silenceIds } = acceptedSuggestionSets(sugs, accept);
    expect([...wordIndices]).toEqual([0]);
    expect([...silenceIds]).toEqual(["s9"]);
    const renderCuts = buildTranscriptRenderCuts(ws, wordIndices, detCuts, silenceIds);
    /* "um" span (0–0.4 ± pad → 0–0.55) and the 3.2–4.4 pause */
    expect(renderCuts).toHaveLength(2);
    expect(renderCuts[0]).toMatchObject({ kind: "filler" });
    expect(renderCuts[0]!.start).toBe(0);
    expect(renderCuts[0]!.end).toBeCloseTo(0.55);
    expect(renderCuts[1]).toMatchObject({ kind: "silence", start: 3.2, end: 4.4 });
  });
});
