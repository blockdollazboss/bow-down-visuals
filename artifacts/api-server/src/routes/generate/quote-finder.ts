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

/* ─── Podcast quotable moment finder ───
   Takes a transcript (or audio URL, transcribed with whisper first) and
   uses AI to find the 5 most quotable/shareable moments, each with a
   timestamp and suggested social captions for TikTok/X/Instagram.
   150 Visual Bucs. */

const QUOTE_FINDER_COST = Number(process.env["QUOTE_FINDER_CREDITS"]) || 150;
const TRANSCRIBE_TIMEOUT_MS = 180_000;

const quoteFinderSchema = z.object({
  /** Full or partial transcript. Provide one of transcript or audioUrl. */
  transcript: z.string().trim().min(20).max(50000).optional(),
  /** Audio file URL — transcribed with whisper if transcript is absent. */
  audioUrl: z.string().trim().min(1).max(2048).optional(),
  /** Optional topic/context to steer quote selection. */
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
  const workDir = await mkdtemp(join(tmpdir(), "quote-finder-"));
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

interface QuotableMoment {
  quote: string;
  time: string;
  whyShareable: string;
  captions: {
    tiktok: string;
    x: string;
    instagram: string;
  };
}

async function findQuotes(
  transcriptText: string,
  timedSegments: Array<{ start: number; text: string }> | null,
  context: string,
): Promise<QuotableMoment[]> {
  const trimmed = transcriptText.slice(0, 15000);
  const timed = timedSegments
    ? timedSegments.slice(0, 120).map((s) => `[${formatTime(s.start)}] ${s.text}`).join("\n").slice(0, 8000)
    : "";

  const prompt =
    `You are a viral social media clip strategist for podcasters.` +
    (context ? `\nPodcast context: ${context}` : "") +
    `\n\nTranscript${timed ? " (with timestamps)" : ""}:\n${timed || trimmed}` +
    `\n\nFind the 5 MOST quotable and shareable moments — lines that would stop a scroller mid-feed: ` +
    `surprising takes, mic-drop one-liners, emotional peaks, contrarian opinions, or laugh-out-loud lines. ` +
    `Prefer moments that stand alone without needing the full episode for context.` +
    `\n\nReturn ONLY JSON with this shape:\n` +
    `{"moments": [{"quote": "verbatim quote, 1-3 sentences max",` +
    ` "time": "M:SS timestamp of the moment",` +
    ` "whyShareable": "1 sentence on why this would go viral",` +
    ` "captions": {"tiktok": "hooky TikTok caption under 150 chars with hashtags",` +
    ` "x": "punchy X/Twitter caption under 240 chars",` +
    ` "instagram": "Instagram caption with hook line + 3-5 hashtags"}}]}` +
    `\nReturn exactly 5 moments in chronological order.`;

  const completion = await getOpenAI().chat.completions.create({
    model: getTextModel(),
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0.6,
  }, { signal: AbortSignal.timeout(120_000) });

  const content = completion.choices?.[0]?.message?.content ?? "";
  const parsed = JSON.parse(content) as Partial<{ moments: Partial<QuotableMoment>[] }>;

  if (!Array.isArray(parsed.moments)) return [];

  return parsed.moments
    .filter((m) => m && typeof m.quote === "string" && m.quote.trim().length > 0)
    .slice(0, 5)
    .map((m) => ({
      quote: m.quote!,
      time: typeof m.time === "string" ? m.time : "",
      whyShareable: typeof m.whyShareable === "string" ? m.whyShareable : "",
      captions: {
        tiktok: typeof m.captions?.tiktok === "string" ? m.captions.tiktok : "",
        x: typeof m.captions?.x === "string" ? m.captions.x : "",
        instagram: typeof m.captions?.instagram === "string" ? m.captions.instagram : "",
      },
    }));
}

router.post("/find-quotes", requireAuth, async (req, res) => {
  const parsed = quoteFinderSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < QUOTE_FINDER_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, QUOTE_FINDER_COST, {
      action: "Quotable Moments",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  try {
    const { transcript, audioUrl, context } = parsed.data;

    let transcriptText = transcript ?? "";
    let timedSegments: Array<{ start: number; text: string }> | null = null;

    if (audioUrl) {
      req.log.info("[quote-finder] transcribing audio");
      timedSegments = await transcribeAudioUrl(audioUrl);
      transcriptText = timedSegments.map((s) => s.text).join(" ");
      if (!transcriptText.trim()) throw new Error("No speech detected in the audio.");
    }

    req.log.info("[quote-finder] finding quotable moments");
    const moments = await findQuotes(transcriptText, timedSegments, context);

    res.json({
      moments,
      count: moments.length,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Quote finding failed.";
    req.log.error({ err: message }, "[quote-finder] failed");
    await refundCredits(req.userId!, QUOTE_FINDER_COST, {
      action: "Quotable Moments — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  }
});

export default router;
