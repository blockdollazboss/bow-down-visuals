import { Router } from "express";
import { z } from "zod";
import { writeFile, unlink, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { transcribeAudioTimed } from "../../lib/transcription";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits,
  refundCreditsGuaranteed, OutOfCreditsError, buildChargeIdempotencyKey, voidChargeIdempotencyKey } from "../../lib/credits";
import {
  findStoredGenerationResult,
  storeGenerationResult,
} from "../../lib/generation-stored-results";

/* CA-5: replay note served with a stored result (C-36 honesty). */
const REPLAY_NOTE = "These are the show notes you already made for this episode — change the title or transcript for a fresh set.";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";

const router = Router();

/* ─── Podcast show notes generator ───
   Takes an episode title + transcript (or audio URL, transcribed with
   transcribed first) and generates formatted show notes: summary, key
   takeaways, timestamped highlights, quotable quotes, and resources
   mentioned. 100 Visual Bucs. */

const SHOW_NOTES_COST = Number(process.env["SHOW_NOTES_CREDITS"]) || 100;
const TRANSCRIBE_TIMEOUT_MS = 180_000;

const showNotesSchema = z.object({
  episodeTitle: z.string().trim().min(1).max(300),
  /** Full or partial transcript. Provide one of transcript or audioUrl. */
  transcript: z.string().trim().min(20).max(50000).optional(),
  /** Audio file URL — transcribed if transcript is absent. */
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
    const out = await transcribeAudioTimed({
      buffer: await readFile(audioPath),
      filename: "audio.mp3",
      mimeType: "audio/mpeg",
      signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS),
    });
    const segs = (out.segments ?? [])
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

  /* CA-5 (house stored-result pattern): server-derived key from the
     episode intent (transcript rides verbatim; the audio path keys on
     the URL); stored-result pre-check BEFORE funding — a replay is
     served from the durable table (migration 0333), never re-charged,
     never re-transcribed or re-written. Fail-open. */
  const idempotencyKey = buildChargeIdempotencyKey("show-notes", req.userId!, null, {
    episodeTitle: parsed.data.episodeTitle,
    transcript: parsed.data.transcript ?? null,
    audioUrl: parsed.data.audioUrl ?? null,
    context: parsed.data.context,
  });
  const durable = await findStoredGenerationResult("show-notes", idempotencyKey, req.userId!);
  if (durable && typeof durable["notes"] === "object" && durable["notes"] !== null) {
    res.json({ ...durable, replayed: true, replayNote: REPLAY_NOTE });
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
    }, { idempotencyKey });
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

    const body = {
      episodeTitle,
      notes,
      creditsRemaining: creditsAfter,
    };
    /* Persist BEFORE answering (fail-open inside the helper). */
    await storeGenerationResult("show-notes", idempotencyKey, req.userId!, { ...body });
    res.json(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Show notes generation failed.";
    req.log.error({ err: message }, "[show-notes] failed");
    /* CA-5: a landed refund also VOIDS the charge key. */
    const refunded = await refundCreditsGuaranteed(req.userId!, SHOW_NOTES_COST, {
      action: "Show Notes — Refund",
    });
    if (refunded) {
      await voidChargeIdempotencyKey(idempotencyKey).catch(() => false);
    }
    res.status(500).json({ error: message });
  }
});

export default router;
