import { randomUUID, createHash } from "crypto";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { Request, Response, Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
  LedgerWriteError,
  buildChargeIdempotencyKey,
  voidChargeIdempotencyKey,
} from "../../lib/credits";
import {
  findStoredGenerationResult,
  storeGenerationResult,
  deleteStoredGenerationResult,
} from "../../lib/generation-stored-results";

/* CA-1 replay note (CA-KEY wording pattern). */
const AUDIO_CLEANUP_REPLAY_NOTE =
  "This is the cleanup job you already started for this audio — it's the same job, not a new charge.";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";
import { attachJobMapTtl } from "../../lib/job-map-sweeper";
import { tmpUploadStorage, createAdminAwareUpload } from "../../lib/upload-storage";
import { librarySongTitle, recordLibrarySong } from "../../lib/library-song";

const router = Router();
const execFileAsync = promisify(execFile);

const AUDIO_CLEANUP_CREDIT_COST = 300;
const AUDIO_CLEANUP_MAX_BYTES = 50 * 1024 * 1024; // 50 MB upload cap

type AudioCleanupMode = "voice" | "music" | "denoise";
const MODES: AudioCleanupMode[] = ["voice", "music", "denoise"];

const MODE_LABELS: Record<AudioCleanupMode, string> = {
  voice: "Voice Isolation",
  music: "Music Cleanup",
  denoise: "Full Denoise",
};

const upload = createAdminAwareUpload({
  storage: tmpUploadStorage,
  limits: { fileSize: AUDIO_CLEANUP_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error("Only audio files are allowed (MP3, WAV, M4A)"));
    }
  },
});

const audioCleanupSchema = z.object({
  mode: z.enum(["voice", "music", "denoise"]),
  /** When the input was picked from the caller's song library, its id —
   *  the finished output's library row points back at it (parent chain). */
  sourceSongId: z.string().max(64).optional(),
});

/* ── Pure, testable helpers ─────────────────────────────────────────── */

/**
 * Build the ffmpeg audio filter chain for a cleanup mode.
 *
 * All modes use afftdn (FFT-based spectral denoiser, zero extra
 * dependencies) with mode-appropriate aggression, plus a high-pass to
 * kill rumble that denoisers leave behind. "denoise" adds anlmdn
 * (non-local means) for stubborn non-stationary noise and a light
 * dynamic normalizer to even out the result.
 *
 * This is real DSP denoising — it removes noise energy that exists in
 * the recording. It cannot recover signal buried under loud noise, and
 * aggressive settings can introduce light artifacts. The UI copy must
 * never promise "studio quality" from a noisy phone recording.
 */
function buildDenoiseFilter(mode: AudioCleanupMode): string {
  switch (mode) {
    case "voice":
      // Podcasts / voiceovers / stream clips: kill rumble, moderate
      // spectral denoise tuned for speech, then even out levels.
      return "highpass=f=75,afftdn=nr=12:nf=-50,dynaudnorm=f=150:g=7";
    case "music":
      // Live recordings: gentle — preserve transients and crowd
      // energy while pulling down venue hiss/hum.
      return "highpass=f=40,afftdn=nr=8:nf=-40";
    case "denoise":
      // Maximum suppression: aggressive spectral denoise + non-local
      // means smoothing for non-stationary noise.
      return "highpass=f=80,afftdn=nr=25:nf=-60,anlmdn=s=7:p=0.002:r=0.002:m=11,dynaudnorm=f=150:g=7";
  }
}

export function buildFfmpegArgs(inputPath: string, filter: string, outputPath: string): string[] {
  return [
    "-y",
    "-i", inputPath,
    "-af", filter,
    "-codec:a", "libmp3lame",
    "-b:a", "192k",
    "-ar", "44100",
    outputPath,
  ];
}

/**
 * Estimate noise reduction in dB from the energy removed by denoising.
 *
 * removedFraction = 1 - 10^((rmsAfter - rmsBefore)/10)
 * reductionDb     = 10 * log10(removedFraction)
 *
 * This measures energy that the denoiser took out of the signal —
 * overwhelmingly background noise for speech/music recordings. It is
 * an estimate, not a lab measurement, and the UI must label it as one.
 * Returns null when the measurement is not meaningful.
 */
function estimateNoiseReductionDb(rmsBeforeDb: number, rmsAfterDb: number): number | null {
  if (!Number.isFinite(rmsBeforeDb) || !Number.isFinite(rmsAfterDb)) return null;
  const removedFraction = 1 - Math.pow(10, (rmsAfterDb - rmsBeforeDb) / 10);
  if (removedFraction <= 0 || removedFraction >= 1) return null;
  const db = 10 * Math.log10(removedFraction);
  if (!Number.isFinite(db) || db >= 0) return null;
  return Math.round(Math.abs(db) * 10) / 10;
}

function parseRmsLevelDb(ffmpegStderr: string): number | null {
  const match = ffmpegStderr.match(/RMS level dB:\s*(-?[\d.]+)/);
  if (!match) return null;
  const v = parseFloat(match[1]);
  return Number.isFinite(v) ? v : null;
}

/* ── Server-owned background jobs (in-memory; not tab-dependent) ───── */

type AudioCleanupJobStatus = "queued" | "processing" | "done" | "failed";

interface AudioCleanupJob {
  id: string;
  userId: string;
  status: AudioCleanupJobStatus;
  mode: AudioCleanupMode;
  sourceName: string;
  outputUrl: string | null;
  outputRef: string | null;
  noiseReductionDb: number | null;
  error: string | null;
  creditsCharged: number;
  createdAt: number;
  /** Library song the input came from, when it came from the library. */
  sourceSongId: string | null;
  /** Library row recorded for the finished output (DE-6 round-trip). */
  librarySongId: string | null;
  /** CA-1: the charge's idempotency key — the async job-failure refund
   *  VOIDS it so a retry after a failed job charges fresh. */
  idempotencyKey: string | null;
}

const jobs = new Map<string, AudioCleanupJob>();
attachJobMapTtl(jobs); // 2026-10-12 OOM fix: TTL eviction (lib/job-map-sweeper)


/** Test hook: clear the in-memory job store. */
export function __clearAudioCleanupJobs(): void {
  jobs.clear();
}

async function measureRmsDb(filePath: string): Promise<number | null> {
  try {
    const { stderr } = await execFileAsync(
      "ffmpeg",
      ["-hide_banner", "-i", filePath, "-af", "astats=metadata=1:reset=0", "-f", "null", "-"],
      { timeout: 60_000 },
    );
    return parseRmsLevelDb(stderr);
  } catch {
    return null;
  }
}

/** Exported for tests. */
async function runAudioCleanupJob(
  job: AudioCleanupJob,
  uploadedPath: string,
  originalName: string,
): Promise<void> {
  const workDir = await fs.mkdtemp(join(tmpdir(), "audio-cleanup-"));
  const ext = (originalName.split(".").pop() ?? "mp3").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp3";
  const inputPath = join(workDir, `input.${ext}`);
  const outputPath = join(workDir, `cleaned.mp3`);

  try {
    job.status = "processing";
    await fs.copyFile(uploadedPath, inputPath); // 2026-10-12 OOM fix: upload is disk-backed, never a RAM Buffer

    // Baseline loudness for the noise-reduction estimate.
    const rmsBefore = await measureRmsDb(inputPath);

    const filter = buildDenoiseFilter(job.mode);
    await execFileAsync("ffmpeg", buildFfmpegArgs(inputPath, filter, outputPath), {
      timeout: 600_000, // 10 min cap
    });

    const rmsAfter = await measureRmsDb(outputPath);
    job.noiseReductionDb =
      rmsBefore != null && rmsAfter != null ? estimateNoiseReductionDb(rmsBefore, rmsAfter) : null;

    const outBuffer = await fs.readFile(outputPath);
    const objectName = `audio-cleanup/${job.userId}/${Date.now()}-${job.id}.mp3`;
    const ref = await uploadMediaToSupabaseStorage(objectName, outBuffer, "audio/mpeg");
    const url = await refreshSupabaseStorageUrl(ref);

    job.outputUrl = url;
    job.outputRef = ref;

    /* Linkage (DE-6): the finished cleanup lands in the caller's song
       library, chained to the library song it started from when the
       input was one. A library-write failure never fails a delivered
       job — recordLibrarySong logs and returns null. */
    job.librarySongId = await recordLibrarySong({
      userId: job.userId,
      title: librarySongTitle(job.sourceName, "Cleaned"),
      audioUrl: url,
      audioPath: ref,
      source: "cleanup",
      parentSongId: job.sourceSongId,
    });

    job.status = "done";
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : "Audio cleanup failed";
    // Refund: the user paid for an output they didn't get.
    let refunded = true;
    try {
      await refundCredits(job.userId, job.creditsCharged, {
        action: "Audio Cleanup — Refund (job failed)",
      });
    } catch (refundErr) {
      refunded = false;
      // Logged inside refundCredits; don't mask the original failure.
      void refundErr;
    }
    /* CA-1: a landed refund VOIDS the charge's key so the retry charges
       fresh instead of replay-suppressing into a free run. */
    if (refunded && job.idempotencyKey) {
      await voidChargeIdempotencyKey(job.idempotencyKey);
    }
    /* CA-1 follow-on — the stored FAILURE marker: the creation body
       was stored BEFORE the job ran (Pattern B), so while this
       in-memory record lives, the POST pre-check can see the failure
       directly — but the record is TTL-evicted after 2h while the
       stored body is durable, and the body alone carries no failure
       marker. Without this write, a retry after eviction would be
       answered with the stale creation body marked "done": a phantom
       success for a refunded failure, and the same file + mode would
       stay bricked for the body's whole durable life. Replace the
       creation body with a failure marker (delete + store, both
       fail-open) so the failure stays readable for exactly as long
       as the stored body would have lived. Written whether or not
       the refund landed: when it didn't, the un-voided ledger key
       still suppresses the retry's charge, so the re-run the marker
       admits is the one the member already paid for. */
    if (job.idempotencyKey) {
      await deleteStoredGenerationResult("audio-cleanup", job.idempotencyKey, job.userId);
      await storeGenerationResult("audio-cleanup", job.idempotencyKey, job.userId, {
        jobId: job.id,
        status: "failed",
        failed: true,
        mode: job.mode,
      });
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    await fs.unlink(uploadedPath).catch(() => {});
  }
}

/* ── Routes ─────────────────────────────────────────────────────────── */

/**
 * POST /api/audio-cleanup
 *
 * Server-side background-noise removal for creator audio (podcasts,
 * voiceovers, stream clips, live recordings). Real DSP via ffmpeg
 * (afftdn spectral denoising + mode-specific chains) — no fake
 * processing, no new ML dependencies.
 *
 * Flow: upload audio + mode → charge 3 credits → server-owned
 * background job → poll GET /api/audio-cleanup/:jobId → download
 * result. Failed jobs are refunded automatically.
 */
router.post("/audio-cleanup", requireAuth, upload.single("audio"), async (req: Request, res: Response) => {
  const parsed = audioCleanupSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { mode } = parsed.data;
  if (!req.file) {
    res.status(400).json({ error: "No audio file provided" });
    return;
  }

  /* CA-1 (Pattern B): the charge's defining input is the uploaded audio
     itself — hash its bytes so the same file + mode maps to the same
     key. A stored result means this exact cleanup was already charged
     and its job minted: answer with the ORIGINAL job body, no second
     charge, no second job. */
  let fileHash = "";
  try {
    const fileBytes = await fs.readFile(req.file.path);
    fileHash = createHash("sha256").update(fileBytes).digest("hex");
  } catch {
    fileHash = "";
  }
  const idempotencyKey = buildChargeIdempotencyKey(
    "audio-cleanup", req.userId!, undefined,
    {
      fileHash,
      mode,
      sourceSongId: parsed.data.sourceSongId ?? null,
      originalName: req.file.originalname,
    },
  );
  const stored = await findStoredGenerationResult("audio-cleanup", idempotencyKey, req.userId!);
  const storedJob = stored && typeof stored["jobId"] === "string" ? jobs.get(stored["jobId"]) : undefined;
  const storedIsFailedTombstone = !!storedJob && storedJob.userId === req.userId && storedJob.status === "failed";
  /* The durable twin of the tombstone: a stored FAILURE marker (see
     runAudioCleanupJob) means this intent's job failed — readable
     even after the in-memory record has been TTL-evicted, which is
     exactly the window the in-memory check cannot cover. */
  const storedIsFailureMarker =
    !!stored && (stored["failed"] === true || stored["status"] === "failed");
  if (stored && !storedIsFailedTombstone && !storedIsFailureMarker) {
    if (storedJob && storedJob.userId === req.userId) {
      res.status(202).json({ ...stored, replayed: true, replayNote: AUDIO_CLEANUP_REPLAY_NOTE });
    } else {
      /* The job already left the in-memory map (finished + TTL-evicted);
         its result is still polled from library/storage — answer with
         the original job id honestly marked done. */
      res.status(202).json({
        ...stored,
        status: "done",
        replayed: true,
        replayNote: AUDIO_CLEANUP_REPLAY_NOTE,
      });
    }
    return;
  }
  /* storedIsFailedTombstone / storedIsFailureMarker: the stored job
     FAILED and its charge was refunded + key voided (see
     runAudioCleanupJob) — the stored body is a failure record, not a
     result; fall through and mint a fresh job on a fresh charge.
     Clear the stale row first: the fresh job's body is stored under
     this same key with conflict-do-nothing, so a leftover failure
     row would shadow the new job's body forever (and a later retry
     would fall through past it again instead of replaying the new
     job). */
  if (stored) {
    await deleteStoredGenerationResult("audio-cleanup", idempotencyKey, req.userId!);
  }

  const balance = req.userCredits ?? 0;
  if (balance < AUDIO_CLEANUP_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to clean up audio.",
    });
    return;
  }

  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, AUDIO_CLEANUP_CREDIT_COST, {
      action: `Audio Cleanup (${MODE_LABELS[mode]})`,
    }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to clean up audio.",
      });
      return;
    }
    if (err instanceof LedgerWriteError) {
      res.status(500).json({ error: "Could not record the Visual Buc charge. Please try again." });
      return;
    }
    throw err;
  }

  const job: AudioCleanupJob = {
    id: randomUUID(),
    userId: req.userId!,
    status: "queued",
    mode,
    sourceName: req.file.originalname,
    outputUrl: null,
    outputRef: null,
    noiseReductionDb: null,
    error: null,
    creditsCharged: AUDIO_CLEANUP_CREDIT_COST,
    createdAt: Date.now(),
    sourceSongId: parsed.data.sourceSongId ?? null,
    librarySongId: null,
    idempotencyKey,
  };
  jobs.set(job.id, job);

  // Server-owned: runs detached from the request/tab lifecycle.
  void runAudioCleanupJob(job, req.file.path, req.file.originalname);

  const resultBody = {
    jobId: job.id,
    status: job.status,
    mode: job.mode,
    creditsCharged: AUDIO_CLEANUP_CREDIT_COST,
    creditsRemaining,
  };
  /* CA-1: store the minted job's body under the key BEFORE answering so
     a duplicate POST replays this same job instead of charging again. */
  await storeGenerationResult("audio-cleanup", idempotencyKey, req.userId!, resultBody);
  res.status(202).json(resultBody);
});

/**
 * GET /api/audio-cleanup/:jobId
 *
 * Poll job status. Returns outputUrl + noiseReductionDb when done
 * (a signed, reviewable URL for the cleaned audio retained in
 * Supabase storage).
 */
router.get("/audio-cleanup/:jobId", requireAuth, (req: Request, res: Response) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const job = jobs.get(jobId);
  if (!job || job.userId !== req.userId) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({
    jobId: job.id,
    status: job.status,
    mode: job.mode,
    sourceName: job.sourceName,
    outputUrl: job.outputUrl,
    songId: job.librarySongId,
    noiseReductionDb: job.noiseReductionDb,
    error: job.error,
    createdAt: job.createdAt,
  });
});

export default router;
