import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, mkdtemp } from "fs/promises";
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

/* ─── AI seamless loop maker ───
   Repeats a video into a seamless loop. Each loop point is blended with an
   xfade/acrossfade crossfade, and the base segment itself is pre-blended so
   its tail melts back into its head — looping the output in a player shows
   no visible jump. 150 Visual Bucs. */

const LOOP_COST = Number(process.env["LOOP_MAKER_CREDITS"]) || 150;

const loopSchema = z
  .object({
    videoUrl: z.string().trim().min(1).max(2048),
    loops: z.number().int().min(1).max(20).optional(),
    duration: z.number().min(1).max(3600).optional(),
    crossfade: z.number().min(0.1).max(2).optional().default(0.5),
  })
  .refine((d) => (d.loops !== undefined) !== (d.duration !== undefined), {
    message: "Provide exactly one of loops (1-20) or duration (seconds).",
    path: ["loops"],
  });

async function probeDuration(path: string): Promise<number> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      path,
    ],
    { timeout: 60_000 },
  );
  const d = parseFloat(stdout.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error("Could not read video duration.");
  return d;
}

async function hasAudioStream(path: string): Promise<boolean> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v", "error",
      "-select_streams", "a",
      "-show_entries", "stream=index",
      "-of", "csv=p=0",
      path,
    ],
    { timeout: 60_000 },
  );
  return stdout.trim().length > 0;
}

router.post("/loop-video", requireAuth, async (req, res) => {
  const parsed = loopSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < LOOP_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, LOOP_COST, {
      action: "Seamless loop video",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "loop-"));
  const inputPath = join(workDir, "input.mp4");
  const outputPath = join(workDir, "output.mp4");

  try {
    const vidRes = await fetch(parsed.data.videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!vidRes.ok) throw new Error("Could not download the video.");
    await writeFile(inputPath, Buffer.from(await vidRes.arrayBuffer()));

    const segDuration = await probeDuration(inputPath);
    const hasAudio = await hasAudioStream(inputPath);

    // Clamp the crossfade so it never eats more than a quarter of the clip.
    const fade = Math.min(parsed.data.crossfade, Math.max(0.1, segDuration / 4));

    const loops =
      parsed.data.loops !== undefined
        ? parsed.data.loops
        : Math.max(1, Math.round(parsed.data.duration! / segDuration));

    /* Build a seamless base segment: crossfade the clip into itself at
       offset (T - fade), then trim to T. The tail now melts into the head,
       so repeating the segment shows no jump at loop points. */
    const vParts: string[] = [];
    const aParts: string[] = [];
    const vLabels: string[] = [];
    const aLabels: string[] = [];

    if (loops === 1) {
      vParts.push(
        `[0:v][0:v]xfade=transition=fade:duration=${fade}:offset=${segDuration - fade},trim=duration=${segDuration},setpts=PTS-STARTPTS[vout]`,
      );
      vLabels.push("[vout]");
      if (hasAudio) {
        aParts.push(
          `[0:a][0:a]acrossfade=d=${fade}:c1=tri:c2=tri,atrim=duration=${segDuration},asetpts=PTS-STARTPTS[aout]`,
        );
        aLabels.push("[aout]");
      }
    } else {
      // First make the seamless base segment once.
      vParts.push(
        `[0:v][0:v]xfade=transition=fade:duration=${fade}:offset=${segDuration - fade},trim=duration=${segDuration},setpts=PTS-STARTPTS[base]`,
      );
      if (hasAudio) {
        aParts.push(
          `[0:a][0:a]acrossfade=d=${fade}:c1=tri:c2=tri,atrim=duration=${segDuration},asetpts=PTS-STARTPTS[abase]`,
        );
      }
      // Split the base into N copies and chain xfades at each boundary.
      const vSplits = Array.from({ length: loops }, (_, i) => `[v${i}]`).join("");
      vParts.push(`[base]split=${loops}${vSplits}`);
      let prev = "[v0]";
      for (let k = 1; k < loops; k++) {
        const out = k === loops - 1 ? "[vout]" : `[x${k}]`;
        const offset = k * (segDuration - fade);
        vParts.push(
          `${prev}[v${k}]xfade=transition=fade:duration=${fade}:offset=${offset}${out}`,
        );
        prev = out;
      }
      vLabels.push("[vout]");
      if (hasAudio) {
        const aSplits = Array.from({ length: loops }, (_, i) => `[a${i}]`).join("");
        aParts.push(`[abase]asplit=${loops}${aSplits}`);
        let aprev = "[a0]";
        for (let k = 1; k < loops; k++) {
          const out = k === loops - 1 ? "[aout]" : `[ax${k}]`;
          aParts.push(`${aprev}[a${k}]acrossfade=d=${fade}:c1=tri:c2=tri${out}`);
          aprev = out;
        }
        aLabels.push("[aout]");
      }
    }

    const filter = [...vParts, ...aParts].join(";");
    const totalDuration = loops * segDuration - (loops - 1) * fade;

    const args = ["-y", "-i", inputPath, "-filter_complex", filter];
    for (const l of vLabels) args.push("-map", l);
    for (const l of aLabels) args.push("-map", l);
    args.push(
      "-c:v", "libx264", "-preset", "fast", "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-movflags", "+faststart",
      outputPath,
    );

    await execFileAsync("ffmpeg", args, { timeout: 600_000 });

    const buffer = await readFile(outputPath);
    const objectName = `loop/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      loops,
      segmentDuration: Number(segDuration.toFixed(2)),
      totalDuration: Number(totalDuration.toFixed(2)),
      crossfade: fade,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Loop video failed.";
    req.log.error({ err: message }, "[loop-video] failed");
    await refundCredits(req.userId!, LOOP_COST, {
      action: "Seamless loop video — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

router.get("/loop-info", (_req, res) => {
  res.json({
    price: LOOP_COST,
    maxLoops: 20,
    maxDurationSec: 3600,
    description:
      "Repeats a video into a seamless loop with crossfade blending at every loop point.",
  });
});

export default router;
