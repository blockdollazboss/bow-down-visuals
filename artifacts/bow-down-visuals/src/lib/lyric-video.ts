/* ─── Lyric Video Maker shared helpers ────────────────────────────────────
   Pure functions used by the /lyric-video page. Kept in lib/ so they are
   unit-testable without rendering the page. */

export interface LyricVideoLineWord {
  word: string;
  startSec: number;
  endSec: number;
  matched: boolean;
}

export interface LyricVideoLine {
  text: string;
  startSec: number;
  endSec: number;
  words: LyricVideoLineWord[];
  matched: boolean;
}

export const ALIGN_CREDITS = 200;
export const RENDER_CREDITS = 500;

export type LyricVideoStyleKey =
  | "gold-luxury"
  | "neon"
  | "minimal"
  | "grunge"
  | "karaoke-bounce"
  | "typewriter"
  | "neon-glow"
  | "cinematic-fade"
  | "word-pop"
  | "gradient-sweep"
  | "glitch"
  | "handwritten"
  | "bold-impact"
  | "minimal-clean";
export type LyricVideoAspect = "16:9" | "9:16";

export const STYLE_META: Record<
  LyricVideoStyleKey,
  { label: string; blurb: string; swatch: string; cssClass: string }
> = {
  "gold-luxury": {
    label: "Gold Luxury",
    blurb: "Liquid gold on black — the Bow Down brand look",
    swatch: "linear-gradient(135deg,#0a0a0a 30%,#d4af37 90%)",
    cssClass: "lv-gold-luxury",
  },
  neon: {
    label: "Neon",
    blurb: "Electric cyan & magenta for high-energy tracks",
    swatch: "linear-gradient(135deg,#050510 20%,#ff00ff 90%)",
    cssClass: "lv-neon",
  },
  minimal: {
    label: "Minimal",
    blurb: "Clean and quiet — typography does the talking",
    swatch: "linear-gradient(135deg,#111111 40%,#3a3a3a 90%)",
    cssClass: "lv-minimal",
  },
  grunge: {
    label: "Grunge",
    blurb: "Distressed, raw, heavy texture",
    swatch: "linear-gradient(135deg,#0d0505 30%,#8b0000 90%)",
    cssClass: "lv-grunge",
  },
  "karaoke-bounce": {
    label: "Karaoke Bounce",
    blurb: "Classic karaoke energy — the sung word bounces",
    swatch: "linear-gradient(135deg,#0a0a2e 30%,#2e2e8e 90%)",
    cssClass: "lv-karaoke-bounce",
  },
  typewriter: {
    label: "Typewriter",
    blurb: "Terminal-green monospace with a blinking caret",
    swatch: "linear-gradient(135deg,#000000 40%,#1a2e1a 90%)",
    cssClass: "lv-typewriter",
  },
  "neon-glow": {
    label: "Neon Glow",
    blurb: "Hot-pink glow pulsing on deep purple",
    swatch: "linear-gradient(135deg,#0d0015 20%,#ff2fd6 90%)",
    cssClass: "lv-neon-glow",
  },
  "cinematic-fade": {
    label: "Cinematic Fade",
    blurb: "Elegant serif lines dissolving in and out",
    swatch: "linear-gradient(135deg,#050505 40%,#3a3a3a 90%)",
    cssClass: "lv-cinematic-fade",
  },
  "word-pop": {
    label: "Word Pop",
    blurb: "Word-by-word pop with a springy scale bounce",
    swatch: "linear-gradient(135deg,#0f0518 30%,#7c3aed 90%)",
    cssClass: "lv-word-pop",
  },
  "gradient-sweep": {
    label: "Gradient Sweep",
    blurb: "Animated gradient washing across each sung word",
    swatch: "linear-gradient(135deg,#080810 20%,#00d4ff 90%)",
    cssClass: "lv-gradient-sweep",
  },
  glitch: {
    label: "Glitch",
    blurb: "RGB-split digital glitch for aggressive tracks",
    swatch: "linear-gradient(135deg,#0a0a0a 40%,#00ffcc 90%)",
    cssClass: "lv-glitch",
  },
  handwritten: {
    label: "Handwritten",
    blurb: "Warm script ink with a gentle wobble",
    swatch: "linear-gradient(135deg,#120d08 40%,#8b5a2b 90%)",
    cssClass: "lv-handwritten",
  },
  "bold-impact": {
    label: "Bold Impact",
    blurb: "Massive uppercase slams — poster-style",
    swatch: "linear-gradient(135deg,#000000 40%,#ff3300 90%)",
    cssClass: "lv-bold-impact",
  },
  "minimal-clean": {
    label: "Minimal Clean",
    blurb: "Pure black, thin type, gentle fade — nothing else",
    swatch: "linear-gradient(135deg,#000000 50%,#1a1a1a 90%)",
    cssClass: "lv-minimal-clean",
  },
};

/** Format seconds as m:ss.d for the timing editor. */
export function formatLyricTime(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, "0")}`;
}

/** Parse a "m:ss.d" / seconds string back to seconds. Returns null if invalid. */
export function parseLyricTime(input: string): number | null {
  const t = input.trim();
  if (t === "") return null;
  const m = /^(\d+):([0-5]?\d(?:\.\d{1,2})?)$/.exec(t);
  if (m) {
    const secs = Number(m[1]) * 60 + Number(m[2]);
    return Number.isFinite(secs) ? secs : null;
  }
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Validate a timed line after user edits. Returns an error string or null. */
export function validateLineTiming(line: LyricVideoLine): string | null {
  if (line.endSec <= line.startSec) {
    return "End time must be after start time.";
  }
  if (line.startSec < 0 || line.endSec < 0) {
    return "Times can't be negative.";
  }
  return null;
}

/** Nudge a line's timing by delta seconds (clamped at 0). */
export function nudgeLine(line: LyricVideoLine, deltaSec: number): LyricVideoLine {
  const shift = (v: number) => Math.max(0, Math.round((v + deltaSec) * 100) / 100);
  return {
    ...line,
    startSec: shift(line.startSec),
    endSec: shift(line.endSec),
    words: line.words.map((w) => ({
      ...w,
      startSec: shift(w.startSec),
      endSec: shift(w.endSec),
    })),
  };
}

/** Count lines whose timing was interpolated (need manual review). */
export function countUnmatchedLines(lines: LyricVideoLine[]): number {
  return lines.filter((l) => !l.matched).length;
}

/** Split pasted lyrics into non-empty lines (mirrors the server). */
export function splitLyricLines(lyrics: string): string[] {
  return lyrics
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
