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
  type SemanticVibe,
} from "../../lib/semantic-highlights";

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── Smart clips (unified auto-clip extraction) ───
   TWO-STEP flow — the AI proposes, the creator disposes:
   1. POST /smart-clips/propose analyzes a long video and returns ranked
      moment proposals (start/end, title, score, reason, and the
      transcript excerpt each came from). Nothing is rendered and
      nothing is charged at this step.
   2. POST /smart-clips renders EXACTLY the windows the creator approved
      (they may trim start/end first) as vertical shorts (9:16). There
      is no auto-render path: a render request without an explicit
      approved-clips list is refused.
   200 Visual Bucs per RENDERED clip — one charge for the whole render
   job, refunded in full if the job fails (the rail's charge discipline
   is unchanged; analysis was never a separate charge).

   Moment finding is SEMANTIC first (ported from the streamer-clips
   rail): the video is transcribed with timed transcription
   (lib/transcription.ts) and the text model ranks moments with a score
   + one-line reason, optionally matching a free-text description from
   the creator ("find the part where I explain pricing"). Audio ENERGY
   (ffmpeg astats) remains as the fallback signal: when there is no
   speech to analyze, the semantic pass finds nothing, or it errors,
   energy picks fill the request — and every proposal says which method
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

/* ── Render step: only creator-approved windows ─────────────────────────
   The render request carries the proposals the creator kept, with the
   start/end they settled on (trimming a proposal is the whole point of
   the approval step). Display metadata (title/reason/quote/score/method)
   rides along so finished clips keep the labels the creator approved. */
export const APPROVED_CLIP_MIN_SEC = 5;
export const APPROVED_CLIP_MAX_SEC = 120;

const approvedClipSchema = z.object({
  startTime: z.number().finite().min(0),
  endTime: z.number().finite().positive(),
  title: z.string().trim().max(120).optional(),
  reason: z.string().trim().max(300).optional(),
  quote: z.string().trim().max(200).optional(),
  score: z.number().finite().min(0).max(100).nullable().optional(),
  method: z.enum(["semantic", "energy"]).optional(),
});

export const smartClipsRenderSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  /** REQUIRED and non-empty — its absence is what makes auto-render
   *  impossible: the server never chooses windows at render time. */
  clips: z.array(approvedClipSchema).min(1).max(MAX_CLIPS),
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

/** A proposal the creator approved (possibly trimmed): a ClipCandidate
 *  window plus its explicit end. */
export interface ApprovedClip extends ClipCandidate {
  end: number;
}

/**
 * Validate + normalize the creator-approved windows against the probed
 * video duration. Pure — exported for tests. Windows that end up shorter
 * than APPROVED_CLIP_MIN_SEC after clamping are dropped; if every window
 * drops, the caller refuses the render (400) rather than rendering
 * something the creator didn't approve. Ends clamp to the video end;
 * lengths clamp to APPROVED_CLIP_MAX_SEC. Duplicate windows collapse.
 * Returned in timeline order.
 */
export function normalizeApprovedClips(
  clips: Array<{
    startTime: number;
    endTime: number;
    title?: string;
    reason?: string;
    quote?: string;
    score?: number | null;
    method?: "semantic" | "energy";
  }>,
  durationSec: number,
): ApprovedClip[] {
  const out: ApprovedClip[] = [];
  for (const c of clips) {
    const start = Math.round(Math.max(0, c.startTime) * 10) / 10;
    let end = Math.round(c.endTime * 10) / 10;
    if (durationSec > 0) end = Math.min(end, Math.round(durationSec * 10) / 10);
    if (end - start > APPROVED_CLIP_MAX_SEC) end = start + APPROVED_CLIP_MAX_SEC;
    if (end - start < APPROVED_CLIP_MIN_SEC) continue;
    if (out.some((e) => Math.abs(e.start - start) < 0.05 && Math.abs(e.end - end) < 0.05)) continue;
    const method = c.method ?? "semantic";
    out.push({
      start,
      end,
      method,
      title: c.title?.trim() ? c.title.trim() : `Clip at ${formatTimestamp(start)}`,
      reason: c.reason ?? "",
      quote: c.quote ?? "",
      // Honesty pin: an energy window never gains a score at render time.
      score: method === "energy" ? null : (c.score ?? null),
    });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

/** The set-level method label shared by the propose + render responses. */
export function analysisMethodOf(
  picks: Array<{ method: "semantic" | "energy" }>,
): "semantic" | "mixed" | "energy" {
  if (picks.length > 0 && picks.every((c) => c.method === "semantic")) return "semantic";
  if (picks.every((c) => c.method === "energy")) return "energy";
  return "mixed";
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

/* ── Shared analysis (propose step) ─────────────────────────────────────
   Transcribe → semantic ranking → energy fallback → candidate merge.
   Used by POST /smart-clips/propose only. The render step never calls
   this: it renders only what the creator approved. */
async function analyzeClipCandidates(
  inputPath: string,
  opts: { count: number; clipDuration: number; query?: string; vibe?: SemanticVibe },
  onSemanticUnavailable?: (err: unknown) => void,
): Promise<{ candidates: ClipCandidate[]; durationSec: number; outcome: SemanticOutcome }> {
  const { count, clipDuration, query, vibe } = opts;

  /* Semantic pass (best-effort): transcribe → timestamped transcript →
     model-ranked moments. Any failure degrades to the energy signal —
     every proposal labels the method that found it. */
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
    onSemanticUnavailable?.(err);
  }

  /* Energy windows are only scanned when semantics couldn't fill the
     request on their own (the scan is the slow part of the old rail).
     Selection runs first; if overlap rules dropped it below the
     requested count, the scan runs then and selection tops up. */
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
  return { candidates, durationSec, outcome };
}

/* ── POST /smart-clips/propose — analysis ONLY ──────────────────────────
   Returns ranked proposals for the creator to approve, trim, or drop.
   Renders NOTHING and charges NOTHING — rendering happens only in the
   render step below, only for windows the creator sends back. */
router.post("/smart-clips/propose", requireAuth, async (req, res) => {
  const parsed = smartClipsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { count, durationSec: clipDuration, query, vibe } = parsed.data;

  const workDir = await mkdtemp(join(tmpdir(), "smart-clips-propose-"));
  const inputPath = join(workDir, "input.mp4");
  try {
    const vidRes = await fetch(parsed.data.videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!vidRes.ok) throw new Error("Could not download the video.");
    await writeFile(inputPath, Buffer.from(await vidRes.arrayBuffer()));

    const { candidates, durationSec, outcome } = await analyzeClipCandidates(
      inputPath,
      { count, clipDuration, query, vibe },
      (err) =>
        req.log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "[smart-clips] semantic analysis unavailable — falling back to energy",
        ),
    );
    req.log.info(
      { candidates: candidates.length, analysisMethod: analysisMethodOf(candidates), outcome },
      "[smart-clips] proposed clip candidates",
    );

    res.json({
      proposals: candidates.map((c) => ({
        startTime: c.start,
        endTime: Math.round((c.start + clipDuration) * 10) / 10,
        title: c.title,
        score: c.score,
        reason: c.reason,
        quote: c.quote,
        method: c.method,
      })),
      count: candidates.length,
      analysisMethod: analysisMethodOf(candidates),
      durationSec,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Smart clip analysis failed.";
    req.log.error({ err: message }, "[smart-clips] propose failed");
    res.status(500).json({ error: message });
  } finally {
    await unlink(inputPath).catch(() => {});
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

/* ── POST /smart-clips — render creator-approved windows ONLY ──────────
   The request MUST carry the approved clips (see smartClipsRenderSchema):
   without them the request is refused, so no code path exists where the
   server picks moments and renders them unapproved. Charge = 200 VB per
   rendered clip, taken once the approved windows validate against the
   actual video, and refunded in full if the render job fails. */
router.post("/smart-clips", requireAuth, async (req, res) => {
  const parsed = smartClipsRenderSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      message:
        "Smart Clips renders only the moments you approved — find moments first, keep the ones you want, then render.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const workDir = await mkdtemp(join(tmpdir(), "smart-clips-"));
  const inputPath = join(workDir, "input.mp4");
  let totalCost = 0;
  let charged = false;

  try {
    const vidRes = await fetch(parsed.data.videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!vidRes.ok) throw new Error("Could not download the video.");
    await writeFile(inputPath, Buffer.from(await vidRes.arrayBuffer()));

    const durationSec = await probeDurationSec(inputPath).catch(() => 0);
    const approved = normalizeApprovedClips(parsed.data.clips, durationSec);
    if (approved.length === 0) {
      res.status(400).json({
        error: "no_valid_clips",
        message:
          "None of the approved moments fit inside this video — adjust the start/end times and try again.",
      });
      return;
    }

    totalCost = SMART_CLIPS_PER_CLIP * approved.length;
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
        action: `Smart Clips (${approved.length})`,
      });
      charged = true;
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
        return;
      }
      throw err;
    }

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
    for (let i = 0; i < approved.length; i++) {
      const cand = approved[i]!;
      const outputPath = join(workDir, `clip-${i}.mp4`);
      const lengthSec = Math.round((cand.end - cand.start) * 10) / 10;

      // Extract the approved window AND reframe to 9:16 in one pass
      await execFileAsync("ffmpeg", [
        "-y", "-ss", cand.start.toFixed(1), "-i", inputPath,
        "-t", lengthSec.toFixed(1),
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
        endTime: cand.end,
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
      analysisMethod: analysisMethodOf(approved),
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Smart clips failed.";
    req.log.error({ err: message }, "[smart-clips] failed");
    if (charged) {
      await refundCredits(req.userId!, totalCost, {
        action: "Smart Clips — Refund",
      }).catch(() => {});
    }
    res.status(500).json({ error: message });
  } finally {
    await unlink(inputPath).catch(() => {});
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});


export { SMART_CLIPS_PER_CLIP };
export default router;
