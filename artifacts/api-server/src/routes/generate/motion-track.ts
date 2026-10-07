import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync } from "fs";
import { writeFile, readFile, rm, mkdtemp, readdir } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── Motion tracking (CapCut parity) ────────────────────────────────────
   Two-step flow:
     1. POST /motion-track/track — async job: user picks a box around a
        subject; the server runs a template-matching tracker (ffmpeg frame
        sampling + numpy normalized cross-correlation, OpenCV-free) and
        returns per-frame track points. 350 Visual Bucs.
     2. POST /motion-track/apply — burns a following text label, image
        sticker, or blur/pixelate box onto the clip along the track.
        Free when it consumes a completed (already paid) track job, else
        350 Visual Bucs for manual-anchor burn-in.
   402 pre-check → charge → auto-refund on failure. Track jobs run one at
   a time in a FIFO background queue; the client polls
   GET /motion-track/job/:jobId. */

const MOTION_TRACK_COST = Number(process.env["MOTION_TRACK_CREDITS"]) || 350;
const MAX_TRACK_SECONDS = 60;
const DEFAULT_SAMPLE_FPS = 5;

/** DejaVu is bundled on the render image; drawtext needs an explicit file. */
const FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
];

const boxSchema = z.object({
  /** Relative top-left corner, 0..1. */
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  /** Relative size, 0..1. */
  w: z.number().min(0.03).max(0.9),
  h: z.number().min(0.03).max(0.9),
});

const pointSchema = z.object({
  t: z.number().min(0),
  /** Relative center position, 0..1. */
  x: z.number().min(-0.5).max(1.5),
  y: z.number().min(-0.5).max(1.5),
  /** Relative box size, 0..1. */
  w: z.number().min(0.01).max(1),
  h: z.number().min(0.01).max(1),
});

const trackSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  box: boxSchema,
  /** Seconds into the video where tracking starts. */
  startSec: z.number().min(0).max(3600).optional().default(0),
  /** Track window length in seconds (capped at 60). */
  durationSec: z.number().min(1).max(600).optional(),
  /** Anchor frames per second (2..10). */
  sampleFps: z.number().int().min(2).max(10).optional().default(DEFAULT_SAMPLE_FPS),
});

const applySchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  /** Completed track job to consume (owned by caller) — makes apply free. */
  trackJobId: z.string().trim().min(1).max(64).optional(),
  /** Or inline anchors — AI-tracked points or hand-set keyframes. */
  points: z.array(pointSchema).min(2).max(1200).optional(),
  startSec: z.number().min(0).max(3600).optional().default(0),
  durationSec: z.number().min(1).max(600).optional(),
  mode: z.enum(["text", "sticker", "blur", "pixelate"]),
  text: z.string().trim().min(1).max(80).optional(),
  fontSize: z.number().int().min(12).max(120).optional().default(34),
  /** Where the text sits relative to the box: above | below | center. */
  textPosition: z.enum(["above", "below", "center"]).optional().default("above"),
  /** "glow" = showpiece glowing gold title (viral look). */
  textStyle: z.enum(["clean", "glow"]).optional().default("clean"),
  /** "Made with Bow Down Visuals" credit on the export (toggleable). */
  attribution: z.boolean().optional().default(true),
  stickerUrl: z.string().trim().min(1).max(2048).optional(),
  /** Sticker width as a fraction of video width. */
  stickerScale: z.number().min(0.03).max(0.6).optional().default(0.12),
  /** 1 = soft, 2 = medium, 3 = heavy. */
  blurStrength: z.number().int().min(1).max(3).optional().default(2),
});

/* ─── In-memory async job store (single-node, WEB_CONCURRENCY=1) ─────── */

type JobState = "queued" | "active" | "done" | "failed";

interface TrackPoint {
  t: number;
  x: number;
  y: number;
  w: number;
  h: number;
  conf: number;
}

interface TrackResult {
  points: TrackPoint[];
  sampleFps: number;
  width: number;
  height: number;
  startSec: number;
  duration: number;
  avgConfidence: number;
  lowConfidence: boolean;
}

interface TrackJob {
  id: string;
  userId: string;
  state: JobState;
  stage: string;
  progress: number;
  params: z.infer<typeof trackSchema>;
  result: TrackResult | null;
  error: string | null;
  createdAt: number;
}

const jobs = new Map<string, TrackJob>();
const queue: string[] = [];
let workerRunning = false;

function setJob(id: string, patch: Partial<TrackJob>) {
  const j = jobs.get(id);
  if (j) Object.assign(j, patch);
}

/* ─── Embedded numpy tracker (written to the job workdir at runtime) ─── */

const TRACKER_PY = `
import json, sys, glob, math
import numpy as np
from PIL import Image

def gray_small(path, max_w=240):
    im = Image.open(path).convert("L")
    w, h = im.size
    s = min(1.0, max_w / w)
    if s < 1.0:
        im = im.resize((max(2, int(w * s)), max(2, int(h * s))), Image.BILINEAR)
    return np.asarray(im, dtype=np.float32)

def ncc_search(frame, tmpl, cx, cy, radius):
    th, tw = tmpl.shape
    fh, fw = frame.shape
    x0 = int(max(0, cx - radius - tw / 2)); x1 = int(min(fw - tw, cx + radius - tw / 2))
    y0 = int(max(0, cy - radius - th / 2)); y1 = int(min(fh - th, cy + radius - th / 2))
    if x1 <= x0 or y1 <= y0:
        return cx, cy, 0.0
    region = frame[y0:y1 + th, x0:x1 + tw]
    oy, ox = region.shape[0] - th + 1, region.shape[1] - tw + 1
    if oy <= 0 or ox <= 0:
        return cx, cy, 0.0
    st = region.strides
    wins = np.lib.stride_tricks.as_strided(
        region, shape=(oy, ox, th, tw), strides=(st[0], st[1], st[0], st[1]))
    tz = tmpl - tmpl.mean()
    tnorm = math.sqrt((tz * tz).sum())
    if tnorm < 1e-6:
        return cx, cy, 0.0
    wz = wins - wins.mean(axis=(2, 3), keepdims=True)
    num = (wz * tz).sum(axis=(2, 3))
    den = np.sqrt((wz * wz).sum(axis=(2, 3))) * tnorm + 1e-9
    ncc = num / den
    jy, ix = np.unravel_index(int(np.argmax(ncc)), ncc.shape)
    score = float(ncc[jy, ix])
    # Parabolic sub-pixel refinement around the NCC peak.
    fx, fy = float(ix), float(jy)
    if 0 < ix < ox - 1:
        xm, xc, xp = ncc[jy, ix - 1], ncc[jy, ix], ncc[jy, ix + 1]
        denom = xm - 2 * xc + xp
        if abs(denom) > 1e-9:
            fx += 0.5 * (xm - xp) / denom
    if 0 < jy < oy - 1:
        ym, yc, yp = ncc[jy - 1, ix], ncc[jy, ix], ncc[jy + 1, ix]
        denom = ym - 2 * yc + yp
        if abs(denom) > 1e-9:
            fy += 0.5 * (ym - yp) / denom
    return x0 + fx + tw / 2, y0 + fy + th / 2, score

def main():
    workdir = sys.argv[1]
    box = json.loads(sys.argv[2])
    sample_fps = float(sys.argv[3])
    start_sec = float(sys.argv[4])
    files = sorted(glob.glob(workdir + "/frame_*.png"))
    if not files:
        print(json.dumps({"error": "No frames extracted."})); return
    fr0 = gray_small(files[0])
    fh, fw = fr0.shape
    tx = min(max(0, int(box["x"] * fw)), fw - 8)
    ty = min(max(0, int(box["y"] * fh)), fh - 8)
    tw = max(8, min(int(box["w"] * fw), fw - tx))
    th = max(8, min(int(box["h"] * fh), fh - ty))
    tmpl = fr0[ty:ty + th, tx:tx + tw].copy()
    radius = max(12, int(max(fw, fh) * 0.12))
    cx, cy = tx + tw / 2, ty + th / 2
    pts = []
    for i, f in enumerate(files):
        fr = fr0 if i == 0 else gray_small(f)
        score = 1.0
        if i > 0:
            cx, cy, score = ncc_search(fr, tmpl, cx, cy, radius)
        pts.append({
            "t": round(start_sec + i / sample_fps, 4),
            "x": round(cx / fw, 5), "y": round(cy / fh, 5),
            "w": round(tw / fw, 5), "h": round(th / fh, 5),
            "conf": round(score, 4),
        })
    avg = sum(p["conf"] for p in pts) / max(1, len(pts))
    print(json.dumps({"points": pts, "avgConfidence": round(avg, 4), "frames": len(pts)}))

if __name__ == "__main__":
    main()
`;

/* ─── ffmpeg helpers ─────────────────────────────────────────────────── */

interface ProbeInfo {
  width: number;
  height: number;
  fps: number;
  duration: number;
}

async function probeVideo(path: string): Promise<ProbeInfo> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,avg_frame_rate,duration",
    "-show_entries", "format=duration",
    "-of", "json", path,
  ], { timeout: 30_000 });
  const data = JSON.parse(stdout) as {
    streams?: { width?: number; height?: number; avg_frame_rate?: string }[];
    format?: { duration?: string };
  };
  const s = data.streams?.[0] ?? {};
  const [num, den] = String(s.avg_frame_rate ?? "30/1").split("/").map(Number);
  const fmtDur = Number(data.format?.duration ?? NaN);
  return {
    width: Number(s.width ?? 0),
    height: Number(s.height ?? 0),
    fps: den ? num / den : 30,
    duration: Number.isFinite(fmtDur) ? fmtDur : 0,
  };
}

async function downloadTo(url: string, dest: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error("Could not download the video.");
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

/** Light moving-average smoothing on center positions (reduces jitter). */
function smoothPoints(points: TrackPoint[]): TrackPoint[] {
  return points.map((p, i) => {
    const lo = Math.max(0, i - 1);
    const hi = Math.min(points.length - 1, i + 1);
    let sx = 0, sy = 0, n = 0;
    for (let k = lo; k <= hi; k++) { sx += points[k].x; sy += points[k].y; n++; }
    return { ...p, x: sx / n, y: sy / n };
  });
}

/** Piecewise-linear expression for overlay/crop x/y from (t, value) anchors. */
function lerpExpr(anchors: { t: number; v: number }[]): string {
  const terms: string[] = [];
  for (let k = 0; k < anchors.length - 1; k++) {
    const a = anchors[k];
    const b = anchors[k + 1];
    const dt = Math.max(1e-3, b.t - a.t);
    const slope = (b.v - a.v) / dt;
    terms.push(
      `gte(t,${a.t.toFixed(3)})*lt(t,${b.t.toFixed(3)})*(${a.v.toFixed(2)}+${slope.toFixed(3)}*(t-${a.t.toFixed(3)}))`,
    );
  }
  const last = anchors[anchors.length - 1];
  terms.push(`gte(t,${last.t.toFixed(3)})*${last.v.toFixed(2)}`);
  return terms.join("+");
}

function assTimestamp(t: number): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t % 1) * 100);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${h}:${p(m)}:${p(s)}.${p(cs)}`;
}

function escapeAssText(text: string): string {
  return text.replace(/[{}\\]/g, (c) => `\\${c}`).replace(/\n/g, "\\N");
}

/* ─── Track worker ───────────────────────────────────────────────────── */

async function runTrackJob(job: TrackJob) {
  const { videoUrl, box, startSec, durationSec, sampleFps } = job.params;
  const workDir = await mkdtemp(join(tmpdir(), "motion-track-"));
  const inputPath = join(workDir, "input.mp4");
  try {
    setJob(job.id, { stage: "Downloading video", progress: 5 });
    await downloadTo(videoUrl, inputPath);

    setJob(job.id, { stage: "Analyzing video", progress: 18 });
    const info = await probeVideo(inputPath);
    if (!info.width || !info.height) throw new Error("Could not read the video.");
    if (info.duration > 0 && startSec >= info.duration) {
      throw new Error("Start time is past the end of the video.");
    }
    const windowSec = Math.min(
      durationSec ?? MAX_TRACK_SECONDS,
      MAX_TRACK_SECONDS,
      info.duration > 0 ? Math.max(1, info.duration - startSec) : MAX_TRACK_SECONDS,
    );

    setJob(job.id, { stage: "Sampling frames", progress: 32 });
    await execFileAsync("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-ss", String(startSec), "-t", String(windowSec),
      "-i", inputPath,
      "-vf", `fps=${sampleFps}`,
      "-q:v", "3",
      join(workDir, "frame_%04d.png"),
    ], { timeout: 180_000 });
    const frames = (await readdir(workDir)).filter((f) => f.startsWith("frame_") && f.endsWith(".png"));
    if (frames.length < 2) throw new Error("Could not sample enough frames from the video.");

    setJob(job.id, { stage: "Tracking subject", progress: 48 });
    const scriptPath = join(workDir, "tracker.py");
    await writeFile(scriptPath, TRACKER_PY);
    const { stdout } = await execFileAsync("python3", [
      scriptPath, workDir, JSON.stringify(box), String(sampleFps), String(startSec),
    ], { timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });
    const parsed = JSON.parse(stdout.trim().split("\n").pop() ?? "{}") as {
      points?: TrackPoint[];
      avgConfidence?: number;
      error?: string;
    };
    if (parsed.error || !parsed.points?.length) {
      throw new Error(parsed.error ?? "Tracking produced no points.");
    }

    setJob(job.id, { stage: "Smoothing track", progress: 92 });
    const points = smoothPoints(parsed.points);
    const avgConfidence = parsed.avgConfidence ?? 0;
    setJob(job.id, {
      state: "done",
      stage: "Done",
      progress: 100,
      result: {
        points,
        sampleFps,
        width: info.width,
        height: info.height,
        startSec,
        duration: windowSec,
        avgConfidence,
        lowConfidence: avgConfidence < 0.35,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Motion tracking failed.";
    setJob(job.id, { state: "failed", stage: "Failed", progress: 0, error: message });
    await refundCredits(job.userId, MOTION_TRACK_COST, {
      action: "Motion Tracking — Refund",
    }).catch(() => {});
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    workerRunning = false;
    pumpQueue();
  }
}

function pumpQueue() {
  if (workerRunning) return;
  const id = queue.shift();
  if (!id) return;
  const job = jobs.get(id);
  if (!job || job.state !== "queued") {
    pumpQueue();
    return;
  }
  workerRunning = true;
  setJob(id, { state: "active", stage: "Starting", progress: 2 });
  void runTrackJob(job);
}

/* ─── Routes ─────────────────────────────────────────────────────────── */

router.post("/motion-track/track", requireAuth, async (req, res) => {
  const parsed = trackSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < MOTION_TRACK_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, MOTION_TRACK_COST, {
      action: "Motion Tracking",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const id = randomUUID();
  jobs.set(id, {
    id,
    userId: req.userId!,
    state: "queued",
    stage: "Queued",
    progress: 0,
    params: parsed.data,
    result: null,
    error: null,
    createdAt: Date.now(),
  });
  queue.push(id);
  pumpQueue();

  res.status(202).json({ jobId: id, cost: MOTION_TRACK_COST, creditsRemaining: creditsAfter });
});

router.get("/motion-track/job/:jobId", requireAuth, (req, res) => {
  const rawId = req.params.jobId;
  const jobId = Array.isArray(rawId) ? (rawId[0] ?? "") : (rawId ?? "");
  const job = jobs.get(jobId);
  if (!job || job.userId !== req.userId) {
    res.status(404).json({ error: "Track job not found." });
    return;
  }
  res.json({
    jobId: job.id,
    state: job.state,
    stage: job.stage,
    progress: job.progress,
    result: job.result,
    error: job.error,
  });
});

router.post("/motion-track/apply", requireAuth, async (req, res) => {
  const parsed = applySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const d = parsed.data;

  /* Resolve the track points: from a completed owned job, or inline. */
  let points: TrackPoint[] | null = null;
  let trackStart = d.startSec;
  let trackDuration = d.durationSec ?? MAX_TRACK_SECONDS;
  let charged = false;
  let creditsAfter = req.userCredits ?? 0;

  const job = d.trackJobId ? jobs.get(d.trackJobId) : null;
  if (job && job.userId === req.userId && job.state === "done" && job.result) {
    points = job.result.points;
    trackStart = job.result.startSec;
    trackDuration = job.result.duration;
  } else if (d.points && d.points.length >= 2) {
    points = d.points.map((p) => ({ ...p, conf: 1 }));
  } else {
    res.status(400).json({
      error: "Provide a completed trackJobId or at least 2 anchor points.",
    });
    return;
  }

  /* Charge only when not consuming an already-paid track job. */
  if (!job) {
    if (creditsAfter < MOTION_TRACK_COST) {
      res.status(402).json({
        error: "out_of_credits",
        message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
      });
      return;
    }
    try {
      creditsAfter = await chargeCredits(req.userId!, MOTION_TRACK_COST, {
        action: "Motion Track Burn-in",
      });
      charged = true;
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
        return;
      }
      throw err;
    }
  }

  if (d.mode === "text" && !d.text) {
    res.status(400).json({ error: "Text mode needs a text label." });
    return;
  }
  if (d.mode === "sticker" && !d.stickerUrl) {
    res.status(400).json({ error: "Sticker mode needs a stickerUrl." });
    return;
  }

  const workDir = await mkdtemp(join(tmpdir(), "motion-apply-"));
  const inputPath = join(workDir, "input.mp4");
  const outputPath = join(workDir, "output.mp4");

  try {
    await downloadTo(d.videoUrl, inputPath);
    const info = await probeVideo(inputPath);
    if (!info.width || !info.height) throw new Error("Could not read the video.");
    const windowSec = Math.min(
      trackDuration,
      MAX_TRACK_SECONDS,
      info.duration > 0 ? Math.max(1, info.duration - trackStart) : MAX_TRACK_SECONDS,
    );
    const W = info.width;
    const H = info.height;

    /* Anchor expressions in pixel space, relative to the window start. */
    const anchors = points.map((p) => ({
      t: p.t - points[0].t,
      cx: p.x * W,
      cy: p.y * H,
      w: p.w * W,
      h: p.h * H,
    }));
    const xExpr = lerpExpr(anchors.map((a) => ({ t: a.t, v: a.cx })));
    const yExpr = lerpExpr(anchors.map((a) => ({ t: a.t, v: a.cy })));

    const baseArgs = [
      "-y", "-hide_banner", "-loglevel", "error",
      "-ss", String(trackStart), "-t", String(windowSec),
      "-i", inputPath,
    ];
    let filter: string;
    const inputs: string[] = [];

    if (d.mode === "text") {
      /* ASS subtitles: one event per resampled anchor with \pos. */
      const styleName = d.textStyle === "glow" ? "FollowGlow" : "Follow";
      const glowTag = d.textStyle === "glow" ? "\\blur1.2" : "";
      const step = 0.1;
      const events: string[] = [];
      for (let t = 0; t <= windowSec; t += step) {
        const cx = interp(anchors, t, "cx");
        const cy = interp(anchors, t, "cy");
        const bh = interp(anchors, t, "h");
        let py = cy;
        if (d.textPosition === "above") py = cy - bh / 2 - d.fontSize * 0.9;
        if (d.textPosition === "below") py = cy + bh / 2 + d.fontSize * 0.9;
        events.push(
          `Dialogue: 0,${assTimestamp(t)},${assTimestamp(Math.min(windowSec, t + step))},${styleName},,0,0,0,,{\\pos(${Math.round(cx)},${Math.round(py)})${glowTag}}${escapeAssText(d.text!)}`,
        );
      }
      const attrFontSize = Math.max(14, Math.round(W / 54));
      if (d.attribution) {
        /* libass here ignores \an alignment overrides — use explicit \pos. */
        const attrText = "Made with Bow Down Visuals";
        const estHalfW = (attrText.length * attrFontSize * 0.62) / 2;
        const ax = Math.round(Math.max(estHalfW + 8, W - 16 - estHalfW));
        const ay = H - 16;
        events.push(
          `Dialogue: 0,${assTimestamp(0)},${assTimestamp(windowSec)},Attribution,,0,0,0,,{\\pos(${ax},${ay})}${attrText}`,
        );
      }
      const ass = [
        "[Script Info]",
        "ScriptType: v4.00+",
        `PlayResX: ${W}`,
        `PlayResY: ${H}`,
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        `Style: Follow,DejaVu Sans,${d.fontSize},&H0000D7FF,&H000000FF,&H80000000,&H80000000,-1,0,0,0,100,100,0.5,0,1,2,1,2,10,10,10,1`,
        `Style: FollowGlow,DejaVu Sans,${Math.round(d.fontSize * 1.1)},&H0000D7FF,&H000000FF,&H001E5CB8,&H9900BFFF,-1,0,0,0,100,100,0.5,0,1,2,1,2,10,10,10,1`,
        `Style: Attribution,DejaVu Sans,${attrFontSize},&H66C9A84C,&H000000FF,&H99000000,&H99000000,-1,0,0,0,100,100,0,0,1,1,0,2,16,16,16,1`,
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        ...events,
      ].join("\n");
      const assPath = join(workDir, "follow.ass");
      await writeFile(assPath, ass);
      filter = `subtitles=filename='${assPath.replace(/'/g, "'\\''")}'`;
    } else if (d.mode === "sticker") {
      const stickerPath = join(workDir, "sticker.png");
      await downloadTo(d.stickerUrl!, stickerPath);
      inputs.push("-i", stickerPath);
      const sw = Math.round(W * d.stickerScale);
      const ox = lerpExpr(anchors.map((a) => ({ t: a.t, v: a.cx - sw / 2 })));
      /* Square-ish sticker: center on the tracked point. */
      filter = `[1:v]format=rgba,scale=${sw}:-1[st];[0:v][st]overlay=x='${ox}':y='${lerpExpr(anchors.map((a) => ({ t: a.t, v: a.cy - sw / 2 })))}':format=yuv420[mtout]`;
    } else {
      /* blur / pixelate: crop the tracked box, distort it, overlay it back. */
      const pad = 1.08;
      const bw = Math.max(8, Math.round(interp(anchors, 0, "w") * pad));
      const bh = Math.max(8, Math.round(interp(anchors, 0, "h") * pad));
      const cx = lerpExpr(anchors.map((a) => ({ t: a.t, v: a.cx - bw / 2 })));
      const cy = lerpExpr(anchors.map((a) => ({ t: a.t, v: a.cy - bh / 2 })));
      const distort =
        d.mode === "blur"
          ? `boxblur=luma_radius=${[8, 16, 24][d.blurStrength - 1]}:luma_power=2`
          : "scale=iw/14:ih/14:flags=neighbor,scale=iw*14:ih*14:flags=neighbor";
      filter =
        `[0:v]crop=w=${bw}:h=${bh}:x='${cx}':y='${cy}',${distort}[fg];` +
        `[0:v][fg]overlay=x='${cx}':y='${cy}'[mtout]`;
    }

    /* Optional "Made with Bow Down Visuals" credit on non-text modes. */
    if (d.attribution && d.mode !== "text") {
      const fontFile = FONT_CANDIDATES.find((p) => existsSync(p));
      if (fontFile) {
        const attrPath = join(workDir, "attribution.txt");
        await writeFile(attrPath, "Made with Bow Down Visuals");
        const fs = Math.max(14, Math.round(W / 54));
        /* Insert the credit before the final output label. */
        filter = filter.replace(/\[mtout\]$/, `,drawtext=textfile='${attrPath}':fontfile='${fontFile}':fontsize=${fs}:fontcolor=0xC9A84C@0.8:x=w-tw-24:y=h-th-18[mtout]`);
      }
    }

    /* Multi-input graphs (crop/overlay chains) need -filter_complex. */
    const filterArgs =
      d.mode === "text"
        ? ["-vf", filter]
        : ["-filter_complex", filter, "-map", "[mtout]", "-map", "0:a?"];

    await execFileAsync("ffmpeg", [
      ...baseArgs,
      ...inputs,
      ...filterArgs,
      "-c:v", "libx264", "-preset", "fast", "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      outputPath,
    ], { timeout: 420_000 });

    const buffer = await readFile(outputPath);
    const objectName = `motion-track/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({ url, storageRef, creditsRemaining: creditsAfter, mode: d.mode });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Motion track burn-in failed.";
    if (charged) {
      await refundCredits(req.userId!, MOTION_TRACK_COST, {
        action: "Motion Track Burn-in — Refund",
      }).catch(() => {});
    }
    res.status(500).json({ error: message });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

/** Smoothstep interpolation of one anchor channel at time t. */
function interp(
  anchors: { t: number; cx: number; cy: number; w: number; h: number }[],
  t: number,
  key: "cx" | "cy" | "w" | "h",
): number {
  if (t <= anchors[0].t) return anchors[0][key];
  const last = anchors[anchors.length - 1];
  if (t >= last.t) return last[key];
  for (let k = 0; k < anchors.length - 1; k++) {
    const a = anchors[k];
    const b = anchors[k + 1];
    if (t >= a.t && t <= b.t) {
      const u = (t - a.t) / Math.max(1e-6, b.t - a.t);
      const s = u * u * (3 - 2 * u);
      return a[key] + (b[key] - a[key]) * s;
    }
  }
  return last[key];
}

export default router;
