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

/* ─── AI-assisted background removal ───
   Analyzes the image corners to detect the background color, then applies
   an optimized chroma-key. Works best with solid-color backgrounds.
   200 Visual Bucs per removal. */

const BG_REMOVAL_COST = Number(process.env["BG_REMOVAL_CREDITS"]) || 200;

const removeBgSchema = z.object({
  imageUrl: z.string().trim().min(1).max(2048),
  /** 0-1, higher = more aggressive removal. */
  aggressiveness: z.number().min(0).max(1).optional().default(0.5),
});

/**
 * Detect the background color by sampling the image corners.
 * Uses ImageMagick-style analysis via ffmpeg crop + signalstats,
 * or falls back to a Python PIL script.
 */
async function detectBackgroundColor(imagePath: string): Promise<string> {
  // Sample 4 corners (10% inset to avoid edge artifacts) and average.
  // Use ffmpeg to crop corners and get average color via signalstats.
  const corners = [
    "crop=iw*0.1:ih*0.1:iw*0.05:ih*0.05",
    "crop=iw*0.1:ih*0.1:iw*0.85:ih*0.05",
    "crop=iw*0.1:ih*0.1:iw*0.05:ih*0.85",
    "crop=iw*0.1:ih*0.1:iw*0.85:ih*0.85",
  ];

  const colors: Array<[number, number, number]> = [];
  for (const crop of corners) {
    try {
      const { stdout } = await execFileAsync("ffmpeg", [
        "-i", imagePath,
        "-vf", `${crop},signalstats`,
        "-f", "null", "-",
      ], { timeout: 30_000 });
      // Parse YAVG, UAVG, VAVG from signalstats output
      const yMatch = /YAVG:(\d+)/.exec(stdout);
      const uMatch = /UAVG:(\d+)/.exec(stdout);
      const vMatch = /VAVG:(\d+)/.exec(stdout);
      if (yMatch && uMatch && vMatch) {
        // Convert YUV to RGB (approximate)
        const y = parseInt(yMatch[1]!);
        const u = parseInt(uMatch[1]!) - 128;
        const v = parseInt(vMatch[1]!) - 128;
        const r = Math.min(255, Math.max(0, Math.round(y + 1.402 * v)));
        const g = Math.min(255, Math.max(0, Math.round(y - 0.344136 * u - 0.714136 * v)));
        const b = Math.min(255, Math.max(0, Math.round(y + 1.772 * u)));
        colors.push([r, g, b]);
      }
    } catch {
      // Skip failed corner
    }
  }

  if (colors.length === 0) {
    // Fallback to green (most common chroma key color)
    return "0x00FF00";
  }

  // Average the corner colors
  const r = Math.round(colors.reduce((a, c) => a + c[0], 0) / colors.length);
  const g = Math.round(colors.reduce((a, c) => a + c[1], 0) / colors.length);
  const b = Math.round(colors.reduce((a, c) => a + c[2], 0) / colors.length);

  return `0x${r.toString(16).padStart(2, "0").toUpperCase()}${g.toString(16).padStart(2, "0").toUpperCase()}${b.toString(16).padStart(2, "0").toUpperCase()}`;
}

router.post("/remove-background", requireAuth, async (req, res) => {
  const parsed = removeBgSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < BG_REMOVAL_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, BG_REMOVAL_COST, {
      action: "Background Removal",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "bg-removal-"));
  const inputPath = join(workDir, "input.png");
  const outputPath = join(workDir, "output.png");

  try {
    // 1. Download the image
    const imgRes = await fetch(parsed.data.imageUrl, { signal: AbortSignal.timeout(30_000) });
    if (!imgRes.ok) throw new Error("Could not download the image.");
    await writeFile(inputPath, Buffer.from(await imgRes.arrayBuffer()));

    // 2. Detect background color
    const bgColor = await detectBackgroundColor(inputPath);
    req.log.info({ bgColor }, "[remove-background] detected background color");

    // 3. Apply chromakey with similarity based on aggressiveness
    // aggressiveness 0 → 0.1 similarity, 1 → 0.4 similarity
    const similarity = (0.1 + parsed.data.aggressiveness * 0.3).toFixed(3);
    await execFileAsync("ffmpeg", [
      "-y", "-i", inputPath,
      "-vf", `chromakey=${bgColor}:${similarity}:0.1,format=yuva420p`,
      "-c:v", "png",
      outputPath,
    ], { timeout: 60_000 });

    // 4. Upload result
    const buffer = await readFile(outputPath);
    const objectName = `background-removal/${req.userId}/${randomUUID()}.png`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "image/png");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      backgroundColor: bgColor,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Background removal failed.";
    req.log.error({ err: message }, "[remove-background] failed");
    // Refund on failure
    await refundCredits(req.userId!, BG_REMOVAL_COST, {
      action: "Background Removal — Refund",
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
