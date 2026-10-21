import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, mkdtemp } from "fs/promises";
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

/* ─── Aspect ratio converter ───
   Reframes a video to a target aspect ratio (16:9, 9:16, 1:1, 4:5) with
   "smart padding": the full frame is scaled to fit inside the target canvas
   and centered over a blurred full-bleed copy of itself — nothing gets
   cropped, and the edges look intentional (TikTok/Reels-style blur fill).
   150 Visual Bucs per conversion. */

const CONVERT_COST = Number(process.env["ASPECT_CONVERT_CREDITS"]) || 150;

const RATIO_PRESETS = {
  "16:9": { width: 1280, height: 720, label: "Landscape", blurb: "YouTube, TV, widescreen players" },
  "9:16": { width: 720, height: 1280, label: "Vertical", blurb: "TikTok, Reels, Shorts" },
  "1:1": { width: 1080, height: 1080, label: "Square", blurb: "Instagram feed posts" },
  "4:5": { width: 1080, height: 1350, label: "Portrait", blurb: "Instagram/Facebook portrait feed" },
} as const;

type RatioKey = keyof typeof RATIO_PRESETS;

const convertSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  ratio: z.string().refine((v): v is RatioKey => v in RATIO_PRESETS, {
    message: `ratio must be one of: ${Object.keys(RATIO_PRESETS).join(", ")}`,
  }),
  blur: z.number().int().min(0).max(60).optional().default(20),
});

router.get("/aspect-ratios", requireAuth, (_req, res) => {
  res.json({
    ratios: Object.entries(RATIO_PRESETS).map(([key, v]) => ({
      key,
      width: v.width,
      height: v.height,
      label: v.label,
      blurb: v.blurb,
    })),
  });
});

router.post("/convert-aspect", requireAuth, async (req, res) => {
  const parsed = convertSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < CONVERT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, CONVERT_COST, {
      action: "Aspect Ratio Convert",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "aspect-"));
  const inputPath = join(workDir, "input.mp4");
  const outputPath = join(workDir, "converted.mp4");

  try {
    const vidRes = await fetch(parsed.data.videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!vidRes.ok) throw new Error("Could not download the video.");
    await writeFile(inputPath, Buffer.from(await vidRes.arrayBuffer()));

    const { width, height } = RATIO_PRESETS[parsed.data.ratio];
    const blurAmount = parsed.data.blur;

    // Smart padding: blurred full-bleed background from the same frame
    // + the source scaled to FIT inside the target canvas, centered.
    const filterComplex =
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
      `crop=${width}:${height},boxblur=${blurAmount}:1[bg];` +
      `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,format=rgba[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2`;

    await execFileAsync("ffmpeg", [
      "-y", "-i", inputPath,
      "-filter_complex", filterComplex,
      "-c:v", "libx264", "-preset", "fast", "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      outputPath,
    ], { timeout: 600_000 });

    const buffer = await readFile(outputPath);
    const objectName = `aspect/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      ratio: parsed.data.ratio,
      width,
      height,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Aspect conversion failed.";
    req.log.error({ err: message }, "[aspect-convert] failed");
    await refundCredits(req.userId!, CONVERT_COST, {
      action: "Aspect Ratio Convert — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
