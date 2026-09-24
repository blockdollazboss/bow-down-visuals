import { Router } from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import { createReadStream, createWriteStream, readFileSync, writeFileSync, unlinkSync, existsSync, statSync } from "fs";
import { pipeline } from "stream/promises";
import { randomUUID, createHash } from "crypto";
import path from "path";
import os from "os";
import { requireAuth } from "../../middlewares/require-auth";
import { ensureVideoExportsBucket, uploadFileStreamToSupabaseStorage, VIDEO_EXPORTS_BUCKET, SUPABASE_SIGNED_URL_TTL_SEC } from "../../lib/objectStorage";
import { recordCreditUsage } from "../../lib/payment-record";
import { getPreparedExport, deletePreparedExport, acquirePreparedExport, releasePreparedExport } from "../../lib/prepared-exports";
import { buildAssContent, type CaptionBurnConfig } from "../../lib/caption-ass";
import { getSupabaseAdmin } from "../../lib/supabase-admin";
import { OutOfCreditsError } from "../../lib/credits";
import { buildEffectStack } from "./effects-ffmpeg";
import { fileURLToPath } from "url";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "../../lib/logger";
import {
  createExportJob,
  getExportJob,
  claimJobForRun,
  updateJobStage,
  completeJob,
  failJob,
  chargeCreditsForJob,
  recoverInterruptedJobs,
  enqueueExport,
  describeJobProgress,
  type ExportJobError,
  type ExportStatusRef,
} from "../../lib/export-jobs";

const execFileAsync = promisify(execFile);
const router = Router();
// (Replit sidecar removed — it doesn't exist on Render)

const IS_DEV = process.env["NODE_ENV"] === "development";

/**
 * Resolve the workspace root regardless of the process's current working
 * directory. The api-server is esbuild-bundled to a single file at
 * `artifacts/api-server/dist/index.mjs`, so this module's own location is
 * always `<workspaceRoot>/artifacts/api-server/dist` — three levels up from
 * there lands on the monorepo root, independent of `process.cwd()` (which
 * some launchers set to `artifacts/api-server`, breaking
 * `path.join(process.cwd(), "artifacts/...")` lookups).
 */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const WORKSPACE_ROOT = path.resolve(MODULE_DIR, "../../../");

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
  const mx = Math.round(d * 0.028); // horizontal margin, scales with resolution (was fixed 30px)
  const sd = Math.min(5, dur).toFixed(3);
  const out: string[] = [];
  if (cfg.showArtistName && cfg.artistNameText?.trim()) {
    out.push(`drawtext=fontfile='${SANS_BOLD}':text='${escapeDrawtext(cfg.artistNameText)}':fontsize=${ns}:fontcolor=${col.n}:x=${mx}:y=h-${mb+ns+12}:borderw=2:bordercolor=0x000000:enable='between(t\\,0\\,${sd})'`);
  }
  if (cfg.showSongTitle && cfg.songTitleText?.trim()) {
    out.push(`drawtext=fontfile='${SANS_BOLD}':text='${escapeDrawtext(cfg.songTitleText)}':fontsize=${ts}:fontcolor=${col.t}:x=${mx}:y=h-${mb}:borderw=2:bordercolor=0x000000:enable='between(t\\,0\\,${sd})'`);
  }
  return out;
}

// Watermark/logo corner margin as a fraction of the shorter frame dimension, so the
// logo sits a consistent relative distance from the edge across all aspect ratios
// (9:16, 16:9, 1:1, 4:5) instead of a fixed pixel offset that drifts on portrait/landscape.
function buildWmPos(position: string, targetW: number, targetH: number, marginFrac = 0.022): string {
  const m = Math.round(Math.min(targetW, targetH) * marginFrac);
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
  "4:5":  [1080, 1350],
};
const TARGET_FPS = 30;
const FFMPEG_TIMEOUT_MS = 8 * 60 * 1000;

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
  fitMode?: string,
): Promise<string> {
  let args: string[];

  if (fitMode === "blur") {
    // Blur Background: split → (scale-up+crop+boxblur as bg) + (scale-to-fit as fg) → overlay
    // The background is scaled to fill then heavily blurred; the foreground is letterboxed
    // and composited centered over it, matching the master player's CSS blur preview.
    const fc = [
      `[0:v]split=2[bg][fg]`,
      `[bg]scale=${targetW}:${targetH}:force_original_aspect_ratio=increase,crop=${targetW}:${targetH},boxblur=luma_radius=20:luma_power=5[blurred]`,
      `[fg]scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,setsar=1[scaled]`,
      `[blurred][scaled]overlay=(W-w)/2:(H-h)/2,fps=fps=${targetFps},setsar=1[out]`,
    ].join(";");
    args = [
      "-threads", "2", // bound RAM: small instances OOM with FFmpeg's default thread count
      "-i", inputPath,
      "-filter_complex", fc,
      "-map", "[out]",
      "-c:v", "libx264",
      "-threads", "2", // output position: bounds the ENCODER (input-position -threads only throttles the decoder)
      "-preset", "ultrafast",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-video_track_timescale", "90000",
      "-an",
      "-movflags", "+faststart",
      "-y", outputPath,
    ];
  } else if (fitMode === "fill") {
    // Fill / Crop: scale up so the shorter dimension matches, then center-crop to
    // the target canvas — mirrors the master player's object-cover CSS behaviour.
    // No black bars; content fills the full frame.
    args = [
      "-threads", "2", // bound RAM: small instances OOM with FFmpeg's default thread count
      "-i", inputPath,
      "-vf", [
        `scale=${targetW}:${targetH}:force_original_aspect_ratio=increase`,
        `crop=${targetW}:${targetH}`,
        "setsar=1",
        `fps=fps=${targetFps}`,
      ].join(","),
      "-c:v", "libx264",
      "-threads", "2", // output position: bounds the ENCODER (input-position -threads only throttles the decoder)
      "-preset", "ultrafast",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-video_track_timescale", "90000",
      "-an",
      "-movflags", "+faststart",
      "-y", outputPath,
    ];
  } else {
    // "fit" or absent: letterbox with black bars — scale down so the entire frame
    // fits within the target canvas, pad remaining space with black.
    args = [
      "-threads", "2", // bound RAM: small instances OOM with FFmpeg's default thread count
      "-i", inputPath,
      "-vf", [
        `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease`,
        `pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:black`,
        "setsar=1",
        `fps=fps=${targetFps}`,
      ].join(","),
      "-c:v", "libx264",
      "-threads", "2", // output position: bounds the ENCODER (input-position -threads only throttles the decoder)
      "-preset", "ultrafast",
      "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-video_track_timescale", "90000",
      "-an",
      "-movflags", "+faststart",
      "-y", outputPath,
    ];
  }

  try {
    const { stderr } = await execFileAsync("ffmpeg", args, { timeout: 120_000 });
    return stderr;
  } catch (e: unknown) {
    const stderr = (e as { stderr?: string }).stderr ?? "";
    const msg    = e instanceof Error ? e.message : String(e);
    throw new Error(`Clip normalization failed: ${msg.slice(0, 200)}\nStderr: ${stderr.slice(-400)}`);
  }
}

/* ── Phase-1 segmented stitch (low-memory) ─────────────────────────────────
 * Stitches the normalized clips with their xfade transitions without ever
 * holding more than 2 short inputs inside one FFmpeg process.
 *
 * History: the original single-pass stitch opened all N clips as simultaneous
 * 1080x1920 inputs plus an xfade chain and OOM-killed 512MB instances
 * mid-render. The pairwise chain that replaced it re-encodes the accumulated
 * timeline at every step — O(n²) work, up to 6 lossy generations — and still
 * OOM'd on the final (longest) step. This version builds each timeline piece
 * exactly once, renders every transition as its own tiny 2-input xfade, and
 * joins the pieces with the concat demuxer (stream copy: no re-encode).
 * Peak RAM per FFmpeg invocation is ~2 short decodes; total encode work is
 * linear in the timeline length; each pixel is encoded at most twice
 * (piece + delivery pass).
 *
 * Timeline math — d_j = transition INTO clip j (0 = Cut/missing/degenerate),
 * c_j = normalized clip duration, p_j = trailing freeze-frame pad:
 *   E_j   = clip_j[d_j : c_j] ++ freeze(p_j)            (full piece file)
 *   T_j   = xfade( tail_dj(E_{j-1}), head_dj(clip_j) )  (transition, dur d_j)
 *   seg_j = E_j[0 : Ec_j − d_{j+1}]                      (overlap trimmed off)
 *   out   = seg_0 ++ T_1 ++ seg_1 ++ … ++ T_{n−1} ++ seg_{n−1}
 * Total = Σc_j − Σd_j + Σp_j — identical to the old chain.
 */
const PHASE1_XFADE_MAP: Record<string, string> = {
  "Crossfade":     "fade",
  "Fade to Black": "fadeblack",
  "Slide":         "slideleft",
  "Whip Pan":      "slideright",
  "Zoom":          "zoomin",
  "Blur Dissolve": "hblur",
  "Flash":         "fadewhite",
  "Glitch":        "pixelize",
  "Light Leak":    "fadewhite",
  "Spin":          "circlecrop",
};

async function stitchClipsPairwise(args: {
  log: ExportJobContext["log"];
  tmpDir: string;
  tmpFiles: string[];
  exportId: string;
  /** Normalized clip files, selected order. */
  clipPaths: string[];
  /** Trailing freeze-frame pad per selected position (gap before the NEXT clip). */
  trailingPads: number[];
  /** clipTransitions entry per selected position (transition INTO that clip). */
  transitions: ({ type: string; duration: number } | null)[];
  onStage: (stage: string) => void;
}): Promise<{ path: string; duration: number }> {
  const { log, tmpDir, tmpFiles, exportId, clipPaths, trailingPads, transitions, onStage } = args;
  const n = clipPaths.length;
  if (n < 2) throw new Error("stitchClipsPairwise needs at least 2 clips");

  const forgetFile = (p: string) => {
    try { if (existsSync(p)) unlinkSync(p); } catch { /* best-effort */ }
    const ti = tmpFiles.indexOf(p);
    if (ti >= 0) tmpFiles.splice(ti, 1);
  };
  const track = (p: string): string => { tmpFiles.push(p); return p; };

  // Identical encoding on every intermediate so the final concat demuxer can
  // stream-copy the pieces together with no re-encode.
  // NOTE on -threads placement: an input-position "-threads" (before -i) only
  // throttles the DECODER — the libx264 encoder ignores it and runs at auto
  // threads (1.5x host cores), which OOM-killed the 512MB instance. The
  // encoder must be constrained by an output-position -threads (after -i,
  // before the output path), which is what this tail provides.
  const pieceEncodeTail = (outPath: string): string[] => [
    "-c:v", "libx264",
    "-threads", "2", // output position: bounds the ENCODER (see note above)
    "-preset", "ultrafast",
    "-crf", "18", // intermediate; the delivery pass re-encodes to the final CRF
    "-pix_fmt", "yuv420p",
    // CRITICAL: normalizeClip() writes 90000 tbn; keep every intermediate on
    // the same timebase or xfade/concat die with "timebase do not match".
    "-video_track_timescale", "90000",
    "-an",
    "-y", outPath,
  ];

  // Duration-scaled timeout: production encodes can run as slow as ~0.13x
  // realtime on throttled instances, so allow 10x media duration with a
  // 10-minute floor. A previous 4x/3min timeout SIGTERM-killed a healthy
  // encode at 95% completion (clean stderr, exitCode null, no OOM).
  const runFfmpeg = async (ffArgs: string[], mediaDur: number, what: string): Promise<void> => {
    const outPath = ffArgs[ffArgs.length - 1]!;
    const stepTimeout = Math.max(600_000, Math.ceil(mediaDur * 10) * 1000);
    try {
      await execFileAsync("ffmpeg", ffArgs, { timeout: stepTimeout });
    } catch (e: unknown) {
      const err = e as { stderr?: string; killed?: boolean; signal?: string | null; code?: number | null };
      const stderr = err.stderr ?? "";
      const msg = e instanceof Error ? e.message : String(e);
      // execFileAsync sets killed=true when its own `timeout` fires — mark it
      // explicitly so a timeout kill is never again mistaken for a crash/OOM.
      const timedOut = err.killed === true;
      if (timedOut) {
        log.error({ what, stepTimeoutMs: stepTimeout, signal: err.signal ?? null },
          "[export][phase1] ffmpeg step TIMEOUT killing ffmpeg");
      }
      log.error({ what, ffmpegArgs: ffArgs, stderr, killed: err.killed ?? null, signal: err.signal ?? null, code: err.code ?? null },
        "[export][phase1] ffmpeg step failed");
      throw new Error(
        `${what} failed${timedOut ? " (ffmpeg timeout)" : ""}: ${msg.slice(0, 200)}\n` +
        `Stderr: ${stderr.slice(-2000)}`,
      );
    }
    if (!existsSync(outPath) || statSync(outPath).size < 1024) {
      throw new Error(`${what} produced no output file`);
    }
  };

  // Pre-probe every normalized input up front. The normalized (video-only)
  // files are the source of truth for durations — the container durations
  // probed from the pre-normalize sources can be longer when a source
  // carries an audio stream beyond its video. Fail fast here with a clear
  // message instead of a cryptic mid-stitch ffmpeg error.
  const probedDurs: number[] = [];
  for (let j = 0; j < n; j++) {
    const info = await probeVideo(clipPaths[j]!);
    if (!(info.duration > 0)) {
      throw new Error(
        `Scene stitch pre-check failed: normalized clip ${j + 1}/${n} has no probed duration ` +
        `(${clipPaths[j]}). The source clip may be corrupt or the normalize step produced no video.`,
      );
    }
    probedDurs.push(info.duration);
  }
  log.info({ clips: n, durations: probedDurs.map((d) => Number(d.toFixed(2))) }, "[export][phase1] inputs probed");

  const f3 = (v: number): string => v.toFixed(3);
  const transDur: number[] = new Array(n).fill(0);    // d_j: transition INTO clip j
  const transXf: string[] = new Array(n).fill("fade"); // xfade name per j (j>=1, when d_j>0)
  const piecePath: (string | null)[] = new Array(n).fill(null); // E_j files
  const pieceDur: number[] = new Array(n).fill(0);               // Ec_j probed
  const segPaths: string[] = [];                    // final concat bodies, in order
  const transPaths: (string | null)[] = new Array(n).fill(null); // T_j files (j>=1)

  // Resolve d_j (transition INTO clip j) with the old chain's safety clamps:
  // never take more than 80% of either side, and never more head than the
  // clip has. Needs E_{j-1}'s probed duration, so called as pieces are built.
  const resolveTransition = (j: number): void => {
    const trans = transitions[j] ?? null;
    let d = 0;
    if (trans && trans.type !== "Cut") {
      const wantDur = Number(trans.duration);
      const aAvail = pieceDur[j - 1]!;
      const bAvail = probedDurs[j]!;
      const clamp = Math.min(wantDur, aAvail * 0.8, bAvail * 0.8);
      if (Number.isFinite(clamp) && clamp > 0) {
        d = Number(clamp.toFixed(3));
        transXf[j] = PHASE1_XFADE_MAP[trans.type] ?? "fade";
      } else {
        log.warn({ step: j, type: trans.type, duration: trans.duration },
          "[export][phase1] transition math degenerate — falling back to hard cut");
      }
    }
    transDur[j] = d;
  };

  // L1 — full piece: clip content minus incoming-transition head, plus trailing pad.
  const buildPiece = async (j: number): Promise<void> => {
    const d = transDur[j]!;
    const c = probedDurs[j]!;
    const p = trailingPads[j] ?? 0;
    onStage(`stitching scene ${j + 1}/${n}`);
    const outPath = track(path.join(tmpDir, `bdv-piece-${exportId}-${j}.mp4`));
    const padF = p > 0 ? `,tpad=stop_mode=clone:stop_duration=${f3(p)}` : "";
    const fc = `[0:v]trim=start=${f3(d)}:end=${f3(c)},setpts=PTS-STARTPTS${padF}[out]`;
    log.info({ piece: j, headTrim: d, srcDur: Number(c.toFixed(3)), pad: p }, "[export][phase1] building piece");
    await runFfmpeg(["-threads", "2", "-i", clipPaths[j]!, "-filter_complex", fc, "-map", "[out]",
      ...pieceEncodeTail(outPath)], c, `Scene ${j + 1} piece`);
    const info = await probeVideo(outPath);
    if (!(info.duration > 0)) throw new Error(`Scene ${j + 1} piece has no probed duration`);
    piecePath[j] = outPath;
    pieceDur[j] = info.duration;
  };

  // L2 — transition clip: xfade of E_{j-1}'s tail with clip_j's head.
  // The A-side trim starts a hair early (one extra frame): xfade only consumes
  // the first `d` seconds at offset 0, so overshoot is harmless, but a probed
  // duration that overshoots reality by even a frame would starve the filter.
  // The B-side gets 0.1s of headroom past `d`, then the xfade output is trimmed
  // back to exactly `d`: ffmpeg 5.x's xfade hangs forever when its second input
  // ends exactly at offset+duration (it renders the transition frames, then spins
  // waiting for a frame that never comes). The output trim keeps the concat
  // timeline math exact. d is clamped to <= 80% of the clip, so d+0.1 of B-side
  // always exists (and trim just yields what's there in any degenerate case).
  const buildTransition = async (j: number): Promise<void> => {
    const d = transDur[j]!;
    if (!(d > 0)) return; // hard cut — no transition file
    const aPath = piecePath[j - 1]!;
    const aDur = pieceDur[j - 1]!;
    const outPath = track(path.join(tmpDir, `bdv-trans-${exportId}-${j}.mp4`));
    const fc =
      `[0:v]trim=start=${f3(Math.max(0, aDur - d - 0.05))},setpts=PTS-STARTPTS[a];` +
      `[1:v]trim=end=${f3(d + 0.1)},setpts=PTS-STARTPTS[b];` +
      `[a][b]xfade=transition=${transXf[j]}:duration=${f3(d)}:offset=0[x];` +
      `[x]trim=end=${f3(d)},setpts=PTS-STARTPTS[out]`;
    log.info({ trans: j, type: transXf[j], dur: d }, "[export][phase1] building transition");
    await runFfmpeg(["-threads", "2", "-i", aPath, "-i", clipPaths[j]!, "-filter_complex", fc, "-map", "[out]",
      ...pieceEncodeTail(outPath)], d * 2 + 1, `Scene ${j + 1} transition`);
    transPaths[j] = outPath;
  };

  // L3 — concat body: piece minus the tail consumed by the NEXT transition.
  // Frees the full piece file once the trimmed body exists.
  const buildSeg = async (j: number): Promise<void> => {
    const ePath = piecePath[j]!;
    const eDur = pieceDur[j]!;
    const nextD = j + 1 < n ? transDur[j + 1]! : 0;
    if (!(nextD > 0)) { segPaths.push(ePath); piecePath[j] = null; return; }
    const outPath = track(path.join(tmpDir, `bdv-seg-${exportId}-${j}.mp4`));
    const fc = `[0:v]trim=end=${f3(eDur - nextD)},setpts=PTS-STARTPTS[out]`;
    await runFfmpeg(["-threads", "2", "-i", ePath, "-filter_complex", fc, "-map", "[out]",
      ...pieceEncodeTail(outPath)], eDur, `Scene ${j + 1} segment`);
    forgetFile(ePath);
    piecePath[j] = null;
    segPaths.push(outPath);
  };

  // transDur[0] stays 0: nothing transitions INTO the first clip.
  await buildPiece(0);
  for (let j = 1; j < n; j++) {
    resolveTransition(j);  // needs E_{j-1}'s probed duration
    await buildPiece(j);   // needs d_j for the head trim
    await buildTransition(j);
    await buildSeg(j - 1); // needs d_j for the tail trim; E_{j-1} is spent after
  }
  // Last piece doubles as its own segment (no outgoing transition).
  segPaths.push(piecePath[n - 1]!);
  piecePath[n - 1] = null;

  // L4 — join everything with the concat demuxer (stream copy, no re-encode).
  // Every piece shares codec/pix_fmt/resolution/fps/timebase, so this is valid.
  const listPath = track(path.join(tmpDir, `bdv-concat-${exportId}.txt`));
  const listLines: string[] = [];
  for (let j = 0; j < n; j++) {
    listLines.push(`file '${segPaths[j]}'`);
    if (j + 1 < n && transPaths[j + 1]) listLines.push(`file '${transPaths[j + 1]}'`);
  }
  writeFileSync(listPath, listLines.join("\n") + "\n");
  const stitchedPath = track(path.join(tmpDir, `bdv-stitched-${exportId}.mp4`));
  onStage(`joining ${n} scenes`);
  try {
    await execFileAsync("ffmpeg",
      ["-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", "-y", stitchedPath],
      { timeout: 600_000 });
  } catch (e: unknown) {
    const err = e as { stderr?: string };
    log.error({ stderr: err.stderr ?? String(e) }, "[export][phase1] concat failed");
    throw new Error(`Scene concat failed: ${(err.stderr ?? String(e)).slice(-2000)}`);
  }
  if (!existsSync(stitchedPath) || statSync(stitchedPath).size < 1024) {
    throw new Error("Scene concat produced no output file");
  }
  // Release the per-piece files; the stitched file is all phase 2 needs.
  for (const p of segPaths) forgetFile(p);
  for (let j = 1; j < n; j++) if (transPaths[j]) forgetFile(transPaths[j]!);
  forgetFile(listPath);

  const predicted = probedDurs.reduce((a, b) => a + b, 0)
    - transDur.reduce((a, b) => a + b, 0)
    + trailingPads.reduce((a, b) => a + (b ?? 0), 0);
  const info = await probeVideo(stitchedPath);
  log.info({
    pieces: n,
    transitions: transDur.filter((d) => d > 0).length,
    predictedDuration: predicted.toFixed(3),
    actualDuration: info.duration.toFixed(3),
  }, "[export][phase1] stitch complete");
  return { path: stitchedPath, duration: info.duration > 0 ? info.duration : predicted };
}


function cleanup(...files: string[]) {
  for (const f of files) {
    try { if (existsSync(f)) unlinkSync(f); } catch { /* best-effort */ }
  }
}

/* ── POST /api/export-final-video ────────────────────── */
const EXPORT_CREDIT_COST = 5;

export interface ExportRequestBody {
    projectId: string;
    clipUrls: string[];
    audioUrl?: string | null;
    timelineOrder?: string[];
    testMode?: boolean;
    aspectRatio?: string;
    fadeAudioInSec?: number;
    fadeAudioOutSec?: number;
    loopAudio?: boolean;
    /** Offset (seconds) into the audio track where playback begins at video time 0.
     *  Mirrors settings.musicStudio.videoAudio.startSec and the master player. */
    audioStartSec?: number;
    /** Trim the audio so it never runs past the video length (studio "match length"). */
    matchVideoLength?: boolean;
    addWatermark?: boolean;
    customWatermarkUrl?: string | null;
    /** Legacy (non-branding) watermark placement — mirrors settings.watermarkPosition. */
    watermarkPosition?: string;
    /** Legacy (non-branding) watermark size — mirrors settings.watermarkSize. */
    watermarkSize?: string;
    /** Legacy (non-branding) watermark corner offset (px, at a 1000px-reference shorter
     *  dimension) — mirrors settings.watermarkMargin. Converted to a %-of-resolution
     *  margin so it matches how the Master Player preview scales it. */
    watermarkMargin?: number;
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
    /** Freeform/manual layout: seconds of freeze-frame padding to hold immediately
     *  BEFORE each clip (index-aligned with clipUrls, already in playback order) —
     *  index 0's value is the leading gap before the first clip ever appears
     *  (rendered as a black lead-in), later indices are the gap since the previous
     *  clip (rendered as that previous clip's frozen last frame). 0/absent = no gap. */
    manualGapsBeforeSec?: (number | null)[] | null;
    /** Global Auto AI effects (color grade, film grain, glow, blur, vignette,
     *  B&W, neon glow, VHS, cinematic bars, etc.) — mirrors settings.effects
     *  and the master player's live CSS preview. Translated to FFmpeg via the
     *  shared buildEffectStack() (effects-ffmpeg.ts) — same code Export Doctor uses. */
    effects?: string[] | null;
    /** Active overlay effect names from settings.overlays (e.g. "Light Leaks",
     *  "Animated Waveform", "Logo / Watermark"). Burned into the export via
     *  dedicated FFmpeg filter chains. */
    overlayEffects?: string[] | null;
    /** Per-overlay intensity (0–100) keyed by overlay name, from settings.overlayIntensity. */
    overlayEffectIntensity?: Record<string, number> | null;
    /** How source clips fill the target canvas during normalization.
     *  "fill" = crop to fill (default), "fit" = letterbox with black bars,
     *  "blur" = blurred zoomed-in background behind letterboxed foreground. */
    fitMode?: string | null;
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
      /** URL for "image" / "watermark" overlay items (e.g. a user-uploaded logo). */
      source?: string | null;
      /** 1–200, interpreted as % width for images. */
      size?: number;
    }[] | null;
}

interface ExportJobContext {
  body: ExportRequestBody;
  userId: string;
  userPlan?: string;
  userSupabase?: SupabaseClient;
  log: { info: (...args: any[]) => void; warn: (...args: any[]) => void; error: (...args: any[]) => void };
  statusRef: ExportStatusRef;
}
/**
 * The full export render, detached from any HTTP request lifecycle.
 * Runs in the background via the export job queue; progress is observable
 * through ctx.statusRef (mirrored from exportStatus.ffmpegStage).
 * Resolves with the exact payload the old synchronous route returned;
 * rejects with a structured { status, message, code?, ... } on failure.
 */
async function executeExport(ctx: ExportJobContext): Promise<Record<string, unknown>> {
  const {
    projectId,
    clipUrls,
    audioUrl,
    timelineOrder,
    testMode,
    aspectRatio = "9:16",
    fadeAudioInSec = 0,
    fadeAudioOutSec = 0,
    loopAudio = false,
    audioStartSec = 0,
    matchVideoLength = true,
    addWatermark = false,
    customWatermarkUrl,
    watermarkPosition = "bottom-right",
    watermarkSize = "medium",
    watermarkMargin = 16,
    audioSource = "uploaded",
    captions,
    branding,
    exportRangeStart,
    exportRangeEnd,
    prepareId,
    clipTransitions,
    overlayItems,
    manualGapsBeforeSec,
    effects,
    overlayEffects,
    overlayEffectIntensity,
    fitMode,
  } = ctx.body;

  const [TARGET_W, TARGET_H] = ASPECT_DIMS[aspectRatio] ?? ASPECT_DIMS["9:16"]!;

  const exportId = randomUUID();
  const tmpDir = os.tmpdir();
  const tmpFiles: string[] = [];
  const exportStatus = makeStatus();
  ctx.statusRef.current = exportStatus;
  let preparedExportAcquired = false;

  try {
    /* ── Server-side watermark gate: only subscribers may remove it.
       The client sends addWatermark, but a free/trial user calling the API
       directly must not be able to bypass it. Mirrors the frontend gate. ── */
    const FREE_PLANS = ["", "free", "trial", "none", "null"];
    const userPlan = (ctx.userPlan ?? "free").toLowerCase().trim();
    const isSubscriber = !FREE_PLANS.includes(userPlan);
    const effectiveAddWatermark = isSubscriber ? addWatermark : true;

    ctx.log.info({
      clipCount: clipUrls.length,
      aspectRatio,
      resolution: `${TARGET_W}x${TARGET_H}`,
      audioSource,
      hasAudio: !!audioUrl,
      fadeAudioInSec,
      fadeAudioOutSec,
      loopAudio,
      audioStartSec,
      matchVideoLength,
      addWatermark: effectiveAddWatermark,
      addWatermarkRequested: addWatermark,
      userPlan,
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
        throw { status: 400,
          error: "Prepare session expired or not found (likely the server restarted or 30+ minutes passed since preparing). Click 'Prepare Export Files Only' again before exporting.",
          code: "PREPARE_STALE",
          exportStatus,
        };
      }
      if (!preparedEntry.allReady) {
        const failed = preparedEntry.clips
          .filter((c) => !c.readyForFFmpeg)
          .map((c) => `Scene ${c.sceneNumber}${c.error ? `: ${c.error.slice(0, 80)}` : ""}`);
        throw { status: 400,
          error: `FFmpeg blocked — ${failed.length} clip${failed.length !== 1 ? "s" : ""} failed preparation: ${failed.join(" | ")}. Fix the errors and re-prepare before exporting.`,
          exportStatus,
        };
      }
      // Double-check every prepared file still exists on disk
      for (const pc of preparedEntry.clips) {
        if (!existsSync(pc.localPath)) {
          throw { status: 400,
            error: `Scene ${pc.sceneNumber} prepared file is gone from disk (${pc.localPath}) — likely the server restarted since preparing. Re-prepare before exporting.`,
            code: "PREPARE_STALE",
            exportStatus,
          };
        }
      }
      // ── Audio hard stop: if audio was requested it must be ready + on disk ──
      if (preparedEntry.audio?.requested) {
        if (!preparedEntry.audio.ready) {
          throw { status: 400,
            error: `FFmpeg blocked — project audio failed preparation: ${preparedEntry.audio.error ?? "unknown error"}. Re-prepare before exporting.`,
            exportStatus,
          };
        }
        if (!existsSync(preparedEntry.audio.localPath)) {
          throw { status: 400,
            error: `Prepared audio file is gone from disk (${preparedEntry.audio.localPath}) — likely the server restarted since preparing. Re-prepare before exporting.`,
            code: "PREPARE_STALE",
            exportStatus,
          };
        }
      }

      // ── Source-identity hard stop: prepared files must match the EXACT clips/audio being exported ──
      if (preparedEntry.clips.length !== clipUrls.length) {
        throw { status: 400,
          error: `FFmpeg blocked — clip selection changed since preparation (prepared ${preparedEntry.clips.length}, exporting ${clipUrls.length}). Re-prepare before exporting.`,
          code: "PREPARE_STALE",
          exportStatus,
        };
      }
      for (let i = 0; i < clipUrls.length; i++) {
        if (preparedEntry.clips[i]!.resolvedUrl !== clipUrls[i]) {
          throw { status: 400,
            error: `FFmpeg blocked — clip ${i + 1} source changed since preparation. Re-prepare before exporting so the export uses the same clips as the player.`,
            code: "PREPARE_STALE",
            exportStatus,
          };
        }
      }
      const requestedAudio = !!audioUrl?.trim();
      if (requestedAudio) {
        if (!preparedEntry.audio?.requested) {
          throw { status: 400,
            error: `FFmpeg blocked — audio was added after preparation. Re-prepare before exporting so the export includes the player's audio.`,
            code: "PREPARE_STALE",
            exportStatus,
          };
        }
        if (preparedEntry.audio.sourceUrl !== audioUrl) {
          throw { status: 400,
            error: `FFmpeg blocked — audio source changed since preparation. Re-prepare before exporting so the export uses the same audio as the player.`,
            code: "PREPARE_STALE",
            exportStatus,
          };
        }
      }
    }

    const usePrepared = !!(
      preparedEntry &&
      preparedEntry.projectId === projectId &&
      preparedEntry.allReady &&
      preparedEntry.clips.length === clipUrls.length
    );

    // ── Guard against concurrent/duplicate export requests for the same
    // prepareId deleting files this request still needs mid-run. Acquired
    // here (right after every hard-stop check has passed) and released in
    // the outer `finally` block, which is the only place cleanup happens.
    if (usePrepared && preparedEntry && prepareId) {
      acquirePreparedExport(prepareId);
      preparedExportAcquired = true;
    }

    if (usePrepared && preparedEntry) {
      ctx.log.info({ prepareId, clipCount: preparedEntry.clips.length }, "[export] using pre-downloaded clips from prepare step");
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
        ctx.log.info({ scene: pc.sceneNumber, fileSize: sz, duration: pc.duration.toFixed(2) }, "[export] pre-prepared clip accepted ✓");
      }
      // NOTE: do NOT delete prepared files here — they are still needed for dedup check and normalization.
      // Cleanup happens in the finally block below.
    } else {
      if (prepareId && !preparedEntry) {
        ctx.log.warn({ prepareId }, "[export] prepareId not found in registry — falling back to live download");
      }
      exportStatus.ffmpegStage = "downloading clips";

      for (let i = 0; i < clipUrls.length; i++) {
        const url = clipUrls[i]!;
        if (!url.startsWith("http")) throw new Error(`Clip ${i + 1}: invalid URL — "${url.slice(0, 60)}"`);

        const dest = path.join(tmpDir, `bdv-clip-${exportId}-${i}.mp4`);
        tmpFiles.push(dest);

        ctx.log.info({ i: i + 1, url: url.slice(0, 80) }, "[export] downloading clip");

        try {
          await downloadToFile(url, dest);
        } catch (dlErr) {
          throw new Error(`Clip ${i + 1} could not be downloaded: ${dlErr instanceof Error ? dlErr.message : String(dlErr)}`);
        }

        const dlSize = statSync(dest).size;
        ctx.log.info({ i: i + 1, fileSize: dlSize }, "[export] clip downloaded");
        if (dlSize < 2048) {
          throw new Error(
            `Scene ${i + 1} clip download appears incomplete — file is only ${dlSize} bytes. ` +
            `URL: ${url.slice(0, 80)}`,
          );
        }

        const info = await probeVideo(dest);
        ctx.log.info({
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
    ctx.log.info({ clipsValidated: clipInfos.length }, "[export] all clips validated");

    /* ── Freeform layout: gap-before padding held as freeze-frame ──
     *  (mirrors the editor preview's gap behavior). Index-aligned with clipUrls.
     *  gapsBefore[0] is the leading gap before the first clip ever appears
     *  (rendered as a black lead-in); gapsBefore[i>0] is the gap since the
     *  previous clip (rendered as that previous clip's frozen last frame). */
    const gapsBefore: number[] = clipUrls.map((_, i) => {
      const g = Array.isArray(manualGapsBeforeSec) ? manualGapsBeforeSec[i] : null;
      return typeof g === "number" && isFinite(g) && g > 0 ? g : 0;
    });
    let effectiveClipDurations = clipInfos.map((c, i) => c.duration + (gapsBefore[i] ?? 0));

    /* ── Compute total video duration (clips + optional intro/outro cards) ── */
    const totalClipsDuration = effectiveClipDurations.reduce((sum, d) => sum + d, 0);
    const introEnabled = !!(branding?.introCard?.enabled);
    const outroEnabled = !!(branding?.outroCard?.enabled);
    const introDuration = introEnabled ? (branding!.introCard!.duration ?? 3) : 0;
    const outroDuration = outroEnabled ? (branding!.outroCard!.duration ?? 3) : 0;
    const totalVideoDuration = totalClipsDuration + introDuration + outroDuration;

    /* ── Compute clip timeline positions ── */
    const clipTimelineStarts: number[] = [];
    let clipCursor = introDuration;
    for (let i = 0; i < clipInfos.length; i++) {
      clipTimelineStarts.push(clipCursor);
      clipCursor += effectiveClipDurations[i]!;
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
      ctx.log.info({ effectiveStart, effectiveEnd, effectiveDuration: effectiveDuration.toFixed(3) }, "[export] range export active");
    }

    /* ── Determine which clips overlap the export range ── */
    // Clips not in range are skipped (not downloaded for normalize) saving time on test exports.
    const includeIntro = introEnabled && effectiveStart < introDuration;
    const includeOutro = outroEnabled && effectiveEnd > (introDuration + totalClipsDuration);
    let selectedClipOrigIndices: number[] = [];
    for (let i = 0; i < clipInfos.length; i++) {
      const cStart = clipTimelineStarts[i]!;
      const cEnd   = cStart + effectiveClipDurations[i]!;
      if (!useRange || (cEnd > effectiveStart && cStart < effectiveEnd)) {
        selectedClipOrigIndices.push(i);
      }
    }
    ctx.log.info({
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
      ctx.log.info({
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
      ctx.log.warn({ fingerprints: clipFingerprints }, "[export] identical clips detected");
    } else {
      ctx.log.info({ fingerprints: clipFingerprints }, "[export] all clips are distinct");
    }

    /* ── 1c: Normalize selected clips to target format ── */
    // Pre-normalizing ensures all clips are concat-compatible: same resolution, fps, codec, pix_fmt.
    // Only clips overlapping the export range are normalized (saves time on short test exports).
    let normalizedPaths: string[] = []; // aligned 1:1 with selectedClipOrigIndices
    for (let j = 0; j < selectedClipOrigIndices.length; j++) {
      const origIdx  = selectedClipOrigIndices[j]!;
      const srcPath  = clipPaths[origIdx]!;
      const normPath = path.join(tmpDir, `bdv-norm-${exportId}-${origIdx}.mp4`);
      tmpFiles.push(normPath);

      exportStatus.ffmpegStage = `normalizing clip ${j + 1}/${selectedClipOrigIndices.length}`;
      ctx.log.info({ scene: origIdx + 1, normPath }, "[export] normalizing clip");

      await normalizeClip(srcPath, normPath, TARGET_W, TARGET_H, TARGET_FPS, fitMode ?? undefined);

      if (!existsSync(normPath) || statSync(normPath).size < 1024) {
        throw new Error(`Scene ${origIdx + 1} failed to normalize — output file missing or empty`);
      }
      normalizedPaths.push(normPath);
    }
    exportStatus.clipsNormalized = normalizedPaths.length;
    ctx.log.info({ clipsNormalized: normalizedPaths.length }, "[export] all clips normalized");

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
      ctx.log.info(
        { scene: origIdx + 1, file: path.basename(np), bytes: npSize },
        "[export] pre-flight: clip verified ✓",
      );
    }
    ctx.log.info(
      { count: normalizedPaths.length },
      "[export] pre-flight passed — all normalized clips present and valid",
    );

    /* ── 1e: Phase-1 pairwise stitch (low-memory) ──
     * The old single-pass stitch opened every clip as a simultaneous FFmpeg
     * input (7x 1080x1920 decoders + xfade chain) and OOM-killed small
     * instances. Phase 1 stitches pairwise (2 inputs max) into one silent
     * intermediate; phase 2 (the existing pipeline below) then treats it as
     * a single clip and applies effects/titles/overlays/captions/audio.
     * Stash the range's first original index BEFORE re-pointing the clip
     * variables at the stitched file — the leading-gap calc needs it. */
    const rangeFirstOrigIdx = selectedClipOrigIndices[0];
    if (normalizedPaths.length > 1) {
      const n = normalizedPaths.length;
      const stitched = await stitchClipsPairwise({
        log: ctx.log,
        tmpDir,
        tmpFiles,
        exportId,
        clipPaths: [...normalizedPaths],
        trailingPads: selectedClipOrigIndices.map((o, p) =>
          p + 1 < n ? (gapsBefore[selectedClipOrigIndices[p + 1]!] ?? 0) : 0,
        ),
        transitions: selectedClipOrigIndices.map((o) => clipTransitions?.[o] ?? null),
        onStage: (s) => { exportStatus.ffmpegStage = s; },
      });
      ctx.log.info(
        { stitched: path.basename(stitched.path), duration: stitched.duration.toFixed(3) },
        "[export] phase-1 stitch done — phase 2 sees a single clip",
      );
      // Phase 2 only needs the stitched file — release the per-clip normalized
      // files now so peak disk stays flat vs the old single-pass pipeline.
      for (const p of normalizedPaths) {
        try { unlinkSync(p); } catch { /* best-effort */ }
        const ti = tmpFiles.indexOf(p);
        if (ti >= 0) tmpFiles.splice(ti, 1);
      }
      normalizedPaths = [stitched.path];
      selectedClipOrigIndices = [0];
      effectiveClipDurations = [stitched.duration];
    }

    /* ── 2: Resolve audio (reuse prepared file or download fresh) ── */
    let audioPath: string | null = null;
    const DEFAULT_WATERMARK = path.join(WORKSPACE_ROOT, "artifacts/bow-down-visuals/public/bdv-watermark.png");

    if (!testMode && usePrepared && preparedEntry?.audio?.ready && existsSync(preparedEntry.audio.localPath)) {
      // Use the EXACT audio file already downloaded + ffprobe-verified in prepare step
      audioPath = preparedEntry.audio.localPath;
      ctx.log.info({
        audioPath,
        fileSize: preparedEntry.audio.fileSize,
        duration: preparedEntry.audio.duration.toFixed(2),
      }, "[export] using pre-downloaded audio from prepare step ✓");
    } else if (!testMode && !!audioUrl?.trim()) {
      const ext = audioUrl!.includes(".mp3") ? ".mp3" : audioUrl!.includes(".ogg") ? ".ogg" : audioUrl!.includes(".wav") ? ".wav" : ".aac";
      audioPath = path.join(tmpDir, `bdv-audio-${exportId}${ext}`);
      tmpFiles.push(audioPath);
      ctx.log.info({ audioUrl: audioUrl!.slice(0, 80), audioSource }, "[export] downloading audio");
      await downloadToFile(audioUrl!, audioPath);
      const audioSize = statSync(audioPath).size;
      ctx.log.info({ audioSize, audioSource }, "[export] audio downloaded");
    }

    /* ── 2b: Resolve watermark image path ── */
    let watermarkPath: string | null = null;
    if (effectiveAddWatermark) {
      if (customWatermarkUrl?.startsWith("http")) {
        const wmExt = /\.(jpe?g)($|\?)/.test(customWatermarkUrl) ? ".jpg"
          : /\.webp($|\?)/.test(customWatermarkUrl) ? ".webp" : ".png";
        const wmDest = path.join(tmpDir, `bdv-wm-${exportId}${wmExt}`);
        tmpFiles.push(wmDest);
        try {
          await downloadToFile(customWatermarkUrl, wmDest);
          watermarkPath = wmDest;
          ctx.log.info({ bytes: statSync(wmDest).size }, "[export] custom watermark downloaded");
        } catch (wmErr) {
          ctx.log.warn({ err: String(wmErr) }, "[export] custom watermark download failed, falling back to default");
          watermarkPath = DEFAULT_WATERMARK;
        }
      } else {
        watermarkPath = DEFAULT_WATERMARK;
      }
      if (IS_DEV) ctx.log.info({ watermarkPath }, "[export][debug] watermark resolved");
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
        ctx.log.info(
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
          ctx.log.info({ bytes: statSync(bwmDest).size }, "[export] branding custom logo downloaded");
        } catch (e) {
          ctx.log.warn({ err: String(e) }, "[export] branding logo failed, using BDV default");
          brandingWmPath = bwm.bdvWatermark !== false ? DEFAULT_WATERMARK : null;
        }
      } else if (bwm.bdvWatermark !== false) {
        brandingWmPath = DEFAULT_WATERMARK;
      }
    }
    // branding.watermark wins; else fall back to legacy addWatermark toggle
    const activeWmPath = useBrandingWm ? brandingWmPath : (effectiveAddWatermark ? watermarkPath : null);

    /* ── 2e: Download "image"/"watermark" overlay item sources (e.g. a user's logo
     *  placed via the structured overlay editor) so they can be burned in with
     *  the FFmpeg `overlay` filter — previously these were silently dropped. ── */
    const overlayImagePaths: (string | null)[] = [];
    if (Array.isArray(overlayItems)) {
      for (let i = 0; i < overlayItems.length; i++) {
        const ov = overlayItems[i]!;
        if ((ov.type === "image" || ov.type === "watermark") && ov.source?.startsWith("http")) {
          const ext = /\.(jpe?g)($|\?)/.test(ov.source) ? ".jpg"
            : /\.webp($|\?)/.test(ov.source) ? ".webp" : ".png";
          const dest = path.join(tmpDir, `bdv-ovimg-${exportId}-${i}${ext}`);
          tmpFiles.push(dest);
          try {
            await downloadToFile(ov.source, dest);
            overlayImagePaths[i] = dest;
            ctx.log.info({ idx: i, bytes: statSync(dest).size }, "[export] overlay image downloaded");
          } catch (e) {
            ctx.log.warn({ err: String(e), idx: i }, "[export] overlay image download failed, skipping");
            overlayImagePaths[i] = null;
          }
        } else {
          overlayImagePaths[i] = null;
        }
      }
    }

    /* ── 3: Plan FFmpeg input indices ── */
    // Clips fed to FFmpeg are the pre-normalized subset (only those overlapping the range).
    // Freeform layout: a leading gap before the very first rendered clip has no
    // previous clip to freeze on, so it's rendered as its own black lavfi segment
    // (mirrors the editor preview, which shows nothing until the first clip's
    // manual position is reached).
    const leadingGapSec = normalizedPaths.length > 0
      ? Math.max(0, gapsBefore[rangeFirstOrigIdx!] ?? 0)
      : 0;
    let nextIdx = 0;
    const introInputIdx = includeIntro ? nextIdx++ : -1;
    const leadGapInputIdx = leadingGapSec > 0 ? nextIdx++ : -1;
    const clipBaseIdx   = nextIdx;
    nextIdx += normalizedPaths.length;           // only selected/normalized clips
    const outroInputIdx = includeOutro ? nextIdx++ : -1;
    const audioInputIdx = audioPath ? nextIdx++ : -1;
    const wmInputIdx    = activeWmPath ? nextIdx++ : -1;
    // One FFmpeg input per successfully-downloaded overlay image, index-aligned with overlayItems.
    const overlayImgInputIdx: number[] = overlayImagePaths.map((p) => (p ? nextIdx++ : -1));

    /* ── 3b: Build video filter_complex ── */
    // Clips are already normalized to target resolution/fps/codec — no scale filter needed.
    const filterParts: string[] = [];

    // Resolve overlay effects helpers (used for wmAlpha override + filter injection below)
    const overlayEffectsArr: string[] = Array.isArray(overlayEffects) ? overlayEffects : [];
    const overlayIntensityMap: Record<string, number> =
      overlayEffectIntensity && typeof overlayEffectIntensity === "object" && !Array.isArray(overlayEffectIntensity)
        ? (overlayEffectIntensity as Record<string, number>)
        : {};
    // When Animated Waveform is active the audio stream is routed through the
    // filter_complex via asplit; this label tracks the filter_complex audio output
    // so the -map and -af sections below can switch accordingly.
    let audioOutputFcLabel: string | null = null;

    // Reset timestamps for each normalized clip. Freeform-layout gaps BETWEEN clips
    // are represented by padding the PRECEDING clip with a frozen copy of its last
    // frame (tpad), mirroring the editor preview's "hold last frame during gap"
    // behavior — gapsBefore[nextOrigIdx] becomes trailing padding on this clip.
    for (let i = 0; i < normalizedPaths.length; i++) {
      const nextOrigIdx = i + 1 < normalizedPaths.length ? selectedClipOrigIndices[i + 1]! : -1;
      const gap = nextOrigIdx >= 0 ? (gapsBefore[nextOrigIdx] ?? 0) : 0;
      const padSuffix = gap > 0 ? `,tpad=stop_mode=clone:stop_duration=${gap.toFixed(3)}` : "";
      filterParts.push(`[${clipBaseIdx + i}:v]setpts=PTS-STARTPTS${padSuffix}[v${i}]`);
    }

    // Leading gap before the very first rendered clip: no previous clip exists to
    // freeze on, so hold a plain black frame instead (mirrors the editor preview,
    // which shows nothing until the first clip's manual position is reached).
    if (leadGapInputIdx >= 0) {
      filterParts.push(`[${leadGapInputIdx}:v]setpts=PTS-STARTPTS[leadgap]`);
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
      let accDuration = effectiveClipDurations[selectedClipOrigIndices[0]!]!;
      for (let j = 1; j < normalizedPaths.length; j++) {
        const origIdx  = selectedClipOrigIndices[j]!;
        const trans    = activeTransitions![origIdx] ?? null;
        const clipDur  = effectiveClipDurations[origIdx]!;
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
      if (leadGapInputIdx >= 0) outerSegs.push("[leadgap]");
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
      if (leadGapInputIdx >= 0) segments.push("[leadgap]");
      for (let i = 0; i < normalizedPaths.length; i++) segments.push(`[v${i}]`);
      if (outroInputIdx >= 0) segments.push("[outro_card]");
      filterParts.push(`${segments.join("")}concat=n=${segments.length}:v=1:a=0[vconcat]`);
    }

    // ── Global Auto AI effects (color grade, film grain, glow, blur, vignette,
    //    B&W, neon glow, VHS, cinematic bars, etc.) — SAME translation Export
    //    Doctor uses (buildEffectStack in effects-ffmpeg.ts), so a real export
    //    matches what the diagnostics panel already predicted. Animated overlays
    //    (Smoke/Rain/Sparks/etc.) are intentionally not in this map and stay
    //    preview-only. ──
    if (Array.isArray(effects) && effects.length > 0) {
      const effectStack = buildEffectStack(effects, effectiveDuration);
      if (effectStack.filter) {
        filterParts.push(`[${workLabel}]${effectStack.filter}[veffects]`);
        workLabel = "veffects";
        ctx.log.info({
          applied: effectStack.applied,
          unsupported: effectStack.unsupported,
          conflict: effectStack.conflict,
        }, "[export] effects filter chain applied");
      }
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

    // ── Structured overlay items: drawtext (text/lower-third), drawbox (color),
    //    and overlay (image/watermark — e.g. a user-uploaded logo) ──
    if (Array.isArray(overlayItems) && overlayItems.length > 0) {
      // Margins scale with the shorter frame dimension so text/logo placement stays
      // proportionally consistent across all export aspect ratios (was fixed px).
      const shortDim = Math.min(TARGET_W, TARGET_H);
      const em = Math.round(shortDim * 0.028);  // edge margin (was 30/50px)
      const bm = Math.round(shortDim * 0.074);  // bottom margin (was 80px)
      const OVERLAY_POS: Record<string, { x: string; y: string }> = {
        "top-left":     { x: `${em}`,           y: `${em}` },
        "top-center":   { x: "(w-text_w)/2",    y: `${em}` },
        "top-right":    { x: `w-text_w-${em}`,  y: `${em}` },
        "center-left":  { x: `${em}`,           y: "(h-text_h)/2" },
        "center":       { x: "(w-text_w)/2",    y: "(h-text_h)/2" },
        "center-right": { x: `w-text_w-${em}`,  y: "(h-text_h)/2" },
        "bottom-left":  { x: `${em}`,           y: `h-text_h-${bm}` },
        "bottom-center":{ x: "(w-text_w)/2",    y: `h-text_h-${bm}` },
        "bottom-right": { x: `w-text_w-${em}`,  y: `h-text_h-${bm}` },
      };
      // Same corner anchors expressed for the `overlay` filter, where W/H are the
      // main video dims and w/h are the overlay (image) dims.
      const IMG_OVERLAY_POS: Record<string, { x: string; y: string }> = {
        "top-left":     { x: `${em}`,          y: `${em}` },
        "top-center":   { x: "(W-w)/2",        y: `${em}` },
        "top-right":    { x: `W-w-${em}`,      y: `${em}` },
        "center-left":  { x: `${em}`,          y: "(H-h)/2" },
        "center":       { x: "(W-w)/2",        y: "(H-h)/2" },
        "center-right": { x: `W-w-${em}`,      y: "(H-h)/2" },
        "bottom-left":  { x: `${em}`,          y: `H-h-${bm}` },
        "bottom-center":{ x: "(W-w)/2",        y: `H-h-${bm}` },
        "bottom-right": { x: `W-w-${em}`,      y: `H-h-${bm}` },
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
        } else if (ov.type === "image" || ov.type === "watermark") {
          const imgIdx = overlayImgInputIdx[ovIdx] ?? -1;
          if (imgIdx < 0) { ovIdx++; continue; } // source missing/failed to download
          const pos     = IMG_OVERLAY_POS[ov.position ?? "bottom-right"] ?? IMG_OVERLAY_POS["bottom-right"]!;
          // ov.size is a 5–90% width, matching the live preview's clamp (OverlayLayer.tsx).
          const widthPct = Math.max(5, Math.min(90, ov.size ?? 20));
          const imgW     = Math.round(TARGET_W * (widthPct / 100));
          const alpha    = (ov.opacity != null ? ov.opacity / 100 : 1.0).toFixed(2);
          const scaledLabel = `ovimg${ovIdx}`;
          filterParts.push(`[${imgIdx}:v]scale=${imgW}:-2,format=rgba,colorchannelmixer=aa=${alpha}[${scaledLabel}]`);
          filterParts.push(
            `[${workLabel}][${scaledLabel}]overlay=${pos.x}:${pos.y}:format=auto${enableClause ? `:${enableClause}` : ""}[${nextLabel}]`,
          );
          workLabel = nextLabel;
        }
        // vignette, film-grain, light-leak, particles: too complex for drawtext/overlay
        // to replicate the CSS preview faithfully — intentionally skipped in export.
        ovIdx++;
      }
    }

    // ── Light Leaks overlay: warm-tinted semi-transparent drawbox ──
    // Approximates the CSS Light Leaks effect at the user-configured intensity.
    if (overlayEffectsArr.includes("Light Leaks")) {
      const leakOpacity = ((overlayIntensityMap["Light Leaks"] ?? 20) / 100).toFixed(2);
      filterParts.push(
        `[${workLabel}]drawbox=x=0:y=0:w=iw:h=ih:color=0xFF7733@${leakOpacity}:t=fill[vleak]`,
      );
      workLabel = "vleak";
      ctx.log.info({ leakOpacity }, "[export] light leaks overlay injected");
    }

    // ── Lens Flare overlay: anamorphic-style horizontal streak + hotspot ──
    // Approximates a cinematic lens flare: a soft horizontal light streak
    // across the upper third plus a bright hotspot. Intensity scales opacity.
    if (overlayEffectsArr.includes("Lens Flare")) {
      const flareOpacity = ((overlayIntensityMap["Lens Flare"] ?? 20) / 100).toFixed(2);
      const streakY = Math.round(TARGET_H * 0.32);
      const streakH = Math.max(2, Math.round(TARGET_H * 0.008));
      const hotX = Math.round(TARGET_W * 0.72);
      const hotY = Math.round(TARGET_H * 0.28);
      const hotSize = Math.round(Math.min(TARGET_W, TARGET_H) * 0.06);
      filterParts.push(
        `[${workLabel}]drawbox=x=0:y=${streakY}:w=iw:h=${streakH}:color=0xFFF4E0@${flareOpacity}:t=fill,` +
        `drawbox=x=${hotX - hotSize}:y=${hotY - hotSize}:w=${hotSize * 2}:h=${hotSize * 2}:color=0xFFFFFF@${flareOpacity}:t=fill,` +
        `boxblur=lr=${Math.round(hotSize / 2)}:lp=${Math.round(hotSize / 4)}[vflare]`,
      );
      workLabel = "vflare";
      ctx.log.info({ flareOpacity }, "[export] lens flare overlay injected");
    }

    // ── Animated Waveform overlay: audio-driven showwaves at bottom of frame ──
    // The audio stream must be split via asplit before referencing it in the
    // filter_complex. Without asplit, FFmpeg throws a "stream already used" error
    // when the same audio input appears both inside filter_complex (for showwaves)
    // and in a direct `-map audioInputIdx:a` outside it. asplit forks the stream:
    // [audiofmap] → audio output map, [audiowave] → showwaves visualization.
    // All audio filters (atrim/afade/loop) are inlined in filter_complex here
    // (not via -af) because FFmpeg forbids combining -af with a stream already
    // mapped from a complex filtergraph (exit 234).
    if (overlayEffectsArr.includes("Animated Waveform") && !audioPath) {
      ctx.log.warn(
        { overlayEffects: overlayEffectsArr, audioUrl: audioUrl?.slice(0, 80) ?? null },
        "[export] Animated Waveform overlay is active but no audio was resolved — waveform will be skipped. " +
        "Ensure audio source is not 'none' and a valid audio URL is forwarded to the export request.",
      );
    }
    if (overlayEffectsArr.includes("Animated Waveform") && audioPath && audioInputIdx >= 0) {
      const waveOpacity = ((overlayIntensityMap["Animated Waveform"] ?? 20) / 100).toFixed(2);
      const waveH       = Math.round(TARGET_H * 0.08);   // ~8% of frame height
      const wavePosY    = TARGET_H - waveH - Math.round(TARGET_H * 0.06);

      // Build audio filter chain to inline in filter_complex for the waveform path.
      // FFmpeg forbids combining -af with a stream mapped from filter_complex, so
      // all audio filters must live here. atrim duration = effectiveDuration +
      // rangeRelativeStart so there is enough audio for the output-side -ss seek
      // to consume and still leave a full effectiveDuration of audio in the output.
      const wfAtrimDur = (effectiveDuration + rangeRelativeStart).toFixed(3);
      const wfAudioParts: string[] = [];
      if (loopAudio) {
        wfAudioParts.push(`aloop=loop=-1:size=2147483647`);
        wfAudioParts.push(`atrim=duration=${wfAtrimDur}`);
        wfAudioParts.push(`asetpts=PTS-STARTPTS`);
      } else if (matchVideoLength) {
        wfAudioParts.push(`atrim=duration=${wfAtrimDur}`);
        wfAudioParts.push(`asetpts=PTS-STARTPTS`);
      }
      if (fadeAudioInSec > 0) {
        // Start the fade-in at rangeRelativeStart (not 0) so that after the
        // output-side -ss seek discards the first rangeRelativeStart seconds,
        // the user hears the full fade-in from the very beginning of the output.
        // For full-video exports rangeRelativeStart=0, so this is a no-op there.
        const wfFadeInStart = rangeRelativeStart;
        wfAudioParts.push(`afade=t=in:st=${wfFadeInStart.toFixed(3)}:d=${fadeAudioInSec.toFixed(3)}`);
      }
      if (fadeAudioOutSec > 0 && effectiveDuration > fadeAudioOutSec * 2) {
        // Fade-out st is adjusted for the pre-seek window so it lands at the
        // correct moment after the output-side -ss rangeRelativeStart seek.
        const wfFadeOutStart = Math.max(0, effectiveDuration + rangeRelativeStart - fadeAudioOutSec);
        wfAudioParts.push(`afade=t=out:st=${wfFadeOutStart.toFixed(3)}:d=${fadeAudioOutSec.toFixed(3)}`);
      }

      // asplit → [audiofmap] (output branch) + [audiowave] (showwaves)
      filterParts.push(`[${audioInputIdx}:a]asplit=2[audiofmap][audiowave]`);
      if (wfAudioParts.length > 0) {
        filterParts.push(`[audiofmap]${wfAudioParts.join(",")}[audioout_fc]`);
        audioOutputFcLabel = "audioout_fc";
      } else {
        audioOutputFcLabel = "audiofmap";
      }

      filterParts.push(
        `[audiowave]showwaves=s=${TARGET_W}x${waveH}:mode=line:rate=${TARGET_FPS}:colors=white[waveraw]`,
      );
      filterParts.push(
        `[waveraw]colorkey=color=0x000000:similarity=0.15:blend=0.0,format=rgba,colorchannelmixer=aa=${waveOpacity}[wavefinal]`,
      );
      filterParts.push(
        `[${workLabel}][wavefinal]overlay=0:${wavePosY}:format=auto[vwaved]`,
      );
      workLabel = "vwaved";
      ctx.log.info({ waveOpacity, waveH, wavePosY, audioOutputFcLabel }, "[export] animated waveform overlay injected");
    }

    // ── Watermark overlay — applied LAST so it is the topmost visual layer.
    // Nothing is composited on top of it after this point. ──
    if (wmInputIdx >= 0 && activeWmPath) {
      const bwm = useBrandingWm ? branding!.watermark : null;
      // Size as a % of TARGET_W so the logo occupies a consistent relative footprint
      // across all export aspect ratios/resolutions.
      const wmSizeMap: Record<string, number> = { small: 0.10, medium: 0.15, large: 0.20 };
      const wmW = bwm
        ? Math.round(TARGET_W * (wmSizeMap[bwm.size] ?? 0.15))
        : Math.round(TARGET_W * (wmSizeMap[watermarkSize] ?? 0.15));
      // If "Logo / Watermark" is in overlayEffects with an explicit intensity, use that
      // alpha so the burned watermark matches the editor overlay panel at that opacity.
      const wmOverlayIntensityVal = overlayIntensityMap["Logo / Watermark"] ?? overlayIntensityMap["Watermark"];
      const wmAlpha = wmOverlayIntensityVal != null
        ? (wmOverlayIntensityVal / 100).toFixed(2)
        : bwm
        ? ({ low: "0.30", medium: "0.60", high: "0.90" }[bwm.opacity] ?? "0.60")
        : "0.90";
      // Legacy margin is stored as px at a 1000px-reference shorter dimension (same
      // reference the preview's WatermarkEffect uses), converted to a %-of-resolution
      // fraction; branding watermark keeps its existing fixed 2.2% margin.
      const wmPos = bwm
        ? buildWmPos(bwm.position, TARGET_W, TARGET_H)
        : buildWmPos(watermarkPosition, TARGET_W, TARGET_H, watermarkMargin / 1000);
      filterParts.push(`[${wmInputIdx}:v]scale=${wmW}:-2,format=rgba,colorchannelmixer=aa=${wmAlpha}[wm]`);
      filterParts.push(`[${workLabel}][wm]overlay=${wmPos}:format=auto[vwmed]`);
      workLabel = "vwmed";
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
      ctx.log.info({ voutLabel, escapedPath }, "[export] ASS subtitle filter injected");
    }

    const filterComplex = filterParts.join(";");

    /* ── 4: Build audio filter chain ── */
    const audioFilterParts: string[] = [];
    if (audioPath) {
      if (loopAudio) {
        audioFilterParts.push(`aloop=loop=-1:size=2147483647`);
        audioFilterParts.push(`atrim=duration=${effectiveDuration.toFixed(3)}`);
        audioFilterParts.push(`asetpts=PTS-STARTPTS`);
      } else if (matchVideoLength) {
        // "Match video length" (studio default): trim the audio so it never plays
        // past the video. No looping — a shorter track simply ends and the rest is silent.
        audioFilterParts.push(`atrim=duration=${effectiveDuration.toFixed(3)}`);
        audioFilterParts.push(`asetpts=PTS-STARTPTS`);
      }
      if (fadeAudioInSec > 0) {
        audioFilterParts.push(`afade=t=in:st=0:d=${fadeAudioInSec.toFixed(3)}`);
      }
      if (fadeAudioOutSec > 0 && effectiveDuration > fadeAudioOutSec * 2) {
        const fadeOutStart = Math.max(0, effectiveDuration - fadeAudioOutSec);
        audioFilterParts.push(`afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeAudioOutSec.toFixed(3)}`);
      }
    }

    /* ── 5: Build FFmpeg args ── */
    // Input ordering: intro? → normalizedClips → outro? → audio? → watermark?
    const outputPath = path.join(tmpDir, `bdv-export-${exportId}.mp4`);
    tmpFiles.push(outputPath);

    const ffmpegArgs: string[] = [];
    // Bound FFmpeg's thread count: 7 simultaneous 1080x1920 inputs + xfade
    // filter graph OOMs small instances at the default thread count.
    ffmpegArgs.push("-threads", "2");

    // Intro lavfi color source (already at target size + fps)
    if (introInputIdx >= 0) {
      const bgColor = CARD_BG_HEX[branding!.introCard!.stylePreset] ?? "0x0a0a0a";
      ffmpegArgs.push("-f", "lavfi", "-i", `color=c=${bgColor}:s=${TARGET_W}x${TARGET_H}:d=${introDuration}:r=${TARGET_FPS}`);
    }
    // Leading-gap black lavfi source (freeform layout only, before the first clip)
    if (leadGapInputIdx >= 0) {
      ffmpegArgs.push("-f", "lavfi", "-i", `color=c=0x000000:s=${TARGET_W}x${TARGET_H}:d=${leadingGapSec.toFixed(3)}:r=${TARGET_FPS}`);
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
    // Audio (seek into the track first so it starts at the studio offset).
    // The output-side `-ss rangeRelativeStart` (below) handles aligning the
    // audio with the range-trimmed video — it applies to ALL output streams
    // simultaneously, including directly-mapped and filter_complex-mapped audio.
    // Do NOT add effectiveStart here; that would double-seek the audio.
    if (audioPath) {
      const audioSeekSec = audioStartSec ?? 0;
      if (audioSeekSec > 0) {
        ffmpegArgs.push("-ss", audioSeekSec.toFixed(3));
      }
      ffmpegArgs.push("-i", audioPath);
    }
    // Watermark still image (looped)
    if (wmInputIdx >= 0 && activeWmPath) {
      ffmpegArgs.push("-loop", "1", "-i", activeWmPath);
    }
    // Structured overlay images (e.g. a user-uploaded logo placed via the overlay editor)
    for (let i = 0; i < overlayImagePaths.length; i++) {
      const imgPath = overlayImagePaths[i];
      if (imgPath) ffmpegArgs.push("-loop", "1", "-i", imgPath);
    }

    ffmpegArgs.push("-filter_complex", filterComplex);
    ffmpegArgs.push("-map", `[${voutLabel}]`);

    if (audioPath && audioInputIdx >= 0) {
      // When Animated Waveform is active the audio was split inside filter_complex;
      // map the filter_complex output label instead of the raw input stream.
      ffmpegArgs.push("-map", audioOutputFcLabel ? `[${audioOutputFcLabel}]` : `${audioInputIdx}:a`);
    }

    ffmpegArgs.push(
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-crf", "22",
      "-pix_fmt", "yuv420p",
    );

    if (audioPath) {
      // When waveform is active, audio is mapped from filter_complex ([audiofmap]/
      // [audioout_fc]). FFmpeg forbids combining -af (simple filter) with a stream
      // that already comes from a complex filtergraph — the filters were already
      // inlined in filter_complex above. Only apply -af for the non-waveform path.
      if (!audioOutputFcLabel && audioFilterParts.length > 0) {
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
      ctx.log.info({
        filterComplex,
        audioFilter: audioFilterParts.join(",") || "(none)",
        ffmpegCommand: `ffmpeg ${ffmpegArgs.map(a => a.includes(" ") ? `"${a}"` : a).join(" ")}`,
        selectedClips: selectedClipOrigIndices.map(i => `scene-${i+1}`),
        rangeRelativeStart: rangeRelativeStart.toFixed(3),
        effectiveDuration: effectiveDuration.toFixed(3),
      }, "[export][debug] FFmpeg command");
    }

    /* ── 5.5: Final pre-spawn existence check ──────────────────────────
     * Every concrete file FFmpeg is about to open, re-verified right
     * before spawning. Prepared/normalized files can theoretically vanish
     * between earlier checks and this point (e.g. an unexpected disk
     * cleanup); catching it here gives a specific, actionable error
     * instead of a raw FFmpeg exit-254 stderr dump.
     */
    const preSpawnInputs: { label: string; path: string }[] = [
      ...normalizedPaths.map((p, i) => ({
        label: `Scene ${selectedClipOrigIndices[i]! + 1} normalized clip`,
        path: p,
      })),
      ...(audioPath ? [{ label: "Audio track", path: audioPath }] : []),
      ...(wmInputIdx >= 0 && activeWmPath ? [{ label: "Watermark image", path: activeWmPath }] : []),
      ...overlayImagePaths
        .map((p, i) => (p ? { label: `Overlay image #${i + 1}`, path: p } : null))
        .filter((x): x is { label: string; path: string } => x !== null),
      ...(captionsAssPath ? [{ label: "Caption/subtitle file", path: captionsAssPath }] : []),
    ];
    const missingInputs = preSpawnInputs.filter((f) => !existsSync(f.path));
    if (missingInputs.length > 0) {
      const detail = missingInputs.map((f) => `${f.label} (${f.path})`).join("; ");
      ctx.log.error({ missingInputs }, "[export] pre-spawn check found missing input(s) — aborting before FFmpeg");
      throw new Error(
        `Export blocked — ${missingInputs.length} input file${missingInputs.length !== 1 ? "s" : ""} ` +
        `disappeared right before rendering: ${detail}. This usually means the prepared session was ` +
        `cleaned up mid-export (e.g. by a duplicate export click). Click "Prepare Export Files Only" again, then export once.`,
      );
    }
    ctx.log.info({ inputCount: preSpawnInputs.length }, "[export] pre-spawn check passed — all inputs present");

    /* ── 6: Run FFmpeg in two passes (memory) ─────────────────────────
     * Render's 512MB instance OOM-killed the service during the old single
     * pass, which decoded + filtered + libx264-encoded 1080x1920 video AND
     * decoded/filtered/AAC-encoded the audio in one FFmpeg process. Split:
     *   Pass A (video only): stitched video → subtitles/watermark/effects/
     *     overlays → CRF 18 intermediate. No audio processing at all.
     *   Pass B (audio + mux): Pass-A intermediate + audio → -af audio chain,
     *     AAC encode, video stream-COPIED → final MP4. No x264, no decode.
     * Peak RSS becomes max(pass A, pass B) instead of both pipelines at once.
     * Pass A reuses the single-pass inputs + filter_complex verbatim (the
     * audio input stays present-but-unmapped, so filter_complex input indices
     * never shift). The range trim (-ss/-t) is applied in pass A exactly as
     * the single pass did; pass B bakes the identical audio window [R, D]
     * into -af via atrim=start (an output -ss in pass B would re-trim the
     * already-trimmed video). Exception: Animated Waveform's showwaves video
     * filter consumes the audio stream, so audio stays inside pass A for that
     * path and pass B is a pure remux. Each pass eagerly deletes its consumed
     * intermediate on success. */
    exportStatus.ffmpegStage = "combining";
    const isWaveformPath = !!audioOutputFcLabel;
    const passAPath = path.join(tmpDir, `bdv-export-${exportId}-passA.mp4`);
    tmpFiles.push(passAPath);

    // Shared per-pass failure diagnostics (mirrors the old single-pass behavior).
    const failPass = (
      passLabel: string,
      ffErr: unknown,
      passArgs: string[],
      checkInputs: { label: string; path: string }[],
    ): never => {
      const stderr = (ffErr as { stderr?: string }).stderr ?? "";
      const exitCode = (ffErr as { code?: number }).code ?? -1;
      const killed = (ffErr as { killed?: boolean }).killed ?? false;
      const signal = (ffErr as { signal?: string }).signal ?? null;
      exportStatus.ffmpegExitCode = exitCode;
      const stderrLines = stderr.split("\n").filter(Boolean);
      const stderrTail = stderrLines.slice(-20);
      exportStatus.stderrTail = stderrTail;

      ctx.log.error({
        pass: passLabel,
        exitCode,
        killed,
        signal,
        stderrTail: stderrTail.join("\n"),
        command: `ffmpeg ${passArgs.slice(0, 6).join(" ")} ...`,
      }, `[export] FFmpeg ${passLabel} failed`);

      // Find the most specific error line in stderr
      const errorLine = stderrLines
        .filter(l => l.includes("Error") || l.includes("error") || l.includes("Invalid") || l.includes("No such") || l.includes("failed"))
        .pop() ?? stderrTail.at(-1) ?? "";

      const baseMsg = ffErr instanceof Error ? ffErr.message : String(ffErr);

      // "No such file or directory" from FFmpeg means one of our own input
      // paths was bad or vanished — despite the pre-spawn check just above.
      // Name the exact missing file(s) here too, since a TOCTOU gap (file
      // deleted in the few ms between our check and FFmpeg's open()) is
      // still theoretically possible.
      const looksLikeMissingFile = /No such file or directory/i.test(errorLine || baseMsg);
      if (looksLikeMissingFile) {
        const stillMissing = checkInputs.filter((f) => !existsSync(f.path));
        const missingDetail = stillMissing.length > 0
          ? stillMissing.map((f) => `${f.label} (${f.path})`).join("; ")
          : "an input file that was present moments earlier but is now gone";
        throw Object.assign(
          new Error(
            `FFmpeg ${passLabel} couldn't find one of its input files: ${missingDetail}. This usually means the prepared ` +
            `session was cleaned up while this export was still running. Click "Prepare Export Files Only" again, then export once (avoid double-clicking Export).`,
          ),
          { ffmpegExitCode: exitCode, ffmpegStderr: stderr, stderrTail },
        );
      }

      throw Object.assign(new Error(`FFmpeg ${passLabel} failed (exit ${exitCode}): ${errorLine || baseMsg.slice(0, 200)}`), {
        ffmpegExitCode: exitCode,
        ffmpegStderr: stderr,
        stderrTail,
      });
    };

    const runPass = async (
      passLabel: string,
      passArgs: string[],
      checkInputs: { label: string; path: string }[],
      timeoutMs: number = FFMPEG_TIMEOUT_MS,
    ): Promise<void> => {
      try {
        const result = await execFileAsync("ffmpeg", passArgs, { timeout: timeoutMs });
        exportStatus.ffmpegExitCode = 0;
        if (IS_DEV && result.stderr) {
          ctx.log.info({ pass: passLabel, stderrTail: result.stderr.split("\n").slice(-10).join("\n") }, "[export] FFmpeg stderr tail");
        }
      } catch (ffErr: unknown) {
        failPass(passLabel, ffErr, passArgs, checkInputs);
      }
    };

    const eagerUnlink = (p: string, why: string): void => {
      try { unlinkSync(p); } catch { /* best-effort */ }
      const ti = tmpFiles.indexOf(p);
      if (ti >= 0) tmpFiles.splice(ti, 1);
      ctx.log.info({ file: path.basename(p) }, `[export] ${why} — intermediate released eagerly`);
    };

    /* ── Pass A: video-only encode ── */
    const fcIdx = ffmpegArgs.indexOf("-filter_complex");
    const passABase = ffmpegArgs.slice(0, fcIdx + 2);
    // Single-thread the big 1080x1920 Pass-A encode: x264's frame buffers scale
    // with thread count, and we are fighting for every MB on a 512MB instance.
    // (Output is bit-identical in quality settings; just slower.)
    const tIdx = passABase.indexOf("-threads");
    if (tIdx >= 0 && tIdx + 1 < passABase.length) passABase[tIdx + 1] = "1";
    const passAArgs: string[] = [
      ...passABase, // inputs + "-filter_complex" + graph (indices preserved)
      "-map", `[${voutLabel}]`,
      ...(isWaveformPath ? ["-map", `[${audioOutputFcLabel}]`] : []),
      "-c:v", "libx264",
      // OUTPUT-position -threads: this is what actually bounds the ENCODER.
      // (The "-threads 1" patched into passABase above sits before -i, so it
      // only throttles the decoder — libx264 was still spawning 1.5x host
      // cores and OOM-killing the 512MB instance within a minute of pass A.)
      "-threads", "1",
      "-preset", "ultrafast",
      "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-video_track_timescale", "90000",
      ...(isWaveformPath
        ? ["-c:a", "aac", "-b:a", "192k"] // waveform audio already filtered inside filter_complex
        : ["-an"]),
      ...(rangeRelativeStart > 0 ? ["-ss", rangeRelativeStart.toFixed(3)] : []),
      "-t", effectiveDuration.toFixed(3),
      "-y", passAPath,
    ];
    ctx.log.info(
      { crf: 18, waveform: isWaveformPath, rangeStart: rangeRelativeStart.toFixed(3), duration: effectiveDuration.toFixed(3) },
      "[export] pass A (video) starting",
    );
    // Pass A is single-threaded 1080x1920 x264: on a throttled instance it can
    // run at ~0.05-0.1x realtime, so scale the timeout like the phase-1 steps
    // (10x media duration, 10-min floor) instead of the fixed 8 minutes —
    // otherwise our own timeout SIGTERM-kills a healthy encode near the end.
    const passATimeoutMs = Math.max(10 * 60 * 1000, effectiveDuration * 10 * 1000);
    await runPass("pass A (video)", passAArgs, preSpawnInputs, passATimeoutMs);
    if (!existsSync(passAPath)) throw new Error("FFmpeg pass A produced no output file");
    // Pass A consumed the phase-1 stitched intermediate — release it eagerly.
    for (const p of normalizedPaths) eagerUnlink(p, "pass A done");

    /* ── Pass B: audio + mux (video stream-copied — no decode, no x264) ── */
    const passBArgs: string[] = ["-threads", "2", "-i", passAPath];
    let passBAudioFilters: string[] | null = null;
    if (!isWaveformPath && audioPath) {
      if ((audioStartSec ?? 0) > 0) passBArgs.push("-ss", audioStartSec!.toFixed(3));
      passBArgs.push("-i", audioPath);
      // Reproduce the single-pass audio window exactly: the old pipeline ran
      // `-af <audioFilterParts>` + output `-ss R -t D`. The video is already
      // range-trimmed, so bake the same [R, D] window into -af via atrim=start
      // instead of an output -ss (which would trim the video a second time).
      const rangeAtrim = `atrim=start=${rangeRelativeStart.toFixed(3)}:duration=${Math.max(0, effectiveDuration - rangeRelativeStart).toFixed(3)}`;
      passBAudioFilters = [];
      let swapped = false;
      for (let k = 0; k < audioFilterParts.length; k++) {
        const part = audioFilterParts[k]!;
        if (!swapped && part.startsWith("atrim=")) {
          passBAudioFilters.push(rangeAtrim, "asetpts=PTS-STARTPTS");
          if (audioFilterParts[k + 1] === "asetpts=PTS-STARTPTS") k++;
          swapped = true;
        } else {
          passBAudioFilters.push(part);
        }
      }
      if (!swapped) passBAudioFilters.unshift(rangeAtrim, "asetpts=PTS-STARTPTS");
    }
    passBArgs.push("-map", "0:v");
    if (isWaveformPath) {
      passBArgs.push("-map", "0:a", "-c:v", "copy", "-c:a", "copy");
    } else if (audioPath) {
      passBArgs.push("-map", "1:a", "-af", passBAudioFilters!.join(","), "-c:v", "copy", "-c:a", "aac", "-b:a", "192k");
    } else {
      passBArgs.push("-c:v", "copy", "-an");
    }
    passBArgs.push("-movflags", "+faststart", "-y", outputPath);
    ctx.log.info(
      { waveform: isWaveformPath, hasAudio: !!audioPath, af: passBAudioFilters?.join(",") ?? "(none)" },
      "[export] pass B (audio+mux) starting",
    );
    await runPass(
      "pass B (audio+mux)",
      passBArgs,
      [
        { label: "Pass A video intermediate", path: passAPath },
        ...(!isWaveformPath && audioPath ? [{ label: "Audio track", path: audioPath }] : []),
      ],
    );
    // Pass B consumed the pass-A intermediate — release it eagerly.
    eagerUnlink(passAPath, "pass B done");
    /* ── end two-pass FFmpeg ── */

    /* ── 7: Verify output ── */
    if (!existsSync(outputPath)) throw new Error("FFmpeg produced no output file");

    const outSize = statSync(outputPath).size;
    if (IS_DEV) {
      ctx.log.info({ finalVideoBytes: outSize, finalVideoMB: (outSize / 1024 / 1024).toFixed(2) }, "[export][debug] output size");
    }

    if (outSize < 1024) {
      throw new Error(`Output file too small (${outSize} bytes) — FFmpeg may have failed silently`);
    }

    const outInfo = await probeVideo(outputPath);
    ctx.log.info({
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

    /* ── 8: Upload final MP4 to Supabase Storage (private video-exports bucket) ── */
    await ensureVideoExportsBucket().catch(() => {});
    

    const objectName = `exports/${exportId}.mp4`;
    // Stream the upload — readFileSync on a multi-hundred-MB final MP4 OOMs
    // small instances. The file stays on disk; only small chunks are in RAM.
    const storageRef = await uploadFileStreamToSupabaseStorage(VIDEO_EXPORTS_BUCKET, objectName, outputPath, "video/mp4");
    const { data: signData, error: signErr } = await getSupabaseAdmin().storage.from(VIDEO_EXPORTS_BUCKET).createSignedUrl(objectName, SUPABASE_SIGNED_URL_TTL_SEC);
    if (signErr || !signData?.signedUrl) throw new Error(`Supabase signed URL failed: ${signErr?.message ?? "no URL returned"}`);
    ctx.log.info({ objectName, storageRef }, "[export] uploaded to Supabase storage");

    /* ── 9: Sign URL (fresh signed URL for the response; stable ref persisted) ── */
    const signedUrl = signData.signedUrl;
    const objectPath = `/objects/exports/${exportId}.mp4`;

    /* ── 10: Save to project ── */
    if (!testMode) {
      const { data: fullProject, error: selectErr } = await ctx.userSupabase!
        .from("projects")
        .select("id, user_id, project_type, title, artist_name, song_title, genre, mood, style, platform, input_data, output_data, credits_used, created_at")
        .eq("id", projectId)
        .eq("user_id", ctx.userId)
        .single();

      if (selectErr || !fullProject) {
        ctx.log.warn({ err: selectErr?.message }, "[export] project not found for save");
      } else {
        const current = (fullProject.output_data as Record<string, unknown>) ?? {};
        const updatedOutputData = {
          ...current,
          final_video_url: storageRef,
          export_object_path: objectPath,
          export_status: "completed",
          export_created_at: new Date().toISOString(),
          timeline_order: timelineOrder ?? null,
          clips_used: clipUrls.length,
          audio_used: !!audioPath,
          audio_source: audioSource,
          aspect_ratio: aspectRatio,
        };

        /* Update output_data in place. Previously this did a delete-then-insert, which could
         * permanently lose the project if the insert failed (or if it raced with another save)
         * between the delete and the re-insert — a plain UPDATE is atomic and can never drop
         * the row.
         *
         * NOTE: the projects table's RLS UPDATE policy is broken/missing (updates via the
         * user-scoped client silently no-op with 0 rows affected, no error). Ownership was
         * already verified above via the RLS-protected SELECT, so it's safe to use the
         * service-role client here — we still scope by both id and user_id explicitly. */
        const { error: updErr } = await getSupabaseAdmin()
          .from("projects")
          .update({ output_data: updatedOutputData })
          .eq("id", projectId)
          .eq("user_id", ctx.userId);

        if (updErr) {
          ctx.log.warn({ err: updErr.message }, "[export] update error during save");
        } else {
          ctx.log.info({ projectId, clips: clipUrls.length, audioSource }, "[export] project saved ok");
        }
      }
    }

    /* ── Credits are deducted by runExportJobInBackground after executeExport
     * resolves, via chargeCreditsForJob — a single transaction that flips
     * the job's credits_charged flag and drops the balance atomically, so a
     * crash or recovery can never double-charge. ── */

    exportStatus.ffmpegStage = "completed";

    return {
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
          watermark: effectiveAddWatermark,
        } : {}),
      },
    };

  } catch (err: unknown) {
    const msg         = err instanceof Error ? err.message : "Export failed";
    const exitCode    = (err as { ffmpegExitCode?: number }).ffmpegExitCode ?? null;
    const stderrTail  = (err as { stderrTail?: string[] }).stderrTail ?? [];
    const fullStderr  = (err as { ffmpegStderr?: string }).ffmpegStderr ?? "";

    exportStatus.ffmpegStage    = "failed";
    if (exitCode !== null) exportStatus.ffmpegExitCode = exitCode;
    if (stderrTail.length)  exportStatus.stderrTail    = stderrTail;

    ctx.log.error({ err: msg, exitCode, stderrLines: stderrTail.length }, "[export] failed");
    throw {
      status: 500,
      message: msg,
      exportStatus,
      ...(IS_DEV && fullStderr ? {
        ffmpegStderr:  fullStderr.slice(-3000),
        stderrTail,
        ffmpegExitCode: exitCode,
      } : {}),
    };
  } finally {
    cleanup(...tmpFiles);
    // Release the in-flight guard first — if another concurrent request for
    // the same prepareId is still running, this keeps its files alive; the
    // last request to release performs the actual directory removal.
    if (preparedExportAcquired && prepareId) {
      releasePreparedExport(prepareId);
    }
    // Clean up pre-downloaded prepare files (the whole export dir) after FFmpeg is done.
    if (prepareId) {
      deletePreparedExport(prepareId);
    }
  }
}

/** Normalize any render failure into the job-error shape the client understands. */
function normalizeJobError(err: unknown): ExportJobError {
  if (err && typeof err === "object" && "status" in err) {
    const e = err as {
      status?: number; message?: string; error?: string; code?: string;
      exportStatus?: unknown; stderrTail?: string[]; ffmpegExitCode?: number | null;
    };
    return {
      message: e.message ?? e.error ?? "Export failed",
      code: e.code,
      exportStatus: e.exportStatus,
      stderrTail: e.stderrTail,
      ffmpegExitCode: e.ffmpegExitCode ?? null,
    };
  }
  return { message: err instanceof Error ? err.message : "Export failed" };
}

/** Run one export job in the background, mirroring render stages onto the job. */
async function runExportJobInBackground(jobId: string, ctx: ExportJobContext): Promise<void> {
  // Claim the durable job row first: on a restart this same jobId may be
  // re-queued by boot recovery, and the claim (attempts + 1) is what keeps
  // a poison job from looping forever.
  const claimed = await claimJobForRun(jobId).catch((err) => {
    ctx.log.error({ err, jobId }, "[export] failed to claim job row");
    return undefined;
  });
  if (!claimed) {
    ctx.log.warn({ jobId }, "[export] job not claimable (missing or already terminal); skipping run");
    return;
  }
  // Mirror the live FFmpeg stage into the durable row (≤ ~2s stale for pollers).
  let lastStage = "starting";
  const ticker = setInterval(() => {
    const s = ctx.statusRef.current?.ffmpegStage;
    if (s && s.length > 0 && s !== lastStage) {
      lastStage = s;
      updateJobStage(jobId, s).catch((err) =>
        ctx.log.warn({ err, jobId }, "[export] stage persist failed"),
      );
    }
  }, 2000);
  if (typeof (ticker as unknown as { unref?: unknown }).unref === "function") {
    (ticker as unknown as { unref: () => void }).unref();
  }
  try {
    const result = await executeExport(ctx);

    /* ── Deduct credits + record usage on export success ── */
    if (!IS_DEV) {
      try {
        const { charged, creditsAfter } = await chargeCreditsForJob(jobId, ctx.userId, EXPORT_CREDIT_COST);
        if (charged) {
          recordCreditUsage({ userId: ctx.userId, action: "Final Video Export", creditsUsed: EXPORT_CREDIT_COST, projectId: ctx.body.projectId ?? null }).catch(() => {});
          ctx.log.info({ userId: ctx.userId, creditsAfter }, "[export] credits deducted");
        } else {
          ctx.log.warn({ jobId }, "[export] credits already charged for job; skipping duplicate deduction");
        }
      } catch (deductErr) {
        if (deductErr instanceof OutOfCreditsError) {
          await failJob(jobId, {
            message: "Not enough credits. Please buy more credits to continue.",
            code: "out_of_credits",
          });
          return;
        }
        throw deductErr;
      }
    }

    await completeJob(jobId, result);
  } catch (err) {
    ctx.log.error({ err: err instanceof Error ? err.message : err, jobId }, "[export] background job failed");
    await failJob(jobId, normalizeJobError(err)).catch((persistErr) =>
      ctx.log.error({ persistErr, jobId }, "[export] failed to persist job failure"),
    );
  } finally {
    clearInterval(ticker);
  }
}

router.post("/export-final-video", requireAuth, async (req, res) => {
  const body = req.body as ExportRequestBody;
  const { projectId, clipUrls, exportRangeStart, exportRangeEnd } = body;


  if (!projectId?.trim()) {
    res.status(400).json({ error: "projectId is required" });
    return;
  }
  if (!Array.isArray(clipUrls) || clipUrls.length === 0) {
    res.status(400).json({ error: "clipUrls must be a non-empty array" });
    return;
  }

  /* ── Custom export range validation ──
   * A range is only meaningful when BOTH start/end are provided as finite numbers.
   * Reject invalid or near-zero-duration ranges here (e.g. a "custom" range left at
   * 00:00.000/00:00.000) instead of letting FFmpeg fail deep in the pipeline with a
   * cryptic exit code (234). Mirrors the client-side guard in FinalVideoExport.tsx. */
  const MIN_EXPORT_RANGE_DURATION_SEC = 0.25;
  if ((exportRangeStart !== null && exportRangeStart !== undefined) || (exportRangeEnd !== null && exportRangeEnd !== undefined)) {
    const startNum = typeof exportRangeStart === "number" ? exportRangeStart : NaN;
    const endNum   = typeof exportRangeEnd   === "number" ? exportRangeEnd   : NaN;
    const rangeIsUsable =
      Number.isFinite(startNum) &&
      Number.isFinite(endNum) &&
      startNum >= 0 &&
      endNum - startNum >= MIN_EXPORT_RANGE_DURATION_SEC;
    if (!rangeIsUsable) {
      res.status(400).json({
        error: `Invalid export range: start=${exportRangeStart ?? "null"}, end=${exportRangeEnd ?? "null"}. ` +
          `The range must have a valid start (>= 0) and an end at least ${MIN_EXPORT_RANGE_DURATION_SEC}s after the start.`,
        code: "INVALID_EXPORT_RANGE",
      });
      return;
    }
  }

  /* ── Credit check (5 credits for final export) ── */
  const currentCredits = req.userCredits ?? 0;
  if (!IS_DEV && currentCredits < EXPORT_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough credits. Please buy more credits to continue.",
    });
    return;
  }

  if (!req.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  /* ── Async export job ──
   * The full render (download + normalize + FFmpeg + upload) takes minutes —
   * far longer than a hosting proxy keeps an HTTP request open (the old
   * synchronous design died with a 502 on real exports). The job is recorded
   * in the export_jobs table and the render runs in the background, so a
   * server restart can no longer lose it: boot recovery re-queues
   * interrupted jobs and the client keeps polling the same jobId.
   * Credits are deducted only when the render actually succeeds
   * (chargeCreditsForJob, exactly once). */
  const job = await createExportJob(req.userId, projectId.trim(), body);
  res.status(202).json({ jobId: job.id, status: job.state });

  const ctx: ExportJobContext = {
    body,
    userId: req.userId,
    userPlan: req.userPlan,
    userSupabase: req.userSupabase,
    log: req.log ?? logger,
    statusRef: { current: null },
  };
  enqueueExport(() => runExportJobInBackground(job.id, ctx));
});

router.get("/export-video-job/:jobId", requireAuth, async (req, res) => {
  const rawId = req.params.jobId;
  const jobId = Array.isArray(rawId) ? (rawId[0] ?? "") : (rawId ?? "");
  const job = await getExportJob(jobId).catch(() => undefined);
  if (!job || job.userId !== req.userId) {
    res.status(404).json({ error: "Export job not found" });
    return;
  }
  const { stage, progress } = describeJobProgress(job);
  res.json({
    jobId: job.id,
    status: job.state,
    stage,
    progress,
    ...(job.state === "done" ? { result: job.result } : {}),
    ...(job.state === "failed" ? { error: job.error } : {}),
  });
});

/**
 * Boot recovery: re-queue export jobs orphaned by a previous process.
 * Called once from index.ts after the server starts listening. Each
 * recovered job re-runs from scratch with its persisted request params;
 * a fresh statusRef is used because the old process's live render state
 * died with it. The service-role client stands in for the user's scoped
 * client — ownership was verified when the job was created.
 */
export async function recoverInterruptedExportJobs(): Promise<void> {
  await recoverInterruptedJobs(async (job) => {
    const admin = getSupabaseAdmin();
    let plan = "free";
    try {
      const { data: profile } = await admin
        .from("profiles")
        .select("plan")
        .eq("id", job.userId)
        .single();
      if (profile?.plan) plan = profile.plan;
    } catch {
      /* keep "free" — watermark gating fails closed */
    }
    const ctx: ExportJobContext = {
      body: (job.params ?? {}) as ExportRequestBody,
      userId: job.userId,
      userPlan: plan,
      userSupabase: admin,
      log: logger,
      statusRef: { current: null },
    };
    enqueueExport(() => runExportJobInBackground(job.id, ctx));
  });
}

export default router;
