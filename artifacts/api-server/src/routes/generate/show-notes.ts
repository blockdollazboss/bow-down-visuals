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

/* ─── Podcast show notes generator ───
   Takes an episode title + transcript (or audio URL, transcribed with
   whisper first) and generates formatted show notes: summary, key
   takeaways, timestamped highlights, quotable quotes, and resources
   mentioned. 100 Visual Bucs. */

const SHOW_NOTES_COST = Number(process.env["SHOW_NOTES_CREDITS"]) || 100;
const TRANSCRIBE_TIMEOUT_MS = 180_000;

const showNotesSchema = z.object({
  episodeTitle: z.string().trim().min(1).max(300),
  /** Full or partial transcript. Provide one of transcript or audioUrl. */
  transcript: z.string().trim().min(20).max(50000).optional(),
  /** Audio file URL — transcribed with whisper if transcript is absent. */
  audioUrl: z.string().trim().min(1).max(2048).optional(),
  /** Optional episode description/context for better notes. */
  context: z.string().trim().max(2000).optional().default(""),
}).refine((d) => d.transcript || d.audioUrl, {
  message: "Provide either transcript or audioUrl.",
});

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

async function transcribeAudioUrl(audioUrl: string): Promise<Array<{ start: number; text: string }>> {
  const workDir = await mkdtemp(join(tmpdir(), "show-notes-"));
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

interface ShowNotes {
  summary: string;
  keyTakeaways: string[];
  highlights: Array<{ time: string; title: string; detail: string }>;
  quotes: Array<{ quote: string; time: string }>;
  resources: string[];
}

async function generateNotes(
  episodeTitle: string,
  transcriptText: string,
  timedSegments: Array<{ start: number; text: string }> | null,
  context: string,
): Promise<ShowNotes> {
  // Trim transcript for prompt size; keep timestamps if we have them
  const trimmed = transcriptText.slice(0, 15000);
  const timed = timedSegments
    ? timedSegments.slice(0, 120).map((s) => `[${formatTime(s.start)}] ${s.text}`).join("\n").slice(0, 8000)
    : "";

  const prompt =
    `You are writing podcast show notes for the episode "${episodeTitle}".` +
    (context ? `\nEpisode context: ${context}` : "") +
    `\n\nTranscript${timed ? " (with timestamps)" : ""}:\n${timed || trimmed}` +
    `\n\nReturn ONLY JSON with this shape:\n` +
    `{"summary": "2-3 sentence episode summary",` +
    ` "keyTakeaways": ["5-8 bullet takeaways"],` +
    ` "highlights": [{"time": "M:SS", "title": "short segment title", "detail": "1-sentence description"}],` +
    ` "quotes": [{"quote": "memorable verbatim quote", "time": "M:SS"}],` +
    ` "resources": ["books, tools, links mentioned"]}\n` +
    `Keep highlights to 5-10 entries in chronological order, quotes to 3-5, resources as a flat list (empty array if none).`;

  const completion = await getOpenAI().chat.completions.create({
    model: getTextModel(),
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.5,
  }, { signal: AbortSignal.timeout(120_000) });

  const content = completion.choices?.[0]?.message?.content ?? "";
  const parsed = JSON.parse(content) as Partial<ShowNotes>;

  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    keyTakeaways: Array.isArray(parsed.keyTakeaways) ? parsed.keyTakeaways.filter((t) => typeof t === "string") : [],
    highlights: Array.isArray(parsed.highlights)
      ? parsed.highlights.filter((h) => h && typeof h.time === "string" && typeof h.title === "string")
          .map((h) => ({ time: h.time, title: h.title, detail: typeof h.detail === "string" ? h.detail : "" }))
      : [],
    quotes: Array.isArray(parsed.quotes)
      ? parsed.quotes.filter((q) => q && typeof q.quote === "string")
          .map((q) => ({ quote: q.quote, time: typeof q.time === "string" ? q.time : "" }))
      : [],
    resources: Array.isArray(parsed.resources) ? parsed.resources.filter((r) => typeof r === "string") : [],
  };
}

router.post("/show-notes", requireAuth, async (req, res) => {
  const parsed = showNotesSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < SHOW_NOTES_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, SHOW_NOTES_COST, {
      action: "Show Notes",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  try {
    const { episodeTitle, transcript, audioUrl, context } = parsed.data;

    let transcriptText = transcript ?? "";
    let timedSegments: Array<{ start: number; text: string }> | null = null;

    if (audioUrl) {
      req.log.info("[show-notes] transcribing audio");
      timedSegments = await transcribeAudioUrl(audioUrl);
      transcriptText = timedSegments.map((s) => s.text).join(" ");
      if (!transcriptText.trim()) throw new Error("No speech detected in the audio.");
    }

    req.log.info("[show-notes] generating notes");
    const notes = await generateNotes(episodeTitle, transcriptText, timedSegments, context);

    res.json({
      episodeTitle,
      notes,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Show notes generation failed.";
    req.log.error({ err: message }, "[show-notes] failed");
    await refundCredits(req.userId!, SHOW_NOTES_COST, {
      action: "Show Notes — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  }
});

export default router;
