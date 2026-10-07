import { Router } from "express";
import { z } from "zod";
import { writeFile, unlink, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { toFile } from "openai/uploads";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";

const router = Router();

/* ─── Auto Chapters from transcript ───
   Takes a transcript (or an audio URL, transcribed with whisper first) and
   uses the text model to detect topic shifts, returning timestamped chapter
   markers: [{ title, startSec, endSec }]. 150 Visual Bucs. */

const AUTO_CHAPTERS_COST = Number(process.env["AUTO_CHAPTERS_CREDITS"]) || 150;
const TRANSCRIBE_TIMEOUT_MS = 180_000;

const autoChaptersSchema = z.object({
  /** Full or partial transcript. Provide one of transcript or audioUrl. */
  transcript: z.string().trim().min(20).max(100000).optional(),
  /** Audio file URL — transcribed with whisper if transcript is absent. */
  audioUrl: z.string().trim().min(1).max(2048).optional(),
  /** Hard cap on chapters returned. */
  maxChapters: z.number().int().min(2).max(20).optional().default(10),
  /** Total video duration in seconds. Required when the transcript has no
   *  timestamps (chapter times are scaled from topic-shift positions). */
  totalDurationSec: z.number().min(1).max(8 * 3600).optional(),
  /** Optional video title for better chapter titles. */
  videoTitle: z.string().trim().max(300).optional().default(""),
}).refine((d) => d.transcript || d.audioUrl, {
  message: "Provide either transcript or audioUrl.",
});

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

interface TimedLine {
  start: number;
  text: string;
}

async function transcribeAudioUrl(audioUrl: string): Promise<TimedLine[]> {
  const workDir = await mkdtemp(join(tmpdir(), "auto-chapters-"));
  const audioPath = join(workDir, "audio.mp3");
  try {
    const res = await fetch(audioUrl, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error("Could not download the audio.");
    await writeFile(audioPath, Buffer.from(await res.arrayBuffer()));

    const { readFile } = await import("fs/promises");
    const file = await toFile(await readFile(audioPath), "audio.mp3", { type: "audio/mpeg" });
    const out = await getOpenAI().audio.transcriptions.create(
      { file, model: "whisper-1", response_format: "verbose_json", timestamp_granularities: ["segment"] },
      { signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS) },
    );
    const segs = ((out as unknown as { segments?: Array<{ start: number; text: string }> }).segments ?? [])
      .map((s) => ({ start: s.start, text: (s.text ?? "").trim() }))
      .filter((s) => s.text.length > 0);
    return segs;
  } finally {
    await unlink(audioPath).catch(() => {});
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Extract [M:SS] / [H:MM:SS] (or bare M:SS) leading timestamps from transcript lines. */
function parseTimestampedLines(transcript: string): TimedLine[] {
  const out: TimedLine[] = [];
  for (const rawLine of transcript.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = /^\[?(\d{1,2}):(\d{2})(?::(\d{2}))?\]?\s+(.*)$/.exec(line);
    if (!m) {
      out.push({ start: -1, text: line });
      continue;
    }
    const h = m[3] !== undefined ? Number(m[1]) : 0;
    const min = m[3] !== undefined ? Number(m[2]) : Number(m[1]);
    const sec = Number(m[3] !== undefined ? m[3] : m[2]);
    const start = h * 3600 + min * 60 + sec;
    out.push({ start, text: (m[4] ?? "").trim() });
  }
  return out;
}

interface Chapter {
  title: string;
  startSec: number;
  endSec: number;
}

function sanitizeTimedChapters(
  raw: Array<{ title?: unknown; startSec?: unknown }>,
  maxChapters: number,
  fallbackEnd: number,
): Chapter[] {
  const seen = new Set<number>();
  const cleaned: Array<{ title: string; startSec: number }> = [];
  for (const c of raw) {
    const startSec = typeof c.startSec === "number" && Number.isFinite(c.startSec) ? Math.max(0, Math.round(c.startSec)) : null;
    if (startSec === null || seen.has(startSec)) continue;
    seen.add(startSec);
    const title = typeof c.title === "string" && c.title.trim()
      ? c.title.trim().slice(0, 80)
      : `Chapter ${cleaned.length + 1}`;
    cleaned.push({ title, startSec });
  }
  cleaned.sort((a, b) => a.startSec - b.startSec);
  const limited = cleaned.slice(0, Math.max(2, maxChapters));
  if (limited.length === 0 || limited[0]!.startSec !== 0) {
    limited.unshift({ title: "Intro", startSec: 0 });
  }
  return limited.slice(0, Math.max(2, maxChapters)).map((c, i, arr) => ({
    title: c.title,
    startSec: c.startSec,
    endSec: i + 1 < arr.length ? arr[i + 1]!.startSec : Math.max(fallbackEnd, c.startSec + 1),
  }));
}

async function detectTimedChapters(
  lines: TimedLine[],
  maxChapters: number,
  videoTitle: string,
  fallbackEnd: number,
): Promise<Chapter[]> {
  const timed = lines
    .filter((l) => l.start >= 0 && l.text.length > 0)
    .slice(0, 400)
    .map((l) => `[${formatTime(l.start)}] ${l.text}`)
    .join("\n")
    .slice(0, 16000);

  const prompt =
    `You are detecting topic shifts in a video transcript to create chapter markers.` +
    (videoTitle ? `\nVideo title: "${videoTitle}"` : "") +
    `\n\nTranscript (each line is prefixed with its [M:SS] timestamp):\n${timed}` +
    `\n\nReturn ONLY JSON: {"chapters": [{"title": "short title, max 6 words", "startSec": 12}]}` +
    `\nRules:` +
    `\n- startSec must be one of the timestamps from the transcript (the moment the new topic begins), expressed in seconds.` +
    `\n- Chapters in chronological order, no duplicates, no overlaps.` +
    `\n- The first chapter must start at 0.` +
    `\n- At most ${maxChapters} chapters, at least 2.` +
    `\n- Titles must describe the topic discussed — never generic like "Chapter 1".`;

  const completion = await getOpenAI().chat.completions.create({
    model: getTextModel(),
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.4,
  }, { signal: AbortSignal.timeout(120_000) });

  const content = completion.choices?.[0]?.message?.content ?? "";
  const parsed = JSON.parse(content) as { chapters?: Array<{ title?: unknown; startSec?: unknown }> };
  if (!Array.isArray(parsed.chapters) || parsed.chapters.length === 0) {
    throw new Error("The AI could not detect any topic shifts in this transcript.");
  }
  return sanitizeTimedChapters(parsed.chapters, maxChapters, fallbackEnd);
}

async function detectUntimedChapters(
  transcript: string,
  maxChapters: number,
  videoTitle: string,
  totalDurationSec: number,
): Promise<Chapter[]> {
  const trimmed = transcript.slice(0, 20000);

  const prompt =
    `You are detecting topic shifts in a video transcript to create chapter markers.` +
    (videoTitle ? `\nVideo title: "${videoTitle}"` : "") +
    `\n\nFor each distinct topic, return its title AND the verbatim opening phrase (6-12 words copied EXACTLY from the transcript) where that topic begins.` +
    `\n\nTranscript:\n${trimmed}` +
    `\n\nReturn ONLY JSON: {"chapters": [{"title": "short title, max 6 words", "anchor": "verbatim opening phrase"}]}` +
    `\nRules:` +
    `\n- Chapters in the order the topics appear in the transcript.` +
    `\n- The first chapter's anchor must be the very beginning of the transcript.` +
    `\n- Anchors must be copied EXACTLY from the transcript text.` +
    `\n- At most ${maxChapters} chapters, at least 2.` +
    `\n- Titles must describe the topic discussed — never generic like "Chapter 1".`;

  const completion = await getOpenAI().chat.completions.create({
    model: getTextModel(),
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.4,
  }, { signal: AbortSignal.timeout(120_000) });

  const content = completion.choices?.[0]?.message?.content ?? "";
  const parsed = JSON.parse(content) as { chapters?: Array<{ title?: unknown; anchor?: unknown }> };
  if (!Array.isArray(parsed.chapters) || parsed.chapters.length === 0) {
    throw new Error("The AI could not detect any topic shifts in this transcript.");
  }

  /* Map each verbatim anchor back onto the transcript to get a proportional position. */
  const lower = transcript.toLowerCase();
  const totalChars = transcript.length;
  const starts: Array<{ title: string; startSec: number }> = [];
  let cursor = 0;
  for (const c of parsed.chapters.slice(0, maxChapters)) {
    const anchor = typeof c.anchor === "string" && c.anchor.trim() ? c.anchor.trim().toLowerCase() : "";
    let idx = anchor ? lower.indexOf(anchor, cursor) : -1;
    if (idx === -1 && anchor) {
      // Retry with just the first few words in case of trailing-word mismatch.
      const short = anchor.split(/\s+/).slice(0, 4).join(" ");
      idx = short ? lower.indexOf(short, cursor) : -1;
    }
    if (idx === -1) {
      throw new Error("Could not align the generated chapters to the transcript — please paste a transcript with [M:SS] timestamps or use an audio URL instead.");
    }
    cursor = idx + Math.max(1, anchor.length);
    const title = typeof c.title === "string" && c.title.trim()
      ? c.title.trim().slice(0, 80)
      : `Chapter ${starts.length + 1}`;
    starts.push({ title, startSec: Math.round((idx / totalChars) * totalDurationSec) });
  }

  starts.sort((a, b) => a.startSec - b.startSec);
  // Dedupe identical positions (keep the first).
  const deduped = starts.filter((c, i) => i === 0 || c.startSec > starts[i - 1]!.startSec);
  if (deduped[0] && deduped[0].startSec !== 0) {
    deduped.unshift({ title: "Intro", startSec: 0 });
  }
  return deduped.slice(0, Math.max(2, maxChapters)).map((c, i, arr) => ({
    title: c.title,
    startSec: c.startSec,
    endSec: i + 1 < arr.length ? arr[i + 1]!.startSec : totalDurationSec,
  }));
}

router.post("/auto-chapters", requireAuth, async (req, res) => {
  const parsed = autoChaptersSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < AUTO_CHAPTERS_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, AUTO_CHAPTERS_COST, {
      action: "Auto Chapters",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  try {
    const { transcript, audioUrl, maxChapters, totalDurationSec, videoTitle } = parsed.data;

    let chapters: Chapter[];

    if (audioUrl) {
      req.log.info("[auto-chapters] transcribing audio");
      const segments = await transcribeAudioUrl(audioUrl);
      const fullText = segments.map((s) => s.text).join(" ");
      if (!fullText.trim()) throw new Error("No speech detected in the audio.");
      const lastEnd = segments.length > 0 ? Math.ceil(segments[segments.length - 1]!.start + 30) : 0;
      req.log.info("[auto-chapters] detecting topic shifts");
      chapters = await detectTimedChapters(segments, maxChapters, videoTitle, totalDurationSec ?? lastEnd);
    } else {
      const lines = parseTimestampedLines(transcript!);
      const timedCount = lines.filter((l) => l.start >= 0).length;
      if (timedCount >= 2) {
        req.log.info("[auto-chapters] detecting topic shifts from timestamped transcript");
        const lastTimed = [...lines].reverse().find((l) => l.start >= 0);
        chapters = await detectTimedChapters(lines, maxChapters, videoTitle, totalDurationSec ?? (lastTimed ? lastTimed.start + 60 : 60));
      } else {
        if (!totalDurationSec) {
          throw new Error(
            "This transcript has no timestamps — provide totalDurationSec (the video length in seconds), paste a transcript with [M:SS] timestamps, or use audioUrl instead."
          );
        }
        req.log.info("[auto-chapters] detecting topic shifts from untimed transcript");
        chapters = await detectUntimedChapters(transcript!, maxChapters, videoTitle, totalDurationSec);
      }
    }

    res.json({
      chapters,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auto chapter generation failed.";
    req.log.error({ err: message }, "[auto-chapters] failed");
    await refundCredits(req.userId!, AUTO_CHAPTERS_COST, {
      action: "Auto Chapters — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  }
});

export default router;
