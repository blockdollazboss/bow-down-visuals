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

/* ─── Video watermark adder ───
   Overlays a watermark image (logo, badge, text plate) onto a video at one of
   five positions. 100 Visual Bucs. */

const WATERMARK_COST = Number(process.env["WATERMARK_CREDITS"]) || 100;

const POSITIONS = {
  "top-left": "x=MARGIN:y=MARGIN",
  "top-right": "x=W-w-MARGIN:y=MARGIN",
  "bottom-left": "x=MARGIN:y=H-h-MARGIN",
  "bottom-right": "x=W-w-MARGIN:y=H-h-MARGIN",
  center: "x=(W-w)/2:y=(H-h)/2",
} as const;

type WatermarkPosition = keyof typeof POSITIONS;

const watermarkSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  watermarkUrl: z.string().trim().min(1).max(2048),
  position: z
    .string()
    .refine((v): v is WatermarkPosition => v in POSITIONS, {
      message: `Position must be one of: ${Object.keys(POSITIONS).join(", ")}`,
    }),
  /** Watermark width as a fraction of video width (0.05–0.5). Default 0.15. */
  scale: z.number().min(0.05).max(0.5).optional().default(0.15),
  /** Watermark opacity (0–1). Default 1 (fully opaque). */
  opacity: z.number().min(0).max(1).optional().default(1),
  /** Margin in px from the edges for corner positions. Default 16. */
  margin: z.number().int().min(0).max(200).optional().default(16),
});

router.get("/watermark-positions", requireAuth, (_req, res) => {
  res.json({
    positions: Object.keys(POSITIONS),
    defaults: { scale: 0.15, opacity: 1, margin: 16 },
  });
});

async function probeVideoWidth(inputPath: string): Promise<number> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width", "-of", "default=nw=1:nk=1", inputPath],
    { timeout: 30_000 },
  );
  const w = parseInt(stdout.trim(), 10);
  if (!Number.isFinite(w) || w <= 0) throw new Error("Could not read video dimensions.");
  return w;
}

router.post("/add-watermark", requireAuth, async (req, res) => {
  const parsed = watermarkSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < WATERMARK_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, WATERMARK_COST, {
      action: "Video Watermark",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "watermark-"));
  const inputPath = join(workDir, "input.mp4");
  const wmPath = join(workDir, "wm.png");
  const outputPath = join(workDir, "output.mp4");

  try {
    const vidRes = await fetch(parsed.data.videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!vidRes.ok) throw new Error("Could not download the video.");
    await writeFile(inputPath, Buffer.from(await vidRes.arrayBuffer()));

    const wmRes = await fetch(parsed.data.watermarkUrl, { signal: AbortSignal.timeout(120_000) });
    if (!wmRes.ok) throw new Error("Could not download the watermark image.");
    await writeFile(wmPath, Buffer.from(await wmRes.arrayBuffer()));

    const videoWidth = await probeVideoWidth(inputPath);
    const wmWidth = Math.max(8, Math.round(videoWidth * parsed.data.scale));
    const margin = parsed.data.margin;
    const overlayXY = POSITIONS[parsed.data.position].replaceAll("MARGIN", String(margin));

    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-i", inputPath,
        "-loop", "1", "-i", wmPath,
        "-filter_complex",
        `[1:v]format=rgba,scale=${wmWidth}:-1,colorchannelmixer=aa=${parsed.data.opacity}[wm];` +
          `[0:v][wm]overlay=${overlayXY}:format=auto,format=yuv420p[out]`,
        "-map", "[out]",
        "-map", "0:a?",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-shortest",
        outputPath,
      ],
      { timeout: 300_000 },
    );

    const buffer = await readFile(outputPath);
    const objectName = `watermark/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      position: parsed.data.position,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Watermark failed.";
    req.log.error({ err: message }, "[add-watermark] failed");
    await refundCredits(req.userId!, WATERMARK_COST, {
      action: "Watermark — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(wmPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
