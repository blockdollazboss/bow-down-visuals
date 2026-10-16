/* ── Podcast transcript editor — text edits become audio cuts (Stack 6 #5)
 * The editor works on the word-timed transcript produced by the existing
 * transcription analysis (POST /api/remove-fillers/analyze — Whisper word
 * timings + ffmpeg silence detection, charged once at 200 Visual Bucs like
 * the Filler-Word Remover it shares machinery with). Deleting words or
 * toggling silence spans in the text builds a cut list; the existing
 * render endpoint (POST /api/remove-fillers/render, no extra charge)
 * reassembles the audio from the keep-segments.
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
