import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";

const router = Router();

/* Platforms the Script Writer optimizes for — keep in sync with the
   frontend /script-writer page. */
export const SCRIPT_WRITER_PLATFORMS = ["youtube", "tiktok", "reels"] as const;
export type ScriptWriterPlatform = (typeof SCRIPT_WRITER_PLATFORMS)[number];

export const SCRIPT_WRITER_LENGTHS = ["short", "medium", "long", "deep"] as const;
export type ScriptWriterLength = (typeof SCRIPT_WRITER_LENGTHS)[number];

export const SCRIPT_WRITER_TONES = [
  "educational",
  "entertaining",
  "inspirational",
  "controversial",
] as const;
export type ScriptWriterTone = (typeof SCRIPT_WRITER_TONES)[number];

const PLATFORM_DIRECTION: Record<ScriptWriterPlatform, string> = {
  youtube:
    "YouTube (landscape-leaning, search-friendly, chapters matter, mid-roll pacing)",
  tiktok: "TikTok (vertical, sub-60s energy even in longer cuts, comment-bait)",
  reels: "Instagram Reels (vertical, aesthetic-first, save/share triggers)",
};

const LENGTH_DIRECTION: Record<ScriptWriterLength, string> = {
  short: "under 60 seconds — tight, every word earns its place, one idea only",
  medium: "1 to 3 minutes — a clear arc with 2-3 beats",
  long: "3 to 10 minutes — full structure with chapters and re-hooks",
  deep: "10+ minutes — documentary-grade depth, multiple open loops",
};

const TONE_DIRECTION: Record<ScriptWriterTone, string> = {
  educational: "teach like a generous expert — clear, concrete, zero fluff",
  entertaining: "high energy, jokes and personality, keep it moving",
  inspirational: "story-driven, emotional stakes, make them feel something",
  controversial: "bold takes, challenge assumptions — spicy but defensible, never hateful",
};

/* 2 credits per script — env-overridable without a deploy. A full script is a
   long GPT-6 Sol completion (still a fraction of a cent in provider fees), so
   2 credits holds a deep margin while staying an impulse buy — and honors the
   standing rule that every AI feature costs a fee. */
export const SCRIPT_WRITER_CREDIT_COST =
  Number(process.env["SCRIPT_WRITER_CREDIT_COST"]) || 2;

const scriptWriterSchema = z.object({
  platform: z.enum(SCRIPT_WRITER_PLATFORMS),
  length: z.enum(SCRIPT_WRITER_LENGTHS),
  topic: z.string().min(1, "Tell us what the video is about.").max(300),
  tone: z.enum(SCRIPT_WRITER_TONES),
  audience: z.string().max(200).optional().default(""),
  ctaGoal: z.string().max(200).optional().default(""),
});

export type ScriptBeat = {
  timestamp: string;
  spoken: string;
  visualCue: string;
  broll: string;
};

export type RetentionBeat = {
  at: string;
  tactic: string;
  line: string;
};

/** Build the system prompt for a script request. Exported for tests. */
export function buildScriptPrompt(input: z.infer<typeof scriptWriterSchema>): string {
  const audienceLine = input.audience.trim()
    ? ` Target audience: "${input.audience.trim()}".`
    : "";
  const ctaLine = input.ctaGoal.trim()
    ? ` End with a CTA driving this outcome: "${input.ctaGoal.trim()}".`
    : ` End with a natural CTA (subscribe/follow/comment) that fits the video.`;
  return (
    `You are an elite video scriptwriter for independent creators. ` +
    `Write a complete, shoot-ready script for ${PLATFORM_DIRECTION[input.platform]}. ` +
    `Target length: ${LENGTH_DIRECTION[input.length]}. ` +
    `Tone: ${TONE_DIRECTION[input.tone]}. ` +
    `Topic: "${input.topic.trim()}".${audienceLine}${ctaLine} ` +
    `Structure rules: (1) OPEN with a first-3-seconds hook engineered to stop the scroll ` +
    `— a curiosity gap, bold claim, or pattern interrupt, spoken-style, max 20 words. ` +
    `(2) Write the full script as timestamped beats — each beat has the exact spoken lines, ` +
    `a visual cue (what's on screen), and a B-roll suggestion. ` +
    `(3) Every ~30 seconds insert a retention beat: a pattern interrupt, open loop, or ` +
    `re-hook that keeps viewers watching — label the tactic. ` +
    `(4) No filler, no "hey guys welcome back" throat-clearing, no corporate speak. ` +
    `Speak directly to the viewer ("you"). ` +
    `Return ONLY JSON: {"title": "<clickable video title>", ` +
    `"hook": "<the exact first-3-seconds spoken hook>", ` +
    `"beats": [{"timestamp": "0:00", "spoken": "...", "visualCue": "...", "broll": "..."}, ...], ` +
    `"retentionBeats": [{"at": "0:30", "tactic": "open loop | pattern interrupt | re-hook", "line": "<the exact spoken retention line>"}, ...], ` +
    `"cta": "<the exact spoken call-to-action>", ` +
    `"teleprompter": "<the full script as one continuous spoken text, no timestamps or cues>"}.`
  );
}

/* POST /api/script-writer { platform, length, topic, tone, audience?, ctaGoal? }
   → 200 { title, hook, beats, retentionBeats, cta, teleprompter, creditsUsed, creditsRemaining }
   Paid: 2 credits per script. Auth required; credits are deducted BEFORE the
   model call and REFUNDED if the provider fails (money-integrity rule). */
router.post("/script-writer", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = scriptWriterSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid script request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < SCRIPT_WRITER_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to keep writing scripts.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, SCRIPT_WRITER_CREDIT_COST, {
      action: "AI Script Writer",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to keep writing scripts.",
      });
      return;
    }
    throw err;
  }

  let charged = true;
  try {
    const input = parsed.data;
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: buildScriptPrompt(input) },
        {
          role: "user",
          content: `Write the full shoot-ready script for: "${input.topic.trim()}"`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 3000,
      temperature: 0.8,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let title = "";
    let hook = "";
    let beats: ScriptBeat[] = [];
    let retentionBeats: RetentionBeat[] = [];
    let cta = "";
    let teleprompter = "";
    try {
      const parsedJson = JSON.parse(raw) as {
        title?: unknown;
        hook?: unknown;
        beats?: unknown;
        retentionBeats?: unknown;
        cta?: unknown;
        teleprompter?: unknown;
      };
      if (typeof parsedJson.title === "string" && parsedJson.title.trim()) {
        title = parsedJson.title.trim();
      }
      if (typeof parsedJson.hook === "string" && parsedJson.hook.trim()) {
        hook = parsedJson.hook.trim();
      }
      if (Array.isArray(parsedJson.beats)) {
        beats = parsedJson.beats
          .filter(
            (b): b is { timestamp: string; spoken: string; visualCue: string; broll: string } =>
              !!b &&
              typeof (b as { timestamp?: unknown }).timestamp === "string" &&
              typeof (b as { spoken?: unknown }).spoken === "string"
          )
          .map((b) => ({
            timestamp: String(b.timestamp).trim(),
            spoken: String(b.spoken).trim(),
            visualCue: typeof b.visualCue === "string" ? b.visualCue.trim() : "",
            broll: typeof b.broll === "string" ? b.broll.trim() : "",
          }))
          .filter((b) => b.spoken.length > 0)
          .slice(0, 40);
      }
      if (Array.isArray(parsedJson.retentionBeats)) {
        retentionBeats = parsedJson.retentionBeats
          .filter(
            (r): r is { at: string; tactic: string; line: string } =>
              !!r &&
              typeof (r as { at?: unknown }).at === "string" &&
              typeof (r as { line?: unknown }).line === "string"
          )
          .map((r) => ({
            at: String(r.at).trim(),
            tactic: typeof r.tactic === "string" ? r.tactic.trim() : "",
            line: String(r.line).trim(),
          }))
          .filter((r) => r.line.length > 0)
          .slice(0, 20);
      }
      if (typeof parsedJson.cta === "string" && parsedJson.cta.trim()) {
        cta = parsedJson.cta.trim();
      }
      if (typeof parsedJson.teleprompter === "string" && parsedJson.teleprompter.trim()) {
        teleprompter = parsedJson.teleprompter.trim();
      }
    } catch {
      /* fall through to the empty check below */
    }
    if (beats.length === 0 || !hook) {
      throw new Error("Model returned no usable script");
    }

    charged = false; // success — no refund
    res.json({
      title,
      hook,
      beats,
      retentionBeats,
      cta,
      teleprompter,
      creditsUsed: SCRIPT_WRITER_CREDIT_COST,
      creditsRemaining,
    });
  } catch (err) {
    if (charged) {
      try {
        await refundCredits(req.userId!, SCRIPT_WRITER_CREDIT_COST, {
          action: "AI Script Writer — Refund (generation failed)",
        });
        creditsRemaining = balance;
      } catch (refundErr) {
        // Logged inside refundCredits; don't mask the original failure.
        void refundErr;
      }
    }
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[script-writer] OpenAI rate limit / quota");
      res.status(503).json({ error: "The studio is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[script-writer] generation failed");
    res.status(502).json({ error: "The studio hiccupped — your credits were refunded. Try again." });
  }
});

export default router;
