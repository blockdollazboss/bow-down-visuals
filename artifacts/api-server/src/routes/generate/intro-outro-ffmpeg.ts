import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, mkdtemp } from "fs/promises";
import { existsSync } from "fs";
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

/* ─── Branded intro/outro generator (ffmpeg, no provider cost) ───
   Generates a 3-second animated intro (logo/brand reveal) and a 5-second
   outro (thanks + subscribe CTA) on a branded background using ffmpeg
   drawtext/drawbox animations. 350 Visual Bucs for both.
   NOTE: distinct from the Seedance-based /generate-intro-outro route. */

const INTRO_OUTRO_COST = Number(process.env["FFMPEG_INTRO_OUTRO_CREDITS"]) || 350;

const FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const fontfileOpt = existsSync(FONT_BOLD) ? `fontfile='${FONT_BOLD}':` : "";

const STYLES = {
  gold: {
    label: "Gold Luxury",
    blurb: "Black + gold — the Bow Down Visuals house look",
    bg: "0x0a0a0a",
    text: "0xFFD166",
    accent: "0xFFD166",
    sub: "0xFFFFFF",
    border: true,
  },
  neon: {
    label: "Neon Nights",
    blurb: "Dark stage, electric cyan + magenta",
    bg: "0x060614",
    text: "0x00F0FF",
    accent: "0xFF2FD6",
    sub: "0xFFFFFF",
    border: true,
  },
  minimal: {
    label: "Minimal Clean",
    blurb: "White canvas, sharp black type",
    bg: "0xFFFFFF",
    text: "0x141414",
    accent: "0x141414",
    sub: "0x555555",
    border: false,
  },
  sunset: {
    label: "Sunset Glow",
    blurb: "Deep purple dusk, warm amber type",
    bg: "0x1B0B2E",
    text: "0xFFB347",
    accent: "0xFF5E78",
    sub: "0xFFFFFF",
    border: true,
  },
} as const;

type StyleKey = keyof typeof STYLES;

const RATIOS = {
  "16:9": { w: 1920, h: 1080 },
  "9:16": { w: 1080, h: 1920 },
  "1:1": { w: 1080, h: 1080 },
} as const;

function escapeDrawtext(t: string): string {
  return t
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/%/g, "%%")
    .replace(/\r?\n/g, " ");
}

const introOutroSchema = z.object({
  brandName: z.string().trim().min(1).max(60),
  style: z.string().refine((v): v is StyleKey => v in STYLES, {
    message: `Style must be one of: ${Object.keys(STYLES).join(", ")}`,
  }).optional().default("gold"),
  tagline: z.string().trim().max(120).optional().default(""),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).optional().default("16:9"),
});

router.get("/intro-outro/styles", requireAuth, (_req, res) => {
  res.json({
    styles: Object.entries(STYLES).map(([key, v]) => ({
      key,
      label: v.label,
      blurb: v.blurb,
    })),
  });
});

function buildIntroFilter(
  brand: string, tagline: string, style: (typeof STYLES)[StyleKey],
  w: number, h: number,
): string {
  const s = Math.min(w, h) / 1080;
  const brandSize = Math.round(120 * s);
  const tagSize = Math.round(46 * s);
  const barW = Math.round(w * 0.28);
  const barH = Math.max(6, Math.round(8 * s));
  const border = style.border ? `:borderw=3:bordercolor=black@0.7` : "";
  const parts: string[] = [];

  // Brand name — rises in and fades up
  parts.push(
    `drawtext=${fontfileOpt}text='${escapeDrawtext(brand.toUpperCase())}'` +
    `:fontsize=${brandSize}:fontcolor=${style.text}` +
    `:x=(w-text_w)/2` +
    `:y='h*0.42-text_h/2-50*(1-clip((t-0.3)/1.0\\,0\\,1))'` +
    `:alpha='clip((t-0.3)/0.9\\,0\\,1)'${border}`,
  );
  // Accent bar — grows left→right under the brand
  parts.push(
    `drawbox=x='(w-${barW}*clip((t-0.9)/0.6\\,0\\,1))/2':y=h*0.56` +
    `:w='${barW}*clip((t-0.9)/0.6\\,0\\,1)':h=${barH}:color=${style.accent}:t=fill`,
  );
  // Tagline — fades in late
  if (tagline) {
    parts.push(
      `drawtext=${fontfileOpt}text='${escapeDrawtext(tagline)}'` +
      `:fontsize=${tagSize}:fontcolor=${style.sub}` +
      `:x=(w-text_w)/2:y=h*0.62` +
      `:alpha='clip((t-1.3)/0.7\\,0\\,1)'`,
    );
  }
  parts.push("fade=t=in:st=0:d=0.4", "fade=t=out:st=2.5:d=0.5", "format=yuv420p");
  return parts.join(",");
}

function buildOutroFilter(
  brand: string, style: (typeof STYLES)[StyleKey],
  w: number, h: number,
): string {
  const s = Math.min(w, h) / 1080;
  const thanksSize = Math.round(72 * s);
  const brandSize = Math.round(96 * s);
  const ctaSize = Math.round(52 * s);
  const pillW = Math.round(w * 0.26);
  const pillH = Math.round(120 * s);
  const border = style.border ? `:borderw=3:bordercolor=black@0.7` : "";
  const parts: string[] = [];

  // "Thanks for watching" — fades in
  parts.push(
    `drawtext=${fontfileOpt}text='THANKS FOR WATCHING'` +
    `:fontsize=${thanksSize}:fontcolor=${style.sub}` +
    `:x=(w-text_w)/2:y='h*0.28-text_h/2-30*(1-clip((t-0.2)/0.9\\,0\\,1))'` +
    `:alpha='clip((t-0.2)/0.8\\,0\\,1)'${border}`,
  );
  // Brand name
  parts.push(
    `drawtext=${fontfileOpt}text='${escapeDrawtext(brand.toUpperCase())}'` +
    `:fontsize=${brandSize}:fontcolor=${style.text}` +
    `:x=(w-text_w)/2:y=h*0.44-text_h/2` +
    `:alpha='clip((t-0.6)/0.8\\,0\\,1)'${border}`,
  );
  // Subscribe pill + pulsing CTA (drawbox has no alpha option — use timeline enable)
  parts.push(
    `drawbox=x=(w-${pillW})/2:y=h*0.64:w=${pillW}:h=${pillH}:color=${style.accent}:t=fill` +
    `:enable='gte(t\\,1.0)'`,
  );
  parts.push(
    `drawtext=${fontfileOpt}text='SUBSCRIBE'` +
    `:fontsize=${ctaSize}:fontcolor=${style.bg}` +
    `:x=(w-text_w)/2:y=h*0.64+(${pillH}-text_h)/2` +
    `:alpha='clip((t-1.0)/0.4\\,0\\,1)*(0.65+0.35*sin(2*PI*t/1.5))'`,
  );
  parts.push("fade=t=in:st=0:d=0.4", "fade=t=out:st=4.4:d=0.6", "format=yuv420p");
  return parts.join(",");
}

router.post("/intro-outro", requireAuth, async (req, res) => {
  const parsed = introOutroSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < INTRO_OUTRO_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, INTRO_OUTRO_COST, {
      action: "Branded Intro + Outro",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const { brandName, style: styleKey, tagline, aspectRatio } = parsed.data;
  const style = STYLES[styleKey];
  const { w, h } = RATIOS[aspectRatio];
  const workDir = await mkdtemp(join(tmpdir(), "intro-outro-"));
  const introPath = join(workDir, "intro.mp4");
  const outroPath = join(workDir, "outro.mp4");

  try {
    await Promise.all([
      execFileAsync("ffmpeg", [
        "-y",
        "-f", "lavfi", "-i", `color=c=${style.bg}:s=${w}x${h}:d=3:r=30`,
        "-vf", buildIntroFilter(brandName, tagline, style, w, h),
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-pix_fmt", "yuv420p",
        introPath,
      ], { timeout: 120_000 }),
      execFileAsync("ffmpeg", [
        "-y",
        "-f", "lavfi", "-i", `color=c=${style.bg}:s=${w}x${h}:d=5:r=30`,
        "-vf", buildOutroFilter(brandName, style, w, h),
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-pix_fmt", "yuv420p",
        outroPath,
      ], { timeout: 120_000 }),
    ]);

    const [introBuf, outroBuf] = await Promise.all([
      readFile(introPath),
      readFile(outroPath),
    ]);

    const [introRef, outroRef] = await Promise.all([
      uploadMediaToSupabaseStorage(`intro-outro/${req.userId}/${randomUUID()}-intro.mp4`, introBuf, "video/mp4"),
      uploadMediaToSupabaseStorage(`intro-outro/${req.userId}/${randomUUID()}-outro.mp4`, outroBuf, "video/mp4"),
    ]);
    const [introUrl, outroUrl] = await Promise.all([
      refreshSupabaseStorageUrl(introRef),
      refreshSupabaseStorageUrl(outroRef),
    ]);

    res.json({
      introUrl,
      introStorageRef: introRef,
      outroUrl,
      outroStorageRef: outroRef,
      style: styleKey,
      aspectRatio,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Intro/outro generation failed.";
    req.log.error({ err: message }, "[intro-outro] failed");
    await refundCredits(req.userId!, INTRO_OUTRO_COST, {
      action: "Branded Intro + Outro — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
