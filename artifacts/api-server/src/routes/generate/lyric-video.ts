/**
 * lyric-video.ts — AI Lyric Video Maker.
 *
 *  POST   /api/lyric-video/align            align pasted lyrics to audio (2cr)
 *  POST   /api/lyric-video/render           render the karaoke lyric video (5cr)
 *  GET    /api/lyric-video/render/:jobId    poll a render job
 *
 * Alignment: Whisper (verbose_json + word timestamps) transcribes the audio,
 * then an LCS-based aligner maps the transcribed words onto the user's
 * pasted lyric lines, producing per-line AND per-word timings. The UI lets
 * the user fine-tune every line before rendering.
 *
 * Rendering: server-side ffmpeg. An animated gradient background (style
 * preset) + the original audio + karaoke word-by-word highlighting burned in
 * via ASS subtitles (\kf sweep tags). 16:9 or 9:16. Nothing is faked — if
 * Whisper hears no speech or the lyrics don't match the audio, alignment
 * fails loudly and the charge is refunded.
 *
 * Pricing: 2 credits per alignment (Whisper spend on every run), 5 credits
 * per render (CPU encode + storage). Both env-overridable.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import multer from "multer";
import { z } from "zod";
import { toFile } from "openai";
import { getOpenAI } from "../../lib/ai-clients";
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
  parseSupabaseStorageRefBucketed,
} from "../../lib/objectStorage";
import { getSupabaseAdmin } from "../../lib/supabase-admin";
import { db, songsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();
const execFileAsync = promisify(execFile);

/* ── Pricing ───────────────────────────────────────────────────────────── */
export const LYRIC_ALIGN_CREDIT_COST =
  Number(process.env["LYRIC_VIDEO_ALIGN_CREDITS"]) || 2;
export const LYRIC_RENDER_CREDIT_COST =
  Number(process.env["LYRIC_VIDEO_RENDER_CREDITS"]) || 5;

/** Whisper's hard per-request file limit. */
const WHISPER_MAX_BYTES = 24 * 1024 * 1024;
/** Cap audio uploads at 25 MB. */
const AUDIO_MAX_BYTES = 25 * 1024 * 1024;
const WHISPER_TIMEOUT_MS = 240_000;
/** Below this lyric-word match rate, alignment is not trustworthy. */
export const MIN_MATCH_RATE = 0.35;

/* ── Style presets ─────────────────────────────────────────────────────── */

export const LYRIC_STYLES = ["gold-luxury", "neon", "minimal", "grunge"] as const;
export type LyricStyle = (typeof LYRIC_STYLES)[number];

export const LYRIC_ASPECTS = ["16:9", "9:16"] as const;
export type LyricAspect = (typeof LYRIC_ASPECTS)[number];

export interface StyleSpec {
  label: string;
  blurb: string;
  /** ffmpeg gradients source colors (hex, no alpha). */
  bgColors: [string, string, string];
  /** Gradient drift speed — higher = more motion. */
  bgSpeed: number;
  /** ASS colors as &HAABBGGRR. Primary = sung word color. */
  primaryColor: string;
  secondaryColor: string;
  outlineColor: string;
  /** Subtle film grain overlay (grunge gets more). */
  grain: number;
  fontSize: number; // base, scaled by aspect below
}

export const STYLE_SPECS: Record<LyricStyle, StyleSpec> = {
  "gold-luxury": {
    label: "Gold Luxury",
    blurb: "The Bow Down brand look — liquid gold on black",
    bgColors: ["0x0a0a0a", "0x1a1408", "0xd4af37"],
    bgSpeed: 0.08,
    primaryColor: "&H0000D7FF", // gold #FFD700 in ASS &HAABBGGRR
    secondaryColor: "&H80FFFFFF", // soft white, unsung
    outlineColor: "&H00000000",
    grain: 4,
    fontSize: 64,
  },
  neon: {
    label: "Neon",
    blurb: "Electric cyan/magenta glow for high-energy tracks",
    bgColors: ["0x050510", "0x1a0a2e", "0xff00ff"],
    bgSpeed: 0.25,
    primaryColor: "&H00FFFF00", // cyan
    secondaryColor: "&H80555555",
    outlineColor: "&H00FF00FF", // magenta glow edge
    grain: 3,
    fontSize: 64,
  },
  minimal: {
    label: "Minimal",
    blurb: "Clean and quiet — typography does the talking",
    bgColors: ["0x111111", "0x1c1c1c", "0x2a2a2a"],
    bgSpeed: 0.03,
    primaryColor: "&H00FFFFFF",
    secondaryColor: "&H80666666",
    outlineColor: "&H00000000",
    grain: 0,
    fontSize: 58,
  },
  grunge: {
    label: "Grunge",
    blurb: "Distressed, raw, heavy texture",
    bgColors: ["0x0d0505", "0x2e0d0d", "0x8b0000"],
    bgSpeed: 0.15,
    primaryColor: "&H000000FF", // blood red
    secondaryColor: "&H80999999",
    outlineColor: "&H00000000",
    grain: 14,
    fontSize: 66,
  },
};

export const ASPECT_DIMS: Record<LyricAspect, { w: number; h: number }> = {
  "16:9": { w: 1280, h: 720 },
  "9:16": { w: 720, h: 1280 },
};

/* ── Alignment: pure, testable ─────────────────────────────────────────── */

export interface TranscriptWord {
  word: string;
  start: number; // seconds
  end: number; // seconds
}

export interface AlignedWord {
  word: string; // the lyric's original word
  startSec: number;
  endSec: number;
  /** false when timing was interpolated rather than matched. */
  matched: boolean;
}

export interface AlignedLine {
  text: string;
  startSec: number;
  endSec: number;
  words: AlignedWord[];
  /** false when the whole line was interpolated. */
  matched: boolean;
}

export interface AlignmentResult {
  lines: AlignedLine[];
  /** Fraction of lyric words matched to transcript words (0..1). */
  matchRate: number;
  durationSec: number | null;
}

/** Normalize for comparison: lowercase, strip punctuation except apostrophes. */
export function normalizeWord(w: string): string {
  return w
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9'\-]/g, "");
}

/**
 * LCS-based word alignment.
 *
 * Maps each lyric word (in order) to a transcript word (in order). Returns,
 * per lyric-word index, the transcript-word index it matched, or -1.
 * O(n*m) DP — fine for song-length inputs (a few hundred words each).
 */
export function lcsAlign(
  lyricWords: string[],
  transcriptWords: string[],
): number[] {
  const n = lyricWords.length;
  const m = transcriptWords.length;
  const mapping = new Array<number>(n).fill(-1);
  if (n === 0 || m === 0) return mapping;

  // DP table of LCS lengths. Use Uint16Array rows to keep memory small.
  const prev = new Uint16Array(m + 1);
  const curr = new Uint16Array(m + 1);
  // Backtrack matrix would be n*m bytes — instead recompute via direction
  // table stored as a flat Uint8Array (0=up, 1=left, 2=diag).
  const dir = new Uint8Array(n * m);

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const idx = (i - 1) * m + (j - 1);
      if (lyricWords[i - 1] === transcriptWords[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        dir[idx] = 2;
      } else if (prev[j] >= curr[j - 1]) {
        curr[j] = prev[j];
        dir[idx] = 0;
      } else {
        curr[j] = curr[j - 1];
        dir[idx] = 1;
      }
    }
    prev.set(curr);
  }

  // Backtrack from (n, m).
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const d = dir[(i - 1) * m + (j - 1)];
    if (d === 2) {
      mapping[i - 1] = j - 1;
      i--;
      j--;
    } else if (d === 0) {
      i--;
    } else {
      j--;
    }
  }
  return mapping;
}

/**
 * Align lyric lines to Whisper word timestamps.
 *
 * Returns per-line timings plus per-word timings for karaoke. Unmatched
 * words inside a partially-matched line are interpolated between their
 * matched neighbors; fully-unmatched lines are spread across the gap
 * between neighboring matched lines (marked matched:false so the UI can
 * flag them for manual fine-tuning).
 */
export function alignLyricsToTranscript(
  lyricLines: string[],
  transcript: TranscriptWord[],
  durationSec: number | null = null,
): AlignmentResult {
  // Flatten lyric words, remembering line ownership.
  const flatWords: string[] = [];
  const wordLineIdx: number[] = [];
  const wordOriginal: string[] = [];
  lyricLines.forEach((line, li) => {
    for (const w of line.split(/\s+/).filter(Boolean)) {
      flatWords.push(normalizeWord(w));
      wordLineIdx.push(li);
      wordOriginal.push(w);
    }
  });

  const normTranscript = transcript.map((t) => normalizeWord(t.word));
  const mapping = lcsAlign(flatWords, normTranscript);

  const totalWords = flatWords.length;
  const matchedCount = mapping.filter((x) => x >= 0).length;
  const matchRate = totalWords === 0 ? 0 : matchedCount / totalWords;

  // Per-word timings: matched words take transcript times; unmatched words
  // interpolate between the nearest matched neighbors.
  const wordTimes: { start: number; end: number; matched: boolean }[] =
    new Array(totalWords);

  // First pass: matched words.
  for (let k = 0; k < totalWords; k++) {
    const ti = mapping[k]!;
    if (ti >= 0) {
      const t = transcript[ti]!;
      wordTimes[k] = { start: t.start, end: t.end, matched: true };
    }
  }

  // Second pass: interpolate unmatched runs between matched anchors.
  let k = 0;
  while (k < totalWords) {
    if (wordTimes[k]) {
      k++;
      continue;
    }
    // Find the run [k, runEnd) of unmatched words.
    let runEnd = k;
    while (runEnd < totalWords && !wordTimes[runEnd]) runEnd++;

    const prevT = k > 0 ? wordTimes[k - 1]! : null;
    const nextT = runEnd < totalWords ? wordTimes[runEnd]! : null;

    const runLen = runEnd - k;
    if (prevT && nextT) {
      const span = nextT.start - prevT.end;
      const per = span / runLen;
      for (let r = 0; r < runLen; r++) {
        const s = prevT.end + per * r;
        wordTimes[k + r] = {
          start: Math.max(0, s),
          end: s + Math.max(0.05, per * 0.9),
          matched: false,
        };
      }
    } else if (prevT) {
      // Trailing unmatched: extend forward at 0.35s/word.
      for (let r = 0; r < runLen; r++) {
        const s = prevT.end + 0.35 * r;
        wordTimes[k + r] = { start: s, end: s + 0.3, matched: false };
      }
    } else if (nextT) {
      // Leading unmatched: extend backward at 0.35s/word.
      for (let r = 0; r < runLen; r++) {
        const e = nextT.start - 0.35 * (runLen - 1 - r);
        wordTimes[k + r] = {
          start: Math.max(0, e - 0.3),
          end: Math.max(0.05, e),
          matched: false,
        };
      }
    } else {
      // Nothing matched at all — spread across the audio duration (or 60s fallback).
      const span = durationSec && durationSec > 0 ? durationSec : 60;
      const per = span / Math.max(1, totalWords);
      for (let r = 0; r < runLen; r++) {
        const s = per * (k + r);
        wordTimes[k + r] = { start: s, end: s + per * 0.9, matched: false };
      }
    }
    k = runEnd;
  }

  // Group into lines.
  const lines: AlignedLine[] = lyricLines.map((text) => ({
    text,
    startSec: 0,
    endSec: 0,
    words: [],
    matched: false,
  }));
  flatWords.forEach((_, k) => {
    const li = wordLineIdx[k]!;
    const wt = wordTimes[k]!;
    lines[li]!.words.push({
      word: wordOriginal[k]!,
      startSec: round2(wt.start),
      endSec: round2(wt.end),
      matched: wt.matched,
    });
  });
  for (const line of lines) {
    if (line.words.length === 0) continue;
    line.startSec = round2(Math.min(...line.words.map((w) => w.startSec)));
    line.endSec = round2(Math.max(...line.words.map((w) => w.endSec)));
    line.matched = line.words.some((w) => w.matched);
  }

  return { lines, matchRate: round2(matchRate), durationSec };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ── ASS karaoke subtitle generation: pure, testable ───────────────────── */

/** Format seconds as ASS timestamp H:MM:SS.cc */
export function assTimestamp(sec: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cc = Math.floor((s * 100) % 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(cc).padStart(2, "0")}`;
}

/**
 * Escape ASS special characters in dialogue text.
 */
export function escapeAss(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}");
}

/**
 * Build a complete ASS subtitle file with karaoke word-sweep tags.
 * Each word gets {\kf<centiseconds>} so the fill sweeps word by word.
 * Unmatched (interpolated) words still render — timing is approximate and
 * the UI tells the user to fine-tune.
 */
export function buildAssSubtitles(
  lines: AlignedLine[],
  style: LyricStyle,
  aspect: LyricAspect,
): string {
  const spec = STYLE_SPECS[style];
  const { w, h } = ASPECT_DIMS[aspect];
  const fontSize =
    aspect === "9:16" ? Math.round(spec.fontSize * 0.85) : spec.fontSize;

  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    "WrapStyle: 2",
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Karaoke,DejaVu Sans,${fontSize},${spec.primaryColor},${spec.secondaryColor},${spec.outlineColor},&H80000000,-1,0,0,0,100,100,0.5,0,1,2,1,5,60,60,${aspect === "9:16" ? 120 : 80},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const events = lines
    .filter((l) => l.words.length > 0)
    .map((line) => {
      const words = line.words
        .map((wd) => {
          const cs = Math.max(1, Math.round((wd.endSec - wd.startSec) * 100));
          return `{\\kf${cs}}${escapeAss(wd.word)}`;
        })
        .join(" ");
      // Small lead-in so the line is readable just before the sweep starts.
      const start = Math.max(0, line.startSec - 0.15);
      return `Dialogue: 0,${assTimestamp(start)},${assTimestamp(line.endSec)},Karaoke,,0,0,0,,${words}`;
    });

  return [...header, ...events].join("\n");
}

/* ── ffmpeg render args: pure, testable ────────────────────────────────── */

export interface RenderArgsOpts {
  workDir: string;
  audioPath: string;
  assPath: string;
  outputPath: string;
  style: LyricStyle;
  aspect: LyricAspect;
  durationSec: number;
}

/**
 * Build the ffmpeg command that renders the lyric video:
 * animated gradient background (lavfi) + burned-in karaoke ASS subtitles
 * + the original audio. Deterministic and fully testable.
 */
export function buildRenderArgs(opts: RenderArgsOpts): string[] {
  const { w, h } = ASPECT_DIMS[opts.aspect];
  const spec = STYLE_SPECS[opts.style];
  const [c0, c1, c2] = spec.bgColors;

  const bgSource =
    `gradients=size=${w}x${h}:nb_colors=3` +
    `:c0=${c0}:c1=${c1}:c2=${c2}` +
    `:speed=${spec.bgSpeed}:duration=${Math.ceil(opts.durationSec)}`;

  const vfParts = ["format=yuv420p"];
  if (spec.grain > 0) {
    vfParts.push(`noise=alls=${spec.grain}:allf=t`);
  }
  // Burn the karaoke subtitles. Quote the path for the ass filter.
  const assFilter = `ass='${opts.assPath.replace(/'/g, "'\\\\''")}'`;
  vfParts.push(assFilter);

  return [
    "-y",
    "-f", "lavfi", "-i", bgSource,
    "-i", opts.audioPath,
    "-filter_complex", `[0:v]${vfParts.join(",")}[v]`,
    "-map", "[v]",
    "-map", "1:a",
    "-t", String(opts.durationSec),
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-movflags", "+faststart",
    "-shortest",
    opts.outputPath,
  ];
}

/** ffprobe: read audio duration in seconds. */
export async function probeAudioDuration(inputPath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "csv=p=0",
        inputPath,
      ],
      { timeout: 30_000 },
    );
    const d = parseFloat(stdout.trim());
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch {
    return null;
  }
}

/* ── Background render jobs (in-memory; not tab-dependent) ─────────────── */

export type LyricRenderJobStatus = "queued" | "processing" | "done" | "failed";

export interface LyricRenderJob {
  id: string;
  userId: string;
  status: LyricRenderJobStatus;
  style: LyricStyle;
  aspect: LyricAspect;
  lineCount: number;
  outputUrl: string | null;
  outputRef: string | null;
  error: string | null;
  creditsCharged: number;
  createdAt: number;
}

const renderJobs = new Map<string, LyricRenderJob>();

export function getLyricRenderJob(id: string): LyricRenderJob | undefined {
  return renderJobs.get(id);
}

/** Test hook: clear the in-memory job store. */
export function __clearLyricRenderJobs(): void {
  renderJobs.clear();
}

export interface RenderJobInput {
  audioBuffer: Buffer;
  audioName: string;
  lines: AlignedLine[];
  style: LyricStyle;
  aspect: LyricAspect;
}

/** Exported for tests. Runs the full render pipeline for one job. */
export async function runLyricRenderJob(
  job: LyricRenderJob,
  input: RenderJobInput,
): Promise<void> {
  const workDir = await fs.mkdtemp(join(tmpdir(), "lyric-video-"));
  const audioExt =
    (input.audioName.split(".").pop() ?? "mp3")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "mp3";
  const audioPath = join(workDir, `audio.${audioExt}`);
  const assPath = join(workDir, "lyrics.ass");
  const outputPath = join(workDir, "lyric-video.mp4");

  const fail = async (message: string): Promise<void> => {
    job.status = "failed";
    job.error = message;
    try {
      await refundCredits(job.userId, job.creditsCharged, {
        action: "Lyric Video — Refund (render failed)",
      });
    } catch (refundErr) {
      void refundErr; // logged inside refundCredits
    }
  };

  try {
    job.status = "processing";
    await fs.writeFile(audioPath, input.audioBuffer);

    const durationSec = await probeAudioDuration(audioPath);
    if (!durationSec) {
      await fail("Could not read the audio duration — the file may be corrupt.");
      return;
    }

    await fs.writeFile(
      assPath,
      buildAssSubtitles(input.lines, input.style, input.aspect),
    );

    await execFileAsync(
      "ffmpeg",
      buildRenderArgs({
        workDir,
        audioPath,
        assPath,
        outputPath,
        style: input.style,
        aspect: input.aspect,
        durationSec,
      }),
      { timeout: 900_000 }, // 15 min cap for the encode
    );

    const outBuffer = await fs.readFile(outputPath);
    const objectName = `lyric-videos/${job.userId}/${Date.now()}-${job.id}.mp4`;
    const ref = await uploadMediaToSupabaseStorage(objectName, outBuffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(ref);

    job.status = "done";
    job.outputUrl = url;
    job.outputRef = ref;
  } catch (err) {
    await fail(err instanceof Error ? err.message : "Lyric video render failed");
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/* ── Audio sourcing ────────────────────────────────────────────────────── */

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AUDIO_MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype.startsWith("audio/") ||
      /\.(mp3|wav|m4a|ogg|flac)$/i.test(file.originalname);
    cb(null, ok);
  },
});

/** Download audio from a Supabase storage URL (first-party buckets only). */
async function downloadAudioFromUrl(audioUrl: string): Promise<Buffer> {
  const parsed = parseSupabaseStorageRefBucketed(audioUrl);
  if (parsed) {
    const { data, error } = await getSupabaseAdmin()
      .storage.from(parsed.bucket)
      .download(parsed.objectPath);
    if (!error && data) return Buffer.from(await data.arrayBuffer());
  }
  // Fall back to a plain fetch for signed URLs.
  const r = await fetch(audioUrl);
  if (!r.ok) throw new Error(`Could not download audio (${r.status})`);
  return Buffer.from(await r.arrayBuffer());
}

/** Download a song from the user's own song library. */
async function downloadSongAudio(userId: string, songId: string): Promise<{ buffer: Buffer; name: string }> {
  const rows = await db
    .select()
    .from(songsTable)
    .where(and(eq(songsTable.id, songId), eq(songsTable.user_id, userId)))
    .limit(1);
  const song = rows[0];
  if (!song) throw new Error("Song not found in your library.");
  const buffer = await downloadAudioFromUrl(song.audio_url);
  return { buffer, name: song.title ? `${song.title}.mp3` : "song.mp3" };
}

/* ── Whisper word-level transcription ──────────────────────────────────── */

interface WhisperVerboseJson {
  text?: string;
  duration?: number;
  words?: { word: string; start: number; end: number }[];
}

async function transcribeWithWordTimestamps(
  audioBuffer: Buffer,
  filename: string,
  mimetype: string,
): Promise<{ words: TranscriptWord[]; duration: number | null }> {
  const audioFile = await toFile(audioBuffer, filename, { type: mimetype });
  const result = (await getOpenAI().audio.transcriptions.create(
    {
      file: audioFile,
      model: "whisper-1",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
    },
    { signal: AbortSignal.timeout(WHISPER_TIMEOUT_MS) },
  )) as unknown as WhisperVerboseJson;

  const words: TranscriptWord[] = (result.words ?? [])
    .filter((w) => w.word && w.word.trim().length > 0)
    .map((w) => ({ word: w.word.trim(), start: w.start, end: w.end }));
  return { words, duration: result.duration ?? null };
}

function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === "TimeoutError" ||
    err.name === "AbortError" ||
    /timed out|timeout|aborted/i.test(err.message)
  );
}

/* ── Request schemas ───────────────────────────────────────────────────── */

const alignBodySchema = z.object({
  lyrics: z.string().min(1).max(20000),
  songId: z.string().min(1).max(200).optional(),
  audioUrl: z.string().url().max(2000).optional(),
});

const renderLineWordSchema = z.object({
  word: z.string().min(1).max(60),
  startSec: z.number().min(0).max(86400),
  endSec: z.number().min(0).max(86400),
  matched: z.boolean().optional().default(true),
});

const renderLineSchema = z.object({
  text: z.string().min(1).max(500),
  startSec: z.number().min(0).max(86400),
  endSec: z.number().min(0).max(86400),
  words: z.array(renderLineWordSchema).min(1).max(40),
  matched: z.boolean().optional().default(true),
});

const renderBodySchema = z.object({
  audioRef: z.string().min(1).max(2000),
  lines: z.array(renderLineSchema).min(1).max(500),
  style: z.enum(LYRIC_STYLES).default("gold-luxury"),
  aspect: z.enum(LYRIC_ASPECTS).default("16:9"),
});

/* ── Routes ────────────────────────────────────────────────────────────── */

/**
 * POST /api/lyric-video/align
 *
 * Body (multipart): `lyrics` (text) + one of: `audio` file, `songId`,
 * `audioUrl`. Charges 2 credits up front; refunds when Whisper hears no
 * speech, the lyrics don't match the audio, or the provider fails.
 */
router.post(
  "/api/lyric-video/align",
  requireAuth,
  publicApiLimiter,
  upload.single("audio"),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = alignBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: "INVALID_INPUT",
          message: "Paste your lyrics and provide an audio file, song, or audio URL.",
        });
        return;
      }
      const { lyrics, songId, audioUrl } = parsed.data;

      const lyricLines = lyrics
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (lyricLines.length === 0) {
        res.status(400).json({
          error: "EMPTY_LYRICS",
          message: "Paste your lyrics first — at least one line.",
        });
        return;
      }

      if (!req.file && !songId && !audioUrl) {
        res.status(400).json({
          error: "NO_AUDIO",
          message: "Upload an audio file or pick a song from your library.",
        });
        return;
      }

      const balance = req.userCredits ?? 0;
      if (balance < LYRIC_ALIGN_CREDIT_COST) {
        res.status(402).json({
          error: "out_of_credits",
          message: "You're out of credits — top up to align lyrics.",
        });
        return;
      }

      let creditsRemaining = balance;
      try {
        creditsRemaining = await chargeCredits(req.userId!, LYRIC_ALIGN_CREDIT_COST, {
          action: "Lyric Video — Lyric Alignment",
        });
      } catch (err) {
        if (err instanceof OutOfCreditsError) {
          res.status(402).json({
            error: "out_of_credits",
            message: "You're out of credits — top up to align lyrics.",
          });
          return;
        }
        if (err instanceof LedgerWriteError) {
          res.status(500).json({ error: "Could not record the credit charge. Please try again." });
          return;
        }
        throw err;
      }

      const doRefund = async (action: string) => {
        try {
          await refundCredits(req.userId!, LYRIC_ALIGN_CREDIT_COST, { action });
        } catch {
          /* logged inside refundCredits */
        }
      };

      // ── Source the audio ──
      let audioBuffer: Buffer;
      let audioName = "audio.mp3";
      let audioMime = "audio/mpeg";
      try {
        if (req.file) {
          audioBuffer = req.file.buffer;
          audioName = req.file.originalname || audioName;
          audioMime = req.file.mimetype || audioMime;
        } else if (songId) {
          const dl = await downloadSongAudio(req.userId!, songId);
          audioBuffer = dl.buffer;
          audioName = dl.name;
        } else {
          audioBuffer = await downloadAudioFromUrl(audioUrl!);
        }
      } catch (err) {
        await doRefund("Lyric Video — Refund (audio download failed)");
        res.status(400).json({
          error: "AUDIO_DOWNLOAD_FAILED",
          message:
            err instanceof Error ? err.message : "Could not load the audio.",
        });
        return;
      }

      if (audioBuffer.length > WHISPER_MAX_BYTES) {
        await doRefund("Lyric Video — Refund (audio too large)");
        res.status(400).json({
          error: "AUDIO_TOO_LARGE",
          message:
            "That audio file is over 24 MB — Whisper can't take it. Trim it down or use a lower-bitrate MP3 and try again.",
        });
        return;
      }

      // Persist the audio now so the render step can fetch it by ref.
      let audioRef: string;
      try {
        const objectName = `lyric-audio/${req.userId!}/${Date.now()}-${randomUUID()}.mp3`;
        audioRef = await uploadMediaToSupabaseStorage(objectName, audioBuffer, "audio/mpeg");
      } catch (err) {
        await doRefund("Lyric Video — Refund (audio storage failed)");
        logger.error({ err }, "[lyric-video] audio staging upload failed");
        res.status(500).json({ error: "Could not stage the audio. Please try again." });
        return;
      }

      // ── Transcribe with word timestamps ──
      let transcript: { words: TranscriptWord[]; duration: number | null };
      try {
        transcript = await transcribeWithWordTimestamps(audioBuffer, audioName, audioMime);
      } catch (err) {
        await doRefund("Lyric Video — Refund (transcription failed)");
        logger.error({ err }, "[lyric-video] whisper transcription failed");
        if (isTimeoutError(err)) {
          res.status(504).json({
            error: "TRANSCRIBE_TIMEOUT",
            message: "Transcription took too long. Try a shorter audio file.",
          });
          return;
        }
        res.status(500).json({ error: "Transcription failed. Please try again." });
        return;
      }

      if (transcript.words.length === 0) {
        await doRefund("Lyric Video — Refund (no speech detected)");
        res.status(422).json({
          error: "NO_SPEECH",
          message:
            "We couldn't hear any vocals in that audio — alignment needs a track with singing or rapping. An instrumental won't work here.",
        });
        return;
      }

      // ── Align ──
      const alignment = alignLyricsToTranscript(
        lyricLines,
        transcript.words,
        transcript.duration,
      );

      if (alignment.matchRate < MIN_MATCH_RATE) {
        await doRefund("Lyric Video — Refund (lyrics did not match audio)");
        res.status(422).json({
          error: "LOW_MATCH",
          message: `Only ${Math.round(alignment.matchRate * 100)}% of your lyric words matched what we heard in the audio. Double-check the lyrics belong to this song, then try again — you were not charged.`,
          matchRate: alignment.matchRate,
        });
        return;
      }

      res.json({
        audioRef,
        lines: alignment.lines,
        matchRate: alignment.matchRate,
        durationSec: alignment.durationSec,
        creditsCharged: LYRIC_ALIGN_CREDIT_COST,
        creditsRemaining,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/lyric-video/render
 *
 * Body (JSON): { audioRef, lines, style, aspect }. Charges 5 credits up
 * front; the background job refunds automatically if the render fails.
 */
router.post(
  "/api/lyric-video/render",
  requireAuth,
  publicApiLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = renderBodySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: "INVALID_INPUT",
          message: "Provide audioRef, timed lyric lines, style, and aspect ratio.",
        });
        return;
      }
      const { audioRef, lines, style, aspect } = parsed.data;

      // Sanity: line timings must be ordered and non-absurd.
      for (const line of lines) {
        if (line.endSec <= line.startSec) {
          res.status(400).json({
            error: "INVALID_TIMING",
            message: `The line "${line.text.slice(0, 40)}" ends before it starts — fix its timing and try again.`,
          });
          return;
        }
      }

      const balance = req.userCredits ?? 0;
      if (balance < LYRIC_RENDER_CREDIT_COST) {
        res.status(402).json({
          error: "out_of_credits",
          message: "You're out of credits — top up to render the lyric video.",
        });
        return;
      }

      let creditsRemaining = balance;
      try {
        creditsRemaining = await chargeCredits(req.userId!, LYRIC_RENDER_CREDIT_COST, {
          action: `Lyric Video — Render (${style}, ${aspect})`,
        });
      } catch (err) {
        if (err instanceof OutOfCreditsError) {
          res.status(402).json({
            error: "out_of_credits",
            message: "You're out of credits — top up to render the lyric video.",
          });
          return;
        }
        if (err instanceof LedgerWriteError) {
          res.status(500).json({ error: "Could not record the credit charge. Please try again." });
          return;
        }
        throw err;
      }

      // Fetch the staged audio now (fail fast before the job starts).
      let audioBuffer: Buffer;
      try {
        audioBuffer = await downloadAudioFromUrl(audioRef);
      } catch {
        try {
          await refundCredits(req.userId!, LYRIC_RENDER_CREDIT_COST, {
            action: "Lyric Video — Refund (staged audio missing)",
          });
        } catch {
          /* logged inside refundCredits */
        }
        res.status(400).json({
          error: "AUDIO_REF_EXPIRED",
          message: "The staged audio expired — re-run the lyric alignment step.",
        });
        return;
      }

      const job: LyricRenderJob = {
        id: randomUUID(),
        userId: req.userId!,
        status: "queued",
        style,
        aspect,
        lineCount: lines.length,
        outputUrl: null,
        outputRef: null,
        error: null,
        creditsCharged: LYRIC_RENDER_CREDIT_COST,
        createdAt: Date.now(),
      };
      renderJobs.set(job.id, job);

      // Server-owned: runs detached from the request/tab lifecycle.
      void runLyricRenderJob(job, {
        audioBuffer,
        audioName: "audio.mp3",
        lines: lines.map((l) => ({
          text: l.text,
          startSec: l.startSec,
          endSec: l.endSec,
          matched: l.matched ?? true,
          words: l.words.map((w) => ({
            word: w.word,
            startSec: w.startSec,
            endSec: w.endSec,
            matched: w.matched ?? true,
          })),
        })),
        style,
        aspect,
      });

      res.status(202).json({
        jobId: job.id,
        status: job.status,
        style,
        aspect,
        creditsCharged: LYRIC_RENDER_CREDIT_COST,
        creditsRemaining,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/lyric-video/render/:jobId
 *
 * Poll render status. Returns outputUrl when done.
 */
router.get(
  "/api/lyric-video/render/:jobId",
  requireAuth,
  async (req: Request, res: Response) => {
    const job = getLyricRenderJob(req.params.jobId as string);
    if (!job || job.userId !== req.userId) {
      res.status(404).json({ error: "Job not found." });
      return;
    }
    res.json({
      jobId: job.id,
      status: job.status,
      style: job.style,
      aspect: job.aspect,
      lineCount: job.lineCount,
      outputUrl: job.outputUrl,
      error: job.error,
    });
  },
);

/** GET /api/lyric-video/styles — preset metadata for the style picker UI. */
router.get("/api/lyric-video/styles", requireAuth, (_req: Request, res: Response) => {
  res.json({
    styles: LYRIC_STYLES.map((key) => ({
      key,
      label: STYLE_SPECS[key].label,
      blurb: STYLE_SPECS[key].blurb,
    })),
    aspects: LYRIC_ASPECTS,
    pricing: {
      alignCredits: LYRIC_ALIGN_CREDIT_COST,
      renderCredits: LYRIC_RENDER_CREDIT_COST,
    },
  });
});

export default router;
