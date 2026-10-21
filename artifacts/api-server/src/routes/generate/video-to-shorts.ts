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
import {
  transcribeVideoFile,
  buildTimestampedTranscript,
  formatTimestamp,
} from "./streamer-clips";
import {
  detectSemanticHighlights,
  SEMANTIC_VIBES,
  type SemanticHighlight,
} from "../../lib/semantic-highlights";

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── Smart clips (unified auto-clip extraction) ───
   Analyzes a long video, finds its best moments, and extracts them as
   vertical shorts (9:16). Configurable count (1-5) and duration (15-60s).
   200 Visual Bucs per clip — one charge for the whole job, refunded in
   full if the job fails (the rail's charge discipline is unchanged).

   Moment finding is SEMANTIC first (ported from the streamer-clips
   rail): the video is transcribed with timed transcription
   (lib/transcription.ts) and the text model ranks moments with a score
   + one-line reason, optionally matching a free-text description from
   the creator ("find the part where I explain pricing"). Audio ENERGY
   (ffmpeg astats) remains as the fallback signal: when there is no
   speech to analyze, the semantic pass finds nothing, or it errors,
   energy picks fill the request — and every clip says which method
   found it, with energy picks carrying an honest reason and NO score
   (a loudness number dressed up as a quality score would be fake
   precision). */

const SMART_CLIPS_PER_CLIP = 200;
const MAX_CLIPS = 5;
const ENERGY_WINDOW_SEC = 10;

const smartClipsSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  count: z.number().int().min(1).max(5).optional().default(3),
  durationSec: z.number().int().min(15).max(60).optional().default(45),
  /** Free-text moment search, Opus-style: "the part where I explain pricing". */
  query: z.string().trim().min(1).max(300).optional(),
  vibe: z.enum(SEMANTIC_VIBES).optional(),
});

interface Segment {
  start: number;
  energy: number;
}

export interface ClipCandidate {
  start: number;
  method: "semantic" | "energy";
  title: string;
  reason: string;
  quote: string;
  /** Semantic picks only — the model's 0–100 strength score, or null
   *  when the model gave none. Energy picks always carry null. */
  score: number | null;
}

/* ── Energy signal (fallback): astats window scan ─────────────────────── */

async function probeDurationSec(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", videoPath,
  ], { timeout: 30_000 });
  return parseFloat(stdout.trim());
}

/** Scan every 10-second window's RMS level. Windows whose probe fails
 *  are skipped, exactly as the original inline scan did. */
async function scanWindowEnergies(videoPath: string, duration: number): Promise<Segment[]> {
  const numWindows = Math.floor(duration / ENERGY_WINDOW_SEC);
  const segments: Segment[] = [];
  for (let w = 0; w < numWindows; w++) {
    const start = w * ENERGY_WINDOW_SEC;
    try {
      const { stdout } = await execFileAsync("ffmpeg", [
        "-ss", start.toFixed(1), "-t", ENERGY_WINDOW_SEC.toFixed(1),
        "-i", videoPath,
        "-af", "astats=metadata=1:reset=1",
        "-f", "null", "-",
      ], { timeout: 30_000 });
      const rmsMatch = /RMS level dB:\s*(-?\d+\.?\d*)/.exec(stdout);
      const energy = rmsMatch ? parseFloat(rmsMatch[1]!) : -Infinity;
      segments.push({ start, energy });
    } catch {
      // Skip
    }
  }
  return segments;
}

/**
 * Pick the top non-overlapping energy windows and center a clip on each.
 * The comparison runs against already-picked CLIP starts, preserving the
 * original detector's behavior. Exported for tests.
 */
export function pickEnergySegments(
  windows: Segment[],
  count: number,
  clipDuration: number,
  duration: number,
): Segment[] {
  const sorted = [...windows].sort((a, b) => b.energy - a.energy);
  const picked: Segment[] = [];
  for (const seg of sorted) {
    if (picked.length >= count) break;
    const overlaps = picked.some((p) => Math.abs(p.start - seg.start) < clipDuration);
    if (!overlaps) {
      const clipStart = Math.max(0, Math.min(duration - clipDuration, seg.start - (clipDuration - ENERGY_WINDOW_SEC) / 2));
      picked.push({ start: Math.round(clipStart * 10) / 10, energy: seg.energy });
    }
  }
  picked.sort((a, b) => a.start - b.start);
  return picked;
}

/** The original energy-only detector, kept whole as the fallback path
 *  (probe → scan → pick). Exported for tests. */
export async function findEnergeticSegments(videoPath: string, count: number, clipDuration: number): Promise<Segment[]> {
  const duration = await probeDurationSec(videoPath);
  if (!Number.isFinite(duration) || duration <= clipDuration) {
    return [{ start: 0, energy: 0 }];
  }
  const windows = await scanWindowEnergies(videoPath, duration);
  return pickEnergySegments(windows, count, clipDuration, duration);
}

/* ── Candidate selection (exported for tests) ─────────────────────────── */

export type SemanticOutcome = "ok" | "no-speech" | "no-match" | "unavailable";

/** The honest reason an energy fallback pick carries — it always says
 *  energy picked it and why semantics didn't. */
export function energyFallbackReason(outcome: SemanticOutcome, query?: string): string {
  switch (outcome) {
    case "no-speech":
      return "Picked by audio energy — no speech was detected in this video to analyze.";
    case "no-match":
      return query
        ? `No moment matched "${query}" closely — picked by audio energy instead.`
        : "No standout spoken moments were found — picked by audio energy.";
    case "unavailable":
      return "Picked by audio energy — semantic analysis was unavailable for this video.";
    default:
      return "Picked by audio energy to round out the set.";
  }
}

/**
 * Merge semantic candidates (ranked best-first) with energy windows into
 * the final pick list. Semantic moments always outrank energy; energy
 * only fills slots semantics couldn't. Picks are returned in timeline
 * order for a natural viewing sequence.
 */
export function selectClipCandidates(opts: {
  semantic: SemanticHighlight[];
  energyWindows: Segment[];
  count: number;
  clipDuration: number;
  durationSec: number;
  outcome: SemanticOutcome;
  query?: string;
}): ClipCandidate[] {
  const { count, clipDuration, durationSec } = opts;
  const maxStart = durationSec > 0 ? Math.max(0, durationSec - clipDuration) : Number.POSITIVE_INFINITY;
  const picked: ClipCandidate[] = [];
  const overlapsPicked = (start: number) =>
    picked.some((p) => Math.abs(p.start - start) < clipDuration);

  for (const h of opts.semantic) {
    if (picked.length >= count) break;
    const start = Math.round(Math.max(0, Math.min(maxStart, h.startSec)) * 10) / 10;
    if (overlapsPicked(start)) continue;
    picked.push({
      start,
      method: "semantic",
      title: h.title,
      reason: h.reason,
      quote: h.quote,
      score: h.score,
    });
  }

  if (picked.length < count && durationSec > 0) {
    const reason = energyFallbackReason(opts.outcome, opts.query);
    const energyPicks = pickEnergySegments(opts.energyWindows, count, clipDuration, durationSec);
    for (const seg of energyPicks) {
      if (picked.length >= count) break;
      if (overlapsPicked(seg.start)) continue;
      picked.push({
        start: seg.start,
        method: "energy",
        title: `Clip at ${formatTimestamp(seg.start)}`,
        reason,
        quote: "",
        score: null,
      });
    }
  }

  // A very short or silent video can yield no windows at all — keep the
  // rail's long-standing behavior of returning the opening segment.
  if (picked.length === 0 && durationSec > 0) {
    picked.push({
      start: 0,
      method: "energy",
      title: `Clip at ${formatTimestamp(0)}`,
      reason: energyFallbackReason(opts.outcome, opts.query),
      quote: "",
      score: null,
    });
  }

  picked.sort((a, b) => a.start - b.start);
  return picked;
}

/* ── POST /smart-clips ────────────────────────────────────────────────── */

router.post("/smart-clips", requireAuth, async (req, res) => {
  const parsed = smartClipsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { count, durationSec: clipDuration, query, vibe } = parsed.data;

  const totalCost = SMART_CLIPS_PER_CLIP * count;
  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < totalCost) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, totalCost, {
      action: `Smart Clips (${count})`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "smart-clips-"));
  const inputPath = join(workDir, "input.mp4");

  try {
    const vidRes = await fetch(parsed.data.videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!vidRes.ok) throw new Error("Could not download the video.");
    await writeFile(inputPath, Buffer.from(await vidRes.arrayBuffer()));

    /* Semantic pass (best-effort): transcribe → timestamped transcript →
       model-ranked moments. Any failure degrades to the energy signal —
       the response labels every clip with the method that found it. */
    let semantic: SemanticHighlight[] = [];
    let outcome: SemanticOutcome = "unavailable";
    let durationSec = 0;
    try {
      const transcribed = await transcribeVideoFile(inputPath, "input.mp4");
      durationSec = transcribed.durationSec;
      if (transcribed.segments.length === 0) {
        outcome = "no-speech";
      } else {
        const transcript = buildTimestampedTranscript(transcribed.segments);
        semantic = await detectSemanticHighlights(transcript, {
          clipLength: clipDuration,
          // Ask for spares: window clamping and overlap checks drop some.
          maxClips: Math.min(count + 3, 10),
          durationSec,
          query,
          vibe,
        });
        outcome = semantic.length > 0 ? "ok" : "no-match";
      }
    } catch (err) {
      outcome = "unavailable";
      req.log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "[smart-clips] semantic analysis unavailable — falling back to energy",
      );
    }

    /* Energy windows are only scanned when semantics couldn't fill the
       request on their own (the scan is the slow part of the old rail).
       Selection runs first; if overlap rules dropped it below the paid
       count, the scan runs then and selection tops up from energy. */
    if (!(durationSec > 0)) {
      durationSec = await probeDurationSec(inputPath).catch(() => 0);
    }
    let energyWindows: Segment[] = [];
    let candidates = selectClipCandidates({
      semantic,
      energyWindows,
      count,
      clipDuration,
      durationSec,
      outcome,
      query,
    });
    if (candidates.length < count && durationSec > clipDuration) {
      energyWindows = await scanWindowEnergies(inputPath, durationSec);
      candidates = selectClipCandidates({
        semantic,
        energyWindows,
        count,
        clipDuration,
        durationSec,
        outcome,
        query,
      });
    }
    const analysisMethod = candidates.every((c) => c.method === "semantic")
      ? "semantic"
      : candidates.every((c) => c.method === "energy")
        ? "energy"
        : "mixed";
    req.log.info(
      { candidates: candidates.length, analysisMethod, outcome },
      "[smart-clips] selected clip candidates",
    );

    const clips: Array<{
      url: string;
      storageRef: string;
      startTime: number;
      endTime: number;
      title: string;
      score: number | null;
      reason: string;
      quote: string;
      method: "semantic" | "energy";
    }> = [];
    for (let i = 0; i < candidates.length; i++) {
      const cand = candidates[i]!;
      const outputPath = join(workDir, `clip-${i}.mp4`);

      // Extract segment AND reframe to 9:16 in one pass
      await execFileAsync("ffmpeg", [
        "-y", "-ss", cand.start.toFixed(1), "-i", inputPath,
        "-t", clipDuration.toFixed(0),
        "-vf", "crop='if(gt(iw/ih,0.5625),ih*0.5625,iw)':'if(gt(iw/ih,0.5625),ih,iw/0.5625)',scale=1080:1920",
        "-c:v", "libx264", "-preset", "fast", "-crf", "18",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        outputPath,
      ], { timeout: 300_000 });

      const buffer = await readFile(outputPath);
      const objectName = `smart-clips/${req.userId}/${randomUUID()}.mp4`;
      const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
      const url = await refreshSupabaseStorageUrl(storageRef);

      clips.push({
        url,
        storageRef,
        startTime: cand.start,
        endTime: Math.round((cand.start + clipDuration) * 10) / 10,
        title: cand.title,
        score: cand.score,
        reason: cand.reason,
        quote: cand.quote,
        method: cand.method,
      });
      await unlink(outputPath).catch(() => {});
    }

    res.json({
      clips,
      count: clips.length,
      analysisMethod,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Smart clips failed.";
    req.log.error({ err: message }, "[smart-clips] failed");
    await refundCredits(req.userId!, totalCost, {
      action: "Smart Clips — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    await unlink(inputPath).catch(() => {});
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export { SMART_CLIPS_PER_CLIP };
export default router;
