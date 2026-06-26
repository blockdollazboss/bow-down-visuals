import { Router } from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import { createWriteStream, readFileSync, writeFileSync, unlinkSync, existsSync, statSync } from "fs";
import { pipeline } from "stream/promises";
import { randomUUID, createHash } from "crypto";
import path from "path";
import os from "os";
import { requireAuth } from "../../middlewares/require-auth";
import { objectStorageClient } from "../../lib/objectStorage";
import { recordCreditUsage } from "../../lib/payment-record";
import { getPreparedExport, deletePreparedExport } from "../../lib/prepared-exports";

const execFileAsync = promisify(execFile);
const router = Router();
const SIDECAR = "http://127.0.0.1:1106";

/* ── Caption / ASS subtitle helpers ──────────────────── */

interface CaptionBurnConfig {
  mode: string;
  stylePreset: string;
  position: string;
  fontSize: string;
  textColor: string;
  outline: boolean;
  background: boolean;
  showArtistName: boolean;
  showSongTitle: boolean;
  artistNameText: string;
  songTitleText: string;
  lines: Array<{ startSec: number; endSec: number; text: string }>;
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
  };

  const base = PRESETS[preset] ?? PRESETS["clean-white"]!;

  const primaryColor =
    textColor && textColor !== "#ffffff" && textColor !== "#FFFFFF"
      ? hexToAssColor(textColor)
      : (base.primaryColor ?? "&H00FFFFFF");

  // "boxed" and "karaoke" always use box border style; respect backgroundOn for others
  const forceBorderStyle3 = preset === "boxed" || preset === "karaoke";

  return {
    fontname: base.fontname ?? "Arial",
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

function buildAssContent(
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
  );

  const events: Array<{ start: number; end: number; text: string }> = [];

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
  for (const line of config.lines) {
    if (!line.text.trim()) continue;
    const start = Math.max(0, line.startSec + timeOffset);
    const end = line.endSec >= 999 ? clipEnd : Math.min(line.endSec + timeOffset, clipEnd);
    if (end <= start) continue;
    const text = config.stylePreset === "drill" ? line.text.toUpperCase() : line.text;
    events.push({ start, end, text });
  }

  if (events.length === 0) return "";

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
    30, 30,              // marginL, marginR
    s.marginV,
    1,                   // encoding
  ].join(",");

  const dialogueLines = events
    .map((e) => {
      const escaped = e.text.replace(/\n/g, "\\N").replace(/,/g, "{\\,}");
      return `Dialogue: 0,${secToAss(e.start)},${secToAss(e.end)},Default,,0,0,0,,${escaped}`;
    })
    .join("\n");

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${targetW}
PlayResY: ${targetH}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styleLine}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${dialogueLines}
`;
}
const IS_DEV = process.env["NODE_ENV"] !== "production";

/* ── Export status tracking ─────────────────────────── */
interface ExportStatusInfo {
  clipsValidated:   number | null;
  invalidClips:     string[];
  clipsNormalized:  number | null;
  rangeReceived:    string | null;
  ffmpegStage:      string;
  ffmpegExitCode:   number | null;
  stderrTail:       string[];
  outputVerified:   boolean;
}

function makeStatus(): ExportStatusInfo {
  return {
    clipsValidated:  null,
    invalidClips:    [],
    clipsNormalized: null,
    rangeReceived:   null,
    ffmpegStage:     "pending",
    ffmpegExitCode:  null,
    stderrTail:      [],
    outputVerified:  false,
  };
}

/* ── Branding / card helpers ─────────────────────────── */

const SANS_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

function escapeDrawtext(t: string): string {
  return t
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "%%");
}

interface CardColors {
  artistColor: string;
  titleColor: string;
  taglineColor: string;
  uppercase: boolean;
  borderW: number;
  borderColor: string;
}

const CARD_COLORS: Record<string, CardColors> = {
  "luxury-dark":   { artistColor: "0xFFD700", titleColor: "0xFFFFFF", taglineColor: "0xCCCCCC", uppercase: false, borderW: 2, borderColor: "0x000000" },
  "drill-street":  { artistColor: "0xFFFFFF", titleColor: "0xFF3030", taglineColor: "0xCCCCCC", uppercase: true,  borderW: 3, borderColor: "0xFF0000" },
  "rnb-smooth":    { artistColor: "0xE8B4CB", titleColor: "0xDDA0DD", taglineColor: "0xCC88CC", uppercase: false, borderW: 1, borderColor: "0x000000" },
  "club-neon":     { artistColor: "0x00FFCC", titleColor: "0xFF00FF", taglineColor: "0xFFFFFF", uppercase: false, borderW: 2, borderColor: "0x000000" },
  "kids-bright":   { artistColor: "0xFFFF00", titleColor: "0x00FF88", taglineColor: "0xFFFFFF", uppercase: false, borderW: 3, borderColor: "0x000000" },
  "clean-minimal": { artistColor: "0x111111", titleColor: "0x444444", taglineColor: "0x777777", uppercase: false, borderW: 0, borderColor: "0xFFFFFF" },
};

const CARD_BG_HEX: Record<string, string> = {
  "luxury-dark":   "0x0a0a0a",
  "drill-street":  "0x0d0d0d",
  "rnb-smooth":    "0x1a0a2e",
  "club-neon":     "0x000000",
  "kids-bright":   "0x1a2040",
  "clean-minimal": "0xF5F5F5",
};

const OUTRO_CTA_TEXT_MAP: Record<string, string> = {
  "stream-now":        "Stream now",
  "follow-for-more":   "Follow for more",
  "new-music-out-now": "New music out now",
  "watch-full-video":  "Watch the full video",
  "created-with-bdv":  "Created with Bow Down Visuals",
};

interface IntroConfig  { artistName: string; songTitle: string; tagline: string; stylePreset: string; }
interface OutroConfig  { textLine1: string; textLine2: string; ctaPreset: string; customCtaText: string; stylePreset: string; }
interface TitleConfig  { showArtistName: boolean; artistNameText: string; showSongTitle: boolean; songTitleText: string; stylePreset: string; }
interface WmConfig     { bdvWatermark: boolean; customLogoUrl?: string | null; position: string; opacity: string; size: string; }

function buildCardDrawtext(c: IntroConfig, targetW: number, targetH: number): string {
  const col = CARD_COLORS[c.stylePreset] ?? CARD_COLORS["luxury-dark"]!;
  const d = Math.min(targetW, targetH);
  const aSize = Math.round(d * 0.07);
  const tSize = Math.round(d * 0.05);
  const gSize = Math.round(d * 0.034);
  const parts: string[] = [];
  if (c.artistName?.trim()) {
    const txt = col.uppercase ? escapeDrawtext(c.artistName.toUpperCase()) : escapeDrawtext(c.artistName);
    parts.push(`drawtext=fontfile='${SANS_BOLD}':text='${txt}':fontsize=${aSize}:fontcolor=${col.artistColor}:x=(w-text_w)/2:y=h/2-${Math.round(d*0.12)}:borderw=${col.borderW}:bordercolor=${col.borderColor}`);
  }
  if (c.songTitle?.trim()) {
    const txt = col.uppercase ? escapeDrawtext(c.songTitle.toUpperCase()) : escapeDrawtext(c.songTitle);
    parts.push(`drawtext=fontfile='${SANS_BOLD}':text='${txt}':fontsize=${tSize}:fontcolor=${col.titleColor}:x=(w-text_w)/2:y=h/2:borderw=${Math.max(0,col.borderW-1)}:bordercolor=${col.borderColor}`);
  }
  if (c.tagline?.trim()) {
    parts.push(`drawtext=fontfile='${SANS_BOLD}':text='${escapeDrawtext(c.tagline)}':fontsize=${gSize}:fontcolor=${col.taglineColor}@0.80:x=(w-text_w)/2:y=h/2+${Math.round(d*0.10)}`);
  }
  return parts.length ? parts.join(",") : "copy";
}

function buildOutroDrawtext(c: OutroConfig, targetW: number, targetH: number): string {
  const col = CARD_COLORS[c.stylePreset] ?? CARD_COLORS["luxury-dark"]!;
  const d = Math.min(targetW, targetH);
  const l1 = Math.round(d * 0.055);
  const l2 = Math.round(d * 0.042);
  const ct = Math.round(d * 0.034);
  const ctaText = c.ctaPreset === "custom" ? c.customCtaText : (OUTRO_CTA_TEXT_MAP[c.ctaPreset] ?? "");
  const parts: string[] = [];
  if (c.textLine1?.trim()) parts.push(`drawtext=fontfile='${SANS_BOLD}':text='${escapeDrawtext(c.textLine1)}':fontsize=${l1}:fontcolor=${col.artistColor}:x=(w-text_w)/2:y=h/2-${Math.round(d*0.10)}:borderw=${col.borderW}:bordercolor=${col.borderColor}`);
  if (c.textLine2?.trim()) parts.push(`drawtext=fontfile='${SANS_BOLD}':text='${escapeDrawtext(c.textLine2)}':fontsize=${l2}:fontcolor=${col.titleColor}:x=(w-text_w)/2:y=h/2+${Math.round(d*0.01)}`);
  if (ctaText.trim())      parts.push(`drawtext=fontfile='${SANS_BOLD}':text='${escapeDrawtext(ctaText)}':fontsize=${ct}:fontcolor=${col.taglineColor}@0.80:x=(w-text_w)/2:y=h/2+${Math.round(d*0.12)}`);
  return parts.length ? parts.join(",") : "copy";
}

const TITLE_COLORS: Record<string, { n: string; t: string }> = {
  "clean-white": { n: "0xFFFFFF", t: "0xCCCCCC" },
  "luxury-gold": { n: "0xFFD700", t: "0xFFFFFF" },
  "minimal":     { n: "0xFFFFFF", t: "0xAAAAAA" },
};

function buildTitleFilters(cfg: TitleConfig | null | undefined, tW: number, tH: number, dur: number): string[] {
  if (!cfg || (!cfg.showArtistName && !cfg.showSongTitle)) return [];
  const col = TITLE_COLORS[cfg.stylePreset] ?? TITLE_COLORS["clean-white"]!;
  const d = Math.min(tW, tH);
  const ns = Math.round(d * 0.038);
  const ts = Math.round(d * 0.030);
  const mb = Math.round(tH * 0.08);
  const sd = Math.min(5, dur).toFixed(3);
  const out: string[] = [];
  if (cfg.showArtistName && cfg.artistNameText?.trim()) {
    out.push(`drawtext=fontfile='${SANS_BOLD}':text='${escapeDrawtext(cfg.artistNameText)}':fontsize=${ns}:fontcolor=${col.n}:x=30:y=h-${mb+ns+12}:borderw=2:bordercolor=0x000000:enable='between(t\\,0\\,${sd})'`);
  }
  if (cfg.showSongTitle && cfg.songTitleText?.trim()) {
    out.push(`drawtext=fontfile='${SANS_BOLD}':text='${escapeDrawtext(cfg.songTitleText)}':fontsize=${ts}:fontcolor=${col.t}:x=30:y=h-${mb}:borderw=2:bordercolor=0x000000:enable='between(t\\,0\\,${sd})'`);
  }
  return out;
}

function buildWmPos(position: string): string {
  const m = 24;
  switch (position) {
    case "top-left":    return `${m}:${m}`;
    case "top-right":   return `W-w-${m}:${m}`;
    case "bottom-left": return `${m}:H-h-${m}`;
    default:            return `W-w-${m}:H-h-${m}`;
  }
}

/* ── Aspect ratio dimensions ──────────────────────────── */
const ASPECT_DIMS: Record<string, [number, number]> = {
  "9:16": [1080, 1920],
  "16:9": [1920, 1080],
  "1:1":  [1080, 1080],
};
const TARGET_FPS = 30;
const FFMPEG_TIMEOUT_MS = 8 * 60 * 1000;
const FADE_DURATION_S = 1.5;

/* ── helpers ─────────────────────────────────────────── */

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}): ${url.slice(0, 100)}`);
  const ws = createWriteStream(dest);
  await pipeline(res.body as Parameters<typeof pipeline>[0], ws);
}

interface VideoInfo {
  hasVideo: boolean;
  hasAudio: boolean;
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string;
  fileSize: number;
}

async function probeVideo(filePath: string): Promise<VideoInfo> {
  const fileSize = existsSync(filePath) ? statSync(filePath).size : 0;
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", filePath],
      { timeout: 30_000 },
    );
    const info = JSON.parse(stdout) as {
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
        r_frame_rate?: string;
        duration?: string;
      }>;
      format?: { duration?: string };
    };
    const vs = info.streams?.find((s) => s.codec_type === "video");
    const as_ = info.streams?.find((s) => s.codec_type === "audio");
    const duration = parseFloat(info.format?.duration ?? vs?.duration ?? "0");
    if (!vs) return { hasVideo: false, hasAudio: !!as_, duration: 0, width: 0, height: 0, fps: 0, codec: "", fileSize };
    let fps = 0;
    if (vs.r_frame_rate) {
      const [num, den] = vs.r_frame_rate.split("/").map(Number);
      if (num && den) fps = Math.round((num / den) * 100) / 100;
    }
    return {
      hasVideo: true,
      hasAudio: !!as_,
      duration: isNaN(duration) ? 0 : duration,
      width: vs.width ?? 0,
      height: vs.height ?? 0,
      fps,
      codec: vs.codec_name ?? "",
      fileSize,
    };
  } catch {
    return { hasVideo: false, hasAudio: false, duration: 0, width: 0, height: 0, fps: 0, codec: "", fileSize };
  }
}

/** Normalize one clip to target resolution/fps/codec so all clips are concat-compatible. */
async function normalizeClip(
  inputPath: string,
  outputPath: string,
  targetW: number,
  targetH: number,
  targetFps: number,
): Promise<string> {
  const args = [
    "-i", inputPath,
    "-vf", [
      `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease`,
      `pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:black`,
      "setsar=1",
      `fps=fps=${targetFps}`,
    ].join(","),
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-video_track_timescale", "90000",
    "-an",
    "-movflags", "+faststart",
    "-y", outputPath,
  ];
  try {
    const { stderr } = await execFileAsync("ffmpeg", args, { timeout: 120_000 });
    return stderr;
  } catch (e: unknown) {
    const stderr = (e as { stderr?: string }).stderr ?? "";
    const msg    = e instanceof Error ? e.message : String(e);
    throw new Error(`Clip normalization failed: ${msg.slice(0, 200)}\nStderr: ${stderr.slice(-400)}`);
  }
}

async function signGetUrl(bucketName: string, objectName: string): Promise<string> {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const res = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket_name: bucketName, object_name: objectName, method: "GET", expires_at: expiresAt }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Failed to sign URL: ${res.status}`);
  const { signed_url } = (await res.json()) as { signed_url: string };
  return signed_url;
}

function cleanup(...files: string[]) {
  for (const f of files) {
    try { if (existsSync(f)) unlinkSync(f); } catch { /* best-effort */ }
  }
}

/* ── POST /api/export-final-video ────────────────────── */

router.post("/export-final-video", requireAuth, async (req, res) => {
  const {
    projectId,
    clipUrls,
    audioUrl,
    timelineOrder,
    testMode,
    aspectRatio = "9:16",
    fadeAudioIn = false,
    fadeAudioOut = false,
    loopAudio = false,
    addWatermark = false,
    customWatermarkUrl,
    audioSource = "uploaded",
    captions,
    branding,
    exportRangeStart,
    exportRangeEnd,
    prepareId,
    clipTransitions,
    overlayItems,
  } = req.body as {
    projectId: string;
    clipUrls: string[];
    audioUrl?: string | null;
    timelineOrder?: string[];
    testMode?: boolean;
    aspectRatio?: string;
    fadeAudioIn?: boolean;
    fadeAudioOut?: boolean;
    loopAudio?: boolean;
    addWatermark?: boolean;
    customWatermarkUrl?: string | null;
    audioSource?: string;
    captions?: CaptionBurnConfig | null;
    branding?: {
      introCard?:   IntroConfig  & { enabled?: boolean; duration?: number };
      outroCard?:   OutroConfig  & { enabled?: boolean; duration?: number };
      watermark?:   WmConfig     & { enabled?: boolean };
      titleOverlay?: TitleConfig;
    } | null;
    exportRangeStart?: number | null;
    exportRangeEnd?: number | null;
    /** If set, use pre-downloaded clip files from a prior /api/prepare-export-files call. */
    prepareId?: string | null;
    /** Per-clip transition — index matches clipUrls. null/absent = Cut. */
    clipTransitions?: ({ type: string; duration: number } | null)[] | null;
    /** Structured overlay items to burn into the video. */
    overlayItems?: {
      type: string;
      content?: string;
      startSec?: number;
      endSec?: number;
      color?: string;
      textColor?: string;
      fontSize?: number;
      opacity?: number;
      position?: string;
    }[] | null;
  };

  if (!projectId?.trim()) {
    res.status(400).json({ error: "projectId is required" });
    return;
  }
  if (!Array.isArray(clipUrls) || clipUrls.length === 0) {
    res.status(400).json({ error: "clipUrls must be a non-empty array" });
    return;
  }

  /* ── Credit check (5 credits for final export) ── */
  const EXPORT_CREDIT_COST = 5;
  const currentCredits = req.userCredits ?? 0;
  if (!IS_DEV && currentCredits < EXPORT_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough credits. Please buy more credits to continue.",
    });
    return;
  }

  const [TARGET_W, TARGET_H] = ASPECT_DIMS[aspectRatio] ?? ASPECT_DIMS["9:16"]!;

  const exportId = randomUUID();
  const tmpDir = os.tmpdir();
  const tmpFiles: string[] = [];
  const exportStatus = makeStatus();

  try {
    req.log.info({
      clipCount: clipUrls.length,
      aspectRatio,
      resolution: `${TARGET_W}x${TARGET_H}`,
      audioSource,
      hasAudio: !!audioUrl,
      fadeAudioIn,
      fadeAudioOut,
      loopAudio,
      addWatermark,
      testMode: !!testMode,
      exportRangeStart,
      exportRangeEnd,
    }, "[export] starting");

    /* ── 1: Download every clip (or reuse prepared files) ── */
    const clipPaths: string[] = [];
    const clipInfos: VideoInfo[] = [];

    const preparedEntry = prepareId ? getPreparedExport(prepareId) : null;

    // ── HARD STOP: if prepareId was supplied, ALL clips must be file-verified ──
    if (prepareId) {
      if (!preparedEntry) {
        res.status(400).json({
          error: "Prepare session expired or not found. Click 'Prepare Export Files Only' again before exporting.",
          exportStatus,
        });
        return;
      }
      if (!preparedEntry.allReady) {
        const failed = preparedEntry.clips
          .filter((c) => !c.readyForFFmpeg)
          .map((c) => `Scene ${c.sceneNumber}${c.error ? `: ${c.error.slice(0, 80)}` : ""}`);
        res.status(400).json({
          error: `FFmpeg blocked — ${failed.length} clip${failed.length !== 1 ? "s" : ""} failed preparation: ${failed.join(" | ")}. Fix the errors and re-prepare before exporting.`,
          exportStatus,
        });
        return;
      }
      // Double-check every prepared file still exists on disk
      for (const pc of preparedEntry.clips) {
        if (!existsSync(pc.localPath)) {
          res.status(400).json({
            error: `Scene ${pc.sceneNumber} prepared file is gone from disk (${pc.localPath}). Re-prepare before exporting.`,
            exportStatus,
          });
          return;
        }
      }
      // ── Audio hard stop: if audio was requested it must be ready + on disk ──
      if (preparedEntry.audio?.requested) {
        if (!preparedEntry.audio.ready) {
          res.status(400).json({
            error: `FFmpeg blocked — project audio failed preparation: ${preparedEntry.audio.error ?? "unknown error"}. Re-prepare before exporting.`,
            exportStatus,
          });
          return;
        }
        if (!existsSync(preparedEntry.audio.localPath)) {
          res.status(400).json({
            error: `Prepared audio file is gone from disk (${preparedEntry.audio.localPath}). Re-prepare before exporting.`,
            exportStatus,
          });
          return;
        }
      }
    }

    const usePrepared = !!(
      preparedEntry &&
      preparedEntry.projectId === projectId &&
      preparedEntry.allReady &&
      preparedEntry.clips.length === clipUrls.length
    );

    if (usePrepared && preparedEntry) {
      req.log.info({ prepareId, clipCount: preparedEntry.clips.length }, "[export] using pre-downloaded clips from prepare step");
      for (const pc of preparedEntry.clips) {
        if (!existsSync(pc.localPath)) {
          throw new Error(
            `Scene ${pc.sceneNumber} prepared file is no longer available (${pc.localPath}). ` +
            `Please click "Prepare Export Files" again before exporting.`,
          );
        }
        const sz = statSync(pc.localPath).size;
        if (sz < 2048) {
          throw new Error(`Scene ${pc.sceneNumber} prepared file is too small (${sz} bytes). Please re-prepare.`);
        }
        clipPaths.push(pc.localPath);
        clipInfos.push({
          hasVideo: true,
          hasAudio: false,
          duration: pc.duration,
          width: pc.width,
          height: pc.height,
          fps: pc.fps,
          codec: pc.codec,
          fileSize: sz,
        });
        req.log.info({ scene: pc.sceneNumber, fileSize: sz, duration: pc.duration.toFixed(2) }, "[export] pre-prepared clip accepted ✓");
      }
      // NOTE: do NOT delete prepared files here — they are still needed for dedup check and normalization.
      // Cleanup happens in the finally block below.
    } else {
      if (prepareId && !preparedEntry) {
        req.log.warn({ prepareId }, "[export] prepareId not found in registry — falling back to live download");
      }
      exportStatus.ffmpegStage = "downloading clips";

      for (let i = 0; i < clipUrls.length; i++) {
        const url = clipUrls[i]!;
        if (!url.startsWith("http")) throw new Error(`Clip ${i + 1}: invalid URL — "${url.slice(0, 60)}"`);

        const dest = path.join(tmpDir, `bdv-clip-${exportId}-${i}.mp4`);
        tmpFiles.push(dest);

        req.log.info({ i: i + 1, url: url.slice(0, 80) }, "[export] downloading clip");

        try {
          await downloadToFile(url, dest);
        } catch (dlErr) {
          throw new Error(`Clip ${i + 1} could not be downloaded: ${dlErr instanceof Error ? dlErr.message : String(dlErr)}`);
        }

        const dlSize = statSync(dest).size;
        req.log.info({ i: i + 1, fileSize: dlSize }, "[export] clip downloaded");
        if (dlSize < 2048) {
          throw new Error(
            `Scene ${i + 1} clip download appears incomplete — file is only ${dlSize} bytes. ` +
            `URL: ${url.slice(0, 80)}`,
          );
        }

        const info = await probeVideo(dest);
        req.log.info({
          scene: i + 1,
          hasVideo: info.hasVideo,
          hasAudio: info.hasAudio,
          codec: info.codec,
          resolution: `${info.width}x${info.height}`,
          fps: info.fps,
          duration: info.duration.toFixed(2),
          fileSize: info.fileSize,
        }, "[export] clip validated");

        if (info.fileSize < 1024) {
          const msg = `Scene ${i + 1} has an invalid video file and must be regenerated. (file too small: ${info.fileSize} bytes)`;
          exportStatus.invalidClips.push(`Scene ${i + 1}: file too small`);
          throw new Error(msg);
        }
        if (!info.hasVideo) {
          const msg = `Scene ${i + 1} has an invalid video file and must be regenerated. (no video stream found)`;
          exportStatus.invalidClips.push(`Scene ${i + 1}: no video stream`);
          throw new Error(msg);
        }
        if (info.duration <= 0) {
          const msg = `Scene ${i + 1} has an invalid video file and must be regenerated. (zero duration)`;
          exportStatus.invalidClips.push(`Scene ${i + 1}: zero duration`);
          throw new Error(msg);
        }

        clipPaths.push(dest);
        clipInfos.push(info);
      }
    }

    exportStatus.clipsValidated = clipInfos.length;
    req.log.info({ clipsValidated: clipInfos.length }, "[export] all clips validated");

    /* ── Compute total video duration (clips + optional intro/outro cards) ── */
    const totalClipsDuration = clipInfos.reduce((sum, c) => sum + c.duration, 0);
    const introEnabled = !!(branding?.introCard?.enabled);
    const outroEnabled = !!(branding?.outroCard?.enabled);
    const introDuration = introEnabled ? (branding!.introCard!.duration ?? 3) : 0;
    const outroDuration = outroEnabled ? (branding!.outroCard!.duration ?? 3) : 0;
    const totalVideoDuration = totalClipsDuration + introDuration + outroDuration;

    /* ── Compute clip timeline positions ── */
    const clipTimelineStarts: number[] = [];
    let clipCursor = introDuration;
    for (const info of clipInfos) {
      clipTimelineStarts.push(clipCursor);
      clipCursor += info.duration;
    }

    /* ── Resolve export range ── */
    const useRange = (
      typeof exportRangeStart === "number" &&
      typeof exportRangeEnd   === "number" &&
      exportRangeEnd > exportRangeStart &&
      exportRangeStart >= 0
    );
    const effectiveStart    = useRange ? Math.max(0, exportRangeStart!)                  : 0;
    const effectiveEnd      = useRange ? Math.min(exportRangeEnd!, totalVideoDuration)    : totalVideoDuration;
    const effectiveDuration = Math.max(0.5, effectiveEnd - effectiveStart);

    exportStatus.rangeReceived = useRange
      ? `${effectiveStart.toFixed(3)}s → ${effectiveEnd.toFixed(3)}s (${effectiveDuration.toFixed(3)}s)`
      : "full";

    if (useRange) {
      req.log.info({ effectiveStart, effectiveEnd, effectiveDuration: effectiveDuration.toFixed(3) }, "[export] range export active");
    }

    /* ── Determine which clips overlap the export range ── */
    // Clips not in range are skipped (not downloaded for normalize) saving time on test exports.
    const includeIntro = introEnabled && effectiveStart < introDuration;
    const includeOutro = outroEnabled && effectiveEnd > (introDuration + totalClipsDuration);
    const selectedClipOrigIndices: number[] = [];
    for (let i = 0; i < clipInfos.length; i++) {
      const cStart = clipTimelineStarts[i]!;
      const cEnd   = cStart + clipInfos[i]!.duration;
      if (!useRange || (cEnd > effectiveStart && cStart < effectiveEnd)) {
        selectedClipOrigIndices.push(i);
      }
    }
    req.log.info({
      totalClips: clipInfos.length,
      selectedClips: selectedClipOrigIndices.length,
      includeIntro,
      includeOutro,
    }, "[export] clip range selection");

    /* ── Compute output-relative range seek (after filtering) ── */
    // The concat of [includeIntro?][selectedClips] has a different "t=0" than the full timeline.
    let outputTimelineOffset = 0; // where in the full timeline our concat output begins
    if (includeIntro) {
      outputTimelineOffset = 0;
    } else if (selectedClipOrigIndices.length > 0) {
      outputTimelineOffset = clipTimelineStarts[selectedClipOrigIndices[0]!]!;
    }
    const rangeRelativeStart = useRange ? Math.max(0, effectiveStart - outputTimelineOffset) : 0;

    if (IS_DEV) {
      req.log.info({
        clips: clipInfos.map((c, i) => ({
          scene: i + 1,
          inRange: selectedClipOrigIndices.includes(i),
          resolution: `${c.width}x${c.height}`,
          fps: c.fps,
          duration: `${c.duration.toFixed(2)}s`,
          codec: c.codec,
          hasAudio: c.hasAudio,
          fileSize: c.fileSize,
        })),
        totalDuration: `${totalVideoDuration.toFixed(2)}s`,
        targetResolution: `${TARGET_W}x${TARGET_H}@${TARGET_FPS}fps`,
        audioSource,
        rangeRelativeStart: rangeRelativeStart.toFixed(3),
        outputTimelineOffset: outputTimelineOffset.toFixed(3),
      }, "[export][debug] clip details");
    }

    /* ── 1b: Dedup check ── */
    const clipFingerprints: string[] = [];
    for (const cp of clipPaths) {
      const size = statSync(cp).size;
      const head = readFileSync(cp).subarray(0, 65536);
      const fp   = createHash("sha256").update(head).digest("hex").slice(0, 16) + `_${size}`;
      clipFingerprints.push(fp);
    }
    const uniqueFingerprints = new Set(clipFingerprints);
    const identicalClipsDetected = uniqueFingerprints.size < clipPaths.length;
    if (identicalClipsDetected) {
      req.log.warn({ fingerprints: clipFingerprints }, "[export] identical clips detected");
    } else {
      req.log.info({ fingerprints: clipFingerprints }, "[export] all clips are distinct");
    }

    /* ── 1c: Normalize selected clips to target format ── */
    // Pre-normalizing ensures all clips are concat-compatible: same resolution, fps, codec, pix_fmt.
    // Only clips overlapping the export range are normalized (saves time on short test exports).
    const normalizedPaths: string[] = []; // aligned 1:1 with selectedClipOrigIndices
    for (let j = 0; j < selectedClipOrigIndices.length; j++) {
      const origIdx  = selectedClipOrigIndices[j]!;
      const srcPath  = clipPaths[origIdx]!;
      const normPath = path.join(tmpDir, `bdv-norm-${exportId}-${origIdx}.mp4`);
      tmpFiles.push(normPath);

      exportStatus.ffmpegStage = `normalizing clip ${j + 1}/${selectedClipOrigIndices.length}`;
      req.log.info({ scene: origIdx + 1, normPath }, "[export] normalizing clip");

      await normalizeClip(srcPath, normPath, TARGET_W, TARGET_H, TARGET_FPS);

      if (!existsSync(normPath) || statSync(normPath).size < 1024) {
        throw new Error(`Scene ${origIdx + 1} failed to normalize — output file missing or empty`);
      }
      normalizedPaths.push(normPath);
    }
    exportStatus.clipsNormalized = normalizedPaths.length;
    req.log.info({ clipsNormalized: normalizedPaths.length }, "[export] all clips normalized");

    /* ── 1d: Pre-FFmpeg preflight — verify every normalized file exists ── */
    for (let j = 0; j < normalizedPaths.length; j++) {
      const np      = normalizedPaths[j]!;
      const origIdx = selectedClipOrigIndices[j]!;
      if (!existsSync(np)) {
        throw new Error(
          `Scene ${origIdx + 1} local export file missing (${path.basename(np)}). ` +
          `The normalization step may have failed silently.`,
        );
      }
      const npSize = statSync(np).size;
      if (npSize < 1024) {
        throw new Error(
          `Scene ${origIdx + 1} normalized file is too small (${npSize} bytes) — ` +
          `the source clip may be corrupt. Try re-generating this clip.`,
        );
      }
      req.log.info(
        { scene: origIdx + 1, file: path.basename(np), bytes: npSize },
        "[export] pre-flight: clip verified ✓",
      );
    }
    req.log.info(
      { count: normalizedPaths.length },
      "[export] pre-flight passed — all normalized clips present and valid",
    );

    /* ── 2: Resolve audio (reuse prepared file or download fresh) ── */
    let audioPath: string | null = null;
    const DEFAULT_WATERMARK = path.join(process.cwd(), "artifacts/bow-down-visuals/public/bdv-watermark.png");

    if (!testMode && usePrepared && preparedEntry?.audio?.ready && existsSync(preparedEntry.audio.localPath)) {
      // Use the EXACT audio file already downloaded + ffprobe-verified in prepare step
      audioPath = preparedEntry.audio.localPath;
      req.log.info({
        audioPath,
        fileSize: preparedEntry.audio.fileSize,
        duration: preparedEntry.audio.duration.toFixed(2),
      }, "[export] using pre-downloaded audio from prepare step ✓");
    } else if (!testMode && !!audioUrl?.trim()) {
      const ext = audioUrl!.includes(".mp3") ? ".mp3" : audioUrl!.includes(".ogg") ? ".ogg" : audioUrl!.includes(".wav") ? ".wav" : ".aac";
      audioPath = path.join(tmpDir, `bdv-audio-${exportId}${ext}`);
      tmpFiles.push(audioPath);
      req.log.info({ audioUrl: audioUrl!.slice(0, 80), audioSource }, "[export] downloading audio");
      await downloadToFile(audioUrl!, audioPath);
      const audioSize = statSync(audioPath).size;
      req.log.info({ audioSize, audioSource }, "[export] audio downloaded");
    }

    /* ── 2b: Resolve watermark image path ── */
    let watermarkPath: string | null = null;
    if (addWatermark) {
      if (customWatermarkUrl?.startsWith("http")) {
        const wmExt = /\.(jpe?g)($|\?)/.test(customWatermarkUrl) ? ".jpg"
          : /\.webp($|\?)/.test(customWatermarkUrl) ? ".webp" : ".png";
        const wmDest = path.join(tmpDir, `bdv-wm-${exportId}${wmExt}`);
        tmpFiles.push(wmDest);
        try {
          await downloadToFile(customWatermarkUrl, wmDest);
          watermarkPath = wmDest;
          req.log.info({ bytes: statSync(wmDest).size }, "[export] custom watermark downloaded");
        } catch (wmErr) {
          req.log.warn({ err: String(wmErr) }, "[export] custom watermark download failed, falling back to default");
          watermarkPath = DEFAULT_WATERMARK;
        }
      } else {
        watermarkPath = DEFAULT_WATERMARK;
      }
      if (IS_DEV) req.log.info({ watermarkPath }, "[export][debug] watermark resolved");
    }

    /* ── 2c: Write ASS caption file if captions are active ── */
    let captionsAssPath: string | null = null;
    const captionsActive =
      captions &&
      captions.mode !== "none" &&
      (captions.lines.length > 0 || captions.showArtistName || captions.showSongTitle);

    if (captionsActive) {
      // Caption times are relative to clips (after any intro card).
      // For range exports we shift back by rangeRelativeStart so captions align with the trimmed output.
      // rangeRelativeStart already accounts for skipped intro/clips, so this covers all cases.
      const captionTimeOffset = (includeIntro ? introDuration : 0) - rangeRelativeStart;
      const assContent = buildAssContent(captions!, TARGET_W, TARGET_H, totalClipsDuration, captionTimeOffset);
      if (assContent.trim()) {
        captionsAssPath = path.join(tmpDir, `bdv-captions-${exportId}.ass`);
        tmpFiles.push(captionsAssPath);
        writeFileSync(captionsAssPath, assContent, "utf8");
        req.log.info(
          { captionsAssPath, lines: captions!.lines.length, mode: captions!.mode, captionTimeOffset },
          "[export] ASS captions file written",
        );
      }
    }

    /* ── 2d: Resolve branding watermark (overrides legacy addWatermark) ── */
    const useBrandingWm = !!(branding?.watermark?.enabled);
    let brandingWmPath: string | null = null;
    if (useBrandingWm) {
      const bwm = branding!.watermark!;
      if (bwm.customLogoUrl?.startsWith("http")) {
        const wmExt2 = /\.(jpe?g)($|\?)/.test(bwm.customLogoUrl) ? ".jpg"
          : /\.webp($|\?)/.test(bwm.customLogoUrl) ? ".webp" : ".png";
        const bwmDest = path.join(tmpDir, `bdv-bwm-${exportId}${wmExt2}`);
        tmpFiles.push(bwmDest);
        try {
          await downloadToFile(bwm.customLogoUrl, bwmDest);
          brandingWmPath = bwmDest;
          req.log.info({ bytes: statSync(bwmDest).size }, "[export] branding custom logo downloaded");
        } catch (e) {
          req.log.warn({ err: String(e) }, "[export] branding logo failed, using BDV default");
          brandingWmPath = bwm.bdvWatermark !== false ? DEFAULT_WATERMARK : null;
        }
      } else if (bwm.bdvWatermark !== false) {
        brandingWmPath = DEFAULT_WATERMARK;
      }
    }
    // branding.watermark wins; else fall back to legacy addWatermark toggle
    const activeWmPath = useBrandingWm ? brandingWmPath : (addWatermark ? watermarkPath : null);

    /* ── 3: Plan FFmpeg input indices ── */
    // Clips fed to FFmpeg are the pre-normalized subset (only those overlapping the range).
    let nextIdx = 0;
    const introInputIdx = includeIntro ? nextIdx++ : -1;
    const clipBaseIdx   = nextIdx;
    nextIdx += normalizedPaths.length;           // only selected/normalized clips
    const outroInputIdx = includeOutro ? nextIdx++ : -1;
    const audioInputIdx = audioPath ? nextIdx++ : -1;
    const wmInputIdx    = activeWmPath ? nextIdx++ : -1;

    /* ── 3b: Build video filter_complex ── */
    // Clips are already normalized to target resolution/fps/codec — no scale filter needed.
    const filterParts: string[] = [];

    // Reset timestamps for each normalized clip
    for (let i = 0; i < normalizedPaths.length; i++) {
      filterParts.push(`[${clipBaseIdx + i}:v]setpts=PTS-STARTPTS[v${i}]`);
    }

    // Intro card with optional drawtext (lavfi color source, already at target res)
    if (introInputIdx >= 0) {
      const dt = buildCardDrawtext(branding!.introCard as IntroConfig, TARGET_W, TARGET_H);
      filterParts.push(`[${introInputIdx}:v]${dt}[intro_card]`);
    }

    // Outro card with optional drawtext
    if (outroInputIdx >= 0) {
      const dt = buildOutroDrawtext(branding!.outroCard as OutroConfig, TARGET_W, TARGET_H);
      filterParts.push(`[${outroInputIdx}:v]${dt}[outro_card]`);
    }

    // ── Xfade map: transition name → FFmpeg xfade transition ──
    const XFADE_MAP: Record<string, string> = {
      "Crossfade":    "fade",
      "Fade to Black":"fadeblack",
      "Slide":        "slideleft",
      "Whip Pan":     "slideright",
      "Zoom":         "zoomin",
      "Blur Dissolve":"hblur",
      "Flash":        "fadewhite",
      "Glitch":       "pixelize",
      "Light Leak":   "fadewhite",
      "Spin":         "circlecrop",
    };

    const activeTransitions = Array.isArray(clipTransitions) ? clipTransitions : null;
    const hasAnyXfade = activeTransitions !== null &&
      normalizedPaths.length > 1 &&
      selectedClipOrigIndices.some((origIdx, j) =>
        j > 0 && activeTransitions[origIdx] != null && activeTransitions[origIdx]!.type !== "Cut",
      );

    // Build clip chain — either incremental xfade or plain concat between selected clips
    if (hasAnyXfade) {
      let chainLabel = "v0";
      let accDuration = clipInfos[selectedClipOrigIndices[0]!]!.duration;
      for (let j = 1; j < normalizedPaths.length; j++) {
        const origIdx  = selectedClipOrigIndices[j]!;
        const trans    = activeTransitions![origIdx] ?? null;
        const clipDur  = clipInfos[origIdx]!.duration;
        const isLast   = j === normalizedPaths.length - 1;
        const outLabel = isLast ? "vclips" : `vxf${j}`;
        if (trans && trans.type !== "Cut") {
          const xft      = XFADE_MAP[trans.type] ?? "fade";
          const transDur = Number(Math.min(trans.duration, accDuration * 0.8, clipDur * 0.8).toFixed(3));
          const offset   = Number(Math.max(0, accDuration - transDur).toFixed(3));
          filterParts.push(`[${chainLabel}][v${j}]xfade=transition=${xft}:duration=${transDur}:offset=${offset}[${outLabel}]`);
          accDuration = offset + clipDur;
        } else {
          filterParts.push(`[${chainLabel}][v${j}]concat=n=2:v=1:a=0[${outLabel}]`);
          accDuration += clipDur;
        }
        chainLabel = outLabel;
      }
      if (normalizedPaths.length === 1) {
        filterParts.push(`[v0]copy[vclips]`);
      }
    }

    // Assemble intro / clip-chain / outro → vconcat
    let workLabel = "vconcat";
    if (hasAnyXfade) {
      const outerSegs: string[] = [];
      if (introInputIdx >= 0) outerSegs.push("[intro_card]");
      outerSegs.push("[vclips]");
      if (outroInputIdx >= 0) outerSegs.push("[outro_card]");
      if (outerSegs.length === 1) {
        filterParts.push(`[vclips]copy[vconcat]`);
      } else {
        filterParts.push(`${outerSegs.join("")}concat=n=${outerSegs.length}:v=1:a=0[vconcat]`);
      }
    } else {
      const segments: string[] = [];
      if (introInputIdx >= 0) segments.push("[intro_card]");
      for (let i = 0; i < normalizedPaths.length; i++) segments.push(`[v${i}]`);
      if (outroInputIdx >= 0) segments.push("[outro_card]");
      filterParts.push(`${segments.join("")}concat=n=${segments.length}:v=1:a=0[vconcat]`);
    }

    // Title overlay drawtext chain (artist name + song title in lower-left)
    const titleFilters = buildTitleFilters(
      branding?.titleOverlay as TitleConfig | undefined ?? null,
      TARGET_W, TARGET_H, effectiveDuration,
    );
    for (let i = 0; i < titleFilters.length; i++) {
      const nextLabel = `vtitle${i}`;
      filterParts.push(`[${workLabel}]${titleFilters[i]}[${nextLabel}]`);
      workLabel = nextLabel;
    }

    // Watermark overlay
    if (wmInputIdx >= 0 && activeWmPath) {
      const bwm = useBrandingWm ? branding!.watermark : null;
      const wmW = bwm
        ? ({ small: 100, medium: 150, large: 200 }[bwm.size] ?? 150)
        : Math.round(TARGET_W * 0.20);
      const wmAlpha = bwm
        ? ({ low: "0.30", medium: "0.60", high: "0.90" }[bwm.opacity] ?? "0.60")
        : "0.90";
      const wmPos = bwm ? buildWmPos(bwm.position) : "W-w-24:H-h-24";
      filterParts.push(`[${wmInputIdx}:v]scale=${wmW}:-2,format=rgba,colorchannelmixer=aa=${wmAlpha}[wm]`);
      filterParts.push(`[${workLabel}][wm]overlay=${wmPos}:format=auto[vwmed]`);
      workLabel = "vwmed";
    }

    // ── Structured overlay items: drawtext (text / lower-third) + drawbox (color) ──
    if (Array.isArray(overlayItems) && overlayItems.length > 0) {
      const OVERLAY_POS: Record<string, { x: string; y: string }> = {
        "top-left":     { x: "30",              y: "50" },
        "top-center":   { x: "(w-text_w)/2",    y: "50" },
        "top-right":    { x: "w-text_w-30",     y: "50" },
        "center-left":  { x: "30",              y: "(h-text_h)/2" },
        "center":       { x: "(w-text_w)/2",    y: "(h-text_h)/2" },
        "center-right": { x: "w-text_w-30",     y: "(h-text_h)/2" },
        "bottom-left":  { x: "30",              y: "h-text_h-80" },
        "bottom-center":{ x: "(w-text_w)/2",    y: "h-text_h-80" },
        "bottom-right": { x: "w-text_w-30",     y: "h-text_h-80" },
      };
      let ovIdx = 0;
      for (const ov of overlayItems) {
        const enableClause = (typeof ov.startSec === "number" && typeof ov.endSec === "number")
          ? `enable='between(t\\,${ov.startSec.toFixed(3)}\\,${ov.endSec.toFixed(3)})'`
          : "";
        const nextLabel = `vov${ovIdx}`;

        if (ov.type === "text" || ov.type === "lower-third") {
          if (!ov.content?.trim()) { ovIdx++; continue; }
          const pos   = OVERLAY_POS[ov.position ?? "bottom-center"] ?? OVERLAY_POS["bottom-center"]!;
          const fs    = ov.fontSize ?? (ov.type === "lower-third" ? 36 : 40);
          const fc    = ov.textColor ?? "#FFFFFF";
          const alpha = (ov.opacity ?? 1.0).toFixed(2);
          const bg    = ov.type === "lower-third"
            ? `:box=1:boxcolor=black@0.65:boxborderw=12`
            : `:borderw=3:bordercolor=0x000000`;
          const txt   = escapeDrawtext(ov.content);
          filterParts.push(
            `[${workLabel}]drawtext=fontfile='${SANS_BOLD}':text='${txt}':${enableClause}` +
            `:x=${pos.x}:y=${pos.y}:fontsize=${fs}:fontcolor=${fc}@${alpha}${bg}[${nextLabel}]`,
          );
          workLabel = nextLabel;
        } else if (ov.type === "color") {
          const col   = (ov.color ?? "#000000").replace("#", "0x");
          const alpha = (ov.opacity ?? 0.4).toFixed(2);
          filterParts.push(
            `[${workLabel}]drawbox=${enableClause}:x=0:y=0:w=iw:h=ih:color=${col}@${alpha}:t=fill[${nextLabel}]`,
          );
          workLabel = nextLabel;
        }
        // vignette, film-grain, light-leak, particles, image/watermark:
        // too complex for drawtext — skip silently (CSS-only in preview)
        ovIdx++;
      }
    }

    // Rename workLabel → vout
    if (workLabel !== "vout") {
      filterParts.push(`[${workLabel}]copy[vout]`);
    }

    /* ── 3c: Inject ASS subtitle filter if captions were written ── */
    let voutLabel = "vout";
    if (captionsAssPath) {
      const escapedPath = captionsAssPath
        .replace(/\\/g, "\\\\")
        .replace(/:/g, "\\:")
        .replace(/'/g, "\\'");
      filterParts.push(`[vout]subtitles='${escapedPath}'[vfinal]`);
      voutLabel = "vfinal";
      req.log.info({ voutLabel, escapedPath }, "[export] ASS subtitle filter injected");
    }

    const filterComplex = filterParts.join(";");

    /* ── 4: Build audio filter chain ── */
    const audioFilterParts: string[] = [];
    if (audioPath) {
      if (loopAudio) {
        audioFilterParts.push(`aloop=loop=-1:size=2147483647`);
        audioFilterParts.push(`atrim=duration=${effectiveDuration.toFixed(3)}`);
        audioFilterParts.push(`asetpts=PTS-STARTPTS`);
      }
      if (fadeAudioIn) {
        audioFilterParts.push(`afade=t=in:st=0:d=${FADE_DURATION_S}`);
      }
      if (fadeAudioOut && effectiveDuration > FADE_DURATION_S * 2) {
        const fadeOutStart = Math.max(0, effectiveDuration - FADE_DURATION_S);
        audioFilterParts.push(`afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${FADE_DURATION_S}`);
      }
    }

    /* ── 5: Build FFmpeg args ── */
    // Input ordering: intro? → normalizedClips → outro? → audio? → watermark?
    const outputPath = path.join(tmpDir, `bdv-export-${exportId}.mp4`);
    tmpFiles.push(outputPath);

    const ffmpegArgs: string[] = [];

    // Intro lavfi color source (already at target size + fps)
    if (introInputIdx >= 0) {
      const bgColor = CARD_BG_HEX[branding!.introCard!.stylePreset] ?? "0x0a0a0a";
      ffmpegArgs.push("-f", "lavfi", "-i", `color=c=${bgColor}:s=${TARGET_W}x${TARGET_H}:d=${introDuration}:r=${TARGET_FPS}`);
    }
    // Normalized clip inputs
    for (const np of normalizedPaths) {
      ffmpegArgs.push("-i", np);
    }
    // Outro lavfi color source
    if (outroInputIdx >= 0) {
      const bgColor = CARD_BG_HEX[branding!.outroCard!.stylePreset] ?? "0x0a0a0a";
      ffmpegArgs.push("-f", "lavfi", "-i", `color=c=${bgColor}:s=${TARGET_W}x${TARGET_H}:d=${outroDuration}:r=${TARGET_FPS}`);
    }
    // Audio
    if (audioPath) {
      ffmpegArgs.push("-i", audioPath);
    }
    // Watermark still image (looped)
    if (wmInputIdx >= 0 && activeWmPath) {
      ffmpegArgs.push("-loop", "1", "-i", activeWmPath);
    }

    ffmpegArgs.push("-filter_complex", filterComplex);
    ffmpegArgs.push("-map", `[${voutLabel}]`);

    if (audioPath && audioInputIdx >= 0) {
      ffmpegArgs.push("-map", `${audioInputIdx}:a`);
    }

    ffmpegArgs.push(
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "22",
      "-pix_fmt", "yuv420p",
    );

    if (audioPath) {
      if (audioFilterParts.length > 0) {
        ffmpegArgs.push("-af", audioFilterParts.join(","));
      }
      ffmpegArgs.push("-c:a", "aac", "-b:a", "192k");
    } else {
      ffmpegArgs.push("-an");
    }

    // Seek to range-relative start within the concat output, cap at effective duration.
    if (rangeRelativeStart > 0) {
      ffmpegArgs.push("-ss", rangeRelativeStart.toFixed(3));
    }
    ffmpegArgs.push("-t", effectiveDuration.toFixed(3));

    ffmpegArgs.push("-movflags", "+faststart", "-y", outputPath);

    if (IS_DEV) {
      req.log.info({
        filterComplex,
        audioFilter: audioFilterParts.join(",") || "(none)",
        ffmpegCommand: `ffmpeg ${ffmpegArgs.map(a => a.includes(" ") ? `"${a}"` : a).join(" ")}`,
        selectedClips: selectedClipOrigIndices.map(i => `scene-${i+1}`),
        rangeRelativeStart: rangeRelativeStart.toFixed(3),
        effectiveDuration: effectiveDuration.toFixed(3),
      }, "[export][debug] FFmpeg command");
    }

    /* ── 6: Run FFmpeg ── */
    exportStatus.ffmpegStage = "combining";
    let ffmpegStderr = "";
    try {
      const result = await execFileAsync("ffmpeg", ffmpegArgs, { timeout: FFMPEG_TIMEOUT_MS });
      ffmpegStderr = result.stderr ?? "";
      exportStatus.ffmpegExitCode = 0;
      if (IS_DEV && ffmpegStderr) {
        req.log.info({ stderrTail: ffmpegStderr.split("\n").slice(-10).join("\n") }, "[export] FFmpeg stderr tail");
      }
    } catch (ffErr: unknown) {
      ffmpegStderr = (ffErr as { stderr?: string }).stderr ?? "";
      const exitCode = (ffErr as { code?: number }).code ?? -1;
      exportStatus.ffmpegExitCode = exitCode;
      const stderrLines = ffmpegStderr.split("\n").filter(Boolean);
      const stderrTail  = stderrLines.slice(-20);
      exportStatus.stderrTail = stderrTail;

      req.log.error({
        exitCode,
        stderrTail: stderrTail.join("\n"),
        command: `ffmpeg ${ffmpegArgs.slice(0, 6).join(" ")} ...`,
      }, "[export] FFmpeg failed");

      // Find the most specific error line in stderr
      const errorLine = stderrLines
        .filter(l => l.includes("Error") || l.includes("error") || l.includes("Invalid") || l.includes("No such") || l.includes("failed"))
        .pop() ?? stderrTail.at(-1) ?? "";

      const baseMsg = ffErr instanceof Error ? ffErr.message : String(ffErr);
      throw Object.assign(new Error(`FFmpeg failed (exit ${exitCode}): ${errorLine || baseMsg.slice(0, 200)}`), {
        ffmpegExitCode: exitCode,
        ffmpegStderr,
        stderrTail,
      });
    }

    /* ── 7: Verify output ── */
    if (!existsSync(outputPath)) throw new Error("FFmpeg produced no output file");

    const outSize = statSync(outputPath).size;
    if (IS_DEV) {
      req.log.info({ finalVideoBytes: outSize, finalVideoMB: (outSize / 1024 / 1024).toFixed(2) }, "[export][debug] output size");
    }

    if (outSize < 1024) {
      throw new Error(`Output file too small (${outSize} bytes) — FFmpeg may have failed silently`);
    }

    const outInfo = await probeVideo(outputPath);
    req.log.info({
      hasVideo: outInfo.hasVideo,
      hasAudio: outInfo.hasAudio,
      codec: outInfo.codec,
      resolution: `${outInfo.width}x${outInfo.height}`,
      duration: outInfo.duration.toFixed(2),
      fileSize: outInfo.fileSize,
    }, "[export] output verified");

    exportStatus.outputVerified = outInfo.hasVideo && outInfo.duration > 0;

    if (!outInfo.hasVideo) throw new Error("Output file has no video stream — FFmpeg may have produced a corrupt file");
    if (outInfo.duration <= 0) throw new Error("Output file has zero duration — FFmpeg may have produced a corrupt file");

    /* ── 8: Upload to GCS ── */
    const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
    if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");

    const objectName = `exports/${exportId}.mp4`;
    const fileBuffer = readFileSync(outputPath);
    const bucket = objectStorageClient.bucket(bucketId);
    const gcsFile = bucket.file(objectName);
    await gcsFile.save(fileBuffer, { contentType: "video/mp4", resumable: false });
    req.log.info({ objectName, bytes: fileBuffer.length }, "[export] uploaded to GCS");

    /* ── 9: Sign URL ── */
    const signedUrl = await signGetUrl(bucketId, objectName);
    const objectPath = `/objects/exports/${exportId}.mp4`;

    /* ── 10: Save to project ── */
    if (!testMode) {
      const { data: fullProject, error: selectErr } = await req.userSupabase!
        .from("projects")
        .select("id, user_id, project_type, title, artist_name, song_title, genre, mood, style, platform, input_data, output_data, credits_used, created_at")
        .eq("id", projectId)
        .eq("user_id", req.userId!)
        .single();

      if (selectErr || !fullProject) {
        req.log.warn({ err: selectErr?.message }, "[export] project not found for save");
      } else {
        const current = (fullProject.output_data as Record<string, unknown>) ?? {};
        const updatedOutputData = {
          ...current,
          final_video_url: signedUrl,
          export_object_path: objectPath,
          export_status: "completed",
          export_created_at: new Date().toISOString(),
          timeline_order: timelineOrder ?? null,
          clips_used: clipUrls.length,
          audio_used: !!audioPath,
          audio_source: audioSource,
          aspect_ratio: aspectRatio,
        };

        const { error: delErr } = await req.userSupabase!
          .from("projects").delete().eq("id", projectId).eq("user_id", req.userId!);

        if (delErr) {
          req.log.warn({ err: delErr.message }, "[export] delete error during save");
        } else {
          const { error: insErr } = await req.userSupabase!
            .from("projects")
            .insert({
              id: fullProject.id,
              user_id: fullProject.user_id,
              project_type: fullProject.project_type,
              title: fullProject.title,
              artist_name: fullProject.artist_name,
              song_title: fullProject.song_title,
              genre: fullProject.genre,
              mood: fullProject.mood,
              style: fullProject.style ?? null,
              platform: fullProject.platform ?? null,
              input_data: fullProject.input_data,
              output_data: updatedOutputData,
              credits_used: fullProject.credits_used,
              created_at: fullProject.created_at,
            });

          if (insErr) {
            req.log.warn({ err: insErr.message }, "[export] re-insert error");
            await req.userSupabase!.from("projects").insert(fullProject);
          } else {
            req.log.info({ projectId, clips: clipUrls.length, audioSource }, "[export] project saved ok");
          }
        }
      }
    }

    /* ── Deduct credits + record usage on export success ── */
    if (!IS_DEV) {
      const creditsAfter = currentCredits - EXPORT_CREDIT_COST;
      await req.userSupabase!.from("profiles").update({ credits: creditsAfter }).eq("id", req.userId!);
      recordCreditUsage({ userId: req.userId!, action: "Final Video Export", creditsUsed: EXPORT_CREDIT_COST, projectId: projectId ?? null }).catch(() => {});
      req.log.info({ userId: req.userId, creditsAfter }, "[export] credits deducted");
    }

    exportStatus.ffmpegStage = "completed";

    res.json({
      url: signedUrl,
      objectPath,
      exportId,
      clipCount: selectedClipOrigIndices.length,
      audioIncluded: !!audioPath,
      audioSource,
      aspectRatio,
      duration: outInfo.duration,
      testMode: !!testMode,
      exportStatus,
      debug: {
        identicalClipsDetected,
        fingerprints: clipFingerprints,
        ...(IS_DEV ? {
          clips: clipInfos,
          selectedClips: selectedClipOrigIndices.map(i => `scene-${i+1}`),
          output: { ...outInfo, fileSize: outSize },
          targetResolution: `${TARGET_W}x${TARGET_H}@${TARGET_FPS}fps`,
          effectiveDuration,
          rangeRelativeStart,
          audioFilters: audioFilterParts.join(",") || null,
          watermark: addWatermark,
        } : {}),
      },
    });

  } catch (err: unknown) {
    const msg         = err instanceof Error ? err.message : "Export failed";
    const exitCode    = (err as { ffmpegExitCode?: number }).ffmpegExitCode ?? null;
    const stderrTail  = (err as { stderrTail?: string[] }).stderrTail ?? [];
    const fullStderr  = (err as { ffmpegStderr?: string }).ffmpegStderr ?? "";

    exportStatus.ffmpegStage    = "failed";
    if (exitCode !== null) exportStatus.ffmpegExitCode = exitCode;
    if (stderrTail.length)  exportStatus.stderrTail    = stderrTail;

    req.log.error({ err: msg, exitCode, stderrLines: stderrTail.length }, "[export] failed");
    res.status(500).json({
      error: msg,
      exportStatus,
      ...(IS_DEV && fullStderr ? {
        ffmpegStderr:  fullStderr.slice(-3000),
        stderrTail,
        ffmpegExitCode: exitCode,
      } : {}),
    });
  } finally {
    cleanup(...tmpFiles);
    // Clean up pre-downloaded prepare files (the whole export dir) after FFmpeg is done.
    if (prepareId) {
      deletePreparedExport(prepareId);
    }
  }
});

export default router;
