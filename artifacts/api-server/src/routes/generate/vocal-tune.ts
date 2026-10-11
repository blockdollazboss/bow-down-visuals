import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import { Request, Response, Router } from "express";
import { z } from "zod";
import multer from "multer";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";
/* Transparent style reuses vocal-polish's gentle global-drift engine —
   same DSP helpers, same honest limits. Hard-tune needs note-by-note
   snapping, which that engine cannot do, so it lives here. */
import {
  analyzeTuning,
  computeTotalPitchShift,
  buildRubberbandFilter,
  buildFallbackFilter,
  hasRubberbandFilter,
  semitonesToRatio,
} from "./vocal-polish";

const router = Router();
const execFileAsync = promisify(execFile);

/** PLACEHOLDER — NOT USER-APPROVED. Matches vocal-polish's 200 VB. */
export const VOCAL_TUNE_CREDIT_COST = 200;
const VOCAL_TUNE_MAX_BYTES = 50 * 1024 * 1024; // 50 MB upload/download cap
const MAX_SEGMENTS = 700; // filtergraph sanity cap for the hard-tune path
const MIN_SEGMENT_SECONDS = 0.08; // acrossfade needs segments comfortably longer than the fade
const ACROSSFADE_SECONDS = 0.02;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: VOCAL_TUNE_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error("Only audio files are allowed (MP3, WAV, M4A, AAC, OGG, FLAC)"));
    }
  },
});

const vocalTuneSchema = z.object({
  /** Signed/http(s) URL of the source audio (JSON intake; multipart uses the uploaded file). */
  audioUrl: z.string().url().max(4096).optional(),
  /** transparent = gentle global nudge; hardtune = note-by-note snap to the nearest semitone. */
  style: z.enum(["transparent", "hardtune"]).default("transparent"),
  /** −12…+12 semitones, fractional steps allowed. */
  keyShift: z.coerce.number().min(-12).max(12).default(0),
  /** 0.5…2.0 tempo factor (1 = original). */
  tempoFactor: z.coerce.number().min(0.5).max(2).default(1),
});

export type VocalTuneStyle = "transparent" | "hardtune";
export type VocalTuneFilterPath = "rubberband" | "fallback";

export interface TuneNote {
  start: number;
  end: number;
  shiftCents: number;
}

export interface TuneSegment {
  start: number;
  end: number;
  /** Total pitch shift in semitones (keyShift + quantized correction). */
  pitch: number;
}

/* ── Pure, testable helpers ─────────────────────────────────────────── */

function quantize(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/**
 * Lay note corrections over the full timeline, filling unvoiced gaps
 * with the bare keyShift, then merging adjacent segments that share a
 * pitch and absorbing segments too short for a clean acrossfade.
 *
 * The user's keyShift is kept exact — only the correction part is
 * quantized — so an unvoiced gap never audibly drifts from the
 * requested key.
 */
export function buildTuneSegments(
  notes: TuneNote[],
  duration: number,
  keyShift: number,
  quantStepSemitones: number,
): TuneSegment[] {
  const raw: TuneSegment[] = [];
  let cursor = 0;
  const sorted = [...notes].sort((a, b) => a.start - b.start);
  for (const n of sorted) {
    const s = Math.max(0, Math.min(duration, n.start));
    const e = Math.max(0, Math.min(duration, n.end));
    if (s > cursor + 1e-6) raw.push({ start: cursor, end: s, pitch: keyShift });
    if (e > s) {
      raw.push({
        start: s,
        end: e,
        pitch: keyShift + quantize(n.shiftCents / 100, quantStepSemitones),
      });
    }
    cursor = Math.max(cursor, e);
  }
  if (cursor < duration - 1e-6) raw.push({ start: cursor, end: duration, pitch: keyShift });

  // Merge adjacent segments with identical pitch.
  const merged: TuneSegment[] = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && Math.abs(last.pitch - r.pitch) < 1e-9 && Math.abs(last.end - r.start) < 1e-3) {
      last.end = r.end;
    } else {
      merged.push({ ...r });
    }
  }

  // Absorb segments too short for a clean acrossfade into the previous
  // segment (keeps the filtergraph valid; the mistuned blip is <80 ms).
  const out: TuneSegment[] = [];
  for (const seg of merged) {
    const last = out[out.length - 1];
    if (last && seg.end - seg.start < MIN_SEGMENT_SECONDS) {
      last.end = seg.end;
    } else {
      out.push({ ...seg });
    }
  }
  return out.filter((s) => s.end - s.start > 1e-3);
}

/** Per-segment pitch shift without rubberband: the declared-rate trick
 *  (same honest limitation as vocal-polish's fallback — no formant
 *  preservation on large shifts). */
function fallbackPitchChain(pitchSemitones: number, sampleRate = 44100): string {
  const ratio = semitonesToRatio(pitchSemitones);
  const restore = 1 / ratio;
  const clamped = Math.min(2, Math.max(0.5, restore));
  return (
    `aresample=${sampleRate},` +
    `asetrate=${Math.round(sampleRate * ratio)},` +
    `aresample=${sampleRate},` +
    `atempo=${clamped.toFixed(4)}`
  );
}

/**
 * Build the full hard-tune filtergraph: per-segment pitch shifts joined
 * by 20 ms crossfades, then the global tempo factor on the mix.
 *
 * Single-segment fast path keeps tiny jobs to one filter. The input pad
 * is explicitly asplit — never rely on implicit fan-out.
 */
export function buildHardtuneFilterGraph(
  segments: TuneSegment[],
  tempoFactor: number,
  useRubberband: boolean,
): string {
  if (segments.length === 0) throw new Error("No tune segments");
  const tempo = tempoFactor.toFixed(4);

  if (segments.length === 1) {
    const p = segments[0].pitch;
    return useRubberband
      ? `[0:a]rubberband=pitch=${p.toFixed(3)}:tempo=${tempo}[aout]`
      : `[0:a]${fallbackPitchChain(p)},atempo=${tempo}[aout]`;
  }

  const labels = segments.map((_, i) => `a${i}`).join("][");
  const parts: string[] = [`[0:a]asplit=${segments.length}[${labels}]`];
  segments.forEach((s, i) => {
    const trim = `atrim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},asetpts=PTS-START`;
    const shift = useRubberband
      ? `rubberband=pitch=${s.pitch.toFixed(3)}`
      : fallbackPitchChain(s.pitch);
    parts.push(`[a${i}]${trim},${shift}[s${i}]`);
  });

  parts.push(`[s0][s1]acrossfade=d=${ACROSSFADE_SECONDS}:c1=tri:c2=tri[x1]`);
  for (let i = 2; i < segments.length; i++) {
    parts.push(`[x${i - 1}][s${i}]acrossfade=d=${ACROSSFADE_SECONDS}:c1=tri:c2=tri[x${i}]`);
  }
  const lastX = `x${segments.length - 1}`;
  parts.push(
    useRubberband
      ? `[${lastX}]rubberband=tempo=${tempo}[aout]`
      : `[${lastX}]atempo=${tempo}[aout]`,
  );
  return parts.join(";");
}

/* ── Note-level pitch tracking (python3 + numpy; non-fatal) ─────────── */

const PITCH_TRACK_SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "lib",
  "pitch-track.py",
);

export interface NoteTracking {
  notes: TuneNote[];
  voicedFrames: number;
  confident: boolean;
  skipped: boolean;
}

export async function trackNotes(inputPath: string): Promise<NoteTracking> {
  const python = process.env.DEMUCS_PYTHON || "python3";
  const workDir = await fs.mkdtemp(join(tmpdir(), "vocal-tune-track-"));
  try {
    const pcmPath = join(workDir, "track.f32");
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
        "-y",
        pcmPath,
      ],
      { timeout: 300_000, maxBuffer: 16 * 1024 * 1024 },
    );
    const { stdout } = await execFileAsync(python, [PITCH_TRACK_SCRIPT, pcmPath], {
      timeout: 300_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const parsed = JSON.parse(String(stdout)) as {
      notes?: Array<{ start?: number; end?: number; shiftCents?: number }>;
      voicedFrames?: number;
      confident?: boolean;
    };
    const notes: TuneNote[] = Array.isArray(parsed.notes)
      ? parsed.notes
          .filter(
            (n) =>
              typeof n.start === "number" &&
              typeof n.end === "number" &&
              typeof n.shiftCents === "number" &&
              n.end > n.start,
          )
          .map((n) => ({ start: n.start!, end: n.end!, shiftCents: n.shiftCents! }))
      : [];
    return {
      notes,
      voicedFrames: typeof parsed.voicedFrames === "number" ? parsed.voicedFrames : 0,
      confident: parsed.confident === true && notes.length > 0,
      skipped: false,
    };
  } catch {
    // numpy/python missing, decode failure, timeout — the job falls back
    // to the gentle global correction and says so honestly.
    return { notes: [], voicedFrames: 0, confident: false, skipped: true };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function probeDurationSeconds(inputPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", inputPath],
      { timeout: 30_000 },
    );
    const d = parseFloat(String(stdout).trim());
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch {
    return null;
  }
}

/* ── Server-owned background jobs (in-memory; not tab-dependent) ───── */

export type VocalTuneJobStatus = "queued" | "processing" | "done" | "failed";

export interface VocalTuneJob {
  id: string;
  userId: string;
  status: VocalTuneJobStatus;
  style: VocalTuneStyle;
  keyShift: number;
  tempoFactor: number;
  sourceName: string;
  outputUrl: string | null;
  outputRef: string | null;
  /** Hard-tune: how many note segments got a non-zero snap. */
  notesCorrected: number;
  /** Transparent: cents actually applied (mirrors vocal-polish). */
  tuningAppliedCents: number;
  /** True when hard-tune fell back to the gentle global correction. */
  hardtuneFallback: boolean;
  filterPath: VocalTuneFilterPath | null;
  error: string | null;
  creditsCharged: number;
  createdAt: number;
}

const jobs = new Map<string, VocalTuneJob>();

export function getVocalTuneJob(id: string): VocalTuneJob | undefined {
  return jobs.get(id);
}

/** Test hook: clear the in-memory job store. */
export function __clearVocalTuneJobs(): void {
  jobs.clear();
}

async function runGentlePass(
  job: VocalTuneJob,
  inputPath: string,
  outputPath: string,
): Promise<void> {
  // The transparent engine: auto-detected global drift, strength-scaled,
  // capped at ±50 cents — a gentle nudge, never a hard snap.
  const tuning = await analyzeTuning(inputPath);
  const { total: pitchShift, appliedCents } = computeTotalPitchShift(
    job.keyShift,
    tuning.confident ? tuning.medianCentsOffset : null,
    15, // transparent = low strength, slow natural feel
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
      ["-y", "-i", inputPath, "-af", filter, "-codec:a", "libmp3lame", "-b:a", "192k", "-ar", "44100", outputPath],
      { timeout: 600_000, maxBuffer: 16 * 1024 * 1024 },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (useRubberband && /No such filter/i.test(msg)) {
      job.filterPath = "fallback";
      await execFileAsync(
        "ffmpeg",
        ["-y", "-i", inputPath, "-af", buildFallbackFilter(pitchShift, job.tempoFactor), "-codec:a", "libmp3lame", "-b:a", "192k", "-ar", "44100", outputPath],
        { timeout: 600_000, maxBuffer: 16 * 1024 * 1024 },
      );
    } else {
      throw err;
    }
  }
}

/** Exported for tests. */
export async function runVocalTuneJob(job: VocalTuneJob, sourceBuffer: Buffer): Promise<void> {
  const workDir = await fs.mkdtemp(join(tmpdir(), "vocal-tune-"));
  const inputPath = join(workDir, "input.bin");
  const outputPath = join(workDir, "tuned.mp3");

  try {
    job.status = "processing";
    await fs.writeFile(inputPath, sourceBuffer);

    if (job.style === "transparent") {
      await runGentlePass(job, inputPath, outputPath);
    } else {
      // ── Hard-tune: note-by-note snap to the nearest semitone ──
      const duration = await probeDurationSeconds(inputPath);
      const tracking = await trackNotes(inputPath);
      const useRubberband = await hasRubberbandFilter();
      job.filterPath = useRubberband ? "rubberband" : "fallback";

      let segments: TuneSegment[] | null = null;
      if (tracking.confident && duration != null) {
        // Adaptive quantization: coarsen the snap until the filtergraph
        // fits the segment cap. 10-cent steps first (inaudible coarsening).
        for (const step of [0.1, 0.25, 0.5, 1.0]) {
          const candidate = buildTuneSegments(tracking.notes, duration, job.keyShift, step);
          if (candidate.length <= MAX_SEGMENTS) {
            segments = candidate;
            break;
          }
        }
      }

      if (segments && segments.length > 0) {
        job.notesCorrected = segments.filter((s) => Math.abs(s.pitch - job.keyShift) > 1e-9).length;
        const graph = buildHardtuneFilterGraph(segments, job.tempoFactor, useRubberband);
        await execFileAsync(
          "ffmpeg",
          [
            "-y",
            "-i",
            inputPath,
            "-filter_complex",
            graph,
            "-map",
            "[aout]",
            "-codec:a",
            "libmp3lame",
            "-b:a",
            "192k",
            "-ar",
            "44100",
            outputPath,
          ],
          { timeout: 900_000, maxBuffer: 16 * 1024 * 1024 },
        );
      } else {
        // Honest fallback: note-level tracking unavailable or the song is
        // too dense to segment — apply the gentle global correction and
        // say so in the job record and the UI.
        job.hardtuneFallback = true;
        job.notesCorrected = 0;
        await runGentlePass(job, inputPath, outputPath);
      }
    }

    const outBuffer = await fs.readFile(outputPath);
    const objectName = `vocal-tune/${job.userId}/${Date.now()}-${job.id}.mp3`;
    const ref = await uploadMediaToSupabaseStorage(objectName, outBuffer, "audio/mpeg");
    const url = await refreshSupabaseStorageUrl(ref);

    job.status = "done";
    job.outputUrl = url;
    job.outputRef = ref;
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : "Vocal tuning failed";
    // Refund: the user paid for an output they didn't get.
    try {
      await refundCredits(job.userId, job.creditsCharged, {
        action: "Vocal Tuning — Refund (job failed)",
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
 * POST /api/vocal-tune
 *
 * Vocal tuning / pitch correction, two styles, zero paid calls — real
 * ffmpeg DSP only:
 *
 * - transparent: gentle global tuning nudge (vocal-polish's engine:
 *   auto-detected drift, low strength, ±50-cent cap). Natural, slow
 *   feel — the correction you don't hear.
 * - hardtune: note-by-note snap of every detected note to its nearest
 *   semitone (strength 100, instant retune) via per-segment rubberband
 *   shifts joined by 20 ms crossfades. The modern hard-tune effect.
 *
 * Intake: multipart `audio` file (preferred — matches the audio-studio
 * upload panels) or JSON { audioUrl }. Optional keyShift (±12 st) and
 * tempoFactor (0.5–2). Works best on isolated vocals; on a full mix the
 * tracker follows the strongest pitched material.
 *
 * Flow: audio + style → 402 pre-check → charge 200 Visual Bucs →
 * server-owned background job → poll GET /api/vocal-tune/:jobId →
 * download result. Failed jobs are refunded automatically.
 */
router.post("/vocal-tune", requireAuth, upload.single("audio"), async (req: Request, res: Response) => {
  const parsed = vocalTuneSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { audioUrl, style, keyShift, tempoFactor } = parsed.data;

  let sourceBuffer: Buffer | null = null;
  let sourceName = "audio";
  if (req.file) {
    sourceBuffer = req.file.buffer;
    sourceName = req.file.originalname;
  } else if (audioUrl) {
    try {
      const dl = await fetch(audioUrl);
      if (!dl.ok) throw new Error(`HTTP ${dl.status}`);
      const len = Number(dl.headers.get("content-length") ?? 0);
      if (len > VOCAL_TUNE_MAX_BYTES) throw new Error("exceeds the 50 MB limit");
      const buf = Buffer.from(await dl.arrayBuffer());
      if (buf.length === 0 || buf.length > VOCAL_TUNE_MAX_BYTES) throw new Error("empty or exceeds the 50 MB limit");
      sourceBuffer = buf;
      sourceName = "audio-url";
    } catch (err) {
      res.status(400).json({
        error: `Could not download the source audio (${err instanceof Error ? err.message : "fetch failed"}).`,
      });
      return;
    }
  } else {
    res.status(400).json({ error: "No audio file provided — upload a file or pass audioUrl." });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < VOCAL_TUNE_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to tune vocals.",
    });
    return;
  }

  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, VOCAL_TUNE_CREDIT_COST, {
      action: `Vocal Tuning (${style === "hardtune" ? "Hard-tune" : "Transparent"}${keyShift !== 0 ? ` · ${keyShift >= 0 ? "+" : ""}${keyShift} st` : ""}${tempoFactor !== 1 ? ` · ${tempoFactor}x` : ""})`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to tune vocals.",
      });
      return;
    }
    if (err instanceof LedgerWriteError) {
      res.status(500).json({ error: "Could not record the Visual Buc charge. Please try again." });
      return;
    }
    throw err;
  }

  const job: VocalTuneJob = {
    id: randomUUID(),
    userId: req.userId!,
    status: "queued",
    style,
    keyShift,
    tempoFactor,
    sourceName,
    outputUrl: null,
    outputRef: null,
    notesCorrected: 0,
    tuningAppliedCents: 0,
    hardtuneFallback: false,
    filterPath: null,
    error: null,
    creditsCharged: VOCAL_TUNE_CREDIT_COST,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);

  // Server-owned: runs detached from the request/tab lifecycle.
  void runVocalTuneJob(job, sourceBuffer);

  res.status(202).json({
    jobId: job.id,
    status: job.status,
    style: job.style,
    creditsCharged: VOCAL_TUNE_CREDIT_COST,
    creditsRemaining,
  });
});

/**
 * GET /api/vocal-tune/:jobId
 *
 * Poll job status. Returns outputUrl when done (a signed, reviewable
 * URL for the tuned audio retained in Supabase storage), plus style,
 * notesCorrected, filterPath, and hardtuneFallback so the UI can be
 * honest about what DSP actually ran.
 */
router.get("/vocal-tune/:jobId", requireAuth, (req: Request, res: Response) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const job = jobs.get(jobId);
  if (!job || job.userId !== req.userId) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({
    jobId: job.id,
    status: job.status,
    style: job.style,
    outputUrl: job.outputUrl,
    notesCorrected: job.notesCorrected,
    tuningAppliedCents: job.tuningAppliedCents,
    hardtuneFallback: job.hardtuneFallback,
    filterPath: job.filterPath,
    keyShift: job.keyShift,
    tempoFactor: job.tempoFactor,
    error: job.error,
    createdAt: job.createdAt,
  });
});

export default router;
