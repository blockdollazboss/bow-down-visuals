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

/* ─── AI beat sync editor ───
   Detects beats in an audio track, then auto-cuts the video on those beats
   with a rhythmic zoom-punch + transition at every cut. 350 Visual Bucs. */

const BEAT_SYNC_COST = Number(process.env["BEAT_SYNC_CREDITS"]) || 350;

const TRANSITIONS = {
  cut: { label: "Cut", blurb: "Hard cut on every beat" },
  fade: { label: "Fade", blurb: "Quick dissolve on every beat" },
  flash: { label: "Flash", blurb: "White flash on every beat" },
} as const;

type TransitionKey = keyof typeof TRANSITIONS;

const beatSyncSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  audioUrl: z.string().trim().min(1).max(2048),
  transition: z
    .string()
    .refine((v): v is TransitionKey => v in TRANSITIONS, {
      message: `Transition must be one of: ${Object.keys(TRANSITIONS).join(", ")}`,
    })
    .default("fade"),
  sensitivity: z.number().int().min(1).max(10).default(5),
  maxCuts: z.number().int().min(4).max(80).default(40),
});

router.get("/beat-sync/info", requireAuth, (_req, res) => {
  res.json({
    price: BEAT_SYNC_COST,
    transitions: Object.entries(TRANSITIONS).map(([key, v]) => ({
      key,
      label: v.label,
      blurb: v.blurb,
    })),
    defaults: { transition: "fade", sensitivity: 5, maxCuts: 40 },
    notes: [
      "Beats are detected from the audio's momentary loudness envelope.",
      "The video is cut on beats with an alternating zoom punch at each cut.",
      "The provided audio replaces the video's original audio.",
      "Output is capped at 180 seconds.",
    ],
  });
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
    { timeout: 30_000 }
  );
  const d = Number(stdout.trim());
  return Number.isFinite(d) && d > 0 ? d : 0;
}

/* Detect beats via the ebur128 momentary-loudness envelope (stderr, where
   ffmpeg actually emits it), then peak-pick local maxima above an adaptive
   threshold. Returns beat timestamps in seconds. */
async function detectBeats(
  audioPath: string,
  sensitivity: number,
  maxCuts: number,
  maxDuration: number
): Promise<{ beats: number[]; bpm: number | null }> {
  const { stderr } = await execFileAsync(
    "ffmpeg",
    [
      "-hide_banner",
      "-i", audioPath,
      "-af", "ebur128=peak=true",
      "-f", "null", "-",
    ],
    { timeout: 180_000, maxBuffer: 64 * 1024 * 1024 }
  );

  const points: Array<{ t: number; m: number }> = [];
  // ebur128 per-frame lines look like:
  // [Parsed_ebur128_0 @ 0x...] t: 0.0999773  TARGET:-23 LUFS    M:-120.7 S:-120.7 ...
  const re = /t:\s*([\d.]+)\s+TARGET:[^\n]*?M:\s*(-?[\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stderr)) !== null) {
    const t = parseFloat(m[1]!);
    const v = parseFloat(m[2]!);
    if (Number.isFinite(t) && Number.isFinite(v) && t <= maxDuration) {
      points.push({ t, m: v });
    }
  }
  if (points.length < 3) return { beats: [], bpm: null };

  const values = points.map((p) => p.m);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const maxM = Math.max(...values);

  // Not enough dynamic range to find beats (e.g. flat ambience).
  if (maxM - mean < 3) return { beats: [], bpm: null };

  // Higher sensitivity => accept weaker peaks => more beats.
  // Peaks must sit within (6 + sensitivity) dB of the loudest moment.
  const dropDb = 6 + sensitivity;
  const threshold = Math.max(maxM - dropDb, mean, -60);

  const MIN_GAP = 0.25; // seconds between beats
  const EDGE = 0.3; // keep beats away from the very start/end
  const beats: number[] = [];
  for (let i = 1; i < points.length - 1 && beats.length < maxCuts; i++) {
    const p = points[i]!;
    if (p.t < EDGE || p.t > maxDuration - EDGE) continue;
    if (
      p.m > threshold &&
      p.m >= points[i - 1]!.m &&
      p.m >= points[i + 1]!.m &&
      (beats.length === 0 || p.t - beats[beats.length - 1]! >= MIN_GAP)
    ) {
      beats.push(p.t);
    }
  }

  let bpm: number | null = null;
  if (beats.length >= 4) {
    const gaps: number[] = [];
    for (let i = 1; i < beats.length; i++) gaps.push(beats[i]! - beats[i - 1]!);
    gaps.sort((a, b) => a - b);
    const median = gaps[Math.floor(gaps.length / 2)]!;
    if (median > 0) bpm = Math.round(60 / median);
  }
  return { beats, bpm };
}

function xfadeName(t: TransitionKey): string {
  switch (t) {
    case "flash":
      return "fadewhite";
    case "fade":
      return "fade";
    default:
      return "fade";
  }
}

router.post("/beat-sync", requireAuth, async (req, res) => {
  const parsed = beatSyncSchema.safeParse(req.body ?? {});
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

  const { videoUrl, audioUrl, transition, sensitivity, maxCuts } = parsed.data;

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < BEAT_SYNC_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, BEAT_SYNC_COST, {
      action: "Beat Sync Editor",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "Not enough Visual Bucs.",
      });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "beat-sync-"));
  const videoPath = join(workDir, "video.mp4");
  const audioPath = join(workDir, "audio");
  const outputPath = join(workDir, "beat-synced.mp4");

  try {
    // Download inputs (200 MB cap each).
    for (const [url, dest] of [
      [videoUrl, videoPath],
      [audioUrl, audioPath],
    ] as const) {
      const r = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!r.ok) throw new Error(`Could not download ${dest === videoPath ? "video" : "audio"}.`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 200 * 1024 * 1024) {
        throw new Error("Input file exceeds the 200 MB limit.");
      }
      await writeFile(dest, buf);
    }

    const [videoDur, audioDur] = await Promise.all([
      probeDuration(videoPath),
      probeDuration(audioPath),
    ]);
    if (!videoDur || !audioDur) {
      throw new Error("Could not read the duration of the video or audio.");
    }
    const outDur = Math.min(videoDur, audioDur, 180);

    const { beats, bpm } = await detectBeats(audioPath, sensitivity, maxCuts, outDur);

    // Build beat boundaries, dropping beats that would make tiny segments.
    const MIN_SEG = 0.3;
    const bounds: number[] = [0];
    for (const b of beats) {
      if (b - bounds[bounds.length - 1]! >= MIN_SEG && outDur - b >= MIN_SEG) {
        bounds.push(b);
      }
    }
    bounds.push(outDur);

    const W = 1280;
    const H = 720;
    const FPS = 30;
    const TD = transition === "cut" ? 0 : 0.15; // transition duration

    const filters: string[] = [];
    filters.push(
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
        `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,` +
        `fps=${FPS},format=yuv420p,settb=AVTB,setsar=1,` +
        `trim=start=0:end=${outDur.toFixed(3)},setpts=PTS-STARTPTS[vbase]`
    );

    // Cut the video on beats; odd segments get a zoom punch so every
    // beat lands with a visible rhythmic hit.
    const nSeg = bounds.length - 1;
    const segLabels: string[] = [];
    for (let i = 0; i < nSeg; i++) {
      const s = bounds[i]!.toFixed(3);
      const e = bounds[i + 1]!.toFixed(3);
      const zoom =
        i % 2 === 1
          ? `,scale=${Math.round(W * 1.07)}:${Math.round(H * 1.07)},crop=${W}:${H}`
          : "";
      // settb=AVTB on every segment: scale/crop can reset the timebase and
      // xfade requires identical timebases on both inputs.
      filters.push(
        `[vbase]trim=start=${s}:end=${e},setpts=PTS-STARTPTS${zoom},settb=AVTB[seg${i}]`
      );
      segLabels.push(`[seg${i}]`);
    }

    let vLabel = segLabels[0]!;
    let offset = bounds[1]! - bounds[0]!;
    if (nSeg > 1) {
      for (let i = 1; i < nSeg; i++) {
        const vOut = `[vx${i}]`;
        if (transition === "cut") {
          filters.push(`${vLabel}${segLabels[i]}concat=n=2:v=1:a=0${vOut}`);
          offset += bounds[i + 1]! - bounds[i]!;
        } else {
          const off = Math.max(0, offset - TD).toFixed(3);
          filters.push(
            `${vLabel}${segLabels[i]}xfade=transition=${xfadeName(transition)}:duration=${TD}:offset=${off}${vOut}`
          );
          offset += bounds[i + 1]! - bounds[i]! - TD;
        }
        vLabel = vOut;
      }
    }

    // The provided audio replaces the video's original audio.
    filters.push(
      `[1:a]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
        `atrim=start=0:end=${outDur.toFixed(3)},asetpts=PTS-STARTPTS[aout]`
    );

    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-i", videoPath,
        "-i", audioPath,
        "-filter_complex", filters.join(";"),
        "-map", vLabel,
        "-map", "[aout]",
        "-c:v", "libx264", "-preset", "fast", "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k",
        "-movflags", "+faststart",
        outputPath,
      ],
      { timeout: 600_000, maxBuffer: 64 * 1024 * 1024 }
    );

    const buffer = await readFile(outputPath);
    const objectName = `beat-sync/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      beatsDetected: beats.length,
      beatTimes: beats.map((b) => Number(b.toFixed(2))),
      bpm,
      cuts: nSeg,
      transition,
      duration: Number(outDur.toFixed(2)),
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Beat sync failed.";
    req.log.error({ err: message }, "[beat-sync] failed");
    await refundCredits(req.userId!, BEAT_SYNC_COST, {
      action: "Beat Sync Editor — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    await unlink(videoPath).catch(() => {});
    await unlink(audioPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
