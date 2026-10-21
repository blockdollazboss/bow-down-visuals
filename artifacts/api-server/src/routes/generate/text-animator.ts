import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, unlink, mkdtemp, rm } from "fs/promises";
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

/* ─── AI video text animator ───
   5-second animated text video (1080x1920, 30fps) rendered with ffmpeg
   drawtext. 6 animation styles, solid or transparent background.
   200 Visual Bucs. */

const TEXT_ANIMATOR_COST = Number(process.env["TEXT_ANIMATOR_CREDITS"]) || 200;
const FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const DURATION = 5;
const W = 1080;
const H = 1920;
const FPS = 30;

const STYLES = {
  typewriter: {
    label: "Typewriter",
    blurb: "Characters appear one by one, like typing",
  },
  "fade-in": {
    label: "Fade In",
    blurb: "Text gently fades in from transparent",
  },
  "slide-up": {
    label: "Slide Up",
    blurb: "Text slides up into center frame",
  },
  bounce: {
    label: "Bounce",
    blurb: "Text bounces into place, settling at center",
  },
  glitch: {
    label: "Glitch",
    blurb: "Digital glitch jitter with RGB-split flicker",
  },
  "neon-pulse": {
    label: "Neon Pulse",
    blurb: "Pulsing neon glow around the text",
  },
} as const;

type StyleKey = keyof typeof STYLES;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Must be a #RRGGBB hex color.");

const animatedTextSchema = z.object({
  text: z.string().trim().min(1).max(120),
  style: z.string().refine((v): v is StyleKey => v in STYLES, {
    message: `Style must be one of: ${Object.keys(STYLES).join(", ")}`,
  }),
  background: z.union([hexColor, z.literal("transparent")]).default("#000000"),
  textColor: hexColor.default("#ffffff"),
  fontSize: z.number().int().min(24).max(220).optional(),
});

router.get("/animated-text/styles", requireAuth, (_req, res) => {
  res.json({
    styles: Object.entries(STYLES).map(([key, v]) => ({
      key,
      label: v.label,
      blurb: v.blurb,
    })),
    durationSeconds: DURATION,
    width: W,
    height: H,
    fps: FPS,
    backgrounds: ["#000000", "#ffffff", "transparent"],
    cost: TEXT_ANIMATOR_COST,
  });
});

function escapeDrawtext(t: string): string {
  return t
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "%%");
}

/** Base drawtext options shared by every style. */
function baseDrawtext(text: string, textColor: string, fontSize: number): string {
  return (
    `drawtext=fontfile='${FONT_PATH}'` +
    `:text='${escapeDrawtext(text)}'` +
    `:fontsize=${fontSize}` +
    `:fontcolor=${textColor}` +
    `:x=(w-text_w)/2` +
    `:y=(h-text_h)/2`
  );
}

/** Auto-fit the font size to the text length when the caller didn't specify one. */
function autoFontSize(text: string): number {
  const size = Math.floor(1500 / Math.max(text.length, 6));
  return Math.min(160, Math.max(48, size));
}

/**
 * Build the drawtext filter chain for a style.
 * Returns a single ffmpeg filter string (may contain multiple drawtext filters
 * joined with commas for the typewriter reveal).
 */
function buildStyleFilter(style: StyleKey, text: string, textColor: string, fontSize: number): string {
  const base = baseDrawtext(text, textColor, fontSize);
  switch (style) {
    case "typewriter": {
      // Cumulative reveal: char i appears at (i * step) and stays.
      const step = DURATION / Math.max(text.length, 1);
      const filters: string[] = [];
      for (let i = 1; i <= text.length; i++) {
        const prefix = baseDrawtext(text.slice(0, i), textColor, fontSize);
        filters.push(`${prefix}:enable='gte(t,${(step * (i - 1)).toFixed(3)})'`);
      }
      void base;
      return filters.join(",");
    }
    case "fade-in":
      return `${base}:alpha='if(lt(t,1.2),t/1.2,1)'`;
    case "slide-up":
      return (
        `${baseDrawtext(text, textColor, fontSize).replace(":y=(h-text_h)/2", "")}` +
        `:y='if(lt(t,0.9), h-(h-(h-text_h)/2)*(t/0.9), (h-text_h)/2)'`
      );
    case "bounce":
      return (
        `${baseDrawtext(text, textColor, fontSize).replace(":y=(h-text_h)/2", "")}` +
        `:y='(h-text_h)/2 - abs(sin(t*7))*120*exp(-t*1.8)'`
      );
    case "glitch":
      // Per-frame random jitter + static red RGB-split shadow. (shadowcolor does
      // not accept expressions in this ffmpeg build.)
      return (
        `${baseDrawtext(text, textColor, fontSize).replace(":x=(w-text_w)/2", "").replace(":y=(h-text_h)/2", "")}` +
        `:x='(w-text_w)/2 + (random(0)-0.5)*36'` +
        `:y='(h-text_h)/2 + (random(1)-0.5)*24'` +
        `:shadowcolor=0xFF0000:shadowx=8:shadowy=0` +
        `:enable='gte(t,0.15)'`
      );
    case "neon-pulse":
      return (
        `${base}` +
        `:alpha='0.55+0.45*sin(t*9)'` +
        `:borderw=3:bordercolor=${textColor}@0.65` +
        `:shadowcolor=0x00FFFF:shadowx=0:shadowy=0`
      );
  }
}

router.post("/animated-text", requireAuth, async (req, res) => {
  const parsed = animatedTextSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const { text, style, background, textColor } = parsed.data;
  const fontSize = parsed.data.fontSize ?? autoFontSize(text);
  const transparent = background === "transparent";

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < TEXT_ANIMATOR_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, TEXT_ANIMATOR_COST, {
      action: `Animated Text (${style})`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "text-anim-"));
  const isWebm = transparent;
  const outputPath = join(workDir, isWebm ? "animated-text.webm" : "animated-text.mp4");

  try {
    // Base canvas: solid color, or black-with-alpha for the transparent WebM.
    const source = transparent
      ? `color=c=black@0:s=${W}x${H}:r=${FPS}:d=${DURATION},format=yuva420p`
      : `color=c=${background}:s=${W}x${H}:r=${FPS}:d=${DURATION},format=yuv420p`;

    const textFilter = buildStyleFilter(style, text, textColor, fontSize);
    const vf = `${source},${textFilter}`;

    const args: string[] = ["-y", "-f", "lavfi", "-i", vf, "-t", String(DURATION)];
    if (isWebm) {
      args.push(
        "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p",
        "-b:v", "0", "-crf", "18", "-auto-alt-ref", "0",
        outputPath,
      );
    } else {
      args.push(
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-pix_fmt", "yuv420p", "-r", String(FPS),
        outputPath,
      );
    }

    await execFileAsync("ffmpeg", args, { timeout: 180_000 });

    const buffer = await readFile(outputPath);
    const mime = isWebm ? "video/webm" : "video/mp4";
    const objectName = `animated-text/${req.userId}/${randomUUID()}${isWebm ? ".webm" : ".mp4"}`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, mime);
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      style,
      text,
      background,
      durationSeconds: DURATION,
      transparent,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Animated text creation failed.";
    req.log.error({ err: message }, "[text-animator] failed");
    await refundCredits(req.userId!, TEXT_ANIMATOR_COST, {
      action: "Animated Text — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    await unlink(outputPath).catch(() => {});
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
