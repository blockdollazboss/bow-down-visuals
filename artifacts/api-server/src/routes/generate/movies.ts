import { Router } from "express";
import { z } from "zod";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";

/* ─── Movies & Web Series ────────────────────────────────────────────────
   Two AI tools for video creators expanding into long-form:

   1. Concept generator — describe a movie or web series idea and GPT-6 Sol
      returns a title, logline, episode breakdown, and character bible.
   2. Streamer clip detector — describe (or paste a link to) a stream VOD and
      the AI returns highlight timestamps with clip-ready titles, tuned for
      funny moments, big plays, and reactions.

   Credits are charged BEFORE generation and refunded on failure, matching
   the contract-analyzer pattern. */

const router = Router();

/* Credits per generation — env-overridable. */
const CONCEPT_CREDITS = Number(process.env["MOVIE_CONCEPT_CREDIT_COST"]) || 4;
const CLIP_DETECT_CREDITS = Number(process.env["CLIP_DETECT_CREDIT_COST"]) || 3;
export { CONCEPT_CREDITS, CLIP_DETECT_CREDITS };

const FORMAT_TYPES = ["movie", "web-series", "limited-series"] as const;
type FormatType = (typeof FORMAT_TYPES)[number];

const FORMAT_LABELS: Record<FormatType, string> = {
  movie: "Movie",
  "web-series": "Web Series",
  "limited-series": "Limited Series",
};

export const conceptSchema = z.object({
  idea: z
    .string()
    .min(50, "Describe your concept in at least a few sentences.")
    .max(5000, "Keep the concept under ~5000 characters."),
  format: z.enum(FORMAT_TYPES).default("web-series"),
  genre: z.string().max(100).optional().default(""),
  episodeCount: z.number().int().min(1).max(24).optional().default(8),
});

export type ConceptInput = z.infer<typeof conceptSchema>;

const CONCEPT_SYSTEM_PROMPT = `You are an expert film & TV development executive working for an AI creator platform. Your job is to take a creator's raw movie or web series idea and turn it into a professional development package.

Return ONLY valid JSON (no markdown fences, no commentary) with this exact shape:
{
  "title": "<a punchy, marketable title>",
  "tagline": "<one-line poster tagline>",
  "logline": "<2-3 sentence industry-standard logline: protagonist, goal, obstacle, stakes>",
  "synopsis": "<one paragraph synopsis>",
  "genre": "<primary genre + tone>",
  "targetAudience": "<who this is for>",
  "episodes": [
    { "number": 1, "title": "<episode title>", "summary": "<3-4 sentence episode breakdown with the hook and cliffhanger>" }
  ],
  "characters": [
    { "name": "<character name>", "role": "<protagonist|antagonist|supporting>", "description": "<2-3 sentence character bible: who they are, what they want, their flaw>", "arc": "<one sentence character arc>" }
  ],
  "pilotHook": "<what makes the pilot unmissable in one sentence>",
  "comparables": ["<2-3 'X meets Y' comparables>"]
}

Rules:
- For "movie" format, return exactly 1 episode entry describing the three acts instead of episodes.
- For "web-series", match the requested episode count (default 8).
- For "limited-series", match the requested episode count (default 6).
- Characters: 4-6 characters with real flaws and conflicting wants.
- Make it feel premium and bingeable — this creator wants to stand out.
- Keep episode summaries tight but vivid. No filler.`;

router.post("/concept", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = conceptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  const { idea, format, genre, episodeCount } = parsed.data;

  let charged = false;
  try {
    await chargeCredits(req.userId!, CONCEPT_CREDITS, {
      action: "Movie/Series Concept",
    });
    charged = true;

    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: CONCEPT_SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `Format: ${FORMAT_LABELS[format]}\n` +
            `${genre ? `Genre: ${genre}\n` : ""}` +
            `${format !== "movie" ? `Episode count: ${episodeCount}\n` : ""}` +
            `\nCreator's idea:\n${idea}`,
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 5000,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let concept: Record<string, unknown>;
    try {
      concept = JSON.parse(raw);
    } catch {
      throw new Error("AI returned unparseable concept");
    }

    res.json({
      concept,
      format,
      creditsCharged: CONCEPT_CREDITS,
    });
  } catch (err) {
    if (charged) {
      try {
        await refundCredits(req.userId!, CONCEPT_CREDITS, {
          action: "Movie/Series Concept (refund: generation failed)",
        });
      } catch (refundErr) {
        logger.error({ err: refundErr }, "[movies] concept refund failed");
      }
    }
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits" });
      return;
    }
    logger.error({ err }, "[movies] concept generation failed");
    res.status(500).json({ error: "generation_failed" });
  }
});

export const clipDetectSchema = z.object({
  streamUrl: z
    .string()
    .url("Paste a valid stream/VOD URL.")
    .max(2000)
    .optional()
    .default(""),
  description: z
    .string()
    .min(50, "Describe the stream in at least a few sentences — game, key moments, vibe.")
    .max(5000, "Keep the description under ~5000 characters."),
  streamLengthMin: z.number().int().min(1).max(1440).optional().default(120),
  clipCount: z.number().int().min(1).max(20).optional().default(8),
});

export type ClipDetectInput = z.infer<typeof clipDetectSchema>;

const CLIP_DETECT_SYSTEM_PROMPT = `You are an expert short-form content strategist for streamers. Your job is to look at a description of a stream VOD and identify the most clip-worthy highlight moments — the ones that would pop off as TikToks, Reels, and Shorts.

Return ONLY valid JSON (no markdown fences, no commentary) with this exact shape:
{
  "clips": [
    {
      "title": "<punchy, click-worthy clip title under 60 chars>",
      "timestamp": "<estimated timestamp like '1:23:45'>",
      "timestampSeconds": <estimated seconds into the stream>,
      "durationSec": <suggested clip length, 15-90 seconds>,
      "category": "<funny-moment|big-play|reaction|fail|wholesome|rant|clutch>",
      "hook": "<the first 3 seconds hook text — what grabs the scroller>",
      "caption": "<ready-to-post caption with 3-5 hashtags>",
      "viralityScore": <1-10, how likely this clip is to pop off>
    }
  ],
  "streamSummary": "<2-3 sentence summary of the stream's best content>",
  "postingStrategy": "<one paragraph: best posting order and timing for these clips>"
}

Rules:
- Spread timestamps across the full stream length — don't cluster them.
- Titles must be specific and curiosity-driven, never generic ("INSANE clutch" beats "good play").
- Categories should mix: prioritize funny moments and big plays, but include reactions and fails.
- Virality scores must vary — be honest about which moments are truly elite.
- Captions should feel native to TikTok/Reels, not corporate.
- If the description is too vague to identify real moments, say so in streamSummary and return fewer, clearly-labeled "best guess" clips.`;

router.post("/clip-detect", requireAuth, publicApiLimiter, async (req, res) => {
  const parsed = clipDetectSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
    return;
  }
  const { streamUrl, description, streamLengthMin, clipCount } = parsed.data;

  let charged = false;
  try {
    await chargeCredits(req.userId!, CLIP_DETECT_CREDITS, {
      action: "Stream Clip Detection",
    });
    charged = true;

    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: CLIP_DETECT_SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `${streamUrl ? `Stream URL: ${streamUrl}\n` : ""}` +
            `Stream length: ~${streamLengthMin} minutes\n` +
            `Clips wanted: ${clipCount}\n` +
            `\nStream description:\n${description}`,
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 5000,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let detection: Record<string, unknown>;
    try {
      detection = JSON.parse(raw);
    } catch {
      throw new Error("AI returned unparseable clip detection");
    }

    res.json({
      detection,
      creditsCharged: CLIP_DETECT_CREDITS,
      note: streamUrl
        ? "Timestamps are AI estimates based on your description — scrub the VOD to confirm exact moments before cutting."
        : "Timestamps are AI estimates — scrub the VOD to confirm exact moments before cutting.",
    });
  } catch (err) {
    if (charged) {
      try {
        await refundCredits(req.userId!, CLIP_DETECT_CREDITS, {
          action: "Stream Clip Detection (refund: detection failed)",
        });
      } catch (refundErr) {
        logger.error({ err: refundErr }, "[movies] clip-detect refund failed");
      }
    }
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits" });
      return;
    }
    logger.error({ err }, "[movies] clip detection failed");
    res.status(500).json({ error: "detection_failed" });
  }
});

export default router;
