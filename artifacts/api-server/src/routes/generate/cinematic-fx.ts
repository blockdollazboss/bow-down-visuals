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

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── True burned-in Cinematic FX ────────────────────────────────────────────
 * CapCut parity for the Video Editor Effects tab: the CSS-preview effects
 * "VHS" / "Cinematic Bars" / "Camera Shake" were approximations only (a dim,
 * a brightness tweak) — this endpoint burns the REAL thing into the video
 * with pure ffmpeg (no paid providers):
 *   - True Camera Shake: crop-wobble with randomized translate, scaled back
 *     to the original resolution (NOT a brightness tweak).
 *   - True Letterbox Cinematic Bars: real black bars (drawbox), not dimming.
 *   - True VHS: noise + scanlines + tracking-line wobble + chromatic
 *     aberration. Scanlines/tracking-line are pre-rendered overlay PNGs
 *     animated with a per-frame overlay y-expression — a per-frame geq would
 *     be ~70x realtime at 1080p and blow the render budget.
 *   - Film Grain: animated temporal noise overlay.
 * 150 Visual Bucs per render: 402 pre-check → charge → auto-refund on failure.
 */

export const CINEMATIC_FX_EFFECTS = [
  "True Camera Shake",
  "True Letterbox Cinematic Bars",
  "True VHS",
  "Film Grain",
] as const;
export type CinematicFxEffect = (typeof CINEMATIC_FX_EFFECTS)[number];

const CINEMATIC_FX_COST = Number(process.env["CINEMATIC_FX_CREDITS"]) || 150;
const FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const ATTRIBUTION_TEXT = "Made with Bow Down Visuals";

/** Escape text for ffmpeg drawtext. */
function escapeDrawtext(t: string): string {
  return t
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "%%");
}

const cinematicFxSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  effects: z.array(z.enum(CINEMATIC_FX_EFFECTS)).min(1).max(4),
  /** 10–100: shake amplitude, grain/noise amount, CA shift. */
  intensity: z.number().int().min(10).max(100).optional().default(60),
  /** Burn the "Made with Bow Down Visuals" tag — free. */
  attribution: z.boolean().optional().default(false),
});

export interface CinematicFxChainPlan {
  /** Filter chain applied to the main video input ([0:v] … [vfx]). */
  mainChain: string;
  /** True when the VHS scanline overlay input is required. */
  needsScanlines: boolean;
  /** True when the VHS tracking-line overlay input is required. */
  needsTrackline: boolean;
}

/**
 * Build the ffmpeg filter pieces for a set of cinematic FX at a given
 * intensity (10–100). Pure function — unit-tested.
 *
 * `dims` (probed input size): when provided and shake is selected, an exact
 * `scale=W:H` is appended so the output resolution is bit-identical to the
 * input (the upscale-then-crop shake is self-normalizing to ±2px).
 */
export function buildCinematicFxChains(
  effects: CinematicFxEffect[],
  intensity: number,
  dims?: { w: number; h: number },
): CinematicFxChainPlan {
  const I = Math.min(100, Math.max(10, intensity)) / 100;
  const f = (n: number) => n.toFixed(4);
  const chain: string[] = [];
  let needsScanlines = false;
  let needsTrackline = false;

  if (effects.includes("True Camera Shake")) {
    // Upscale slightly, then wobble the crop window with layered sine
    // jitter (handheld feel). The crop window is exactly 1/U of the
    // upscaled frame, so the output size is preserved without needing to
    // know the input dimensions (upscale-then-crop is self-normalizing).
    const m = 1 - 0.06 * I; // crop fraction (keeps edges safe)
    const U = 1 / m; // upscale factor
    const a = 0.02 * I; // primary amplitude (fraction of frame)
    const a2 = 0.006 * I; // high-frequency jitter amplitude
    chain.push(
      `scale=iw*${f(U)}:ih*${f(U)}` +
        `,crop=w=iw/${f(U)}:h=ih/${f(U)}` +
        `:x=(iw-iw/${f(U)})/2+sin(n*0.9)*iw*${f(a)}+sin(n*2.7)*iw*${f(a2)}` +
        `:y=(ih-ih/${f(U)})/2+cos(n*0.7)*ih*${f(a)}+cos(n*2.1)*ih*${f(a2)}`,
    );
    if (dims) chain.push(`scale=${dims.w}:${dims.h}`);
  }

  if (effects.includes("True VHS")) {
    // VHS color: crushed chroma, lifted contrast, slight hue drift.
    chain.push("eq=saturation=0.8:contrast=1.12:brightness=-0.04", "hue=h=8");
    // Chromatic aberration: shift red right, blue left.
    const ca = Math.round(1 + 3 * I);
    chain.push(`rgbashift=rh=${ca}:gh=0:bh=-${ca}`);
    // Tape noise.
    chain.push(`noise=alls=${Math.round(5 + 6 * I)}:allf=t`);
    needsScanlines = true;
    needsTrackline = true;
  }

  if (effects.includes("Film Grain")) {
    chain.push(
      `noise=alls=${Math.round(3 + 8 * I)}:allf=t`,
      "eq=contrast=1.08:brightness=-0.015",
    );
  }

  if (effects.includes("True Letterbox Cinematic Bars")) {
    // Real black bars: 12.5% top + 12.5% bottom (≈2.35:1 inner frame).
    chain.push(
      "drawbox=x=0:y=0:w=iw:h=ih*0.125:c=black:t=fill",
      "drawbox=x=0:y=ih-ih*0.125:w=iw:h=ih*0.125:c=black:t=fill",
    );
  }

  return { mainChain: chain.join(","), needsScanlines, needsTrackline };
}

/** Assemble the full -filter_complex given the plan and overlay input labels. */
export function buildCinematicFxFilterComplex(
  plan: CinematicFxChainPlan,
  opts: {
    attribution: boolean;
    attributionFontSize: number;
    scanLabel: string;
    trackLabel: string;
  },
): string {
  const parts: string[] = [];
  let main = plan.mainChain ? `[0:v]${plan.mainChain}` : "[0:v]copy";
  if (opts.attribution) {
    main +=
      `,drawtext=fontfile='${FONT_PATH}'` +
      `:text='${escapeDrawtext(ATTRIBUTION_TEXT)}'` +
      `:fontsize=${opts.attributionFontSize}` +
      `:fontcolor=white@0.8:borderw=1:bordercolor=black@0.55` +
      `:x=(w-text_w)/2:y=h-text_h-h*0.05`;
  }
  main += "[vfx]";
  parts.push(main);
  let cur = "vfx";
  if (plan.needsScanlines) {
    parts.push(`[${cur}]${opts.scanLabel}overlay=0:0:format=yuv420:shortest=1[vscan]`);
    cur = "vscan";
  }
  if (plan.needsTrackline) {
    // Tracking band sweeps top→bottom ~120px/s, looping forever.
    parts.push(
      `[${cur}]${opts.trackLabel}overlay=0:'mod(t*120\\,main_h)':format=yuv420:shortest=1[vout]`,
    );
    cur = "vout";
  } else {
    parts.push(`[${cur}]copy[vout]`);
  }
  return parts.join(";");
}

async function probeDimensions(path: string): Promise<{ w: number; h: number }> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-hide_banner",
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height",
    "-of",
    "csv=p=0",
    path,
  ]);
  const [w, h] = stdout.trim().split(",").map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    throw new Error("Could not read the video's dimensions.");
  }
  return { w, h };
}

/** Generate a static scanline overlay PNG (dark line every 3rd row). */
async function makeScanlineOverlay(w: number, h: number, outPath: string): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${w}x${h}:d=0.04`,
    "-vf",
    "format=rgba,geq=r=0:g=0:b=0:a='if(mod(Y,3),70,0)'",
    "-frames:v",
    "1",
    outPath,
  ]);
}

/** Generate a thin translucent white bar PNG for the tracking-line sweep. */
async function makeTracklineOverlay(w: number, outPath: string): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=white:s=${w}x6:d=0.04`,
    "-vf",
    "format=rgba,colorchannelmixer=aa=0.22",
    "-frames:v",
    "1",
    outPath,
  ]);
}

router.post("/cinematic-fx", requireAuth, async (req, res) => {
  const parsed = cinematicFxSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { videoUrl, effects, intensity, attribution } = parsed.data;

  if ((req.userCredits ?? 0) < CINEMATIC_FX_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, CINEMATIC_FX_COST, {
      action: "Cinematic FX Render",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "cinematic-fx-"));
  const inputPath = join(workDir, "input.mp4");
  const scanPath = join(workDir, "scanlines.png");
  const trackPath = join(workDir, "trackline.png");
  const outputPath = join(workDir, "output.mp4");

  try {
    const vidRes = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!vidRes.ok) throw new Error("Could not download the video.");
    await writeFile(inputPath, Buffer.from(await vidRes.arrayBuffer()));

    const plan = buildCinematicFxChains(effects, intensity);

    // Dimensions drive the scanline overlay size, the attribution font size,
    // and the exact output-size restore after the shake wobble.
    const { w, h } = await probeDimensions(inputPath);
    const planWithDims = buildCinematicFxChains(effects, intensity, { w, h });

    const args: string[] = ["-hide_banner", "-loglevel", "error", "-y", "-i", inputPath];
    let scanLabel = "";
    let trackLabel = "";
    if (plan.needsScanlines || plan.needsTrackline) {
      let inputIdx = 1;
      if (plan.needsScanlines) {
        await makeScanlineOverlay(w, h, scanPath);
        args.push("-loop", "1", "-i", scanPath);
        scanLabel = `[${inputIdx}:v]`;
        inputIdx += 1;
      }
      if (plan.needsTrackline) {
        await makeTracklineOverlay(w, trackPath);
        args.push("-loop", "1", "-i", trackPath);
        trackLabel = `[${inputIdx}:v]`;
      }
    }

    const filterComplex = buildCinematicFxFilterComplex(planWithDims, {
      attribution,
      attributionFontSize: Math.max(16, Math.round(h / 36)),
      scanLabel,
      trackLabel,
    });

    await execFileAsync(
      "ffmpeg",
      [
        ...args,
        "-filter_complex",
        filterComplex,
        "-map",
        "[vout]",
        "-map",
        "0:a?",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-movflags",
        "+faststart",
        outputPath,
      ],
      { timeout: 300_000 },
    );

    const buffer = await readFile(outputPath);
    const objectName = `cinematic-fx/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      effects,
      intensity,
      attribution,
      cost: CINEMATIC_FX_COST,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cinematic FX render failed.";
    req.log.error({ err: message }, "[cinematic-fx] failed");
    await refundCredits(req.userId!, CINEMATIC_FX_COST, {
      action: "Cinematic FX Render — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
