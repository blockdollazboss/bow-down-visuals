import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";
import { separateVocalStems, cleanupWorkdir } from "../../lib/stem-separation";
import { getOpenAI } from "../../lib/ai-clients";
import { toFile } from "openai";

const router = Router();
const execFileAsync = promisify(execFile);

export const VOCAL_REMOVAL_CREDIT_COST = 3;
/** 25 MB — matches Whisper's hard limit so karaoke transcription never 413s. */
const MAX_BYTES = 25 * 1024 * 1024;

/* ── Server-owned background jobs (in-memory; not tab-dependent) ───── */

export type VocalRemovalJobStatus = "queued" | "processing" | "done" | "failed";

export interface KaraokeWord {
  word: string;
  start: number;
  end: number;
}

export interface VocalRemovalJob {
  id: string;
  userId: string;
  status: VocalRemovalJobStatus;
  sourceName: string;
  karaokeRequested: boolean;
  instrumentalUrl: string | null;
  instrumentalRef: string | null;
  acapellaUrl: string | null;
  acapellaRef: string | null;
  /** Signed URL for the Whisper word-timing JSON (karaoke), null when skipped. */
  karaokeUrl: string | null;
  karaokeRef: string | null;
  error: string | null;
  creditsCharged: number;
  createdAt: number;
}

const jobs = new Map<string, VocalRemovalJob>();

export function getVocalRemovalJob(id: string): VocalRemovalJob | undefined {
  return jobs.get(id);
}

/** Test hook: clear the in-memory job store. */
export function __clearVocalRemovalJobs(): void {
  jobs.clear();
}

/* ── ffmpeg helpers ─────────────────────────────────────────────────── */

/**
 * Convert a wav stem to MP3. 256k VBR-ish: transparent for karaoke and
 * casual listening, ~2 MB/min instead of ~10 MB/min for 16-bit WAV.
 * Key and tempo are untouched — Demucs is true source separation, and
 * this transcode is sample-accurate (no time-stretch, no pitch shift).
 */
export function buildStemMp3Args(inputPath: string, outputPath: string): string[] {
  return [
    "-y",
    "-hide_banner",
    "-loglevel", "error",
    "-i", inputPath,
    "-c:a", "libmp3lame",
    "-b:a", "256k",
    "-ar", "44100",
    outputPath,
  ];
}

/**
 * Normalize raw Whisper verbose_json word segments into a flat,
 * time-sorted karaoke word list. Drops empty words and clamps negative
 * timestamps (Whisper occasionally emits -0.01 starts on the first word).
 * Exported for tests.
 */
export function buildKaraokeWords(
  segments: Array<{ words?: Array<{ word?: string; start?: number; end?: number }> }>,
): KaraokeWord[] {
  const words: KaraokeWord[] = [];
  for (const seg of segments) {
    for (const w of seg.words ?? []) {
      const word = (w.word ?? "").trim();
      if (!word) continue;
      const start = Math.max(0, Number(w.start) || 0);
      const end = Math.max(start, Number(w.end) || 0);
      words.push({ word, start, end });
    }
  }
  words.sort((a, b) => a.start - b.start);
  return words;
}

/* ── Background worker ─────────────────────────────────────────────── */

/**
 * Run Whisper with word-level timestamps on the acapella for karaoke.
 * Returns the word list, or null when transcription is unavailable —
 * karaoke is a bonus; the stems are the product and must not fail
 * because Whisper did.
 */
async function transcribeKaraokeWords(acapellaMp3: Buffer, fileName: string): Promise<KaraokeWord[] | null> {
  try {
    const audioFile = await toFile(acapellaMp3, fileName, { type: "audio/mpeg" });
    const result = await getOpenAI().audio.transcriptions.create(
      {
        file: audioFile,
        model: "whisper-1",
        response_format: "verbose_json",
        timestamp_granularities: ["word"],
      } as never,
      { signal: AbortSignal.timeout(240_000) },
    );
    const segments = (result as unknown as { segments?: Array<{ words?: Array<{ word?: string; start?: number; end?: number }> }> }).segments ?? [];
    const words = buildKaraokeWords(segments);
    return words.length > 0 ? words : null;
  } catch {
    return null;
  }
}

/** Exported for tests. */
export async function runVocalRemovalJob(
  job: VocalRemovalJob,
  inputBuffer: Buffer,
  originalName: string,
): Promise<void> {
  const workDir = await fs.mkdtemp(join(tmpdir(), "vocalrem-"));
  const ext = (originalName.split(".").pop() ?? "mp3").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp3";
  const inputPath = join(workDir, `input.${ext}`);
  const instrumentalMp3Path = join(workDir, `instrumental-${job.id}.mp3`);
  const acapellaMp3Path = join(workDir, `acapella-${job.id}.mp3`);

  try {
    job.status = "processing";
    await fs.writeFile(inputPath, inputBuffer);

    // True stem separation via Demucs (mdx_extra_q). Key and tempo are
    // preserved by construction — separation reassigns time-frequency
    // bins, it never time-stretches or pitch-shifts.
    const stems = await separateVocalStems(inputBuffer);
    try {
      await execFileAsync("ffmpeg", buildStemMp3Args(stems.vocalsPath, acapellaMp3Path), {
        timeout: 300_000,
      });
      await execFileAsync("ffmpeg", buildStemMp3Args(stems.instrumentalPath, instrumentalMp3Path), {
        timeout: 300_000,
      });
    } finally {
      await cleanupWorkdir(stems.workdir);
    }

    const [instrumentalBuf, acapellaBuf] = await Promise.all([
      fs.readFile(instrumentalMp3Path),
      fs.readFile(acapellaMp3Path),
    ]);

    const stamp = `${Date.now()}-${job.id}`;
    const [instrumentalRef, acapellaRef] = await Promise.all([
      uploadMediaToSupabaseStorage(`vocal-removal/${job.userId}/${stamp}-instrumental.mp3`, instrumentalBuf, "audio/mpeg"),
      uploadMediaToSupabaseStorage(`vocal-removal/${job.userId}/${stamp}-acapella.mp3`, acapellaBuf, "audio/mpeg"),
    ]);
    const [instrumentalUrl, acapellaUrl] = await Promise.all([
      refreshSupabaseStorageUrl(instrumentalRef),
      refreshSupabaseStorageUrl(acapellaRef),
    ]);

    job.instrumentalRef = instrumentalRef;
    job.instrumentalUrl = instrumentalUrl;
    job.acapellaRef = acapellaRef;
    job.acapellaUrl = acapellaUrl;

    // Karaoke bonus: word-synced lyrics from the acapella. Skipped
    // gracefully on any failure — the stems are the product.
    if (job.karaokeRequested) {
      const words = await transcribeKaraokeWords(acapellaBuf, `acapella-${job.id}.mp3`);
      if (words) {
        const karaokeRef = await uploadMediaToSupabaseStorage(
          `vocal-removal/${job.userId}/${stamp}-karaoke.json`,
          Buffer.from(JSON.stringify({ words }), "utf8"),
          "application/json",
        );
        job.karaokeRef = karaokeRef;
        job.karaokeUrl = await refreshSupabaseStorageUrl(karaokeRef);
      }
    }

    job.status = "done";
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : "Vocal removal failed";
    // Refund: the user paid for stems they didn't get.
    try {
      await refundCredits(job.userId, job.creditsCharged, {
        action: "Vocal Removal — Refund (job failed)",
      });
    } catch (refundErr) {
      // Logged inside refundCredits; don't mask the original failure.
      void refundErr;
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ── Routes ─────────────────────────────────────────────────────────── */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype.startsWith("audio/") ||
      file.originalname.toLowerCase().endsWith(".mp3") ||
      file.originalname.toLowerCase().endsWith(".wav");
    if (ok) cb(null, true);
    else cb(new Error("Only audio files (MP3, WAV) are allowed"));
  },
});

/**
 * POST /api/vocal-removal
 *
 * Split any song into instrumental + acapella with Demucs stem separation
 * (true source separation — key and tempo are preserved, not filtered).
 * Optional karaoke mode adds Whisper word-timing lyrics synced to the
 * instrumental.
 *
 * Flow: upload audio (+ karaoke flag) → charge 3 credits →
 * server-owned background job → poll GET /api/vocal-removal/:jobId →
 * download/stream both stems. Failed jobs are refunded automatically.
 */
router.post("/api/vocal-removal", requireAuth, upload.single("audio"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No audio file provided" });
    return;
  }
  const karaokeRequested = req.body?.karaoke === "true" || req.body?.karaoke === true;

  const balance = req.userCredits ?? 0;
  if (balance < VOCAL_REMOVAL_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to remove vocals.",
    });
    return;
  }

  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, VOCAL_REMOVAL_CREDIT_COST, {
      action: `Vocal Removal${karaokeRequested ? " + Karaoke" : ""}`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to remove vocals.",
      });
      return;
    }
    if (err instanceof LedgerWriteError) {
      res.status(500).json({ error: "Could not record the credit charge. Please try again." });
      return;
    }
    throw err;
  }

  const job: VocalRemovalJob = {
    id: randomUUID(),
    userId: req.userId!,
    status: "queued",
    sourceName: req.file.originalname,
    karaokeRequested,
    instrumentalUrl: null,
    instrumentalRef: null,
    acapellaUrl: null,
    acapellaRef: null,
    karaokeUrl: null,
    karaokeRef: null,
    error: null,
    creditsCharged: VOCAL_REMOVAL_CREDIT_COST,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);

  // Server-owned: runs detached from the request/tab lifecycle.
  void runVocalRemovalJob(job, req.file.buffer, req.file.originalname);

  res.status(202).json({
    jobId: job.id,
    status: job.status,
    karaokeRequested: job.karaokeRequested,
    creditsCharged: VOCAL_REMOVAL_CREDIT_COST,
    creditsRemaining,
  });
});

/**
 * GET /api/vocal-removal/:jobId
 *
 * Poll job status. Returns instrumentalUrl + acapellaUrl (and karaokeUrl
 * when karaoke was requested and transcription succeeded) once done —
 * signed, reviewable URLs retained in Supabase storage.
 */
router.get("/api/vocal-removal/:jobId", requireAuth, (req, res) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const job = jobs.get(jobId);
  if (!job || job.userId !== req.userId) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({
    jobId: job.id,
    status: job.status,
    sourceName: job.sourceName,
    karaokeRequested: job.karaokeRequested,
    instrumentalUrl: job.instrumentalUrl,
    acapellaUrl: job.acapellaUrl,
    karaokeUrl: job.karaokeUrl,
    error: job.error,
    createdAt: job.createdAt,
  });
});

/** Turn multer upload errors into clean JSON the frontend can display. */
router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "FILE_TOO_LARGE",
        message: "This audio exceeds the 25 MB upload limit. Please use a smaller file.",
      });
      return;
    }
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof Error) {
    res.status(400).json({ error: err.message });
    return;
  }
  next(err);
});

export default router;
