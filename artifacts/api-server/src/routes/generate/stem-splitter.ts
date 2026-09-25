import { randomUUID } from "crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";

const router = Router();

export const STEM_SPLITTER_CREDIT_COST = 4;
const STEM_UPLOAD_MAX_BYTES = 25 * 1024 * 1024; // 25 MB — same guard as song uploads
const STEM_MAX_DURATION_SECONDS = 600; // 10 min ceiling: 4-stem Demucs on CPU is the heaviest job we run

/** 4-stem Demucs model. htdemucs is the standard vocals/drums/bass/other model. */
const STEM_DEMUCS_MODEL = process.env["STEM_SPLITTER_DEMUCS_MODEL"] ?? "htdemucs";
const STEM_DEMUCS_PYTHON = process.env["DEMUCS_PYTHON"] ?? "python3";
/** 4-stem on CPU is slow — 30 min cap, env-overridable. */
const STEM_DEMUCS_TIMEOUT_MS = Number(process.env["STEM_SPLITTER_TIMEOUT_MS"] ?? 1_800_000);

export type StemKey = "vocals" | "drums" | "bass" | "other";
export const STEM_KEYS: StemKey[] = ["vocals", "drums", "bass", "other"];

export const STEM_LABELS: Record<StemKey, string> = {
  vocals: "Vocals",
  drums: "Drums",
  bass: "Bass",
  other: "Melody / Other",
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: STEM_UPLOAD_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("audio/")) {
      cb(null, true);
    } else {
      cb(new Error("Only audio files are allowed (MP3, WAV, FLAC, M4A, OGG)."));
    }
  },
});

/* ── Pure, testable helpers ─────────────────────────────────────────── */

/**
 * Build the Demucs CLI args for 4-stem separation.
 * No --two-stems flag: the default htdemucs run emits
 * vocals.wav, drums.wav, bass.wav, other.wav.
 */
export function buildDemucsArgs(
  songPath: string,
  outDir: string,
  model: string,
): string[] {
  return [
    "-m",
    "demucs",
    "-n",
    model,
    "-d",
    "cpu",
    "--out",
    outDir,
    songPath,
  ];
}

/**
 * Where Demucs writes the 4 stems for a given input.
 * Layout: <outDir>/<model>/<input-basename>/{vocals,drums,bass,other}.wav
 */
export function demucsStemDir(outDir: string, model: string, songPath: string): string {
  return join(outDir, model, basename(songPath, extname(songPath)));
}

export function stemFilePath(stemDir: string, stem: StemKey): string {
  return join(stemDir, `${stem}.wav`);
}

/**
 * Validate a remix level map. Each stem gets 0–2 (0 = muted, 1 = unity,
 * up to 2 = +6dB boost). Returns null when invalid.
 */
export function validateStemLevels(levels: unknown): Record<StemKey, number> | null {
  if (typeof levels !== "object" || levels === null) return null;
  const out = {} as Record<StemKey, number>;
  for (const key of STEM_KEYS) {
    const v = (levels as Record<string, unknown>)[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 2) return null;
    out[key] = v;
  }
  return out;
}

/**
 * Build the ffmpeg filter graph for a stem remix: per-stem volume, then
 * sum (normalize=0 keeps our levels honest), then a limiter to catch
 * clipping when stems are boosted.
 */
export function buildRemixFilter(levels: Record<StemKey, number>): string {
  const vols = STEM_KEYS.map((k, i) => `[${i}:a]volume=${levels[k]}[s${i}]`).join(";");
  const mix = STEM_KEYS.map((_, i) => `[s${i}]`).join("");
  return `${vols};${mix}amix=inputs=4:duration=longest:dropout_transition=0:normalize=0,alimiter=limit=0.95`;
}

export function buildRemixArgs(
  stemPaths: Record<StemKey, string>,
  levels: Record<StemKey, number>,
  outputPath: string,
): string[] {
  const args: string[] = ["-y", "-hide_banner", "-loglevel", "error"];
  for (const key of STEM_KEYS) {
    args.push("-i", stemPaths[key]);
  }
  args.push(
    "-filter_complex",
    buildRemixFilter(levels),
    "-c:a",
    "pcm_s16le",
    "-ar",
    "44100",
    outputPath,
  );
  return args;
}

/* ── Server-owned background jobs (in-memory; not tab-dependent) ───── */

export type StemJobStatus = "queued" | "processing" | "done" | "failed";

export interface StemUrls {
  vocals: string;
  drums: string;
  bass: string;
  other: string;
}

export interface StemJob {
  id: string;
  userId: string;
  status: StemJobStatus;
  sourceName: string;
  durationSeconds: number | null;
  stemUrls: StemUrls | null;
  stemRefs: StemUrls | null;
  error: string | null;
  creditsCharged: number;
  createdAt: number;
}

const jobs = new Map<string, StemJob>();

export function getStemJob(id: string): StemJob | undefined {
  return jobs.get(id);
}

/** Test hook: clear the in-memory job store. */
export function __clearStemJobs(): void {
  jobs.clear();
}

function runProcess(
  bin: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
      if (stdout.length > 200_000) stdout = stdout.slice(-200_000);
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${bin} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Could not start ${bin}: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} exited with code ${code}: ${stderr}`.slice(0, 500)));
    });
  });
}

async function probeAudioDurationSeconds(inputPath: string): Promise<number> {
  const { stdout } = await runProcess(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      inputPath,
    ],
    30_000,
  );
  const secs = Number(stdout.trim());
  if (!Number.isFinite(secs) || secs <= 0) throw new Error("Could not probe audio duration.");
  return secs;
}

function runDemucs(songPath: string, outDir: string, model: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      STEM_DEMUCS_PYTHON,
      buildDemucsArgs(songPath, outDir, model),
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Demucs timed out after ${STEM_DEMUCS_TIMEOUT_MS}ms`));
    }, STEM_DEMUCS_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Could not start Demucs (${STEM_DEMUCS_PYTHON}): ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Demucs exited with code ${code}: ${stderr}`.slice(0, 500)));
    });
  });
}

async function downloadToBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Stem download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/* ── Background worker ──────────────────────────────────────────────── */

/** Exported for tests. */
export async function runStemJob(job: StemJob, inputBuffer: Buffer, originalName: string): Promise<void> {
  const workDir = await fs.mkdtemp(join(tmpdir(), "stems-"));
  const ext = (originalName.split(".").pop() ?? "mp3").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp3";
  const inputPath = join(workDir, `input.${ext}`);

  try {
    job.status = "processing";
    await fs.writeFile(inputPath, inputBuffer);

    // Honest gate: 4-stem Demucs on CPU is our heaviest job — cap the input.
    const duration = await probeAudioDurationSeconds(inputPath);
    job.durationSeconds = duration;
    if (duration > STEM_MAX_DURATION_SECONDS) {
      throw new Error(
        `This track is ${Math.round(duration / 60)} minutes — stem splitting is capped at 10 minutes. ` +
        `Trim it down and try again. No credits were wasted on a job that couldn't finish.`,
      );
    }

    // Real Demucs 4-stem separation — never faked, never stubbed.
    const outDir = join(workDir, "demucs-out");
    await runDemucs(inputPath, outDir, STEM_DEMUCS_MODEL);

    const stemDir = demucsStemDir(outDir, STEM_DEMUCS_MODEL, inputPath);
    const stemBuffers = {} as Record<StemKey, Buffer>;
    for (const key of STEM_KEYS) {
      const p = stemFilePath(stemDir, key);
      await fs.access(p); // throws a clear error if Demucs didn't emit this stem
      stemBuffers[key] = await fs.readFile(p);
    }

    const urls = {} as StemUrls;
    const refs = {} as StemUrls;
    for (const key of STEM_KEYS) {
      const objectName = `stems/${job.userId}/${job.id}/${key}.wav`;
      const ref = await uploadMediaToSupabaseStorage(objectName, stemBuffers[key], "audio/wav");
      refs[key] = ref;
      urls[key] = await refreshSupabaseStorageUrl(ref);
    }

    job.status = "done";
    job.stemUrls = urls;
    job.stemRefs = refs;
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : "Stem splitting failed";
    // Refund: the user paid for stems they didn't get.
    try {
      await refundCredits(job.userId, job.creditsCharged, {
        action: "AI Stem Splitter — Refund (job failed)",
      });
    } catch (refundErr) {
      // Logged inside refundCredits; don't mask the original failure.
      void refundErr;
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Remix already-separated stems at the requested levels and upload the
 * custom mix. The stems were paid for by the separation job — the remix
 * itself is a deterministic ffmpeg sum, so it costs nothing extra.
 * Exported for tests.
 */
export async function runRemixJob(
  job: StemJob,
  levels: Record<StemKey, number>,
): Promise<{ url: string; ref: string }> {
  if (!job.stemUrls) throw new Error("Stems are not ready yet.");
  const workDir = await fs.mkdtemp(join(tmpdir(), "stem-remix-"));
  try {
    const stemPaths = {} as Record<StemKey, string>;
    for (const key of STEM_KEYS) {
      const buf = await downloadToBuffer(job.stemUrls[key]);
      const p = join(workDir, `${key}.wav`);
      await fs.writeFile(p, buf);
      stemPaths[key] = p;
    }
    const outputPath = join(workDir, "remix.wav");
    await runProcess("ffmpeg", buildRemixArgs(stemPaths, levels, outputPath), 300_000);
    const outBuffer = await fs.readFile(outputPath);
    const objectName = `stems/${job.userId}/${job.id}/remix-${Date.now()}.wav`;
    const ref = await uploadMediaToSupabaseStorage(objectName, outBuffer, "audio/wav");
    const url = await refreshSupabaseStorageUrl(ref);
    return { url, ref };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ── Routes ─────────────────────────────────────────────────────────── */

/**
 * POST /api/stems
 *
 * Real 4-stem Demucs separation (vocals, drums, bass, other) on CPU.
 * Flow: upload audio → charge 4 credits → server-owned background job →
 * poll GET /api/stems/:jobId → per-stem WAV URLs. Failed jobs refund
 * automatically. Safe to close the tab while it runs.
 */
router.post("/api/stems", requireAuth, upload.single("audio"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No audio file provided" });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < STEM_SPLITTER_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to split stems.",
    });
    return;
  }

  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, STEM_SPLITTER_CREDIT_COST, {
      action: "AI Stem Splitter (4-stem)",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to split stems.",
      });
      return;
    }
    if (err instanceof LedgerWriteError) {
      res.status(500).json({ error: "Could not record the credit charge. Please try again." });
      return;
    }
    throw err;
  }

  const job: StemJob = {
    id: randomUUID(),
    userId: req.userId!,
    status: "queued",
    sourceName: req.file.originalname,
    durationSeconds: null,
    stemUrls: null,
    stemRefs: null,
    error: null,
    creditsCharged: STEM_SPLITTER_CREDIT_COST,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);

  // Server-owned: runs detached from the request/tab lifecycle.
  void runStemJob(job, req.file.buffer, req.file.originalname);

  res.status(202).json({
    jobId: job.id,
    status: job.status,
    creditsCharged: STEM_SPLITTER_CREDIT_COST,
    creditsRemaining,
  });
});

/**
 * GET /api/stems/:jobId
 *
 * Poll job status. Returns per-stem URLs when done (signed, reviewable
 * WAVs retained in Supabase storage).
 */
router.get("/api/stems/:jobId", requireAuth, (req, res) => {
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
    durationSeconds: job.durationSeconds,
    stems: job.stemUrls,
    error: job.error,
    createdAt: job.createdAt,
  });
});

/**
 * POST /api/stems/:jobId/remix
 *
 * Remix the separated stems at custom levels. Body: { levels: { vocals,
 * drums, bass, other } } with each 0–2. Free — the stems were already
 * paid for; this is a deterministic ffmpeg sum, not AI work.
 */
router.post("/api/stems/:jobId/remix", requireAuth, async (req, res) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const job = jobs.get(jobId);
  if (!job || job.userId !== req.userId) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  if (job.status !== "done" || !job.stemUrls) {
    res.status(409).json({ error: "Stems are not ready yet — wait for the split to finish." });
    return;
  }
  const levels = validateStemLevels(req.body?.levels);
  if (!levels) {
    res.status(400).json({
      error: "Invalid levels — each stem needs a number from 0 (muted) to 2 (+6dB).",
    });
    return;
  }
  try {
    const { url } = await runRemixJob(job, levels);
    res.json({ url });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Remix failed",
    });
  }
});

/** Turn multer upload errors into clean JSON the frontend can display. */
router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "FILE_TOO_LARGE",
        message: "This audio file exceeds the 25 MB upload limit. Please use a smaller file.",
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
