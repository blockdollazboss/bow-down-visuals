import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, writeFile, mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { toFile } from "openai/uploads";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { getOpenAI } from "../../lib/ai-clients";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── AI auto-captions ───
   Transcribes a video's audio with Whisper (word-level timestamps), then
   burns true word-timed karaoke captions into the video with ffmpeg/libass.
   Unlike SRT-based captioning, word timings make the highlight genuinely
   syllable-synced (TikTok style). 300 Visual Bucs. */

const AUTO_CAPTIONS_COST = Number(process.env["AUTO_CAPTIONS_CREDITS"]) || 300;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const TRANSCRIBE_TIMEOUT_MS = 300_000;
const MAX_WORDS_PER_LINE = 8;
const MAX_CHARS_PER_LINE = 42;
const PAUSE_SPLIT_SEC = 0.6;

const autoCaptionsSchema = z.object({
  videoUrl: z.string().url("videoUrl must be a valid URL."),
  /** Caption font size in px (16-48). */
  fontSize: z.number().int().min(16).max(48).optional().default(28),
  /** Highlight color for the currently-spoken word. */
  highlightColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "highlightColor must be #RRGGBB.")
    .optional()
    .default("#FFD700"),
  /** When true, the response also includes the word-timed caption lines
   *  (for editable transcripts in the Caption Suite). */
  includeWords: z.boolean().optional().default(false),
});

router.get("/auto-captions/info", requireAuth, (_req, res) => {
  res.json({
    cost: AUTO_CAPTIONS_COST,
    /* Lets the Caption Suite show an honest "unavailable" state instead of a
       dead generate button when no transcription key is configured. */
    ready: Boolean(process.env["OPENAI_API_KEY"]),
    description:
      "Transcribes video audio with Whisper and burns true word-timed karaoke captions into the video.",
    output: "MP4 with burned-in captions, signed download URL.",
  });
});

async function downloadTo(url: string, destPath: string, capBytes: number): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download video (HTTP ${res.status}).`);
  }
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > capBytes) {
      throw new Error("Video is larger than the 100 MB limit.");
    }
    chunks.push(Buffer.from(value));
  }
  await writeFile(destPath, Buffer.concat(chunks));
}

/** Escape the subtitle file path for the ffmpeg subtitles filter. */
function escapeSubPath(p: string): string {
  return p
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

/** Seconds → ASS H:MM:SS.CC */
function secToAss(sec: number): string {
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

/** Convert #RRGGBB → ASS &H00BBGGRR */
function hexToAssColor(hex: string): string {
  const h = hex.replace("#", "").padStart(6, "0");
  return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase();
}

interface WhisperWord {
  word: string;
  start: number;
  end: number;
}

interface CaptionLine {
  start: number;
  end: number;
  words: WhisperWord[];
}

/** Group words into caption lines, splitting on long pauses and length caps. */
function groupWordsIntoLines(words: WhisperWord[]): CaptionLine[] {
  const lines: CaptionLine[] = [];
  let cur: WhisperWord[] = [];
  let curChars = 0;

  const flush = () => {
    if (cur.length > 0) {
      lines.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur });
      cur = [];
      curChars = 0;
    }
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    // Split on a natural pause before this word.
    if (cur.length > 0 && w.start - cur[cur.length - 1].end >= PAUSE_SPLIT_SEC) flush();
    cur.push(w);
    curChars += w.word.length + 1;
    if (cur.length >= MAX_WORDS_PER_LINE || curChars >= MAX_CHARS_PER_LINE) flush();
  }
  flush();
  return lines;
}

/** Escape ASS special characters in caption text. */
function escapeAssText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/{/g, "\\{").replace(/}/g, "\\}");
}

/**
 * Build an ASS file with true word-timed karaoke ({\kf} tags).
 * The full line renders in white underneath while the spoken word
 * highlights in the accent color, TikTok-style.
 */
function buildKaraokeAss(lines: CaptionLine[], highlightAss: string, fontSize: number): string {
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,${fontSize},&H00FFFFFF,${highlightAss},&H00000000,&H99000000,-1,0,0,0,100,100,0,0,1,3,1,2,40,40,120,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const events = lines.map((line) => {
    const parts = line.words
      .map((w) => {
        const durCs = Math.max(1, Math.round((w.end - w.start) * 100));
        return `{\\kf${durCs}}${escapeAssText(w.word)}`;
      })
      .join(" ");
    return `Dialogue: 0,${secToAss(line.start)},${secToAss(line.end)},Default,,0,0,0,,${parts}`;
  });
  return header + events.join("\n") + "\n";
}

router.post("/auto-captions", requireAuth, async (req, res) => {
  const parsed = autoCaptionsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const { videoUrl, fontSize, highlightColor, includeWords } = parsed.data;

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < AUTO_CAPTIONS_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, AUTO_CAPTIONS_COST, {
      action: "AI Auto-Captions",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "auto-captions-"));
  const inputPath = join(workDir, "input.mp4");
  const audioPath = join(workDir, "audio.mp3");
  const assPath = join(workDir, "captions.ass");
  const outputPath = join(workDir, "captioned.mp4");

  const refund = () =>
    refundCredits(req.userId!, AUTO_CAPTIONS_COST, { action: "AI Auto-Captions — Refund" }).catch(
      () => {},
    );

  try {
    // 1. Download the video.
    await downloadTo(videoUrl, inputPath, MAX_VIDEO_BYTES);

    // 2. Extract audio for Whisper.
    await execFileAsync(
      "ffmpeg",
      ["-y", "-i", inputPath, "-vn", "-c:a", "libmp3lame", "-ar", "16000", "-ac", "1", audioPath],
      { timeout: 120_000 },
    );

    // 3. Transcribe with word-level timestamps.
    const file = await toFile(await readFile(audioPath), "audio.mp3", { type: "audio/mpeg" });
    const out = await getOpenAI().audio.transcriptions.create(
      {
        file,
        model: "whisper-1",
        response_format: "verbose_json",
        timestamp_granularities: ["word"],
      },
      { signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS) },
    );
    const words = (
      (out as unknown as { words?: Array<{ word: string; start: number; end: number }> }).words ??
      []
    )
      .map((w) => ({ word: (w.word ?? "").trim(), start: w.start, end: w.end }))
      .filter((w) => w.word.length > 0 && w.end > w.start);

    if (words.length === 0) {
      throw new Error("No speech detected in the video audio.");
    }

    // 4. Build the word-timed karaoke ASS file.
    const lines = groupWordsIntoLines(words);
    const ass = buildKaraokeAss(lines, hexToAssColor(highlightColor), fontSize);
    await writeFile(assPath, ass, "utf8");

    // 5. Burn captions into the video.
    const vf = `ass='${escapeSubPath(assPath)}'`;
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-i",
        inputPath,
        "-vf",
        vf,
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        outputPath,
      ],
      { timeout: 600_000 },
    );

    // 6. Upload and return.
    const buffer = await readFile(outputPath);
    const objectName = `auto-captions/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      wordCount: words.length,
      lineCount: lines.length,
      creditsRemaining: creditsAfter,
      ...(includeWords
        ? {
            lines: lines.map((l) => ({
              start: l.start,
              end: l.end,
              text: l.words.map((w) => w.word).join(" "),
              words: l.words,
            })),
          }
        : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auto-captioning failed.";
    req.log.error({ err: message }, "[auto-captions] failed");
    await refund();
    const status = message.includes("No speech detected") ? 422 : 500;
    res.status(status).json({ error: message });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
