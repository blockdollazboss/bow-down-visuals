import { createHash } from "crypto";
import { execFile } from "child_process";
import { promises as fs, createReadStream } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { NextFunction, Request, Response, Router } from "express";
import { z } from "zod";
import multer from "multer";
import { transcribeAudioTimed } from "../../lib/transcription";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError,
  buildChargeIdempotencyKey, voidChargeIdempotencyKey,
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

export const CAPTION_STYLER_CREDIT_COST = Number(process.env["CAPTION_STYLER_CREDITS"]) || 300;
const CAPTION_STYLER_MAX_BYTES = 80 * 1024 * 1024; // 80 MB, same guard as clip uploads
const WHISPER_MAX_BYTES = 25 * 1024 * 1024; // Whisper's hard limit
const WHISPER_TIMEOUT_MS = 240_000; // 4 minutes

const upload = createAdminAwareUpload({
  storage: tmpUploadStorage,
  limits: { fileSize: CAPTION_STYLER_MAX_BYTES },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      cb(new Error("Only video files are allowed"));
    }
  },
});

/* ── Pure, testable helpers ─────────────────────────────────────────── */

type CaptionStyleKey = "hormozi" | "minimal" | "karaoke" | "neon" | "luxury-gold";
type CaptionPosition = "top" | "middle" | "bottom";
type CaptionFontSize = "small" | "medium" | "large";

export const CAPTION_STYLES: Record<CaptionStyleKey, { label: string; blurb: string }> = {
  "hormozi": { label: "Hormozi", blurb: "Bold pop — big words, active word highlighted" },
  "minimal": { label: "Minimal", blurb: "Clean and quiet — small white text" },
  "karaoke": { label: "Karaoke", blurb: "Classic word-by-word sweep" },
  "neon": { label: "Neon", blurb: "Glowing cyan/magenta pop" },
  "luxury-gold": { label: "Luxury Gold", blurb: "Gold-on-black brand style" },
};

export function isCaptionStyleKey(s: unknown): s is CaptionStyleKey {
  return typeof s === "string" && s in CAPTION_STYLES;
}

const captionStylerSchema = z.object({
  style: z.enum(["hormozi", "minimal", "karaoke", "neon", "luxury-gold"]),
  position: z.enum(["top", "middle", "bottom"]).optional().default("bottom"),
  fontSize: z.enum(["small", "medium", "large"]).optional().default("medium"),
  withEmoji: z.union([z.boolean(), z.string()]).optional().default(false)
    .transform((v) => v === true || v === "true" || v === "1"),
});

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

interface CaptionChunk {
  words: WordTiming[];
  start: number;
  end: number;
}

/**
 * Group word timings into Hormozi-style caption chunks: 2–4 words per
 * chunk, never spanning more than ~2.5s, never splitting on a gap > 1s
 * (that gap is a natural pause — start a new chunk there).
 */
export function groupWordsIntoChunks(words: WordTiming[], maxWords = 3, maxSpanSec = 2.5): CaptionChunk[] {
  const chunks: CaptionChunk[] = [];
  let current: WordTiming[] = [];
  let chunkStart = 0;

  const flush = () => {
    if (current.length === 0) return;
    chunks.push({
      words: current,
      start: current[0]!.start,
      end: current[current.length - 1]!.end,
    });
    current = [];
  };

  for (const w of words) {
    if (current.length === 0) {
      chunkStart = w.start;
      current.push(w);
      continue;
    }
    const prev = current[current.length - 1]!;
    const gap = w.start - prev.end;
    const span = w.end - chunkStart;
    if (current.length >= maxWords || gap > 1.0 || span > maxSpanSec) {
      flush();
      chunkStart = w.start;
    }
    current.push(w);
  }
  flush();
  return chunks;
}

/** Seconds → ASS H:MM:SS.CC */
export function secToAss(sec: number): string {
  const clamped = Math.max(0, sec);
  const totalCs = Math.round(clamped * 100);
  const cs = totalCs % 100;
  const totalS = Math.floor(totalCs / 100);
  const s = totalS % 60;
  const totalM = Math.floor(totalS / 60);
  const m = totalM % 60;
  const hh = Math.floor(totalM / 60);
  return `${hh}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

/** Escape text for ASS dialogue lines. */
export function escapeAssText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/,/g, "{\\,}").replace(/\n/g, "\\N");
}

interface StyleDef {
  fontname: string;
  fontsize: number;
  primary: string;   // unsung word color (ASS &HAABBGGRR)
  secondary: string; // sung/active word color
  outline: string;
  back: string;
  bold: number;
  outlineW: number;
  shadow: number;
  alignment: number;
  marginV: number;
}

const FONT_SIZE_PX: Record<CaptionFontSize, number> = { small: 44, medium: 64, large: 88 };
const ALIGN: Record<CaptionPosition, number> = { top: 8, middle: 5, bottom: 2 };

function resolveStyle(
  style: CaptionStyleKey,
  position: CaptionPosition,
  fontSize: CaptionFontSize,
  targetW: number,
  targetH: number,
): StyleDef {
  const scaleFactor = Math.min(targetW, targetH) / 1080;
  const fontsize = Math.max(28, Math.round(FONT_SIZE_PX[fontSize] * scaleFactor));
  const marginV = Math.round(Math.min(targetW, targetH) * 0.06);

  const defs: Record<CaptionStyleKey, Omit<StyleDef, "fontsize" | "alignment" | "marginV">> = {
    "hormozi": {
      fontname: "DejaVu Sans", primary: "&H00FFFFFF", secondary: "&H0000D7FF",
      outline: "&H00000000", back: "&H80000000", bold: -1, outlineW: 4, shadow: 2,
    },
    "minimal": {
      fontname: "DejaVu Sans", primary: "&H00FFFFFF", secondary: "&H00DDDDDD",
      outline: "&H00000000", back: "&H80000000", bold: 0, outlineW: 1, shadow: 1,
    },
    "karaoke": {
      fontname: "DejaVu Sans", primary: "&H00FFFFFF", secondary: "&H0000FFFF",
      outline: "&H00000000", back: "&HAA000000", bold: -1, outlineW: 2, shadow: 0,
    },
    "neon": {
      fontname: "DejaVu Sans", primary: "&H00FFFFFF", secondary: "&H00FFFF00",
      outline: "&H00FF00FF", back: "&H80000000", bold: -1, outlineW: 3, shadow: 2,
    },
    "luxury-gold": {
      fontname: "DejaVu Sans", primary: "&H0000D7FF", secondary: "&H00FFFFFF",
      outline: "&H00000000", back: "&H90000000", bold: -1, outlineW: 4, shadow: 2,
    },
  };
  const d = defs[style];
  return { ...d, fontsize, alignment: ALIGN[position], marginV };
}

/** Keyword → emoji map for the optional emoji insertion. */
const EMOJI_MAP: Array<[RegExp, string]> = [
  [/\b(fire|lit|hot)\b/i, "🔥"],
  [/\b(money|cash|rich|bag)\b/i, "💰"],
  [/\b(love|heart)\b/i, "❤️"],
  [/\b(king|queen|crown|royal)\b/i, "👑"],
  [/\b(star|amazing|incredible)\b/i, "⭐"],
  [/\b(win|winning|champion|goat)\b/i, "🏆"],
  [/\b(rocket|growth|scale)\b/i, "🚀"],
  [/\b(100|hundred|perfect)\b/i, "💯"],
  [/\b(clap|applause)\b/i, "👏"],
  [/\b(eyes|look|watch)\b/i, "👀"],
];

export function maybeAddEmoji(text: string): string {
  for (const [re, emoji] of EMOJI_MAP) {
    if (re.test(text)) return `${text} ${emoji}`;
  }
  return text;
}

/**
 * Build the full ASS subtitle content with word-by-word karaoke
 * highlighting. Each chunk becomes one Dialogue event; each word gets a
 * {\kf<centiseconds>} tag so the active word sweeps to the highlight color
 * exactly when it's spoken. This is the Hormozi-style word-pop effect —
 * real ASS karaoke, not faked.
 */
export function buildCaptionAss(
  chunks: CaptionChunk[],
  style: CaptionStyleKey,
  position: CaptionPosition,
  fontSize: CaptionFontSize,
  targetW: number,
  targetH: number,
  withEmoji: boolean,
): string {
  const s = resolveStyle(style, position, fontSize, targetW, targetH);

  const styleLine = [
    "Style: Default", s.fontname, s.fontsize,
    s.primary, s.secondary, s.outline, s.back,
    s.bold, 0, 0, 0, 100, 100, 0, 0,
    1, s.outlineW, s.shadow, s.alignment,
    40, 40, s.marginV, 1,
  ].join(",");

  const events = chunks.map((chunk) => {
    const wordsWithKf = chunk.words.map((w) => {
      const durCs = Math.max(1, Math.round((w.end - w.start) * 100));
      let text = w.word.trim();
      if (!text) return "";
      if (withEmoji) text = maybeAddEmoji(text);
      return `{\\kf${durCs}}${escapeAssText(text)}`;
    }).filter(Boolean).join(" ");

    return `Dialogue: 0,${secToAss(chunk.start)},${secToAss(chunk.end)},Default,,0,0,0,,${wordsWithKf}`;
  }).join("\n");

  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${targetW}\nPlayResY: ${targetH}\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n${styleLine}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${events}\n`;
}

/** ffmpeg args: burn ASS subtitles, keep original audio, H.264 output. */
export function buildFfmpegArgs(inputPath: string, assPath: string, outputPath: string): string[] {
  return [
    "-y",
    "-i", inputPath,
    "-vf", `subtitles=${assPath.replace(/'/g, "'\\''")}`,
    "-c:v", "libx264",
    "-preset", "fast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    outputPath,
  ];
}

/* ── Server-owned background jobs (in-memory; not tab-dependent) ───── */

type CaptionStylerJobStatus = "queued" | "transcribing" | "rendering" | "done" | "failed";

export interface CaptionStylerJob {
  id: string;
  userId: string;
  status: CaptionStylerJobStatus;
  style: CaptionStyleKey;
  position: CaptionPosition;
  fontSize: CaptionFontSize;
  withEmoji: boolean;
  sourceName: string;
  outputUrl: string | null;
  outputRef: string | null;
  error: string | null;
  creditsCharged: number;
  createdAt: number;
  /* CA-2 replay plumbing (Pattern B): the charge's idempotency key and
     the exact POST body served at creation. Optional so jobs built by
     unit tests / other callers keep working unchanged. */
  chargeKey?: string;
  replayBody?: Record<string, unknown>;
  /** Durable jobs (0335): the exactly-once refund claim — claimed in
   *  the persisted row before any refund moves. */
  creditsRefunded?: boolean;
  /** Durable jobs (0335): the worker's inputs, persisted with the job
   *  so a worker resumed after a restart re-runs the exact ask. The
   *  upload is disk-backed; if the file did not survive, the job
   *  settles (failed + refunded exactly once). */
  workerInput?: { uploadedPath: string; originalName: string };
}

const jobs = new Map<string, CaptionStylerJob>();
attachJobMapTtl(jobs); // 2026-10-12 OOM fix: TTL eviction (lib/job-map-sweeper)

/* ── Durable job storage (migration 0335) ─────────────────────────
   The Map above is the working cache; generation_jobs is the
   record. Jobs persist at creation, mirror on settle, and a lookup
   that misses the Map rehydrates from the table — a job survives
   a server restart: its worker resumes from the persisted upload
   path when the file survived, and settles (failed + refunded
   exactly once, claim first) when it did not. Fail-open throughout
   (lib/generation-jobs). */
const jobStore = new DurableJobStore<CaptionStylerJob>(jobs, {
  rail: "caption-styler",
  statusOf: (j) => j.status,
  isTerminalStatus: (s) => s === "done" || s === "failed",
  setFailed: (j, error) => {
    j.status = "failed";
    j.error = error;
  },
  amountOf: (j) => j.creditsCharged,
  chargeKeyOf: (j) => j.chargeKey ?? null,
  refundAction: "Caption Styler — Refund (job failed)",
  settleError: "Caption styling was interrupted by a server restart — your Visual Bucs were refunded.",
  resume: async (job) => {
    const input = job.workerInput;
    if (!input) return false;
    const survived = await fs.access(input.uploadedPath).then(
      () => true,
      () => false,
    );
    if (!survived) return false;
    void runCaptionStylerJob(job, input.uploadedPath, input.originalName);
    return true;
  },
});

export function getCaptionStylerJob(id: string): CaptionStylerJob | undefined {
  return jobs.get(id);
}

/** Test hook: clear the in-memory job store. */
export function __clearCaptionStylerJobs(): void {
  jobs.clear();
}

async function transcribeWords(audioPath: string): Promise<WordTiming[]> {
  const { promises: fsp } = await import("fs");
  const buffer = await fsp.readFile(audioPath);
  const transcription = await transcribeAudioTimed({
    buffer,
    filename: "audio.mp3",
    mimeType: "audio/mpeg",
    signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS),
  });

  const words = (transcription.words ?? [])
    .filter((w) => w.word?.trim() && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start)
    .map((w) => ({ word: w.word.trim(), start: w.start, end: w.end }));

  if (words.length === 0) {
    throw new Error("No speech detected in this video — captions need spoken words to work with.");
  }
  return words;
}

async function probeVideoSize(inputPath: string): Promise<{ w: number; h: number }> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=p=0",
      inputPath,
    ], { timeout: 30_000 });
    const [w, h] = stdout.trim().split(",").map((n) => parseInt(n, 10));
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return { w, h };
  } catch { /* fall through to default */ }
  return { w: 1280, h: 720 };
}

/** Exported for tests. */
export async function runCaptionStylerJob(job: CaptionStylerJob, uploadedPath: string, originalName: string): Promise<void> {
  const workDir = await fs.mkdtemp(join(tmpdir(), "caption-styler-"));
  const ext = (originalName.split(".").pop() ?? "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
  const inputPath = join(workDir, `input.${ext}`);
  const audioPath = join(workDir, "audio.mp3");
  const assPath = join(workDir, "captions.ass");
  const outputPath = join(workDir, "captioned.mp4");

  try {
    await fs.copyFile(uploadedPath, inputPath); // 2026-10-12 OOM fix: upload is disk-backed, never a RAM Buffer

    // 1. Extract audio for transcription (mp3 keeps it under the 25MB cap
    // for typical short-form videos; longer videos may still exceed it).
    job.status = "transcribing";
    await execFileAsync("ffmpeg", [
      "-y", "-i", inputPath,
      "-vn", "-ac", "1", "-ar", "16000",
      "-b:a", "64k", audioPath,
    ], { timeout: 120_000 });

    const audioStat = await fs.stat(audioPath);
    if (audioStat.size > WHISPER_MAX_BYTES) {
      throw new Error(
        "This video's audio is too large to transcribe (over 25 MB). Try a shorter clip.",
      );
    }

    // 2. Transcribe with word-level timestamps.
    const words = await transcribeWords(audioPath);
    const chunks = groupWordsIntoChunks(words);
    if (chunks.length === 0) {
      throw new Error("Could not build captions from this video's audio.");
    }

    // 3. Render: probe size, build ASS, burn in with ffmpeg.
    job.status = "rendering";
    const { w, h } = await probeVideoSize(inputPath);
    const ass = buildCaptionAss(chunks, job.style, job.position, job.fontSize, w, h, job.withEmoji);
    await fs.writeFile(assPath, ass, "utf8");

    await execFileAsync("ffmpeg", buildFfmpegArgs(inputPath, assPath, outputPath), {
      timeout: 600_000, // 10 min cap
    });

    const outBuffer = await fs.readFile(outputPath);
    const objectName = `captioned/${job.userId}/${Date.now()}-${job.id}.mp4`;
    const ref = await uploadMediaToSupabaseStorage(objectName, outBuffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(ref);

    job.status = "done";
    job.outputUrl = url;
    job.outputRef = ref;
    /* CA-2: persist the creation result under the charge key once the
       job has COMPLETED — a replay after the in-memory job is gone is
       served from the durable row instead of charging again. Fail-open
       inside the helper. */
    if (job.chargeKey && job.replayBody) {
      await storeGenerationResult("caption-styler", job.chargeKey, job.userId, job.replayBody);
    }
  } catch (err) {
    job.error = err instanceof Error ? err.message : "Caption styling failed";
    /* Durable (0335): claim the refund BEFORE it moves — a job whose
       refund already landed never refunds twice. The refund still
       lands BEFORE the job reads "failed" (and before the key void),
       so a retry that sees the failed job always faces a voided key
       and charges fresh — never a suppressed free re-run. */
    const claimed = await jobStore.claimRefund(job);
    if (claimed) {
      let refunded = true;
      try {
        await refundCredits(job.userId, job.creditsCharged, {
          action: "Caption Styler — Refund (job failed)",
        });
      } catch (refundErr) {
        refunded = false;
        void refundErr;
      }
      if (refunded && job.chargeKey) {
        try {
          await voidChargeIdempotencyKey(job.chargeKey);
        } catch {
          /* void is best-effort here; a failed void is logged in credits */
        }
      }
    }
    job.status = "failed";
  } finally {
    void jobStore.sync(job); // durable: the settled state is the post-restart record
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
    await fs.unlink(uploadedPath).catch(() => {});
  }
}

/* ── CA-2 replay plumbing (Pattern B, avatar-presenter shape) ──────────
   The job's identity derives from the charge idempotency key: the key
   is built from the request intent (style options + a sha256 of the
   uploaded bytes — the file IS the defining input), and the job id is
   that key's hash. A replay of the same ask therefore lands on the
   SAME job: no second charge, no second render. An in-flight twin map
   closes the concurrent window while the first creation is between
   charge and job-mint. */
async function hashFileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest("hex");
}

interface CaptionCreationOutcome {
  status: number;
  body: Record<string, unknown>;
}

const captionCreationsInFlight = new Map<string, Promise<CaptionCreationOutcome>>();

async function runCaptionCreationOnce(
  idempotencyKey: string,
  work: () => Promise<CaptionCreationOutcome>,
): Promise<CaptionCreationOutcome & { replayed: boolean }> {
  const pending = captionCreationsInFlight.get(idempotencyKey);
  if (pending) {
    const twin = await pending.catch(() => null);
    if (twin && twin.status === 202) return { ...twin, replayed: true };
    /* The twin failed — run this request fresh. */
  }
  const run = work();
  captionCreationsInFlight.set(idempotencyKey, run);
  try {
    const outcome = await run;
    return { ...outcome, replayed: false };
  } finally {
    if (captionCreationsInFlight.get(idempotencyKey) === run) {
      captionCreationsInFlight.delete(idempotencyKey);
    }
  }
}

/* ── Routes ─────────────────────────────────────────────────────────── */

/**
 * POST /api/caption-styler
 *
 * Upload a video → AI transcribes with word timestamps → animated
 * word-by-word captions burned in (Hormozi-style) → captioned MP4.
 *
 * Flow: upload video + style options → charge 3 credits → server-owned
 * background job → poll GET /api/caption-styler/:jobId → download result.
 * Failed jobs are refunded automatically.
 */
router.post("/caption-styler", requireAuth, upload.single("video"), async (req, res) => {
  const parsed = captionStylerSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { style, position, fontSize, withEmoji } = parsed.data;

  if (!req.file) {
    res.status(400).json({ error: "No video file provided" });
    return;
  }

  /* Idempotency (CA-2, Pattern B): server-derived key on EVERY call —
     the schema accepts no client key, so the intent hash IS the key.
     Intent = the style options + sha256 of the uploaded bytes. */
  const fileSha256 = await hashFileSha256(req.file.path);
  const idempotencyKey = buildChargeIdempotencyKey("caption-styler", req.userId!, undefined, {
    style,
    position,
    fontSize,
    withEmoji,
    fileSha256,
  });
  const jobId = createHash("sha256").update(idempotencyKey).digest("hex").slice(0, 32);

  /* Replay, in-memory first: the same ask returns the SAME job. A
     FAILED job (refunded + key voided by the runner) is dropped so
     this request runs fresh below. */
  const existing = await jobStore.find(jobId); // Map first, durable store on a miss (0335)
  if (existing && existing.userId === req.userId) {
    if (existing.status !== "failed") {
      res.status(202).json({
        ...(existing.replayBody ?? {
          jobId: existing.id,
          status: existing.status,
          style: existing.style,
          creditsCharged: existing.creditsCharged,
        }),
        replayed: true,
      });
      return;
    }
    jobs.delete(jobId);
  }

  /* Stored-result pre-check BEFORE any funding: serves a COMPLETED
     job's creation result after the in-memory job has been evicted. */
  const storedResult = await findStoredGenerationResult("caption-styler", idempotencyKey, req.userId!);
  if (storedResult) {
    res.status(202).json({ ...storedResult, replayed: true });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < CAPTION_STYLER_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to style captions.",
    });
    return;
  }

  const uploadedPath = req.file.path;
  const originalName = req.file.originalname;
  const outcome = await runCaptionCreationOnce(idempotencyKey, async (): Promise<CaptionCreationOutcome> => {
    let creditsRemaining = balance;
    try {
      creditsRemaining = await chargeCredits(req.userId!, CAPTION_STYLER_CREDIT_COST, {
        action: `Caption Styler (${style})`,
      }, { idempotencyKey });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        return {
          status: 402,
          body: {
            error: "out_of_credits",
            message: "You're out of Visual Bucs — top up to style captions.",
          },
        };
      }
      if (err instanceof LedgerWriteError) {
        return { status: 500, body: { error: "Could not record the Visual Buc charge. Please try again." } };
      }
      throw err;
    }

    const job: CaptionStylerJob = {
      id: jobId,
      userId: req.userId!,
      status: "queued",
      style,
      position,
      fontSize,
      withEmoji,
      sourceName: originalName,
      outputUrl: null,
      outputRef: null,
      error: null,
      creditsCharged: CAPTION_STYLER_CREDIT_COST,
      createdAt: Date.now(),
      chargeKey: idempotencyKey,
      creditsRefunded: false,
      workerInput: { uploadedPath, originalName },
    };
    const body: Record<string, unknown> = {
      jobId: job.id,
      status: job.status,
      style: job.style,
      creditsCharged: CAPTION_STYLER_CREDIT_COST,
      creditsRemaining,
    };
    job.replayBody = body;
    jobs.set(job.id, job);
    await jobStore.persist(job); // durable (0335): the row lands before the worker fires

    // Server-owned: runs detached from the request/tab lifecycle.
    void runCaptionStylerJob(job, uploadedPath, originalName);

    return { status: 202, body };
  });

  if (outcome.replayed && outcome.status === 202) {
    res.status(202).json({ ...outcome.body, replayed: true });
    return;
  }
  res.status(outcome.status).json(outcome.body);
});

/**
 * GET /api/caption-styler/:jobId
 *
 * Poll job status. Returns outputUrl when done (a signed, reviewable URL).
 * Jobs are scoped to the requesting user.
 */
router.get("/caption-styler/:jobId", requireAuth, async (req, res) => {
  const job = await jobStore.find(req.params.jobId as string); // Map first, durable store on a miss (0335)
  if (!job || job.userId !== req.userId) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({
    jobId: job.id,
    status: job.status,
    style: job.style,
    outputUrl: job.outputUrl,
    error: job.error,
    creditsCharged: job.creditsCharged,
  });
});

/** Turn multer upload errors into clean JSON the frontend can display. */
router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: "FILE_TOO_LARGE",
        message: "This video exceeds the 80 MB upload limit.",
      });
      return;
    }
    res.status(400).json({ error: err.message });
    return;
  }
  if (err instanceof Error && /only video files/i.test(err.message)) {
    res.status(400).json({ error: "Only video files are allowed." });
    return;
  }
  next(err);
});

export default router;
