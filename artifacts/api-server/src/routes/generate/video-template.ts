import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
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
import {
  VIDEO_TEMPLATES,
  getVideoTemplateRecipe,
  recipeOutputSeconds,
  type VideoTemplateRecipe,
} from "../../data/video-templates";
import {
  ASPECT_DIMS,
  buildEndCard,
  buildFiltergraph,
  type SlotPlan,
} from "../../lib/video-template-engine";
import { logger } from "../../lib/logger";

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── Video edit templates (CapCut-style) ───
   Pick a template, drop in clips/photos, get an auto-edited video.
   Templates are JSON recipes (see ../../data/video-templates.ts); this
   route interprets them with ffmpeg — no per-template code.
   250 Visual Bucs per apply. Long renders run as background jobs:
   POST returns 202 + jobId, the client polls GET job/:jobId. */

const TEMPLATE_COST = 250;

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|avif)(\?|#|$)/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv)(\?|#|$)/i;

/* ─── Job store (in-memory) + serial render queue ───
   One ffmpeg render at a time so concurrent applies never fight for memory
   on the small instance — same discipline as the export job queue. */

type TemplateJobState = "queued" | "active" | "done" | "failed";

interface TemplateJob {
  id: string;
  userId: string;
  state: TemplateJobState;
  stage: string;
  progress: number;
  result?: {
    url: string;
    storageRef: string;
    durationSec: number;
    template: string;
  };
  error?: string;
  createdAt: number;
}

const jobs = new Map<string, TemplateJob>();
const renderQueue: Array<() => Promise<void>> = [];
let queuePumping = false;

function pumpQueue(): void {
  if (queuePumping) return;
  queuePumping = true;
  (async () => {
    try {
      while (renderQueue.length > 0) {
        const run = renderQueue.shift()!;
        try {
          await run();
        } catch (err) {
          logger.error({ err: err instanceof Error ? err.message : err }, "[video-template] queued render threw");
        }
      }
    } finally {
      queuePumping = false;
    }
  })();
}

function setProgress(job: TemplateJob, stage: string, progress: number): void {
  job.stage = stage;
  job.progress = progress;
}

/* ─── ffmpeg helpers ─── */

async function probeMedia(path: string): Promise<{ duration: number | null; hasVideo: boolean; hasAudio: boolean }> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v", "error",
      "-show_entries", "format=duration:stream=codec_type",
      "-of", "json",
      path,
    ],
    { timeout: 30_000 },
  );
  try {
    const data = JSON.parse(stdout) as {
      format?: { duration?: string };
      streams?: Array<{ codec_type?: string }>;
    };
    const streams = data.streams ?? [];
    const dur = data.format?.duration ? parseFloat(data.format.duration) : NaN;
    return {
      duration: Number.isFinite(dur) && dur > 0 ? dur : null,
      hasVideo: streams.some((s) => s.codec_type === "video"),
      hasAudio: streams.some((s) => s.codec_type === "audio"),
    };
  } catch {
    return { duration: null, hasVideo: false, hasAudio: false };
  }
}

async function downloadTo(path: string, url: string, slotLabel: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) {
    throw new Error(`Could not download media for slot "${slotLabel}" (HTTP ${res.status}).`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error(`Empty download for slot "${slotLabel}".`);
  await writeFile(path, buf);
}

/* ─── Render ─── */

interface ApplyInput {
  template: string;
  slots: Array<{ url: string }>;
  overlays: string[];
  musicBedUrl?: string;
  title?: string;
  /** "Made with Bow Down Visuals" branded outro card (optional; default off on paid applies) */
  endCard: boolean;
}

async function renderTemplateVideo(job: TemplateJob, input: ApplyInput): Promise<void> {
  let recipe = getVideoTemplateRecipe(input.template)!;
  const workDir = await mkdtemp(join(tmpdir(), "videotemplate-"));
  let endCardJunctionSec: number | undefined;
  try {
    setProgress(job, "downloading", 5);

    /* Download slot media */
    const plans: SlotPlan[] = [];
    const inputArgs: string[] = [];
    for (let i = 0; i < recipe.slots.length; i++) {
      const slot = recipe.slots[i]!;
      const url = input.slots[i]!.url;
      const isImage = IMAGE_EXT.test(url);
      if (slot.kind === "photo" && !isImage && VIDEO_EXT.test(url)) {
        throw new Error(`Slot "${slot.label}" needs a photo, but the URL looks like a video.`);
      }
      if (slot.kind === "video" && !VIDEO_EXT.test(url) && !isImage) {
        /* unknown extension — probe will decide; keep going */
      }
      if (slot.kind === "video" && isImage) {
        throw new Error(`Slot "${slot.label}" needs a video, but the URL looks like a photo.`);
      }
      const localPath = join(workDir, `slot${i}${isImage ? ".img" : ".mp4"}`);
      await downloadTo(localPath, url, slot.label);
      const probe = await probeMedia(localPath);
      if (!isImage && !probe.hasVideo) {
        throw new Error(`Slot "${slot.label}" has no video stream — check the media URL.`);
      }
      const inputIndex = inputArgs.filter((a) => a === "-i").length;
      if (isImage) inputArgs.push("-loop", "1", "-framerate", "30");
      inputArgs.push("-i", localPath);
      plans.push({
        inputIndex,
        isImage,
        duration: slot.durationSec,
        srcDuration: probe.duration,
        hasAudio: probe.hasAudio,
        label: slot.label,
      });
      setProgress(job, "downloading", 5 + Math.round((15 * (i + 1)) / recipe.slots.length));
    }

    /* Optional music bed */
    let hasBed = false;
    let bedInputIndex: number | undefined;
    if (input.musicBedUrl && input.musicBedUrl.trim().length > 0) {
      const bedPath = join(workDir, "bed.mp3");
      await downloadTo(bedPath, input.musicBedUrl.trim(), "music bed");
      const bedProbe = await probeMedia(bedPath);
      if (!bedProbe.hasAudio) throw new Error("The music bed file has no audio stream.");
      bedInputIndex = inputArgs.filter((a) => a === "-i").length;
      inputArgs.push("-i", bedPath);
      hasBed = true;
    }

    /* Optional "Made with Bow Down Visuals" end card — appended as a final slot */
    if (input.endCard) {
      setProgress(job, "assembling", 22);
      const { w: W, h: H } = ASPECT_DIMS[recipe.aspect];
      const cardPath = await buildEndCard(workDir, W, H);
      const cardIndex = inputArgs.filter((a) => a === "-i").length;
      inputArgs.push("-i", cardPath);
      plans.push({
        inputIndex: cardIndex,
        isImage: false,
        duration: 2.2,
        srcDuration: 2.2,
        hasAudio: false,
        label: "End card",
      });
      recipe = { ...recipe, transitions: [...recipe.transitions, "fade" as const] };
      endCardJunctionSec = 0.5;
    }

    setProgress(job, "assembling", 25);
    const { filter, maps, totalSec } = buildFiltergraph(recipe, plans, input.overlays, hasBed, endCardJunctionSec, bedInputIndex);

    setProgress(job, "rendering", 35);
    const outPath = join(workDir, "result.mp4");
    const args = [
      "-y",
      ...inputArgs,
      "-filter_complex", filter,
      ...maps,
      "-c:v", "libx264", "-preset", "fast", "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "160k",
      "-movflags", "+faststart",
      "-shortest",
      outPath,
    ];
    await execFileAsync("ffmpeg", args, { timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });

    setProgress(job, "uploading", 92);
    const buffer = await readFile(outPath);
    const objectName = `video-templates/${job.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    job.state = "done";
    job.result = { url, storageRef, durationSec: Math.round(totalSec * 10) / 10, template: recipe.key };
    setProgress(job, "done", 100);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Template render failed.";
    logger.error({ err: message, template: input.template }, "[video-template] render failed");
    job.state = "failed";
    job.error = message;
    setProgress(job, "failed", 100);
    /* Auto-refund: the user paid for a video they didn't get. */
    await refundCredits(job.userId, TEMPLATE_COST, {
      action: "Video Template — Refund",
    }).catch((refundErr) => {
      logger.error({ err: refundErr instanceof Error ? refundErr.message : refundErr }, "[video-template] refund failed");
    });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ─── Routes ─── */

/** Template catalog — the editor tab renders from this (single source of truth). */
router.get("/video-template/templates", requireAuth, (_req, res) => {
  res.json({
    price: TEMPLATE_COST,
    templates: VIDEO_TEMPLATES.map((t) => ({
      key: t.key,
      name: t.name,
      tagline: t.tagline,
      description: t.description,
      aspect: t.aspect,
      durationTargetSec: t.durationTargetSec,
      outputSeconds: recipeOutputSeconds(t),
      slots: t.slots.map((s) => ({ key: s.key, label: s.label, kind: s.kind, durationSec: s.durationSec })),
      transitions: t.transitions,
      overlays: t.overlays.map((o) => ({
        text: o.text,
        slotIndex: o.slotIndex,
        position: o.position,
        size: o.size,
        color: o.color,
      })),
      audioMode: t.audioMode,
    })),
  });
});

const applySchema = z.object({
  template: z.string().trim().min(1).max(64),
  slots: z
    .array(z.object({ url: z.string().trim().min(1).max(2048) }))
    .min(1)
    .max(16),
  overlays: z.array(z.string().max(140)).max(12).optional().default([]),
  musicBedUrl: z.string().trim().max(2048).optional(),
  title: z.string().trim().max(80).optional(),
  endCard: z.boolean().optional().default(false),
});

router.post("/video-template/apply", requireAuth, async (req, res) => {
  const parsed = applySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const recipe = getVideoTemplateRecipe(parsed.data.template);
  if (!recipe) {
    res.status(400).json({ error: `Unknown template "${parsed.data.template}".` });
    return;
  }
  if (parsed.data.slots.length !== recipe.slots.length) {
    res.status(400).json({
      error: `Template "${recipe.name}" needs exactly ${recipe.slots.length} media slots (got ${parsed.data.slots.length}).`,
    });
    return;
  }

  /* 402 pre-check before charging */
  if ((req.userCredits ?? 0) < TEMPLATE_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, TEMPLATE_COST, {
      action: `Video Template (${recipe.name})`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const job: TemplateJob = {
    id: randomUUID(),
    userId: req.userId!,
    state: "queued",
    stage: "queued",
    progress: 0,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);

  const input: ApplyInput = {
    template: recipe.key,
    slots: parsed.data.slots,
    overlays: parsed.data.overlays,
    musicBedUrl: parsed.data.musicBedUrl,
    title: parsed.data.title,
    endCard: parsed.data.endCard,
  };
  renderQueue.push(() => renderTemplateVideo(job, input));
  pumpQueue();

  res.status(202).json({
    jobId: job.id,
    state: job.state,
    price: TEMPLATE_COST,
    creditsRemaining: creditsAfter,
  });
});

router.get("/video-template/job/:jobId", requireAuth, (req, res) => {
  const rawId = req.params.jobId;
  const job = jobs.get(Array.isArray(rawId) ? rawId[0] ?? "" : rawId);
  if (!job) {
    res.status(404).json({ error: "Job not found." });
    return;
  }
  if (job.userId !== req.userId) {
    res.status(403).json({ error: "Not your job." });
    return;
  }
  res.json({
    id: job.id,
    state: job.state,
    stage: job.stage,
    progress: job.progress,
    result: job.result ?? null,
    error: job.error ?? null,
  });
});

export default router;
