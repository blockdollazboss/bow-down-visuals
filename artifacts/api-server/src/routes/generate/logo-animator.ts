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

/* ─── AI logo animator ───
   Turns a static logo into a 3-second animated logo sting
   (fade-in, slide-up, spin, pulse, glitch). 200 Visual Bucs. */

const LOGO_ANIMATOR_COST = Number(process.env["LOGO_ANIMATOR_CREDITS"]) || 200;
const STING_DURATION = 3;
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const LOGO_TARGET_W = 800;

const ANIMATION_STYLES = {
  "fade-in": {
    label: "Fade In",
    blurb: "Elegant fade in, hold, fade out",
    logoChain: "fade=t=in:st=0:d=1:alpha=1",
    x: "(W-w)/2",
    y: "(H-h)/2",
    tail: "fade=t=out:st=2:d=1",
  },
  "slide-up": {
    label: "Slide Up",
    blurb: "Slides up into frame, settles in the center",
    logoChain: "",
    x: "(W-w)/2",
    // Starts fully below the frame (y=H), settles centered by t=1.
    y: "'H-(H-(H-h)/2)*min(t\\,1)'",
    tail: "fade=t=in:st=0:d=0.5,fade=t=out:st=2:d=1",
  },
  spin: {
    label: "Spin",
    blurb: "Full 360° spin-in, holds steady",
    logoChain: "rotate=a='2*PI*t/1.5':fillcolor=black@0",
    x: "(W-w)/2",
    y: "(H-h)/2",
    tail: "fade=t=in:st=0:d=0.3,fade=t=out:st=2:d=1",
  },
  pulse: {
    label: "Pulse",
    blurb: "Breathing scale pulse",
    logoChain: "scale=w='800*(1+0.08*sin(2*PI*t))':h=-1:eval=frame",
    x: "(W-w)/2",
    y: "(H-h)/2",
    tail: "fade=t=in:st=0:d=0.5,fade=t=out:st=2:d=1",
  },
  glitch: {
    label: "Glitch",
    blurb: "Digital glitch bursts with jitter and grain",
    logoChain:
      "pad=iw:ih+24:0:12:black,crop=iw:ih:x='12*random(1)':y='24*random(1)',noise=alls=16:allf=t,eq=brightness='0.15*sin(28*PI*t)':saturation='1+0.6*gt(mod(t\\,0.75)\\,0.7)'",
    x: "(W-w)/2",
    y: "(H-h)/2",
    tail: "fade=t=in:st=0:d=0.5,fade=t=out:st=2:d=1",
  },
} as const;

type AnimationStyle = keyof typeof ANIMATION_STYLES;

const logoAnimatorSchema = z.object({
  logoUrl: z.string().trim().min(1).max(2048),
  style: z
    .string()
    .refine((v): v is AnimationStyle => v in ANIMATION_STYLES, {
      message: `Style must be one of: ${Object.keys(ANIMATION_STYLES).join(", ")}`,
    })
    .optional()
    .default("fade-in"),
  /** 6-digit hex background color, e.g. "0a0a0a". Defaults to black. */
  backgroundColor: z
    .string()
    .trim()
    .regex(/^#?[0-9a-fA-F]{6}$/, "backgroundColor must be a 6-digit hex color")
    .optional()
    .default("000000"),
});

router.get("/logo-animations", requireAuth, (_req, res) => {
  res.json({
    styles: Object.entries(ANIMATION_STYLES).map(([key, v]) => ({
      key,
      label: v.label,
      blurb: v.blurb,
    })),
  });
});

router.post("/animate-logo", requireAuth, async (req, res) => {
  const parsed = logoAnimatorSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < LOGO_ANIMATOR_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, LOGO_ANIMATOR_COST, {
      action: `Logo Animator (${parsed.data.style})`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "logo-anim-"));
  const inputPath = join(workDir, "logo.png");
  const outputPath = join(workDir, "sting.mp4");

  try {
    const logoRes = await fetch(parsed.data.logoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!logoRes.ok) throw new Error("Could not download the logo.");
    await writeFile(inputPath, Buffer.from(await logoRes.arrayBuffer()));

    const style = ANIMATION_STYLES[parsed.data.style];
    const bgColor = parsed.data.backgroundColor.replace(/^#/, "").toLowerCase();

    // Scale the logo to a target width (pulse scales dynamically instead).
    const logoScale =
      parsed.data.style === "pulse" ? "" : `scale=${LOGO_TARGET_W}:-1,`;
    const logoChain = style.logoChain ? `,${style.logoChain}` : "";

    const filterComplex =
      `[1:v]${logoScale}format=rgba${logoChain}[logo];` +
      `[0:v][logo]overlay=x=${style.x}:y=${style.y},` +
      `${style.tail},format=yuv420p[v]`;

    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-f", "lavfi",
        "-i", `color=c=0x${bgColor}:s=${WIDTH}x${HEIGHT}:d=${STING_DURATION}:r=${FPS}`,
        "-loop", "1",
        "-framerate", String(FPS),
        "-i", inputPath,
        "-filter_complex", filterComplex,
        "-map", "[v]",
        "-t", String(STING_DURATION),
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        outputPath,
      ],
      { timeout: 300_000 }
    );

    const buffer = await readFile(outputPath);
    const objectName = `logo-animator/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      style: parsed.data.style,
      durationSec: STING_DURATION,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Logo animation failed.";
    req.log.error({ err: message }, "[animate-logo] failed");
    await refundCredits(req.userId!, LOGO_ANIMATOR_COST, {
      action: "Logo Animator — Refund",
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
