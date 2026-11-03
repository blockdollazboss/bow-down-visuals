/* ── Captions styled ONCE (stack1400 org/design wave #2, audit §4.4 #10) ──
 *
 * THE DEFECT: caption style had to be chosen three times.
 *   1. The editor layer — CaptionsSection writes the project's caption
 *      style into `settings.captions` (CaptionSettings), which the master
 *      player preview reads and project save persists
 *      (output_data.editorSettings).
 *   2. The AI Caption Suite — docked in the SAME captions tab — kept its
 *      burn style in local component state ("hormozi" by default), in a
 *      different vocabulary, and never read or wrote settings.captions.
 *      Its SRT/VTT downloads likewise carried no style at all.
 *   3. The burned-in export therefore re-asked for a style the user had
 *      already chosen in the editor.
 *
 * THE FIX: CaptionSettings is the single source. This module is the one
 * bridge between that source and the two server burn vocabularies:
 *   - wordsync burn  → POST /api/caption-styler
 *     (style: hormozi|minimal|karaoke|neon|luxury-gold,
 *      position: top|middle|bottom, fontSize: small|medium|large)
 *   - transcript burn → POST /api/style-subtitles
 *     (style: karaoke|word-by-word|minimal|bold-outline|neon)
 * Reads derive the burn params FROM settings.captions; picks made in the
 * Suite write BACK into settings.captions, so the preview layer, the
 * saved project, the saved caption file and every export inherit the
 * same one choice. The main export path already consumed
 * settings.captions whole (FinalVideoExport → export-video →
 * buildAssContent) — it needed no change.
 *
 * Mappings are honest approximations where the vocabularies don't line
 * up 1:1 (documented per table); exact matches map exactly.
 */

import type { CaptionSettings, CaptionStylePreset } from "./editor-settings";

/* ── Burn vocabularies (mirror the server routes) ────────────────────── */

export type WordsyncStyleKey = "hormozi" | "minimal" | "karaoke" | "neon" | "luxury-gold";
export type TranscriptStyleKey = "karaoke" | "word-by-word" | "minimal" | "bold-outline" | "neon";
export type SuiteBurnMode = "wordsync" | "transcript";
export type SuitePosition = "top" | "middle" | "bottom";
export type SuiteFontSize = "small" | "medium" | "large";

export interface SuiteBurnStyle {
  styleKey: string;
  position: SuitePosition;
  fontSize: SuiteFontSize;
}

/* ── Project preset → burn style ───────────────────────────────────────
 * Exact where both vocabularies name the same look (minimal, karaoke,
 * neon-glow→neon, luxury/gold-hiphop→luxury-gold, boxed→word-by-word).
 * The remaining project presets are bold pop looks; the wordsync
 * catalogue's bold-pop entry is "hormozi" and the transcript catalogue's
 * is "bold-outline". */
const PRESET_TO_WORDSYNC: Record<CaptionStylePreset, WordsyncStyleKey> = {
  "clean-white": "hormozi",
  "gold-hiphop": "luxury-gold",
  karaoke: "karaoke",
  boxed: "hormozi",
  "viral-shorts": "hormozi",
  minimal: "minimal",
  drill: "hormozi",
  luxury: "luxury-gold",
  rnb: "minimal",
  kids: "hormozi",
  "neon-glow": "neon",
  "pill-pop": "hormozi",
  brutalist: "hormozi",
  "karaoke-word": "karaoke",
};

const PRESET_TO_TRANSCRIPT: Record<CaptionStylePreset, TranscriptStyleKey> = {
  "clean-white": "bold-outline",
  "gold-hiphop": "karaoke",
  karaoke: "karaoke",
  boxed: "word-by-word",
  "viral-shorts": "bold-outline",
  minimal: "minimal",
  drill: "bold-outline",
  luxury: "karaoke",
  rnb: "minimal",
  kids: "bold-outline",
  "neon-glow": "neon",
  "pill-pop": "word-by-word",
  brutalist: "bold-outline",
  "karaoke-word": "karaoke",
};

/* ── Burn style → project preset (write-back) ──────────────────────────
 * Each burn key lands on the project preset that previews/exports as the
 * closest same look, so a Suite pick shows up identically in the master
 * player, the saved project and the main export. */
const WORDSYNC_TO_PRESET: Record<WordsyncStyleKey, CaptionStylePreset> = {
  hormozi: "viral-shorts",
  minimal: "minimal",
  karaoke: "karaoke",
  neon: "neon-glow",
  "luxury-gold": "gold-hiphop",
};

const TRANSCRIPT_TO_PRESET: Record<TranscriptStyleKey, CaptionStylePreset> = {
  karaoke: "karaoke",
  "word-by-word": "boxed",
  minimal: "minimal",
  "bold-outline": "clean-white",
  neon: "neon-glow",
};

export function isWordsyncStyleKey(k: string): k is WordsyncStyleKey {
  return k in WORDSYNC_TO_PRESET;
}
export function isTranscriptStyleKey(k: string): k is TranscriptStyleKey {
  return k in TRANSCRIPT_TO_PRESET;
}

/* ── Position / font size bridges ────────────────────────────────────── */

const POSITION_TO_SUITE: Record<string, SuitePosition> = {
  Top: "top",
  Center: "middle",
  Middle: "middle",
  Bottom: "bottom",
  "Lower Third": "bottom",
};
const SUITE_TO_POSITION: Record<SuitePosition, string> = {
  top: "Top",
  middle: "Center",
  bottom: "Bottom",
};

const SIZE_TO_SUITE: Record<string, SuiteFontSize> = {
  Small: "small",
  Medium: "medium",
  Large: "large",
  XL: "large",
};
const SUITE_TO_SIZE: Record<SuiteFontSize, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
};

/** Derive the Suite's burn controls from the ONE project caption style. */
export function suiteBurnStyleFromSettings(
  captions: CaptionSettings,
  mode: SuiteBurnMode,
): SuiteBurnStyle {
  return {
    styleKey:
      mode === "wordsync"
        ? PRESET_TO_WORDSYNC[captions.stylePreset] ?? "hormozi"
        : PRESET_TO_TRANSCRIPT[captions.stylePreset] ?? "bold-outline",
    position: POSITION_TO_SUITE[captions.position] ?? "bottom",
    fontSize: SIZE_TO_SUITE[captions.fontSize] ?? "medium",
  };
}

/**
 * Write a Suite burn pick back into the project caption style — the same
 * object the preview layer reads, project save persists, and the main
 * export burns. Lines and every unrelated caption field are preserved.
 * Unknown style keys (shouldn't happen — the Suite catalogues are
 * closed) leave the preset untouched rather than corrupting it.
 */
export function settingsWithSuiteBurnStyle(
  captions: CaptionSettings,
  mode: SuiteBurnMode,
  pick: Partial<SuiteBurnStyle>,
): CaptionSettings {
  const next: CaptionSettings = { ...captions };
  if (pick.styleKey) {
    if (mode === "wordsync" && isWordsyncStyleKey(pick.styleKey)) {
      next.stylePreset = WORDSYNC_TO_PRESET[pick.styleKey];
    } else if (mode === "transcript" && isTranscriptStyleKey(pick.styleKey)) {
      next.stylePreset = TRANSCRIPT_TO_PRESET[pick.styleKey];
    }
  }
  if (pick.position) next.position = SUITE_TO_POSITION[pick.position];
  if (pick.fontSize) next.fontSize = SUITE_TO_SIZE[pick.fontSize];
  if (next.stylePreset !== captions.stylePreset || next.position !== captions.position || next.fontSize !== captions.fontSize) {
    next.enabled = true;
  }
  return next;
}

/* ── Saved caption file (WebVTT) inherits the style ────────────────────
 * SRT has no standard styling — it stays plain timed text (format
 * limit, unchanged). WebVTT does: a STYLE block plus per-cue
 * line/align settings. The saved .vtt is therefore generated from the
 * same CaptionSettings, so the file a user saves carries the style they
 * chose once instead of dropping it. Colors/sizes mirror the master
 * player preview presets in video-editor.tsx (buildCaptionOverlayStyle).
 */

const PRESET_CSS_COLOR: Partial<Record<CaptionStylePreset, string>> = {
  "gold-hiphop": "#FFD700",
  luxury: "#FFD700",
  "neon-glow": "#A5F3FC",
  kids: "#FFE14D",
  rnb: "#FFF6EA",
};

const SIZE_TO_CSS: Record<string, string> = {
  Small: "0.9em",
  Medium: "1.1em",
  Large: "1.4em",
  XL: "1.7em",
};

/** The CSS ::cue rules for the project's one caption style. */
export function captionVttStyleBlock(captions: CaptionSettings): string {
  const color =
    captions.textColor && captions.textColor.toLowerCase() !== "#ffffff"
      ? captions.textColor
      : PRESET_CSS_COLOR[captions.stylePreset] ?? "#ffffff";
  const fontSize = SIZE_TO_CSS[captions.fontSize] ?? "1.1em";
  const rules = [
    `color: ${color}`,
    `font-size: ${fontSize}`,
    "font-weight: 800",
    captions.outline ? "text-shadow: 2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000" : "",
    captions.background ? "background-color: rgba(0,0,0,0.72)" : "",
  ].filter(Boolean);
  return `::cue { ${rules.join("; ")}; }`;
}

/** WebVTT cue settings (vertical placement + alignment) for the style. */
export function captionVttCueSettings(captions: CaptionSettings): string {
  switch (captions.position) {
    case "Top":
      return "line:8% align:center";
    case "Center":
      return "line:50% align:center";
    default: // Bottom / Lower Third
      return "line:88% align:center";
  }
}
