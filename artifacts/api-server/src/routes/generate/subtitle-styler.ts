import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, writeFile, mkdtemp, rm } from "fs/promises";
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

/* ─── AI video subtitle styler ───
   Burns styled subtitles (from SRT text) into a video with ffmpeg/libass.
   5 visual presets via force_style. 200 Visual Bucs.

   Honesty note: SRT has no per-word timing, so "karaoke" and "word-by-word"
   are visual treatments (bold, large, high-contrast) rather than true
   syllable-synced highlighting — true karaoke needs ASS {\k} tags with
   word timings. */

const SUBTITLE_STYLER_COST = Number(process.env["SUBTITLE_STYLER_CREDITS"]) || 200;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_SRT_CHARS = 200_000;

const STYLES = {
  karaoke: {
    label: "Karaoke",
    blurb: "Big bold gold text with heavy outline — built for sing-along energy",
  },
  "word-by-word": {
    label: "Word by Word",
    blurb: "TikTok-style bold text on an opaque dark box, pops per caption",
  },
  minimal: {
    label: "Minimal",
    blurb: "Small clean white text with a soft shadow, stays out of the way",
  },
  "bold-outline": {
    label: "Bold Outline",
    blurb: "Chunky white text with a thick black outline — readable anywhere",
  },
  neon: {
    label: "Neon",
    blurb: "Glowing cyan text with neon shadow, night-club energy",
  },
} as const;

type StyleKey = keyof typeof STYLES;

/** libass colors are &HAABBGGRR (alpha, blue, green, red). */
function forceStyleFor(style: StyleKey): string {
  const common = "FontName=DejaVu Sans,Alignment=2,MarginV=60";
  switch (style) {
    case "karaoke":
      return `${common},FontSize=28,Bold=1,PrimaryColour=&H0000D7FF,SecondaryColour=&H000080FF,OutlineColour=&H00000000,BackColour=&H99000000,BorderStyle=1,Outline=2,Shadow=1`;
    case "word-by-word":
      return `${common},FontSize=30,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&HCC000000,BorderStyle=3,Outline=1,Shadow=0`;
    case "minimal":
      return `${common},FontSize=18,Bold=0,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H00000000,BorderStyle=1,Outline=1,Shadow=1`;
    case "bold-outline":
      return `${common},FontSize=26,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H00000000,BorderStyle=1,Outline=4,Shadow=0`;
    case "neon":
      return `${common},FontSize=26,Bold=1,PrimaryColour=&H00FFFF00,OutlineColour=&H00996600,BackColour=&H00000000,BorderStyle=1,Outline=2,Shadow=2`;
  }
}

const styleSubtitlesSchema = z.object({
  videoUrl: z.string().url("videoUrl must be a valid URL."),
  srt: z.string().trim().min(1, "SRT content is required.").max(MAX_SRT_CHARS),
  style: z.string().refine((v): v is StyleKey => v in STYLES, {
    message: `Style must be one of: ${Object.keys(STYLES).join(", ")}`,
  }),
});

router.get("/subtitle-styles", requireAuth, (_req, res) => {
  res.json({
    styles: Object.entries(STYLES).map(([key, v]) => ({
      key,
      label: v.label,
      blurb: v.blurb,
    })),
    cost: SUBTITLE_STYLER_COST,
  });
});

async function downloadTo(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download media (HTTP ${res.status}).`);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_VIDEO_BYTES) {
      throw new Error("Video is larger than the 100 MB limit.");
    }
    chunks.push(Buffer.from(value));
  }
  await writeFile(destPath, Buffer.concat(chunks));
}

/** Escape the subtitle file path for the ffmpeg subtitles filter. */
function escapeSubPath(p: string): string {
  return p.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}

router.post("/style-subtitles", requireAuth, async (req, res) => {
  const parsed = styleSubtitlesSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const { videoUrl, srt, style } = parsed.data;

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < SUBTITLE_STYLER_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, SUBTITLE_STYLER_COST, {
      action: `Style Subtitles (${style})`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "sub-style-"));
  const inputPath = join(workDir, "input.mp4");
  const srtPath = join(workDir, "subs.srt");
  const outputPath = join(workDir, "subtitled.mp4");

  try {
    await downloadTo(videoUrl, inputPath);
    await writeFile(srtPath, srt, "utf8");

    const forceStyle = forceStyleFor(style);
    const vf = `subtitles='${escapeSubPath(srtPath)}':force_style='${forceStyle}'`;

    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-i", inputPath,
        "-vf", vf,
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "copy",
        "-movflags", "+faststart",
        outputPath,
      ],
      { timeout: 300_000 },
    );

    const buffer = await readFile(outputPath);
    const objectName = `subtitles/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      style,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Subtitle styling failed.";
    req.log.error({ err: message }, "[subtitle-styler] failed");
    await refundCredits(req.userId!, SUBTITLE_STYLER_COST, {
      action: "Style Subtitles — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
