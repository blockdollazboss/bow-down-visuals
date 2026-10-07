import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink, mkdtemp, stat } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { toFile } from "openai/uploads";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── Video chapter markers ───
   Finds natural breaks in a video with ffmpeg silencedetect, transcribes
   the audio with whisper, and asks AI to write a short title per chapter.
   Returns [{ startTime, title }]. 150 Visual Bucs. */

const CHAPTERS_COST = Number(process.env["CHAPTERS_CREDITS"]) || 150;
const WHISPER_MAX_BYTES = 24 * 1024 * 1024;
const TRANSCRIBE_TIMEOUT_MS = 180_000;

const chaptersSchema = z.object({
  videoUrl: z.string().trim().min(1).max(2048),
  /** Silence threshold in dB (e.g., -30). Lower = more breaks detected. */
  silenceThresholdDb: z.number().min(-60).max(-10).optional().default(-30),
  /** Silence length in seconds needed to count as a chapter break. */
  minSilenceSec: z.number().min(0.5).max(10).optional().default(1.5),
  /** Hard cap on chapters returned. Strongest breaks win. */
  maxChapters: z.number().int().min(2).max(20).optional().default(10),
  /** Merge any chapter shorter than this into the previous one. */
  minChapterSec: z.number().min(10).max(120).optional().default(30),
});

interface Silence {
  start: number;
  end: number;
  duration: number;
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

async function probeDurationSec(videoPath: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    videoPath,
  ], { timeout: 30_000 });
  const d = parseFloat(stdout.trim());
  return Number.isFinite(d) ? d : 0;
}

async function detectSilences(videoPath: string, thresholdDb: number, minDur: number): Promise<Silence[]> {
  const { stderr } = await execFileAsync("ffmpeg", [
    "-hide_banner", "-nostats",
    "-i", videoPath,
    "-af", `silencedetect=noise=${thresholdDb}dB:d=${minDur}`,
    "-vn", "-f", "null", "-",
  ], { timeout: 300_000 });

  const silences: Silence[] = [];
  let pendingStart: number | null = null;
  for (const line of stderr.split("\n")) {
    const startMatch = /silence_start:\s*([\d.]+)/.exec(line);
    if (startMatch) {
      pendingStart = parseFloat(startMatch[1]!);
      continue;
    }
    const endMatch = /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/.exec(line);
    if (endMatch && pendingStart !== null) {
      silences.push({
        start: pendingStart,
        end: parseFloat(endMatch[1]!),
        duration: parseFloat(endMatch[2]!),
      });
      pendingStart = null;
    }
  }
  return silences;
}

/** Pick chapter start times from silences: keep breaks that leave each
 *  chapter at least minChapterSec long, then cap to the strongest ones. */
function pickChapterStarts(
  silences: Silence[],
  durationSec: number,
  maxChapters: number,
  minChapterSec: number,
): number[] {
  // Candidate breaks: chapter resumes when the silence ends.
  const candidates = silences
    .map((s) => ({ at: s.end, strength: s.duration }))
    .filter((c) => c.at > minChapterSec && c.at < durationSec - minChapterSec)
    .sort((a, b) => a.at - b.at);

  // Greedily keep breaks that leave room for a full chapter.
  const kept: typeof candidates = [];
  for (const c of candidates) {
    const prev = kept.length > 0 ? kept[kept.length - 1]!.at : 0;
    if (c.at - prev >= minChapterSec) kept.push(c);
  }

  // If too many, keep the strongest breaks (longest silences) in time order.
  let final = kept;
  if (kept.length > maxChapters - 1) {
    final = [...kept]
      .sort((a, b) => b.strength - a.strength)
      .slice(0, maxChapters - 1)
      .sort((a, b) => a.at - b.at);
  }

  return [0, ...final.map((c) => Math.round(c.at * 10) / 10)];
}

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

async function transcribeAudio(audioPath: string): Promise<TranscriptSegment[]> {
  const file = await toFile(await readFile(audioPath), "audio.mp3", { type: "audio/mpeg" });
  const out = await getOpenAI().audio.transcriptions.create(
    { file, model: "whisper-1", response_format: "verbose_json", timestamp_granularities: ["segment"] },
    { signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS) },
  );
  const segs = ((out as unknown as { segments?: Array<{ start: number; end: number; text: string }> }).segments ?? [])
    .map((s) => ({ start: s.start, end: s.end, text: (s.text ?? "").trim() }))
    .filter((s) => s.text.length > 0);
  return segs;
}

async function titleChapters(
  starts: number[],
  segments: TranscriptSegment[],
  durationSec: number,
): Promise<string[]> {
  const excerptFor = (i: number): string => {
    const start = starts[i]!;
    const end = i + 1 < starts.length ? starts[i + 1]! : durationSec;
    const text = segments
      .filter((s) => s.start >= start - 2 && s.start < end)
      .map((s) => s.text)
      .join(" ");
    return text.slice(0, 600);
  };

  const chapters = starts.map((start, i) => ({
    n: i + 1,
    at: formatTime(start),
    transcript: excerptFor(i) || "(no speech detected in this chapter)",
  }));

  const prompt =
    "You are titling chapters of a video. For each chapter below, write a short " +
    "title (max 6 words) based on its transcript and position in the video. " +
    'Return ONLY JSON: {"titles": ["...", "..."]}.\n\n' +
    chapters.map((c) => `${c.n}. Starts at ${c.at} — transcript: "${c.transcript}"`).join("\n");

  const completion = await getOpenAI().chat.completions.create({
    model: getTextModel(),
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.5,
  }, { signal: AbortSignal.timeout(120_000) });

  const content = completion.choices?.[0]?.message?.content ?? "";
  try {
    const parsed = JSON.parse(content) as { titles?: string[] };
    if (Array.isArray(parsed.titles) && parsed.titles.length === starts.length) {
      return parsed.titles.map((t, i) => (t && t.trim() ? t.trim() : `Chapter ${i + 1}`));
    }
  } catch {
    // fall through to generic titles
  }
  return starts.map((_, i) => `Chapter ${i + 1}`);
}

router.post("/chapters", requireAuth, async (req, res) => {
  const parsed = chaptersSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < CHAPTERS_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, CHAPTERS_COST, {
      action: "Video Chapters",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "chapters-"));
  const inputPath = join(workDir, "input");

  try {
    const vidRes = await fetch(parsed.data.videoUrl, { signal: AbortSignal.timeout(120_000) });
    if (!vidRes.ok) throw new Error("Could not download the video.");
    await writeFile(inputPath, Buffer.from(await vidRes.arrayBuffer()));

    const durationSec = await probeDurationSec(inputPath);
    if (!durationSec || durationSec < 30) {
      throw new Error("Video is too short for chapter markers (minimum 30 seconds).");
    }

    req.log.info("[chapters] detecting silences");
    const silences = await detectSilences(inputPath, parsed.data.silenceThresholdDb, parsed.data.minSilenceSec);
    const starts = pickChapterStarts(silences, durationSec, parsed.data.maxChapters, parsed.data.minChapterSec);
    req.log.info({ silences: silences.length, chapters: starts.length }, "[chapters] breaks found");

    // Extract mono 16k audio for transcription.
    const audioPath = join(workDir, "audio.mp3");
    await execFileAsync("ffmpeg", [
      "-v", "error",
      "-i", inputPath,
      "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k",
      "-y", audioPath,
    ], { timeout: 300_000 });

    let segments: TranscriptSegment[] = [];
    const audioStat = await stat(audioPath).catch(() => null);
    if (audioStat && audioStat.size <= WHISPER_MAX_BYTES) {
      req.log.info("[chapters] transcribing audio");
      segments = await transcribeAudio(audioPath).catch((err) => {
        req.log.warn({ err: String(err) }, "[chapters] transcription failed, using generic titles");
        return [];
      });
    } else {
      req.log.warn("[chapters] audio too large for transcription, using generic titles");
    }

    const titles = await titleChapters(starts, segments, durationSec);

    res.json({
      chapters: starts.map((startTime, i) => ({
        startTime,
        title: titles[i] ?? `Chapter ${i + 1}`,
      })),
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Chapter detection failed.";
    req.log.error({ err: message }, "[chapters] failed");
    await refundCredits(req.userId!, CHAPTERS_COST, {
      action: "Video Chapters — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    await unlink(inputPath).catch(() => {});
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
