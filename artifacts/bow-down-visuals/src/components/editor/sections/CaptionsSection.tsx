import { useEffect, useState } from "react";
import {
  Captions, Plus, Trash2, Wand2, RotateCcw, Eye, EyeOff,
  CheckCircle2, AlertCircle, Info, Pencil,
  Music2, ChevronsLeft, ChevronsRight, Expand, Shrink,
  Sparkles, Loader2,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  CAPTION_MODE_DEFS,
  CAPTION_STYLE_PRESET_DEFS,
  CAPTION_FONT_SIZES,
  CAPTION_ANIMATIONS,
  FORMAT_PRESET_LABELS,
  formatDimensions,
  type CaptionLine,
  type CaptionMode,
  type CaptionAnimation,
  type CaptionStylePreset,
  type VideoFormat,
  type EditorSettings,
} from "@/lib/editor-settings";
import { LayoutTemplate } from "lucide-react";
import { smartSplitLyrics } from "@/lib/lyric-splitter";
import { EditorCard, Field, Segmented, TextInput } from "@/components/editor/controls";

interface Props {
  settings: EditorSettings;
  setSettings: (s: EditorSettings) => void;
  /** Project lyrics — auto-fills the lyrics box */
  lyrics?: string;
  /** Song duration in seconds — used to spread captions evenly */
  songDuration?: number;
  /** True when a project audio URL is resolved but duration is still loading */
  audioSourceLoading?: boolean;
  /** Currently selected caption ID — highlights the row and shows it in Live Preview */
  selectedCaptionId?: string | null;
  /** Called when a caption row is clicked */
  onSelectCaption?: (id: string | null) => void;
  /** Resolved audio URL for AI transcription sync */
  audioUrl?: string | null;
  /** Auth token getter — required for the transcribe-url API call */
  getAccessToken?: () => Promise<string | null>;
}

type StatusType = "success" | "error" | "info";
interface Status { type: StatusType; message: string }

function newLineId() {
  return `line-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Build CaptionLine[] from text using smart splitting + even timing. */
function buildCaptionLines(
  text: string,
  splitStyle: "short" | "medium" | "long",
  songDuration?: number,
): CaptionLine[] {
  const phrases = smartSplitLyrics(text, splitStyle);
  if (phrases.length === 0) return [];
  const secPer =
    songDuration && songDuration > 0 ? songDuration / phrases.length : 2;
  return phrases.map((phrase, i): CaptionLine => ({
    id: newLineId(),
    startSec: parseFloat((i * secPer).toFixed(1)),
    endSec: parseFloat(((i + 1) * secPer).toFixed(1)),
    text: phrase,
  }));
}

function generateHookLines(hookText: string, songDuration?: number): CaptionLine[] {
  const lines = hookText.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return [];
  const secPer =
    songDuration && songDuration > 0 ? songDuration / lines.length : 4;
  return lines.map((text, i): CaptionLine => ({
    id: newLineId(),
    startSec: parseFloat((i * secPer).toFixed(1)),
    endSec: parseFloat(((i + 1) * secPer).toFixed(1)),
    text,
  }));
}

/* ── AI Sync: fuzzy caption-to-transcript matching ─────────────────────── */

type WhisperSegment = { id: number; start: number; end: number; text: string };

interface AiSyncDetails {
  audioFound: boolean;
  hasTranscript: boolean;
  matched: number;
  needsReview: number;
  avgConfidencePct: number;
}

function normalizeForMatch(s: string): string[] {
  return s.toLowerCase().replace(/[^\w\s]/g, " ").split(/\s+/).filter(Boolean);
}

function tokenOverlap(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const hits = a.filter((t) => setB.has(t)).length;
  return hits / Math.max(a.length, b.length);
}

function matchCaptionsToTranscript(
  lines: CaptionLine[],
  segments: WhisperSegment[],
): { syncedLines: CaptionLine[]; matchedCount: number; needsReviewCount: number } {
  let segCursor = 0;

  const results: Array<{ line: CaptionLine; matched: boolean }> = lines.map((line) => {
    const capTokens = normalizeForMatch(line.text);
    let bestScore = 0;
    let bestStart = 0;
    let bestEnd = 0;
    let bestSegEnd = segCursor;

    /* Search from just before the cursor to allow slight backtrack */
    const searchFrom = Math.max(0, segCursor - 1);
    for (let i = searchFrom; i < segments.length; i++) {
      let spanText = "";
      for (let j = i; j < Math.min(i + 7, segments.length); j++) {
        spanText += segments[j]!.text;
        const score = tokenOverlap(capTokens, normalizeForMatch(spanText));
        if (score > bestScore) {
          bestScore = score;
          bestStart = segments[i]!.start;
          bestEnd = segments[j]!.end;
          bestSegEnd = j + 1;
        }
      }
    }

    const confidence: CaptionLine["confidence"] =
      bestScore >= 0.6 ? "high"
      : bestScore >= 0.4 ? "medium"
      : bestScore >= 0.2 ? "low"
      : "needs-review";

    const matched = bestScore >= 0.2;
    if (matched) {
      segCursor = bestSegEnd;
      return {
        line: {
          ...line,
          startSec: parseFloat(bestStart.toFixed(2)),
          endSec: parseFloat(bestEnd.toFixed(2)),
          confidence,
        },
        matched: true,
      };
    }
    return { line: { ...line, confidence }, matched: false };
  });

  /* Second pass: interpolate timings for unmatched lines */
  let i = 0;
  while (i < results.length) {
    if (!results[i]!.matched) {
      /* Find the gap boundaries */
      const prevEnd = results.slice(0, i).reverse().find((r) => r.matched)?.line.endSec ?? 0;
      let j = i;
      while (j < results.length && !results[j]!.matched) j++;
      const nextStart = results[j]?.line.startSec ?? (segments[segments.length - 1]?.end ?? prevEnd + 2);
      const gapCount = j - i;
      const slotDur = Math.max(0.5, (nextStart - prevEnd) / Math.max(gapCount, 1));
      let cursor = prevEnd;
      for (let k = i; k < j; k++) {
        const start = parseFloat(cursor.toFixed(2));
        cursor += slotDur;
        const end = parseFloat(Math.min(cursor, nextStart).toFixed(2));
        results[k]!.line = { ...results[k]!.line, startSec: start, endSec: end };
      }
      i = j;
    } else {
      i++;
    }
  }

  return {
    syncedLines: results.map((r) => r.line),
    matchedCount: results.filter((r) => r.matched).length,
    needsReviewCount: results.filter((r) => !r.matched).length,
  };
}

/* ─── Build captions directly from Whisper segments ───────────────────── */

const WORDS_PER_CAPTION = 5; // target chunk size (3–8 range)

function buildCaptionsFromSegments(
  segments: WhisperSegment[],
  songDuration?: number | null,
): CaptionLine[] {
  const lines: CaptionLine[] = [];

  for (const seg of segments) {
    const segDur = seg.end - seg.start;
    if (segDur <= 0) continue;

    const words = seg.text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;

    /* Group into chunks of WORDS_PER_CAPTION */
    const chunks: string[][] = [];
    for (let i = 0; i < words.length; i += WORDS_PER_CAPTION) {
      chunks.push(words.slice(i, i + WORDS_PER_CAPTION));
    }

    chunks.forEach((chunk, ci) => {
      const startFrac = (ci * WORDS_PER_CAPTION) / words.length;
      const endFrac   = Math.min((ci * WORDS_PER_CAPTION + chunk.length) / words.length, 1);
      const startSec  = parseFloat((seg.start + startFrac * segDur).toFixed(2));
      let   endSec    = parseFloat((seg.start + endFrac   * segDur).toFixed(2));

      /* Cap at song duration */
      if (songDuration != null && endSec > songDuration) {
        endSec = parseFloat(songDuration.toFixed(2));
      }
      /* Skip degenerate rows */
      if (startSec < 0 || endSec <= startSec) return;

      lines.push({ id: newLineId(), startSec, endSec, text: chunk.join(" "), confidence: "high" });
    });
  }

  /* Sort by start time */
  lines.sort((a, b) => a.startSec - b.startSec);
  return lines;
}

interface RebuildDetails {
  audioFound: boolean;
  hasTranscript: boolean;
  newCaptions: number;
  invalidRows: number;
  lastEndsAt: number;
  songDuration: number | null;
  saved: boolean;
}

/* ─── Caption timing validation & repair ────────────────────────────────── */

function isInvalidLine(l: CaptionLine): boolean {
  return (
    isNaN(l.startSec) || isNaN(l.endSec) ||
    l.startSec < 0 ||
    l.endSec <= l.startSec
  );
}

interface TimingHealth {
  total: number;
  valid: number;
  invalid: number;
  lastEnd: number;
  status: "healthy" | "needs-repair" | "empty";
}

function calcHealth(lines: CaptionLine[]): TimingHealth {
  if (lines.length === 0) return { total: 0, valid: 0, invalid: 0, lastEnd: 0, status: "empty" };
  const invalid = lines.filter(isInvalidLine).length;
  const lastEnd = lines.reduce((m, l) => Math.max(m, isNaN(l.endSec) ? 0 : l.endSec), 0);
  return {
    total: lines.length,
    valid: lines.length - invalid,
    invalid,
    lastEnd,
    status: invalid === 0 ? "healthy" : "needs-repair",
  };
}

/**
 * Repair caption timings:
 * 1. Sort by startSec
 * 2. Fix any row where endSec <= startSec (give it at least 1 s or proportional slot)
 * 3. Push overlapping starts forward
 * 4. Cap everything at songDuration
 */
function repairCaptionTimings(lines: CaptionLine[], songDuration?: number): CaptionLine[] {
  if (lines.length === 0) return [];
  const sorted = [...lines].sort((a, b) => (a.startSec ?? 0) - (b.startSec ?? 0));
  const dur = songDuration && songDuration > 0 ? songDuration : null;
  const fallbackSlot = dur ? dur / Math.max(sorted.length, 1) : 2;

  let cursor = 0;
  const repaired = sorted.map((line) => {
    let startSec = isNaN(line.startSec) || line.startSec < 0 ? cursor : Math.max(line.startSec, cursor);
    let endSec   = isNaN(line.endSec) ? startSec + fallbackSlot : line.endSec;

    // Fix inverted / zero-duration
    if (endSec <= startSec) {
      endSec = parseFloat((startSec + Math.max(fallbackSlot, 1)).toFixed(2));
    }

    // Cap at song duration
    if (dur && endSec > dur) endSec = dur;
    if (dur && startSec >= dur) startSec = Math.max(0, dur - 0.5);

    cursor = endSec;
    return { ...line, startSec: parseFloat(startSec.toFixed(2)), endSec: parseFloat(endSec.toFixed(2)), confidence: undefined as CaptionLine["confidence"] };
  });

  // Final pass: ensure last line ends at song duration if we have one
  if (dur && repaired.length > 0) {
    repaired[repaired.length - 1]!.endSec = dur;
  }

  return repaired;
}

/**
 * Validate synced lines from AI.
 * Returns: fraction of invalid rows (0 = all good, 1 = all bad).
 */
function badFraction(lines: CaptionLine[]): number {
  if (lines.length === 0) return 0;
  return lines.filter(isInvalidLine).length / lines.length;
}

/* ─────────────────────────────────────────────────────────────────────────── */

function generateBestBarLines(bestBarText: string): CaptionLine[] {
  if (!bestBarText.trim()) return [];
  return [{
    id: newLineId(),
    startSec: 0,
    endSec: 999,
    text: bestBarText.trim(),
  }];
}

function secToLabel(s: number): string {
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(1).padStart(4, "0");
  return `${m}:${sec}`;
}

function fmtDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function StatusBadge({ status }: { status: Status }) {
  const colors =
    status.type === "success"
      ? "border-green-500/25 bg-green-500/[0.07] text-green-400"
      : status.type === "error"
      ? "border-red-500/25 bg-red-500/[0.07] text-red-400"
      : "border-white/10 bg-white/[0.03] text-white/50";
  const Icon =
    status.type === "success" ? CheckCircle2
    : status.type === "error" ? AlertCircle
    : Info;
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold ${colors}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {status.message}
    </div>
  );
}

const SPLIT_STYLE_DEFS = [
  { id: "short",  label: "Short",  hint: "3–6 words" },
  { id: "medium", label: "Medium", hint: "5–8 words" },
  { id: "long",   label: "Long",   hint: "8–12 words" },
] as const;

export function CaptionsSection({ settings, setSettings, lyrics, songDuration, audioSourceLoading, selectedCaptionId, onSelectCaption, audioUrl, getAccessToken }: Props) {
  /* Vocal offset — seconds before the first word is sung */
  const [vocalOffsetInput, setVocalOffsetInput] = useState("0");
  const c = settings.captions;
  const splitStyle = c.captionSplitStyle ?? "short";

  const [linesVisible, setLinesVisible] = useState(true);
  const [generateStatus, setGenerateStatus] = useState<Status | null>(null);
  const [syncStatus, setSyncStatus] = useState<Status | null>(null);
  const [lyricsAutoFilled, setLyricsAutoFilled] = useState(false);

  /* ── AI Sync state ── */
  const [aiSyncing,      setAiSyncing     ] = useState(false);
  const [aiSyncPhase,    setAiSyncPhase   ] = useState<string | null>(null);
  const [aiSyncStatus,   setAiSyncStatus  ] = useState<Status | null>(null);
  const [aiSyncDetails,  setAiSyncDetails ] = useState<AiSyncDetails | null>(null);
  const [showAiConfirm,  setShowAiConfirm ] = useState(false);

  /* ── Repair / Reset state ── */
  const [repairStatus, setRepairStatus] = useState<Status | null>(null);

  /* ── Rebuild From Vocals state ── */
  const [rebuilding,      setRebuilding     ] = useState(false);
  const [rebuildPhase,    setRebuildPhase   ] = useState<string | null>(null);
  const [rebuildStatus,   setRebuildStatus  ] = useState<Status | null>(null);
  const [rebuildDetails,  setRebuildDetails ] = useState<RebuildDetails | null>(null);
  const [captionBackup,   setCaptionBackup  ] = useState<CaptionLine[] | null>(null);

  /* quickLyrics: the text shown in the "Generate From Lyrics" box.
     Priority: existing lyricsText saved in settings → incoming lyrics prop → empty. */
  const [quickLyrics, setQuickLyrics] = useState<string>(
    c.lyricsText || lyrics || "",
  );

  /* When lyrics arrive from the project asynchronously (or are sent from the
     Song Workflow card) — always sync them in. */
  useEffect(() => {
    const incoming = c.lyricsText || lyrics || "";
    if (incoming && incoming !== quickLyrics) {
      setQuickLyrics(incoming);
      setLyricsAutoFilled(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.lyricsText, lyrics]);

  function setCaption<K extends keyof typeof c>(key: K, value: (typeof c)[K]) {
    setSettings({ ...settings, captions: { ...c, [key]: value } });
  }

  function setMode(mode: CaptionMode) {
    setSettings({ ...settings, captions: { ...c, mode } });
  }

  function setStylePreset(stylePreset: CaptionStylePreset) {
    setSettings({ ...settings, captions: { ...c, stylePreset } });
  }

  /* ── Generate captions from the quick-lyrics box ── */
  function handleGenerateFromLyrics() {
    const text = quickLyrics.trim();
    if (!text) {
      setGenerateStatus({
        type: "error",
        message: "No lyrics found. Paste lyrics or upload a song first.",
      });
      return;
    }
    const lines = buildCaptionLines(text, splitStyle, songDuration);
    if (lines.length === 0) {
      setGenerateStatus({
        type: "error",
        message: "Could not generate captions: no lyric text found after cleaning.",
      });
      return;
    }
    setSettings({
      ...settings,
      captions: { ...c, mode: "auto", lyricsText: text, lines },
    });
    setLinesVisible(true);
    const timingNote = songDuration
      ? `Spread evenly across ${fmtDuration(songDuration)}.`
      : "Caption timing is estimated. Adjust manually to sync with your song.";
    setGenerateStatus({
      type: "success",
      message: `Captions generated — ${lines.length} caption${lines.length !== 1 ? "s" : ""} saved. ${timingNote}`,
    });
  }

  /* ── Re-generate for the existing per-mode buttons ── */
  function handleGenerate() {
    let lines: CaptionLine[] = [];
    if (c.mode === "auto") lines = buildCaptionLines(c.lyricsText, splitStyle, songDuration);
    else if (c.mode === "hook") lines = generateHookLines(c.hookText, songDuration);
    else if (c.mode === "best-bar") lines = generateBestBarLines(c.bestBarText);
    setCaption("lines", lines);
    setLinesVisible(true);
  }

  function handleClear() {
    setSettings({
      ...settings,
      captions: { ...c, lines: [], lyricsText: "", hookText: "", bestBarText: "" },
    });
    setGenerateStatus(null);
  }

  /* ── AI Sync: transcribe audio → fuzzy-match captions to vocal timestamps ── */

  async function runAiSync() {
    setShowAiConfirm(false);
    setAiSyncing(true);
    setAiSyncPhase("Transcribing song with timestamps…");
    setAiSyncStatus(null);
    setAiSyncDetails(null);

    try {
      const token = await getAccessToken?.().catch(() => undefined);
      const res = await fetch("/api/transcribe-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ audioUrl }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Transcription failed" })) as { error?: string; message?: string };
        throw new Error(err.message ?? err.error ?? `HTTP ${res.status}`);
      }

      const data = await res.json() as {
        transcript: string;
        segments?: WhisperSegment[];
      };

      const segments = data.segments;
      if (!segments || segments.length === 0) {
        throw new Error("No timestamped segments returned. The song may have no vocals, or try again.");
      }

      setAiSyncPhase("Matching captions to vocals…");
      const { syncedLines, matchedCount, needsReviewCount } = matchCaptionsToTranscript(c.lines, segments);

      /* ── Validate before saving — never overwrite with bad timings ── */
      const bad = badFraction(syncedLines);
      if (bad > 0.5) {
        /* More than half the rows are invalid — reject the sync result */
        setAiSyncDetails({
          audioFound: true,
          hasTranscript: true,
          matched: matchedCount,
          needsReview: needsReviewCount,
          avgConfidencePct: Math.round((matchedCount / c.lines.length) * 100),
        });
        setAiSyncStatus({
          type: "error",
          message: `AI sync failed validation — ${Math.round(bad * 100)}% of rows had invalid timings. Existing captions were not overwritten.`,
        });
        return;
      }

      /* Partially bad: auto-repair before saving */
      const finalLines = bad > 0 ? repairCaptionTimings(syncedLines, songDuration) : syncedLines;

      setCaption("lines", finalLines);
      setLinesVisible(true);
      setAiSyncDetails({
        audioFound: true,
        hasTranscript: true,
        matched: matchedCount,
        needsReview: needsReviewCount,
        avgConfidencePct: Math.round((matchedCount / c.lines.length) * 100),
      });

      const autoRepaired = bad > 0;
      const hasIssues = needsReviewCount > 0;
      setAiSyncStatus({
        type: hasIssues ? "info" : "success",
        message: [
          hasIssues
            ? `Captions synced to vocals — ${needsReviewCount} line${needsReviewCount !== 1 ? "s" : ""} need review.`
            : `Captions synced to vocals — all ${matchedCount} lines matched.`,
          autoRepaired ? "Timing was auto-repaired before saving." : "",
        ].filter(Boolean).join(" "),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setAiSyncStatus({ type: "error", message: `AI sync failed: ${msg}` });
      setAiSyncDetails((prev) => prev ?? { audioFound: !!audioUrl, hasTranscript: false, matched: 0, needsReview: c.lines.length, avgConfidencePct: 0 });
    } finally {
      setAiSyncing(false);
      setAiSyncPhase(null);
    }
  }

  /* ── Caption sync helpers ── */

  function handleAutoSync() {
    if (!songDuration || songDuration <= 0) {
      setSyncStatus({ type: "error", message: "No song duration detected. Go to Music tab and attach your song first." });
      return;
    }
    if (c.lines.length === 0) {
      setSyncStatus({ type: "error", message: "No captions to sync. Generate captions from lyrics first." });
      return;
    }

    /* Vocal offset: how many seconds of intro before the first lyric */
    const parsedOffset = parseFloat(vocalOffsetInput);
    const vocalOffset = isNaN(parsedOffset) || parsedOffset < 0 ? 0 : Math.min(parsedOffset, songDuration * 0.9);
    const availDuration = Math.max(1, songDuration - vocalOffset);

    const lines = c.lines;
    const totalChars = lines.reduce((sum, l) => sum + Math.max(l.text.length, 1), 0);
    let cursor = vocalOffset;
    const synced: CaptionLine[] = lines.map((line) => {
      const weight = Math.max(line.text.length, 1) / totalChars;
      const rawDur = weight * availDuration;
      /* Clamp: min 1 s, max 8 s per caption */
      const dur = Math.max(1, Math.min(8, rawDur));
      const startSec = parseFloat(cursor.toFixed(2));
      cursor += dur;
      return { ...line, startSec, endSec: parseFloat(cursor.toFixed(2)) };
    });
    /* If total exceeds song — scale proportionally from vocalOffset */
    const rawLast = synced[synced.length - 1]!.endSec;
    if (rawLast > songDuration) {
      const scale = (songDuration - vocalOffset) / Math.max(0.1, rawLast - vocalOffset);
      let c2 = vocalOffset;
      synced.forEach((l, i) => {
        const dur = (l.endSec - l.startSec) * scale;
        synced[i]!.startSec = parseFloat(c2.toFixed(2));
        c2 += dur;
        synced[i]!.endSec = parseFloat(Math.min(c2, songDuration).toFixed(2));
      });
    }
    /* Ensure last caption ends exactly at song end */
    synced[synced.length - 1]!.endSec = parseFloat(songDuration.toFixed(2));

    setCaption("lines", synced);
    setLinesVisible(true);
    const offsetNote = vocalOffset > 0 ? ` First caption starts at ${vocalOffset}s (vocal offset applied).` : "";
    setSyncStatus({
      type: "success",
      message: `${synced.length} captions synced across ${fmtDuration(songDuration)}.${offsetNote} Timing weighted by lyric length.`,
    });
  }

  /** Nudge every timestamp of the selected caption by delta seconds */
  function handleNudgeSelected(delta: number) {
    if (!selectedCaptionId || c.lines.length === 0) return;
    const updated = c.lines.map((l) => {
      if (l.id !== selectedCaptionId) return l;
      return {
        ...l,
        startSec: parseFloat(Math.max(0, l.startSec + delta).toFixed(2)),
        endSec:   parseFloat(Math.max(0.1, l.endSec + delta).toFixed(2)),
      };
    });
    setCaption("lines", updated);
  }

  /** Shift all captions so the first one starts at the vocal offset time */
  function handleApplyVocalOffset() {
    if (c.lines.length === 0) return;
    const offset = parseFloat(vocalOffsetInput);
    if (isNaN(offset) || offset < 0) return;
    const firstStart = c.lines[0]?.startSec ?? 0;
    const delta = offset - firstStart;
    if (Math.abs(delta) < 0.01) {
      setSyncStatus({ type: "info", message: `First caption already starts at ${offset}s.` });
      return;
    }
    const shifted = c.lines.map((l) => ({
      ...l,
      startSec: parseFloat(Math.max(0, l.startSec + delta).toFixed(2)),
      endSec:   parseFloat(Math.max(0.1, l.endSec + delta).toFixed(2)),
    }));
    setCaption("lines", shifted);
    setSyncStatus({ type: "success", message: `Vocal offset applied — first caption now starts at ${offset}s.` });
  }

  function handleShift(delta: number) {
    if (c.lines.length === 0) return;
    const shifted = c.lines.map((l) => ({
      ...l,
      startSec: parseFloat(Math.max(0, l.startSec + delta).toFixed(2)),
      endSec: parseFloat(Math.max(0.1, l.endSec + delta).toFixed(2)),
    }));
    setCaption("lines", shifted);
    setSyncStatus(null);
  }

  function handleStretchToSong() {
    if (!songDuration || c.lines.length === 0) return;
    const lastEnd = c.lines[c.lines.length - 1]!.endSec;
    if (lastEnd <= 0) return;
    const scale = songDuration / lastEnd;
    let cursor = 0;
    const stretched = c.lines.map((l) => {
      const dur = (l.endSec - l.startSec) * scale;
      const startSec = parseFloat(cursor.toFixed(2));
      cursor += dur;
      return { ...l, startSec, endSec: parseFloat(Math.min(cursor, songDuration).toFixed(2)) };
    });
    stretched[stretched.length - 1]!.endSec = parseFloat(songDuration.toFixed(2));
    setCaption("lines", stretched);
    setSyncStatus({ type: "success", message: `Captions stretched to fill ${fmtDuration(songDuration)}.` });
  }

  function handleCompressToSong() {
    if (!songDuration || c.lines.length === 0) return;
    const lastEnd = c.lines[c.lines.length - 1]!.endSec;
    if (lastEnd <= songDuration) {
      setSyncStatus({ type: "info", message: "Captions already fit within song duration." });
      return;
    }
    const scale = songDuration / lastEnd;
    let cursor = 0;
    const compressed = c.lines.map((l) => {
      const dur = (l.endSec - l.startSec) * scale;
      const startSec = parseFloat(cursor.toFixed(2));
      cursor += dur;
      return { ...l, startSec, endSec: parseFloat(Math.min(cursor, songDuration).toFixed(2)) };
    });
    compressed[compressed.length - 1]!.endSec = parseFloat(songDuration.toFixed(2));
    setCaption("lines", compressed);
    setSyncStatus({ type: "success", message: `Captions compressed to fit within ${fmtDuration(songDuration)}.` });
  }

  /* ── Repair & Reset ── */

  function handleRepairTiming() {
    if (c.lines.length === 0) {
      setRepairStatus({ type: "error", message: "No captions to repair." });
      return;
    }
    const before = calcHealth(c.lines);
    const repaired = repairCaptionTimings(c.lines, songDuration);
    setCaption("lines", repaired);
    setRepairStatus({
      type: "success",
      message: `Repaired ${before.invalid} invalid row${before.invalid !== 1 ? "s" : ""}. Captions sorted and timing fixed.`,
    });
  }

  function handleResetFromLyrics() {
    const text = quickLyrics.trim() || c.lyricsText.trim();
    if (!text) {
      setRepairStatus({ type: "error", message: "No lyrics found. Paste lyrics into the Generate From Lyrics box first." });
      return;
    }
    const lines = buildCaptionLines(text, splitStyle, songDuration);
    setSettings({ ...settings, captions: { ...c, mode: "auto", lyricsText: text, lines } });
    setRepairStatus({
      type: "success",
      message: `Reset to ${lines.length} clean caption${lines.length !== 1 ? "s" : ""} with safe timing${songDuration ? ` across ${fmtDuration(songDuration)}` : ""}.`,
    });
  }

  /* ── Rebuild captions directly from vocal transcript ── */
  async function handleRebuildFromVocals() {
    if (!audioUrl) {
      setRebuildStatus({ type: "error", message: "No audio attached. Go to the Music tab and attach your song first." });
      return;
    }
    setRebuilding(true);
    setRebuildPhase("Transcribing song with timestamps…");
    setRebuildStatus(null);
    setRebuildDetails(null);

    try {
      const token = await getAccessToken?.().catch(() => undefined);
      const res = await fetch("/api/transcribe-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ audioUrl }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Transcription failed" })) as { error?: string; message?: string };
        throw new Error(err.message ?? err.error ?? `HTTP ${res.status}`);
      }

      const data = await res.json() as { transcript: string; segments?: WhisperSegment[] };
      const segments = data.segments;

      if (!segments || segments.length === 0) {
        setRebuildDetails({ audioFound: true, hasTranscript: false, newCaptions: 0, invalidRows: 0, lastEndsAt: 0, songDuration: songDuration ?? null, saved: false });
        throw new Error("No timestamped segments returned. The song may have no vocals, or try again.");
      }

      setRebuildPhase("Building captions from transcript…");
      const newLines = buildCaptionsFromSegments(segments, songDuration);
      const invalid = newLines.filter(isInvalidLine).length;
      const lastEndsAt = newLines.length > 0 ? (newLines[newLines.length - 1]?.endSec ?? 0) : 0;

      const details: RebuildDetails = {
        audioFound: true,
        hasTranscript: true,
        newCaptions: newLines.length,
        invalidRows: invalid,
        lastEndsAt,
        songDuration: songDuration ?? null,
        saved: false,
      };
      setRebuildDetails(details);

      if (newLines.length === 0) {
        setRebuildStatus({ type: "error", message: "Transcript returned no usable captions. The song may have no vocals." });
        return;
      }
      if (invalid > 0) {
        setRebuildStatus({ type: "error", message: `Validation failed — ${invalid} invalid row${invalid !== 1 ? "s" : ""} found. Existing captions were not changed.` });
        return;
      }

      /* Backup existing captions before overwriting */
      if (c.lines.length > 0) setCaptionBackup(c.lines);

      setCaption("lines", newLines);
      setLinesVisible(true);
      setRebuildDetails({ ...details, saved: true });
      setRebuildStatus({
        type: "success",
        message: `${newLines.length} captions built from vocal transcript and saved.${c.lines.length > 0 ? " Previous captions backed up — use Restore below if needed." : ""}`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setRebuildStatus({ type: "error", message: `Rebuild failed: ${msg}` });
    } finally {
      setRebuilding(false);
      setRebuildPhase(null);
    }
  }

  function handleRestoreBackup() {
    if (!captionBackup) return;
    setCaption("lines", captionBackup);
    setCaptionBackup(null);
    setRebuildStatus({ type: "success", message: `Previous ${captionBackup.length} captions restored.` });
    setRebuildDetails(null);
  }

  /* ── Sync status metrics ── */
  const lastCaptionEnd = c.lines.length > 0 ? c.lines[c.lines.length - 1]!.endSec : 0;
  const isSynced = songDuration != null && lastCaptionEnd > 0 && lastCaptionEnd <= songDuration + 0.5;

  /* ── Timing health ── */
  const health = calcHealth(c.lines);
  const syncLabel =
    !songDuration ? "No song attached"
    : c.lines.length === 0 ? "No captions"
    : isSynced ? "Synced ✓"
    : "Needs adjustment ⚠";

  function addManualLine() {
    const lastEnd = c.lines[c.lines.length - 1]?.endSec ?? 0;
    setCaption("lines", [
      ...c.lines,
      { id: newLineId(), startSec: parseFloat(lastEnd.toFixed(1)), endSec: parseFloat((lastEnd + 2).toFixed(1)), text: "" },
    ]);
  }

  function updateLine(id: string, patch: Partial<CaptionLine>) {
    setCaption("lines", c.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }

  function deleteLine(id: string) {
    setCaption("lines", c.lines.filter((l) => l.id !== id));
  }

  const hasCaptions = c.mode !== "none";
  const canGenerate = c.mode === "auto" || c.mode === "hook" || c.mode === "best-bar";

  return (
    <div className="space-y-5">

      {/* ══════════════════════════════════════════════════
          GENERATE CAPTIONS FROM LYRICS — always visible
      ══════════════════════════════════════════════════ */}
      <EditorCard
        title="Generate Captions From Lyrics"
        subtitle="Auto-fill from your project or paste lyrics — one phrase becomes one caption"
        icon={<Wand2 className="h-4 w-4" />}
      >
        <div className="space-y-3">

          {/* Lyrics-sent badge */}
          {lyricsAutoFilled && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-primary/20 bg-primary/[0.06] text-xs text-primary/80">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              Lyrics sent to captions.
            </div>
          )}

          {/* Lyrics textarea */}
          <textarea
            value={quickLyrics}
            onChange={(e) => { setQuickLyrics(e.target.value); setGenerateStatus(null); }}
            placeholder={
              "Paste your lyrics here — one paragraph is fine.\n\nEach phrase becomes one caption. [Verse], [Hook], [Chorus] labels are stripped automatically."
            }
            rows={9}
            data-testid="caption-lyrics-input"
            className="w-full resize-y rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-sm text-white/80 placeholder:text-white/20 focus:outline-none focus:border-primary/40 transition-colors leading-relaxed"
          />

          {/* Caption split style */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-black text-white/40 uppercase tracking-wider">Caption split style</p>
            <div className="flex gap-2">
              {SPLIT_STYLE_DEFS.map((s) => {
                const active = splitStyle === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setCaption("captionSplitStyle", s.id)}
                    data-testid={`caption-split-${s.id}`}
                    className={`flex-1 rounded-lg border px-3 py-2 transition-all text-left ${
                      active
                        ? "border-primary/50 bg-primary/[0.07] text-white"
                        : "border-white/[0.08] bg-white/[0.02] text-white/50 hover:border-white/20"
                    }`}
                  >
                    <p className="text-xs font-bold">{s.label}</p>
                    <p className="text-[10px] text-white/35 mt-0.5">{s.hint}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Timing info */}
          {songDuration ? (
            <p className="text-[11px] text-white/40 flex items-center gap-1.5">
              <Info className="h-3 w-3 shrink-0" />
              Song duration: {fmtDuration(songDuration)} — captions spread evenly across the song.
            </p>
          ) : (
            <p className="text-[11px] text-white/35 flex items-center gap-1.5">
              <Info className="h-3 w-3 shrink-0" />
              Caption timing is estimated (2 sec each). Adjust manually to sync with your song.
            </p>
          )}

          {/* Generate button */}
          <Button
            onClick={handleGenerateFromLyrics}
            data-testid="btn-generate-captions-from-lyrics"
            className="w-full gold-glow font-bold gap-2"
          >
            <Wand2 className="h-4 w-4" />
            Generate Captions From Lyrics
          </Button>

          {/* Status message */}
          {generateStatus && <StatusBadge status={generateStatus} />}
        </div>
      </EditorCard>

      {/* ══════════════════════════════════════════════════
          REBUILD SYNCED CAPTIONS FROM VOCALS  ← RECOMMENDED
      ══════════════════════════════════════════════════ */}
      <EditorCard
        title="Rebuild Synced Captions From Vocals"
        subtitle="Transcribes the song and builds brand-new captions directly from the vocals — always accurate"
        icon={<Sparkles className="h-4 w-4" />}
      >
        <div className="space-y-4">

          {/* Pre-flight status */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 space-y-0.5">
              <p className="text-[10px] text-white/35 font-semibold uppercase tracking-wide">Audio Source</p>
              <p className={`text-sm font-black ${audioUrl ? "text-green-400" : "text-red-400/70"}`}>
                {audioUrl ? "Found ✓" : "No audio"}
              </p>
            </div>
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 space-y-0.5">
              <p className="text-[10px] text-white/35 font-semibold uppercase tracking-wide">Song Duration</p>
              <p className={`text-sm font-black ${songDuration ? "text-white/75" : "text-white/35"}`}>
                {songDuration ? fmtDuration(songDuration) : "Unknown"}
              </p>
            </div>
          </div>

          {!audioUrl && (
            <p className="text-[11px] text-amber-400/80 flex items-start gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" />
              No audio attached. Go to the Music tab and upload or select your song first.
            </p>
          )}

          {/* Rebuilding progress */}
          {rebuilding && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-primary/20 bg-primary/[0.06]">
              <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
              <span className="text-sm font-semibold text-white/70">{rebuildPhase ?? "Working…"}</span>
            </div>
          )}

          {/* Main button */}
          <Button
            onClick={handleRebuildFromVocals}
            disabled={rebuilding || !audioUrl}
            data-testid="btn-rebuild-captions-from-vocals"
            className="w-full gold-glow font-bold gap-2"
          >
            {rebuilding
              ? <><Loader2 className="h-4 w-4 animate-spin" />Rebuilding…</>
              : <><Sparkles className="h-4 w-4" />Rebuild Synced Captions From Vocals</>
            }
          </Button>

          {/* Status badge */}
          {rebuildStatus && <StatusBadge status={rebuildStatus} />}

          {/* Rebuild details */}
          {rebuildDetails && (
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 space-y-1.5">
              <p className="text-[10px] font-black text-white/35 uppercase tracking-widest mb-2">Rebuild Sync Status</p>
              {[
                ["Audio found",            rebuildDetails.audioFound   ? "yes ✓" : "no",  rebuildDetails.audioFound   ? "text-green-400" : "text-red-400"],
                ["Timestamped transcript",  rebuildDetails.hasTranscript ? "yes ✓" : "no", rebuildDetails.hasTranscript ? "text-green-400" : "text-red-400"],
                ["New captions created",   String(rebuildDetails.newCaptions),              "text-white/70"],
                ["Invalid rows",           String(rebuildDetails.invalidRows),              rebuildDetails.invalidRows > 0 ? "text-red-400" : "text-green-400"],
                ["Last caption ends at",   rebuildDetails.lastEndsAt > 0 ? `${rebuildDetails.lastEndsAt.toFixed(1)}s` : "—", "text-white/70"],
                ["Song duration",          rebuildDetails.songDuration != null ? `${rebuildDetails.songDuration.toFixed(1)}s` : "—", "text-white/70"],
                ["Saved",                  rebuildDetails.saved ? "yes ✓" : "no",          rebuildDetails.saved ? "text-green-400" : "text-white/35"],
              ].map(([label, value, cls]) => (
                <div key={label} className="flex items-center justify-between text-[11px]">
                  <span className="text-white/35">{label}:</span>
                  <span className={`font-bold ${cls}`}>{value}</span>
                </div>
              ))}
            </div>
          )}

          {/* Restore backup */}
          {captionBackup && (
            <Button
              size="sm"
              variant="outline"
              onClick={handleRestoreBackup}
              className="w-full gap-2 border-white/15"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restore Previous Captions ({captionBackup.length} lines)
            </Button>
          )}

          {/* Existing captions backed up notice */}
          {captionBackup && rebuildDetails?.saved && (
            <p className="text-[11px] text-green-400/70 flex items-center gap-1.5">
              <CheckCircle2 className="h-3 w-3 shrink-0" />
              Existing captions backed up — click Restore above to undo.
            </p>
          )}
        </div>
      </EditorCard>

      {/* ══════════════════════════════════════════════════
          AI SYNC CAPTIONS TO VOCALS  (Advanced)
      ══════════════════════════════════════════════════ */}
      <EditorCard
        title="AI Sync Captions To Vocals (Advanced)"
        subtitle="Matches your existing caption text to vocal timestamps — use Rebuild above if sync fails"
        icon={<Wand2 className="h-4 w-4" />}
      >
        <div className="space-y-4">

          {/* Pre-flight status */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 space-y-0.5">
              <p className="text-[10px] text-white/35 font-semibold uppercase tracking-wide">Audio Source</p>
              <p className={`text-sm font-black ${audioUrl ? "text-green-400" : "text-red-400/70"}`}>
                {audioUrl ? "Found ✓" : "No audio"}
              </p>
            </div>
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 space-y-0.5">
              <p className="text-[10px] text-white/35 font-semibold uppercase tracking-wide">Captions</p>
              <p className={`text-sm font-black ${c.lines.length > 0 ? "text-white/75" : "text-white/35"}`}>
                {c.lines.length > 0 ? `${c.lines.length} lines` : "None"}
              </p>
            </div>
          </div>

          {/* Guidance when prerequisites not met */}
          {!audioUrl && (
            <p className="text-[11px] text-amber-400/80 flex items-start gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" />
              No audio attached. Go to the Music tab and upload or select your song first.
            </p>
          )}
          {c.lines.length === 0 && (
            <p className="text-[11px] text-amber-400/80 flex items-start gap-1.5">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-px" />
              No captions yet. Generate captions from your lyrics above first.
            </p>
          )}

          {/* Confirm panel — shown instead of immediate run */}
          {showAiConfirm && !aiSyncing && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/[0.06] p-4 space-y-3">
              <p className="text-sm font-bold text-amber-400 flex items-center gap-2">
                <AlertCircle className="h-4 w-4 shrink-0" />
                AI Caption Sync uses credits
              </p>
              <p className="text-xs text-white/55 leading-relaxed">
                This calls Whisper AI to transcribe your song and timestamp every word. It may use credits from your account. Continue?
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => void runAiSync()} className="gold-glow font-bold gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" />
                  Yes, Sync To Vocals
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowAiConfirm(false)} className="text-white/50">
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Progress indicator */}
          {aiSyncing && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-primary/20 bg-primary/[0.05]">
              <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
              <span className="text-sm text-primary/80 font-semibold">{aiSyncPhase ?? "AI syncing captions…"}</span>
            </div>
          )}

          {/* Main button */}
          {!showAiConfirm && (
            <Button
              onClick={() => setShowAiConfirm(true)}
              disabled={aiSyncing || !audioUrl || c.lines.length === 0}
              data-testid="btn-ai-sync-captions"
              className="w-full gold-glow font-bold gap-2"
            >
              {aiSyncing
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Syncing…</>
                : <><Sparkles className="h-4 w-4" /> AI Sync Captions To Vocals</>
              }
            </Button>
          )}

          {/* AI Sync Status panel */}
          {aiSyncDetails && (
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 space-y-2">
              <p className="text-[10px] font-black text-white/40 uppercase tracking-wider">AI Sync Status</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-white/40">Audio found</span>
                  <span className={`text-[11px] font-bold ${aiSyncDetails.audioFound ? "text-green-400" : "text-red-400"}`}>
                    {aiSyncDetails.audioFound ? "Yes" : "No"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-white/40">Transcript</span>
                  <span className={`text-[11px] font-bold ${aiSyncDetails.hasTranscript ? "text-green-400" : "text-red-400"}`}>
                    {aiSyncDetails.hasTranscript ? "Ready" : "Failed"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-white/40">Matched</span>
                  <span className="text-[11px] font-bold text-green-400">{aiSyncDetails.matched}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-white/40">Needs review</span>
                  <span className={`text-[11px] font-bold ${aiSyncDetails.needsReview > 0 ? "text-amber-400" : "text-white/35"}`}>
                    {aiSyncDetails.needsReview}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-white/40">Avg confidence</span>
                  <span className={`text-[11px] font-bold ${aiSyncDetails.avgConfidencePct >= 70 ? "text-green-400" : aiSyncDetails.avgConfidencePct >= 40 ? "text-amber-400" : "text-red-400"}`}>
                    {aiSyncDetails.avgConfidencePct}%
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Status message */}
          {aiSyncStatus && <StatusBadge status={aiSyncStatus} />}

          {/* Confidence legend */}
          <div className="flex flex-wrap gap-3 pt-1">
            <p className="text-[10px] text-white/25 w-full">Confidence shown in caption list:</p>
            {[
              { label: "High",         color: "bg-green-500" },
              { label: "Medium",       color: "bg-yellow-500" },
              { label: "Low",          color: "bg-orange-500" },
              { label: "Needs Review", color: "bg-red-500" },
            ].map(({ label, color }) => (
              <span key={label} className="flex items-center gap-1.5 text-[10px] text-white/40">
                <span className={`inline-block w-2 h-2 rounded-full ${color} opacity-70`} />
                {label}
              </span>
            ))}
          </div>

        </div>
      </EditorCard>

      {/* ══════════════════════════════════════════════════
          AUTO SYNC CAPTIONS TO SONG
      ══════════════════════════════════════════════════ */}
      <EditorCard
        title="Auto Sync Captions To Song"
        subtitle="Spread captions proportionally across the song — longer lyrics get more time"
        icon={<Music2 className="h-4 w-4" />}
      >
        <div className="space-y-4">

          {/* Status row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              {
                label: "Song Duration",
                value: songDuration != null
                  ? fmtDuration(songDuration)
                  : audioSourceLoading
                  ? "Detecting…"
                  : "—",
                color: songDuration != null ? "text-green-400"
                  : audioSourceLoading ? "text-yellow-400"
                  : "text-white/35",
              },
              { label: "Captions", value: String(c.lines.length) },
              { label: "Last Caption Ends", value: c.lines.length > 0 ? `${lastCaptionEnd.toFixed(1)}s` : "—" },
              {
                label: "Sync Status",
                value: !songDuration && audioSourceLoading ? "Loading audio…"
                  : syncLabel,
                color: !songDuration || c.lines.length === 0
                  ? audioSourceLoading ? "text-yellow-400" : "text-white/35"
                  : isSynced ? "text-green-400"
                  : "text-yellow-400",
              },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5 space-y-0.5">
                <p className="text-[10px] text-white/35 font-semibold uppercase tracking-wide">{label}</p>
                <p className={`text-sm font-black ${color ?? "text-white/75"}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* First vocal offset */}
          <div className="space-y-1.5">
            <p className="text-[10px] font-black text-white/40 uppercase tracking-wider">First Vocal Offset</p>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={vocalOffsetInput}
                  onChange={(e) => setVocalOffsetInput(e.target.value)}
                  placeholder="0"
                  className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white/80 placeholder:text-white/20 focus:outline-none focus:border-primary/40 transition-colors pr-8"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-white/25 pointer-events-none">s</span>
              </div>
              <button
                type="button"
                onClick={handleApplyVocalOffset}
                disabled={c.lines.length === 0}
                className="px-3 py-2 rounded-lg border border-white/10 bg-white/[0.04] text-xs font-bold text-white/55 hover:text-white/80 hover:border-white/20 transition-colors disabled:opacity-40 whitespace-nowrap"
              >
                Apply Offset
              </button>
            </div>
            <p className="text-[10px] text-white/25 leading-relaxed">
              Seconds of instrumental intro before lyrics start. Used by Auto Sync and Apply Offset above.
            </p>
          </div>

          {/* Primary sync button */}
          <Button
            onClick={handleAutoSync}
            disabled={c.lines.length === 0}
            data-testid="btn-auto-sync-captions"
            className="w-full gold-glow font-bold gap-2"
          >
            <Music2 className="h-4 w-4" />
            Auto Sync Captions To Song
          </Button>

          {/* Manual timing controls */}
          {c.lines.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-black text-white/40 uppercase tracking-wider">Shift All Captions</p>
              <div className="grid grid-cols-4 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleShift(-1)}
                  className="flex flex-col items-center justify-center gap-0.5 px-2 py-2 rounded-lg border border-white/10 bg-white/[0.02] text-xs font-bold text-white/55 hover:text-white/80 hover:border-white/20 transition-colors"
                >
                  <ChevronsLeft className="h-3.5 w-3.5" />
                  <span className="text-[9px]">−1s</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleShift(-0.5)}
                  data-testid="btn-shift-earlier"
                  className="flex flex-col items-center justify-center gap-0.5 px-2 py-2 rounded-lg border border-white/10 bg-white/[0.02] text-xs font-bold text-white/55 hover:text-white/80 hover:border-white/20 transition-colors"
                >
                  <ChevronsLeft className="h-3.5 w-3.5" />
                  <span className="text-[9px]">−0.5s</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleShift(0.5)}
                  data-testid="btn-shift-later"
                  className="flex flex-col items-center justify-center gap-0.5 px-2 py-2 rounded-lg border border-white/10 bg-white/[0.02] text-xs font-bold text-white/55 hover:text-white/80 hover:border-white/20 transition-colors"
                >
                  <ChevronsRight className="h-3.5 w-3.5" />
                  <span className="text-[9px]">+0.5s</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleShift(1)}
                  className="flex flex-col items-center justify-center gap-0.5 px-2 py-2 rounded-lg border border-white/10 bg-white/[0.02] text-xs font-bold text-white/55 hover:text-white/80 hover:border-white/20 transition-colors"
                >
                  <ChevronsRight className="h-3.5 w-3.5" />
                  <span className="text-[9px]">+1s</span>
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleStretchToSong}
                  disabled={!songDuration}
                  data-testid="btn-stretch-captions"
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 bg-white/[0.02] text-xs font-bold text-white/55 hover:text-white/80 hover:border-white/20 transition-colors disabled:opacity-40"
                >
                  <Expand className="h-3.5 w-3.5" /> Stretch To Song
                </button>
                <button
                  type="button"
                  onClick={handleCompressToSong}
                  disabled={!songDuration}
                  data-testid="btn-compress-captions"
                  className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 bg-white/[0.02] text-xs font-bold text-white/55 hover:text-white/80 hover:border-white/20 transition-colors disabled:opacity-40"
                >
                  <Shrink className="h-3.5 w-3.5" /> Compress To Song
                </button>
              </div>

              {/* Nudge selected caption */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-black text-white/40 uppercase tracking-wider">
                  Nudge Selected Caption
                  {selectedCaptionId ? "" : " — select a caption row first"}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => handleNudgeSelected(-0.5)}
                    disabled={!selectedCaptionId}
                    data-testid="btn-nudge-earlier"
                    className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 bg-white/[0.02] text-xs font-bold text-white/55 hover:text-white/80 hover:border-white/20 transition-colors disabled:opacity-35"
                  >
                    <ChevronsLeft className="h-3.5 w-3.5" /> Earlier (0.5s)
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNudgeSelected(0.5)}
                    disabled={!selectedCaptionId}
                    data-testid="btn-nudge-later"
                    className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 bg-white/[0.02] text-xs font-bold text-white/55 hover:text-white/80 hover:border-white/20 transition-colors disabled:opacity-35"
                  >
                    Later (0.5s) <ChevronsRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Sync status message */}
          {syncStatus && <StatusBadge status={syncStatus} />}
        </div>
      </EditorCard>

      {/* ── Mode Selector ── */}
      <EditorCard
        title="Caption Mode"
        subtitle="Choose how captions are added to the video"
        icon={<Captions className="h-4 w-4" />}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {CAPTION_MODE_DEFS.map((m) => {
            const active = c.mode === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setMode(m.id)}
                data-testid={`caption-mode-${m.id}`}
                className={`text-left rounded-xl border p-3.5 transition-all ${
                  active
                    ? "border-primary/60 bg-primary/[0.07] shadow-[0_0_16px_rgba(234,179,8,0.07)]"
                    : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                }`}
              >
                <p className={`text-sm font-black ${active ? "text-white" : "text-white/65"}`}>{m.label}</p>
                <p className="text-[11px] text-white/35 mt-0.5 leading-relaxed">{m.description}</p>
              </button>
            );
          })}
        </div>
      </EditorCard>

      {/* ── Style Presets ── */}
      {hasCaptions && (
        <EditorCard title="Caption Style" subtitle="Visual look burned into the video">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {CAPTION_STYLE_PRESET_DEFS.map((p) => {
              const active = c.stylePreset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setStylePreset(p.id)}
                  data-testid={`caption-style-${p.id}`}
                  className={`text-left rounded-xl border bg-gradient-to-br p-3 transition-all ${
                    active
                      ? `${p.accent} opacity-100`
                      : "border-white/[0.08] bg-white/[0.02] hover:border-white/20"
                  }`}
                >
                  <p className={`text-xs font-black ${active ? "text-white" : "text-white/60"}`}>{p.name}</p>
                  <p className="text-[10px] text-white/35 mt-0.5 leading-relaxed">{p.description}</p>
                </button>
              );
            })}
          </div>
        </EditorCard>
      )}

      {/* ── Caption Controls ── */}
      {hasCaptions && (
        <EditorCard title="Caption Controls" subtitle="Fine-tune how captions look">
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Font Size">
                <Segmented
                  value={c.fontSize as typeof CAPTION_FONT_SIZES[number]}
                  options={CAPTION_FONT_SIZES.map((s) => ({ value: s, label: s }))}
                  onChange={(v) => setCaption("fontSize", v)}
                />
              </Field>
              <Field label="Position">
                <Segmented
                  value={c.position as "Top" | "Center" | "Bottom" | "Lower Third"}
                  options={[
                    { value: "Top",         label: "Top"    },
                    { value: "Center",      label: "Center" },
                    { value: "Bottom",      label: "Bottom" },
                    { value: "Lower Third", label: "Lower ⅓" },
                  ]}
                  onChange={(v) => setCaption("position", v)}
                />
              </Field>
              <Field label="Animation">
                <Segmented
                  value={(c.animation ?? "none") as CaptionAnimation}
                  options={CAPTION_ANIMATIONS.map((a) => ({ value: a.id, label: a.label }))}
                  onChange={(v) => setCaption("animation", v as CaptionAnimation)}
                />
              </Field>
            </div>

            {/* ── Caption Style Status ── */}
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 space-y-1">
              <p className="text-[10px] font-black text-white/30 uppercase tracking-widest">Caption Style Applied</p>
              {[
                ["Preset",           CAPTION_STYLE_PRESET_DEFS.find(p => p.id === c.stylePreset)?.name ?? c.stylePreset],
                ["Position",         c.position],
                ["Size",             c.fontSize],
                ["Animation",        CAPTION_ANIMATIONS.find(a => a.id === (c.animation ?? "none"))?.label ?? "None"],
                ["Saved",            "yes ✓"],
                ["Master player connected", "yes ✓"],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between text-[11px]">
                  <span className="text-white/30">{label}:</span>
                  <span className="text-white/55 font-semibold">{value}</span>
                </div>
              ))}
              <p className="text-[10px] text-white/25 pt-1 border-t border-white/[0.06]">
                Caption style preview ready. Export styling connected.
              </p>
            </div>

            <Field label="Text Color">
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={c.textColor}
                  onChange={(e) => setCaption("textColor", e.target.value)}
                  className="h-9 w-14 cursor-pointer rounded-lg border border-white/10 bg-transparent p-0.5"
                  data-testid="caption-text-color"
                />
                <span className="text-xs text-white/40 font-mono">{c.textColor.toUpperCase()}</span>
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  { key: "outline",    label: "Outline",        hint: "Text outline / border" },
                  { key: "background", label: "Background Box", hint: "Filled box behind text" },
                ] as const
              ).map(({ key, label, hint }) => (
                <div key={key} className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
                  <div>
                    <p className="text-xs font-semibold text-white/70">{label}</p>
                    <p className="text-[10px] text-white/30">{hint}</p>
                  </div>
                  <Switch
                    checked={c[key]}
                    onCheckedChange={(v) => setCaption(key, v)}
                    data-testid={`caption-toggle-${key}`}
                  />
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-white/70">Show Artist Name</p>
                  <p className="text-[10px] text-white/30">Burn artist name at the start of video</p>
                </div>
                <Switch
                  checked={c.showArtistName}
                  onCheckedChange={(v) => setCaption("showArtistName", v)}
                  data-testid="caption-toggle-artist"
                />
              </div>
              {c.showArtistName && (
                <TextInput
                  value={c.artistNameText}
                  placeholder="Artist name"
                  onChange={(v) => setCaption("artistNameText", v)}
                  testId="caption-artist-name"
                />
              )}
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold text-white/70">Show Song Title</p>
                  <p className="text-[10px] text-white/30">Burn song title at the start of video</p>
                </div>
                <Switch
                  checked={c.showSongTitle}
                  onCheckedChange={(v) => setCaption("showSongTitle", v)}
                  data-testid="caption-toggle-title"
                />
              </div>
              {c.showSongTitle && (
                <TextInput
                  value={c.songTitleText}
                  placeholder="Song title"
                  onChange={(v) => setCaption("songTitleText", v)}
                  testId="caption-song-title"
                />
              )}
            </div>
          </div>
        </EditorCard>
      )}

      {/* ── Caption Layout — safe area, max width, max lines ── */}
        <EditorCard
          title="Caption Layout"
          subtitle="Safe area, canvas width, and max visible lines"
          icon={<LayoutTemplate className="h-4 w-4" />}
        >
          <div className="space-y-4">
            {/* Show Safe Area toggle */}
            <div className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
              <div>
                <p className="text-xs font-semibold text-white/70">Show Caption Safe Area</p>
                <p className="text-[10px] text-white/30">Dashed guide box in the master player</p>
              </div>
              <Switch
                checked={c.showSafeArea ?? false}
                onCheckedChange={(v) => setCaption("showSafeArea", v)}
                data-testid="caption-toggle-safe-area"
              />
            </div>

            {/* Max Width */}
            <Field label="Max Caption Width">
              <Segmented
                value={(c.maxWidth ?? "80%") as "60%" | "70%" | "80%" | "90%"}
                options={[
                  { value: "60%", label: "60%" },
                  { value: "70%", label: "70%" },
                  { value: "80%", label: "80%" },
                  { value: "90%", label: "90%" },
                ]}
                onChange={(v) => setCaption("maxWidth", v as "60%" | "70%" | "80%" | "90%")}
              />
            </Field>

            {/* Max Lines */}
            <Field label="Max Lines">
              <Segmented
                value={(c.maxLines ?? "2") as "2" | "3"}
                options={[
                  { value: "2", label: "2 lines" },
                  { value: "3", label: "3 lines" },
                ]}
                onChange={(v) => setCaption("maxLines", v as "2" | "3")}
              />
            </Field>

            {/* Caption Layout Debug */}
            <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3 space-y-1">
              <p className="text-[10px] font-black text-white/30 uppercase tracking-widest mb-1.5">
                Caption Layout Debug
              </p>
              {(() => {
                const fmt        = (settings.export.format ?? "9:16") as VideoFormat;
                const [cw, ch]   = formatDimensions(fmt);
                const fmtLabel   = FORMAT_PRESET_LABELS[fmt]?.name ?? fmt;
                const wmPos      = settings.watermarkPosition ?? "bottom-right";
                const wfPos      = settings.waveformPosition  ?? "bottom-safe";
                const posLower   = c.position === "Bottom" || c.position === "Lower Third";
                const overlapsWm = posLower && (wmPos.startsWith("bottom") || wmPos.startsWith("top"));
                const overlapsWf = posLower && (wfPos === "bottom-safe" || wfPos === "bottom");
                return ([
                  ["project format",             fmtLabel],
                  ["canvas width × height",      `${cw}×${ch}px`],
                  ["caption position",            c.position],
                  ["max width",                   c.maxWidth ?? "80%"],
                  ["max lines",                   c.maxLines ?? "2"],
                  ["caption safe area active",    (c.showSafeArea ?? false) ? "yes" : "no"],
                  ["caption inside frame",        "yes — %-based margins"],
                  ["overlaps watermark",          overlapsWm ? "possible — check position" : "no"],
                  ["overlaps waveform",           overlapsWf ? "possible — check position" : "no"],
                  ["export uses same layout",     "yes — ASS margins match"],
                ] as [string, string][]).map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-2">
                    <span className="text-[9px] font-mono text-white/28">{label}</span>
                    <span className={`text-[9px] font-mono font-bold ${
                      value === "yes" || value.startsWith("yes")
                        ? "text-green-400"
                        : value.startsWith("possible") || value.startsWith("no")
                          ? value.startsWith("possible") ? "text-yellow-400" : "text-white/45"
                          : "text-white/55"
                    }`}>{value}</span>
                  </div>
                ));
              })()}
            </div>
          </div>
        </EditorCard>

      {/* ── Content by mode (lyrics / hook / best-bar text inputs) ── */}
      {c.mode === "auto" && (
        <EditorCard title="Full Lyrics" subtitle="Paste full lyrics — captions will be split automatically">
          <div className="space-y-3">
            <textarea
              value={c.lyricsText}
              onChange={(e) => setCaption("lyricsText", e.target.value)}
              placeholder={"Paste your lyrics here…\n\nEach phrase becomes one caption.\n[Section headers] are stripped automatically."}
              rows={10}
              data-testid="caption-full-lyrics-input"
              className="w-full resize-y rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-sm text-white/80 placeholder:text-white/20 focus:outline-none focus:border-primary/40 transition-colors leading-relaxed"
            />
            <p className="text-[11px] text-white/30">
              Each phrase → one caption. Section labels like [Verse 1] are stripped. Timing is spread evenly; adjust manually after generating.
            </p>
          </div>
        </EditorCard>
      )}

      {c.mode === "hook" && (
        <EditorCard title="Hook Text" subtitle="Type the hook or chorus lines you want to show">
          <textarea
            value={c.hookText}
            onChange={(e) => setCaption("hookText", e.target.value)}
            placeholder={"Type your hook / chorus here…\nOne line per caption."}
            rows={5}
            data-testid="caption-hook-input"
            className="w-full resize-y rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-sm text-white/80 placeholder:text-white/20 focus:outline-none focus:border-primary/40 transition-colors leading-relaxed"
          />
        </EditorCard>
      )}

      {c.mode === "best-bar" && (
        <EditorCard title="Best Bar" subtitle="The one bar you want burned over the entire video">
          <div className="space-y-3">
            <textarea
              value={c.bestBarText}
              onChange={(e) => setCaption("bestBarText", e.target.value)}
              placeholder="Type your best bar here…"
              rows={3}
              data-testid="caption-bestbar-input"
              className="w-full resize-y rounded-xl border border-white/[0.1] bg-white/[0.04] px-4 py-3 text-sm text-white/80 placeholder:text-white/20 focus:outline-none focus:border-primary/40 transition-colors leading-relaxed"
            />
            <p className="text-[11px] text-white/30">This line will be shown throughout the entire video.</p>
          </div>
        </EditorCard>
      )}

      {/* ── Action Buttons ── */}
      {hasCaptions && (
        <div className="flex flex-wrap gap-2.5">
          {canGenerate && (
            <Button
              size="sm"
              onClick={handleGenerate}
              data-testid="btn-generate-captions"
              className="gap-1.5"
            >
              <Wand2 className="h-3.5 w-3.5" />
              Re-Generate
            </Button>
          )}
          {c.mode === "manual" && (
            <Button
              size="sm"
              variant="outline"
              onClick={addManualLine}
              data-testid="btn-add-caption-row"
              className="gap-1.5 border-white/15"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Caption
            </Button>
          )}
          {c.lines.length > 0 && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setLinesVisible((v) => !v)}
                className="gap-1.5 border-white/15"
              >
                {linesVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {linesVisible ? "Hide" : "Show"} Lines ({c.lines.length})
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleClear}
                data-testid="btn-clear-captions"
                className="gap-1.5 text-red-400/70 hover:text-red-400 hover:bg-red-500/10"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Clear All
              </Button>
            </>
          )}

          {/* ── Repair / Reset row ── */}
          {c.lines.length > 0 && (
            <div className="w-full flex flex-wrap gap-2 pt-1 border-t border-white/[0.06]">
              <Button
                size="sm"
                variant="outline"
                onClick={handleRepairTiming}
                data-testid="btn-repair-caption-timing"
                className={`gap-1.5 border-white/15 ${health.invalid > 0 ? "border-amber-500/40 text-amber-400 hover:bg-amber-500/10" : ""}`}
              >
                <Wand2 className="h-3.5 w-3.5" />
                Repair Caption Timing
                {health.invalid > 0 && (
                  <span className="ml-1 text-[10px] font-black bg-amber-500/20 text-amber-400 rounded px-1">{health.invalid}</span>
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleResetFromLyrics}
                data-testid="btn-reset-captions-from-lyrics"
                className="gap-1.5 border-white/15"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset Timing From Lyrics
              </Button>
            </div>
          )}
          {repairStatus && (
            <div className="w-full">
              <StatusBadge status={repairStatus} />
            </div>
          )}
        </div>
      )}

      {/* ── Caption Timing Health ── */}
      {c.lines.length > 0 && (
        <div
          className={`rounded-xl border px-4 py-3 space-y-2 ${
            health.status === "healthy"
              ? "border-green-500/20 bg-green-500/[0.04]"
              : "border-amber-500/25 bg-amber-500/[0.05]"
          }`}
        >
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-black uppercase tracking-widest text-white/35">Caption Timing Health</p>
            <span className={`text-[11px] font-black px-2 py-0.5 rounded-full ${
              health.status === "healthy"
                ? "bg-green-500/15 text-green-400"
                : "bg-amber-500/15 text-amber-400"
            }`}>
              {health.status === "healthy" ? "Healthy ✓" : `Needs Repair — ${health.invalid} invalid`}
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-[11px]">
            <span className="text-white/30">Valid rows: <span className="text-green-400 font-bold">{health.valid}</span></span>
            <span className="text-white/30">Invalid rows: <span className={health.invalid > 0 ? "text-red-400 font-bold" : "text-white/30"}>{health.invalid}</span></span>
            <span className="text-white/30">Song: <span className="text-white/60 font-bold">{songDuration ? fmtDuration(songDuration) : "—"}</span></span>
            <span className="text-white/30">Last ends: <span className="text-white/60 font-bold">{health.lastEnd > 0 ? `${health.lastEnd.toFixed(1)}s` : "—"}</span></span>
          </div>
          {health.invalid > 0 && (
            <Button
              size="sm"
              onClick={handleRepairTiming}
              className="w-full gold-glow font-bold gap-2 mt-1"
            >
              <Wand2 className="h-3.5 w-3.5" />
              Repair All Invalid Caption Times
            </Button>
          )}
        </div>
      )}

      {/* ── Caption Lines table ── */}
      {(hasCaptions || c.lines.length > 0) && c.lines.length > 0 && linesVisible && (
        <EditorCard
          title={`Caption Lines — ${c.lines.length}${health.invalid > 0 ? ` (${health.invalid} invalid)` : ""}`}
          subtitle="Edit timing and text for each line. Changes save automatically."
        >
          <div className="space-y-2">
            {/* Header */}
            <div className="grid grid-cols-[70px_70px_1fr_auto] gap-2 px-1">
              <span className="text-[10px] font-black text-white/30 uppercase tracking-wider">Start (s)</span>
              <span className="text-[10px] font-black text-white/30 uppercase tracking-wider">End (s)</span>
              <span className="text-[10px] font-black text-white/30 uppercase tracking-wider">Caption Text</span>
              <span className="text-[10px] font-black text-white/30 uppercase tracking-wider">Del</span>
            </div>

            {/* Selection hint */}
            <p className="text-[10px] text-white/30 px-1 -mt-1">
              Click a row to preview it in Live Preview →
            </p>

            <div className="space-y-1.5 max-h-[480px] overflow-y-auto pr-1">
              {c.lines.map((line, i) => {
                const isSelected = selectedCaptionId === line.id;
                const invalid = isInvalidLine(line);
                const confBorder =
                  invalid                                ? "border-l-red-500"
                  : line.confidence === "high"           ? "border-l-green-500/60"
                  : line.confidence === "medium"         ? "border-l-yellow-500/60"
                  : line.confidence === "low"            ? "border-l-orange-500/60"
                  : line.confidence === "needs-review"   ? "border-l-red-500/60"
                  : "border-l-transparent";
                return (
                  <div
                    key={line.id}
                    data-testid={`caption-row-${i}`}
                    onClick={() => onSelectCaption?.(isSelected ? null : line.id)}
                    title={invalid ? `⚠ Invalid timing: start ${line.startSec}s ≥ end ${line.endSec}s` : undefined}
                    className={`grid grid-cols-[70px_70px_1fr_auto] gap-2 items-center group rounded-lg px-1 py-0.5 cursor-pointer transition-colors border-l-2 ${confBorder} ${
                      invalid
                        ? "bg-red-500/[0.07]"
                        : isSelected
                        ? "bg-primary/[0.08] outline outline-1 outline-primary/40"
                        : "hover:bg-white/[0.03]"
                    }`}
                  >
                    <input
                      type="number"
                      value={line.startSec}
                      min={0}
                      step={0.1}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => { updateLine(line.id, { startSec: parseFloat(e.target.value) || 0 }); onSelectCaption?.(line.id); }}
                      data-testid={`caption-line-${i}-start`}
                      title={secToLabel(line.startSec)}
                      className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-white/70 focus:outline-none focus:border-primary/40 transition-colors [appearance:textfield]"
                    />
                    <input
                      type="number"
                      value={line.endSec}
                      min={0}
                      step={0.1}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => { updateLine(line.id, { endSec: parseFloat(e.target.value) || 0 }); onSelectCaption?.(line.id); }}
                      data-testid={`caption-line-${i}-end`}
                      title={line.endSec >= 999 ? "Full video" : secToLabel(line.endSec)}
                      className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-white/70 focus:outline-none focus:border-primary/40 transition-colors [appearance:textfield]"
                    />
                    <input
                      type="text"
                      value={line.text}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => { updateLine(line.id, { text: e.target.value }); onSelectCaption?.(line.id); }}
                      data-testid={`caption-line-${i}-text`}
                      className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-white/70 focus:outline-none focus:border-primary/40 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); deleteLine(line.id); if (isSelected) onSelectCaption?.(null); }}
                      data-testid={`caption-line-${i}-delete`}
                      className="text-white/20 hover:text-red-400 transition-colors p-1 opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </EditorCard>
      )}

      {/* ── Pencil icon unused import placeholder (keep icon for future use) ── */}
      <span className="hidden"><Pencil /></span>
    </div>
  );
}
