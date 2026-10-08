import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { Request, Response, Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";

const router = Router();
const execFileAsync = promisify(execFile);

export const VOCAL_POLISH_CREDIT_COST = 200;
const VOCAL_POLISH_MAX_BYTES = 50 * 1024 * 1024; // 50 MB download cap
const ANALYSIS_SECONDS = 90; // pitch analysis window (bounded cost)

const vocalPolishSchema = z.object({
  /** Signed/http(s) URL of the source audio — same intake protocol as the audio chain. */
  audioUrl: z.string().url().max(4096),
  /** 0–100. Scales the auto-detected tuning drift toward the nearest semitone. */
  correctionStrength: z.number().min(0).max(100).default(35),
  /** −6…+6 semitones, fractional steps allowed. */
  keyShift: z.number().min(-12).max(12).default(0),
  /** 0.5…2.0 tempo factor (1 = original). */
  tempoFactor: z.number().min(0.5).max(2).default(1),
});

export type VocalPolishFilterPath = "rubberband" | "fallback";

/* ── Pure, testable helpers ─────────────────────────────────────────── */

export function semitonesToRatio(semitones: number): number {
  return Math.pow(2, semitones / 12);
}

/**
 * Formant-preserving time/pitch shift via librubberband.
 *
 * rubberband `pitch` is in semitones (fractional allowed) and shifts
 * pitch without touching tempo; `tempo` changes tempo without touching
 * pitch. This is the best-quality path: key and tempo move
 * independently and vocal formants are preserved (no chipmunk effect).
 */
export function buildRubberbandFilter(pitchSemitones: number, tempoFactor: number): string {
  return `rubberband=pitch=${pitchSemitones.toFixed(3)}:tempo=${tempoFactor.toFixed(4)}`;
}

/**
 * Fallback when the deployed ffmpeg lacks the rubberband filter.
 *
 * asetrate shifts pitch AND speed together (declared-rate trick);
 * the compensating atempo restores the original duration, and a second
 * atempo applies the user's tempo factor.
 *
 * Honest limitation: this path does NOT preserve formants — large key
 * shifts sound increasingly chipmunk-like compared to rubberband. The
 * job records which path was used so the UI can say so.
 */
export function buildFallbackFilter(
  pitchSemitones: number,
  tempoFactor: number,
  sampleRate = 44100,
): string {
  const ratio = semitonesToRatio(pitchSemitones);
  const restore = tempoFactor / ratio;
  const clampedRestore = Math.min(100, Math.max(0.5, restore));
  return (
    `aresample=${sampleRate},` +
    `asetrate=${Math.round(sampleRate * ratio)},` +
    `aresample=${sampleRate},` +
    `atempo=${clampedRestore.toFixed(4)}`
  );
}

/**
 * Total fractional-semitone pitch shift: user key shift + the
 * strength-scaled auto-detected tuning correction. The tuning nudge is
 * capped at ±50 cents — this is a gentle nudge, never a hard snap.
 */
export function computeTotalPitchShift(
  keyShift: number,
  detectedCentsOffset: number | null,
  strength: number,
): { total: number; appliedCents: number } {
  let appliedCents = 0;
  if (detectedCentsOffset != null && Math.abs(detectedCentsOffset) >= 5 && strength > 0) {
    appliedCents = Math.max(-50, Math.min(50, (-detectedCentsOffset * strength) / 100));
  }
  return { total: keyShift + appliedCents / 100, appliedCents };
}

/* ── Filter availability probe (cached per process) ─────────────────── */

let rubberbandAvailable: boolean | null = null;

export async function hasRubberbandFilter(): Promise<boolean> {
  if (rubberbandAvailable != null) return rubberbandAvailable;
  try {
    await execFileAsync("ffmpeg", ["-hide_banner", "-h", "filter=rubberband"], { timeout: 15_000 });
    rubberbandAvailable = true;
  } catch {
    rubberbandAvailable = false;
  }
  return rubberbandAvailable;
}

/** Test hook: reset the cached probe. */
export function __resetRubberbandProbe(): void {
  rubberbandAvailable = null;
}

/* ── Tuning analysis (python3 + numpy; non-fatal if unavailable) ────── */

const PITCH_SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "lib",
  "pitch-analyze.py",
);

export interface TuningAnalysis {
  medianCentsOffset: number | null;
  voicedFrames: number;
  confident: boolean;
  skipped: boolean;
}

export async function analyzeTuning(inputPath: string): Promise<TuningAnalysis> {
  const python = process.env.DEMUCS_PYTHON || "python3";
  const workDir = await fs.mkdtemp(join(tmpdir(), "vocal-polish-analyze-"));
  try {
    const pcmPath = join(workDir, "analysis.f32");
    await execFileAsync(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        inputPath,
        "-ar",
        "8000",
        "-ac",
        "1",
        "-af",
        "highpass=f=150",
        "-f",
        "f32le",
        "-t",
        String(ANALYSIS_SECONDS),
        "-y",
        pcmPath,
      ],
      { timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
    );
    const { stdout } = await execFileAsync(python, [PITCH_SCRIPT, pcmPath], {
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const parsed = JSON.parse(String(stdout)) as {
      medianCentsOffset?: number;
      voicedFrames?: number;
      confident?: boolean;
    };
    return {
      medianCentsOffset: typeof parsed.medianCentsOffset === "number" ? parsed.medianCentsOffset : null,
      voicedFrames: typeof parsed.voicedFrames === "number" ? parsed.voicedFrames : 0,
      confident: parsed.confident === true,
      skipped: false,
    };
  } catch {
    // numpy/python missing, decode failure, timeout — tuning nudge is
    // skipped, key/tempo shifts still run. Never fail the job for this.
    return { medianCentsOffset: null, voicedFrames: 0, confident: false, skipped: true };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ── Server-owned background jobs (in-memory; not tab-dependent) ───── */

export type VocalPolishJobStatus = "queued" | "processing" | "done" | "failed";

export interface VocalPolishJob {
  id: string;
  userId: string;
  status: VocalPolishJobStatus;
  audioUrl: string;
  correctionStrength: number;
  keyShift: number;
  tempoFactor: number;
  outputUrl: string | null;
  outputRef: string | null;
  detectedTuningCents: number | null;
  tuningAppliedCents: number;
  tuningSkipped: boolean;
  filterPath: VocalPolishFilterPath | null;
  error: string | null;
  creditsCharged: number;
  createdAt: number;
}

const jobs = new Map<string, VocalPolishJob>();

export function getVocalPolishJob(id: string): VocalPolishJob | undefined {
  return jobs.get(id);
}

/** Test hook: clear the in-memory job store. */
export function __clearVocalPolishJobs(): void {
  jobs.clear();
}

/** Exported for tests. */
export async function runVocalPolishJob(job: VocalPolishJob): Promise<void> {
  const workDir = await fs.mkdtemp(join(tmpdir(), "vocal-polish-"));
  const inputPath = join(workDir, "input.bin");
  const outputPath = join(workDir, "polished.mp3");

  try {
    job.status = "processing";

    // Download the source audio (server-side; the tab can be closed).
    const res = await fetch(job.audioUrl);
    if (!res.ok) throw new Error(`Could not download the source audio (HTTP ${res.status})`);
    const contentLength = Number(res.headers.get("content-length") ?? 0);
    if (contentLength > VOCAL_POLISH_MAX_BYTES) {
      throw new Error("Source audio exceeds the 50 MB limit");
    }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > VOCAL_POLISH_MAX_BYTES) {
      throw new Error("Source audio is empty or exceeds the 50 MB limit");
    }
    await fs.writeFile(inputPath, buf);

    // Global tuning drift analysis (non-fatal; skipped when unavailable).
    const tuning = await analyzeTuning(inputPath);
    job.detectedTuningCents = tuning.confident ? tuning.medianCentsOffset : null;
    job.tuningSkipped = tuning.skipped || !tuning.confident;

    const { total: pitchShift, appliedCents } = computeTotalPitchShift(
      job.keyShift,
      tuning.confident ? tuning.medianCentsOffset : null,
      job.correctionStrength,
    );
    job.tuningAppliedCents = appliedCents;

    const useRubberband = await hasRubberbandFilter();
    const filter = useRubberband
      ? buildRubberbandFilter(pitchShift, job.tempoFactor)
      : buildFallbackFilter(pitchShift, job.tempoFactor);
    job.filterPath = useRubberband ? "rubberband" : "fallback";

    try {
      await execFileAsync(
        "ffmpeg",
        [
          "-y",
          "-i",
          inputPath,
          "-af",
          filter,
          "-codec:a",
          "libmp3lame",
          "-b:a",
          "192k",
          "-ar",
          "44100",
          outputPath,
        ],
        { timeout: 600_000, maxBuffer: 16 * 1024 * 1024 },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (useRubberband && /No such filter/i.test(msg)) {
        // Deployed ffmpeg lacks rubberband despite the probe — fall back.
        job.filterPath = "fallback";
        await execFileAsync(
          "ffmpeg",
          [
            "-y",
            "-i",
            inputPath,
            "-af",
            buildFallbackFilter(pitchShift, job.tempoFactor),
            "-codec:a",
            "libmp3lame",
            "-b:a",
            "192k",
            "-ar",
            "44100",
            outputPath,
          ],
          { timeout: 600_000, maxBuffer: 16 * 1024 * 1024 },
        );
      } else {
        throw err;
      }
    }

    const outBuffer = await fs.readFile(outputPath);
    const objectName = `vocal-polish/${job.userId}/${Date.now()}-${job.id}.mp3`;
    const ref = await uploadMediaToSupabaseStorage(objectName, outBuffer, "audio/mpeg");
    const url = await refreshSupabaseStorageUrl(ref);

    job.status = "done";
    job.outputUrl = url;
    job.outputRef = ref;
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : "Vocal polish failed";
    // Refund: the user paid for an output they didn't get.
    try {
      await refundCredits(job.userId, job.creditsCharged, {
        action: "AI Vocal Polish — Refund (job failed)",
      });
    } catch (refundErr) {
      void refundErr;
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ── Routes ─────────────────────────────────────────────────────────── */

/**
 * POST /api/vocal-polish
 *
 * Suno-parity vocal finishing: gentle tuning nudge toward the nearest
 * semitone (auto-detected global drift, strength-scaled — not
 * note-by-note autotune), key shift (±semitones, formant-preserving),
 * and tempo shift — all via ffmpeg.
 *
 * The tuning nudge corrects the *average* drift of the dominant pitched
 * content (best on isolated vocals; on a full mix the detector follows
 * the strongest pitched material). It cannot fix individual sour
 * notes — the UI copy must never promise that.
 *
 * Flow: audioUrl + settings → 402 pre-check → charge 200 Visual Bucs →
 * server-owned background job → poll GET /api/vocal-polish/:jobId →
 * download result. Failed jobs are refunded automatically.
 */
router.post("/vocal-polish", requireAuth, async (req: Request, res: Response) => {
  const parsed = vocalPolishSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { audioUrl, correctionStrength, keyShift, tempoFactor } = parsed.data;

  const balance = req.userCredits ?? 0;
  if (balance < VOCAL_POLISH_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to polish vocals.",
    });
    return;
  }

  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, VOCAL_POLISH_CREDIT_COST, {
      action: `AI Vocal Polish (tuning ${Math.round(correctionStrength)}% · ${keyShift >= 0 ? "+" : ""}${keyShift} st · ${tempoFactor}x)`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to polish vocals.",
      });
      return;
    }
    if (err instanceof LedgerWriteError) {
      res.status(500).json({ error: "Could not record the Visual Buc charge. Please try again." });
      return;
    }
    throw err;
  }

  const job: VocalPolishJob = {
    id: randomUUID(),
    userId: req.userId!,
    status: "queued",
    audioUrl,
    correctionStrength,
    keyShift,
    tempoFactor,
    outputUrl: null,
    outputRef: null,
    detectedTuningCents: null,
    tuningAppliedCents: 0,
    tuningSkipped: false,
    filterPath: null,
    error: null,
    creditsCharged: VOCAL_POLISH_CREDIT_COST,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);

  // Server-owned: runs detached from the request/tab lifecycle.
  void runVocalPolishJob(job);

  res.status(202).json({
    jobId: job.id,
    status: job.status,
    creditsCharged: VOCAL_POLISH_CREDIT_COST,
    creditsRemaining,
  });
});

/**
 * GET /api/vocal-polish/:jobId
 *
 * Poll job status. Returns outputUrl + tuning/filter-path details when
 * done (a signed, reviewable URL for the polished audio retained in
 * Supabase storage).
 */
router.get("/vocal-polish/:jobId", requireAuth, (req: Request, res: Response) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const job = jobs.get(jobId);
  if (!job || job.userId !== req.userId) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({
    jobId: job.id,
    status: job.status,
    outputUrl: job.outputUrl,
    detectedTuningCents: job.detectedTuningCents,
    tuningAppliedCents: job.tuningAppliedCents,
    tuningSkipped: job.tuningSkipped,
    filterPath: job.filterPath,
    keyShift: job.keyShift,
    tempoFactor: job.tempoFactor,
    error: job.error,
    createdAt: job.createdAt,
  });
});

export default router;
