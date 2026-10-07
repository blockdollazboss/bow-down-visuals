import { Router } from "express";
import { z } from "zod";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";
import { enqueueExport } from "../../lib/export-jobs";
import { logger } from "../../lib/logger";

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── Multi-ratio export ───
   One-click "Export for all platforms": takes a finished video and renders
   one file per requested aspect ratio — 16:9 (1280×720, YouTube),
   9:16 (720×1280, TikTok/Reels/Shorts), 1:1 (1080×1080, feed posts),
   4:5 (1080×1350, portrait feed). Each ratio is rendered to its OWN
   exact canvas (unlike auto-reframe, which always outputs 1080×1920).

   Two reframe modes:
   - "pad" (default): smart padding — the full frame is scaled to FIT inside
     the target canvas and centered over a blurred full-bleed copy of
     itself. Nothing is ever cropped.
   - "crop": center-crop to the target aspect, then scale to the target
     canvas. Fills the frame, edges are cut.

   100 Visual Bucs per ratio (env MULTI_RATIO_CREDITS_PER_RATIO).
   Charged up front after a 402 pre-check; every ratio that fails is
   automatically refunded (100 each) when the job settles. */

const COST_PER_RATIO = Number(process.env["MULTI_RATIO_CREDITS_PER_RATIO"]) || 100;

const RATIO_PRESETS = {
  "16:9": { width: 1280, height: 720,  label: "Landscape", platform: "youtube",   platformLabel: "YouTube",            blurb: "YouTube, TV, widescreen players" },
  "9:16": { width: 720,  height: 1280, label: "Vertical",  platform: "tiktok",    platformLabel: "TikTok · Reels · Shorts", blurb: "TikTok, Reels, YouTube Shorts" },
  "1:1":  { width: 1080, height: 1080, label: "Square",    platform: "instagram", platformLabel: "Instagram feed",     blurb: "Instagram / Facebook feed posts" },
  "4:5":  { width: 1080, height: 1350, label: "Portrait",  platform: "instagram", platformLabel: "Portrait feed",      blurb: "Instagram / Facebook portrait feed" },
} as const;

type RatioKey = keyof typeof RATIO_PRESETS;
type ReframeMode = "pad" | "crop";

const multiRatioSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  ratios: z
    .array(z.string())
    .min(1, "Pick at least one ratio.")
    .max(4, "At most 4 ratios per export.")
    .refine(
      (arr): arr is RatioKey[] => arr.every((v) => v in RATIO_PRESETS),
      { message: `ratios must be a subset of: ${Object.keys(RATIO_PRESETS).join(", ")}` },
    ),
  mode: z.enum(["pad", "crop"]).optional().default("pad"),
  /** Optional label used by the UI handoffs (caption topic). */
  topic: z.string().trim().max(200).optional(),
  /* Virality attribution: burn "Made with Bow Down Visuals" into every
     ratio. Free/bonus exports carry it by policy; paid exports get it as
     an opt-in (paired with the watermark-removal upsell for removal). */
  attribution: z.boolean().optional().default(false),
});

type RatioJobState = "queued" | "rendering" | "done" | "failed";

interface RatioResult {
  ratio: RatioKey;
  width: number;
  height: number;
  label: string;
  platform: string;
  platformLabel: string;
  state: RatioJobState;
  /** 0–100, parsed live from ffmpeg's progress pipe. */
  progress: number;
  url?: string;
  storageRef?: string;
  error?: string;
}

interface MultiRatioJob {
  id: string;
  userId: string;
  videoUrl: string;
  mode: ReframeMode;
  attribution: boolean;
  topic?: string;
  costTotal: number;
  costPerRatio: number;
  ratios: RatioResult[];
  state: "queued" | "active" | "done" | "failed";
  createdAt: number;
  updatedAt: number;
  error?: string;
  refunded?: number;
}

/* Single-node job store. Every queued job row is short-lived and its
   outputs are durable in Supabase storage; a server restart mid-render
   refunds any ratio that never completed (see the finally block in the
   worker). */
const jobs = new Map<string, MultiRatioJob>();
const JOB_TTL_MS = 2 * 60 * 60 * 1000;

function pruneJobs(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if ((job.state === "done" || job.state === "failed") && now - job.updatedAt > JOB_TTL_MS) {
      jobs.delete(id);
    }
  }
}

function publicJob(job: MultiRatioJob) {
  const done = job.ratios.filter((r) => r.state === "done").length;
  const failed = job.ratios.filter((r) => r.state === "failed").length;
  const total = job.ratios.length;
  const avg =
    total === 0 ? 0 : Math.round(job.ratios.reduce((s, r) => s + r.progress, 0) / total);
  return {
    jobId: job.id,
    state: job.state,
    mode: job.mode,
    attribution: job.attribution,
    topic: job.topic ?? null,
    costPerRatio: job.costPerRatio,
    costTotal: job.costTotal,
    refunded: job.refunded ?? 0,
    progress: job.state === "done" ? 100 : job.state === "failed" ? 0 : avg,
    completedRatios: done,
    failedRatios: failed,
    totalRatios: total,
    error: job.error ?? null,
    ratios: job.ratios.map((r) => ({
      ratio: r.ratio,
      width: r.width,
      height: r.height,
      label: r.label,
      platform: r.platform,
      platformLabel: r.platformLabel,
      state: r.state,
      progress: r.progress,
      url: r.url ?? null,
      error: r.error ?? null,
    })),
  };
}

router.get("/multi-ratio/ratios", requireAuth, (_req, res) => {
  res.json({
    costPerRatio: COST_PER_RATIO,
    ratios: Object.entries(RATIO_PRESETS).map(([key, v]) => ({
      key,
      width: v.width,
      height: v.height,
      label: v.label,
      platform: v.platform,
      platformLabel: v.platformLabel,
      blurb: v.blurb,
    })),
  });
});

router.post("/export-multi-ratio", requireAuth, async (req, res) => {
  const parsed = multiRatioSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const ratios = [...new Set(parsed.data.ratios)]; // de-dupe
  const costTotal = ratios.length * COST_PER_RATIO;

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < costTotal) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
      creditsRequired: costTotal,
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, costTotal, {
      action: `Multi-Ratio Export (${ratios.join(", ")})`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const job: MultiRatioJob = {
    id: randomUUID(),
    userId: req.userId!,
    videoUrl: parsed.data.videoUrl,
    mode: parsed.data.mode,
    attribution: parsed.data.attribution,
    topic: parsed.data.topic,
    costTotal,
    costPerRatio: COST_PER_RATIO,
    ratios: ratios.map((ratio) => {
      const preset = RATIO_PRESETS[ratio];
      return {
        ratio,
        width: preset.width,
        height: preset.height,
        label: preset.label,
        platform: preset.platform,
        platformLabel: preset.platformLabel,
        state: "queued" as const,
        progress: 0,
      };
    }),
    state: "queued",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  jobs.set(job.id, job);
  pruneJobs();

  // Background render through the shared single-slot export queue so a
  // multi-ratio batch never starves (or stampedes) the render box.
  enqueueExport(() => runMultiRatioJob(job.id));

  res.status(202).json({ ...publicJob(job), creditsRemaining: creditsAfter });
});

router.get("/export-multi-ratio/job/:jobId", requireAuth, (req, res) => {
  const jobIdParam = req.params.jobId;
  const job = typeof jobIdParam === "string" ? jobs.get(jobIdParam) : undefined;
  if (!job || job.userId !== req.userId) {
    res.status(404).json({ error: "Job not found." });
    return;
  }
  res.json(publicJob(job));
});

/* ─── Worker ─────────────────────────────────────────────────── */

async function probeDurationSeconds(mediaPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=nw=1:nk=1",
      mediaPath,
    ], { timeout: 60_000 });
    const n = parseFloat(String(stdout).trim());
    return isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Smart-pad filter: blurred full-bleed background + source fit inside. */
function padFilter(width: number, height: number): string {
  return (
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height},boxblur=20:1[bg];` +
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,format=rgba[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2`
  );
}

/* Attribution burn-in: gold "Made with Bow Down Visuals" tag, bottom-center,
   small and semi-transparent — the standing attribution playbook for
   free/bonus exports; opt-in here because multi-ratio is a paid export. */
const ATTRIBUTION_FONT_CANDIDATES = [
  "/usr/share/fonts/bdv/Poppins-Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
];

async function resolveAttributionFont(): Promise<string | null> {
  const { access } = await import("fs/promises");
  for (const p of ATTRIBUTION_FONT_CANDIDATES) {
    try {
      await access(p);
      return p;
    } catch {
      /* try next */
    }
  }
  return null;
}

function escapeDrawtext(t: string): string {
  return t
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "%%");
}

function attributionDrawtext(fontfile: string, width: number): string {
  const size = Math.max(14, Math.round(width / 40));
  return `drawtext=fontfile='${fontfile}':text='${escapeDrawtext("Made with Bow Down Visuals")}':` +
    `fontsize=${size}:fontcolor=0xFFD75E@0.75:x=(w-text_w)/2:y=h-${size + 18}:` +
    `borderw=1:bordercolor=0x000000@0.6`;
}

/** Center-crop filter: crop to target aspect, then scale to exact canvas. */
function cropFilter(width: number, height: number): string {
  const target = width / height;
  const t = target.toFixed(6);
  return (
    `crop='if(gt(iw/ih,${t}),ih*${t},iw)':'if(gt(iw/ih,${t}),ih,iw/${t})',` +
    `scale=${width}:${height},setsar=1`
  );
}

function runFfmpegWithProgress(
  inputPath: string,
  filter: string,
  outputPath: string,
  durationSec: number,
  onProgress: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", [
      "-y", "-i", inputPath,
      "-filter_complex", filter,
      "-c:v", "libx264", "-preset", "fast", "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
      "-progress", "pipe:1",
      "-nostats",
      outputPath,
    ]);
    let stderrTail = "";
    let settled = false;
    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };
    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      for (const line of text.split("\n")) {
        const m = line.match(/^out_time_ms=(\d+)/);
        if (m && durationSec > 0) {
          const pct = Math.min(99, Math.round((Number(m[1]) / 1_000_000 / durationSec) * 100));
          onProgress(pct);
        }
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-4000);
    });
    child.on("error", (err) => done(err));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      done(new Error("Render timed out."));
    }, 30 * 60 * 1000);
    timer.unref?.();
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) done();
      else done(new Error(`ffmpeg exited with code ${code}: ${stderrTail.slice(-500)}`));
    });
  });
}

async function runMultiRatioJob(jobId: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job || job.state !== "queued") return;
  job.state = "active";
  job.updatedAt = Date.now();

  const workDir = await mkdtemp(join(tmpdir(), "multi-ratio-"));
  const inputPath = join(workDir, "input.mp4");
  let settled = false;

  try {
    const vidRes = await fetch(job.videoUrl, { signal: AbortSignal.timeout(180_000) });
    if (!vidRes.ok) throw new Error("Could not download the source video.");
    await writeFile(inputPath, Buffer.from(await vidRes.arrayBuffer()));

    const durationSec = await probeDurationSeconds(inputPath);
    const attributionFont = job.attribution ? await resolveAttributionFont() : null;

    for (const ratio of job.ratios) {
      ratio.state = "rendering";
      ratio.progress = 1;
      job.updatedAt = Date.now();
      const outputPath = join(workDir, `out-${ratio.ratio.replace(":", "x")}.mp4`);
      try {
        let filter = job.mode === "crop"
          ? cropFilter(ratio.width, ratio.height)
          : padFilter(ratio.width, ratio.height);
        if (job.attribution && attributionFont) {
          filter += `,${attributionDrawtext(attributionFont, ratio.width)}`;
        }
        await runFfmpegWithProgress(
          inputPath, filter, outputPath, durationSec,
          (pct) => { ratio.progress = pct; },
        );
        const buffer = await readFile(outputPath);
        const slug = ratio.ratio.replace(":", "x");
        const objectName = `multi-ratio/${job.userId}/${job.id}/${slug}.mp4`;
        const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
        const url = await refreshSupabaseStorageUrl(storageRef);
        ratio.state = "done";
        ratio.progress = 100;
        ratio.url = url;
        ratio.storageRef = storageRef;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Render failed.";
        logger.error({ err: message, jobId, ratio: ratio.ratio }, "[export-multi-ratio] ratio failed");
        ratio.state = "failed";
        ratio.progress = 0;
        ratio.error = message;
      } finally {
        job.updatedAt = Date.now();
      }
    }

    const doneCount = job.ratios.filter((r) => r.state === "done").length;
    const failedCount = job.ratios.filter((r) => r.state === "failed").length;
    settled = true;

    if (doneCount === 0) {
      // Total failure: refund everything.
      await refundCredits(job.userId, job.costTotal, {
        action: "Multi-Ratio Export — Full Refund",
      }).catch(() => {});
      job.refunded = job.costTotal;
      job.state = "failed";
      job.error = job.ratios[0]?.error ?? "All ratio renders failed.";
    } else {
      job.state = "done";
      if (failedCount > 0) {
        // Partial failure: refund each failed ratio.
        const refund = failedCount * job.costPerRatio;
        await refundCredits(job.userId, refund, {
          action: "Multi-Ratio Export — Partial Refund",
        }).catch(() => {});
        job.refunded = refund;
      }
    }
    job.updatedAt = Date.now();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Multi-ratio export failed.";
    logger.error({ err: message, jobId }, "[export-multi-ratio] job failed");
    if (!settled) {
      // Job never got off the ground — refund in full.
      await refundCredits(job.userId, job.costTotal, {
        action: "Multi-Ratio Export — Full Refund",
      }).catch(() => {});
      job.refunded = job.costTotal;
    }
    job.state = "failed";
    job.error = message;
    job.updatedAt = Date.now();
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export default router;
