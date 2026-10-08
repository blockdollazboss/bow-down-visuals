import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { recordCanvasHistory } from "../../lib/payment-record";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";
import {
  attributionOptIn,
  resolveAttributionFont,
  attributionDrawtext,
} from "../../lib/attribution";

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── Spotify Canvas generator ────────────────────────────────────────────
   DistroKid Canvas parity: an 8-second seamless-looping vertical visual for
   Spotify tracks, rendered locally with ffmpeg from cover art (+ optional
   song audio used as an amplitude source for the pulse style).

   Spec source: Spotify for Artists Canvas guidelines (verified 2026-10-07;
   see ftsmusic.com "Spotify Canvas vs Clips" + magicshot.ai Canvas guide):
     • 3–8 seconds, loops automatically          → we render exactly 8s
     • 9:16 vertical, height 720–1080px          → 720x1280
     • MP4 video                                 → libx264 MP4
     • NO audio — Canvas is silent               → output is video-only (-an);
       the song audio is only an input for the visualizer amplitude.
   All motion is periodic with a period that divides 8s, so the loop is
   seamless (a "Continuous Loop" per Spotify's recommendation). */

const CANVAS_COST = Number(process.env["CANVAS_CREDITS"]) || 150;
const CANVAS_W = 720;
const CANVAS_H = 1280;
const CANVAS_FPS = 30;
const CANVAS_SECONDS = 8;
const CANVAS_TOTAL_FRAMES = CANVAS_SECONDS * CANVAS_FPS; // 240
const FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";

/* ─── Loop styles ───────────────────────────────────────────────────────── */
export const CANVAS_STYLES = {
  zoom: {
    label: "Slow Zoom",
    blurb: "Cinematic push-in on your cover art, perfectly looping",
  },
  pulse: {
    label: "Beat Pulse",
    blurb: "Cover art breathes to your song's energy (audio optional)",
  },
  particles: {
    label: "Gold Dust",
    blurb: "Shimmering gold particles drift over your artwork",
  },
  lyricFlicker: {
    label: "Lyric Flicker",
    blurb: "Your lyric line flickers like a neon sign over the art",
  },
} as const;

export type CanvasStyleKey = keyof typeof CANVAS_STYLES;

const canvasStyleSchema = z
  .string()
  .refine((v): v is CanvasStyleKey => v in CANVAS_STYLES, {
    message: `style must be one of: ${Object.keys(CANVAS_STYLES).join(", ")}`,
  });

const canvasSchema = z.object({
  coverUrl: z.string().trim().min(1).max(2048),
  audioUrl: z.string().trim().min(1).max(2048).optional(),
  style: canvasStyleSchema.optional().default("zoom"),
  /* Lyric line for the lyricFlicker style (required there, ignored otherwise). */
  overlayText: z.string().trim().max(60).optional(),
  songTitle: z.string().trim().max(120).optional(),
  artistName: z.string().trim().max(120).optional(),
  /** Virality: opt-in "Made with Bow Down Visuals" tag burned into the base still (paid export → opt-in). */
  attribution: attributionOptIn(),
});

/** Escape user text for ffmpeg drawtext. (Same convention as text-animator.) */
function escapeDrawtext(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "%%");
}

function autoFontSize(text: string): number {
  const size = Math.floor(2600 / Math.max(text.length, 8));
  return Math.min(96, Math.max(40, size));
}

/* ─── Pass 1: compose the 720x1280 base still ──────────────────────────────
   Blurred full-bleed background from the cover + the cover art fitted
   (contained) and centered. Handles square covers, 9:16 art, anything.
   Pass `attributionFontfile` to burn the gold "Made with Bow Down Visuals"
   tag into the still — it then rides through every loop style (virality). */
export function buildCanvasBaseFilter(attributionFontfile?: string | null): string {
  const base =
    `[0:v]scale=${CANVAS_W}:${CANVAS_H}:force_original_aspect_ratio=increase,` +
    `crop=${CANVAS_W}:${CANVAS_H},boxblur=20:1[bg];` +
    `[0:v]scale=w='if(gt(a,${CANVAS_W}/${CANVAS_H}),${CANVAS_W},-2)':` +
    `h='if(gt(a,${CANVAS_W}/${CANVAS_H}),-2,${CANVAS_H})'[art];` +
    `[bg][art]overlay=(W-w)/2:(H-h)/2,format=yuv420p`;
  const tag = attributionFontfile
    ? `,${attributionDrawtext(attributionFontfile, CANVAS_W)}`
    : "";
  return `${base}${tag}[canvas]`;
}

/* ─── Pass 2: seamless 8s animation per style ─────────────────────────────
   Every motion term is sin(2π·k·n/240) — a period dividing 240 frames — so
   frame 240 would equal frame 0: a perfect loop ("Continuous Loop").
   NOTE: drawcircle is NOT compiled into this ffmpeg build — particle
   effects must use other filters (the life source works). */

/** Slow cinematic zoom: one full in-and-out breath across the 8s loop. */
export function zoomFilter(): string {
  const n = CANVAS_TOTAL_FRAMES;
  return (
    `zoompan=z='1+0.075*sin(2*PI*on/${n})':` +
    `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
    `d=${n}:s=${CANVAS_W}x${CANVAS_H}:fps=${CANVAS_FPS}`
  );
}

/** Beat pulse: 4 periodic pulses per loop, amplitude from the song's energy. */
export function pulseFilter(amplitude: number): string {
  const n = CANVAS_TOTAL_FRAMES;
  const amp = Math.min(0.14, Math.max(0.04, amplitude)).toFixed(4);
  return (
    `zoompan=z='1+${amp}*sin(2*PI*on/60)':` +
    `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
    `d=${n}:s=${CANVAS_W}x${CANVAS_H}:fps=${CANVAS_FPS},` +
    `vignette=PI/5`
  );
}

/* Gold dust particle layer: Game-of-Life cells tinted gold, 4s rendered and
   looped twice → 8s. Looping whole frames is perfectly seamless. */
export function particleLayerFilter(): string {
  return (
    "colorchannelmixer=rr=1:gg=0.84:bb=0,format=rgba," +
    "colorkey=0x000000:0.25:0.15,boxblur=5:1,colorchannelmixer=aa=0.6," +
    "loop=loop=1:size=120"
  );
}

/** Lyric flicker: 1Hz neon flicker inside an 8s envelope — both periodic. */
export function lyricFlickerFilter(text: string): string {
  const n = CANVAS_TOTAL_FRAMES;
  const size = autoFontSize(text);
  const flicker =
    `drawtext=fontfile='${FONT_PATH}':text='${escapeDrawtext(text)}':` +
    `fontsize=${size}:fontcolor=0xFFD700:` +
    `x=(w-text_w)/2:y='h*0.66':` +
    `alpha='0.15+0.85*(0.5+0.5*sin(2*PI*t))*(0.5+0.5*sin(2*PI*t/8))'`;
  return (
    `zoompan=z='1+0.03*sin(2*PI*on/${n})':` +
    `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':` +
    `d=${n}:s=${CANVAS_W}x${CANVAS_H}:fps=${CANVAS_FPS},` +
    `drawbox=x=0:y=768:w=720:h=307:color=black@0.35:t=fill,` +
    flicker
  );
}

/** Measure an audio file's max volume (dB) to drive the pulse amplitude. */
async function measureAudioEnergy(audioPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      "ffmpeg",
      ["-hide_banner", "-i", audioPath, "-t", String(CANVAS_SECONDS), "-af", "volumedetect", "-f", "null", "-"],
      { timeout: 120_000 }
    );
    const match = /max_volume:\s*(-?\d+(?:\.\d+)?)\s*dB/.exec(stdout + "");
    const maxDb = match?.[1] ? parseFloat(match[1]) : -30;
    // -60dB → whisper, 0dB → slam. Map to a sane zoom amplitude.
    const norm = Math.min(1, Math.max(0, (maxDb + 60) / 60));
    return 0.04 + norm * 0.08;
  } catch {
    return 0.07; // no audio or unreadable → gentle default pulse
  }
}

export interface CanvasRenderOptions {
  style: CanvasStyleKey;
  overlayText?: string;
  /** Pulse amplitude; measured from audio when omitted. */
  pulseAmplitude?: number;
}

/* ─── Endpoints ─────────────────────────────────────────────────────────── */

router.get("/canvas/styles", requireAuth, (_req, res) => {
  res.json({
    styles: Object.entries(CANVAS_STYLES).map(([key, v]) => ({
      key,
      label: v.label,
      blurb: v.blurb,
    })),
    spec: {
      width: CANVAS_W,
      height: CANVAS_H,
      seconds: CANVAS_SECONDS,
      fps: CANVAS_FPS,
      format: "mp4",
      audio: false,
      note: "Spotify Canvas spec: 3-8s seamless 9:16 MP4, silent.",
    },
  });
});

router.post("/canvas/generate", requireAuth, async (req, res) => {
  const parsed = canvasSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { coverUrl, audioUrl, style, overlayText, songTitle, artistName, attribution } = parsed.data;

  if (style === "lyricFlicker" && !overlayText) {
    res.status(400).json({ error: "The Lyric Flicker style needs a lyric line (overlayText)." });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < CANVAS_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, CANVAS_COST, {
      action: "Spotify Canvas Generator",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "canvas-"));
  const coverPath = join(workDir, "cover");
  const basePath = join(workDir, "base.png");
  const audioPath = join(workDir, "audio");
  const outputPath = join(workDir, "canvas.mp4");

  try {
    const coverRes = await fetch(coverUrl, { signal: AbortSignal.timeout(120_000) });
    if (!coverRes.ok) throw new Error("Could not download the cover art.");
    await writeFile(coverPath, Buffer.from(await coverRes.arrayBuffer()));

    let audioDownloaded = false;
    if (audioUrl) {
      try {
        const audioRes = await fetch(audioUrl, { signal: AbortSignal.timeout(120_000) });
        if (audioRes.ok) {
          await writeFile(audioPath, Buffer.from(await audioRes.arrayBuffer()));
          audioDownloaded = true;
        }
      } catch {
        /* Audio is optional — continue without it. */
      }
    }

    /* Pass 1: compose the 720x1280 base still (with the optional attribution tag). */
    const attributionFont = attribution ? await resolveAttributionFont() : null;
    await execFileAsync(
      "ffmpeg",
      ["-y", "-i", coverPath, "-filter_complex", buildCanvasBaseFilter(attributionFont), "-map", "[canvas]", "-frames:v", "1", basePath],
      { timeout: 120_000 }
    );

    /* Pass 2: animate a seamless 8s loop from the single still. */
    const animArgs: string[] = ["-y", "-framerate", String(CANVAS_FPS), "-i", basePath];
    let videoFilter: string;
    if (style === "zoom") {
      videoFilter = zoomFilter();
    } else if (style === "pulse") {
      const amplitude = audioDownloaded ? await measureAudioEnergy(audioPath) : 0.07;
      videoFilter = pulseFilter(amplitude);
    } else if (style === "particles") {
      /* Particle layer: 4s of gold Game-of-Life dust, looped twice → 8s,
         seamless. Rendered over the base with a gentle breathing zoom. */
      const particleSrc =
        `life=s=${CANVAS_W}x${CANVAS_H}:rate=${CANVAS_FPS}:` +
        `rule=B3/S23:random_fill_ratio=0.04:random_seed=7`;
      /* Build via filter_complex: zoomed base + particle overlay. */
      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          "-framerate", String(CANVAS_FPS), "-i", basePath,
          "-f", "lavfi", "-t", "4", "-i", particleSrc,
          "-filter_complex",
          `[0:v]${zoomFilter()}[base];[1:v]${particleLayerFilter()}[dust];[base][dust]overlay=0:0`,
          "-frames:v", String(CANVAS_TOTAL_FRAMES),
          "-r", String(CANVAS_FPS),
          "-c:v", "libx264", "-preset", "fast", "-crf", "18",
          "-pix_fmt", "yuv420p", "-an",
          "-movflags", "+faststart",
          outputPath,
        ],
        { timeout: 600_000 }
      );
      videoFilter = ""; // handled above
    } else {
      videoFilter = lyricFlickerFilter(overlayText!);
    }

    if (videoFilter) {
      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          ...animArgs,
          "-vf", videoFilter,
          "-frames:v", String(CANVAS_TOTAL_FRAMES),
          "-r", String(CANVAS_FPS),
          "-c:v", "libx264", "-preset", "fast", "-crf", "18",
          "-pix_fmt", "yuv420p", "-an",
          "-movflags", "+faststart",
          outputPath,
        ],
        { timeout: 600_000 }
      );
    }

    /* Verify the render is a sane file before uploading. */
    const { stdout: probe } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height,duration,codec_name",
      "-of", "default=noprint_wrappers=1",
      outputPath,
    ]);
    if (!/width=720/.test(probe) || !/height=1280/.test(probe)) {
      throw new Error("Canvas render came out at the wrong size — please try again.");
    }

    const buffer = await readFile(outputPath);
    const objectName = `canvas/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    /* Non-fatal: history + label for the generations library. */
    const label = [artistName, songTitle].filter(Boolean).join(" — ") || "Spotify Canvas";
    await recordCanvasHistory({
      userId: req.userId!,
      videoUrl: url,
      creditsUsed: CANVAS_COST,
      title: `${label} (${CANVAS_STYLES[style].label})`,
      style,
    });

    res.json({
      url,
      storageRef,
      style,
      attribution,
      spec: { width: CANVAS_W, height: CANVAS_H, seconds: CANVAS_SECONDS, silent: true },
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Canvas generation failed.";
    req.log.error({ err: message }, "[canvas] failed");
    await refundCredits(req.userId!, CANVAS_COST, {
      action: "Spotify Canvas — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
