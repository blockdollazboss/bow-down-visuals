import { createHash, randomUUID } from "crypto";
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
} from "../../lib/generation-stored-results";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";
import { attachJobMapTtl } from "../../lib/job-map-sweeper";
import { DurableJobStore } from "../../lib/durable-job-store";
import { tmpUploadStorage, createAdminAwareUpload } from "../../lib/upload-storage";

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── LUFS loudness meter + normalizer ───
   Audio-studio loudness tooling, distinct from the video volume
   normalizer (volume-norm.ts) and the mastering chain (mastering.ts):
   a FREE analyze endpoint that reports integrated LUFS, loudness
   range (LRA) and true peak from loudnorm's JSON summary, plus
   momentary / short-term statistics parsed from the ebur128 filter's
   frame log — and a paid two-pass loudnorm normalize endpoint with a
   user-selectable streaming target. Real DSP via ffmpeg (EBU R128 /
   ITU-R BS.1770). No provider, zero paid calls. */

export const LUFS_NORMALIZE_CREDIT_COST = Number(process.env["LUFS_NORMALIZE_CREDITS"]) || 100; // RATIFIED — owner ruling 2026-11-07
const LUFS_MAX_BYTES = 50 * 1024 * 1024; // 50 MB upload cap
const ANALYZE_TIMEOUT_MS = 300_000;
const NORMALIZE_TIMEOUT_MS = 600_000;

const TARGETS = [-16, -14, -11, -8] as const;
type LufsTarget = (typeof TARGETS)[number];
const DEFAULT_TARGET: LufsTarget = -14;

const TARGET_LABELS: Record<number, string> = {
  "-16": "Podcast / broadcast (-16 LUFS)",
  "-14": "Streaming — Spotify / YouTube (-14 LUFS)",
  "-11": "Loud master (-11 LUFS)",
  "-8": "Club / max loudness (-8 LUFS)",
};

// Broadcast-style correction targets: true peak ceiling and loudness
// range used for every normalize target.
const NORM_TP = -1.0;
const NORM_LRA = 11;

const upload = createAdminAwareUpload({
  storage: tmpUploadStorage,
  limits: { fileSize: LUFS_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("audio/") || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error("Only audio files are allowed (MP3, WAV, M4A, AAC, OGG, FLAC)"));
    }
  },
});

/* ── Pure, testable helpers ─────────────────────────────────────────── */

export interface LoudnessSummary {
  integratedLufs: number | null;
  loudnessRangeLu: number | null;
  truePeakDb: number | null;
  threshold: number | null;
}

interface LoudnormMeasured {
  I: string;
  TP: string;
  LRA: string;
  thresh: string;
  offset: string;
}

/**
 * Parse loudnorm's print_format=json summary from ffmpeg stderr.
 * Returns the input measurements plus the raw measured_* strings
 * needed for a two-pass normalization, or nulls when the file has
 * no measurable audio.
 */
export function parseLoudnormJson(stderr: string): {
  summary: LoudnessSummary;
  measured: LoudnormMeasured | null;
  durationSec: number | null;
} {
  const match = stderr.match(/\{[\s\S]*\}/);
  let obj: Record<string, string> = {};
  try {
    obj = match ? (JSON.parse(match[0]) as Record<string, string>) : {};
  } catch {
    obj = {};
  }
  const num = (k: string): number | null => {
    const v = parseFloat(obj[k]);
    return Number.isFinite(v) ? v : null;
  };
  const summary: LoudnessSummary = {
    integratedLufs: num("input_i"),
    loudnessRangeLu: num("input_lra"),
    truePeakDb: num("input_tp"),
    threshold: num("input_thresh"),
  };
  const measured: LoudnormMeasured | null =
    obj["input_i"] && obj["input_tp"] && obj["input_lra"] && obj["input_thresh"] && obj["target_offset"]
      ? {
          I: obj["input_i"],
          TP: obj["input_tp"],
          LRA: obj["input_lra"],
          thresh: obj["input_thresh"],
          offset: obj["target_offset"],
        }
      : null;
  // Duration comes from ffmpeg's own stream report, not the JSON.
  let durationSec: number | null = null;
  const dur = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  if (dur) {
    const secs = parseInt(dur[1], 10) * 3600 + parseInt(dur[2], 10) * 60 + parseFloat(dur[3]);
    if (Number.isFinite(secs)) durationSec = Math.round(secs * 10) / 10;
  }
  return { summary, measured, durationSec };
}

export interface Ebur128Stats {
  momentaryMax: number | null;
  momentaryMean: number | null;
  shortTermMax: number | null;
  shortTermMean: number | null;
}

/**
 * Parse the ebur128 filter's verbose frame log (stderr) into
 * momentary (400 ms window) and short-term (3 s window) statistics.
 * Lines look like: "t: 1.2\tM: -23.1 S: -21.4     I: -70.0 LUFS".
 */
function parseEbur128Framelog(stderr: string, maxSamples = 200_000): Ebur128Stats {
  let mMax = -Infinity, mSum = 0, mCount = 0;
  let sMax = -Infinity, sSum = 0, sCount = 0;
  const re = /M:\s*(-?[\d.]+)\s+S:\s*(-?[\d.]+)/g;
  let m: RegExpExecArray | null;
  let processed = 0;
  while ((m = re.exec(stderr)) !== null && processed < maxSamples) {
    const mv = parseFloat(m[1]);
    const sv = parseFloat(m[2]);
    if (Number.isFinite(mv)) {
      if (mv > mMax) mMax = mv;
      mSum += mv;
      mCount++;
    }
    if (Number.isFinite(sv)) {
      if (sv > sMax) sMax = sv;
      sSum += sv;
      sCount++;
    }
    processed++;
  }
  const round1 = (v: number): number => Math.round(v * 10) / 10;
  return {
    momentaryMax: mCount > 0 ? round1(mMax) : null,
    momentaryMean: mCount > 0 ? round1(mSum / mCount) : null,
    shortTermMax: sCount > 0 ? round1(sMax) : null,
    shortTermMean: sCount > 0 ? round1(sSum / sCount) : null,
  };
}

interface LoudnessAnalysis {
  summary: LoudnessSummary;
  ebur128: Ebur128Stats;
  durationSec: number | null;
  measured: LoudnormMeasured | null;
}

/** Run loudnorm in measure mode, capturing stderr (ffmpeg exits
    non-zero on `-f null` in some builds — the JSON still prints). */
async function runLoudnormMeasure(inputPath: string, targetI: number): Promise<string> {
  const args = [
    "-hide_banner",
    "-i", inputPath,
    "-filter:a", `loudnorm=I=${targetI}:TP=${NORM_TP}:LRA=${NORM_LRA}:print_format=json`,
    "-f", "null", "-",
  ];
  try {
    const { stderr } = await execFileAsync("ffmpeg", args, {
      timeout: ANALYZE_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
    });
    return stderr;
  } catch (err: unknown) {
    const stderr = (err as { stderr?: string })?.stderr ?? "";
    if (/\{[\s\S]*\}/.test(stderr)) return stderr;
    throw err;
  }
}

/**
 * Full loudness analysis of an audio file: loudnorm JSON summary
 * (integrated LUFS / LRA / true peak) plus ebur128 momentary and
 * short-term statistics. Exported for tests.
 */
async function runLoudnessAnalysis(
  inputPath: string,
  targetI: number = DEFAULT_TARGET,
): Promise<LoudnessAnalysis> {
  const loudnormStderr = await runLoudnormMeasure(inputPath, targetI);
  const { summary, measured, durationSec } = parseLoudnormJson(loudnormStderr);
  if (summary.integratedLufs == null) {
    throw new Error("Could not measure the audio loudness. The file may have no audio track.");
  }
  let ebur128: Ebur128Stats = { momentaryMax: null, momentaryMean: null, shortTermMax: null, shortTermMean: null };
  try {
    // -v verbose is required: the per-frame log is emitted at verbose level.
    const { stderr } = await execFileAsync(
      "ffmpeg",
      ["-hide_banner", "-v", "verbose", "-i", inputPath, "-filter:a", "ebur128=peak=true:framelog=verbose", "-f", "null", "-"],
      { timeout: ANALYZE_TIMEOUT_MS, maxBuffer: 128 * 1024 * 1024 },
    );
    ebur128 = parseEbur128Framelog(stderr);
  } catch {
    // Momentary/short-term stats are a bonus — the integrated
    // numbers are the authoritative measurement. Keep going.
  }
  return { summary, ebur128, durationSec, measured };
}

/** Build the two-pass loudnorm correction filter from measured values. */
function buildLoudnormPass2Filter(targetI: number, measured: LoudnormMeasured): string {
  return (
    `loudnorm=I=${targetI}:TP=${NORM_TP}:LRA=${NORM_LRA}` +
    `:measured_I=${measured.I}:measured_TP=${measured.TP}:measured_LRA=${measured.LRA}` +
    `:measured_thresh=${measured.thresh}:offset=${measured.offset}:linear=true`
  );
}

function buildNormalizeOutputArgs(
  inputPath: string,
  filter: string,
  outputPath: string,
  format: "wav" | "mp3",
): string[] {
  const audioArgs =
    format === "wav"
      ? ["-codec:a", "pcm_s16le", "-ar", "44100"]
      : ["-codec:a", "libmp3lame", "-b:a", "320k", "-ar", "44100"];
  return ["-y", "-i", inputPath, "-filter:a", filter, ...audioArgs, outputPath];
}

/* ── Server-owned background jobs (in-memory; not tab-dependent) ───── */

export type LufsJobStatus = "queued" | "processing" | "done" | "failed";

interface LufsNormalizeJob {
  id: string;
  userId: string;
  status: LufsJobStatus;
  targetLufs: number;
  format: "wav" | "mp3";
  sourceName: string;
  outputUrl: string | null;
  outputRef: string | null;
  before: LoudnessSummary | null;
  after: LoudnessSummary | null;
  error: string | null;
  creditsCharged: number;
  createdAt: number;
  /* CA-3: the charge key that funded this job — voided when the job
     fails + refunds, so a retry of the same ask charges fresh. */
  idempotencyKey: string;
  /** Durable jobs (0335): the exactly-once refund claim — claimed in
   *  the persisted row before any refund moves. */
  creditsRefunded?: boolean;
  /** Durable jobs (0335): the worker's inputs, persisted with the job
   *  so a worker resumed after a restart re-runs the exact ask. The
   *  upload is disk-backed; if the file did not survive, the job
   *  settles (failed + refunded exactly once). */
  workerInput?: { uploadedPath: string; originalName: string };
}

const jobs = new Map<string, LufsNormalizeJob>();
attachJobMapTtl(jobs); // 2026-10-12 OOM fix: TTL eviction (lib/job-map-sweeper)

/* ── Durable job storage (migration 0335) ─────────────────────────
   The Map above is the working cache; generation_jobs is the
   record. Jobs persist at creation, mirror on settle, and a lookup
   that misses the Map rehydrates from the table — a job survives
   a server restart: its worker resumes from the persisted upload
   path when the file survived, and settles (failed + refunded
   exactly once, claim first) when it did not. Fail-open throughout
   (lib/generation-jobs). */
const jobStore = new DurableJobStore<LufsNormalizeJob>(jobs, {
  rail: "lufs-meter",
  statusOf: (j) => j.status,
  isTerminalStatus: (s) => s === "done" || s === "failed",
  setFailed: (j, error) => {
    j.status = "failed";
    j.error = error;
  },
  amountOf: (j) => j.creditsCharged,
  chargeKeyOf: (j) => j.idempotencyKey,
  refundAction: "LUFS Loudness Normalize — Refund (job failed)",
  settleError: "Loudness normalization was interrupted by a server restart — your Visual Bucs were refunded.",
  resume: async (job) => {
    const input = job.workerInput;
    if (!input) return false;
    const survived = await fs.access(input.uploadedPath).then(
      () => true,
      () => false,
    );
    if (!survived) return false;
    void runLufsNormalizeJob(job, input.uploadedPath, input.originalName);
    return true;
  },
});

/* ─── Idempotent charge + stored-result replay (CA-3, Pattern B) ─────
   The server derives the charge key from the request intent (a hash
   of the uploaded audio bytes rides in the intent — the file itself
   never enters the key); a replay — the same upload sent twice, a
   double-tap, a retried request — is served the STORED 202 body
   (same jobId, flagged replayed:true) instead of charging again or
   minting a second job. Pattern B gate: a stored body is only served
   while its job is still tracked and not failed — a job that failed
   refunded + voided its key, and a job lost to a restart/TTL falls
   through to a fresh run (the ledger dedup keeps that run from
   double-charging when the original charge still stands). The
   durable check runs through lib/generation-stored-results.ts;
   storage is fail-open; fresh responses are byte-identical. */
const LUFS_SCOPE = "lufs-normalize";
const LUFS_REPLAY_NOTE =
  "This normalize job is already on its way for this upload — same job, no second charge.";

interface StoredResult {
  body: Record<string, unknown>;
  storedAt: number;
}

const storedResults = new Map<string, StoredResult>();
const inFlight = new Map<string, Promise<Record<string, unknown>>>();
const MAX_STORED_RESULTS = 500;

/** Test hook: clear the in-process replay cache between cases. */
export function __resetLufsReplayCache(): void {
  storedResults.clear();
  inFlight.clear();
}

function storedJobAlive(body: Record<string, unknown>): boolean {
  const jobId = body["jobId"];
  if (typeof jobId !== "string") return true;
  const job = jobs.get(jobId);
  return !!job && job.status !== "failed";
}

async function serveReplayableRun(opts: {
  res: Response;
  userId: string;
  idempotencyKey: string;
  run: () => Promise<Record<string, unknown>>;
}): Promise<void> {
  const { res, userId, idempotencyKey, run } = opts;

  /* 1) Durable pre-check (restart-surviving) — BEFORE funding. */
  const durable = await findStoredGenerationResult(
    "lufs-meter",
    idempotencyKey,
    userId,
  );
  if (durable) {
    const body =
      durable.result && typeof durable.result === "object"
        ? (durable.result as Record<string, unknown>)
        : null;
    if (body && body["error"] === undefined && storedJobAlive(body)) {
      storedResults.set(idempotencyKey, { body, storedAt: Date.now() });
      res.status(202).json({ ...body, replayed: true, replayNote: LUFS_REPLAY_NOTE });
      return;
    }
  }

  /* 2) In-process completed result (same job-alive gate). */
  const done = storedResults.get(idempotencyKey);
  if (done) {
    if (storedJobAlive(done.body)) {
      res.status(202).json({ ...done.body, replayed: true, replayNote: LUFS_REPLAY_NOTE });
      return;
    }
    storedResults.delete(idempotencyKey);
  }

  /* 3) In-flight twin: wait for it, then serve its result as a replay.
        If the twin failed, fall through and run fresh. */
  const twin = inFlight.get(idempotencyKey);
  if (twin) {
    const twinBody = await twin.catch(() => null);
    if (twinBody && twinBody["__status"] === undefined) {
      res.status(202).json({ ...twinBody, replayed: true, replayNote: LUFS_REPLAY_NOTE });
      return;
    }
  }

  /* 4) Fresh run. */
  const promise = (async () => run())();
  inFlight.set(idempotencyKey, promise);
  let body: Record<string, unknown>;
  try {
    body = await promise;
  } finally {
    if (inFlight.get(idempotencyKey) === promise) {
      inFlight.delete(idempotencyKey);
    }
  }

  const status = body["__status"];
  if (typeof status === "number") {
    const { __status: _ignored, ...errorBody } = body;
    res.status(status).json(errorBody);
    return;
  }

  /* 5) Success: remember it in-process AND durably BEFORE answering. */
  if (storedResults.size >= MAX_STORED_RESULTS) {
    storedResults.clear();
  }
  storedResults.set(idempotencyKey, { body, storedAt: Date.now() });
  await storeGenerationResult("lufs-meter", idempotencyKey, userId, body);

  /* Post-charge guard: if a DIFFERENT stored body won the durable
     slot while this run was working, serve that stored body as the
     replay — but only while its job is still alive. */
  const winner = await findStoredGenerationResult(
    "lufs-meter",
    idempotencyKey,
    userId,
  );
  if (winner) {
    const winnerBody =
      winner.result && typeof winner.result === "object"
        ? (winner.result as Record<string, unknown>)
        : null;
    if (
      winnerBody &&
      winnerBody["error"] === undefined &&
      storedJobAlive(winnerBody) &&
      JSON.stringify(winnerBody) !== JSON.stringify(body)
    ) {
      storedResults.set(idempotencyKey, { body: winnerBody, storedAt: Date.now() });
      res.status(202).json({ ...winnerBody, replayed: true, replayNote: LUFS_REPLAY_NOTE });
      return;
    }
  }

  res.status(202).json(body);
}


/** Test hook: clear the in-memory job store. */

/** Exported for tests. */
async function runLufsNormalizeJob(
  job: LufsNormalizeJob,
  uploadedPath: string,
  originalName: string,
): Promise<void> {
  const workDir = await fs.mkdtemp(join(tmpdir(), "lufs-norm-"));
  const ext = (originalName.split(".").pop() ?? "mp3").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp3";
  const inputPath = join(workDir, `input.${ext}`);
  const outputPath = join(workDir, `normalized.${job.format}`);

  try {
    job.status = "processing";
    await fs.copyFile(uploadedPath, inputPath); // 2026-10-12 OOM fix: upload is disk-backed, never a RAM Buffer

    // Pass 1: measure (also gives the honest "before" numbers).
    const analysis = await runLoudnessAnalysis(inputPath, job.targetLufs);
    job.before = analysis.summary;
    if (!analysis.measured) {
      throw new Error("Could not measure the audio loudness. The file may have no audio track.");
    }

    // Pass 2: apply the measured correction.
    const filter = buildLoudnormPass2Filter(job.targetLufs, analysis.measured);
    await execFileAsync("ffmpeg", buildNormalizeOutputArgs(inputPath, filter, outputPath, job.format), {
      timeout: NORMALIZE_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
    });

    // Verification pass: measure the actual output, not the target.
    try {
      const verify = await runLoudnessAnalysis(outputPath, job.targetLufs);
      job.after = verify.summary;
    } catch {
      job.after = null;
    }

    const outBuffer = await fs.readFile(outputPath);
    const contentType = job.format === "wav" ? "audio/wav" : "audio/mpeg";
    const objectName = `lufs-norm/${job.userId}/${Date.now()}-${job.id}.${job.format}`;
    const ref = await uploadMediaToSupabaseStorage(objectName, outBuffer, contentType);
    const url = await refreshSupabaseStorageUrl(ref);

    job.status = "done";
    job.outputUrl = url;
    job.outputRef = ref;
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : "Loudness normalization failed";
    /* Durable (0335): claim the refund BEFORE it moves — a job whose
       refund already landed never refunds twice. */
    const claimed = await jobStore.claimRefund(job);
    if (claimed) {
      // Refund: the user paid for an output they didn't get.
      let refunded = true;
      try {
        await refundCredits(job.userId, job.creditsCharged, {
          action: "LUFS Loudness Normalize — Refund (job failed)",
        });
      } catch (refundErr) {
        refunded = false;
        void refundErr;
      }
      /* CA-3: VOID the failed job's charge key and drop its stored 202
         body, so a retry of the same upload charges fresh and mints a
         new job instead of being served the dead one. */
      if (refunded) {
        await voidChargeIdempotencyKey(job.idempotencyKey);
        storedResults.delete(job.idempotencyKey);
      }
    }
  } finally {
    void jobStore.sync(job); // durable: the settled state is the post-restart record
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    await fs.unlink(uploadedPath).catch(() => {});
  }
}

/* ── Routes ─────────────────────────────────────────────────────────── */

const normalizeSchema = z.object({
  /** Streaming loudness target in LUFS. */
  targetLufs: z.enum(["-16", "-14", "-11", "-8"]).optional().default("-14"),
  /** Output container: wav (default, 16-bit/44.1k) or mp3 (320k). */
  format: z.enum(["wav", "mp3"]).optional().default("wav"),
});

function isNoAudioError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /no audio|does not contain|empty|matches no streams/i.test(msg);
}

/**
 * POST /api/lufs/analyze
 *
 * FREE loudness analysis for an uploaded audio file. Returns
 * integrated LUFS, loudness range (LU), true peak (dBTP) from
 * loudnorm's JSON summary, plus momentary (400 ms) and short-term
 * (3 s) max/mean statistics from the ebur128 filter. Synchronous —
 * typical songs analyze in seconds.
 */
router.post("/lufs/analyze", requireAuth, upload.single("audio"), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: "No audio file provided" });
    return;
  }
  const workDir = await fs.mkdtemp(join(tmpdir(), "lufs-analyze-"));
  try {
    const ext = (req.file.originalname.split(".").pop() ?? "mp3").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp3";
    const inputPath = join(workDir, `input.${ext}`);
    await fs.copyFile(req.file.path, inputPath); // 2026-10-12 OOM fix: disk-backed upload
    const analysis = await runLoudnessAnalysis(inputPath, DEFAULT_TARGET);
    res.json({
      fileName: req.file.originalname,
      integratedLufs: analysis.summary.integratedLufs,
      loudnessRangeLu: analysis.summary.loudnessRangeLu,
      truePeakDb: analysis.summary.truePeakDb,
      threshold: analysis.summary.threshold,
      durationSec: analysis.durationSec,
      targetLufs: DEFAULT_TARGET,
      ebur128: analysis.ebur128,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Loudness analysis failed.";
    req.log.error({ err: message }, "[lufs/analyze] failed");
    if (isNoAudioError(err)) {
      res.status(422).json({ error: "no_audio", message });
      return;
    }
    res.status(500).json({ error: message });
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    await fs.unlink(req.file.path).catch(() => {});
  }
});

/**
 * POST /api/lufs/normalize
 *
 * Two-pass loudnorm normalization of an uploaded AUDIO file to a
 * selectable streaming target (default -14 LUFS). 100 Visual Bucs
 * (RATIFIED — owner ruling 2026-11-07). Server-owned background job:
 * upload + target + format → charge → poll
 * GET /api/lufs/normalize/:jobId → download. Failed jobs refund.
 */
async function runLufsNormalizeCreate(
  userId: string,
  userCredits: number,
  targetLufs: LufsTarget,
  format: "wav" | "mp3",
  filePath: string,
  originalName: string,
  idempotencyKey: string,
): Promise<Record<string, unknown>> {
  const balance = userCredits;
  if (balance < LUFS_NORMALIZE_CREDIT_COST) {
    return {
      __status: 402,
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to normalize loudness.",
    };
  }

  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(userId, LUFS_NORMALIZE_CREDIT_COST, {
      action: `LUFS Loudness Normalize (${TARGET_LABELS[targetLufs]})`,
    }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      return {
        __status: 402,
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to normalize loudness.",
      };
    }
    if (err instanceof LedgerWriteError) {
      return { __status: 500, error: "Could not record the Visual Buc charge. Please try again." };
    }
    throw err;
  }

  const job: LufsNormalizeJob = {
    id: randomUUID(),
    userId,
    status: "queued",
    targetLufs,
    format,
    sourceName: originalName,
    outputUrl: null,
    outputRef: null,
    before: null,
    after: null,
    error: null,
    creditsCharged: LUFS_NORMALIZE_CREDIT_COST,
    createdAt: Date.now(),
    idempotencyKey,
    creditsRefunded: false,
    workerInput: { uploadedPath: filePath, originalName },
  };
  jobs.set(job.id, job);
  await jobStore.persist(job); // durable (0335): the row lands before the worker fires

  // Server-owned: runs detached from the request/tab lifecycle.
  void runLufsNormalizeJob(job, filePath, originalName);

  return {
    jobId: job.id,
    status: job.status,
    targetLufs: job.targetLufs,
    targetLabel: TARGET_LABELS[targetLufs],
    format: job.format,
    creditsCharged: LUFS_NORMALIZE_CREDIT_COST,
    creditsRemaining,
  };
}

router.post("/lufs/normalize", requireAuth, upload.single("audio"), async (req: Request, res: Response) => {
  const parsed = normalizeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No audio file provided" });
    return;
  }

  const targetLufs = parseInt(parsed.data.targetLufs, 10) as LufsTarget;
  const format = parsed.data.format;

  /* Idempotency (CA-3): key from intent — target, format, and a hash
     of the uploaded audio's bytes (disk-backed upload; the file
     itself never enters the key). */
  const fileBytes = await fs.readFile(req.file.path);
  const idempotencyKey = buildChargeIdempotencyKey(
    LUFS_SCOPE, req.userId!, undefined,
    {
      targetLufs,
      format,
      fileHash: createHash("sha256").update(fileBytes).digest("hex"),
    },
  );

  await serveReplayableRun({
    res,
    userId: req.userId!,
    idempotencyKey,
    run: () => runLufsNormalizeCreate(
      req.userId!, req.userCredits ?? 0, targetLufs, format,
      req.file!.path, req.file!.originalname, idempotencyKey,
    ),
  });
});

/**
 * GET /api/lufs/normalize/:jobId
 *
 * Poll job status. Returns outputUrl plus honest before/after
 * measured loudness (the output is re-measured, not assumed) when
 * done.
 */
router.get("/lufs/normalize/:jobId", requireAuth, async (req: Request, res: Response) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const job = await jobStore.find(jobId); // Map first, durable store on a miss (0335)
  if (!job || job.userId !== req.userId) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({
    jobId: job.id,
    status: job.status,
    targetLufs: job.targetLufs,
    targetLabel: TARGET_LABELS[job.targetLufs],
    format: job.format,
    sourceName: job.sourceName,
    outputUrl: job.outputUrl,
    before: job.before,
    after: job.after,
    error: job.error,
    createdAt: job.createdAt,
  });
});

export default router;
