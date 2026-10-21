import { Router } from "express";
import { z } from "zod";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../lib/credits";

const router = Router();

/** 100 Visual Bucs — matches the credit registry entry for this path. */
const BURN_COST = 100;

const bodySchema = z.object({
  transcript: z.string().min(1).max(8000),
  preset: z.enum(["karaoke", "popin", "lowerthird"]),
  wordsPerSecond: z.number().min(0.5).max(10).optional().default(3),
});

interface TimedWord {
  word: string;
  start: number;
  end: number;
}

const PRESET_STYLES: Record<string, Record<string, unknown>> = {
  karaoke: {
    name: "Karaoke",
    description: "Word-by-word gold highlight that sweeps with the playhead.",
    animation: "highlight",
    fontFamily: "system-ui, sans-serif",
    fontWeight: 800,
    wordColor: "#FFFFFF",
    highlightColor: "#C9A84C",
    background: "rgba(0,0,0,0.55)",
    textTransform: "uppercase",
  },
  popin: {
    name: "Pop-in",
    description: "Each word scales in with a gold flash as it lands.",
    animation: "scale",
    fontFamily: "system-ui, sans-serif",
    fontWeight: 800,
    wordColor: "#FFFFFF",
    highlightColor: "#C9A84C",
    background: "rgba(0,0,0,0.35)",
    textTransform: "uppercase",
  },
  lowerthird: {
    name: "Lower third",
    description: "Minimal gold bar with clean white words across the bottom.",
    animation: "bar",
    fontFamily: "system-ui, sans-serif",
    fontWeight: 600,
    wordColor: "#FFFFFF",
    highlightColor: "#C9A84C",
    background: "linear-gradient(90deg, rgba(0,0,0,0.75), rgba(0,0,0,0.15))",
    textTransform: "none",
  },
};

function formatSrtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rem = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(rem).padStart(3, "0")}`;
}

function formatVttTime(seconds: number): string {
  return formatSrtTime(seconds).replace(",", ".");
}

/** AI pass: clean up and punctuate the raw transcript, return the cleaned words only. */
async function cleanTranscript(openai: ReturnType<typeof getOpenAI>, transcript: string): Promise<string[]> {
  const completion = await openai.chat.completions.create({
    model: getTextModel(),
    messages: [
      {
        role: "system",
        content:
          "You are a caption editor. Take the user's raw transcript and return clean, " +
          "properly punctuated and capitalized caption text. Fix obvious typos and run-on " +
          "words, but do NOT add new content, do NOT remove meaning, and do NOT reorder. " +
          'Respond ONLY with JSON: {"cleaned": "the cleaned text"}.',
      },
      { role: "user", content: transcript.slice(0, 8000) },
    ],
    response_format: { type: "json_object" },
    max_tokens: 4000,
  });
  const raw = completion.choices?.[0]?.message?.content ?? "{}";
  let cleaned = transcript;
  try {
    const parsed = JSON.parse(raw) as { cleaned?: unknown };
    if (typeof parsed.cleaned === "string" && parsed.cleaned.trim().length > 0) {
      cleaned = parsed.cleaned;
    }
  } catch {
    /* keep the raw transcript on malformed AI output */
  }
  const words = cleaned.split(/\s+/).map((w) => w.trim()).filter(Boolean);
  if (words.length === 0) {
    throw new Error("Transcript produced no usable words.");
  }
  return words;
}

/** Build caption cues — 5 words per cue keeps subtitles readable on small screens. */
function buildSrt(words: TimedWord[]): string {
  const lines: string[] = [];
  for (let i = 0, cue = 1; i < words.length; i += 5, cue += 1) {
    const chunk = words.slice(i, i + 5);
    const first = chunk[0]!;
    const last = chunk[chunk.length - 1]!;
    lines.push(String(cue));
    lines.push(`${formatSrtTime(first.start)} --> ${formatSrtTime(last.end)}`);
    lines.push(chunk.map((w) => w.word).join(" "));
    lines.push("");
  }
  return lines.join("\n");
}

function buildVtt(words: TimedWord[]): string {
  const lines = ["WEBVTT", ""];
  for (let i = 0; i < words.length; i += 5) {
    const chunk = words.slice(i, i + 5);
    const first = chunk[0]!;
    const last = chunk[chunk.length - 1]!;
    lines.push(`${formatVttTime(first.start)} --> ${formatVttTime(last.end)}`);
    lines.push(chunk.map((w) => w.word).join(" "));
    lines.push("");
  }
  return lines.join("\n");
}

router.post("/wave8/caption-styler/burn", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  const { transcript, preset, wordsPerSecond } = parsed.data;

  /* The burn includes an AI clean-up pass, so the provider key is required —
     503 with no charge when the key is absent. */
  let openai;
  try {
    openai = getOpenAI();
  } catch {
    res.status(503).json({
      error: "ai_unavailable",
      message: "AI caption processing is not configured on this server.",
    });
    return;
  }

  let creditsRemaining = req.userCredits ?? 0;
  try {
    creditsRemaining = await chargeCredits(req.userId!, BURN_COST, {
      action: "Caption Styler Burn",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits" });
      return;
    }
    throw err;
  }

  try {
    const cleanedWords = await cleanTranscript(openai, transcript);

    /* Deterministic per-word timing from the requested pace. */
    const words: TimedWord[] = cleanedWords.map((word, i) => ({
      word,
      start: Math.round((i / wordsPerSecond) * 100) / 100,
      end: Math.round(((i + 1) / wordsPerSecond) * 100) / 100,
    }));

    res.json({
      words,
      srt: buildSrt(words),
      vtt: buildVtt(words),
      preset,
      style: PRESET_STYLES[preset],
      creditsRemaining,
    });
  } catch (err) {
    try {
      await refundCredits(req.userId!, BURN_COST, {
        action: "Caption Styler Burn (refund)",
      });
    } catch {
      /* refund logged inside refundCredits */
    }
    logger.error({ err, userId: req.userId }, "[wave8] caption-styler failed");
    res.status(500).json({ error: "generation_failed" });
  }
});

export default router;
