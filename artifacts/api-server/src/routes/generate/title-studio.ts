import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";

const router = Router();

/* Platforms and tones — keep in sync with the frontend /titles page. */
const PLATFORMS = ["youtube", "tiktok", "instagram"] as const;
type Platform = (typeof PLATFORMS)[number];

const TONES = ["hype", "professional", "funny"] as const;
type Tone = (typeof TONES)[number];

const PLATFORM_DIRECTION: Record<Platform, string> = {
  youtube:
    "YouTube — titles can be longer (up to ~70 characters reads best), descriptions are long-form " +
    "with chapters/timestamps and pinned-comment style CTAs, tags should include searchable keyword phrases.",
  tiktok:
    "TikTok — titles are short and punchy (the on-screen hook matters more than the caption), " +
    "descriptions are 1-2 lines with a strong CTA, hashtags carry discovery (mix niche + broad).",
  instagram:
    "Instagram Reels — titles short and aesthetic, descriptions can be a touch longer with line breaks " +
    "and emoji, hashtags matter for Explore discovery (mix niche + broad).",
};

const TONE_DIRECTION: Record<Tone, string> = {
  hype: "high-energy, all-caps bursts where it lands, exclamation energy, bold claims",
  professional: "polished, confident, press-release clean — no clickbait, just authority",
  funny: "witty, playful, meme-aware — make them laugh before they click",
};

/* 1 credit per generation — env-overridable without a deploy. A title-studio
   call is a single GPT-6 Sol completion (a fraction of a cent in provider
   fees), so 1 credit holds a deep margin while staying an impulse buy — and
   honors the standing rule that every AI feature costs a fee. */
export const TITLE_STUDIO_CREDITS = Number(process.env["TITLE_STUDIO_CREDIT_COST"]) || 1;

export const titleStudioSchema = z.object({
  topic: z.string().min(1, "Tell us what the video is about.").max(500),
  platform: z.enum(PLATFORMS),
  tone: z.enum(TONES).default("hype"),
  keywords: z.string().max(300).optional().default(""),
});

export interface RankedTitle {
  title: string;
  score: number;
  why: string;
}

export interface TitleStudioResult {
  titles: RankedTitle[];
  description: string;
  tags: string[];
  note: string;
}

/** System prompt for the title-studio generation — pure function, exported for tests. */
export function buildTitleStudioPrompt(platform: Platform, tone: Tone): string {
  return (
    `You are a viral packaging strategist for independent music creators. ` +
    `Write click-worthy packaging for ${PLATFORM_DIRECTION[platform]} ` +
    `The tone is ${TONE_DIRECTION[tone]}. ` +
    `Generate: (1) exactly 10 title options, RANKED by predicted clickability ` +
    `(best first). Each title must be specific — curiosity gaps, numbers, bold ` +
    `claims, or pattern interrupts. No generic filler, no duplicates, no ` +
    `"my new song" energy. Include a "score" 0-100 for each title's predicted ` +
    `clickability and a one-line "why" explaining the psychology. ` +
    `(2) one full video description: an opening hook line, 2-3 paragraphs, ` +
    `placeholder timestamps (00:00 etc.) the creator can fill in, and a ` +
    `call-to-action that drives comments/saves/shares/subscribes. ` +
    `(3) exactly 15 platform-optimized tags/hashtags WITHOUT the # symbol ` +
    `(frontend adds it), no duplicates, mixed niche + broad discovery. ` +
    `Be honest: scores are packaging-readiness estimates, not virality ` +
    `guarantees — say that in the "note" field. ` +
    `Return ONLY JSON: {"titles": [{"title": "...", "score": <0-100>, "why": "..."}, ...], ` +
    `"description": "...", "tags": ["...", ...], "note": "..."}.`
  );
}

/** Parse + sanitize the model's JSON into a TitleStudioResult.
 *  Returns null when the payload has no usable packaging. */
export function parseTitleStudioResponse(raw: string): TitleStudioResult | null {
  let titles: RankedTitle[] = [];
  let description = "";
  let tags: string[] = [];
  let note = "";
  try {
    const parsedJson = JSON.parse(raw) as {
      titles?: unknown;
      description?: unknown;
      tags?: unknown;
      note?: unknown;
    };
    if (Array.isArray(parsedJson.titles)) {
      titles = parsedJson.titles
        .filter(
          (t): t is { title: string; score?: unknown; why?: unknown } =>
            !!t &&
            typeof (t as { title?: unknown }).title === "string" &&
            (t as { title: string }).title.trim().length > 0
        )
        .map((t) => ({
          title: t.title.trim(),
          score:
            typeof t.score === "number"
              ? Math.max(0, Math.min(100, Math.round(t.score)))
              : 0,
          why: typeof t.why === "string" ? t.why.trim() : "",
        }))
        .slice(0, 10);
    }
    if (typeof parsedJson.description === "string" && parsedJson.description.trim()) {
      description = parsedJson.description.trim();
    }
    if (Array.isArray(parsedJson.tags)) {
      tags = parsedJson.tags
        .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
        .map((t) => t.trim().replace(/^#+/, ""))
        .slice(0, 15);
    }
    if (typeof parsedJson.note === "string" && parsedJson.note.trim()) {
      note = parsedJson.note.trim();
    }
  } catch {
    return null;
  }
  if (titles.length === 0 || !description) {
    return null;
  }
  return { titles, description, tags, note };
}

/* Text model: centralized in getTextModel() (default gpt-6-sol, env-overridable
   via OPENAI_TEXT_MODEL). Called per-request like every other route —
   do not hardcode model IDs. */

/* POST /api/title-studio { topic, platform, tone, keywords } →
   200 { titles, description, tags, creditsUsed, creditsRemaining }
   Paid: 1 credit per generation. Auth required; credits are deducted BEFORE
   the model call and REFUNDED when the provider call fails (charge → try →
   refund pattern). 402 out_of_credits when the balance can't cover it. */
router.post("/title-studio", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = titleStudioSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid title studio request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < TITLE_STUDIO_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to keep using the Title Studio.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, TITLE_STUDIO_CREDITS, {
      action: "Title Studio",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to keep using the Title Studio.",
      });
      return;
    }
    throw err;
  }

  try {
    const { topic, platform, tone, keywords } = parsed.data;
    const keywordsLine = keywords.trim()
      ? ` Work these keywords in naturally where they fit: "${keywords.trim()}".`
      : "";

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: buildTitleStudioPrompt(platform, tone) },
        {
          role: "user",
          content: `Package this video for ${platform}: "${topic}".${keywordsLine}`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1600,
      temperature: 0.85,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    const packaged = parseTitleStudioResponse(raw);
    if (!packaged) {
      throw new Error("Model returned no usable packaging");
    }

    res.json({
      ...packaged,
      creditsUsed: TITLE_STUDIO_CREDITS,
      creditsRemaining,
    });
  } catch (err) {
    /* Refund: the user paid for packaging they didn't get. */
    try {
      await refundCredits(req.userId!, TITLE_STUDIO_CREDITS, {
        action: "Title Studio — Refund (generation failed)",
      });
    } catch (refundErr) {
      // Logged inside refundCredits; don't mask the original failure.
      void refundErr;
    }
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[title-studio] OpenAI rate limit / quota");
      res.status(503).json({ error: "The studio is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[title-studio] generation failed");
    res.status(502).json({ error: "The studio hiccupped — try again. Your credit was refunded." });
  }
});

export default router;
