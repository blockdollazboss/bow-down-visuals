import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, rm, mkdtemp } from "fs/promises";
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

/* ─── Reaction video maker ───
   Composites a webcam reaction video as a picture-in-picture overlay over a
   main video. Corner position and inset size are customizable; audio can come
   from the main video, the reaction, or a mix of both.
   250 Visual Bucs per video. */

const REACTION_VIDEO_COST = Number(process.env["REACTION_VIDEO_CREDITS"]) || 250;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MB

const POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;
const AUDIO_SOURCES = ["main", "reaction", "both"] as const;

const reactionSchema = z.object({
  /** Main video URL (full frame). */
  videoUrl: z.string().trim().min(1).max(2048),
  /** Webcam reaction video URL (picture-in-picture). */
  reactionUrl: z.string().trim().min(1).max(2048),
  /** Which corner the reaction sits in. */
  position: z.enum(POSITIONS).optional().default("bottom-right"),
  /** Reaction width as a fraction of main video width (0.1 - 0.5). */
  size: z.number().min(0.1).max(0.5).optional().default(0.25),
  /** Margin in pixels from the frame edges. */
  margin: z.number().int().min(0).max(200).optional().default(16),
  /** Border width in pixels around the reaction inset (0 = none). */
  borderWidth: z.number().int().min(0).max(20).optional().default(4),
  /** Border color, 6-digit hex. */
  borderColor: z
    .string()
    .trim()
    .regex(/^#?[0-9a-fA-F]{6}$/, "Must be a 6-digit hex color.")
    .optional()
    .default("#C9A84C"),
  /** Which audio track to keep. */
  audioSource: z.enum(AUDIO_SOURCES).optional().default("both"),
});

async function probeDimensions(videoPath: string): Promise<{ width: number; height: number }> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=p=0",
      videoPath,
    ],
    { timeout: 30_000 }
  );
  const [w, h] = stdout.trim().split(",").map(Number);
  if (!w || !h) throw new Error("Could not determine video dimensions.");
  return { width: w, height: h };
}

router.post("/reaction-video", requireAuth, async (req, res) => {
  const parsed = reactionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const { videoUrl, reactionUrl, position, size, margin, borderWidth, borderColor, audioSource } =
    parsed.data;

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < REACTION_VIDEO_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, REACTION_VIDEO_COST, {
      action: "Reaction Video",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "reaction-video-"));
  const mainPath = join(workDir, "main.mp4");
  const reactPath = join(workDir, "reaction.mp4");
  const outputPath = join(workDir, "output.mp4");

  async function download(url: string, dest: string, label: string): Promise<void> {
    const resp = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!resp.ok) throw new Error(`Could not download the ${label} video.`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    if (buffer.length > MAX_VIDEO_BYTES) {
      throw new Error(`${label} video exceeds the 100 MB limit.`);
    }
    await writeFile(dest, buffer);
  }

  try {
    await download(videoUrl, mainPath, "main");
    await download(reactionUrl, reactPath, "reaction");

    const { width, height } = await probeDimensions(mainPath);
    const reactW = Math.round(width * size);
    const reactH = Math.round((reactW * 9) / 16); // keep a 16:9 webcam box
    const border = borderWidth;
    const hex = borderColor.replace("#", "").toUpperCase();

    const x = position.includes("left") ? margin : `W-w-${margin}`;
    const y = position.includes("top") ? margin : `H-h-${margin}`;

    const baseVideoChain =
      `[1:v]scale=${reactW}:${reactH}:force_original_aspect_ratio=decrease,` +
      `pad=${reactW}:${reactH}:(ow-iw)/2:(oh-ih)/2:color=black,` +
      `pad=${reactW + border * 2}:${reactH + border * 2}:${border}:${border}:color=0x${hex},` +
      `format=yuv420p[react];` +
      `[0:v][react]overlay=${x}:${y}:format=auto,format=yuv420p[v]`;

    const filterComplex =
      audioSource === "both"
        ? `${baseVideoChain};[0:a][1:a]amix=inputs=2:duration=shortest:dropout_transition=2[a]`
        : baseVideoChain;

    const ffmpegArgs: string[] = [
      "-y",
      "-i", mainPath,
      "-i", reactPath,
      "-filter_complex", filterComplex,
      "-map", "[v]",
    ];

    if (audioSource === "main") {
      ffmpegArgs.push("-map", "0:a?");
    } else if (audioSource === "reaction") {
      ffmpegArgs.push("-map", "1:a?");
    } else {
      ffmpegArgs.push("-map", "[a]");
    }

    const finalArgs = ffmpegArgs;

    finalArgs.push(
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      "-c:a", "aac", "-b:a", "160k",
      "-shortest",
      "-movflags", "+faststart",
      outputPath,
    );

    req.log.info(
      { width, height, reactW, reactH, position, size, audioSource },
      "[reaction-video] starting composite"
    );

    await execFileAsync("ffmpeg", finalArgs, { timeout: 300_000 }); // 5 min

    const buffer = await readFile(outputPath);
    const objectName = `reaction-video/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      position,
      size,
      audioSource,
      mainDimensions: { width, height },
      reactionDimensions: { width: reactW, height: reactH },
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Reaction video creation failed.";
    req.log.error({ err: message }, "[reaction-video] failed");
    await refundCredits(req.userId!, REACTION_VIDEO_COST, {
      action: "Reaction Video — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

router.get("/reaction-video/options", (_req, res) => {
  res.json({
    positions: POSITIONS.map((p) => ({
      value: p,
      label: p.split("-").map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" "),
    })),
    audioSources: AUDIO_SOURCES.map((a) => ({ value: a, label: a[0]!.toUpperCase() + a.slice(1) })),
    sizeRange: { min: 0.1, max: 0.5, default: 0.25 },
    price: REACTION_VIDEO_COST,
  });
});

export default router;
