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

/* ─── Slideshow video maker ───
   Builds a video slideshow from image URLs with Ken Burns pan/zoom
   motion on every slide and crossfade-style transitions between slides,
   plus an optional music bed. 250 Visual Bucs. */

const SLIDESHOW_COST = Number(process.env["SLIDESHOW_CREDITS"]) || 250;

const MAX_IMAGES = 20;
const MIN_IMAGES = 2;
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const TRANSITION_DURATION = 0.75; // seconds
const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 30;

const TRANSITIONS = {
  fade: { xfade: "fade", label: "Fade", blurb: "Classic soft crossfade between slides." },
  dissolve: { xfade: "dissolve", label: "Dissolve", blurb: "Dreamy pixel dissolve between slides." },
  slide: { xfade: "slideleft", label: "Slide", blurb: "Slides push left into the next image." },
  wipe: { xfade: "wipeleft", label: "Wipe", blurb: "A clean wipe sweeps into the next image." },
  none: { xfade: null, label: "None", blurb: "Hard cuts, no transition effect." },
} as const;

type TransitionKey = keyof typeof TRANSITIONS;

const slideshowSchema = z.object({
  images: z.array(z.string().trim().min(1).max(2048)).min(MIN_IMAGES).max(MAX_IMAGES),
  musicUrl: z.string().trim().min(1).max(2048).optional(),
  transition: z.enum(["fade", "dissolve", "slide", "wipe", "none"]).default("fade"),
  slideDuration: z.number().min(1).max(10).default(3),
});

/* Four alternating Ken Burns motions so consecutive slides feel different. */
function kenBurnsFilter(index: number, frames: number): string {
  const s = `${WIDTH}x${HEIGHT}`;
  switch (index % 4) {
    case 0: // slow zoom in
      return (
        `scale=2560:1440,` +
        `zoompan=z='min(zoom+0.0012,1.25)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${s}:fps=${FPS}`
      );
    case 1: // slow zoom out
      return (
        `scale=2560:1440,` +
        `zoompan=z='max(1.25-0.0012*on,1.0)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${s}:fps=${FPS}`
      );
    case 2: // pan right
      return (
        `scale=2560:1440,` +
        `zoompan=z=1.15:d=${frames}:x='(iw-iw/zoom)*on/${frames}':y='ih/2-(ih/zoom/2)':s=${s}:fps=${FPS}`
      );
    default: // pan left
      return (
        `scale=2560:1440,` +
        `zoompan=z=1.15:d=${frames}:x='(iw-iw/zoom)*(1-on/${frames})':y='ih/2-(ih/zoom/2)':s=${s}:fps=${FPS}`
      );
  }
}

router.get("/slideshow-transitions", (_req, res) => {
  res.json({
    transitions: Object.entries(TRANSITIONS).map(([key, t]) => ({
      key,
      label: t.label,
      blurb: t.blurb,
    })),
    price: SLIDESHOW_COST,
    defaults: { slideDuration: 3, transition: "fade" as TransitionKey },
  });
});

router.post("/slideshow", requireAuth, async (req, res) => {
  const parsed = slideshowSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const { images, musicUrl, transition, slideDuration } = parsed.data;
  const transitionKey = transition as TransitionKey;

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < SLIDESHOW_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, SLIDESHOW_COST, {
      action: "Slideshow video",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "slideshow-"));
  const fail = async (message: string, status = 500) => {
    await refundCredits(req.userId!, SLIDESHOW_COST, {
      action: "Slideshow video — Refund",
    }).catch(() => {});
    res.status(status).json({ error: message });
  };

  try {
    // 1. Download all images
    const imagePaths: string[] = [];
    for (let i = 0; i < images.length; i++) {
      const imgRes = await fetch(images[i]!, { signal: AbortSignal.timeout(120_000) });
      if (!imgRes.ok) {
        await fail(`Could not download image ${i + 1}. Check the URL and try again.`, 400);
        return;
      }
      const buf = Buffer.from(await imgRes.arrayBuffer());
      if (buf.length > MAX_IMAGE_BYTES) {
        await fail(`Image ${i + 1} is larger than 25 MB.`, 400);
        return;
      }
      const p = join(workDir, `img-${i}.bin`);
      await writeFile(p, buf);
      imagePaths.push(p);
    }

    // 2. Render each image into a Ken Burns motion segment
    const framesPerSlide = Math.round(slideDuration * FPS);
    const segmentPaths: string[] = [];
    for (let i = 0; i < imagePaths.length; i++) {
      const segPath = join(workDir, `seg-${i}.mp4`);
      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          "-i", imagePaths[i]!,
          "-vf", kenBurnsFilter(i, framesPerSlide),
          "-frames:v", String(framesPerSlide),
          "-r", String(FPS),
          "-c:v", "libx264",
          "-pix_fmt", "yuv420p",
          "-preset", "veryfast",
          segPath,
        ],
        { timeout: 300_000 }
      );
      segmentPaths.push(segPath);
    }

    // 3. Join segments with the chosen transition
    const joinedPath = join(workDir, "joined.mp4");
    const n = segmentPaths.length;
    const ffmpegArgs: string[] = ["-y"];
    for (const p of segmentPaths) ffmpegArgs.push("-i", p);

    if (transitionKey === "none") {
      const inputs = segmentPaths.map((_, i) => `[${i}:v]`).join("");
      ffmpegArgs.push(
        "-filter_complex", `${inputs}concat=n=${n}:v=1:a=0[v]`,
        "-map", "[v]",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        joinedPath
      );
    } else {
      const xfadeName = TRANSITIONS[transitionKey].xfade!;
      let chain = "";
      let lastLabel = "[0:v]";
      for (let i = 1; i < n; i++) {
        const offset = (slideDuration * i - TRANSITION_DURATION * i).toFixed(3);
        const outLabel = i === n - 1 ? "[v]" : `[x${i}]`;
        chain += `${lastLabel}[${i}:v]xfade=transition=${xfadeName}:duration=${TRANSITION_DURATION}:offset=${offset}${outLabel};`;
        lastLabel = outLabel;
      }
      ffmpegArgs.push(
        "-filter_complex", chain.replace(/;$/, ""),
        "-map", "[v]",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        joinedPath
      );
    }
    await execFileAsync("ffmpeg", ffmpegArgs, { timeout: 300_000 });

    // 4. Optionally mux a music bed (trimmed to the video length)
    let finalPath = joinedPath;
    if (musicUrl) {
      const musicPath = join(workDir, "music.bin");
      const musicRes = await fetch(musicUrl, { signal: AbortSignal.timeout(120_000) });
      if (!musicRes.ok) {
        await fail("Could not download the music file. Check the URL and try again.", 400);
        return;
      }
      await writeFile(musicPath, Buffer.from(await musicRes.arrayBuffer()));
      finalPath = join(workDir, "final.mp4");
      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          "-i", joinedPath,
          "-i", musicPath,
          "-map", "0:v",
          "-map", "1:a",
          "-c:v", "copy",
          "-c:a", "aac",
          "-b:a", "128k",
          "-shortest",
          finalPath,
        ],
        { timeout: 180_000 }
      );
    }

    const buffer = await readFile(finalPath);
    const objectName = `slideshow/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    const totalDuration =
      transitionKey === "none"
        ? slideDuration * n
        : slideDuration * n - TRANSITION_DURATION * (n - 1);

    res.json({
      url,
      storageRef,
      slides: n,
      transition: transitionKey,
      slideDuration,
      duration: Math.round(totalDuration * 100) / 100,
      hasMusic: Boolean(musicUrl),
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Slideshow creation failed.";
    req.log.error({ err: message }, "[slideshow] failed");
    await fail(message);
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
