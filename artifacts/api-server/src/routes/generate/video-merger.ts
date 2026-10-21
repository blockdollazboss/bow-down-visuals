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

/* ─── AI video merger ───
   Concatenates 2–10 videos into one MP4 with optional transitions
   between clips (fade, dissolve, slideleft, wipe). 250 Visual Bucs. */

const MERGE_COST = Number(process.env["VIDEO_MERGER_CREDITS"]) || 250;

const TRANSITIONS = {
  none: { label: "Cut", blurb: "Hard cut between clips" },
  fade: { label: "Fade", blurb: "Fade through black" },
  dissolve: { label: "Dissolve", blurb: "Crossfade dissolve" },
  slideleft: { label: "Slide Left", blurb: "Next clip slides in from the right" },
  wipe: { label: "Wipe", blurb: "Vertical wipe to the next clip" },
} as const;

type TransitionKey = keyof typeof TRANSITIONS;

const mergeSchema = z.object({
  videoUrls: z.array(z.string().trim().min(1).max(2048)).min(2).max(10),
  transitions: z
    .array(z.string().refine((v): v is TransitionKey => v in TRANSITIONS, {
      message: `Transition must be one of: ${Object.keys(TRANSITIONS).join(", ")}`,
    }))
    .max(9)
    .optional(),
});

router.get("/merge-transitions", requireAuth, (_req, res) => {
  res.json({
    transitions: Object.entries(TRANSITIONS).map(([key, v]) => ({
      key,
      label: v.label,
      blurb: v.blurb,
    })),
    maxVideos: 10,
    defaultTransition: "none",
  });
});

async function probeDuration(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      videoPath,
    ],
    { timeout: 30_000 }
  );
  const d = Number(stdout.trim());
  return Number.isFinite(d) && d > 0 ? d : 1;
}

async function hasAudioStream(videoPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v", "error", "-select_streams", "a",
        "-show_entries", "stream=index",
        "-of", "csv=p=0", videoPath,
      ],
      { timeout: 30_000 }
    );
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/* xfade name + acrossfade-compatible transition per key */
function xfadeFor(t: TransitionKey): string {
  switch (t) {
    case "fade": return "fade";
    case "dissolve": return "fade";
    case "slideleft": return "slideleft";
    case "wipe": return "wipeleft";
    default: return "fade";
  }
}

router.post("/merge-videos", requireAuth, async (req, res) => {
  const parsed = mergeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const urls = parsed.data.videoUrls;
  const n = urls.length;
  const requested = parsed.data.transitions ?? [];
  if (requested.length > 0 && requested.length !== n - 1) {
    res.status(400).json({
      error: `Provide exactly ${n - 1} transition(s) for ${n} videos, or omit transitions entirely.`,
    });
    return;
  }
  const transitions: TransitionKey[] =
    requested.length > 0 ? requested : Array<TransitionKey>(n - 1).fill("none");

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < MERGE_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, MERGE_COST, {
      action: "Video Merger",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "merge-"));
  const inputPaths: string[] = [];
  const outputPath = join(workDir, "merged.mp4");

  try {
    // Download all inputs
    for (let i = 0; i < n; i++) {
      const inputPath = join(workDir, `input-${i}.mp4`);
      const vidRes = await fetch(urls[i]!, { signal: AbortSignal.timeout(120_000) });
      if (!vidRes.ok) throw new Error(`Could not download video ${i + 1}.`);
      await writeFile(inputPath, Buffer.from(await vidRes.arrayBuffer()));
      inputPaths.push(inputPath);
    }

    const durations = await Promise.all(inputPaths.map(probeDuration));
    const audioFlags = await Promise.all(inputPaths.map(hasAudioStream));
    const W = 1280;
    const H = 720;
    const TD = 0.5; // transition duration in seconds

    const args: string[] = ["-y"];
    for (const p of inputPaths) args.push("-i", p);

    const filters: string[] = [];
    // Normalize: 720p, 30fps, yuv420p + stereo AAC-ready audio (or silence)
    inputPaths.forEach((_p, i) => {
      filters.push(
        `[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,fps=30,format=yuv420p,settb=AVTB,setsar=1[v${i}n]`
      );
      if (audioFlags[i]) {
        filters.push(`[${i}:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}n]`);
      } else {
        filters.push(
          `anullsrc=channel_layout=stereo:sample_rate=44100:r=${durations[i]!.toFixed(3)}:d=${durations[i]!.toFixed(3)}[a${i}n]`
        );
      }
    });

    // Chain xfade/acrossfade across every gap
    let vLabel = "[v0n]";
    let aLabel = "[a0n]";
    let offset = durations[0]!;

    for (let i = 1; i < n; i++) {
      const t = transitions[i - 1]!;
      const vOut = `[vx${i}]`;
      const aOut = `[ax${i}]`;
      if (t === "none") {
        filters.push(`${vLabel}[v${i}n]xstack=inputs=2:skip_first=0[vcat${i}]`);
        // concat with aligned streams (video-only path); handle via concat filter instead
        filters.pop();
        filters.push(`${vLabel}[v${i}n]concat=n=2:v=1:a=0${vOut}`);
        filters.push(`${aLabel}[a${i}n]concat=n=2:v=0:a=1${aOut}`);
        offset += durations[i]!;
      } else {
        const off = Math.max(0, offset - TD).toFixed(3);
        filters.push(`${vLabel}[v${i}n]xfade=transition=${xfadeFor(t)}:duration=${TD}:offset=${off}${vOut}`);
        filters.push(`${aLabel}[a${i}n]acrossfade=d=${TD}${aOut}`);
        offset += durations[i]! - TD;
      }
      vLabel = vOut;
      aLabel = aOut;
    }

    args.push(
      "-filter_complex", filters.join(";"),
      "-map", vLabel, "-map", aLabel,
      "-c:v", "libx264", "-preset", "fast", "-crf", "18",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "128k",
      outputPath
    );

    await execFileAsync("ffmpeg", args, { timeout: 600_000 });

    const buffer = await readFile(outputPath);
    const objectName = `merge/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      clipsMerged: n,
      transitions,
      duration: Number(offset.toFixed(2)),
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Video merge failed.";
    req.log.error({ err: message }, "[video-merger] failed");
    await refundCredits(req.userId!, MERGE_COST, {
      action: "Video Merger — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    const { rm } = await import("fs/promises");
    await Promise.all(inputPaths.map((p) => unlink(p).catch(() => {})));
    await unlink(outputPath).catch(() => {});
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
