import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";

const router = Router();

/* Content types for the Promo Generator — keep in sync with the frontend
   /promote page's CONTENT_TYPES. */
const CONTENT_TYPES = [
  "twitter",
  "instagram",
  "tiktok",
  "email",
  "banner",
  "ad",
] as const;
type ContentType = (typeof CONTENT_TYPES)[number];

const CONTENT_TYPE_DIRECTION: Record<ContentType, string> = {
  twitter:
    "a punchy Twitter/X post (max 260 characters, built to earn reposts). " +
    "Return the post as `title`, plus 2 alternate posts in `extras`.",
  instagram:
    "an Instagram caption (2-4 engaging lines, emoji where natural, never " +
    "corporate). Return the caption as `body`, plus 1 alternate caption in `extras`.",
  tiktok:
    "a TikTok/Reels script: a spoken hook for the first 3 seconds, then 3-4 " +
    "tight beats, ending on the CTA. Written in spoken creator voice. " +
    "Return the hook line as `title` and the full script as `body`.",
  email:
    "an email blast: a subject line engineered for opens plus a short body " +
    "(max 120 words) with one clear CTA. Return the subject as `title` and " +
    "the body as `body`, plus 2 alternate subject lines in `extras`.",
  banner:
    "5 scroll-stopping banner headlines (each max 8 words). Return the " +
    "strongest as `title` and the other 4 in `extras`; `body` is a one-line " +
    "sub-headline supporting the main headline.",
  ad:
    "paid ad copy: 3 headline options (max 40 chars each) and one primary " +
    "text (max 125 chars). Return the best headline as `title`, the primary " +
    "text as `body`, and the other 2 headlines in `extras`.",
};

/* Tones — keep in sync with the frontend /promote page's TONES. */
const TONES = ["hype", "professional", "funny", "luxury"] as const;
type Tone = (typeof TONES)[number];

const TONE_DIRECTION: Record<Tone, string> = {
  hype: "High-energy, all-caps-adjacent hype — exclamation energy without being spammy.",
  professional: "Polished and credible — like a premium SaaS launch announcement.",
  funny: "Playful and meme-aware — make the creator smirk, never cringe.",
  luxury: "Gold-and-black luxury — exclusive, refined, 'velvet rope' energy.",
};

/* 1 credit per generation — env-overridable without a deploy. A promo pack is
   a short GPT-6 Sol completion (a fraction of a cent in provider fees), so
   1 credit holds a deep margin while staying an impulse buy — and honors the
   standing rule that every AI feature costs a fee. */
const PROMO_GENERATOR_CREDITS = Number(process.env["PROMO_GENERATOR_CREDIT_COST"]) || 1;

const promoSchema = z.object({
  featureName: z.string().min(1, "Pick a feature to promote.").max(120),
  featureTagline: z.string().min(1).max(200),
  featureRoute: z
    .string()
    .min(1)
    .max(60)
    .regex(/^\/[a-z0-9/-]*$/, "Feature route must be a site path."),
  contentType: z.enum(CONTENT_TYPES),
  tone: z.enum(TONES),
  focus: z.string().max(300).optional().default(""),
});

/* Text model: centralized in getTextModel() (default gpt-6-sol, env-overridable
   via OPENAI_TEXT_MODEL). Called per-request like every other route —
   do not hardcode model IDs. */

/* POST /api/promo-generator { featureName, featureTagline, featureRoute, contentType, tone, focus? }
   → 200 { title, body, extras[], hashtags[], cta, creditsUsed, creditsRemaining }
   Paid: 1 credit per generation. Auth required; credits are deducted BEFORE
   the model call and refunded if generation fails or returns unusable output. */
router.post("/promo-generator", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = promoSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid promo request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < PROMO_GENERATOR_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to generate promo content.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, PROMO_GENERATOR_CREDITS, {
      action: "Promo Content Generator",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to generate promo content.",
      });
      return;
    }
    throw err;
  }

  const refundOnFailure = async () => {
    try {
      await refundCredits(req.userId!, PROMO_GENERATOR_CREDITS, {
        action: "Promo Content Generator — Refund (generation failed)",
      });
    } catch (refundErr) {
      logger.error(
        { err: refundErr, userId: req.userId },
        "[promo-generator] refund failed after generation error"
      );
    }
  };

  try {
    const { featureName, featureTagline, featureRoute, contentType, tone, focus } = parsed.data;
    const featureUrl = `https://bowdownvisuals.com${featureRoute}`;
    const focusLine = focus.trim() ? ` Angle to emphasize: "${focus.trim()}".` : "";

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are the marketing copywriter for Bow Down Visuals — "The Content ` +
            `Creator Cheat Code", the AI studio for music creators. Brand voice is gold-and-black ` +
            `luxury: confident, creator-first, zero corporate speak. ` +
            `Write promotional copy for this feature: "${featureName}" — ${featureTagline}. ` +
            `The call-to-action must send people to ${featureUrl} (include the URL or a ` +
            `"link in bio" style pointer naturally in the copy where it fits the format). ` +
            `Format: ${CONTENT_TYPE_DIRECTION[contentType]} ` +
            `Tone: ${TONE_DIRECTION[tone]}${focusLine} ` +
            `Hashtags: 5-8 relevant hashtags WITHOUT the # symbol (frontend adds it), ` +
            `no duplicates, mix of niche and broad. For non-social formats (email, banner, ad) ` +
            `still provide 5 general hashtags. ` +
            `Rules: never promise virality, fame, or income; never use the word "free" for ` +
            `paid features; keep it honest and specific to what the feature does. ` +
            `Return ONLY JSON: {"title": "<headline/subject/hook/post>", ` +
            `"body": "<main copy — may be empty string for twitter/banner/ad>", ` +
            `"extras": ["<alternate option>", ...], ` +
            `"hashtags": ["...", ...], "cta": "<one-line call to action>"}.`,
        },
        {
          role: "user",
          content:
            `Write ${contentType} promo copy for "${featureName}" (${featureTagline}) in a ${tone} tone.${focusLine}`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1000,
      temperature: 0.8,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let title = "";
    let body = "";
    let extras: string[] = [];
    let hashtags: string[] = [];
    let cta = "";
    try {
      const j = JSON.parse(raw) as {
        title?: unknown; body?: unknown; extras?: unknown; hashtags?: unknown; cta?: unknown;
      };
      if (typeof j.title === "string") title = j.title.trim();
      if (typeof j.body === "string") body = j.body.trim();
      if (Array.isArray(j.extras)) {
        extras = j.extras
          .filter((e): e is string => typeof e === "string" && e.trim().length > 0)
          .map((e) => e.trim())
          .slice(0, 5);
      }
      if (Array.isArray(j.hashtags)) {
        hashtags = j.hashtags
          .filter((h): h is string => typeof h === "string" && h.trim().length > 0)
          .map((h) => h.trim().replace(/^#+/, ""))
          .slice(0, 10);
      }
      if (typeof j.cta === "string") cta = j.cta.trim();
    } catch {
      /* fall through to the empty check below */
    }
    if (!title && !body) {
      throw new Error("Model returned no usable promo copy");
    }

    res.json({
      title,
      body,
      extras,
      hashtags,
      cta,
      creditsUsed: PROMO_GENERATOR_CREDITS,
      creditsRemaining,
    });
  } catch (err) {
    await refundOnFailure();
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[promo-generator] OpenAI rate limit / quota");
      res.status(503).json({ error: "The promo desk is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[promo-generator] generation failed");
    res.status(502).json({ error: "The promo desk hiccupped — try again." });
  }
});

export default router;
