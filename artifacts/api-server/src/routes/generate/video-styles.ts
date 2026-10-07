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

/* ─── AI video style effects ───
   Applies artistic styles to video using ffmpeg filter chains.
   300 Visual Bucs per stylization. */

const STYLE_FX_COST = Number(process.env["STYLE_FX_CREDITS"]) || 300;

const VIDEO_STYLES = {
  anime: {
    label: "Anime",
    blurb: "Bold lines, flat colors — Japanese animation look",
    filter: "edgedetect=low=0.1:high=0.4,format=gray,geq=lum='p(X,Y)',hue=s=0",
  },
  oilpaint: {
    label: "Oil Painting",
    blurb: "Textured brush strokes",
    filter: "smartblur=lr=1.5:ls=-0.5:lt=-10,unsharp=5:5:1.0",
  },
  vintage: {
    label: "Vintage Film",
    blurb: "Aged film with grain and warmth",
    filter: "curves=vintage,noise=alls=8:allf=t,hue=s=0.8",
  },
  neon: {
    label: "Neon Glow",
    blurb: "Electric edges and vibrant glow",
    filter: "edgedetect,negate,hue=h=180",
  },
  noir: {
    label: "Film Noir",
    blurb: "High-contrast black and white",
    filter: "format=gray,eq=contrast=1.5:brightness=-0.1",
  },
  dreamy: {
    label: "Dreamy",
    blurb: "Soft glow and pastel haze",
    filter: "gblur=sigma=2,eq=saturation=1.3:brightness=0.1",
  },
} as const;

type VideoStyleKey = keyof typeof VIDEO_STYLES;

const styleFxSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  style: z.string().refine((v): v is VideoStyleKey => v in VIDEO_STYLES, {
    message: `Style must be one of: ${Object.keys(VIDEO_STYLES).join(", ")}`,
  }),
});

router.get("/video-styles", requireAuth, (_req, res) => {
  res.json({
    styles: Object.entries(VIDEO_STYLES).map(([key, v]) => ({
      key,
      label: v.label,
      blurb: v.blurb,
    })),
  });
});

router.post("/video-style", requireAuth, async (req, res) => {
  const parsed = styleFxSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < STYLE_FX_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, STYLE_FX_COST, {
      action: `Video Style (${parsed.data.style})`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "video-style-"));
  const inputPath = join(workDir, "input.mp4");
  const outputPath = join(workDir, "output.mp4");

  try {
    const vidRes = await fetch(parsed.data.videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!vidRes.ok) throw new Error("Could not download the video.");
    await writeFile(inputPath, Buffer.from(await vidRes.arrayBuffer()));

    const style = VIDEO_STYLES[parsed.data.style];
    await execFileAsync("ffmpeg", [
      "-y", "-i", inputPath,
      "-vf", style.filter,
      "-c:v", "libx264", "-preset", "fast", "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      outputPath,
    ], { timeout: 300_000 });

    const buffer = await readFile(outputPath);
    const objectName = `video-style/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      style: parsed.data.style,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Video styling failed.";
    req.log.error({ err: message }, "[video-style] failed");
    await refundCredits(req.userId!, STYLE_FX_COST, {
      action: "Video Style — Refund",
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
