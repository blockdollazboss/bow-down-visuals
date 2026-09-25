import { Router, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import multer from "multer";
import { z } from "zod";
import OpenAI, { toFile } from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
  LedgerWriteError,
} from "../../lib/credits";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";

const router = Router();
const execFileAsync = promisify(execFile);

/* ── Pricing ─────────────────────────────────────────────────────────────
   3 credits per AI analysis (Whisper transcription + GPT-6 highlight
   detection — real provider spend on every run), 2 credits per rendered
   vertical clip (server-side ffmpeg encode + storage). Both
   env-overridable without a deploy. */
const ANALYZE_CREDIT_COST = Number(process.env["STREAMER_CLIPS_ANALYZE_CREDITS"]) || 3;
const CUT_CREDIT_COST = Number(process.env["STREAMER_CLIPS_CUT_CREDITS"]) || 2;

/** Cap VOD uploads at 80 MB — same guard as the clip upload route. */
const VOD_MAX_BYTES = 80 * 1024 * 1024;
/** Whisper's hard per-request file limit. Larger audio is chunked. */
const WHISPER_MAX_BYTES = 24 * 1024 * 1024;
const TRANSCRIBE_TIMEOUT_MS = 240_000;

const VIBES = ["funny", "hype", "wholesome"] as const;
type Vibe = (typeof VIBES)[number];

const VIBE_DIRECTION: Record<Vibe, string> = {
  funny:
    "the funniest moments — jokes that land, fails, unexpected chaos, chat-roasting, genuine laugh-out-loud reactions",
  hype:
    "the highest-energy moments — clutch plays, big wins, celebrations, crowd-pumping reactions, goosebump peaks",
  wholesome:
    "the most heartwarming moments — kindness, gratitude, sweet interactions, feel-good wins, genuine smiles",
};

export interface ClipHighlight {
  id: string;
  startSec: number;
  endSec: number;
  title: string;
  reason: string;
  quote: string;
}

const analyzeBodySchema = z.object({
  videoUrl: z.string().url().max(2000).optional(),
  clipLength: z.coerce.number().int().refine((n) => [15, 30, 60].includes(n), {
    message: "clipLength must be 15, 30, or 60",
  }).default(30),
  maxClips: z.coerce.number().int().min(1).max(8).default(5),
  vibe: z.enum(VIBES).default("hype"),
});

const cutClipSchema = z.object({
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  title: z.string().max(120).optional().default(""),
});

const cutBodySchema = z.object({
  videoRef: z.string().min(1).max(2000),
  clips: z.array(cutClipSchema).min(1).max(5),
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: VOD_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Only video files are allowed"));
    }
  },
});

/* ── ffmpeg helpers (exported for tests) ───────────────────────────────── */

export function formatTimestamp(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

/** Build ffmpeg args that cut [startSec, endSec) and reframe to 720x1280 vertical. */
export function buildClipCutArgs(
  inputPath: string,
  outputPath: string,
  startSec: number,
  endSec: number,
): string[] {
  const dur = Math.max(1, endSec - startSec);
  return [
    "-ss", String(startSec),
    "-t", String(dur),
    "-i", inputPath,
    "-vf", "crop=ih*9/16:ih,scale=720:1280:flags=lanczos",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "23",
    "-c:a", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    "-y",
    outputPath,
  ];
}

async function probeDurationSec(inputPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "csv=p=0",
      inputPath,
    ], { timeout: 30_000 });
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch {
    return null;
  }
}

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

/**
 * Transcribe a video buffer with Whisper. Audio is extracted with ffmpeg
 * first (mono 16kHz keeps chunks small); audio larger than Whisper's limit
 * is split into sequential chunks and timestamps are offset back.
 * Exported for tests (pure-ish orchestration; network calls mocked).
 */
export async function transcribeVideoBuffer(
  buffer: Buffer,
  originalName: string,
  transcribeFn?: (audio: { buffer: Buffer; name: string }) => Promise<{ segments: TranscriptSegment[] }>,
): Promise<{ segments: TranscriptSegment[]; durationSec: number }> {
  const workDir = await fs.mkdtemp(join(tmpdir(), "clipmaker-"));
  const ext = (originalName.split(".").pop() ?? "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
  const inputPath = join(workDir, `input.${ext}`);
  try {
    await fs.writeFile(inputPath, buffer);
    const durationSec = (await probeDurationSec(inputPath)) ?? 0;

    // Extract compact mono audio for transcription.
    const audioPath = join(workDir, "audio.mp3");
    await execFileAsync("ffmpeg", [
      "-v", "error",
      "-i", inputPath,
      "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k",
      "-y", audioPath,
    ], { timeout: 300_000 });
    const audioStat = await fs.stat(audioPath);

    // Split oversized audio into sequential chunks under Whisper's limit.
    const chunkPaths: Array<{ path: string; offsetSec: number }> = [];
    if (audioStat.size <= WHISPER_MAX_BYTES) {
      chunkPaths.push({ path: audioPath, offsetSec: 0 });
    } else {
      const chunkCount = Math.ceil(audioStat.size / WHISPER_MAX_BYTES);
      const chunkDur = durationSec > 0 ? durationSec / chunkCount : 600;
      for (let i = 0; i < chunkCount; i++) {
        const p = join(workDir, `audio-${i}.mp3`);
        await execFileAsync("ffmpeg", [
          "-v", "error",
          "-ss", String(i * chunkDur),
          "-t", String(chunkDur + 1),
          "-i", audioPath,
          "-c", "copy",
          "-y", p,
        ], { timeout: 120_000 });
        chunkPaths.push({ path: p, offsetSec: i * chunkDur });
      }
    }

    const transcribe = transcribeFn ?? (async ({ buffer: b, name }) => {
      const file = await toFile(b, name, { type: "audio/mpeg" });
      const out = await getOpenAI().audio.transcriptions.create(
        { file, model: "whisper-1", response_format: "verbose_json", timestamp_granularities: ["segment"] },
        { signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS) },
      );
      const segs = ((out as unknown as { segments?: Array<{ start: number; end: number; text: string }> }).segments ?? [])
        .map((s) => ({ start: s.start, end: s.end, text: (s.text ?? "").trim() }))
        .filter((s) => s.text.length > 0);
      return { segments: segs };
    });

    const segments: TranscriptSegment[] = [];
    for (const [i, chunk] of chunkPaths.entries()) {
      const buf = await fs.readFile(chunk.path);
      const { segments: segs } = await transcribe({ buffer: buf, name: `chunk-${i}.mp3` });
      for (const s of segs) {
        segments.push({ start: s.start + chunk.offsetSec, end: s.end + chunk.offsetSec, text: s.text });
      }
    }
    segments.sort((a, b) => a.start - b.start);
    return { segments, durationSec };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Render segments as a timestamped transcript for the highlight model. */
export function buildTimestampedTranscript(segments: TranscriptSegment[], maxChars = 12000): string {
  const lines = segments.map((s) => `[${formatTimestamp(s.start)}] ${s.text}`);
  let out = lines.join("\n");
  if (out.length > maxChars) {
    out = out.slice(0, maxChars) + "\n…(transcript truncated)";
  }
  return out;
}

/**
 * Ask GPT-6 for highlight moments. Pure parsing is exported for tests;
 * the model call itself is injected for testability.
 */
export function parseHighlights(
  raw: string,
  opts: { clipLength: number; maxClips: number; durationSec: number },
): ClipHighlight[] {
  let arr: unknown[] = [];
  try {
    const parsed = JSON.parse(raw) as { highlights?: unknown };
    if (Array.isArray(parsed.highlights)) arr = parsed.highlights;
  } catch {
    return [];
  }
  const out: ClipHighlight[] = [];
  for (const h of arr) {
    if (!h || typeof h !== "object") continue;
    const o = h as Record<string, unknown>;
    const startSec = typeof o["startSec"] === "number" ? o["startSec"] : NaN;
    let endSec = typeof o["endSec"] === "number" ? o["endSec"] : NaN;
    const title = typeof o["title"] === "string" ? o["title"].trim().slice(0, 120) : "";
    const reason = typeof o["reason"] === "string" ? o["reason"].trim().slice(0, 300) : "";
    const quote = typeof o["quote"] === "string" ? o["quote"].trim().slice(0, 200) : "";
    if (!Number.isFinite(startSec) || startSec < 0 || !title) continue;
    // Normalize the window to the requested clip length.
    if (!Number.isFinite(endSec) || endSec <= startSec) {
      endSec = startSec + opts.clipLength;
    }
    const want = opts.clipLength;
    const got = endSec - startSec;
    if (Math.abs(got - want) > 12) {
      endSec = startSec + want;
    }
    if (opts.durationSec > 0 && endSec > opts.durationSec) {
      endSec = opts.durationSec;
      if (endSec - startSec < 5) continue;
    }
    // Dedupe against near-identical starts.
    if (out.some((e) => Math.abs(e.startSec - startSec) < 5)) continue;
    out.push({
      id: randomUUID(),
      startSec: Math.round(startSec * 10) / 10,
      endSec: Math.round(endSec * 10) / 10,
      title,
      reason,
      quote,
    });
    if (out.length >= opts.maxClips) break;
  }
  return out.sort((a, b) => a.startSec - b.startSec);
}

export async function detectHighlights(
  transcript: string,
  opts: { clipLength: number; maxClips: number; vibe: Vibe; durationSec: number },
  modelCall?: (messages: Array<{ role: string; content: string }>) => Promise<string>,
): Promise<ClipHighlight[]> {
  const call = modelCall ?? (async (messages) => {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: messages as Array<{ role: "system" | "user"; content: string }>,
      response_format: { type: "json_object" },
      max_completion_tokens: 2000,
      temperature: 0.6,
    });
    return completion.choices[0]?.message?.content ?? "{}";
  });
  const raw = await call([
    {
      role: "system",
      content:
        `You are an expert short-form video editor for streamers. ` +
        `Given a timestamped transcript of a stream VOD, find the best clip-worthy moments: ` +
        `${VIBE_DIRECTION[opts.vibe]}. ` +
        `Each highlight should be a self-contained moment about ${opts.clipLength} seconds long ` +
        `(set endSec ≈ startSec + ${opts.clipLength}). Prefer moments with a clear payoff inside ` +
        `the window — reaction, punchline, or result. Never invent moments that are not in the ` +
        `transcript; base startSec on the [mm:ss] markers. Return at most ${opts.maxClips} highlights, ` +
        `ranked best-first. ` +
        `Return ONLY JSON: {"highlights": [{"startSec": <number>, "endSec": <number>, ` +
        `"title": "<punchy clip title>", "reason": "<one line: why this slaps>", ` +
        `"quote": "<short memorable line from the moment>"}]}`,
    },
    { role: "user", content: `Find the best ${opts.vibe} moments in this stream transcript:\n\n${transcript}` },
  ]);
  return parseHighlights(raw, opts);
}

/* ── POST /api/streamer-clips/analyze ────────────────────────────────────
   Upload a VOD (or pass a Supabase storage videoUrl), get AI-found
   highlights. 3 credits. The source video is stored so the cut step can
   fetch it later; the stored ref is returned to the client. */
router.post(
  "/api/streamer-clips/analyze",
  publicApiLimiter,
  requireAuth,
  upload.single("video"),
  async (req: Request, res: Response) => {
    const parsed = analyzeBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid analyze request.",
        details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    const { videoUrl, clipLength, maxClips, vibe } = parsed.data;

    let videoBuffer: Buffer | null = null;
    let originalName = "vod.mp4";
    if (req.file) {
      videoBuffer = req.file.buffer;
      originalName = req.file.originalname || originalName;
    } else if (videoUrl) {
      // SSRF guard — only our own Supabase storage, same as /transcribe-url.
      const supabaseUrl = process.env["SUPABASE_URL"] ?? "";
      try {
        const parsedUrl = new URL(videoUrl);
        if (supabaseUrl) {
          const allowed = new URL(supabaseUrl).hostname;
          if (parsedUrl.hostname !== allowed) {
            res.status(400).json({ error: "videoUrl must be from your project storage." });
            return;
          }
        }
      } catch {
        res.status(400).json({ error: "Invalid videoUrl." });
        return;
      }
      try {
        const resp = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
        if (!resp.ok) throw new Error(`fetch failed: ${resp.status}`);
        const ab = await resp.arrayBuffer();
        if (ab.byteLength > VOD_MAX_BYTES) {
          res.status(413).json({ error: "FILE_TOO_LARGE", message: "This video exceeds the 80 MB limit." });
          return;
        }
        videoBuffer = Buffer.from(ab);
      } catch (err) {
        logger.error({ err }, "[streamer-clips] failed to fetch videoUrl");
        res.status(502).json({ error: "Could not download the video URL." });
        return;
      }
    } else {
      res.status(400).json({ error: "Upload a video file or provide videoUrl." });
      return;
    }

    const balance = req.userCredits ?? 0;
    if (balance < ANALYZE_CREDIT_COST) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to analyze VODs.",
      });
      return;
    }
    let creditsRemaining = balance;
    try {
      creditsRemaining = await chargeCredits(req.userId!, ANALYZE_CREDIT_COST, {
        action: "Streamer Clips — AI highlight analysis",
      });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: "You're out of credits — top up to analyze VODs.",
        });
        return;
      }
      if (err instanceof LedgerWriteError) {
        res.status(500).json({ error: "Could not record the credit charge. Please try again." });
        return;
      }
      throw err;
    }

    const refundAndFail = async (status: number, error: string, message?: string) => {
      try {
        await refundCredits(req.userId!, ANALYZE_CREDIT_COST, {
          action: "Streamer Clips — Refund (analysis failed)",
        });
      } catch {
        /* refund logged inside refundCredits */
      }
      res.status(status).json({ error, ...(message ? { message } : {}) });
    };

    try {
      // Store the source VOD so the cut step can fetch it later.
      const ext = (originalName.split(".").pop() ?? "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
      const objectName = `streamer-clips/${req.userId}/${Date.now()}-${randomUUID()}.${ext}`;
      const videoRef = await uploadMediaToSupabaseStorage(objectName, videoBuffer, "video/mp4");
      const signedUrl = await refreshSupabaseStorageUrl(videoRef);

      const { segments, durationSec } = await transcribeVideoBuffer(videoBuffer, originalName);
      if (segments.length === 0) {
        await refundAndFail(422, "NO_SPEECH", "No speech detected in this video — highlights need audio with talking.");
        return;
      }
      const transcript = buildTimestampedTranscript(segments);
      const highlights = await detectHighlights(transcript, { clipLength, maxClips, vibe, durationSec });
      if (highlights.length === 0) {
        await refundAndFail(502, "NO_HIGHLIGHTS", "The AI couldn't find clip-worthy moments in this VOD. Try a different vibe.");
        return;
      }

      res.json({
        videoRef,
        videoUrl: signedUrl,
        durationSec: Math.round(durationSec),
        highlights,
        creditsUsed: ANALYZE_CREDIT_COST,
        creditsRemaining,
      });
    } catch (err) {
      if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
        logger.warn({ err }, "[streamer-clips] provider rate limit");
        await refundAndFail(503, "PROVIDER_BUSY", "The AI is catching its breath — try again in a moment.");
        return;
      }
      logger.error({ err }, "[streamer-clips] analysis failed");
      await refundAndFail(502, "ANALYZE_FAILED", "Highlight analysis failed — you were not charged.");
    }
  },
);

/* ── Clip cutting: server-owned background job ─────────────────────────── */

interface CutClipResult {
  title: string;
  startSec: number;
  endSec: number;
  outputUrl: string | null;
  outputRef: string | null;
}

interface CutJob {
  id: string;
  userId: string;
  status: "queued" | "processing" | "done" | "failed";
  clips: CutClipResult[];
  error: string | null;
  creditsCharged: number;
  createdAt: number;
}

const cutJobs = new Map<string, CutJob>();
export function __clearStreamerClipJobs(): void {
  cutJobs.clear();
}
export function getStreamerClipJob(id: string): CutJob | undefined {
  return cutJobs.get(id);
}

export async function runCutJob(job: CutJob, videoRef: string): Promise<void> {
  const workDir = await fs.mkdtemp(join(tmpdir(), "clipcut-"));
  try {
    job.status = "processing";
    const signedUrl = await refreshSupabaseStorageUrl(videoRef);
    const resp = await fetch(signedUrl, { signal: AbortSignal.timeout(300_000) });
    if (!resp.ok) throw new Error(`Could not download source video (${resp.status})`);
    const inputPath = join(workDir, "source.mp4");
    await fs.writeFile(inputPath, Buffer.from(await resp.arrayBuffer()));

    for (const [i, clip] of job.clips.entries()) {
      const outputPath = join(workDir, `clip-${i}.mp4`);
      await execFileAsync(
        "ffmpeg",
        buildClipCutArgs(inputPath, outputPath, clip.startSec, clip.endSec),
        { timeout: 600_000 },
      );
      const outBuffer = await fs.readFile(outputPath);
      const objectName = `streamer-clips/${job.userId}/${job.id}-${i}.mp4`;
      const ref = await uploadMediaToSupabaseStorage(objectName, outBuffer, "video/mp4");
      clip.outputRef = ref;
      clip.outputUrl = await refreshSupabaseStorageUrl(ref);
    }
    job.status = "done";
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : "Clip cutting failed";
    try {
      await refundCredits(job.userId, job.creditsCharged, {
        action: "Streamer Clips — Refund (cut failed)",
      });
    } catch {
      /* logged inside refundCredits */
    }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * POST /api/streamer-clips/cut
 *
 * Cut selected highlights into vertical 9:16 clips with server-side ffmpeg.
 * 2 credits per clip, charged up front; failed jobs are refunded.
 * Returns 202 + jobId — poll GET /api/streamer-clips/cut/:jobId.
 */
router.post("/api/streamer-clips/cut", publicApiLimiter, requireAuth, async (req: Request, res: Response) => {
  const parsed = cutBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid cut request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { videoRef, clips } = parsed.data;
  for (const c of clips) {
    const dur = c.endSec - c.startSec;
    if (!(dur >= 5 && dur <= 90) || !Number.isFinite(c.startSec)) {
      res.status(400).json({
        error: "Each clip must be 5–90 seconds long with a valid start time.",
      });
      return;
    }
  }

  const cost = CUT_CREDIT_COST * clips.length;
  const balance = req.userCredits ?? 0;
  if (balance < cost) {
    res.status(402).json({
      error: "out_of_credits",
      message: `Cutting ${clips.length} clip${clips.length > 1 ? "s" : ""} costs ${cost} credits — top up to continue.`,
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, cost, {
      action: `Streamer Clips — cut ${clips.length} clip${clips.length > 1 ? "s" : ""}`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to cut clips.",
      });
      return;
    }
    if (err instanceof LedgerWriteError) {
      res.status(500).json({ error: "Could not record the credit charge. Please try again." });
      return;
    }
    throw err;
  }

  const job: CutJob = {
    id: randomUUID(),
    userId: req.userId!,
    status: "queued",
    clips: clips.map((c) => ({
      title: c.title || `Clip ${formatTimestamp(c.startSec)}`,
      startSec: c.startSec,
      endSec: c.endSec,
      outputUrl: null,
      outputRef: null,
    })),
    error: null,
    creditsCharged: cost,
    createdAt: Date.now(),
  };
  cutJobs.set(job.id, job);
  // Server-owned: runs detached from the request/tab lifecycle.
  void runCutJob(job, videoRef);

  res.status(202).json({
    jobId: job.id,
    status: job.status,
    clipCount: job.clips.length,
    creditsCharged: cost,
    creditsRemaining,
  });
});

/** GET /api/streamer-clips/cut/:jobId — poll cut job status. */
router.get("/api/streamer-clips/cut/:jobId", requireAuth, (req: Request, res: Response) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const job = cutJobs.get(jobId);
  if (!job || job.userId !== req.userId) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({
    jobId: job.id,
    status: job.status,
    clips: job.clips,
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
        message: "This video exceeds the 80 MB upload limit. Please use a smaller file.",
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
