/* ── Caption / ASS subtitle helpers ──────────────────── */

import { resolveCaptionFontFamily } from "./fonts";

export interface CaptionWordTiming {
  word: string;
  /** Seconds, relative to the start of the parent line. */
  start: number;
  /** Seconds, relative to the start of the parent line. */
  end: number;
}

export interface CaptionBurnConfig {
  mode: string;
  stylePreset: string;
  position: string;
  fontSize: string;
  /** Caption font family id's canonical family name (see lib/fonts). Empty/unknown → preset default. */
  fontFamily?: string;
  textColor: string;
  outline: boolean;
  background: boolean;
  showArtistName: boolean;
  showSongTitle: boolean;
  artistNameText: string;
  songTitleText: string;
  lines: Array<{ startSec: number; endSec: number; text: string; words?: CaptionWordTiming[] }>;
  /** Max caption width as % of canvas, e.g. "80%". Default 80%. */
  maxWidth?: string;
}

/** Word timings are only usable when they still match the line text. */
function validWords(text: string, words?: CaptionWordTiming[]): CaptionWordTiming[] | null {
  if (!words || words.length === 0) return null;
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  if (norm(words.map((w) => w.word).join(" ")) !== norm(text)) return null;
  if (words.some((w) => !(w.end > w.start))) return null;
  return words;
}

/** Convert #RRGGBB → ASS &H00BBGGRR */
function hexToAssColor(hex: string): string {
  const h = hex.replace("#", "").padStart(6, "0");
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

/** Seconds → ASS H:MM:SS.CC */
function secToAss(sec: number): string {
  const clamped = Math.max(0, sec);
  const totalCs = Math.round(clamped * 100);
  const cs = totalCs % 100;
  const totalS = Math.floor(totalCs / 100);
  const s = totalS % 60;
  const totalM = Math.floor(totalS / 60);
  const m = totalM % 60;
  const hh = Math.floor(totalM / 60);
  return `${hh}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

interface AssStyle {
  fontname: string;
  fontsize: number;
  primaryColor: string;
  outlineColor: string;
  backColor: string;
  bold: number;
  outline: number;
  shadow: number;
  borderStyle: number;
  alignment: number;
  marginV: number;
}

function resolveAssStyle(
  preset: string,
  position: string,
  fontSize: string,
  textColor: string,
  outlineOn: boolean,
  backgroundOn: boolean,
  targetW: number,
  targetH: number,
  /** Canonical family name of the user's font pick (see lib/fonts). */
  fontFamily?: string,
): AssStyle {
  const ALIGN: Record<string, number> = { Top: 8, Center: 5, Bottom: 2, "Lower Third": 2 };
  const alignment = ALIGN[position] ?? 2;
  // "Lower Third" uses a larger bottom margin so it sits ~⅔ down the frame
  const isLowerThird = position === "Lower Third";

  const SIZE: Record<string, number> = { Small: 48, Medium: 60, Large: 80, XL: 96 };
  const baseSize = SIZE[fontSize] ?? 60;
  // Scale relative to the shorter dimension (handles both 9:16 and 16:9)
  const scaleFactor = Math.min(targetW, targetH) / 1080;
  const fontsize = Math.max(24, Math.round(baseSize * scaleFactor));

  const marginV = isLowerThird
    ? Math.round(Math.min(targetW, targetH) * 0.14)
    : Math.round(Math.min(targetW, targetH) * 0.04);

  const PRESETS: Record<string, Partial<AssStyle>> = {
    /* ── Original presets ── */
    "clean-white": {
      fontname: "Arial",
      primaryColor: "&H00FFFFFF",
      outlineColor: "&H00000000",
      backColor: "&H80000000",
      bold: -1,
      outline: 3,
      shadow: 2,
    },
    drill: {
      fontname: "Arial",
      primaryColor: "&H00FFFFFF",
      outlineColor: "&H000000FF", // red in ASS BGR
      backColor: "&H80000000",
      bold: -1,
      outline: 4,
      shadow: 1,
    },
    luxury: {
      fontname: "Georgia",
      primaryColor: "&H0000D7FF", // gold (#FFD700 → BGR 00D7FF)
      outlineColor: "&H00000000",
      backColor: "&H90000000",
      bold: 0,
      outline: 2,
      shadow: 3,
    },
    rnb: {
      fontname: "Arial",
      primaryColor: "&H00E8E8E8",
      outlineColor: "&H00000000",
      backColor: "&H80000000",
      bold: 0,
      outline: 1,
      shadow: 4,
    },
    kids: {
      fontname: "Arial",
      primaryColor: "&H0000FFFF", // yellow (#FFFF00 → BGR 00FFFF)
      outlineColor: "&H00000000",
      backColor: "&H80000000",
      bold: -1,
      outline: 4,
      shadow: 0,
    },
    /* ── New style presets (match frontend CAPTION_STYLE_PRESET_DEFS) ── */
    "gold-hiphop": {
      fontname: "Arial",
      primaryColor: "&H0000D7FF", // gold #FFD700 → ASS BGR 00D7FF
      outlineColor: "&H00000000",
      backColor: "&H90000000",
      bold: -1,
      outline: 4,
      shadow: 2,
    },
    karaoke: {
      fontname: "Arial",
      primaryColor: "&H00FFFFFF",
      outlineColor: "&H0000D7FF", // gold outline
      backColor: "&HAA000000",
      bold: -1,
      outline: 2,
      shadow: 0,
    },
    boxed: {
      fontname: "Arial",
      primaryColor: "&H00FFFFFF",
      outlineColor: "&H00000000",
      backColor: "&HCC000000",
      bold: 0,
      outline: 0,
      shadow: 0,
    },
    "viral-shorts": {
      fontname: "Arial",
      primaryColor: "&H00FFFFFF",
      outlineColor: "&H00000000",
      backColor: "&H80000000",
      bold: -1,
      outline: 5,
      shadow: 0,
    },
    minimal: {
      fontname: "Arial",
      primaryColor: "&H00FFFFFF",
      outlineColor: "&H00000000",
      backColor: "&H80000000",
      bold: 0,
      outline: 0,
      shadow: 1,
    },
    /* ── New generation ── */
    "neon-glow": {
      fontname: "Arial",
      primaryColor: "&H00A5F3FC", // #A5F3FC → ASS BGR 00A5F3FC
      outlineColor: "&HFF0A1A2E",
      backColor: "&H90000000",
      bold: -1,
      outline: 2,
      shadow: 3,
    },
    "pill-pop": {
      fontname: "Arial",
      primaryColor: "&H00000000", // black text on a gold pill
      outlineColor: "&H00000000",
      backColor: "&H0000D7FF",    // gold #FFD700 → ASS BGR 00D7FF, opaque box
      bold: -1,
      outline: 1,
      shadow: 0,
    },
    brutalist: {
      fontname: "Arial",
      primaryColor: "&H00FFFFFF",
      outlineColor: "&H00000000",
      backColor: "&HFF000000",    // opaque black box, no blur
      bold: -1,
      outline: 0,
      shadow: 0,
    },
    "karaoke-word": {
      fontname: "Arial",
      primaryColor: "&H00FFFFFF",
      outlineColor: "&H00000000",
      backColor: "&H80000000",
      bold: -1,
      outline: 4,
      shadow: 1,
    },
  };

  const base = PRESETS[preset] ?? PRESETS["clean-white"]!;

  const primaryColor =
    textColor && textColor !== "#ffffff" && textColor !== "#FFFFFF"
      ? hexToAssColor(textColor)
      : (base.primaryColor ?? "&H00FFFFFF");

  // "boxed", "karaoke", "pill-pop" and "brutalist" always use box border style; respect backgroundOn for others
  const forceBorderStyle3 =
    preset === "boxed" || preset === "karaoke" || preset === "pill-pop" || preset === "brutalist";

  // The user's font pick wins when it resolves to a font bundled in the Docker image.
  const resolvedFont = resolveCaptionFontFamily(fontFamily);
  const fontname = resolvedFont ?? base.fontname ?? "Arial";

  return {
    fontname,
    fontsize,
    primaryColor,
    outlineColor: base.outlineColor ?? "&H00000000",
    backColor: base.backColor ?? "&H80000000",
    bold: base.bold ?? -1,
    outline: outlineOn ? (base.outline ?? 3) : 0,
    shadow: base.shadow ?? 2,
    borderStyle: (backgroundOn || forceBorderStyle3) ? 3 : 1,
    alignment,
    marginV,
  };
}

export function buildAssContent(
  config: CaptionBurnConfig,
  targetW: number,
  targetH: number,
  totalDuration: number,
  timeOffset = 0,
): string {
  const s = resolveAssStyle(
    config.stylePreset,
    config.position,
    config.fontSize,
    config.textColor,
    config.outline,
    config.background,
    targetW,
    targetH,
    config.fontFamily,
  );

  const events: Array<{ start: number; end: number; text: string; style?: string }> = [];

  // Artist / title cards at the very beginning (shifted by timeOffset when intro card precedes clips)
  let introCursor = 0.5 + timeOffset;
  if (config.showArtistName && config.artistNameText) {
    events.push({ start: introCursor, end: introCursor + 3, text: config.artistNameText });
    introCursor += 3.5;
  }
  if (config.showSongTitle && config.songTitleText) {
    events.push({ start: introCursor, end: introCursor + 3, text: config.songTitleText });
  }

  // Caption lines (shifted by timeOffset so they align with clips after the intro card)
  const clipEnd = timeOffset + totalDuration;
  const isWordKaraoke = config.stylePreset === "karaoke-word";
  for (const line of config.lines) {
    if (!line.text.trim()) continue;
    const start = Math.max(0, line.startSec + timeOffset);
    const end = line.endSec >= 999 ? clipEnd : Math.min(line.endSec + timeOffset, clipEnd);
    if (end <= start) continue;
    const text = config.stylePreset === "drill" ? line.text.toUpperCase() : line.text;
    events.push({ start, end, text });

    // TikTok-style word karaoke: the full line renders white underneath while
    // each word flashes gold (slightly larger) on a higher layer exactly as sung.
    const words = isWordKaraoke ? validWords(line.text, line.words) : null;
    if (words) {
      for (const w of words) {
        const ws = start + w.start;
        const we = Math.min(start + w.end, end);
        if (we <= ws) continue;
        events.push({
          start: ws,
          end: we,
          text: config.stylePreset === "drill" ? w.word.toUpperCase() : w.word,
          style: "KaraokeWord",
        });
      }
    }
  }

  if (events.length === 0) return "";

  // Derive horizontal margins from maxWidth (default 80% → 10% each side)
  const mwStr     = config.maxWidth ?? "80%";
  const mwPct     = Math.max(0, Math.min(100, parseFloat(mwStr) || 80));
  const sidePct   = (100 - mwPct) / 2 / 100;
  const marginH   = Math.max(20, Math.round(targetW * sidePct));

  const styleLine = [
    "Style: Default",
    s.fontname,
    s.fontsize,
    s.primaryColor,
    s.primaryColor,      // secondary
    s.outlineColor,
    s.backColor,
    s.bold,
    0,                   // italic
    0, 0,                // underline, strikeout
    100, 100,            // scaleX, scaleY
    0,                   // spacing
    0,                   // angle
    s.borderStyle,
    s.outline,
    s.shadow,
    s.alignment,
    marginH, marginH,    // marginL, marginR (from maxWidth)
    s.marginV,
    1,                   // encoding
  ].join(",");

  const dialogueLines = events
    .map((e) => {
      const escaped = e.text.replace(/\n/g, "\\N").replace(/,/g, "{\\,}");
      return `Dialogue: 0,${secToAss(e.start)},${secToAss(e.end)},${e.style ?? "Default"},,0,0,0,,${escaped}`;
    })
    .join("\n");

  // Word-highlight style for the karaoke-word preset: same face, gold, popped slightly larger.
  const karaokeWordStyleLine = isWordKaraoke
    ? "\n" + [
        "Style: KaraokeWord",
        s.fontname,
        s.fontsize,
        "&H0000D7FF", // gold #FFD700 → ASS BGR
        "&H0000D7FF",
        s.outlineColor,
        s.backColor,
        s.bold,
        0, 0, 0,
        108, 108,     // scaleX, scaleY — the "pop"
        0, 0,         // spacing, angle
        1,            // BorderStyle: normal (no box; the base line sits underneath)
        s.outline,
        s.shadow,
        s.alignment,
        marginH, marginH,
        s.marginV,
        1,
      ].join(",")
    : "";

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${targetW}
PlayResY: ${targetH}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styleLine}${karaokeWordStyleLine}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${dialogueLines}
`;
}
