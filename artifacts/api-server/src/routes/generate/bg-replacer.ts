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

/* ─── AI video background replacer ───
   Detects the foreground video's background color from the first frame's
   corners, keys it out, and composites the foreground over a new background:
   an uploaded image, a solid color, or a blurred copy of the video itself.
   400 Visual Bucs per video. */

const BG_REPLACER_COST = Number(process.env["BG_REPLACER_CREDITS"]) || 400;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MB
const MAX_IMAGE_BYTES = 25 * 1024 * 1024; // 25 MB

const replaceBgSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  /** New background image URL. */
  backgroundImageUrl: z.string().trim().min(1).max(2048).optional(),
  /** New solid background color, hex like "#FFD700" or "FFD700". */
  backgroundColor: z.string().trim().regex(/^#?[0-9a-fA-F]{6}$/, "Must be a 6-digit hex color.").optional(),
  /** True to blur a copy of the video itself as the background. */
  backgroundBlur: z.boolean().optional(),
  /** 0-1, higher = more aggressive keying of the original background. */
  aggressiveness: z.number().min(0).max(1).optional().default(0.5),
}).refine(
  (d) => [d.backgroundImageUrl, d.backgroundColor, d.backgroundBlur === true].filter(Boolean).length === 1,
  { message: "Provide exactly one of backgroundImageUrl, backgroundColor, or backgroundBlur." }
);

/** Sample the first frame's corners to detect the background color to key out. */
async function detectVideoBackgroundColor(videoPath: string): Promise<string> {
  const framePath = join(tmpdir(), `${randomUUID()}-frame.png`);
  try {
    await execFileAsync("ffmpeg", [
      "-y", "-i", videoPath,
      "-vframes", "1",
      framePath,
    ], { timeout: 30_000 });

    const corners = [
      "crop=iw*0.1:ih*0.1:iw*0.05:ih*0.05",
      "crop=iw*0.1:ih*0.1:iw*0.85:ih*0.05",
      "crop=iw*0.1:ih*0.1:iw*0.05:ih*0.85",
      "crop=iw*0.1:ih*0.1:iw*0.85:ih*0.85",
    ];

    const colors: Array<[number, number, number]> = [];
    for (const crop of corners) {
      try {
        // NOTE: ffmpeg's signalstats writes to stderr; stdout-only parse here
        // deliberately reads nothing when misrouted, and the green fallback below
        // covers that case.
        const { stderr } = await execFileAsync("ffmpeg", [
          "-i", framePath,
          "-vf", `${crop},signalstats`,
          "-f", "null", "-",
        ], { timeout: 30_000 });
        const text = stderr ?? "";
        const yMatch = /YAVG:(\d+)/.exec(text);
        const uMatch = /UAVG:(\d+)/.exec(text);
        const vMatch = /VAVG:(\d+)/.exec(text);
        if (yMatch && uMatch && vMatch) {
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

    if (colors.length === 0) return "0x00FF00";

    const r = Math.round(colors.reduce((a, c) => a + c[0], 0) / colors.length);
    const g = Math.round(colors.reduce((a, c) => a + c[1], 0) / colors.length);
    const b = Math.round(colors.reduce((a, c) => a + c[2], 0) / colors.length);

    return `0x${r.toString(16).padStart(2, "0").toUpperCase()}${g.toString(16).padStart(2, "0").toUpperCase()}${b.toString(16).padStart(2, "0").toUpperCase()}`;
  } finally {
    await unlink(framePath).catch(() => {});
  }
}

/** Probe video width/height. */
async function probeDimensions(videoPath: string): Promise<{ width: number; height: number }> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height",
    "-of", "csv=p=0",
    videoPath,
  ], { timeout: 30_000 });
  const [w, h] = stdout.trim().split(",").map(Number);
  if (!w || !h) throw new Error("Could not determine video dimensions.");
  return { width: w, height: h };
}

router.post("/replace-video-bg", requireAuth, async (req, res) => {
  const parsed = replaceBgSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const { videoUrl, backgroundImageUrl, backgroundColor, backgroundBlur, aggressiveness } = parsed.data;
  const backgroundType = backgroundImageUrl ? "image" : backgroundColor ? "color" : "blur";

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < BG_REPLACER_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, BG_REPLACER_COST, {
      action: "Video Background Replace",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "bg-replacer-"));
  const inputPath = join(workDir, "input.mp4");
  const bgImagePath = join(workDir, "bg-image");
  const outputPath = join(workDir, "output.mp4");

  try {
    // 1. Download the foreground video
    const vidRes = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!vidRes.ok) throw new Error("Could not download the video.");
    const videoBuffer = Buffer.from(await vidRes.arrayBuffer());
    if (videoBuffer.length > MAX_VIDEO_BYTES) {
      throw new Error("Video exceeds the 100 MB limit.");
    }
    await writeFile(inputPath, videoBuffer);

    // 2. Detect the background color to key out + probe dimensions
    const keyColor = await detectVideoBackgroundColor(inputPath);
    const { width, height } = await probeDimensions(inputPath);
    req.log.info({ keyColor, width, height, backgroundType }, "[replace-video-bg] starting composite");

    // 3. Prepare the new background input + filter chain
    const similarity = (0.1 + aggressiveness * 0.3).toFixed(3);
    const fgChain = `chromakey=${keyColor}:${similarity}:0.1,format=yuva420p[fg]`;
    const composite = `[bg][fg]overlay=0:0:format=auto,format=yuv420p[v]`;

    const ffmpegArgs: string[] = ["-y", "-i", inputPath];
    let filterComplex: string;
    let bgSourceLabel = "";

    if (backgroundType === "blur") {
      // Split the input: key the foreground, blur the copy as background.
      filterComplex =
        `[0:v]split=2[fg_src][bg_src];` +
        `[fg_src]${fgChain};` +
        `[bg_src]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
        `crop=${width}:${height},gblur=sigma=30,setsar=1,format=yuv420p[bg];` +
        composite;
      bgSourceLabel = "blur";
    } else if (backgroundType === "color") {
      const hex = backgroundColor!.replace("#", "").toUpperCase();
      ffmpegArgs.push("-f", "lavfi", "-i", `color=c=0x${hex}:s=${width}x${height}:r=30`);
      filterComplex = `[0:v]${fgChain};[1:v]format=yuv420p[bg];${composite}`;
      bgSourceLabel = `#${hex}`;
    } else {
      // image background: download, loop, and cover-crop to the video frame
      const imgRes = await fetch(backgroundImageUrl!, { signal: AbortSignal.timeout(60_000) });
      if (!imgRes.ok) throw new Error("Could not download the background image.");
      const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
      if (imgBuffer.length > MAX_IMAGE_BYTES) {
        throw new Error("Background image exceeds the 25 MB limit.");
      }
      await writeFile(bgImagePath, imgBuffer);
      ffmpegArgs.push("-loop", "1", "-i", bgImagePath);
      filterComplex =
        `[0:v]${fgChain};` +
        `[1:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
        `crop=${width}:${height},setsar=1,format=yuv420p[bg];` +
        composite;
      bgSourceLabel = backgroundImageUrl!;
    }

    ffmpegArgs.push(
      "-filter_complex", filterComplex,
      "-map", "[v]", "-map", "0:a?",
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
      "-c:a", "aac",
      "-shortest",
      "-movflags", "+faststart",
      outputPath,
    );

    // 4. Run the composite
    await execFileAsync("ffmpeg", ffmpegArgs, { timeout: 300_000 }); // 5 min

    // 5. Upload result
    const buffer = await readFile(outputPath);
    const objectName = `bg-replacer/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      backgroundType,
      backgroundSource: bgSourceLabel,
      keyedColor: keyColor,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Video background replacement failed.";
    req.log.error({ err: message }, "[replace-video-bg] failed");
    await refundCredits(req.userId!, BG_REPLACER_COST, {
      action: "Video Background Replace — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
