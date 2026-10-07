import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, mkdtemp, rm } from "fs/promises";
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

/* ─── AI video color grader ───
   Applies cinematic color grades to video via ffmpeg (eq, curves,
   colorbalance). 150 Visual Bucs per grade. */

const GRADE_COST = Number(process.env["COLOR_GRADE_CREDITS"]) || 150;

const COLOR_PRESETS = {
  cinematic: {
    label: "Cinematic",
    blurb: "Crushed blacks, lifted filmic contrast — the movie look",
    vf: "curves=m='0/0.05 0.25/0.22 0.5/0.52 0.75/0.78 1/0.95',eq=contrast=1.12:saturation=0.95,colorbalance=bs=-0.06:bm=-0.03:rs=0.04:rm=0.02",
  },
  vibrant: {
    label: "Vibrant",
    blurb: "Punchy saturation and contrast — pops on social feeds",
    vf: "eq=contrast=1.15:brightness=0.03:saturation=1.45",
  },
  vintage: {
    label: "Vintage",
    blurb: "Faded warm film look with a sepia wash",
    vf: "eq=contrast=0.92:brightness=0.04:saturation=0.65,colorbalance=rs=0.12:gs=0.06:bs=-0.10:rm=0.08:gm=0.04:bm=-0.06",
  },
  noir: {
    label: "Noir",
    blurb: "High-contrast black & white — dramatic monochrome",
    vf: "hue=s=0,eq=contrast=1.25:brightness=-0.02",
  },
  warm: {
    label: "Warm",
    blurb: "Cozy golden warmth — flattering skin tones",
    vf: "colorbalance=rs=0.10:gs=0.05:bs=-0.08:rm=0.06:gm=0.03:bm=-0.05,eq=saturation=1.08",
  },
  cool: {
    label: "Cool",
    blurb: "Crisp icy blue tint — modern tech aesthetic",
    vf: "colorbalance=rs=-0.08:gs=-0.03:bs=0.10:rm=-0.05:gm=-0.02:bm=0.07,eq=saturation=1.05",
  },
  teal_orange: {
    label: "Teal & Orange",
    blurb: "The Hollywood blockbuster grade — warm skin, teal shadows",
    vf: "colorbalance=bs=0.12:bm=0.08:bh=0.06:rs=0.08:rm=0.05:rh=0.03,eq=contrast=1.08:saturation=1.15",
  },
  golden_hour: {
    label: "Golden Hour",
    blurb: "Sunset glow — honeyed highlights and amber mids",
    vf: "colorbalance=rh=0.12:gh=0.06:bh=-0.06:rm=0.07:gm=0.03:bm=-0.04,eq=brightness=0.05:saturation=1.18:contrast=1.05",
  },
} as const;

type ColorPresetKey = keyof typeof COLOR_PRESETS;

const gradeSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  preset: z.string().refine((v): v is ColorPresetKey => v in COLOR_PRESETS, {
    message: `Preset must be one of: ${Object.keys(COLOR_PRESETS).join(", ")}`,
  }),
});

router.get("/color-presets", requireAuth, (_req, res) => {
  res.json({
    presets: Object.entries(COLOR_PRESETS).map(([key, v]) => ({
      key,
      label: v.label,
      blurb: v.blurb,
    })),
  });
});

router.post("/color-grade", requireAuth, async (req, res) => {
  const parsed = gradeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < GRADE_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, GRADE_COST, {
      action: `Color grade (${parsed.data.preset})`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "colorgrade-"));
  const inputPath = join(workDir, "input.mp4");
  const outputPath = join(workDir, "output.mp4");

  try {
    const vidRes = await fetch(parsed.data.videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!vidRes.ok) throw new Error("Could not download the video.");
    await writeFile(inputPath, Buffer.from(await vidRes.arrayBuffer()));

    const preset = COLOR_PRESETS[parsed.data.preset];

    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-i",
        inputPath,
        "-vf",
        preset.vf,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "copy",
        outputPath,
      ],
      { timeout: 300_000 },
    );

    const buffer = await readFile(outputPath);
    const objectName = `colorgrade/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      preset: parsed.data.preset,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Color grading failed.";
    req.log.error({ err: message }, "[color-grade] failed");
    await refundCredits(req.userId!, GRADE_COST, {
      action: "Color grade — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
