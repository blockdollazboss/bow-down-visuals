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
import { SANS_BOLD, escapeDrawtext } from "../../lib/video-template-engine";
import { logger } from "../../lib/logger";

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── Split-screen video grids (CapCut parity) ───
   Combines 2-4 video clips into a single split-screen layout with ffmpeg:
   side-by-side, stacked, 3-up, 2x2 grid, or picture-in-picture.
   Audio mix: cell 1 only, mix all, or custom per-cell levels.
   Pure ffmpeg — no paid provider spend.
   200 Visual Bucs per render. Long renders run as background jobs:
   POST returns 202 + jobId, the client polls GET job/:jobId. */

const SPLIT_SCREEN_COST = 200;
const CANVAS_W = 1280;
const CANVAS_H = 720;

const LAYOUTS = [
  { key: "side-by-side", name: "Side by side", cells: 2, description: "Two clips, split vertically down the middle." },
  { key: "stacked", name: "Stacked", cells: 2, description: "Two clips, one on top of the other." },
  { key: "triple", name: "3-up", cells: 3, description: "One wide clip on top, two side-by-side below." },
  { key: "quad", name: "2×2 grid", cells: 4, description: "Four clips in a square grid." },
  { key: "pip", name: "Picture-in-picture", cells: 2, description: "One full-frame clip with a corner inset — the reaction-video look." },
] as const;

type LayoutKey = (typeof LAYOUTS)[number]["key"];
const LAYOUT_KEYS = LAYOUTS.map((l) => l.key) as unknown as [LayoutKey, ...LayoutKey[]];
const LAYOUT_CELLS: Record<LayoutKey, number> = {
  "side-by-side": 2,
  stacked: 2,
  triple: 3,
  quad: 4,
  pip: 2,
};

const AUDIO_MIXES = ["first", "mix", "custom"] as const;
const PIP_CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;

const HEX = /^#?[0-9a-fA-F]{6}$/;

const applySchema = z.object({
  /** 2-4 clip URLs; count must match the layout's cell count. */
  clips: z
    .array(z.object({ url: z.string().trim().min(1).max(2048) }))
    .min(2)
    .max(4),
  layout: z.enum(LAYOUT_KEYS),
  /** Audio mix: cell 1 only / mix all / custom per-cell levels. */
  audioMix: z.enum(AUDIO_MIXES).optional().default("first"),
  /** Per-cell gain 0..1, used when audioMix === "custom". */
  levels: z.array(z.number().min(0).max(1)).max(4).optional().default([]),
  /** Gap in px between cells (grids only). */
  gap: z.number().int().min(0).max(48).optional().default(8),
  /** Border width in px around each cell. */
  border: z.number().int().min(0).max(16).optional().default(0),
  /** Border color, 6-digit hex. */
  borderColor: z.string().trim().regex(HEX, "Must be a 6-digit hex color.").optional().default("#C9A84C"),
  /** Canvas background color, 6-digit hex. */
  backgroundColor: z.string().trim().regex(HEX, "Must be a 6-digit hex color.").optional().default("#000000"),
  /** PiP corner (pip layout only). */
  pipCorner: z.enum(PIP_CORNERS).optional().default("bottom-right"),
  /** PiP inset width as a fraction of canvas width. */
  pipSize: z.number().min(0.1).max(0.5).optional().default(0.28),
  /** Append a gold "Made with Bow Down Visuals" end card (free attribution). */
  attribution: z.boolean().optional().default(false),
  /** Title for the credit ledger. */
  title: z.string().trim().max(80).optional(),
});

function normalizeHex(hex: string): string {
  const h = hex.replace(/^#/, "").toLowerCase();
  return `0x${h}`;
}

/* ─── Job store (in-memory) + serial render queue ───
   One ffmpeg render at a time so concurrent renders never fight for memory
   on the small instance — same discipline as the video-template queue. */

type SplitScreenJobState = "queued" | "active" | "done" | "failed";

interface SplitScreenJob {
  id: string;
  userId: string;
  state: SplitScreenJobState;
  stage: string;
  progress: number;
  result?: {
    url: string;
    storageRef: string;
    durationSec: number;
    layout: string;
  };
  error?: string;
  createdAt: number;
}

const jobs = new Map<string, SplitScreenJob>();
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
          logger.error({ err: err instanceof Error ? err.message : err }, "[split-screen] queued render threw");
        }
      }
    } finally {
      queuePumping = false;
    }
  })();
}

function setProgress(job: SplitScreenJob, stage: string, progress: number): void {
  job.stage = stage;
  job.progress = progress;
}

/* ─── ffmpeg helpers ─── */

async function probeMedia(path: string): Promise<{ duration: number | null; hasVideo: boolean; hasAudio: boolean }> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", path],
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

async function downloadTo(path: string, url: string, label: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) {
    throw new Error(`Could not download clip "${label}" (HTTP ${res.status}).`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error(`Empty download for clip "${label}".`);
  await writeFile(path, buf);
}

/** Center-crop to the cell aspect, then scale to exact cell dims. */
function cellVideoFilter(cellW: number, cellH: number): string {
  const target = (cellW / cellH).toFixed(6);
  return (
    `crop='if(gt(iw/ih,${target}),ih*${target},iw)':'if(gt(iw/ih,${target}),ih,iw/${target})',` +
    `scale=${cellW}:${cellH}:flags=lanczos,setsar=1`
  );
}

/** Grid geometry for a layout (gap-aware; gaps show the background fill).
 *  Cell widths/heights are split so the canvas stays exactly 1280x720. */
function gridGeometry(layout: LayoutKey, gap: number): { cells: Array<{ w: number; h: number }>; layout: string } {
  const W = CANVAS_W;
  const H = CANVAS_H;
  const cw0 = Math.floor((W - gap) / 2);
  const cw1 = W - gap - cw0;
  const ch0 = Math.floor((H - gap) / 2);
  const ch1 = H - gap - ch0;
  switch (layout) {
    case "side-by-side":
      return {
        cells: [
          { w: cw0, h: H },
          { w: cw1, h: H },
        ],
        layout: `0_0|${cw0 + gap}_0`,
      };
    case "stacked":
      return {
        cells: [
          { w: W, h: ch0 },
          { w: W, h: ch1 },
        ],
        layout: `0_0|0_${ch0 + gap}`,
      };
    case "triple":
      return {
        cells: [
          { w: W, h: ch0 },
          { w: cw0, h: ch1 },
          { w: cw1, h: ch1 },
        ],
        layout: `0_0|0_${ch0 + gap}|${cw0 + gap}_${ch0 + gap}`,
      };
    case "quad":
      return {
        cells: [
          { w: cw0, h: ch0 },
          { w: cw1, h: ch0 },
          { w: cw0, h: ch1 },
          { w: cw1, h: ch1 },
        ],
        layout: `0_0|${cw0 + gap}_0|0_${ch0 + gap}|${cw0 + gap}_${ch0 + gap}`,
      };
    default:
      return { cells: [], layout: "" };
  }
}

function pipGeom(corner: (typeof PIP_CORNERS)[number], size: number, margin: number): { insetW: number; insetH: number; x: number; y: number } {
  const insetW = Math.round(CANVAS_W * size);
  const insetH = Math.round(CANVAS_H * size);
  const x = corner.includes("right") ? CANVAS_W - insetW - margin : margin;
  const y = corner.includes("bottom") ? CANVAS_H - insetH - margin : margin;
  return { insetW, insetH, x, y };
}

type ApplyInput = z.infer<typeof applySchema>;

async function renderSplitScreen(job: SplitScreenJob, input: ApplyInput): Promise<void> {
  const workDir = await mkdtemp(join(tmpdir(), "splitscreen-"));
  try {
    setProgress(job, "downloading", 5);

    /* Download + probe clips */
    const localPaths: string[] = [];
    const hasAudio: boolean[] = [];
    for (let i = 0; i < input.clips.length; i++) {
      const clip = input.clips[i]!;
      const localPath = join(workDir, `clip${i}.mp4`);
      await downloadTo(localPath, clip.url, `clip ${i + 1}`);
      const probe = await probeMedia(localPath);
      if (!probe.hasVideo) {
        throw new Error(`Clip ${i + 1} has no video stream — check the media URL.`);
      }
      localPaths.push(localPath);
      hasAudio.push(probe.hasAudio);
      setProgress(job, "downloading", 5 + Math.round((15 * (i + 1)) / input.clips.length));
    }

    setProgress(job, "assembling", 25);

    const inputArgs: string[] = [];
    for (const p of localPaths) inputArgs.push("-i", p);

    const borderHex = normalizeHex(input.borderColor);
    const filterParts: string[] = [];
    let videoChain: string;
    const audioInputs: number[] = [];
    for (let i = 0; i < localPaths.length; i++) if (hasAudio[i]) audioInputs.push(i);

    if (input.layout === "pip") {
      /* Main clip fills the canvas; inset overlays in a corner. */
      const geom = pipGeom(input.pipCorner, input.pipSize, 16);
      filterParts.push(
        `[0:v]${cellVideoFilter(CANVAS_W, CANVAS_H)},format=yuv420p[base]`,
        `[1:v]${cellVideoFilter(geom.insetW, geom.insetH)}` +
          (input.border > 0
            ? `,drawbox=x=0:y=0:w=iw:h=ih:color=${borderHex}:t=${input.border}`
            : "") +
          `,format=yuv420p[inset]`,
        `[base][inset]overlay=${geom.x}:${geom.y},format=yuv420p[vout]`,
      );
      videoChain = "[vout]";
    } else {
      /* Grid layouts: xstack with a background fill (gaps show the fill
         color). xstack's shortest=1 ends the output at the shortest clip. */
      const { cells, layout: layoutStr } = gridGeometry(input.layout, input.gap);
      const bgHex = normalizeHex(input.backgroundColor);
      const cellLabels: string[] = [];
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i]!;
        filterParts.push(
          `[${i}:v]${cellVideoFilter(c.w, c.h)},settb=AVTB` +
            (input.border > 0 ? `,drawbox=x=0:y=0:w=iw:h=ih:color=${borderHex}:t=${input.border}` : "") +
            `,format=yuv420p[cell${i}]`,
        );
        cellLabels.push(`[cell${i}]`);
      }
      filterParts.push(
        `${cellLabels.join("")}xstack=inputs=${cells.length}:layout=${layoutStr}:fill=${bgHex}:shortest=1[vout]`,
      );
      videoChain = "[vout]";
    }

    /* ── Audio mix ── */
    let audioChain = "";
    if (input.audioMix === "first") {
      if (hasAudio[0]) {
        audioChain = "[0:a]aformat=sample_fmts=fltp:channel_layouts=stereo[aout]";
      } else if (audioInputs.length > 0) {
        /* Cell 1 is silent — fall back to the first clip that has audio. */
        audioChain = `[${audioInputs[0]}:a]aformat=sample_fmts=fltp:channel_layouts=stereo[aout]`;
      } else {
        audioChain = "anullsrc=r=48000:cl=stereo[aout]";
      }
    } else {
      /* "mix" (all equal) or "custom" levels — volume each track, then amix. */
      if (audioInputs.length === 0) {
        audioChain = "anullsrc=r=48000:cl=stereo[aout]";
      } else if (audioInputs.length === 1) {
        const gain = input.audioMix === "custom" ? (input.levels[audioInputs[0]!] ?? 1) : 1;
        audioChain = `[${audioInputs[0]}:a]volume=${gain},aformat=sample_fmts=fltp:channel_layouts=stereo[aout]`;
      } else {
        const vols = audioInputs.map((idx, k) => {
          const gain = input.audioMix === "custom" ? (input.levels[idx] ?? 1) : 1;
          return `[${idx}:a]volume=${gain}[am${k}]`;
        });
        const mixInputs = audioInputs.map((_, k) => `[am${k}]`).join("");
        filterParts.push(...vols);
        audioChain = `${mixInputs}amix=inputs=${audioInputs.length}:duration=shortest:dropout_transition=0:normalize=0[aout]`;
      }
    }
    filterParts.push(audioChain);

    setProgress(job, "rendering", 35);
    const gridPath = join(workDir, "grid.mp4");
    const filter = filterParts.join(";");
    const args = [
      "-y",
      ...inputArgs,
      "-filter_complex", filter,
      "-map", videoChain,
      "-map", "[aout]",
      "-c:v", "libx264", "-preset", "fast", "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-r", "30",
      "-c:a", "aac", "-b:a", "160k",
      "-movflags", "+faststart",
      "-shortest",
      gridPath,
    ];
    await execFileAsync("ffmpeg", args, { timeout: 600_000, maxBuffer: 64 * 1024 * 1024 });

    /* ── Optional "Made with Bow Down Visuals" end card (free attribution) ── */
    let finalPath = gridPath;
    if (input.attribution) {
      setProgress(job, "assembling", 80);
      const cardPath = await buildAttributionCard(workDir);
      finalPath = join(workDir, "final.mp4");
      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          "-i", gridPath,
          "-i", cardPath,
          "-filter_complex", "[0:v][0:a][1:v][1:a]concat=n=2:v=1:a=1[v][a]",
          "-map", "[v]", "-map", "[a]",
          "-c:v", "libx264", "-preset", "fast", "-crf", "20",
          "-pix_fmt", "yuv420p",
          "-c:a", "aac", "-b:a", "160k",
          "-movflags", "+faststart",
          finalPath,
        ],
        { timeout: 300_000, maxBuffer: 32 * 1024 * 1024 },
      );
    }

    setProgress(job, "uploading", 92);
    const buffer = await readFile(finalPath);
    const objectName = `split-screen/${job.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);
    const finalProbe = await probeMedia(finalPath);

    job.state = "done";
    job.result = {
      url,
      storageRef,
      durationSec: finalProbe.duration != null ? Math.round(finalProbe.duration * 10) / 10 : 0,
      layout: input.layout,
    };
    setProgress(job, "done", 100);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Split-screen render failed.";
    logger.error({ err: message, layout: input.layout }, "[split-screen] render failed");
    job.state = "failed";
    job.error = message;
    setProgress(job, "failed", 100);
    /* Auto-refund: the user paid for a video they didn't get. */
    await refundCredits(job.userId, SPLIT_SCREEN_COST, {
      action: "Split-Screen Grid — Refund",
    }).catch((refundErr) => {
      logger.error(
        { err: refundErr instanceof Error ? refundErr.message : refundErr },
        "[split-screen] refund failed",
      );
    });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** 2.2s black-and-gold "Made with Bow Down Visuals" card with a silent audio
 *  track, so concat with the grid render is a clean join. */
async function buildAttributionCard(workDir: string): Promise<string> {
  const cardPath = join(workDir, "card.mp4");
  const fs1 = 64;
  const fs2 = 36;
  const vf =
    `drawtext=fontfile=${SANS_BOLD}:text='${escapeDrawtext("BOW DOWN VISUALS")}':` +
    `fontcolor=0xFFD700:fontsize=${fs1}:x=(w-text_w)/2:y=(h-text_h)/2-24,` +
    `drawtext=fontfile=${SANS_BOLD}:text='${escapeDrawtext("Made with")}':` +
    `fontcolor=white:fontsize=${fs2}:x=(w-text_w)/2:y=(h-text_h)/2+${Math.round(fs1 * 0.7)},` +
    `fade=t=in:st=0:d=0.4,fade=t=out:st=1.7:d=0.5,format=yuv420p`;
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-f", "lavfi",
      "-i", `color=c=0x0a0a0a:s=${CANVAS_W}x${CANVAS_H}:r=30:d=2.2`,
      "-f", "lavfi",
      "-i", "anullsrc=r=48000:cl=stereo:d=2.2",
      "-vf", vf,
      "-c:v", "libx264", "-preset", "fast", "-crf", "20",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "96k",
      "-shortest",
      cardPath,
    ],
    { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
  );
  return cardPath;
}

/* ─── Routes ─── */

/** Layout catalog + price — the editor tab renders from this (single source of truth). */
router.get("/split-screen/layouts", requireAuth, (_req, res) => {
  res.json({
    price: SPLIT_SCREEN_COST,
    layouts: LAYOUTS.map((l) => ({
      key: l.key,
      name: l.name,
      cells: l.cells,
      description: l.description,
    })),
  });
});

router.post("/split-screen/apply", requireAuth, async (req, res) => {
  const parsed = applySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const expectedCells = LAYOUT_CELLS[parsed.data.layout];
  if (parsed.data.clips.length !== expectedCells) {
    res.status(400).json({
      error: `Layout "${parsed.data.layout}" needs exactly ${expectedCells} clips (got ${parsed.data.clips.length}).`,
    });
    return;
  }
  if (parsed.data.audioMix === "custom") {
    const levels = parsed.data.levels;
    if (levels.length > 0 && levels.length !== parsed.data.clips.length) {
      res.status(400).json({
        error: `Custom mix needs one level per clip (${parsed.data.clips.length}), got ${levels.length}.`,
      });
    }
  }

  /* 402 pre-check before charging */
  if ((req.userCredits ?? 0) < SPLIT_SCREEN_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, SPLIT_SCREEN_COST, {
      action: `Split-Screen Grid (${parsed.data.layout})`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const job: SplitScreenJob = {
    id: randomUUID(),
    userId: req.userId!,
    state: "queued",
    stage: "queued",
    progress: 0,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);

  const input: ApplyInput = {
    ...parsed.data,
    /* Normalize hex to always carry a leading # for the UI echo. */
    borderColor: parsed.data.borderColor.startsWith("#") ? parsed.data.borderColor : `#${parsed.data.borderColor}`,
    backgroundColor: parsed.data.backgroundColor.startsWith("#")
      ? parsed.data.backgroundColor
      : `#${parsed.data.backgroundColor}`,
  };
  renderQueue.push(() => renderSplitScreen(job, input));
  pumpQueue();

  res.status(202).json({
    jobId: job.id,
    state: job.state,
    price: SPLIT_SCREEN_COST,
    creditsRemaining: creditsAfter,
  });
});

router.get("/split-screen/job/:jobId", requireAuth, (req, res) => {
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
