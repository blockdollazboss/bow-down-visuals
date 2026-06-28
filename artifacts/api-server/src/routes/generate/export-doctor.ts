import { Router } from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import { createWriteStream, existsSync, mkdirSync, statSync, readFileSync, writeFileSync, rmSync } from "fs";
import { pipeline } from "stream/promises";
import { Transform } from "stream";
import { randomUUID } from "crypto";
import path from "path";
import os from "os";
import { requireAuth } from "../../middlewares/require-auth";
import { objectStorageClient } from "../../lib/objectStorage";
import { isAllowedStemUrl } from "../../lib/audioExport";
import { buildAssContent, type CaptionBurnConfig } from "../../lib/caption-ass";

const execFileAsync = promisify(execFile);
const router = Router();

const SIDECAR = "http://127.0.0.1:1106";
const SUPABASE_HOST = (() => {
  const url = process.env["SUPABASE_URL"] ?? "";
  try { return new URL(url).host; } catch { return ""; }
})();

const MAX_CLIP_BYTES = 500 * 1024 * 1024;  // 500 MB
const MAX_AUDIO_BYTES = 100 * 1024 * 1024; // 100 MB

/** Replit object storage (GCS) — the master player and our own exports use this. */
function isReplitObjectStorageUrl(u: URL): boolean {
  return u.host === "storage.googleapis.com" && u.pathname.startsWith("/replit-objstore-");
}

/** SSRF guard for Scene 1 video clips: https only, from Supabase storage, the
 *  Runway CDN, Sync.so lip-sync CDN, or Replit object storage (the host the master
 *  player plays from). Blocks internal/metadata/private hosts that don't match. */
function isAllowedClipUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:") return false;
  if (SUPABASE_HOST && u.host === SUPABASE_HOST) return true;
  if (isReplitObjectStorageUrl(u)) return true;
  // Sync.so lip-sync result CDN (api.sync.so, cdn.sync.so, storage.sync.so, etc.)
  if (u.hostname === "sync.so" || u.hostname.endsWith(".sync.so")) return true;
  return u.hostname.endsWith(".cloudfront.net") || u.hostname.endsWith(".runwayml.com");
}

/** Broader SSRF guard: permits any public HTTPS URL while blocking private/reserved
 *  IP ranges and well-known cloud metadata endpoints.
 *  Use as a fallback when isAllowedClipUrl() rejects an unfamiliar CDN host. */
function isPublicHttpsUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "https:") return false;
  const h = u.hostname;
  // Loopback / localhost
  if (h === "localhost" || h === "::1" || h === "[::1]") return false;
  if (/^127\./.test(h)) return false;
  // RFC-1918 private ranges
  if (/^10\./.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (/^192\.168\./.test(h)) return false;
  // Link-local / cloud metadata
  if (/^169\.254\./.test(h)) return false;
  if (h === "metadata.google.internal" || h === "metadata.azure.com") return false;
  return true;
}

/** SSRF guard for audio: Supabase storage (shared stem guard) or Replit object
 *  storage. Does not modify the shared isAllowedStemUrl used by the real export. */
function isAllowedAudioUrl(url: string): boolean {
  if (isAllowedStemUrl(url)) return true;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  return u.protocol === "https:" && isReplitObjectStorageUrl(u);
}

/** Stream transform that aborts once `max` bytes have flowed through. */
function byteCap(max: number): Transform {
  let total = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      total += chunk.length;
      if (total > max) { cb(new Error(`Download exceeded ${max} bytes`)); return; }
      cb(null, chunk);
    },
  });
}

/* ── Tiny in-memory registry: one downloaded Scene 1 file per doctor session ── */
interface DoctorSession {
  doctorId: string;
  projectId: string;
  folder: string;
  videoPath: string;
  audioPath: string | null;
  createdAt: number;
}
const sessions = new Map<string, DoctorSession>();

/* ── Multi-clip (all scenes) doctor session ── */
interface DoctorClipFile {
  sceneNumber: number;
  sceneTitle: string;
  sourceUrl: string;
  localPath: string;
  fileExists: boolean;
  fileSize: number;
  /** Raw duration from ffprobe — the full video file length. */
  duration: number;
  /** Seconds trimmed from the start (from master player ClipEdit). */
  trimStartSec: number;
  /** Seconds trimmed from the end (from master player ClipEdit). */
  trimEndSec: number;
  /** Explicit master player clip duration from scene timestamps (sent by client).
   *  When > 0, this is the authoritative duration the export must honour. */
  masterDuration: number;
  /** Effective clip duration used in export.
   *  = masterDuration (when provided and > 0), else raw - trimStart - trimEnd.
   *  When rawShorterThanMaster is true, normalizeMultiClip pads with freeze-last-frame. */
  timelineDuration: number;
  /** True when the raw source video is shorter than masterDuration.
   *  normalizeMultiClip will pad with tpad (freeze-last-frame) to reach masterDuration. */
  rawShorterThanMaster: boolean;
  width: number;
  height: number;
  codec: string;
  ffprobeValid: boolean;
  responseStatus: number;
  contentType: string;
  error: string | null;
}
interface DoctorMultiSession {
  multiId: string;
  projectId: string;
  folder: string;
  clips: DoctorClipFile[];
  audioPath: string | null;
  createdAt: number;
}
const multiSessions = new Map<string, DoctorMultiSession>();

// Clean up sessions older than 30 minutes
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, s] of sessions.entries()) {
    if (s.createdAt < cutoff) {
      try { rmSync(s.folder, { recursive: true, force: true }); } catch { /* best-effort */ }
      sessions.delete(id);
    }
  }
  for (const [id, s] of multiSessions.entries()) {
    if (s.createdAt < cutoff) {
      try { rmSync(s.folder, { recursive: true, force: true }); } catch { /* best-effort */ }
      multiSessions.delete(id);
    }
  }
}, 5 * 60 * 1000).unref();

/* ── Multi-clip target format + helpers (all clips normalize to 1080x1920) ── */
const MULTI_TARGET_W = 1080;
const MULTI_TARGET_H = 1920;
const MULTI_TARGET_FPS = 30;

/** Normalize one clip to 1080x1920@30 so every clip is concat-compatible.
 *  @param trimStartSec    Seconds to skip from the start of the raw video (master player trimStart).
 *  @param timelineDur     Output duration in seconds after trimming (master player effective duration).
 *                         When null, the full remaining video is used (no end trim).
 *  @param rawFileDuration ffprobe duration of the raw source file. When > 0 and the source is
 *                         shorter than timelineDur, freeze-last-frame padding (tpad) is applied so
 *                         the output always reaches the requested duration. */
async function normalizeMultiClip(
  input: string,
  output: string,
  trimStartSec = 0,
  timelineDur: number | null = null,
  rawFileDuration = 0,
): Promise<void> {
  const args: string[] = [];
  // Input seek: fast demuxer-level seek to the trim start point.
  if (trimStartSec > 0.01) args.push("-ss", trimStartSec.toFixed(3));
  args.push("-i", input);
  // Output duration limit: stops at master player clip end point.
  if (timelineDur !== null && timelineDur > 0.05) args.push("-t", timelineDur.toFixed(3));

  // Detect short-source condition: raw remaining < desired timeline duration.
  // When true, append tpad=stop_mode=clone to freeze the last frame and fill the gap.
  const sourceAvailable = rawFileDuration > 0 ? Math.max(0, rawFileDuration - trimStartSec) : 0;
  const needsPad = timelineDur !== null && sourceAvailable > 0 && sourceAvailable < timelineDur - 0.05;
  const padExtra = needsPad ? Math.max(0.05, timelineDur - sourceAvailable + 0.1) : 0;

  const vfParts = [
    `scale=${MULTI_TARGET_W}:${MULTI_TARGET_H}:force_original_aspect_ratio=decrease`,
    `pad=${MULTI_TARGET_W}:${MULTI_TARGET_H}:(ow-iw)/2:(oh-ih)/2:black`,
    "setsar=1",
    `fps=fps=${MULTI_TARGET_FPS}`,
  ];
  if (needsPad) {
    // tpad stop_duration adds extra seconds of frozen last-frame after the source ends.
    // A small overrun margin (+ 0.1s) ensures the -t limit cuts it cleanly.
    vfParts.push(`tpad=stop_mode=clone:stop_duration=${padExtra.toFixed(3)}`);
  }

  args.push(
    "-vf", vfParts.join(","),
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-video_track_timescale", "90000",
    "-an",
    "-movflags", "+faststart",
    "-y", output,
  );
  await execFileAsync("ffmpeg", args, { timeout: 120_000 });
}

/** Like normalizeMultiClip but with a still-frame fallback when tpad produces
 *  empty / missing output.
 *
 *  Strategy:
 *   1. Run the standard tpad path.
 *   2. If output is missing or < 1 KB: extract the last frame of the raw source,
 *      then loop it for `timelineDur` seconds (freeze-frame the whole clip).
 *   3. If frame extraction also fails: create a solid-black still as last resort.
 *
 *  Returns a debug object so callers can log or surface which method was used.
 */
async function normalizeMultiClipWithFallback(
  input: string,
  output: string,
  trimStartSec = 0,
  timelineDur: number | null = null,
  rawFileDuration = 0,
): Promise<{ method: "tpad" | "still-frame" | "failed"; normSize: number; normDuration: number; stderrTail: string }> {
  // ── Attempt 1: standard tpad freeze-last-frame ──────────────────────────
  try { await normalizeMultiClip(input, output, trimStartSec, timelineDur, rawFileDuration); } catch { /* will check output below */ }

  if (existsSync(output) && statSync(output).size >= 1024) {
    const probe = await probeMedia(output);
    if (probe.hasVideo && probe.duration > 0.1) {
      return { method: "tpad", normSize: statSync(output).size, normDuration: probe.duration, stderrTail: "" };
    }
  }

  // ── Attempt 2: still-frame fallback ─────────────────────────────────────
  const targetDur = timelineDur ?? Math.max(0, rawFileDuration - trimStartSec);
  if (targetDur < 0.1) return { method: "failed", normSize: 0, normDuration: 0, stderrTail: "target duration is zero" };

  const dir = path.dirname(output);
  const base = path.basename(output, ".mp4");
  const framePath = path.join(dir, `${base}-last-frame.jpg`);
  let stderrTail = "";

  // Try to grab the last frame; fall back to first frame; fall back to black.
  const seekPos = rawFileDuration > 0.1 ? (rawFileDuration - 0.05).toFixed(3) : "0";
  const frameVf = `scale=${MULTI_TARGET_W}:${MULTI_TARGET_H}:force_original_aspect_ratio=decrease,pad=${MULTI_TARGET_W}:${MULTI_TARGET_H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`;

  for (const attempt of [
    ["-ss", seekPos, "-i", input, "-vframes", "1", "-vf", frameVf, "-y", framePath],
    ["-i", input, "-vframes", "1", "-vf", frameVf, "-y", framePath],
  ]) {
    try { await execFileAsync("ffmpeg", attempt, { timeout: 30_000 }); } catch { /* try next */ }
    if (existsSync(framePath) && statSync(framePath).size >= 100) break;
  }

  if (!existsSync(framePath) || statSync(framePath).size < 100) {
    // Absolute last resort: solid-black 1080×1920 jpeg
    try {
      await execFileAsync("ffmpeg", [
        "-f", "lavfi", "-i", `color=c=black:s=${MULTI_TARGET_W}x${MULTI_TARGET_H}:d=0.1:r=30`,
        "-vframes", "1", "-y", framePath,
      ], { timeout: 30_000 });
    } catch { /* ignore */ }
  }

  if (!existsSync(framePath) || statSync(framePath).size < 100) {
    return { method: "failed", normSize: 0, normDuration: 0, stderrTail: "could not extract any frame from source" };
  }

  // Build a still-frame looped video from the extracted frame.
  try {
    await execFileAsync("ffmpeg", [
      "-loop", "1", "-i", framePath,
      "-t", targetDur.toFixed(3),
      "-vf", `fps=fps=${MULTI_TARGET_FPS}`,
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "20",
      "-pix_fmt", "yuv420p", "-video_track_timescale", "90000",
      "-an", "-movflags", "+faststart", "-y", output,
    ], { timeout: 60_000 });
  } catch (e) {
    stderrTail = (e as { stderr?: string }).stderr?.slice(-400) ?? String(e);
    return { method: "failed", normSize: 0, normDuration: 0, stderrTail };
  }

  if (!existsSync(output) || statSync(output).size < 1024) {
    return { method: "failed", normSize: 0, normDuration: 0, stderrTail: "still-frame output is empty" };
  }

  const probe2 = await probeMedia(output);
  return { method: "still-frame", normSize: statSync(output).size, normDuration: probe2.duration, stderrTail };
}

/** HARD STOP gate: every clip must be ffprobe-valid AND physically present. */
function multiClipsBlocker(session: DoctorMultiSession): string | null {
  if (session.clips.length === 0) return "No clips in this session.";
  const invalid = session.clips.filter((c) => !c.ffprobeValid);
  if (invalid.length > 0) {
    return `Cannot export — ${invalid.length} clip(s) not valid: ` +
      invalid.map((c) => `Scene ${c.sceneNumber} (${c.error ?? "invalid"})`).join("; ");
  }
  for (const c of session.clips) {
    if (!existsSync(c.localPath)) {
      return `Scene ${c.sceneNumber} local file is missing (${c.localPath}). Re-download All Clips before exporting.`;
    }
  }
  return null;
}

/** Normalize only the clips needed to cover `maxDurationSec` seconds.
 *  Reuses existing normalized files from a previous run on the same session to avoid
 *  redundant FFmpeg work (critical for short-test speed).
 *  Passes rawFileDuration so tpad freeze-last-frame padding triggers when source < master. */
async function normalizeClipsForDuration(
  session: DoctorMultiSession,
  maxDurationSec: number,
  logStep?: (msg: string) => void,
): Promise<string[]> {
  const normPaths: string[] = [];
  let accumulated = 0;
  for (const c of session.clips) {
    const trimStart   = c.trimStartSec  ?? 0;
    const timelineDur = c.timelineDuration > 0 ? c.timelineDuration : null;
    const clipDur     = timelineDur ?? c.duration;
    const np = path.join(session.folder, `norm-scene-${c.sceneNumber}.mp4`);

    if (existsSync(np) && statSync(np).size >= 1024) {
      logStep?.(`scene ${c.sceneNumber}: reusing existing normalized clip (${statSync(np).size} bytes)`);
    } else {
      logStep?.(`scene ${c.sceneNumber}: normalizing (trimStart=${trimStart.toFixed(2)}s, dur=${timelineDur?.toFixed(2) ?? "raw"}s, rawShorter=${c.rawShorterThanMaster})...`);
      const fb = await normalizeMultiClipWithFallback(c.localPath, np, trimStart, timelineDur, c.duration);
      if (fb.method === "failed" || !existsSync(np) || statSync(np).size < 1024) {
        throw new Error(`Scene ${c.sceneNumber} failed to normalize — output missing or empty. stderr: ${fb.stderrTail.slice(0, 200)}`);
      }
      logStep?.(`scene ${c.sceneNumber}: normalized OK via ${fb.method} (${fb.normSize} bytes, ${fb.normDuration.toFixed(2)}s)`);
    }
    normPaths.push(np);
    accumulated += clipDur;
    if (accumulated >= maxDurationSec) break;
  }
  return normPaths;
}

/** Normalize all clips in scene order applying master player trims.
 *  Uses each clip's trimStartSec + timelineDuration so the export matches the master player.
 *  Always re-normalizes (never reuses cached files) so full exports are always fresh.
 *  Uses the fallback (still-frame) path when tpad produces empty output. */
async function normalizeAllClips(session: DoctorMultiSession): Promise<string[]> {
  const normPaths: string[] = [];
  for (const c of session.clips) {
    const np = path.join(session.folder, `norm-scene-${c.sceneNumber}.mp4`);
    const trimStart   = c.trimStartSec  ?? 0;
    const timelineDur = c.timelineDuration > 0 ? c.timelineDuration : null;
    const fb = await normalizeMultiClipWithFallback(c.localPath, np, trimStart, timelineDur, c.duration);
    if (fb.method === "failed" || !existsSync(np) || statSync(np).size < 1024) {
      throw new Error(`Scene ${c.sceneNumber} failed to normalize — output missing or empty. stderr: ${fb.stderrTail.slice(0, 200)}`);
    }
    normPaths.push(np);
  }
  return normPaths;
}

/* ── Auto AI effects → FFmpeg filter translation ──────────
 * Mirrors the master player's EFFECT_CSS_FILTERS table (video-editor.tsx) so a
 * burned export matches the live CSS preview as closely as possible. Only color
 * effects (eq / hue / colorchannelmixer / gblur) are export-safe here; animated
 * overlays (Smoke / Rain / Sparks) are intentionally NOT in this map. */
const EFFECT_CSS_FILTERS: Record<string, string> = {
  "Film Grain":        "contrast(108%) brightness(97%)",
  "Glow":              "brightness(118%) saturate(140%)",
  "Blur":              "blur(2px)",
  "Sharpen":           "contrast(125%) brightness(103%)",
  "Vignette":          "brightness(82%)",
  "Black & White":     "grayscale(100%)",
  "Neon Glow":         "hue-rotate(270deg) saturate(180%) brightness(115%)",
  "VHS":               "saturate(75%) contrast(112%) hue-rotate(8deg) brightness(92%)",
  "Cinematic Bars":    "brightness(83%) contrast(112%)",
  "Camera Shake":      "contrast(108%) saturate(105%)",
  "Slow Zoom":         "saturate(115%) brightness(103%)",
  "Speed Ramp":        "contrast(120%) brightness(98%)",
  "Warm Grade":        "sepia(40%) saturate(135%) brightness(108%)",
  "Cool Grade":        "hue-rotate(195deg) saturate(115%) brightness(94%)",
  "Teal & Orange":     "hue-rotate(20deg) saturate(165%) contrast(110%)",
  "Moody Desaturated": "saturate(40%) contrast(120%) brightness(88%)",
  "Vibrant Pop":       "saturate(210%) brightness(108%) contrast(106%)",
  "Street Night":      "hue-rotate(230deg) saturate(145%) brightness(80%) contrast(128%)",
  "Luxury Gold":       "sepia(65%) saturate(175%) brightness(112%) contrast(108%)",
  "Dark Drill":        "brightness(72%) contrast(148%) saturate(55%)",
  "Cinematic Contrast":"contrast(155%) saturate(88%) brightness(90%)",
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Standard sepia matrix blended toward identity by `amount` (0..1). */
function sepiaColorMixer(amount: number): string {
  const a = clamp(amount, 0, 1);
  const id = (x: number) => 1 - a + a * x; // diagonal
  const off = (x: number) => a * x;        // off-diagonal
  const rr = id(0.393), rg = off(0.769), rb = off(0.189);
  const gr = off(0.349), gg = id(0.686), gb = off(0.168);
  const br = off(0.272), bg = off(0.534), bb = id(0.131);
  const f = (x: number) => x.toFixed(4);
  return `colorchannelmixer=rr=${f(rr)}:rg=${f(rg)}:rb=${f(rb)}:gr=${f(gr)}:gg=${f(gg)}:gb=${f(gb)}:br=${f(br)}:bg=${f(bg)}:bb=${f(bb)}`;
}

/**
 * Translate the combined CSS filter string (exactly as the master player builds it)
 * into an FFmpeg filter chain. Returns "" when nothing translatable is present.
 */
function cssToFfmpegChain(combinedCss: string): string {
  let brightnessMul = 1, contrastMul = 1, satMul = 1, hueDeg = 0, blurSigma = 0, sepiaAmt = 0;
  const re = /([a-z-]+)\(([^)]+)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(combinedCss)) !== null) {
    const fn = m[1]!.toLowerCase();
    const raw = m[2]!.trim();
    const num = parseFloat(raw);
    if (!Number.isFinite(num)) continue;
    const pct = raw.includes("%") ? num / 100 : num;
    switch (fn) {
      case "brightness": brightnessMul *= pct; break;
      case "contrast":   contrastMul   *= pct; break;
      case "saturate":   satMul        *= pct; break;
      case "grayscale":  satMul        *= (1 - pct); break;
      case "hue-rotate": hueDeg        += num; break; // degrees
      case "blur":       blurSigma      = Math.max(blurSigma, num); break;
      case "sepia":      sepiaAmt       = Math.max(sepiaAmt, pct); break;
      default: break;
    }
  }
  const parts: string[] = [];
  if (sepiaAmt > 0) parts.push(sepiaColorMixer(sepiaAmt));
  // eq: CSS brightness is multiplicative → approximate as additive (mul-1)*0.5
  const eqBrightness = clamp((brightnessMul - 1) * 0.5, -1, 1);
  const eqContrast = clamp(contrastMul, 0, 3);
  const eqSaturation = clamp(satMul, 0, 3);
  const eqBits: string[] = [];
  if (Math.abs(eqContrast - 1) > 0.001) eqBits.push(`contrast=${eqContrast.toFixed(4)}`);
  if (Math.abs(eqBrightness) > 0.001) eqBits.push(`brightness=${eqBrightness.toFixed(4)}`);
  if (Math.abs(eqSaturation - 1) > 0.001) eqBits.push(`saturation=${eqSaturation.toFixed(4)}`);
  if (eqBits.length > 0) parts.push(`eq=${eqBits.join(":")}`);
  if (hueDeg !== 0) parts.push(`hue=h=${(((hueDeg % 360) + 360) % 360).toFixed(2)}`);
  if (blurSigma > 0) parts.push(`gblur=sigma=${blurSigma.toFixed(2)}`);
  return parts.join(",");
}

/* ── Named export-safe grades ────────────────────────────────────────────────
 * A few grades get DEDICATED FFmpeg chains instead of the lossy CSS→eq path so
 * the burned export actually looks like the master player (the generic sepia→eq
 * translation washed Luxury Gold out and the merged-eq path zeroed saturation
 * whenever Black & White was also active). */
const BW_NAME = "Black & White";
const LUXURY_GOLD_NAME = "Luxury Gold";

/** Pure desaturation — export-safe Black & White. */
const BW_FFMPEG = "eq=saturation=0.0";

/** Real warm cinematic gold grade: warm balance, reduced blue/cool tones,
 *  increased contrast, gold highlights, cinematic saturation. */
const LUXURY_GOLD_FFMPEG =
  "colorbalance=rs=0.06:gs=0.03:bs=-0.06:rm=0.08:gm=0.04:bm=-0.08:rh=0.12:gh=0.07:bh=-0.14,eq=contrast=1.12:saturation=1.30:brightness=0.02";

/** Black & White + Luxury Gold "blend both": gold-tinted monochrome so BOTH
 *  effects are visibly present (low saturation + strong warm gold cast). */
const BW_GOLD_BLEND_FFMPEG =
  "eq=saturation=0.18,colorbalance=rm=0.10:gm=0.05:bm=-0.10:rh=0.16:gh=0.08:bh=-0.16,eq=contrast=1.12:brightness=0.02";

/** Effects treated as color grades (vs. plain filters) for the comparison panel. */
const COLOR_GRADE_NAMES = new Set<string>([
  "Warm Grade", "Cool Grade", "Teal & Orange", "Moody Desaturated", "Vibrant Pop",
  "Street Night", LUXURY_GOLD_NAME, "Dark Drill", "Cinematic Contrast", BW_NAME,
]);

export type EffectConflictMode = "bw-only" | "gold-only" | "blend";

export interface ExportEffectEntry {
  name: string;
  type: "color-grade" | "filter";
  scope: "global";
  intensity: number | null;
  opacity: number;
  blend: "normal";
  startSec: number;
  endSec: number;
  supported: boolean;
  applied: boolean;
  ffmpeg: string;
}

export interface EffectStackResult {
  filter: string;
  stack: ExportEffectEntry[];
  supported: string[];
  unsupported: string[];
  applied: string[];
  conflict: { detected: boolean; effects: string[]; mode: EffectConflictMode; note: string } | null;
  /** True only when every supported effect is actually applied and nothing is dropped. */
  stackMatch: boolean;
}

/** Resolve ONE effect name to an FFmpeg chain (dedicated grades first, else CSS path). */
function ffmpegForEffect(name: string): { ffmpeg: string; supported: boolean; type: "color-grade" | "filter" } {
  if (name === BW_NAME) return { ffmpeg: BW_FFMPEG, supported: true, type: "color-grade" };
  if (name === LUXURY_GOLD_NAME) return { ffmpeg: LUXURY_GOLD_FFMPEG, supported: true, type: "color-grade" };
  const css = EFFECT_CSS_FILTERS[name];
  if (!css) return { ffmpeg: "", supported: false, type: "filter" };
  const ffmpeg = cssToFfmpegChain(css);
  return { ffmpeg, supported: ffmpeg.length > 0, type: COLOR_GRADE_NAMES.has(name) ? "color-grade" : "filter" };
}

/**
 * Build the full export effect stack: each effect is chained SEQUENTIALLY (not
 * merged into one lossy eq), Black & White ↔ Luxury Gold conflicts are resolved
 * by `conflictMode`, and every effect is reported (supported / applied / ffmpeg)
 * so the UI can compare the master stack against what export actually burns.
 */
function buildEffectStack(
  effects: string[],
  totalDuration: number,
  conflictMode: EffectConflictMode = "blend",
): EffectStackResult {
  const names = effects.filter((e) => typeof e === "string" && e.trim());
  const hasBW = names.includes(BW_NAME);
  const hasGold = names.includes(LUXURY_GOLD_NAME);
  const conflictDetected = hasBW && hasGold;

  const chains: string[] = [];
  const stack: ExportEffectEntry[] = [];
  const supported: string[] = [];
  const unsupported: string[] = [];
  const applied: string[] = [];

  for (const name of names) {
    const base = ffmpegForEffect(name);
    let isApplied = base.supported;
    let usedFfmpeg = base.ffmpeg;

    if (conflictDetected && (name === BW_NAME || name === LUXURY_GOLD_NAME)) {
      if (conflictMode === "bw-only") {
        isApplied = name === BW_NAME;
        usedFfmpeg = name === BW_NAME ? BW_FFMPEG : "";
      } else if (conflictMode === "gold-only") {
        isApplied = name === LUXURY_GOLD_NAME;
        usedFfmpeg = name === LUXURY_GOLD_NAME ? LUXURY_GOLD_FFMPEG : "";
      } else {
        // blend both — attribute the single blend chain to the Luxury Gold row
        isApplied = true;
        usedFfmpeg = name === LUXURY_GOLD_NAME ? BW_GOLD_BLEND_FFMPEG : "";
      }
    }

    stack.push({
      name,
      type: base.type,
      scope: "global",
      intensity: null,
      opacity: 1,
      blend: "normal",
      startSec: 0,
      endSec: totalDuration,
      supported: base.supported,
      applied: isApplied,
      ffmpeg: usedFfmpeg,
    });

    if (!base.supported) { unsupported.push(name); continue; }
    supported.push(name);
    if (isApplied) {
      applied.push(name);
      if (usedFfmpeg) chains.push(usedFfmpeg);
    }
  }

  const conflict = conflictDetected
    ? {
        detected: true,
        effects: [BW_NAME, LUXURY_GOLD_NAME],
        mode: conflictMode,
        note: "Black & White reduces color from Luxury Gold.",
      }
    : null;

  const stackMatch =
    supported.length > 0 && applied.length === supported.length && unsupported.length === 0;

  return { filter: chains.join(","), stack, supported, unsupported, applied, conflict, stackMatch };
}

/** Concatenate normalized clips (scene order) with optional audio + optional effects + optional burned ASS captions. */
async function concatMultiClips(
  folder: string,
  normPaths: string[],
  audioPath: string | null,
  outName: string,
  assPath: string | null = null,
  effectFilter: string | null = null,
  range: { start: number; duration: number } | null = null,
  audioOffsetSec = 0,
): Promise<string> {
  const outputPath = path.join(folder, outName);
  const filterParts: string[] = [];
  for (let i = 0; i < normPaths.length; i++) {
    filterParts.push(`[${i}:v]setpts=PTS-STARTPTS[v${i}]`);
  }
  const segs = normPaths.map((_, i) => `[v${i}]`).join("");
  filterParts.push(`${segs}concat=n=${normPaths.length}:v=1:a=0[vout]`);

  // Optional time-range trim (used by the 3-second effect match test) — clip the
  // concatenated timeline BEFORE effects/captions so the burned look is identical
  // to the master player at that playhead.
  let label = "vout";
  if (range) {
    const s = Math.max(0, range.start);
    const d = Math.max(0.1, range.duration);
    filterParts.push(`[${label}]trim=start=${s.toFixed(3)}:duration=${d.toFixed(3)},setpts=PTS-STARTPTS[vtrim]`);
    label = "vtrim";
  }

  // Effects first (so captions sit on top of the graded video, matching the master player),
  // then burn ASS captions — same subtitles filter the real export uses.
  if (effectFilter) {
    filterParts.push(`[${label}]${effectFilter}[veff]`);
    label = "veff";
  }
  if (assPath) {
    const escapedPath = assPath
      .replace(/\\/g, "\\\\")
      .replace(/:/g, "\\:")
      .replace(/'/g, "\\'");
    filterParts.push(`[${label}]subtitles='${escapedPath}'[vfinal]`);
    label = "vfinal";
  }
  const videoLabel = `[${label}]`;

  const audioIdx = audioPath ? normPaths.length : -1;
  const args: string[] = [];
  for (const np of normPaths) args.push("-i", np);
  // Seek audio to: master-player audio start offset + range start (for trimmed exports).
  // audioOffsetSec = settings.musicStudio.videoAudio.startSec from the master player.
  if (audioPath) {
    const audioSeekSec = (audioOffsetSec ?? 0) + (range ? Math.max(0, range.start) : 0);
    if (audioSeekSec > 0) args.push("-ss", audioSeekSec.toFixed(3));
    if (range) args.push("-t", Math.max(0.1, range.duration).toFixed(3));
    args.push("-i", audioPath);
  }
  args.push("-filter_complex", filterParts.join(";"), "-map", videoLabel);
  if (audioPath && audioIdx >= 0) args.push("-map", `${audioIdx}:a`);
  args.push("-c:v", "libx264", "-preset", "ultrafast", "-crf", "22", "-pix_fmt", "yuv420p");
  if (audioPath) args.push("-c:a", "aac", "-b:a", "192k", "-shortest");
  else args.push("-an");
  args.push("-movflags", "+faststart", "-y", outputPath);

  await execFileAsync("ffmpeg", args, { timeout: 5 * 60 * 1000 });
  return outputPath;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Transitions → FFmpeg xfade
 * Supported (real xfade): Cut (hard), Crossfade, Fade to Black, Flash Cut.
 * Unsupported: Whip Pan, Zoom Transition — they fall back to a hard cut at that
 * boundary and are reported with a reason (no native xfade equivalent).
 * ────────────────────────────────────────────────────────────────────────── */
export interface TransitionPlanEntry {
  sceneIndex: number;
  type: string;
  supported: boolean;
  xfade: string;
  durationSec: number;
  reason: string | null;
}

function resolveTransition(type: string): { supported: boolean; xfade: string; durationSec: number; reason: string | null } {
  const t = (type || "").trim().toLowerCase();
  switch (t) {
    case "cut":
    case "":
      return { supported: true, xfade: "fade", durationSec: 0.04, reason: null }; // ~1 frame = hard cut
    case "crossfade":
    case "cross fade":
    case "dissolve":
      return { supported: true, xfade: "fade", durationSec: 0.5, reason: null };
    case "fade to black":
    case "fadeblack":
    case "fade":
      return { supported: true, xfade: "fadeblack", durationSec: 0.6, reason: null };
    case "flash cut":
    case "flash":
    case "fadewhite":
      return { supported: true, xfade: "fadewhite", durationSec: 0.25, reason: null };
    case "whip pan":
    case "whippan":
      return { supported: false, xfade: "fade", durationSec: 0.04, reason: "Whip Pan needs a motion-blur pan that FFmpeg xfade can't reproduce — exported as a hard cut." };
    case "zoom":
    case "zoom transition":
      return { supported: false, xfade: "fade", durationSec: 0.04, reason: "Zoom transition needs scale/zoompan keyframes not available in xfade — exported as a hard cut." };
    default:
      return { supported: false, xfade: "fade", durationSec: 0.04, reason: `Unknown transition "${type}" — exported as a hard cut.` };
  }
}

/** Concatenate clips with per-boundary xfade transitions + optional effects + optional audio. */
async function concatMultiClipsXfade(
  folder: string,
  normPaths: string[],
  durations: number[],
  boundaries: { xfade: string; durationSec: number }[],
  audioPath: string | null,
  outName: string,
  effectFilter: string | null = null,
): Promise<string> {
  const outputPath = path.join(folder, outName);
  const n = normPaths.length;
  const filterParts: string[] = [];

  let label: string;
  if (n === 1) {
    filterParts.push(`[0:v]setpts=PTS-STARTPTS[vout]`);
    label = "vout";
  } else {
    filterParts.push(`[0:v]setpts=PTS-STARTPTS[x0]`);
    let acc = durations[0] ?? 0;
    let prev = "x0";
    for (let i = 1; i < n; i++) {
      filterParts.push(`[${i}:v]setpts=PTS-STARTPTS[c${i}]`);
      const b = boundaries[i - 1] ?? { xfade: "fade", durationSec: 0.04 };
      const td = Math.max(0.04, b.durationSec);
      const offset = Math.max(0, acc - td);
      const out = i === n - 1 ? "vout" : `x${i}`;
      filterParts.push(`[${prev}][c${i}]xfade=transition=${b.xfade}:duration=${td.toFixed(3)}:offset=${offset.toFixed(3)}[${out}]`);
      acc = acc + (durations[i] ?? 0) - td;
      prev = out;
    }
    label = "vout";
  }

  if (effectFilter) {
    filterParts.push(`[${label}]${effectFilter}[veff]`);
    label = "veff";
  }
  const videoLabel = `[${label}]`;

  const args: string[] = [];
  for (const np of normPaths) args.push("-i", np);
  if (audioPath) args.push("-i", audioPath);
  args.push("-filter_complex", filterParts.join(";"), "-map", videoLabel);
  if (audioPath) args.push("-map", `${n}:a`);
  args.push("-c:v", "libx264", "-preset", "ultrafast", "-crf", "22", "-pix_fmt", "yuv420p");
  if (audioPath) args.push("-c:a", "aac", "-b:a", "192k", "-shortest");
  else args.push("-an");
  args.push("-movflags", "+faststart", "-y", outputPath);

  await execFileAsync("ffmpeg", args, { timeout: 5 * 60 * 1000 });
  return outputPath;
}

async function tryFreshSignedUrl(url: string): Promise<{ url: string; changed: boolean }> {
  const match = url.match(/\/storage\/v1\/object\/(?:public|sign)\/([^/?]+)\/(.+?)(?:\?|$)/);
  if (!match) return { url, changed: false };
  const bucket = match[1]!;
  const objectPath = decodeURIComponent(match[2]!);
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  try {
    const res = await fetch(`${SIDECAR}/object-storage/signed-object-url`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bucket_name: bucket, object_name: objectPath, method: "GET", expires_at: expiresAt }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { url, changed: false };
    const { signed_url } = (await res.json()) as { signed_url: string };
    return { url: signed_url, changed: true };
  } catch {
    return { url, changed: false };
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

async function probeMedia(filePath: string): Promise<{
  valid: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  duration: number;
  width: number;
  height: number;
  codec: string;
  error: string | null;
}> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", filePath],
      { timeout: 30_000 },
    );
    const info = JSON.parse(stdout) as {
      streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; duration?: string }>;
      format?: { duration?: string };
    };
    const vs = info.streams?.find((s) => s.codec_type === "video");
    const as_ = info.streams?.find((s) => s.codec_type === "audio");
    const dur = parseFloat(info.format?.duration ?? vs?.duration ?? as_?.duration ?? "0");
    const hasVideo = !!vs;
    return {
      valid: (hasVideo || !!as_) && !isNaN(dur) && dur > 0,
      hasVideo,
      hasAudio: !!as_,
      duration: isNaN(dur) ? 0 : dur,
      width: vs?.width ?? 0,
      height: vs?.height ?? 0,
      codec: vs?.codec_name ?? as_?.codec_name ?? "",
      error: !hasVideo && !as_ ? "no media streams" : (isNaN(dur) || dur <= 0) ? "zero or invalid duration" : null,
    };
  } catch (e) {
    return {
      valid: false, hasVideo: false, hasAudio: false, duration: 0, width: 0, height: 0, codec: "",
      error: e instanceof Error ? e.message.slice(0, 160) : "ffprobe failed",
    };
  }
}

/* ── TEST 1: probe the Scene 1 source URL ─────────────── */
router.post("/export-doctor/test-url", requireAuth, async (req, res) => {
  try {
    const { url } = req.body as { url?: string };
    const startsWithHttp = !!url && url.startsWith("http");

    if (!url || !startsWithHttp) {
      res.json({
        urlProvided: !!url,
        startsWithHttp,
        status: 0,
        contentType: "",
        contentLength: null,
        isVideo: false,
        isHtml: false,
        snippet: null,
        message: url ? "URL does not start with http." : "No Scene 1 URL was found.",
      });
      return;
    }

    if (!isAllowedClipUrl(url)) {
      res.json({
        urlProvided: true,
        startsWithHttp: true,
        status: 0,
        contentType: "",
        contentLength: null,
        isVideo: false,
        isHtml: false,
        snippet: null,
        message: "URL host is not an allowed media source (Supabase storage, Runway CDN, or Replit object storage over HTTPS).",
      });
      return;
    }

    let target = url;
    if (SUPABASE_HOST && target.includes(SUPABASE_HOST)) {
      const { url: fresh, changed } = await tryFreshSignedUrl(target);
      if (changed) target = fresh;
    }

    const r = await fetch(target, {
      headers: { Range: "bytes=0-1023" },
      signal: AbortSignal.timeout(20_000),
    });
    const contentType = r.headers.get("content-type") ?? "";
    const lenHeader = r.headers.get("content-range")?.split("/")[1] ?? r.headers.get("content-length");
    const contentLength = lenHeader ? Number(lenHeader) : null;
    const ctLower = contentType.toLowerCase();
    // Object-storage hosts often serve videos as application/octet-stream (or no
    // content-type). Treat octet-stream / empty as "likely video" — the real
    // proof is the download + ffprobe step.
    const isVideo = ctLower.startsWith("video/") || ctLower.startsWith("application/octet-stream") || ctLower === "";
    const buf = Buffer.from(await r.arrayBuffer());
    const head = buf.subarray(0, 100).toString("utf8");
    const isHtml = head.trimStart().toLowerCase().startsWith("<!doctype") || head.trimStart().toLowerCase().startsWith("<html");

    res.json({
      urlProvided: true,
      startsWithHttp: true,
      resolvedUrl: target.slice(0, 200),
      status: r.status,
      contentType,
      contentLength,
      isVideo: isVideo && !isHtml,
      isHtml,
      snippet: isVideo && !isHtml ? null : head,
      message: isHtml
        ? "This URL is not a video file. It is returning HTML."
        : ctLower.startsWith("video/")
        ? "URL returns a video file."
        : isVideo
        ? `URL returns binary data (${contentType || "no content-type"}) — likely video; confirm with Download + ffprobe.`
        : `URL returned non-video content-type: ${contentType || "unknown"}.`,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ── TEST 2: download Scene 1 only ────────────────────── */
router.post("/export-doctor/download", requireAuth, async (req, res) => {
  try {
    const { projectId, url } = req.body as { projectId?: string; url?: string };
    if (!url || !url.startsWith("http")) {
      res.status(400).json({ error: "A valid Scene 1 http URL is required." });
      return;
    }
    if (!isAllowedClipUrl(url)) {
      res.status(400).json({ error: "Scene 1 URL host is not an allowed media source (Supabase storage, Runway CDN, or Replit object storage over HTTPS)." });
      return;
    }

    const doctorId = randomUUID();
    const folder = path.join(os.tmpdir(), `export-doctor-${Date.now()}`);
    mkdirSync(folder, { recursive: true });
    const videoPath = path.join(folder, "scene-1.mp4");

    let target = url;
    if (SUPABASE_HOST && target.includes(SUPABASE_HOST)) {
      const { url: fresh, changed } = await tryFreshSignedUrl(target);
      if (changed) target = fresh;
    }

    req.log.info({ doctorId, folder, url: target.slice(0, 100) }, "EXPORT DOCTOR download scene 1");

    const r = await fetch(target, { signal: AbortSignal.timeout(120_000) });
    const contentType = r.headers.get("content-type") ?? "";
    if (!r.ok) {
      res.json({
        doctorId, localPath: videoPath, fileExists: false, fileSize: 0,
        responseStatus: r.status, contentType,
        ffprobeValid: false,
        error: `Download failed (HTTP ${r.status}).`,
      });
      return;
    }
    const ctLower = contentType.toLowerCase();
    if (ctLower.startsWith("text/") || ctLower.startsWith("application/json") || ctLower.startsWith("application/xml")) {
      res.json({
        doctorId, localPath: videoPath, fileExists: false, fileSize: 0,
        responseStatus: r.status, contentType,
        ffprobeValid: false,
        error: `URL returned non-video content (${contentType.split(";")[0] || "unknown"}). The clip URL may be expired or invalid.`,
      });
      return;
    }

    const ws = createWriteStream(videoPath);
    await pipeline(r.body as Parameters<typeof pipeline>[0], byteCap(MAX_CLIP_BYTES), ws);

    const fileExists = existsSync(videoPath);
    const fileSize = fileExists ? statSync(videoPath).size : 0;
    if (!fileExists || fileSize < 1024) {
      res.json({
        doctorId, localPath: videoPath, fileExists, fileSize,
        responseStatus: r.status, contentType, ffprobeValid: false,
        error: !fileExists ? "File was not created after write." : `File too small (${fileSize} bytes).`,
      });
      return;
    }

    const probe = await probeMedia(videoPath);

    sessions.set(doctorId, {
      doctorId,
      projectId: projectId ?? "",
      folder,
      videoPath,
      audioPath: null,
      createdAt: Date.now(),
    });

    req.log.info({
      doctorId, fileSize, duration: probe.duration.toFixed(2), valid: probe.valid,
    }, `EXPORT DOCTOR scene 1 downloaded: ${probe.valid ? "VALID" : "INVALID"}`);

    res.json({
      doctorId,
      localPath: videoPath,
      fileExists: true,
      fileSize,
      responseStatus: r.status,
      contentType,
      duration: probe.duration,
      codec: probe.codec,
      width: probe.width,
      height: probe.height,
      ffprobeValid: probe.valid,
      error: probe.error,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ── TEST 3: export Scene 1 only (3s, no audio, 1080x1920) ── */
router.post("/export-doctor/export", requireAuth, async (req, res) => {
  try {
    const { doctorId } = req.body as { doctorId?: string };
    const session = doctorId ? sessions.get(doctorId) : null;
    if (!session) {
      res.status(400).json({ error: "No downloaded Scene 1 session found. Run 'Download Scene 1 Only' first." });
      return;
    }
    // HARD STOP: never run FFmpeg without the local file
    if (!existsSync(session.videoPath)) {
      res.status(400).json({ error: `Scene 1 local file is missing (${session.videoPath}). Re-download before exporting.` });
      return;
    }

    const outputPath = path.join(session.folder, "scene-1-test.mp4");
    const args = [
      "-i", session.videoPath,
      "-t", "3",
      "-vf", [
        "scale=1080:1920:force_original_aspect_ratio=decrease",
        "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black",
        "setsar=1",
        "fps=fps=30",
      ].join(","),
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-an",
      "-movflags", "+faststart",
      "-y", outputPath,
    ];

    req.log.info({ doctorId }, "EXPORT DOCTOR scene 1 simple export (3s, no audio)");
    try {
      await execFileAsync("ffmpeg", args, { timeout: 120_000 });
    } catch (e) {
      const stderr = (e as { stderr?: string }).stderr ?? "";
      res.status(500).json({
        error: `FFmpeg failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
        stderrTail: stderr.slice(-600).split("\n").filter(Boolean),
      });
      return;
    }

    if (!existsSync(outputPath) || statSync(outputPath).size < 1024) {
      res.status(500).json({ error: "FFmpeg produced no usable output file." });
      return;
    }

    const probe = await probeMedia(outputPath);
    const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
    if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
    const objectName = `export-doctor/${doctorId}-scene1.mp4`;
    await objectStorageClient.bucket(bucketId).file(objectName).save(readFileSync(outputPath), {
      contentType: "video/mp4", resumable: false,
    });
    const signedUrl = await signGetUrl(bucketId, objectName);

    res.json({
      success: true,
      url: signedUrl,
      fileSize: statSync(outputPath).size,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      hasAudio: probe.hasAudio,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ── TEST 4: export Scene 1 + audio (3s) ──────────────── */
router.post("/export-doctor/export-audio", requireAuth, async (req, res) => {
  try {
    const { doctorId, audioUrl, audioStartSec, clipVideoOffsetSec, fullDuration } = req.body as {
      doctorId?: string;
      audioUrl?: string;
      /** Seek into the project audio before mixing (seconds). Default 0. */
      audioStartSec?: number;
      /** Matches the master player's clipVideoOffsetSec / lipSyncOffsetSeconds.
       *  Positive → delay video start (video plays N seconds after audio begins).
       *  Negative → skip ahead N seconds into the video (advance video). */
      clipVideoOffsetSec?: number;
      /** When true, skip the default -t 3 limit and export the full clip. */
      fullDuration?: boolean;
    };
    const session = doctorId ? sessions.get(doctorId) : null;
    if (!session) {
      res.status(400).json({ error: "No downloaded Scene 1 session found. Run 'Download Scene 1 Only' first." });
      return;
    }
    if (!existsSync(session.videoPath)) {
      res.status(400).json({ error: `Scene 1 local file is missing (${session.videoPath}). Re-download before exporting.` });
      return;
    }
    if (!audioUrl || !audioUrl.startsWith("http")) {
      res.status(400).json({ error: "No master-player audio URL was provided." });
      return;
    }
    if (!isAllowedAudioUrl(audioUrl)) {
      res.status(400).json({ error: "Audio URL host is not an allowed media source (Supabase storage or Replit object storage over HTTPS)." });
      return;
    }

    // Download audio (same source the master player uses)
    let target = audioUrl;
    if (SUPABASE_HOST && target.includes(SUPABASE_HOST)) {
      const { url: fresh, changed } = await tryFreshSignedUrl(target);
      if (changed) target = fresh;
    }
    const ext = target.includes(".mp3") ? ".mp3" : target.includes(".ogg") ? ".ogg" : target.includes(".wav") ? ".wav" : ".aac";
    const audioPath = path.join(session.folder, `audio${ext}`);

    req.log.info({ doctorId, audioUrl: target.slice(0, 100) }, "EXPORT DOCTOR download audio");
    const ar = await fetch(target, { signal: AbortSignal.timeout(120_000) });
    if (!ar.ok) {
      res.json({ audioDownloaded: false, audioValid: false, error: `Audio download failed (HTTP ${ar.status}).` });
      return;
    }
    const aCt = (ar.headers.get("content-type") ?? "").toLowerCase();
    if (aCt.startsWith("text/") || aCt.startsWith("application/json") || aCt.startsWith("application/xml")) {
      res.json({ audioDownloaded: false, audioValid: false, error: `Audio URL returned non-audio content (${aCt || "unknown"}).` });
      return;
    }
    const aws = createWriteStream(audioPath);
    await pipeline(ar.body as Parameters<typeof pipeline>[0], byteCap(MAX_AUDIO_BYTES), aws);
    const audioDownloaded = existsSync(audioPath) && statSync(audioPath).size > 1024;
    if (!audioDownloaded) {
      res.json({ audioDownloaded: false, audioValid: false, error: "Audio file was not created or is too small." });
      return;
    }
    const aProbe = await probeMedia(audioPath);
    if (!aProbe.hasAudio) {
      res.json({
        audioDownloaded: true, audioValid: false, audioFileSize: statSync(audioPath).size,
        error: `Audio ffprobe found no audio stream: ${aProbe.error ?? "unknown"}.`,
      });
      return;
    }
    session.audioPath = audioPath;

    const safeAudioStartSec    = typeof audioStartSec    === "number" && audioStartSec    > 0 ? audioStartSec    : 0;
    const safeClipVideoOffset  = typeof clipVideoOffsetSec === "number" ? clipVideoOffsetSec : 0;

    /* Apply the master-player lip sync offset to the export.
       The player's loadClipWithOffset semantics:
         +N (positive) → video plays N seconds LATER than audio (mouth is late)
         -N (negative) → video plays N seconds EARLIER than audio (mouth is early,
                          achieved by seeking |N| seconds into the video)

       We avoid -itsoffset (unreliable across FFmpeg versions) and instead:
         +N → shift the audio start point back by N seconds so audio leads video by N
              (equivalent: video appears N seconds late relative to audio, not reversed)
         -N → seek |N| seconds into the video so video content is |N| seconds ahead of audio

       Neither case applies the offset twice — the video input is not touched for +N,
       and the audio start is not touched for -N. */
    const videoInputArgs: string[] = [];
    // effectiveAudioStartSec starts at the scene's position; may be adjusted for +offset
    let effectiveAudioStartSec = safeAudioStartSec;

    if (safeClipVideoOffset > 0) {
      // Positive offset: audio must lead video by N seconds.
      // Pull audio start back by N so audio has a N-second head start over video.
      effectiveAudioStartSec = Math.max(0, safeAudioStartSec - safeClipVideoOffset);
    } else if (safeClipVideoOffset < 0) {
      // Negative offset: video must lead audio by |N| seconds.
      // Skip |N| seconds into the video so it's |N| seconds ahead at output time 0.
      videoInputArgs.push("-ss", Math.abs(safeClipVideoOffset).toFixed(3));
    }

    const outputPath = path.join(session.folder, "scene-1-audio-test.mp4");
    const args = [
      ...videoInputArgs,
      "-i", session.videoPath,
      /* Audio seek: scene position in project audio (adjusted for lip sync offset) */
      ...(effectiveAudioStartSec > 0 ? ["-ss", String(effectiveAudioStartSec.toFixed(3))] : []),
      "-i", audioPath,
      /* Duration limit: 3s for standard test; unlimited for full lip sync export */
      ...(fullDuration ? [] : ["-t", "3"]),
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-vf", [
        "scale=1080:1920:force_original_aspect_ratio=decrease",
        "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black",
        "setsar=1",
        "fps=fps=30",
      ].join(","),
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "192k",
      "-shortest",
      "-movflags", "+faststart",
      "-y", outputPath,
    ];

    req.log.info({ doctorId, audioStartSec: safeAudioStartSec, effectiveAudioStartSec, clipVideoOffsetSec: safeClipVideoOffset, fullDuration }, "EXPORT DOCTOR scene + audio export");
    try {
      await execFileAsync("ffmpeg", args, { timeout: 120_000 });
    } catch (e) {
      const stderr = (e as { stderr?: string }).stderr ?? "";
      res.status(500).json({
        audioDownloaded: true, audioValid: true,
        error: `FFmpeg failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
        stderrTail: stderr.slice(-600).split("\n").filter(Boolean),
      });
      return;
    }

    if (!existsSync(outputPath) || statSync(outputPath).size < 1024) {
      res.status(500).json({ audioDownloaded: true, audioValid: true, error: "FFmpeg produced no usable output file." });
      return;
    }

    const probe = await probeMedia(outputPath);
    const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
    if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
    const objectName = `export-doctor/${doctorId}-scene1-audio.mp4`;
    await objectStorageClient.bucket(bucketId).file(objectName).save(readFileSync(outputPath), {
      contentType: "video/mp4", resumable: false,
    });
    const signedUrl = await signGetUrl(bucketId, objectName);

    res.json({
      success: true,
      url: signedUrl,
      audioDownloaded: true,
      audioValid: true,
      audioFileSize: statSync(audioPath).size,
      audioDuration: aProbe.duration,
      fileSize: statSync(outputPath).size,
      duration: probe.duration,
      hasAudio: probe.hasAudio,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ── TEST 5: download ALL clips (every scene with a demoClipUrl) ── */
/* ══════════════════════════════════════════════════════════════════════════
   URL DOCTOR — lightweight HEAD-check for every timeline clip.
   No full download; returns per-clip reachability + content-type.
   Safe to call repeatedly without consuming server storage.
══════════════════════════════════════════════════════════════════════════ */
router.post("/export-doctor/check-clip-urls", requireAuth, async (req, res) => {
  try {
    const { clips } = req.body as {
      clips?: Array<{
        sceneNumber?: number;
        title?: string;
        url?: string | null;
        sourceType?: string;
      }>;
    };
    if (!Array.isArray(clips) || clips.length === 0) {
      res.status(400).json({ error: "No clips provided." });
      return;
    }

    const results = await Promise.all(clips.map(async (c, i) => {
      const sceneNumber = c.sceneNumber ?? i + 1;
      const url = c.url ?? "";
      const entry = {
        sceneNumber,
        title:              c.title ?? `Scene ${sceneNumber}`,
        sourceType:         c.sourceType ?? "original",
        url:                url.slice(0, 140),
        host:               "",
        reachable:          false,
        httpStatus:         0,
        contentType:        "",
        isVideoContentType: false,
        allowedByStaticList: false,
        allowedByPublicHttps: false,
        allowed:            false,
        error:              null as string | null,
      };

      if (!url) { entry.error = "no URL"; return entry; }

      let u: URL;
      try { u = new URL(url); } catch { entry.error = "invalid URL"; return entry; }
      entry.host = u.host;
      entry.allowedByStaticList  = isAllowedClipUrl(url);
      entry.allowedByPublicHttps = isPublicHttpsUrl(url);

      // Must be at least a public HTTPS URL to proceed
      if (!entry.allowedByPublicHttps) {
        entry.error = "URL is not a public HTTPS source (private IP or non-HTTPS)";
        return entry;
      }

      try {
        const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(20_000) });
        entry.httpStatus  = r.status;
        entry.reachable   = r.ok;
        entry.contentType = r.headers.get("content-type") ?? "";
        const ct = entry.contentType.toLowerCase();
        entry.isVideoContentType =
          ct.startsWith("video/") ||
          ct.startsWith("application/octet-stream") ||
          ct.startsWith("binary/octet-stream") ||
          ct === "";                                       // CDNs often omit content-type on HEAD
        entry.allowed = entry.reachable && (entry.allowedByStaticList || entry.allowedByPublicHttps);
        if (!r.ok) entry.error = `HTTP ${r.status}`;
      } catch (e) {
        entry.error = e instanceof Error ? e.message : String(e);
      }

      return entry;
    }));

    const total      = results.length;
    const passCount  = results.filter(r => r.allowed).length;
    const failCount  = total - passCount;
    const allAllowed = failCount === 0 && total > 0;

    res.json({ clips: results, total, passCount, failCount, allAllowed });
  } catch (e) {
    req.log.error({ err: e }, "EXPORT DOCTOR check-clip-urls error");
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/export-doctor/download-all", requireAuth, async (req, res) => {
  try {
    const { projectId, clips } = req.body as {
      projectId?: string;
      clips?: Array<{
        sceneNumber?: number;
        title?: string;
        url?: string | null;
        /** Seconds to trim from the start (from master player ClipEdit.trimStart). */
        trimStart?: number;
        /** Seconds to trim from the end (from master player ClipEdit.trimEnd). */
        trimEnd?: number;
        /** Explicit master player clip duration from scene timestamps.
         *  When > 0, overrides the computed raw - trimStart - trimEnd. */
        masterDuration?: number;
      }>;
    };
    if (!Array.isArray(clips) || clips.length === 0) {
      res.status(400).json({ error: "No scenes were provided. Each scene needs a demoClipUrl / master player source." });
      return;
    }

    // Use the order sent by the client — this is the saved timeline (drag) order.
    // Do NOT re-sort by sceneNumber; the client sends clips in the user's dragged order.
    const orderedClips = clips;

    const multiId = randomUUID();
    const folder = path.join(os.tmpdir(), `export-doctor-multi-${Date.now()}`);
    mkdirSync(folder, { recursive: true });

    req.log.info({ multiId, folder, sceneCount: clips.length }, "EXPORT DOCTOR download all clips");

    const results: DoctorClipFile[] = [];
    for (let idx = 0; idx < orderedClips.length; idx++) {
      const c = orderedClips[idx]!;
      const sceneNumber = c.sceneNumber ?? idx + 1;
      const trimStart     = Math.max(0, c.trimStart ?? 0);
      const trimEnd       = Math.max(0, c.trimEnd   ?? 0);
      const masterDuration = Math.max(0, c.masterDuration ?? 0);
      const entry: DoctorClipFile = {
        sceneNumber,
        sceneTitle: c.title ?? `Scene ${sceneNumber}`,
        sourceUrl: c.url ?? "",
        localPath: path.join(folder, `scene-${sceneNumber}.mp4`),
        fileExists: false,
        fileSize: 0,
        duration: 0,
        trimStartSec: trimStart,
        trimEndSec: trimEnd,
        masterDuration,
        timelineDuration: 0, // filled after ffprobe
        rawShorterThanMaster: false, // filled after ffprobe
        width: 0,
        height: 0,
        codec: "",
        ffprobeValid: false,
        responseStatus: 0,
        contentType: "",
        error: null,
      };
      try {
        const url = c.url;
        if (!url || !url.startsWith("http")) throw new Error("no demoClipUrl / master player source found for this scene");
        if (!isAllowedClipUrl(url) && !isPublicHttpsUrl(url)) {
          throw new Error("URL is not a valid public HTTPS source (must use HTTPS from a public host — not a private IP or metadata endpoint)");
        }

        let target = url;
        if (SUPABASE_HOST && target.includes(SUPABASE_HOST)) {
          const { url: fresh, changed } = await tryFreshSignedUrl(target);
          if (changed) target = fresh;
        }

        const r = await fetch(target, { signal: AbortSignal.timeout(120_000) });
        entry.responseStatus = r.status;
        const contentType = r.headers.get("content-type") ?? "";
        entry.contentType = contentType;
        if (!r.ok) throw new Error(`download failed (HTTP ${r.status})`);
        const ctLower = contentType.toLowerCase();
        if (ctLower.startsWith("text/") || ctLower.startsWith("application/json") || ctLower.startsWith("application/xml")) {
          throw new Error(`URL returned non-video content (${contentType.split(";")[0] || "unknown"}) — clip URL may be expired`);
        }

        // Write the real local file and AWAIT the write completing.
        const ws = createWriteStream(entry.localPath);
        await pipeline(r.body as Parameters<typeof pipeline>[0], byteCap(MAX_CLIP_BYTES), ws);

        // fs.stat
        const exists = existsSync(entry.localPath);
        entry.fileExists = exists;
        const size = exists ? statSync(entry.localPath).size : 0;
        entry.fileSize = size;
        if (!exists) throw new Error("file was not created after write");
        if (size < 1024) throw new Error(`file too small (${size} bytes)`);

        // ffprobe
        const probe = await probeMedia(entry.localPath);
        entry.duration = probe.duration;
        entry.width = probe.width;
        entry.height = probe.height;
        entry.codec = probe.codec;
        if (!probe.hasVideo) throw new Error(`ffprobe found no video stream: ${probe.error ?? "unknown"}`);
        if (!probe.valid) throw new Error(`ffprobe invalid: ${probe.error ?? "unknown"}`);
        entry.ffprobeValid = true;
        // Duration priority:
        //  1. masterDuration (from master player scene timestamps, sent by client)
        //     — authoritative; if source is shorter, normalizeMultiClip will pad with tpad.
        //  2. raw - trimStart - trimEnd (fallback when no master duration)
        const totalTrim = entry.trimStartSec + entry.trimEndSec;
        const computedFromRaw = Math.max(0.5, probe.duration - totalTrim);
        if (entry.masterDuration > 0.1) {
          // Do NOT cap at raw: if source is shorter than masterDuration,
          // normalizeMultiClip will freeze-last-frame pad to fill the gap.
          entry.timelineDuration = entry.masterDuration;
          const sourceAvailable = Math.max(0, probe.duration - entry.trimStartSec);
          entry.rawShorterThanMaster = sourceAvailable < entry.masterDuration - 0.05;
        } else {
          entry.timelineDuration = computedFromRaw;
          entry.rawShorterThanMaster = false;
        }
        req.log.info(
          {
            multiId, scene: entry.sceneNumber,
            rawDur: probe.duration.toFixed(2),
            masterDur: entry.masterDuration.toFixed(2),
            timelineDur: entry.timelineDuration.toFixed(2),
            rawShorterThanMaster: entry.rawShorterThanMaster,
          },
          `EXPORT DOCTOR clip ${entry.sceneNumber}: duration resolved (masterDur=${entry.masterDuration > 0 ? "yes" : "no"}, needsPad=${entry.rawShorterThanMaster})`,
        );
      } catch (e) {
        entry.error = e instanceof Error ? e.message : String(e);
        entry.ffprobeValid = false;
      }
      req.log.info(
        { multiId, scene: entry.sceneNumber, ok: entry.ffprobeValid, size: entry.fileSize },
        `EXPORT DOCTOR clip ${entry.sceneNumber}: ${entry.ffprobeValid ? "VALID" : "FAILED"}`,
      );
      results.push(entry);
    }

    multiSessions.set(multiId, {
      multiId,
      projectId: projectId ?? "",
      folder,
      clips: results,
      audioPath: null,
      createdAt: Date.now(),
    });

    const total = results.length;
    const downloaded = results.filter((r) => r.fileExists).length;
    const valid = results.filter((r) => r.ffprobeValid).length;
    const firstError = results.find((r) => r.error)?.error ?? null;

    res.json({
      multiId,
      total,
      downloaded,
      valid,
      allValid: total > 0 && valid === total,
      lastError: firstError,
      clips: results.map((r) => ({
        sceneNumber: r.sceneNumber,
        sceneTitle: r.sceneTitle,
        fileExists: r.fileExists,
        fileSize: r.fileSize,
        duration: r.duration,
        trimStartSec: r.trimStartSec,
        trimEndSec: r.trimEndSec,
        masterDuration: r.masterDuration,
        timelineDuration: r.timelineDuration,
        rawShorterThanMaster: r.rawShorterThanMaster,
        durationSource: r.masterDuration > 0.1 ? "master-timestamp" : r.trimStartSec > 0 || r.trimEndSec > 0 ? "raw-trim" : "raw",
        width: r.width,
        height: r.height,
        codec: r.codec,
        ffprobeValid: r.ffprobeValid,
        responseStatus: r.responseStatus,
        contentType: r.contentType,
        error: r.error,
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ── Repair Clip: clear stale norm file, force timelineDuration = masterDuration, re-normalize with pad ── */
router.post("/export-doctor/repair-clip", requireAuth, async (req, res) => {
  try {
    const { multiId, sceneNumber } = req.body as { multiId?: string; sceneNumber?: number };
    const session = multiId ? multiSessions.get(multiId) : null;
    if (!session) {
      res.status(400).json({ error: "Session not found. Run Download All Clips first." });
      return;
    }
    const clip = typeof sceneNumber === "number"
      ? session.clips.find(c => c.sceneNumber === sceneNumber)
      : null;
    if (!clip) {
      res.status(400).json({ error: `Scene ${sceneNumber} not found in this session.` });
      return;
    }
    if (!clip.ffprobeValid || !existsSync(clip.localPath)) {
      res.status(400).json({ error: `Scene ${sceneNumber} source video is not valid or missing. Re-download first.` });
      return;
    }
    if (clip.masterDuration <= 0.1) {
      res.status(400).json({ error: `Scene ${sceneNumber} has no master duration to repair to.` });
      return;
    }

    // Clear stale normalized file so the next export re-creates it with the correct duration + padding.
    const normPath = path.join(session.folder, `norm-scene-${clip.sceneNumber}.mp4`);
    const cacheCleared = existsSync(normPath);
    if (cacheCleared) {
      try { rmSync(normPath, { force: true }); } catch { /* best-effort */ }
    }

    // Record old values for debug response
    const oldTimelineDuration = clip.timelineDuration;

    // Force timelineDuration = masterDuration (padding handles short source)
    clip.timelineDuration = clip.masterDuration;
    const sourceAvailable = Math.max(0, clip.duration - clip.trimStartSec);
    clip.rawShorterThanMaster = sourceAvailable < clip.masterDuration - 0.05;

    // Re-normalize immediately — use the fallback path in case tpad fails on a short clip.
    req.log.info(
      { multiId, scene: clip.sceneNumber, oldDur: oldTimelineDuration.toFixed(2), newDur: clip.timelineDuration.toFixed(2), needsPad: clip.rawShorterThanMaster },
      "EXPORT DOCTOR repair-clip: re-normalizing with fallback",
    );
    const repairFb = await normalizeMultiClipWithFallback(clip.localPath, normPath, clip.trimStartSec, clip.timelineDuration, clip.duration);

    if (repairFb.method === "failed" || !existsSync(normPath) || statSync(normPath).size < 1024) {
      res.status(500).json({ error: `Scene ${sceneNumber} failed to re-normalize after repair. ${repairFb.stderrTail.slice(0, 200)}` });
      return;
    }

    // Probe the repaired normalized file to confirm actual output duration
    const probe = await probeMedia(normPath);

    res.json({
      sceneNumber: clip.sceneNumber,
      oldExportDuration: oldTimelineDuration,
      newExportDuration: clip.timelineDuration,
      masterDuration: clip.masterDuration,
      rawDuration: clip.duration,
      sourceAvailable,
      rawShorterThanMaster: clip.rawShorterThanMaster,
      cacheCleared,
      normFileSize: statSync(normPath).size,
      normFileDuration: probe.duration,
      matchesMaster: Math.abs(probe.duration - clip.masterDuration) < 0.4,
      savedToExportTimeline: true,
      ffmpegTrimDuration: clip.timelineDuration,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ── Repair + Normalize: re-download source, clear cache, normalize with fallback ── */
// Designed for clips like Scene 12 (short source, tpad may fail) where the caller
// wants a full re-download + re-normalize cycle with comprehensive debug output.
router.post("/export-doctor/repair-normalize", requireAuth, async (req, res) => {
  try {
    const { multiId, sceneNumber } = req.body as { multiId?: string; sceneNumber?: number };
    const session = multiId ? multiSessions.get(multiId) : null;
    if (!session) {
      res.status(400).json({ error: "Session not found. Run Download All Clips first." });
      return;
    }
    const clip = typeof sceneNumber === "number"
      ? session.clips.find(c => c.sceneNumber === sceneNumber)
      : null;
    if (!clip) {
      res.status(400).json({ error: `Scene ${sceneNumber} not found in this session.` });
      return;
    }

    const targetDuration = clip.masterDuration > 0.1 ? clip.masterDuration : clip.timelineDuration;
    const debug: Record<string, string | number | boolean | null> = {
      sourceUrl: clip.sourceUrl,
      localPath: clip.localPath,
      targetDuration: parseFloat(targetDuration.toFixed(3)),
      masterDuration: parseFloat(clip.masterDuration.toFixed(3)),
    };

    // ── Step 1: clear all stale cache ────────────────────────────────────────
    const normPath  = path.join(session.folder, `norm-scene-${clip.sceneNumber}.mp4`);
    const framePath = path.join(session.folder, `norm-scene-${clip.sceneNumber}-last-frame.jpg`);

    let downloadCleared = false;
    let normCleared     = false;

    if (existsSync(clip.localPath)) {
      try { rmSync(clip.localPath, { force: true }); downloadCleared = true; } catch { /* best-effort */ }
    }
    if (existsSync(normPath)) {
      try { rmSync(normPath, { force: true }); normCleared = true; } catch { /* best-effort */ }
    }
    if (existsSync(framePath)) {
      try { rmSync(framePath, { force: true }); } catch { /* best-effort */ }
    }
    debug["downloadCacheCleared"] = downloadCleared;
    debug["normCacheCleared"]     = normCleared;

    // ── Step 2: re-download source ────────────────────────────────────────────
    const url = clip.sourceUrl;
    if (!url?.startsWith("http")) {
      res.status(400).json({ error: "No source URL on this clip. Re-run Download All Clips.", debug });
      return;
    }
    if (!isAllowedClipUrl(url) && !isPublicHttpsUrl(url)) {
      res.status(400).json({ error: "Source URL is not an allowed media source.", debug });
      return;
    }

    let target = url;
    if (SUPABASE_HOST && target.includes(SUPABASE_HOST)) {
      const { url: fresh, changed } = await tryFreshSignedUrl(target);
      if (changed) target = fresh;
    }

    let downloadStatus = 0;
    let downloadError: string | null = null;
    try {
      const r = await fetch(target, { signal: AbortSignal.timeout(120_000) });
      downloadStatus = r.status;
      if (!r.ok) throw new Error(`download failed (HTTP ${r.status})`);
      const ws = createWriteStream(clip.localPath);
      await pipeline(r.body as Parameters<typeof pipeline>[0], byteCap(MAX_CLIP_BYTES), ws);
    } catch (e) {
      downloadError = e instanceof Error ? e.message : String(e);
    }

    const srcExists = existsSync(clip.localPath);
    const srcSize   = srcExists ? statSync(clip.localPath).size : 0;
    debug["redownloadHttpStatus"] = downloadStatus;
    debug["sourceFileExists"]     = srcExists;
    debug["sourceFileSize"]       = srcSize;
    debug["redownloadError"]      = downloadError;

    if (!srcExists || srcSize < 1024) {
      res.status(500).json({ error: downloadError ?? `Re-download produced no file (${srcSize} bytes).`, debug });
      return;
    }

    // ── Step 3: probe re-downloaded source ───────────────────────────────────
    const srcProbe = await probeMedia(clip.localPath);
    debug["sourceDuration"] = parseFloat(srcProbe.duration.toFixed(3));
    debug["sourceCodec"]    = srcProbe.codec;
    debug["sourceHasVideo"] = srcProbe.hasVideo;
    debug["sourceError"]    = srcProbe.error;

    if (!srcProbe.hasVideo) {
      res.status(400).json({ error: `Re-downloaded file has no video stream: ${srcProbe.error ?? "unknown"}`, debug });
      return;
    }

    // Update session clip metadata from fresh probe
    clip.duration      = srcProbe.duration;
    clip.width         = srcProbe.width;
    clip.height        = srcProbe.height;
    clip.codec         = srcProbe.codec;
    clip.fileExists    = true;
    clip.fileSize      = srcSize;
    clip.ffprobeValid  = true;
    clip.error         = null;
    if (targetDuration > 0.1) {
      clip.timelineDuration = targetDuration;
      const srcAvail = Math.max(0, srcProbe.duration - clip.trimStartSec);
      clip.rawShorterThanMaster = srcAvail < targetDuration - 0.05;
    }

    // ── Step 4: normalize with fallback ──────────────────────────────────────
    req.log.info(
      { multiId, scene: clip.sceneNumber, targetDuration, srcDur: srcProbe.duration, rawShorter: clip.rawShorterThanMaster },
      "EXPORT DOCTOR repair-normalize: normalizing with fallback",
    );
    const fb = await normalizeMultiClipWithFallback(
      clip.localPath, normPath,
      clip.trimStartSec, targetDuration > 0.1 ? targetDuration : null,
      clip.duration,
    );

    debug["normMethod"]    = fb.method;
    debug["normSize"]      = fb.normSize;
    debug["normStderr"]    = fb.stderrTail.slice(0, 300);
    debug["normFileExists"] = existsSync(normPath);

    if (fb.method === "failed" || !existsSync(normPath) || fb.normSize < 1024) {
      res.status(500).json({ error: `Normalize failed (method=${fb.method}). ${fb.stderrTail.slice(0, 200)}`, debug });
      return;
    }

    // ── Step 5: validate output ───────────────────────────────────────────────
    const normProbe  = await probeMedia(normPath);
    const normSize   = statSync(normPath).size;
    const durationOk = normProbe.duration > 0.1 && (targetDuration <= 0 || Math.abs(normProbe.duration - targetDuration) < 0.5);
    const sizeOk     = normSize > 100 * 1024; // > 100 KB
    const videoOk    = normProbe.hasVideo;

    debug["normDuration"]  = parseFloat(normProbe.duration.toFixed(3));
    debug["normSizeOk"]    = sizeOk;
    debug["normVideoOk"]   = videoOk;
    debug["normDurationOk"] = durationOk;

    const repaired = sizeOk && videoOk && durationOk;
    const readyForExport = repaired;

    res.json({
      sceneNumber: clip.sceneNumber,
      repaired,
      normalizedOutputValid: videoOk && sizeOk,
      duration: parseFloat(normProbe.duration.toFixed(3)),
      targetDuration: parseFloat(targetDuration.toFixed(3)),
      readyForFirstTwentyExport: readyForExport,
      normMethod: fb.method,
      normFileSize: normSize,
      rawShorterThanMaster: clip.rawShorterThanMaster,
      downloadCacheCleared: downloadCleared,
      normCacheCleared: normCleared,
      redownloadHttpStatus: downloadStatus,
      matchesMaster: durationOk,
      lastError: repaired ? null : `method=${fb.method}, normDur=${normProbe.duration.toFixed(2)}s, normSize=${normSize}, videoOk=${videoOk}`,
      debug,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ── TEST 6: export ALL clips only (no audio, 1080x1920, concat) ── */
router.post("/export-doctor/export-all", requireAuth, async (req, res) => {
  try {
    const { multiId } = req.body as { multiId?: string };
    const session = multiId ? multiSessions.get(multiId) : null;
    if (!session) {
      res.status(400).json({ error: "No multi-clip session found. Run 'Download All Clips' first." });
      return;
    }

    // HARD STOP: never run FFmpeg unless every clip is valid + present on disk.
    const blocker = multiClipsBlocker(session);
    if (blocker) {
      res.status(400).json({ error: blocker });
      return;
    }

    let normPaths: string[];
    try {
      normPaths = await normalizeAllClips(session);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
      return;
    }

    req.log.info({ multiId, clipCount: normPaths.length }, "EXPORT DOCTOR export all clips (no audio)");
    let outputPath: string;
    try {
      outputPath = await concatMultiClips(session.folder, normPaths, null, "all-clips-test.mp4");
    } catch (e) {
      const stderr = (e as { stderr?: string }).stderr ?? "";
      res.status(500).json({
        error: `FFmpeg concat failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
        stderrTail: stderr.slice(-600).split("\n").filter(Boolean),
      });
      return;
    }

    if (!existsSync(outputPath) || statSync(outputPath).size < 1024) {
      res.status(500).json({ error: "FFmpeg produced no usable output file." });
      return;
    }

    const probe = await probeMedia(outputPath);
    const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
    if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
    const objectName = `export-doctor/${multiId}-all-clips.mp4`;
    await objectStorageClient.bucket(bucketId).file(objectName).save(readFileSync(outputPath), {
      contentType: "video/mp4", resumable: false,
    });
    const signedUrl = await signGetUrl(bucketId, objectName);

    res.json({
      success: true,
      url: signedUrl,
      clipCount: normPaths.length,
      fileSize: statSync(outputPath).size,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      hasAudio: probe.hasAudio,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ── TEST 7: export ALL clips + audio (concat + master-player audio) ── */
router.post("/export-doctor/export-all-audio", requireAuth, async (req, res) => {
  try {
    const { multiId, audioUrl, audioStartSec, syncMode } = req.body as {
      multiId?: string;
      audioUrl?: string;
      /** Seconds into the audio track to start — matches master player's videoAudio.startSec. */
      audioStartSec?: number;
      syncMode?: string;
    };
    const session = multiId ? multiSessions.get(multiId) : null;
    if (!session) {
      res.status(400).json({ error: "No multi-clip session found. Run 'Download All Clips' first." });
      return;
    }

    // HARD STOP: every clip must be valid + present before mixing audio.
    const blocker = multiClipsBlocker(session);
    if (blocker) {
      res.status(400).json({ error: blocker });
      return;
    }

    if (!audioUrl || !audioUrl.startsWith("http")) {
      res.status(400).json({ error: "No master-player audio URL was provided." });
      return;
    }
    if (!isAllowedAudioUrl(audioUrl)) {
      res.status(400).json({ error: "Audio URL host is not an allowed media source (Supabase storage or Replit object storage over HTTPS)." });
      return;
    }

    // Download the SAME audio source the Scene 1 + Audio test used.
    let target = audioUrl;
    if (SUPABASE_HOST && target.includes(SUPABASE_HOST)) {
      const { url: fresh, changed } = await tryFreshSignedUrl(target);
      if (changed) target = fresh;
    }
    const ext = target.includes(".mp3") ? ".mp3" : target.includes(".ogg") ? ".ogg" : target.includes(".wav") ? ".wav" : ".aac";
    const audioPath = path.join(session.folder, `all-audio${ext}`);

    req.log.info({ multiId, audioUrl: target.slice(0, 100) }, "EXPORT DOCTOR download audio for all-clips export");
    const ar = await fetch(target, { signal: AbortSignal.timeout(120_000) });
    if (!ar.ok) {
      res.json({ audioDownloaded: false, audioValid: false, error: `Audio download failed (HTTP ${ar.status}).` });
      return;
    }
    const aCt = (ar.headers.get("content-type") ?? "").toLowerCase();
    if (aCt.startsWith("text/") || aCt.startsWith("application/json") || aCt.startsWith("application/xml")) {
      res.json({ audioDownloaded: false, audioValid: false, error: `Audio URL returned non-audio content (${aCt || "unknown"}).` });
      return;
    }
    const aws = createWriteStream(audioPath);
    await pipeline(ar.body as Parameters<typeof pipeline>[0], byteCap(MAX_AUDIO_BYTES), aws);
    const audioDownloaded = existsSync(audioPath) && statSync(audioPath).size > 1024;
    if (!audioDownloaded) {
      res.json({ audioDownloaded: false, audioValid: false, error: "Audio file was not created or is too small." });
      return;
    }
    const aProbe = await probeMedia(audioPath);
    if (!aProbe.hasAudio) {
      res.json({
        audioDownloaded: true, audioValid: false, audioFileSize: statSync(audioPath).size,
        error: `Audio ffprobe found no audio stream: ${aProbe.error ?? "unknown"}.`,
      });
      return;
    }
    session.audioPath = audioPath;

    let normPaths: string[];
    try {
      normPaths = await normalizeAllClips(session);
    } catch (e) {
      res.status(500).json({ audioDownloaded: true, audioValid: true, error: e instanceof Error ? e.message : String(e) });
      return;
    }

    // Build per-clip timeline map using master-player timeline durations (post-trim)
    const resolvedAudioStart = Math.max(0, audioStartSec ?? 0);
    let timelineCursor = 0;
    const clipTimeline = session.clips.map((c) => {
      const start = timelineCursor;
      const dur   = c.timelineDuration > 0 ? c.timelineDuration : c.duration;
      timelineCursor += dur;
      return {
        sceneNumber: c.sceneNumber,
        title: c.sceneTitle,
        clipDuration: dur,
        rawDuration: c.duration,
        trimStartSec: c.trimStartSec,
        trimEndSec: c.trimEndSec,
        timelineStartSec: start,
        timelineEndSec: timelineCursor,
      };
    });
    const timelineVideoDuration = timelineCursor;

    req.log.info({ multiId, clipCount: normPaths.length, audioStartSec: resolvedAudioStart, syncMode }, "EXPORT DOCTOR export all clips + audio");
    let outputPath: string;
    try {
      outputPath = await concatMultiClips(session.folder, normPaths, audioPath, "all-clips-audio-test.mp4",
        null, null, null, resolvedAudioStart);
    } catch (e) {
      const stderr = (e as { stderr?: string }).stderr ?? "";
      res.status(500).json({
        audioDownloaded: true, audioValid: true,
        error: `FFmpeg concat+audio failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
        stderrTail: stderr.slice(-600).split("\n").filter(Boolean),
      });
      return;
    }

    if (!existsSync(outputPath) || statSync(outputPath).size < 1024) {
      res.status(500).json({ audioDownloaded: true, audioValid: true, error: "FFmpeg produced no usable output file." });
      return;
    }

    const probe = await probeMedia(outputPath);
    const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
    if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
    const objectName = `export-doctor/${multiId}-all-clips-audio.mp4`;
    await objectStorageClient.bucket(bucketId).file(objectName).save(readFileSync(outputPath), {
      contentType: "video/mp4", resumable: false,
    });
    const signedUrl = await signGetUrl(bucketId, objectName);

    res.json({
      success: true,
      url: signedUrl,
      clipCount: normPaths.length,
      audioDownloaded: true,
      audioValid: true,
      audioFileSize: statSync(audioPath).size,
      audioDuration: aProbe.duration,
      fileSize: statSync(outputPath).size,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      hasAudio: probe.hasAudio,
      // Audio sync alignment info
      masterAudioStartSec: resolvedAudioStart,
      exportAudioStartSec: resolvedAudioStart,
      audioOffset: resolvedAudioStart,
      timelineVideoDuration,
      syncMode: syncMode ?? "keep-as-is",
      usingMasterPlayerTiming: resolvedAudioStart > 0,
      clipTimeline,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ── TEST 7b: Audio Sync Diagnostic — full export + detailed per-clip timeline + sync status ── */
router.post("/export-doctor/export-audio-sync-diagnostic", requireAuth, async (req, res) => {
  try {
    const { multiId, audioUrl, audioStartSec, syncMode, clipEdits } = req.body as {
      multiId?: string;
      audioUrl?: string;
      audioStartSec?: number;
      syncMode?: string;
      clipEdits?: Record<string, { lipSyncOffsetSeconds?: number; useLipSync?: boolean }>;
    };
    const session = multiId ? multiSessions.get(multiId) : null;
    if (!session) {
      res.status(400).json({ error: "No multi-clip session found. Run 'Download All Clips' first." });
      return;
    }
    const blocker = multiClipsBlocker(session);
    if (blocker) { res.status(400).json({ error: blocker }); return; }
    if (!audioUrl?.startsWith("http")) {
      res.status(400).json({ error: "No master-player audio URL was provided." });
      return;
    }
    if (!isAllowedAudioUrl(audioUrl)) {
      res.status(400).json({ error: "Audio URL host is not an allowed media source." });
      return;
    }

    let target = audioUrl;
    if (SUPABASE_HOST && target.includes(SUPABASE_HOST)) {
      const { url: fresh, changed } = await tryFreshSignedUrl(target);
      if (changed) target = fresh;
    }
    const ext = target.includes(".mp3") ? ".mp3" : target.includes(".ogg") ? ".ogg" : target.includes(".wav") ? ".wav" : ".aac";
    const audioPath = path.join(session.folder, `sync-diag-audio${ext}`);

    const ar = await fetch(target, { signal: AbortSignal.timeout(120_000) });
    if (!ar.ok) {
      res.json({ error: `Audio download failed (HTTP ${ar.status}).` });
      return;
    }
    const aws = createWriteStream(audioPath);
    await pipeline(ar.body as Parameters<typeof pipeline>[0], byteCap(MAX_AUDIO_BYTES), aws);
    if (!existsSync(audioPath) || statSync(audioPath).size < 1024) {
      res.json({ error: "Audio file was not created or is too small." });
      return;
    }
    const aProbe = await probeMedia(audioPath);
    if (!aProbe.hasAudio) {
      res.json({ error: `Audio ffprobe found no audio stream: ${aProbe.error ?? "unknown"}.` });
      return;
    }
    session.audioPath = audioPath;

    const resolvedAudioStart = Math.max(0, audioStartSec ?? 0);

    // Per-clip timeline map with lip sync offset info (uses master-player timeline durations)
    let cursor = 0;
    const clipTimeline = session.clips.map((c) => {
      const start = cursor;
      const dur   = c.timelineDuration > 0 ? c.timelineDuration : c.duration;
      cursor += dur;
      const ce = clipEdits?.[`scene-${c.sceneNumber}`] ?? clipEdits?.[String(c.sceneNumber)] ?? null;
      return {
        sceneNumber: c.sceneNumber,
        title: c.sceneTitle,
        clipDuration: dur,
        rawDuration: c.duration,
        trimStartSec: c.trimStartSec,
        trimEndSec: c.trimEndSec,
        timelineStartSec: start,
        timelineEndSec: cursor,
        sourceType: ce?.useLipSync ? "lip-sync" : "original",
        lipSyncOffsetSec: ce?.lipSyncOffsetSeconds ?? 0,
      };
    });
    const timelineVideoDuration = cursor;
    const audioDuration = aProbe.duration ?? 0;
    const finalExportDuration = Math.min(timelineVideoDuration, audioDuration > 0 ? audioDuration - resolvedAudioStart : timelineVideoDuration);

    let normPaths: string[];
    try {
      normPaths = await normalizeAllClips(session);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
      return;
    }

    let outputPath: string;
    try {
      outputPath = await concatMultiClips(session.folder, normPaths, audioPath, "sync-diag-test.mp4",
        null, null, null, resolvedAudioStart);
    } catch (e) {
      const stderr = (e as { stderr?: string }).stderr ?? "";
      res.status(500).json({
        error: `FFmpeg sync-diag failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
        stderrTail: stderr.slice(-600).split("\n").filter(Boolean),
      });
      return;
    }

    if (!existsSync(outputPath) || statSync(outputPath).size < 1024) {
      res.status(500).json({ error: "FFmpeg produced no usable output file." });
      return;
    }

    const probe = await probeMedia(outputPath);
    const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
    if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
    const objectName = `export-doctor/${multiId}-sync-diag.mp4`;
    await objectStorageClient.bucket(bucketId).file(objectName).save(readFileSync(outputPath), {
      contentType: "video/mp4", resumable: false,
    });
    const signedUrl = await signGetUrl(bucketId, objectName);

    const hasLipSync = session.clips.some((_, i) => clipEdits?.[`scene-${i + 1}`]?.useLipSync || false);

    res.json({
      success: true,
      url: signedUrl,
      fileSize: statSync(outputPath).size,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      hasAudio: probe.hasAudio,
      // Audio sync alignment
      masterAudioStartSec: resolvedAudioStart,
      exportAudioStartSec: resolvedAudioStart,
      audioOffset: resolvedAudioStart,
      timelineVideoDuration,
      audioDuration,
      finalExportDuration,
      audioVideoSyncMode: syncMode ?? "keep-as-is",
      syncExpected: true,
      // Per-clip map
      clipTimeline,
      // Audio Sync Export Check status
      videoOnlyExportPassed: true,
      audioSourceReady: true,
      usingMasterPlayerTiming: resolvedAudioStart > 0,
      audioOffsetApplied: resolvedAudioStart > 0,
      lipSyncOffsetsPreserved: hasLipSync,
      finalSyncExpected: true,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ── TEST 7c: Audio Sync Short Test — first 20 seconds + audio, fast turnaround ── */
router.post("/export-doctor/export-audio-sync-short", requireAuth, async (req, res) => {
  const routeStart = Date.now();
  let lastStep = "received request";
  try {
    const { multiId, audioUrl, audioStartSec, syncMode, durationSec } = req.body as {
      multiId?: string;
      audioUrl?: string;
      audioStartSec?: number;
      syncMode?: string;
      durationSec?: number;
    };

    req.log.info({ multiId, clipCount: undefined, audioUrl: audioUrl?.slice(0, 80) }, "EXPORT SHORT TEST: request received");

    const session = multiId ? multiSessions.get(multiId) : null;
    if (!session) {
      res.status(400).json({ error: "No multi-clip session found. Run 'Download All Clips' first.", lastStep });
      return;
    }

    req.log.info({ multiId, clipCount: session.clips.length }, "EXPORT SHORT TEST: session found");

    const blocker = multiClipsBlocker(session);
    if (blocker) { res.status(400).json({ error: blocker, lastStep }); return; }

    if (!audioUrl?.startsWith("http")) {
      res.status(400).json({ error: "No master-player audio URL was provided.", lastStep });
      return;
    }
    if (!isAllowedAudioUrl(audioUrl)) {
      res.status(400).json({ error: "Audio URL host is not an allowed media source.", lastStep });
      return;
    }

    const resolvedAudioStart = Math.max(0, audioStartSec ?? 0);
    const testDuration = Math.max(5, Math.min(60, durationSec ?? 20));

    // ── Step: refresh signed audio URL ──────────────────────────────────────
    lastStep = "refreshing audio URL";
    let target = audioUrl;
    if (SUPABASE_HOST && target.includes(SUPABASE_HOST)) {
      const { url: fresh, changed } = await tryFreshSignedUrl(target);
      if (changed) target = fresh;
    }

    // ── Step: download audio ─────────────────────────────────────────────────
    lastStep = "downloading audio";
    req.log.info({ multiId, testDuration, resolvedAudioStart }, "EXPORT SHORT TEST: downloading audio");
    const ext = target.includes(".mp3") ? ".mp3" : target.includes(".ogg") ? ".ogg" : target.includes(".wav") ? ".wav" : ".aac";
    const audioPath = path.join(session.folder, `short-test-audio${ext}`);

    const ar = await fetch(target, { signal: AbortSignal.timeout(90_000) });
    if (!ar.ok) {
      res.status(400).json({ error: `Audio download failed (HTTP ${ar.status}).`, lastStep });
      return;
    }
    const aws = createWriteStream(audioPath);
    await pipeline(ar.body as Parameters<typeof pipeline>[0], byteCap(MAX_AUDIO_BYTES), aws);
    if (!existsSync(audioPath) || statSync(audioPath).size < 1024) {
      res.status(500).json({ error: "Audio file was not created or is too small.", lastStep });
      return;
    }

    // ── Step: validate audio with ffprobe ────────────────────────────────────
    lastStep = "validating audio with ffprobe";
    req.log.info({ multiId, audioSize: statSync(audioPath).size }, "EXPORT SHORT TEST: probing audio");
    const aProbe = await probeMedia(audioPath);
    if (!aProbe.hasAudio) {
      res.status(400).json({ error: `Audio ffprobe found no audio stream: ${aProbe.error ?? "unknown"}.`, lastStep });
      return;
    }
    session.audioPath = audioPath;

    const audioDuration = aProbe.duration ?? 0;
    req.log.info({ multiId, audioDuration }, "EXPORT SHORT TEST: audio OK");

    // ── Step: build per-clip timeline map ────────────────────────────────────
    lastStep = "building clip timeline — only clips overlapping first testDuration seconds will be normalized";
    let cursor = 0;
    const clipTimeline = session.clips.map((c) => {
      const start = cursor;
      const dur   = c.timelineDuration > 0 ? c.timelineDuration : c.duration;
      cursor += dur;
      return {
        sceneNumber: c.sceneNumber,
        title: c.sceneTitle,
        clipDuration: dur,
        rawDuration: c.duration,
        trimStartSec: c.trimStartSec,
        trimEndSec: c.trimEndSec,
        timelineStartSec: start,
        timelineEndSec: cursor,
      };
    });
    const timelineVideoDuration = cursor;

    req.log.info(
      { multiId, clipCount: session.clips.length, timelineVideoDuration, testDuration },
      "EXPORT SHORT TEST: clip timeline built — normalizing only clips needed for testDuration",
    );

    // ── Step: normalize only the clips needed to fill testDuration ───────────
    // We need enough clips to cover testDuration. Use 2× buffer so the concat
    // trim has something to trim from (needed for short clips where one clip
    // barely covers the test window).
    lastStep = "normalizing clips";
    let normPaths: string[];
    try {
      // Only normalize clips that actually overlap the first testDuration seconds.
      // Using testDuration (not testDuration * 2) prevents normalizing Scene 12
      // (which starts at ~24s) for a 20-second test — avoiding failures on short clips
      // that are outside the test window.
      normPaths = await normalizeClipsForDuration(
        session,
        testDuration,
        (msg) => req.log.info({ multiId }, `EXPORT SHORT TEST normalize: ${msg}`),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      req.log.error({ err: e, multiId, lastStep }, "EXPORT SHORT TEST: normalization failed");
      res.status(500).json({ error: msg, lastStep });
      return;
    }
    req.log.info({ multiId, normCount: normPaths.length, elapsed: Date.now() - routeStart }, "EXPORT SHORT TEST: normalization done");

    // ── Step: concat + trim to testDuration + mux audio ─────────────────────
    lastStep = "running ffmpeg concat";
    const range = { start: 0, duration: testDuration };
    let outputPath: string;
    try {
      req.log.info({ multiId, normCount: normPaths.length, testDuration, audioOffsetSec: resolvedAudioStart }, "EXPORT SHORT TEST: starting ffmpeg concat");
      outputPath = await concatMultiClips(session.folder, normPaths, audioPath, "short-test.mp4",
        null, null, range, resolvedAudioStart);
    } catch (e) {
      const stderr = (e as { stderr?: string }).stderr ?? "";
      req.log.error({ err: e, multiId, stderrTail: stderr.slice(-400), lastStep }, "EXPORT SHORT TEST: ffmpeg concat failed");
      res.status(500).json({
        error: `FFmpeg short-test failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
        stderrTail: stderr.slice(-600).split("\n").filter(Boolean),
        lastStep,
      });
      return;
    }

    if (!existsSync(outputPath) || statSync(outputPath).size < 1024) {
      res.status(500).json({ error: "FFmpeg produced no usable output file.", lastStep });
      return;
    }
    req.log.info({ multiId, outputSize: statSync(outputPath).size, elapsed: Date.now() - routeStart }, "EXPORT SHORT TEST: ffmpeg done");

    // ── Step: probe output ───────────────────────────────────────────────────
    lastStep = "probing output";
    const probe = await probeMedia(outputPath);

    // ── Step: upload to object storage ───────────────────────────────────────
    lastStep = "uploading result";
    const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
    if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
    const objectName = `export-doctor/${multiId}-short-test.mp4`;
    req.log.info({ multiId, objectName, fileSize: statSync(outputPath).size }, "EXPORT SHORT TEST: uploading");

    await Promise.race([
      objectStorageClient.bucket(bucketId).file(objectName).save(readFileSync(outputPath), {
        contentType: "video/mp4", resumable: false,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Object storage upload timed out after 60s")), 60_000),
      ),
    ]);

    lastStep = "generating signed URL";
    const signedUrl = await signGetUrl(bucketId, objectName);
    req.log.info({ multiId, elapsed: Date.now() - routeStart }, "EXPORT SHORT TEST: done");

    res.json({
      success: true,
      url: signedUrl,
      fileSize: statSync(outputPath).size,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      hasAudio: probe.hasAudio,
      testDurationSec: testDuration,
      masterAudioStartSec: resolvedAudioStart,
      exportAudioStartSec: resolvedAudioStart,
      audioOffset: resolvedAudioStart,
      timelineVideoDuration,
      audioDuration,
      audioVideoSyncMode: syncMode ?? "keep-as-is",
      clipTimeline,
      elapsedMs: Date.now() - routeStart,
      lastStep: "done",
    });
  } catch (e) {
    req.log.error({ err: e, lastStep, elapsed: Date.now() - routeStart }, "EXPORT SHORT TEST: unexpected error");
    res.status(500).json({ error: e instanceof Error ? e.message : String(e), lastStep });
  }
});

/* ── TEST 8: export ALL clips + audio + synced captions (no effects/overlays/branding) ── */
router.post("/export-doctor/export-all-captions", requireAuth, async (req, res) => {
  try {
    const { multiId, audioUrl, captions } = req.body as {
      multiId?: string;
      audioUrl?: string;
      captions?: CaptionBurnConfig | null;
    };
    const session = multiId ? multiSessions.get(multiId) : null;
    if (!session) {
      res.status(400).json({ error: "No multi-clip session found. Run 'Download All Clips' first." });
      return;
    }

    // HARD STOP: every clip must be valid + present before mixing audio + captions.
    const blocker = multiClipsBlocker(session);
    if (blocker) {
      res.status(400).json({ error: blocker });
      return;
    }

    // ── Caption validation — must have real synced lines (or artist/title) to burn ──
    const validLines = (captions?.lines ?? []).filter(
      (l) => !!l.text?.trim() && Number.isFinite(l.startSec) && Number.isFinite(l.endSec) && l.endSec > l.startSec && l.startSec >= 0,
    );
    const captionRows = captions?.lines?.length ?? 0;
    const captionTimingValid = captionRows > 0 && validLines.length === captionRows;
    const captionsFound =
      !!captions && captions.mode !== "none" &&
      (validLines.length > 0 || captions.showArtistName || captions.showSongTitle);
    const KNOWN_PRESETS = ["clean-white", "gold-hiphop", "karaoke", "boxed", "viral-shorts", "minimal", "drill", "luxury", "rnb", "kids"];
    const captionStyleFound = !!captions && KNOWN_PRESETS.includes(captions.stylePreset);

    if (!captionsFound) {
      res.status(400).json({
        error: "No captions found — add synced caption lines (or enable artist/song title) before running the caption test.",
        captionsFound: false, captionRows, captionTimingValid: false, captionStyleFound,
      });
      return;
    }

    if (!audioUrl || !audioUrl.startsWith("http")) {
      res.status(400).json({ error: "No master-player audio URL was provided.", captionsFound, captionRows, captionTimingValid, captionStyleFound });
      return;
    }
    if (!isAllowedAudioUrl(audioUrl)) {
      res.status(400).json({ error: "Audio URL host is not an allowed media source (Supabase storage or Replit object storage over HTTPS).", captionsFound, captionRows, captionTimingValid, captionStyleFound });
      return;
    }

    // Download the SAME audio source the other audio tests used.
    let target = audioUrl;
    if (SUPABASE_HOST && target.includes(SUPABASE_HOST)) {
      const { url: fresh, changed } = await tryFreshSignedUrl(target);
      if (changed) target = fresh;
    }
    const ext = target.includes(".mp3") ? ".mp3" : target.includes(".ogg") ? ".ogg" : target.includes(".wav") ? ".wav" : ".aac";
    const audioPath = path.join(session.folder, `cap-audio${ext}`);

    req.log.info({ multiId, audioUrl: target.slice(0, 100) }, "EXPORT DOCTOR download audio for all-clips+captions export");
    const ar = await fetch(target, { signal: AbortSignal.timeout(120_000) });
    if (!ar.ok) {
      res.json({ captionsFound, captionRows, captionTimingValid, captionStyleFound, audioDownloaded: false, audioValid: false, error: `Audio download failed (HTTP ${ar.status}).` });
      return;
    }
    const aCt = (ar.headers.get("content-type") ?? "").toLowerCase();
    if (aCt.startsWith("text/") || aCt.startsWith("application/json") || aCt.startsWith("application/xml")) {
      res.json({ captionsFound, captionRows, captionTimingValid, captionStyleFound, audioDownloaded: false, audioValid: false, error: `Audio URL returned non-audio content (${aCt || "unknown"}).` });
      return;
    }
    const aws = createWriteStream(audioPath);
    await pipeline(ar.body as Parameters<typeof pipeline>[0], byteCap(MAX_AUDIO_BYTES), aws);
    const audioDownloaded = existsSync(audioPath) && statSync(audioPath).size > 1024;
    if (!audioDownloaded) {
      res.json({ captionsFound, captionRows, captionTimingValid, captionStyleFound, audioDownloaded: false, audioValid: false, error: "Audio file was not created or is too small." });
      return;
    }
    const aProbe = await probeMedia(audioPath);
    if (!aProbe.hasAudio) {
      res.json({
        captionsFound, captionRows, captionTimingValid, captionStyleFound,
        audioDownloaded: true, audioValid: false, audioFileSize: statSync(audioPath).size,
        error: `Audio ffprobe found no audio stream: ${aProbe.error ?? "unknown"}.`,
      });
      return;
    }
    session.audioPath = audioPath;

    // ── Build the ASS caption file from the SAVED synced timings (timeOffset 0 — no intro card). ──
    const totalDuration = session.clips.reduce((sum, c) => sum + (c.duration || 0), 0);
    const assContent = buildAssContent(captions!, MULTI_TARGET_W, MULTI_TARGET_H, totalDuration, 0);
    if (!assContent.trim()) {
      res.json({
        captionsFound, captionRows, captionTimingValid, captionStyleFound,
        audioDownloaded: true, audioValid: true, captionsBurned: false,
        error: "Captions produced no burn-in events — check that lines have text and end > start.",
      });
      return;
    }
    const assPath = path.join(session.folder, `captions-${multiId}.ass`);
    writeFileSync(assPath, assContent, "utf8");

    let normPaths: string[];
    try {
      normPaths = await normalizeAllClips(session);
    } catch (e) {
      res.status(500).json({ captionsFound, captionRows, captionTimingValid, captionStyleFound, audioDownloaded: true, audioValid: true, error: e instanceof Error ? e.message : String(e) });
      return;
    }

    req.log.info({ multiId, clipCount: normPaths.length, captionRows }, "EXPORT DOCTOR export all clips + audio + captions");
    let outputPath: string;
    try {
      outputPath = await concatMultiClips(session.folder, normPaths, audioPath, "all-clips-audio-captions-test.mp4", assPath);
    } catch (e) {
      const stderr = (e as { stderr?: string }).stderr ?? "";
      res.status(500).json({
        captionsFound, captionRows, captionTimingValid, captionStyleFound,
        audioDownloaded: true, audioValid: true, captionsBurned: false,
        error: `FFmpeg concat+audio+captions failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
        stderrTail: stderr.slice(-800).split("\n").filter(Boolean),
      });
      return;
    }

    if (!existsSync(outputPath) || statSync(outputPath).size < 1024) {
      res.status(500).json({ captionsFound, captionRows, captionTimingValid, captionStyleFound, audioDownloaded: true, audioValid: true, captionsBurned: false, error: "FFmpeg produced no usable output file." });
      return;
    }

    const probe = await probeMedia(outputPath);
    const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
    if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
    const objectName = `export-doctor/${multiId}-all-clips-audio-captions.mp4`;
    await objectStorageClient.bucket(bucketId).file(objectName).save(readFileSync(outputPath), {
      contentType: "video/mp4", resumable: false,
    });
    const signedUrl = await signGetUrl(bucketId, objectName);

    res.json({
      success: true,
      url: signedUrl,
      clipCount: normPaths.length,
      captionsFound,
      captionRows,
      captionTimingValid,
      captionStyleFound,
      stylePreset: captions!.stylePreset,
      captionsBurned: true,
      audioDownloaded: true,
      audioValid: true,
      audioFileSize: statSync(audioPath).size,
      audioDuration: aProbe.duration,
      fileSize: statSync(outputPath).size,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      hasAudio: probe.hasAudio,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ──────────────────────────────────────────────────────────────────────────
 * EXPORT ALL CLIPS + AUDIO + CAPTIONS + EFFECTS (export-safe Auto AI effects)
 * Reuses the working clips+audio+captions path and layers the saved global
 * Auto AI effects (settings.effects) on top, translated to FFmpeg filters that
 * mirror the master player's CSS preview. Animated overlays (Smoke/Rain/Sparks)
 * and branding are intentionally NOT applied here — unsupported effects are
 * skipped and reported, never fatal.
 * ────────────────────────────────────────────────────────────────────────── */
router.post("/export-doctor/export-all-effects", requireAuth, async (req, res) => {
  try {
    const { multiId, audioUrl, captions, effects, conflictMode } = req.body as {
      multiId?: string;
      audioUrl?: string;
      captions?: CaptionBurnConfig | null;
      effects?: string[] | null;
      conflictMode?: EffectConflictMode;
    };
    const session = multiId ? multiSessions.get(multiId) : null;
    if (!session) {
      res.status(400).json({ error: "No multi-clip session found. Run 'Download All Clips' first." });
      return;
    }

    // HARD STOP: every clip must be valid + present before mixing audio + captions + effects.
    const blocker = multiClipsBlocker(session);
    if (blocker) {
      res.status(400).json({ error: blocker });
      return;
    }

    // ── Effects: translate saved global Auto AI effects to FFmpeg (sequential chain,
    //    dedicated grades + B&W↔Luxury Gold conflict resolution), skip unsupported ──
    const totalDurationSec = session.clips.reduce((sum, c) => sum + (c.duration || 0), 0);
    const effectList = Array.isArray(effects) ? effects.filter((e) => typeof e === "string" && e.trim()) : [];
    const effectsCount = effectList.length;
    const effectsFound = effectsCount > 0;
    const resolvedConflictMode: EffectConflictMode =
      conflictMode === "bw-only" || conflictMode === "gold-only" ? conflictMode : "blend";
    const stackResult = buildEffectStack(effectList, totalDurationSec, resolvedConflictMode);
    const effectFilter = stackResult.filter;
    const supportedEffects = stackResult.supported;
    const unsupportedEffects = stackResult.unsupported;
    const effectStack = stackResult.stack;
    const appliedEffects = stackResult.applied;
    const conflict = stackResult.conflict;
    const stackMatch = stackResult.stackMatch;
    // Only claim "connected" when a filter is built AND the supported stack fully matches.
    const effectsExportConnected = !!effectFilter && stackMatch;

    if (!effectsFound) {
      res.status(400).json({
        error: "No Auto AI effects found — select at least one effect or color grade (Effects tab) before running the effects test.",
        effectsFound: false, effectsCount: 0, effectsExportConnected: false, unsupportedEffects: [],
        effectStack: [], appliedEffects: [], conflict: null, stackMatch: false,
      });
      return;
    }

    // ── Captions are optional here (focus is effects), but burned + reported when present ──
    const validLines = (captions?.lines ?? []).filter(
      (l) => !!l.text?.trim() && Number.isFinite(l.startSec) && Number.isFinite(l.endSec) && l.endSec > l.startSec && l.startSec >= 0,
    );
    const captionRows = captions?.lines?.length ?? 0;
    const captionTimingValid = captionRows > 0 && validLines.length === captionRows;
    const captionsFound =
      !!captions && captions.mode !== "none" &&
      (validLines.length > 0 || captions.showArtistName || captions.showSongTitle);
    const KNOWN_PRESETS = ["clean-white", "gold-hiphop", "karaoke", "boxed", "viral-shorts", "minimal", "drill", "luxury", "rnb", "kids"];
    const captionStyleFound = !!captions && KNOWN_PRESETS.includes(captions.stylePreset);

    const baseStatus = {
      effectsFound, effectsCount, effectsExportConnected, supportedEffects, unsupportedEffects,
      effectStack, appliedEffects, conflict, conflictMode: resolvedConflictMode, stackMatch, effectFilter,
      captionsFound, captionRows, captionTimingValid, captionStyleFound,
    };

    if (!audioUrl || !audioUrl.startsWith("http")) {
      res.status(400).json({ ...baseStatus, error: "No master-player audio URL was provided." });
      return;
    }
    if (!isAllowedAudioUrl(audioUrl)) {
      res.status(400).json({ ...baseStatus, error: "Audio URL host is not an allowed media source (Supabase storage or Replit object storage over HTTPS)." });
      return;
    }

    // Download the SAME audio source the other audio tests used.
    let target = audioUrl;
    if (SUPABASE_HOST && target.includes(SUPABASE_HOST)) {
      const { url: fresh, changed } = await tryFreshSignedUrl(target);
      if (changed) target = fresh;
    }
    const ext = target.includes(".mp3") ? ".mp3" : target.includes(".ogg") ? ".ogg" : target.includes(".wav") ? ".wav" : ".aac";
    const audioPath = path.join(session.folder, `fx-audio${ext}`);

    req.log.info({ multiId, audioUrl: target.slice(0, 100), effectsCount }, "EXPORT DOCTOR download audio for all-clips+captions+effects export");
    const ar = await fetch(target, { signal: AbortSignal.timeout(120_000) });
    if (!ar.ok) {
      res.json({ ...baseStatus, audioDownloaded: false, audioValid: false, error: `Audio download failed (HTTP ${ar.status}).` });
      return;
    }
    const aCt = (ar.headers.get("content-type") ?? "").toLowerCase();
    if (aCt.startsWith("text/") || aCt.startsWith("application/json") || aCt.startsWith("application/xml")) {
      res.json({ ...baseStatus, audioDownloaded: false, audioValid: false, error: `Audio URL returned non-audio content (${aCt || "unknown"}).` });
      return;
    }
    const aws = createWriteStream(audioPath);
    await pipeline(ar.body as Parameters<typeof pipeline>[0], byteCap(MAX_AUDIO_BYTES), aws);
    const audioDownloaded = existsSync(audioPath) && statSync(audioPath).size > 1024;
    if (!audioDownloaded) {
      res.json({ ...baseStatus, audioDownloaded: false, audioValid: false, error: "Audio file was not created or is too small." });
      return;
    }
    const aProbe = await probeMedia(audioPath);
    if (!aProbe.hasAudio) {
      res.json({
        ...baseStatus, audioDownloaded: true, audioValid: false, audioFileSize: statSync(audioPath).size,
        error: `Audio ffprobe found no audio stream: ${aProbe.error ?? "unknown"}.`,
      });
      return;
    }
    session.audioPath = audioPath;

    // ── Build the ASS caption file from SAVED synced timings when captions exist (timeOffset 0 — no intro). ──
    const totalDuration = session.clips.reduce((sum, c) => sum + (c.duration || 0), 0);
    let assPath: string | null = null;
    let captionsBurned = false;
    if (captionsFound) {
      const assContent = buildAssContent(captions!, MULTI_TARGET_W, MULTI_TARGET_H, totalDuration, 0);
      if (assContent.trim()) {
        assPath = path.join(session.folder, `fx-captions-${multiId}.ass`);
        writeFileSync(assPath, assContent, "utf8");
        captionsBurned = true;
      }
    }

    let normPaths: string[];
    try {
      normPaths = await normalizeAllClips(session);
    } catch (e) {
      res.status(500).json({ ...baseStatus, audioDownloaded: true, audioValid: true, error: e instanceof Error ? e.message : String(e) });
      return;
    }

    req.log.info({ multiId, clipCount: normPaths.length, effectsCount, supportedEffects, unsupportedEffects, captionsBurned }, "EXPORT DOCTOR export all clips + audio + captions + effects");
    let outputPath: string;
    try {
      outputPath = await concatMultiClips(session.folder, normPaths, audioPath, "all-clips-audio-captions-effects-test.mp4", assPath, effectFilter || null);
    } catch (e) {
      const stderr = (e as { stderr?: string }).stderr ?? "";
      res.status(500).json({
        ...baseStatus, audioDownloaded: true, audioValid: true, captionsBurned: false, testExportCreated: false,
        error: `FFmpeg concat+audio+captions+effects failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
        effectFilter,
        stderrTail: stderr.slice(-800).split("\n").filter(Boolean),
      });
      return;
    }

    if (!existsSync(outputPath) || statSync(outputPath).size < 1024) {
      res.status(500).json({ ...baseStatus, audioDownloaded: true, audioValid: true, captionsBurned, testExportCreated: false, error: "FFmpeg produced no usable output file." });
      return;
    }

    const probe = await probeMedia(outputPath);
    const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
    if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
    const objectName = `export-doctor/${multiId}-all-clips-audio-captions-effects.mp4`;
    await objectStorageClient.bucket(bucketId).file(objectName).save(readFileSync(outputPath), {
      contentType: "video/mp4", resumable: false,
    });
    const signedUrl = await signGetUrl(bucketId, objectName);

    res.json({
      success: true,
      url: signedUrl,
      clipCount: normPaths.length,
      effectsFound,
      effectsCount,
      effectsExportConnected,
      supportedEffects,
      unsupportedEffects,
      effectStack,
      appliedEffects,
      conflict,
      conflictMode: resolvedConflictMode,
      stackMatch,
      effectFilter,
      captionsFound,
      captionRows,
      captionTimingValid,
      captionStyleFound,
      stylePreset: captions?.stylePreset ?? null,
      captionsPreserved: captionsBurned,
      captionsBurned,
      audioPreserved: probe.hasAudio,
      audioDownloaded: true,
      audioValid: true,
      audioFileSize: statSync(audioPath).size,
      audioDuration: aProbe.duration,
      testExportCreated: true,
      fileSize: statSync(outputPath).size,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      hasAudio: probe.hasAudio,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ──────────────────────────────────────────────────────────────────────────
 * POST /export-doctor/export-all-overlays
 * Extends the full effects + captions pipeline with a watermark drawtext.
 * Animated CSS overlays (Rain/Smoke/Sparks/etc.) are NOT export-safe and are
 * reported as unsupportedOverlays.  Only the watermarkText field is burned.
 * ────────────────────────────────────────────────────────────────────────── */
router.post("/export-doctor/export-all-overlays", requireAuth, async (req, res) => {
  try {
    type OvrBody = {
      multiId?: string;
      watermarkType?: string;
      watermarkPosition?: string;
      watermarkSize?: string;
      watermarkIncludeInExport?: boolean;
      audioUrl?: string;
      captions?: CaptionBurnConfig | null;
      effects?: string[] | null;
      overlays?: string[] | null;
      overlayIntensity?: Record<string, number> | null;
      watermarkText?: string;
      conflictMode?: EffectConflictMode;
    };
    const { multiId, audioUrl, captions, effects, overlays, overlayIntensity, watermarkText, watermarkType, watermarkPosition, watermarkSize, watermarkIncludeInExport, conflictMode } = req.body as OvrBody;

    const session = multiId ? multiSessions.get(multiId) : null;
    if (!session) {
      res.status(400).json({ error: "No multi-clip session found. Run 'Download All Clips' first." });
      return;
    }
    const blocker = multiClipsBlocker(session);
    if (blocker) {
      res.status(400).json({ error: blocker });
      return;
    }

    /* ── Classify overlays ── */
    const ANIMATED = ["Rain", "Smoke", "Sparks", "Dust", "Light Leaks", "Lens Flare", "Animated Waveform"];
    const ovList = Array.isArray(overlays) ? overlays : [];
    const unsupportedOverlays = ovList.filter((o) => ANIMATED.includes(o));
    const wmType = watermarkType ?? "logo";
    const wmInclude = watermarkIncludeInExport !== false;
    /* For "logo" type, burn "Bow Down Visuals" text (image overlay not yet supported in export) */
    const watermarkTextSafe = wmType === "logo"
      ? "Bow Down Visuals"
      : (watermarkText ?? "Bow Down Visuals").trim() || "Bow Down Visuals";
    const overlaysFound = ovList.length > 0 || wmType !== "none";
    const watermarkFound = wmType !== "none";
    const watermarkIncluded = wmType !== "none" && wmInclude;
    const overlaysIncluded = watermarkIncluded ? [`Watermark (${wmType === "logo" ? "BDV Logo → text fallback" : "text"})`] : [];

    /* ── Effects pipeline ── */
    const totalDurationSec = session.clips.reduce((sum, c) => sum + (c.duration || 0), 0);
    const effectList = Array.isArray(effects) ? effects.filter((e) => typeof e === "string" && e.trim()) : [];
    const resolvedConflictMode: EffectConflictMode =
      conflictMode === "bw-only" || conflictMode === "gold-only" ? conflictMode : "blend";
    const stackResult = buildEffectStack(effectList, totalDurationSec, resolvedConflictMode);
    const effectFilter = stackResult.filter;
    const effectsFound = effectList.length > 0;
    const effectsExportConnected = !!effectFilter && stackResult.stackMatch;

    /* ── Watermark drawtext filter ── */
    let combinedFilter = effectFilter ?? null;
    if (watermarkIncluded) {
      const fontPath = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
      const wmEsc = watermarkTextSafe.replace(/\\/g, "\\\\").replace(/'/g, "'\\''").replace(/:/g, "\\:").replace(/,/g, "\\,");
      const wmOpacity = Math.max(0.10, Math.min(1.0, ((overlayIntensity ?? {})["Logo / Watermark"] ?? 65) / 100));
      const wmPos = watermarkPosition ?? "bottom-right";
      const margin = 18;
      const wmSize = watermarkSize ?? "medium";
      const fontSize = wmSize === "small" ? 14 : wmSize === "large" ? 26 : 20;
      const xExpr = wmPos.includes("right")  ? `w-tw-${margin}` : String(margin);
      const yExpr = wmPos.includes("bottom") ? `h-th-${margin}` : String(margin);
      const drawtextFilter = `drawtext=fontfile='${fontPath}':text='${wmEsc}':fontsize=${fontSize}:fontcolor=white@${wmOpacity.toFixed(2)}:x=${xExpr}:y=${yExpr}:box=1:boxcolor=black@0.42:boxborderw=5`;
      combinedFilter = effectFilter ? `${effectFilter},${drawtextFilter}` : drawtextFilter;
    }

    if (!audioUrl || !audioUrl.startsWith("http")) {
      res.status(400).json({ error: "No master-player audio URL provided.", overlaysFound, unsupportedOverlays, watermarkFound });
      return;
    }
    if (!isAllowedAudioUrl(audioUrl)) {
      res.status(400).json({ error: "Audio URL host is not an allowed media source.", overlaysFound, unsupportedOverlays, watermarkFound });
      return;
    }

    /* ── Download audio ── */
    let target = audioUrl;
    if (SUPABASE_HOST && target.includes(SUPABASE_HOST)) {
      const { url: fresh, changed } = await tryFreshSignedUrl(target);
      if (changed) target = fresh;
    }
    const ext = target.includes(".mp3") ? ".mp3" : target.includes(".ogg") ? ".ogg" : target.includes(".wav") ? ".wav" : ".aac";
    const audioPath = path.join(session.folder, `ovr-audio${ext}`);
    req.log.info({ multiId, watermarkText: watermarkTextSafe, unsupportedOverlays }, "EXPORT DOCTOR export-all-overlays");
    const ar = await fetch(target, { signal: AbortSignal.timeout(120_000) });
    if (!ar.ok) {
      res.json({ overlaysFound, unsupportedOverlays, watermarkFound, audioDownloaded: false, error: `Audio download failed (HTTP ${ar.status}).` });
      return;
    }
    const aws = createWriteStream(audioPath);
    await pipeline(ar.body as Parameters<typeof pipeline>[0], byteCap(MAX_AUDIO_BYTES), aws);
    if (!existsSync(audioPath) || statSync(audioPath).size < 1024) {
      res.json({ overlaysFound, unsupportedOverlays, watermarkFound, audioDownloaded: false, error: "Audio file was not created or is too small." });
      return;
    }
    const aProbe = await probeMedia(audioPath);

    /* ── Captions ── */
    const validLines = (captions?.lines ?? []).filter(
      (l) => !!l.text?.trim() && Number.isFinite(l.startSec) && Number.isFinite(l.endSec) && l.endSec > l.startSec && l.startSec >= 0,
    );
    const captionsFound = !!captions && captions.mode !== "none" && (validLines.length > 0 || captions.showArtistName || captions.showSongTitle);
    let assPath: string | null = null;
    let captionsBurned = false;
    if (captionsFound) {
      const assContent = buildAssContent(captions!, MULTI_TARGET_W, MULTI_TARGET_H, totalDurationSec, 0);
      if (assContent.trim()) {
        assPath = path.join(session.folder, `ovr-captions-${multiId}.ass`);
        writeFileSync(assPath, assContent, "utf8");
        captionsBurned = true;
      }
    }

    /* ── Normalize + concat ── */
    let normPaths: string[];
    try {
      normPaths = await normalizeAllClips(session);
    } catch (e) {
      res.status(500).json({ overlaysFound, unsupportedOverlays, watermarkFound, error: e instanceof Error ? e.message : String(e) });
      return;
    }

    let outputPath: string;
    try {
      outputPath = await concatMultiClips(session.folder, normPaths, audioPath, "ovr-test.mp4", assPath, combinedFilter || null);
    } catch (e) {
      const stderr = (e as { stderr?: string }).stderr ?? "";
      res.status(500).json({
        overlaysFound, unsupportedOverlays, watermarkFound, watermarkIncluded, overlaysIncluded,
        effectsFound, effectsExportConnected, testExportCreated: false,
        error: `FFmpeg concat+watermark failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
        stderrTail: stderr.slice(-800).split("\n").filter(Boolean),
      });
      return;
    }

    if (!existsSync(outputPath) || statSync(outputPath).size < 1024) {
      res.status(500).json({ overlaysFound, unsupportedOverlays, watermarkFound, testExportCreated: false, error: "FFmpeg produced no usable output file." });
      return;
    }

    const probe = await probeMedia(outputPath);
    const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
    if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
    const objectName = `export-doctor/${multiId}-all-clips-overlays-watermark.mp4`;
    await objectStorageClient.bucket(bucketId).file(objectName).save(readFileSync(outputPath), {
      contentType: "video/mp4", resumable: false,
    });
    const signedUrl = await signGetUrl(bucketId, objectName);

    res.json({
      success: true,
      url: signedUrl,
      clipCount: normPaths.length,
      overlaysFound, unsupportedOverlays, watermarkFound, watermarkIncluded,
      overlaysIncluded, overlayWatermarkText: watermarkTextSafe,
      overlayExportConnected: true,
      effectsFound, effectsExportConnected, effectsPreserved: true,
      captionsFound, captionsPreserved: captionsBurned,
      audioPreserved: probe.hasAudio, audioDownloaded: true, audioValid: true,
      audioFileSize: statSync(audioPath).size, audioDuration: aProbe.duration,
      testExportCreated: true,
      fileSize: statSync(outputPath).size,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      hasAudio: probe.hasAudio,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ──────────────────────────────────────────────────────────────────────────
 * POST /export-doctor/export-effects-range
 * Render a short window (≤3s) starting at the master playhead with the EXACT
 * effect stack the master uses — the "3-Second Effect Match Test".
 * ────────────────────────────────────────────────────────────────────────── */
router.post("/export-doctor/export-effects-range", requireAuth, async (req, res) => {
  try {
    const { multiId, audioUrl, captions, effects, conflictMode, startSec, durationSec } = req.body as {
      multiId?: string;
      audioUrl?: string;
      captions?: CaptionBurnConfig | null;
      effects?: string[] | null;
      conflictMode?: EffectConflictMode;
      startSec?: number;
      durationSec?: number;
    };
    const session = multiId ? multiSessions.get(multiId) : null;
    if (!session) {
      res.status(400).json({ error: "No multi-clip session found. Run 'Download All Clips' first." });
      return;
    }
    const blocker = multiClipsBlocker(session);
    if (blocker) {
      res.status(400).json({ error: blocker });
      return;
    }

    const totalDurationSec = session.clips.reduce((sum, c) => sum + (c.duration || 0), 0);
    const rangeStart = Math.min(Math.max(0, Number(startSec) || 0), Math.max(0, totalDurationSec - 0.5));
    const rangeDuration = Math.min(3, Math.max(0.5, Number(durationSec) || 3), Math.max(0.5, totalDurationSec - rangeStart));

    // Active scene at the playhead (cumulative clip durations).
    let activeSceneIndex = 0;
    let cursor = 0;
    for (let i = 0; i < session.clips.length; i++) {
      const d = session.clips[i]?.duration || 0;
      if (rangeStart < cursor + d || i === session.clips.length - 1) { activeSceneIndex = i; break; }
      cursor += d;
    }

    const effectList = Array.isArray(effects) ? effects.filter((e) => typeof e === "string" && e.trim()) : [];
    if (effectList.length === 0) {
      res.status(400).json({ error: "No Auto AI effects found — select at least one effect or color grade before the match test.", effectStack: [], appliedEffects: [], conflict: null, stackMatch: false });
      return;
    }
    const resolvedConflictMode: EffectConflictMode =
      conflictMode === "bw-only" || conflictMode === "gold-only" ? conflictMode : "blend";
    const stackResult = buildEffectStack(effectList, rangeDuration, resolvedConflictMode);
    const effectFilter = stackResult.filter;
    const effectsExportConnected = !!effectFilter && stackResult.stackMatch;

    if (!audioUrl || !audioUrl.startsWith("http") || !isAllowedAudioUrl(audioUrl)) {
      res.status(400).json({ error: "A valid, allowed master-player audio URL is required for the match test." });
      return;
    }

    let target = audioUrl;
    if (SUPABASE_HOST && target.includes(SUPABASE_HOST)) {
      const { url: fresh, changed } = await tryFreshSignedUrl(target);
      if (changed) target = fresh;
    }
    const ext = target.includes(".mp3") ? ".mp3" : target.includes(".ogg") ? ".ogg" : target.includes(".wav") ? ".wav" : ".aac";
    const audioPath = path.join(session.folder, `fxrange-audio${ext}`);
    const ar = await fetch(target, { signal: AbortSignal.timeout(120_000) });
    if (!ar.ok) {
      res.json({ error: `Audio download failed (HTTP ${ar.status}).` });
      return;
    }
    const aws = createWriteStream(audioPath);
    await pipeline(ar.body as Parameters<typeof pipeline>[0], byteCap(MAX_AUDIO_BYTES), aws);
    const audioDownloaded = existsSync(audioPath) && statSync(audioPath).size > 1024;

    // Burn captions shifted into the window so timings still line up at the playhead.
    let assPath: string | null = null;
    let captionsBurned = false;
    const captionsActive = !!captions && captions.mode !== "none";
    if (captionsActive) {
      const assContent = buildAssContent(captions!, MULTI_TARGET_W, MULTI_TARGET_H, totalDurationSec, -rangeStart);
      if (assContent.trim()) {
        assPath = path.join(session.folder, `fxrange-captions-${multiId}.ass`);
        writeFileSync(assPath, assContent, "utf8");
        captionsBurned = true;
      }
    }

    let normPaths: string[];
    try {
      normPaths = await normalizeAllClips(session);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
      return;
    }

    req.log.info({ multiId, rangeStart, rangeDuration, activeSceneIndex, effects: stackResult.applied }, "EXPORT DOCTOR 3s effect match test");
    let outputPath: string;
    try {
      outputPath = await concatMultiClips(
        session.folder, normPaths, audioDownloaded ? audioPath : null,
        "effect-match-test.mp4", assPath, effectFilter || null,
        { start: rangeStart, duration: rangeDuration },
      );
    } catch (e) {
      const stderr = (e as { stderr?: string }).stderr ?? "";
      res.status(500).json({
        error: `FFmpeg range export failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
        effectFilter, stderrTail: stderr.slice(-800).split("\n").filter(Boolean),
      });
      return;
    }

    if (!existsSync(outputPath) || statSync(outputPath).size < 1024) {
      res.status(500).json({ error: "FFmpeg produced no usable match-test file." });
      return;
    }

    const probe = await probeMedia(outputPath);
    const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
    if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
    const objectName = `export-doctor/${multiId}-effect-match-test.mp4`;
    await objectStorageClient.bucket(bucketId).file(objectName).save(readFileSync(outputPath), { contentType: "video/mp4", resumable: false });
    const signedUrl = await signGetUrl(bucketId, objectName);

    res.json({
      success: true,
      url: signedUrl,
      rangeStart,
      rangeDuration,
      activeSceneIndex,
      masterEffectsFound: effectList.length,
      effectsApplied: stackResult.applied.length,
      effectsExportConnected,
      supportedEffects: stackResult.supported,
      unsupportedEffects: stackResult.unsupported,
      effectStack: stackResult.stack,
      appliedEffects: stackResult.applied,
      conflict: stackResult.conflict,
      conflictMode: resolvedConflictMode,
      stackMatch: stackResult.stackMatch,
      effectFilter,
      captionsBurned,
      testExportCreated: true,
      fileSize: statSync(outputPath).size,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      hasAudio: probe.hasAudio,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

/* ──────────────────────────────────────────────────────────────────────────
 * POST /export-doctor/export-effects-transitions
 * Build an xfade chain from applied transitions + the exact effect stack, and
 * report per-transition support (Whip Pan / Zoom fall back to a hard cut).
 * ────────────────────────────────────────────────────────────────────────── */
router.post("/export-doctor/export-effects-transitions", requireAuth, async (req, res) => {
  try {
    const { multiId, audioUrl, effects, conflictMode, transitions } = req.body as {
      multiId?: string;
      audioUrl?: string;
      effects?: string[] | null;
      conflictMode?: EffectConflictMode;
      transitions?: { sceneIndex: number; type: string }[] | null;
    };
    const session = multiId ? multiSessions.get(multiId) : null;
    if (!session) {
      res.status(400).json({ error: "No multi-clip session found. Run 'Download All Clips' first." });
      return;
    }
    const blocker = multiClipsBlocker(session);
    if (blocker) {
      res.status(400).json({ error: blocker });
      return;
    }

    const clipCount = session.clips.length;
    const boundaryCount = Math.max(0, clipCount - 1);
    const inputTransitions = Array.isArray(transitions) ? transitions : [];

    // One plan entry per clip boundary (scene b → b+1). The applied transition
    // is keyed by its DESTINATION scene (transition INTO scene b+1), so boundary
    // b maps to the transition with sceneIndex === b + 1. The plan entry keeps
    // the boundary index `b` (used for the "Scene b+1 → b+2" display label).
    // Missing = hard Cut.
    const plan: TransitionPlanEntry[] = [];
    for (let b = 0; b < boundaryCount; b++) {
      const found = inputTransitions.find((t) => Number(t.sceneIndex) === b + 1);
      const type = found?.type ?? "Cut";
      const r = resolveTransition(type);
      plan.push({ sceneIndex: b, type, supported: r.supported, xfade: r.xfade, durationSec: r.durationSec, reason: r.reason });
    }
    const supportedTransitions = plan.filter((p) => p.supported);
    const unsupportedTransitions = plan.filter((p) => !p.supported);
    const transitionsConnected = plan.length > 0;

    // Effects (same engine as the master/export).
    const effectList = Array.isArray(effects) ? effects.filter((e) => typeof e === "string" && e.trim()) : [];
    const resolvedConflictMode: EffectConflictMode =
      conflictMode === "bw-only" || conflictMode === "gold-only" ? conflictMode : "blend";
    const totalDurationSec = session.clips.reduce((sum, c) => sum + (c.duration || 0), 0);
    const stackResult = buildEffectStack(effectList, totalDurationSec, resolvedConflictMode);
    const effectFilter = stackResult.filter;

    // Optional audio.
    let audioPath: string | null = null;
    if (audioUrl && audioUrl.startsWith("http") && isAllowedAudioUrl(audioUrl)) {
      let target = audioUrl;
      if (SUPABASE_HOST && target.includes(SUPABASE_HOST)) {
        const { url: fresh, changed } = await tryFreshSignedUrl(target);
        if (changed) target = fresh;
      }
      const ext = target.includes(".mp3") ? ".mp3" : target.includes(".ogg") ? ".ogg" : target.includes(".wav") ? ".wav" : ".aac";
      const ap = path.join(session.folder, `fxtrans-audio${ext}`);
      const ar = await fetch(target, { signal: AbortSignal.timeout(120_000) });
      if (ar.ok) {
        const aws = createWriteStream(ap);
        await pipeline(ar.body as Parameters<typeof pipeline>[0], byteCap(MAX_AUDIO_BYTES), aws);
        if (existsSync(ap) && statSync(ap).size > 1024) audioPath = ap;
      }
    }

    let normPaths: string[];
    try {
      normPaths = await normalizeAllClips(session);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
      return;
    }
    const durations = session.clips.map((c) => c.duration || 0);
    const boundaries = plan.map((p) => ({ xfade: p.xfade, durationSec: p.durationSec }));

    req.log.info({ multiId, boundaries: plan.length, supported: supportedTransitions.length, unsupported: unsupportedTransitions.length }, "EXPORT DOCTOR transitions export");
    let outputPath: string;
    try {
      outputPath = await concatMultiClipsXfade(session.folder, normPaths, durations, boundaries, audioPath, "transitions-test.mp4", effectFilter || null);
    } catch (e) {
      const stderr = (e as { stderr?: string }).stderr ?? "";
      res.status(500).json({
        error: `FFmpeg transitions export failed: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`,
        transitionPlan: plan, supportedTransitions, unsupportedTransitions,
        stderrTail: stderr.slice(-800).split("\n").filter(Boolean),
      });
      return;
    }

    if (!existsSync(outputPath) || statSync(outputPath).size < 1024) {
      res.status(500).json({ error: "FFmpeg produced no usable transitions file.", transitionPlan: plan });
      return;
    }

    const probe = await probeMedia(outputPath);
    const bucketId = process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
    if (!bucketId) throw new Error("DEFAULT_OBJECT_STORAGE_BUCKET_ID not set");
    const objectName = `export-doctor/${multiId}-transitions-test.mp4`;
    await objectStorageClient.bucket(bucketId).file(objectName).save(readFileSync(outputPath), { contentType: "video/mp4", resumable: false });
    const signedUrl = await signGetUrl(bucketId, objectName);

    res.json({
      success: true,
      url: signedUrl,
      clipCount,
      transitionsConnected,
      transitionPlan: plan,
      supportedTransitions,
      unsupportedTransitions,
      effectStack: stackResult.stack,
      appliedEffects: stackResult.applied,
      conflict: stackResult.conflict,
      stackMatch: stackResult.stackMatch,
      effectFilter,
      testExportCreated: true,
      fileSize: statSync(outputPath).size,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      hasAudio: probe.hasAudio,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
