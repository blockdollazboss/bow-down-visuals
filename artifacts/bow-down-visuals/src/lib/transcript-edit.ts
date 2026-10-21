/* ── Transcript cut mapping — text edits become media cuts ──────────────
 * Shared by the podcast transcript editor (Stack 6 #5) and the video
 * editor's transcript word editor (Wave 3 #17). Both work on the
 * word-timed transcript produced by the existing transcription analysis
 * (POST /api/remove-fillers/analyze — word-level timings from the Scribe
 * seam in api-server lib/transcription.ts + ffmpeg silence detection,
 * charged once at 200 Visual Bucs like the Filler-Word Remover it shares
 * machinery with). Deleting words or toggling silence spans in the text
 * builds a cut list; the existing render endpoint
 * (POST /api/remove-fillers/render, no extra charge) reassembles the
 * audio or video from the keep-segments.
 *
 * The mapping in this file mirrors the server's filler-removal constants
 * (padding + merge gap) so the cuts the user sees are the cuts the render
 * applies — deleting a word cuts [word.start − pad, word.end + pad], and
 * cuts closer than the merge gap fuse into one. */

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptCut {
  id: string;
  start: number;
  end: number;
  kind: "filler" | "silence";
  label: string;
}

/** Padding around each deleted word so speech isn't clipped (mirrors the
 *  server's FILLER_PAD_SEC). */
export const WORD_CUT_PAD_SEC = 0.15;
/** Cuts closer than this merge (mirrors the server's MERGE_GAP_SEC). */
export const CUT_MERGE_GAP_SEC = 0.2;

/** Merge overlapping / near-adjacent cuts, keeping the earliest start.
 *  Mirrors mergeCuts in api-server filler-removal.ts. */
export function mergeTranscriptCuts(cuts: TranscriptCut[]): TranscriptCut[] {
  const sorted = [...cuts]
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start);
  const merged: TranscriptCut[] = [];
  for (const c of sorted) {
    const last = merged[merged.length - 1];
    if (last && c.start - last.end <= CUT_MERGE_GAP_SEC) {
      last.end = Math.max(last.end, c.end);
      if (c.kind === "silence") last.kind = "silence";
    } else {
      merged.push({ ...c });
    }
  }
  return merged;
}

/**
 * Cuts for a set of deleted word indices. Consecutive deleted words fuse
 * into a single cut spanning the run (plus padding on the outer edges) —
 * the same shape the server's phrase detection produces.
 */
export function cutsForDeletedWords(
  words: TranscriptWord[],
  deleted: ReadonlySet<number>,
): TranscriptCut[] {
  const cuts: TranscriptCut[] = [];
  let runStart = -1;
  const flush = (runEndIdx: number) => {
    if (runStart < 0) return;
    const first = words[runStart]!;
    const last = words[runEndIdx]!;
    cuts.push({
      id: `words-${runStart}-${runEndIdx}`,
      start: Math.max(0, first.start - WORD_CUT_PAD_SEC),
      end: last.end + WORD_CUT_PAD_SEC,
      kind: "filler",
      label: words
        .slice(runStart, runEndIdx + 1)
        .map((w) => w.word)
        .join(" "),
    });
    runStart = -1;
  };
  words.forEach((_, i) => {
    if (deleted.has(i)) {
      if (runStart < 0) runStart = i;
    } else {
      flush(i - 1);
    }
  });
  flush(words.length - 1);
  return cuts;
}

/** The full render cut list: deleted words + enabled silence spans. */
export function buildTranscriptRenderCuts(
  words: TranscriptWord[],
  deleted: ReadonlySet<number>,
  silenceCuts: TranscriptCut[],
  silencesEnabled: ReadonlySet<string>,
): TranscriptCut[] {
  const activeSilences = silenceCuts.filter((c) => silencesEnabled.has(c.id));
  return mergeTranscriptCuts([...cutsForDeletedWords(words, deleted), ...activeSilences]);
}

/** Seconds the render will remove (merged cuts, clamped to the media). */
export function editedTimeSaved(cuts: TranscriptCut[], durationSec: number): number {
  const total = cuts.reduce(
    (sum, c) => sum + Math.max(0, Math.min(c.end, durationSec) - Math.max(0, c.start)),
    0,
  );
  return Math.round(total * 10) / 10;
}

/**
 * Interleave words and silence spans into one reading flow: each silence
 * chip sits between the word before it and the word after it, so toggling
 * a silence in the text reads exactly where the pause falls.
 */
export type TranscriptFlowItem =
  | { type: "word"; index: number; word: TranscriptWord }
  | { type: "silence"; cut: TranscriptCut };

export function buildTranscriptFlow(
  words: TranscriptWord[],
  silenceCuts: TranscriptCut[],
): TranscriptFlowItem[] {
  const items: TranscriptFlowItem[] = [];
  const silences = [...silenceCuts].sort((a, b) => a.start - b.start);
  let s = 0;
  words.forEach((word, index) => {
    while (s < silences.length && silences[s]!.start < word.start) {
      items.push({ type: "silence", cut: silences[s]! });
      s++;
    }
    items.push({ type: "word", index, word });
  });
  while (s < silences.length) {
    items.push({ type: "silence", cut: silences[s]! });
    s++;
  }
  return items;
}

/** Word indices covered by the analysis' own filler cuts — the "cut all
 *  fillers" action marks exactly the words the detector flagged. */
export function fillerWordIndices(
  words: TranscriptWord[],
  fillerCuts: TranscriptCut[],
): Set<number> {
  const out = new Set<number>();
  for (const cut of fillerCuts) {
    if (cut.kind !== "filler") continue;
    words.forEach((w, i) => {
      if (w.start >= cut.start - WORD_CUT_PAD_SEC - 0.001 && w.end <= cut.end + WORD_CUT_PAD_SEC + 0.001) {
        out.add(i);
      }
    });
  }
  return out;
}

/* ── AI cut suggestions (Wave 3 #17) ─────────────────────────────────────
 * The analysis pre-marks likely cuts — filler words the detector flagged,
 * dead-air pauses, and repeated takes (the speaker restarting a phrase).
 * A suggestion is advice only: it contributes NOTHING to the render cut
 * list until the creator accepts it (or marks the words by hand). The
 * helpers below keep that contract in one testable place: suggestions
 * are built from the analysis, acceptance resolves them into the same
 * deleted-word / enabled-silence sets the manual toggles produce, and
 * buildTranscriptRenderCuts above only ever sees those sets. */

/** Inclusive word-index range, either direction (shift-click selection). */
export function rangeIndices(from: number, to: number): number[] {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const out: number[] = [];
  for (let i = lo; i <= hi; i++) out.push(i);
  return out;
}

/** Minimum run of identical words that reads as a restarted take. */
export const RETAKE_MIN_WORDS = 3;
/** A restart begins within this many words of the failed attempt's start. */
export const RETAKE_MAX_RESTART_GAP = 12;

export interface RepeatedTake {
  /** First word of the failed attempt. */
  startIndex: number;
  /** Last word of the failed attempt (the word before the restart). */
  endIndex: number;
  /** First word of the take that replaces it. */
  repeatStartIndex: number;
}

/** Mirrors the server filler-removal normalizeWord. */
function normalizeTranscriptWord(w: string): string {
  return w
    .toLowerCase()
    .replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "")
    .replace(/'/g, "");
}

/**
 * Find repeated takes: a phrase of RETAKE_MIN_WORDS+ words that is said
 * again within RETAKE_MAX_RESTART_GAP words of its first start. The
 * failed attempt is everything from the first start up to the restart —
 * the span an editor drops. When several restarts qualify, the one with
 * the longest matching opening wins (it swallows double false starts).
 */
export function detectRepeatedTakes(words: TranscriptWord[]): RepeatedTake[] {
  const norm = words.map((w) => normalizeTranscriptWord(w.word));
  const takes: RepeatedTake[] = [];
  let i = 0;
  while (i < norm.length) {
    if (!norm[i]) {
      i++;
      continue;
    }
    let best: { j: number; len: number } | null = null;
    const maxJ = Math.min(norm.length - RETAKE_MIN_WORDS, i + RETAKE_MAX_RESTART_GAP);
    for (let j = i + 1; j <= maxJ; j++) {
      if (!norm[j] || norm[j] !== norm[i]) continue;
      let len = 0;
      while (
        i + len < norm.length &&
        j + len < norm.length &&
        norm[i + len] !== "" &&
        norm[i + len] === norm[j + len]
      ) {
        len++;
      }
      if (len >= RETAKE_MIN_WORDS && (!best || len > best.len)) {
        best = { j, len };
      }
    }
    if (best) {
      /* Swallow a shorter false start immediately before the anchor: a
       * run of words that is a clean prefix of the kept take, ending
       * where the anchor begins ("i want | i want to | i want to go" —
       * the middle attempt anchors, the first two words are also dud). */
      let startIndex = i;
      for (let s = i - 1; s >= 0 && i - s <= RETAKE_MAX_RESTART_GAP; s--) {
        let isPrefix = norm[s] === norm[best.j];
        for (let k = 0; isPrefix && s + k < i; k++) {
          if (norm[s + k] !== norm[best.j + k]) isPrefix = false;
        }
        if (isPrefix) startIndex = s;
      }
      takes.push({ startIndex, endIndex: best.j - 1, repeatStartIndex: best.j });
      i = best.j;
    } else {
      i++;
    }
  }
  return takes;
}

export type CutSuggestionKind = "filler" | "silence" | "retake";

export interface CutSuggestion {
  id: string;
  kind: CutSuggestionKind;
  /** Words this suggestion would cut when accepted (filler / retake). */
  wordIndices: number[];
  /** Silence cut it would enable when accepted (silence). */
  silenceId?: string;
  label: string;
  /** Plain-language why, shown next to the suggestion. */
  reason: string;
}

/**
 * Every pre-marked cut for a transcript: one suggestion per run of
 * detector-flagged filler words, one per detected dead-air pause, and
 * one per repeated take. Sorted by where they fall in the media.
 */
export function buildCutSuggestions(
  words: TranscriptWord[],
  cuts: TranscriptCut[],
): CutSuggestion[] {
  const keyed: Array<{ at: number; s: CutSuggestion }> = [];

  const fillerIdx = [...fillerWordIndices(words, cuts)].sort((a, b) => a - b);
  let runStart = -1;
  const flushRun = (runEnd: number) => {
    if (runStart < 0) return;
    const indices = rangeIndices(runStart, runEnd);
    keyed.push({
      at: words[runStart]!.start,
      s: {
        id: `sug-filler-${runStart}`,
        kind: "filler",
        wordIndices: indices,
        label: indices.map((ix) => words[ix]!.word).join(" "),
        reason: "Filler words",
      },
    });
    runStart = -1;
  };
  fillerIdx.forEach((ix, k) => {
    if (runStart < 0) {
      runStart = ix;
    } else if (ix !== fillerIdx[k - 1]! + 1) {
      flushRun(fillerIdx[k - 1]!);
      runStart = ix;
    }
  });
  if (fillerIdx.length > 0) flushRun(fillerIdx[fillerIdx.length - 1]!);

  for (const c of cuts) {
    if (c.kind !== "silence") continue;
    keyed.push({
      at: c.start,
      s: {
        id: `sug-silence-${c.id}`,
        kind: "silence",
        wordIndices: [],
        silenceId: c.id,
        label: c.label,
        reason: "Dead-air pause",
      },
    });
  }

  for (const take of detectRepeatedTakes(words)) {
    const indices = rangeIndices(take.startIndex, take.endIndex);
    keyed.push({
      at: words[take.startIndex]!.start,
      s: {
        id: `sug-retake-${take.startIndex}`,
        kind: "retake",
        wordIndices: indices,
        label: indices.map((ix) => words[ix]!.word).join(" "),
        reason: "Repeated take — said again right after",
      },
    });
  }

  return keyed.sort((a, b) => a.at - b.at).map((k) => k.s);
}

/**
 * Resolve the accepted suggestions into the manual-toggle sets: word
 * indices to delete and silence cut ids to enable. Suggestions that were
 * not accepted contribute nothing — this is the "suggestions never cut
 * on their own" contract, pinned by tests.
 */
export function acceptedSuggestionSets(
  suggestions: CutSuggestion[],
  acceptedIds: ReadonlySet<string>,
): { wordIndices: Set<number>; silenceIds: Set<string> } {
  const wordIndices = new Set<number>();
  const silenceIds = new Set<string>();
  for (const s of suggestions) {
    if (!acceptedIds.has(s.id)) continue;
    for (const ix of s.wordIndices) wordIndices.add(ix);
    if (s.silenceId) silenceIds.add(s.silenceId);
  }
  return { wordIndices, silenceIds };
}
