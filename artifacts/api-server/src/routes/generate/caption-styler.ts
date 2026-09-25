import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { promisify } from "util";
import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";
import { toFile } from "openai";
import { getOpenAI } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";

const router = Router();
const execFileAsync = promisify(execFile);

export const CAPTION_STYLER_CREDIT_COST = Number(process.env["CAPTION_STYLER_CREDITS"]) || 3;
const CAPTION_STYLER_MAX_BYTES = 80 * 1024 * 1024; // 80 MB, same guard as clip uploads
const WHISPER_MAX_BYTES = 25 * 1024 * 1024; // Whisper's hard limit
const WHISPER_TIMEOUT_MS = 240_000; // 4 minutes

const upload = multer({
  storage: multer.memoryStorage(),
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

export type CaptionStyleKey = "hormozi" | "minimal" | "karaoke" | "neon" | "luxury-gold";
export type CaptionPosition = "top" | "middle" | "bottom";
export type CaptionFontSize = "small" | "medium" | "large";

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

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface CaptionChunk {
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

export type CaptionStylerJobStatus = "queued" | "transcribing" | "rendering" | "done" | "failed";

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
}

const jobs = new Map<string, CaptionStylerJob>();

export function getCaptionStylerJob(id: string): CaptionStylerJob | undefined {
  return jobs.get(id);
}

/** Test hook: clear the in-memory job store. */
export function __clearCaptionStylerJobs(): void {
  jobs.clear();
}

type WhisperWord = { word: string; start: number; end: number };
type VerboseTranscription = {
  text: string;
  words?: WhisperWord[];
};

async function transcribeWords(audioPath: string): Promise<WordTiming[]> {
  const { promises: fsp } = await import("fs");
  const buffer = await fsp.readFile(audioPath);
  const audioFile = await toFile(buffer, "audio.mp3", { type: "audio/mpeg" });
  const transcription = (await getOpenAI().audio.transcriptions.create(
    {
      file: audioFile,
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
    },
    { signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS) },
  )) as unknown as VerboseTranscription;

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
export async function runCaptionStylerJob(job: CaptionStylerJob, inputBuffer: Buffer, originalName: string): Promise<void> {
  const workDir = await fs.mkdtemp(join(tmpdir(), "caption-styler-"));
  const ext = (originalName.split(".").pop() ?? "mp4").toLowerCase().replace(/[^a-z0-9]/g, "") || "mp4";
  const inputPath = join(workDir, `input.${ext}`);
  const audioPath = join(workDir, "audio.mp3");
  const assPath = join(workDir, "captions.ass");
  const outputPath = join(workDir, "captioned.mp4");

  try {
    await fs.writeFile(inputPath, inputBuffer);

    // 1. Extract audio for Whisper (mp3 keeps it under the 25MB Whisper cap
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
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : "Caption styling failed";
    // Refund: the user paid for an output they didn't get.
    try {
      await refundCredits(job.userId, job.creditsCharged, {
        action: "Caption Styler — Refund (job failed)",
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
 * POST /api/caption-styler
 *
 * Upload a video → AI transcribes with word timestamps → animated
 * word-by-word captions burned in (Hormozi-style) → captioned MP4.
 *
 * Flow: upload video + style options → charge 3 credits → server-owned
 * background job → poll GET /api/caption-styler/:jobId → download result.
 * Failed jobs are refunded automatically.
 */
router.post("/api/caption-styler", requireAuth, upload.single("video"), async (req, res) => {
  const { style, position, fontSize, withEmoji } = req.body as {
    style?: string;
    position?: string;
    fontSize?: string;
    withEmoji?: string | boolean;
  };

  if (!isCaptionStyleKey(style)) {
    res.status(400).json({
      error: "INVALID_STYLE",
      message: `style must be one of: ${Object.keys(CAPTION_STYLES).join(", ")}`,
    });
    return;
  }
  const pos: CaptionPosition = position === "top" || position === "middle" ? position : "bottom";
  const size: CaptionFontSize = fontSize === "small" || fontSize === "large" ? fontSize : "medium";
  const emoji = withEmoji === true || withEmoji === "true" || withEmoji === "1";

  if (!req.file) {
    res.status(400).json({ error: "No video file provided" });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < CAPTION_STYLER_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to style captions.",
    });
    return;
  }

  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, CAPTION_STYLER_CREDIT_COST, {
      action: `Caption Styler (${style})`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to style captions.",
      });
      return;
    }
    if (err instanceof LedgerWriteError) {
      res.status(500).json({ error: "Could not record the credit charge. Please try again." });
      return;
    }
    throw err;
  }

  const job: CaptionStylerJob = {
    id: randomUUID(),
    userId: req.userId!,
    status: "queued",
    style,
    position: pos,
    fontSize: size,
    withEmoji: emoji,
    sourceName: req.file.originalname,
    outputUrl: null,
    outputRef: null,
    error: null,
    creditsCharged: CAPTION_STYLER_CREDIT_COST,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);

  // Server-owned: runs detached from the request/tab lifecycle.
  void runCaptionStylerJob(job, req.file.buffer, req.file.originalname);

  res.status(202).json({
    jobId: job.id,
    status: job.status,
    style: job.style,
    creditsCharged: CAPTION_STYLER_CREDIT_COST,
    creditsRemaining,
  });
});

/**
 * GET /api/caption-styler/:jobId
 *
 * Poll job status. Returns outputUrl when done (a signed, reviewable URL).
 * Jobs are scoped to the requesting user.
 */
router.get("/api/caption-styler/:jobId", requireAuth, async (req, res) => {
  const job = getCaptionStylerJob(req.params.jobId as string);
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
