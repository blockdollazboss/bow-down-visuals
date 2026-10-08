import { randomUUID } from "crypto";
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
} from "../../lib/credits";
import { getOpenAI } from "../../lib/ai-clients";
import { toFile } from "openai";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── AI Filler-Word Remover ──────────────────────────────────────────────
   The Descript-killer for talking-head creators: transcribe with Whisper
   (word-level timestamps), find filler words ("um", "uh", "like",
   "you know", …) plus long dead-air pauses, then reassemble the video
   with ffmpeg so every filler is cut out.

   Flow (two phases so the user approves cuts before the render):
     1. POST /api/remove-fillers/analyze  → 402 pre-check → charge 200
        Visual Bucs → server-owned background job → poll
        GET /api/remove-fillers/analyze/:jobId → cut list + "time saved".
     2. POST /api/remove-fillers/render { analyzeJobId, cuts } → second
        server-owned job (no extra charge) → poll
        GET /api/remove-fillers/render/:jobId → cleaned video URL.
   Failed jobs are refunded automatically. */

export const FILLER_REMOVAL_CREDIT_COST =
  Number(process.env["FILLER_REMOVAL_CREDITS"]) || 200;

const FILLER_MAX_BYTES = 250 * 1024 * 1024; // 250 MB media download cap
const WHISPER_MAX_BYTES = 25 * 1024 * 1024; // 25 MB (Whisper's hard limit)
const WHISPER_TIMEOUT_MS = 240_000; // 4 minutes, matches /api/transcribe-url

/** Padding added around each filler-word cut so speech isn't clipped. */
const FILLER_PAD_SEC = 0.15;
/** Cuts closer than this get merged (avoids choppy micro-segments). */
const MERGE_GAP_SEC = 0.2;
/** Keep-segments shorter than this are absorbed into neighboring cuts. */
const MIN_KEEP_SEC = 0.15;

export interface FillerCut {
  id: string;
  /** seconds */
  start: number;
  /** seconds */
  end: number;
  kind: "filler" | "silence";
  /** the word/phrase, or e.g. "silence · 1.4s" */
  label: string;
}

interface WordTs {
  word: string;
  start: number;
  end: number;
}

type VerboseTranscription = {
  text: string;
  duration?: number;
  words?: Array<{ word: string; start: number; end: number }>;
  language?: string;
};

const analyzeSchema = z.object({
  mediaUrl: z.string().trim().min(1).max(2048),
  /** Enabled filler words/phrases (multi-word phrases like "you know" allowed). */
  fillerWords: z.array(z.string().trim().min(1).max(40)).max(80).optional().default([]),
  removeSilences: z.boolean().optional().default(true),
  /** Silence threshold in dB — lower = more aggressive. */
  silenceThresholdDb: z.number().min(-60).max(-10).optional().default(-35),
  /** Minimum dead-air duration in seconds to cut. */
  minSilenceDuration: z.number().min(0.3).max(5).optional().default(0.8),
});

const renderSchema = z.object({
  analyzeJobId: z.string().trim().min(1).max(64),
  cuts: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(64),
        start: z.number().min(0).max(86400),
        end: z.number().min(0).max(86400),
        kind: z.enum(["filler", "silence"]),
        label: z.string().trim().min(1).max(80),
      }),
    )
    .min(1)
    .max(2000),
});

/* ─── Filler detection (pure, exported for tests) ─────────────────────── */

function normalizeWord(w: string): string {
  return w
    .toLowerCase()
    .replace(/^[^a-z0-9']+|[^a-z0-9']+$/g, "")
    .replace(/'/g, "");
}

interface CompiledFillers {
  singles: Set<string>;
  phrases: string[][];
}

/** Exported for tests. */
export function compileFillerList(words: string[]): CompiledFillers {
  const singles = new Set<string>();
  const phrases: string[][] = [];
  for (const raw of words) {
    const parts = raw
      .split(/\s+/)
      .map(normalizeWord)
      .filter((p) => p.length > 0);
    if (parts.length === 0) continue;
    if (parts.length === 1) singles.add(parts[0]);
    else phrases.push(parts);
  }
  return { singles, phrases };
}

/**
 * Find filler-word cuts from word-level timestamps. Multi-word phrases
 * match across consecutive words. Exported for tests.
 */
export function detectFillerCuts(
  words: WordTs[],
  fillerWords: string[],
  padSec = FILLER_PAD_SEC,
): FillerCut[] {
  const { singles, phrases } = compileFillerList(fillerWords);
  if (singles.size === 0 && phrases.length === 0) return [];

  const norm = words.map((w) => ({ ...w, n: normalizeWord(w.word) }));
  const cuts: FillerCut[] = [];
  const consumed = new Set<number>();

  // Phrases first (longest match wins at each position).
  const sortedPhrases = [...phrases].sort((a, b) => b.length - a.length);
  for (let i = 0; i < norm.length; i++) {
    if (consumed.has(i)) continue;
    for (const phrase of sortedPhrases) {
      let ok = true;
      for (let k = 0; k < phrase.length; k++) {
        const w = norm[i + k];
        if (!w || w.n !== phrase[k] || consumed.has(i + k)) {
          ok = false;
          break;
        }
      }
      if (ok) {
        const first = norm[i];
        const last = norm[i + phrase.length - 1];
        cuts.push({
          id: `filler-${i}`,
          start: Math.max(0, first.start - padSec),
          end: last.end + padSec,
          kind: "filler",
          label: phrase.join(" "),
        });
        for (let k = 0; k < phrase.length; k++) consumed.add(i + k);
        break;
      }
    }
  }

  for (let i = 0; i < norm.length; i++) {
    if (consumed.has(i)) continue;
    const w = norm[i];
    if (w.n && singles.has(w.n)) {
      cuts.push({
        id: `filler-${i}`,
        start: Math.max(0, w.start - padSec),
        end: w.end + padSec,
        kind: "filler",
        label: w.n,
      });
      consumed.add(i);
    }
  }

  return mergeCuts(cuts);
}

/** Merge overlapping / adjacent cuts. Exported for tests. */
export function mergeCuts(cuts: FillerCut[]): FillerCut[] {
  const sorted = [...cuts].sort((a, b) => a.start - b.start);
  const merged: FillerCut[] = [];
  for (const c of sorted) {
    const last = merged[merged.length - 1];
    if (last && c.start - last.end <= MERGE_GAP_SEC) {
      last.end = Math.max(last.end, c.end);
      const kinds = new Set([last.kind, c.kind]);
      last.kind = kinds.has("silence") ? "silence" : "filler";
      if (last.kind === "silence") {
        last.label = [last.label, c.label].find((l) => l.startsWith("silence")) ?? last.label;
      } else if (!last.label.split(" + ").includes(c.label)) {
        last.label = `${last.label} + ${c.label}`;
      }
    } else {
      merged.push({ ...c });
    }
  }
  return merged;
}

/**
 * Build the keep-segments (what survives) from a duration + cut list.
 * Tiny keep-segments are absorbed into neighboring cuts. Exported for tests.
 */
export function buildKeepSegments(
  duration: number,
  cuts: FillerCut[],
): Array<{ start: number; end: number }> {
  const sorted = [...cuts]
    .filter((c) => c.end > 0 && c.start < duration)
    .map((c) => ({
      start: Math.max(0, c.start),
      end: Math.min(duration, c.end),
    }))
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start);

  const keeps: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const c of sorted) {
    if (c.start > cursor) keeps.push({ start: cursor, end: c.start });
    cursor = Math.max(cursor, c.end);
  }
  if (cursor < duration) keeps.push({ start: cursor, end: duration });

  // Absorb slivers: drop keep-segments shorter than MIN_KEEP_SEC by
  // extending the neighboring cut (i.e. just drop the keep).
  return keeps.filter((k) => k.end - k.start >= MIN_KEEP_SEC);
}

/* ─── Silence detection via ffmpeg silencedetect ──────────────────────── */

interface SilenceSpan {
  start: number;
  end: number;
}

/** Exported for tests (pure parsing). */
export function parseSilenceDetect(stderr: string): SilenceSpan[] {
  const spans: SilenceSpan[] = [];
  let openStart: number | null = null;
  for (const line of stderr.split("\n")) {
    const startMatch = line.match(/silence_start:\s*([0-9.]+)/);
    if (startMatch) {
      openStart = parseFloat(startMatch[1]);
      continue;
    }
    const endMatch = line.match(/silence_end:\s*([0-9.]+)/);
    if (endMatch && openStart != null) {
      spans.push({ start: openStart, end: parseFloat(endMatch[1]) });
      openStart = null;
    }
  }
  return spans;
}

async function detectSilences(
  inputPath: string,
  thresholdDb: number,
  minDuration: number,
): Promise<FillerCut[]> {
  const { stderr } = await execFileAsync(
    "ffmpeg",
    [
      "-hide_banner",
      "-i",
      inputPath,
      "-af",
      `silencedetect=noise=${thresholdDb}dB:d=${minDuration}`,
      "-f",
      "null",
      "-",
    ],
    { timeout: 300_000, maxBuffer: 64 * 1024 * 1024 },
  ).catch((err: unknown) => {
    // silencedetect always "fails" the null muxer path with noisy stderr;
    // execFile rejects only on non-zero exit — ffmpeg exits 0 here, but
    // be defensive and parse whatever stderr we got.
    if (err instanceof Error && "stderr" in err) {
      return { stderr: String((err as { stderr: unknown }).stderr) };
    }
    throw err;
  });

  const spans = parseSilenceDetect(stderr);
  const cuts: FillerCut[] = [];
  for (const s of spans) {
    // Leave a natural micro-beat so the edit doesn't feel rushed.
    const start = s.start + 0.08;
    const end = s.end - 0.08;
    if (end - start < minDuration * 0.5) continue;
    cuts.push({
      id: `silence-${s.start.toFixed(2)}`,
      start: Math.max(0, start),
      end,
      kind: "silence",
      label: `silence · ${(s.end - s.start).toFixed(1)}s`,
    });
  }
  return mergeCuts(cuts);
}

/* ─── Media helpers ───────────────────────────────────────────────────── */

async function downloadMedia(mediaUrl: string, destPath: string): Promise<void> {
  /* SSRF protection — only allow URLs from the project's Supabase storage,
     mirroring /api/transcribe-url. */
  const supabaseUrl = process.env["SUPABASE_URL"] ?? "";
  let parsed: URL;
  try {
    parsed = new URL(mediaUrl);
  } catch {
    throw new Error("Invalid media URL.");
  }
  if (supabaseUrl) {
    try {
      const allowed = new URL(supabaseUrl).hostname;
      if (parsed.hostname !== allowed) {
        throw new Error("Media URL must be from your project storage.");
      }
    } catch (err) {
      if (err instanceof Error && err.message === "Media URL must be from your project storage.") {
        throw err;
      }
      // Malformed SUPABASE_URL — warn and continue (matches transcribe-url).
    }
  }

  const headRes = await fetch(mediaUrl, {
    method: "HEAD",
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  const contentLength = headRes?.headers.get("content-length");
  if (contentLength && Number(contentLength) > FILLER_MAX_BYTES) {
    throw new Error(
      `This video is ${(Number(contentLength) / 1024 / 1024).toFixed(0)} MB — the filler remover handles files up to 250 MB.`,
    );
  }

  const res = await fetch(mediaUrl, { signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`Could not download the video (HTTP ${res.status}).`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) throw new Error("Downloaded file is empty.");
  if (buffer.length > FILLER_MAX_BYTES) {
    throw new Error("This video exceeds the 250 MB size limit for filler removal.");
  }
  await fs.writeFile(destPath, buffer);
}

/** Extract a small mono MP3 so Whisper stays under its 25 MB limit. */
async function extractAudioForWhisper(
  inputPath: string,
  audioPath: string,
): Promise<void> {
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-i",
      inputPath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "64k",
      audioPath,
    ],
    { timeout: 300_000 },
  );
}

function parseDuration(stderr: string): number | null {
  const m = stderr.match(/Duration:\s*(\d+):(\d+):([0-9.]+)/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const s = Number(m[3]);
  const total = h * 3600 + min * s;
  return Number.isFinite(total) && total > 0 ? total : null;
}

function hasVideoStream(stderr: string): boolean {
  return /Stream #\d+:\d+.*Video:/.test(stderr);
}

async function probeMedia(inputPath: string): Promise<{ duration: number | null; hasVideo: boolean }> {
  try {
    await execFileAsync("ffmpeg", ["-hide_banner", "-i", inputPath], {
      timeout: 60_000,
    });
    return { duration: null, hasVideo: false };
  } catch (err: unknown) {
    const stderr =
      err instanceof Error && "stderr" in err
        ? String((err as { stderr: unknown }).stderr)
        : "";
    return { duration: parseDuration(stderr), hasVideo: hasVideoStream(stderr) };
  }
}

function isTranscriptionUnconfigured(err: unknown): boolean {
  return (
    err instanceof Error && err.message.includes("OPENAI_API_KEY is not configured")
  );
}

async function transcribeWords(audioPath: string): Promise<VerboseTranscription> {
  const buffer = await fs.readFile(audioPath);
  if (buffer.length > WHISPER_MAX_BYTES) {
    throw new Error(
      "The extracted audio still exceeds Whisper's 25 MB limit — try a shorter video.",
    );
  }
  const file = await toFile(buffer, "audio.mp3", { type: "audio/mpeg" });
  let client;
  try {
    client = getOpenAI();
  } catch (err) {
    if (isTranscriptionUnconfigured(err)) {
      throw new Error(
        "Transcription is not configured on this server (OPENAI_API_KEY is missing) — the filler remover can't run without it.",
      );
    }
    throw err;
  }
  try {
    const transcription = (await client.audio.transcriptions.create(
      {
        file,
        model: "whisper-1",
        response_format: "verbose_json",
        timestamp_granularities: ["word", "segment"],
      },
      { signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS) },
    )) as unknown as VerboseTranscription;
    return transcription;
  } catch (err) {
    if (isTranscriptionUnconfigured(err)) {
      throw new Error(
        "Transcription is not configured on this server (OPENAI_API_KEY is missing) — the filler remover can't run without it.",
      );
    }
    throw err;
  }
}

/* ─── ffmpeg cut assembly ─────────────────────────────────────────────── */

/** Build the single-pass ffmpeg concat command for the keep-segments.
 *  Exported for tests. */
export function buildConcatArgs(
  inputPath: string,
  keeps: Array<{ start: number; end: number }>,
  outputPath: string,
  hasVideo: boolean,
): string[] {
  const args: string[] = ["-y", "-hide_banner"];
  for (const k of keeps) {
    args.push(
      "-ss",
      k.start.toFixed(3),
      "-t",
      (k.end - k.start).toFixed(3),
      "-i",
      inputPath,
    );
  }
  const n = keeps.length;
  const inputs = keeps.map((_, i) => `[${i}:v][${i}:a]`).join("");
  const filter = hasVideo
    ? `${inputs}concat=n=${n}:v=1:a=1[outv][outa]`
    : keeps.map((_, i) => `[${i}:a]`).join("") + `concat=n=${n}:v=0:a=1[outa]`;
  args.push("-filter_complex", filter);
  if (hasVideo) {
    args.push(
      "-map",
      "[outv]",
      "-map",
      "[outa]",
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
    );
  } else {
    args.push("-map", "[outa]");
  }
  args.push("-c:a", "aac", "-movflags", "+faststart", outputPath);
  return args;
}

/* ─── Server-owned background jobs (in-memory; not tab-dependent) ─────── */

export type FillerAnalyzeStatus =
  | "queued"
  | "downloading"
  | "extracting-audio"
  | "transcribing"
  | "detecting"
  | "done"
  | "failed";

export interface FillerAnalyzeJob {
  id: string;
  userId: string;
  status: FillerAnalyzeStatus;
  mediaUrl: string;
  fillerWords: string[];
  removeSilences: boolean;
  silenceThresholdDb: number;
  minSilenceDuration: number;
  cuts: FillerCut[];
  transcript: string | null;
  durationSec: number | null;
  timeSavedSec: number;
  error: string | null;
  creditsCharged: number;
  createdAt: number;
}

export type FillerRenderStatus =
  | "queued"
  | "downloading"
  | "cutting"
  | "uploading"
  | "done"
  | "failed";

export interface FillerRenderJob {
  id: string;
  userId: string;
  status: FillerRenderStatus;
  analyzeJobId: string;
  cuts: FillerCut[];
  outputUrl: string | null;
  outputRef: string | null;
  timeSavedSec: number;
  cutsApplied: number;
  error: string | null;
  creditsCharged: number;
  createdAt: number;
}

const analyzeJobs = new Map<string, FillerAnalyzeJob>();
const renderJobs = new Map<string, FillerRenderJob>();

export function getFillerAnalyzeJob(id: string): FillerAnalyzeJob | undefined {
  return analyzeJobs.get(id);
}

export function getFillerRenderJob(id: string): FillerRenderJob | undefined {
  return renderJobs.get(id);
}

/** Test hook: clear the in-memory job stores. */
export function __clearFillerRemovalJobs(): void {
  analyzeJobs.clear();
  renderJobs.clear();
}

async function refundJob(
  userId: string,
  creditsCharged: number,
  action: string,
): Promise<void> {
  try {
    await refundCredits(userId, creditsCharged, { action });
  } catch {
    /* logged inside refundCredits — don't mask the original failure */
  }
}

/** Exported for tests / reuse. */
export async function runFillerAnalyzeJob(job: FillerAnalyzeJob): Promise<void> {
  const workDir = await fs.mkdtemp(join(tmpdir(), "filler-"));
  const inputPath = join(workDir, "input");
  const audioPath = join(workDir, "audio.mp3");

  try {
    job.status = "downloading";
    await downloadMedia(job.mediaUrl, inputPath);

    job.status = "extracting-audio";
    await extractAudioForWhisper(inputPath, audioPath);

    job.status = "transcribing";
    const transcription = await transcribeWords(audioPath);

    job.status = "detecting";
    const words: WordTs[] = (transcription.words ?? [])
      .filter(
        (w) =>
          w &&
          typeof w.word === "string" &&
          Number.isFinite(w.start) &&
          Number.isFinite(w.end) &&
          w.end > w.start,
      )
      .map((w) => ({ word: w.word, start: w.start, end: w.end }));

    const fillerCuts = detectFillerCuts(words, job.fillerWords);
    const silenceCuts = job.removeSilences
      ? await detectSilences(inputPath, job.silenceThresholdDb, job.minSilenceDuration)
      : [];

    const cuts = mergeCuts([...fillerCuts, ...silenceCuts]);
    const duration = transcription.duration ?? (await probeMedia(inputPath)).duration;
    const timeSaved = cuts.reduce((sum, c) => sum + (c.end - c.start), 0);

    job.cuts = cuts;
    job.transcript = transcription.text ?? null;
    job.durationSec = duration ?? null;
    job.timeSavedSec = Math.round(timeSaved * 10) / 10;
    job.status = "done";
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : "Filler analysis failed.";
    await refundJob(job.userId, job.creditsCharged, "Filler-Word Remover — Refund (analysis failed)");
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Exported for tests / reuse. */
export async function runFillerRenderJob(
  job: FillerRenderJob,
  analyzeJob: FillerAnalyzeJob,
): Promise<void> {
  const workDir = await fs.mkdtemp(join(tmpdir(), "filler-render-"));
  const inputPath = join(workDir, "input");

  try {
    job.status = "downloading";
    await downloadMedia(analyzeJob.mediaUrl, inputPath);

    const probe = await probeMedia(inputPath);
    const duration = probe.duration ?? analyzeJob.durationSec;
    if (!duration) throw new Error("Could not determine the video duration.");

    const keeps = buildKeepSegments(duration, job.cuts);
    if (keeps.length === 0) {
      throw new Error("These cuts would remove the entire video — keep at least one segment.");
    }

    job.status = "cutting";
    const outputPath = join(workDir, probe.hasVideo ? "cleaned.mp4" : "cleaned.m4a");
    const args = buildConcatArgs(inputPath, keeps, outputPath, probe.hasVideo);
    await execFileAsync("ffmpeg", args, {
      timeout: 600_000, // 10 min cap
      maxBuffer: 64 * 1024 * 1024,
    });

    job.status = "uploading";
    const buffer = await fs.readFile(outputPath);
    const ext = probe.hasVideo ? "mp4" : "m4a";
    const objectName = `filler-removal/${job.userId}/${Date.now()}-${job.id}.${ext}`;
    const ref = await uploadMediaToSupabaseStorage(
      objectName,
      buffer,
      probe.hasVideo ? "video/mp4" : "audio/mp4",
    );
    const url = await refreshSupabaseStorageUrl(ref);

    job.outputUrl = url;
    job.outputRef = ref;
    job.cutsApplied = job.cuts.length;
    const keptTotal = keeps.reduce((s, k) => s + (k.end - k.start), 0);
    job.timeSavedSec = Math.round((duration - keptTotal) * 10) / 10;
    job.status = "done";
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : "Filler render failed.";
    await refundJob(job.userId, job.creditsCharged, "Filler-Word Remover — Refund (render failed)");
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function chargeForAnalyze(req: Request, res: Response): Promise<number | null> {
  return (async () => {
    const balance = req.userCredits ?? 0;
    if (balance < FILLER_REMOVAL_CREDIT_COST) {
      res.status(402).json({
        error: "out_of_credits",
        message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
      });
      return null;
    }
    try {
      return await chargeCredits(req.userId!, FILLER_REMOVAL_CREDIT_COST, {
        action: "AI Filler-Word Remover",
      });
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
        return null;
      }
      if (err instanceof LedgerWriteError) {
        res.status(500).json({ error: "Could not record the Visual Buc charge. Please try again." });
        return null;
      }
      throw err;
    }
  })();
}

/* ─── Routes ──────────────────────────────────────────────────────────── */

/**
 * POST /api/remove-fillers/analyze
 *
 * Phase 1: transcribe + detect filler words and dead-air pauses.
 * 402 pre-check → charge 200 Visual Bucs → background job.
 * The user reviews/toggles cuts, then POSTs to /render.
 */
router.post("/remove-fillers/analyze", requireAuth, async (req: Request, res: Response) => {
  const parsed = analyzeSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const creditsRemaining = await chargeForAnalyze(req, res);
  if (creditsRemaining == null) return; // 402 / 500 already sent

  const d = parsed.data;
  const job: FillerAnalyzeJob = {
    id: randomUUID(),
    userId: req.userId!,
    status: "queued",
    mediaUrl: d.mediaUrl,
    fillerWords: d.fillerWords,
    removeSilences: d.removeSilences,
    silenceThresholdDb: d.silenceThresholdDb,
    minSilenceDuration: d.minSilenceDuration,
    cuts: [],
    transcript: null,
    durationSec: null,
    timeSavedSec: 0,
    error: null,
    creditsCharged: FILLER_REMOVAL_CREDIT_COST,
    createdAt: Date.now(),
  };
  analyzeJobs.set(job.id, job);

  // Server-owned: runs detached from the request/tab lifecycle.
  void runFillerAnalyzeJob(job);

  res.status(202).json({
    jobId: job.id,
    status: job.status,
    creditsCharged: FILLER_REMOVAL_CREDIT_COST,
    creditsRemaining,
  });
});

/** GET /api/remove-fillers/analyze/:jobId — poll analysis progress. */
router.get("/remove-fillers/analyze/:jobId", requireAuth, (req: Request, res: Response) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const job = analyzeJobs.get(jobId);
  if (!job || job.userId !== req.userId) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({
    jobId: job.id,
    status: job.status,
    cuts: job.cuts,
    transcript: job.transcript,
    durationSec: job.durationSec,
    timeSavedSec: job.timeSavedSec,
    fillerWords: job.fillerWords,
    error: job.error,
    createdAt: job.createdAt,
  });
});

/**
 * POST /api/remove-fillers/render
 *
 * Phase 2: reassemble the video with the user-approved cuts (no extra
 * charge — covered by the analysis charge).
 */
router.post("/remove-fillers/render", requireAuth, async (req: Request, res: Response) => {
  const parsed = renderSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const analyzeJob = analyzeJobs.get(parsed.data.analyzeJobId);
  if (!analyzeJob || analyzeJob.userId !== req.userId) {
    res.status(404).json({ error: "Analysis job not found — run the analysis first." });
    return;
  }
  if (analyzeJob.status !== "done") {
    res.status(409).json({ error: "Analysis isn't finished yet — wait for the cut list." });
    return;
  }

  const job: FillerRenderJob = {
    id: randomUUID(),
    userId: req.userId!,
    status: "queued",
    analyzeJobId: analyzeJob.id,
    cuts: parsed.data.cuts.map((c) => ({ ...c })),
    outputUrl: null,
    outputRef: null,
    timeSavedSec: 0,
    cutsApplied: 0,
    error: null,
    creditsCharged: analyzeJob.creditsCharged,
    createdAt: Date.now(),
  };
  renderJobs.set(job.id, job);

  // Server-owned: runs detached from the request/tab lifecycle.
  void runFillerRenderJob(job, analyzeJob);

  res.status(202).json({ jobId: job.id, status: job.status });
});

/** GET /api/remove-fillers/render/:jobId — poll render progress. */
router.get("/remove-fillers/render/:jobId", requireAuth, (req: Request, res: Response) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const job = renderJobs.get(jobId);
  if (!job || job.userId !== req.userId) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  res.json({
    jobId: job.id,
    status: job.status,
    outputUrl: job.outputUrl,
    timeSavedSec: job.timeSavedSec,
    cutsApplied: job.cutsApplied,
    error: job.error,
    createdAt: job.createdAt,
  });
});

export default router;
