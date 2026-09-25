import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";
import { recordCreditUsage } from "../../lib/payment-record";

const router = Router();

/* Video types for the Hook Generator — keep in sync with the frontend /hooks page. */
const VIDEO_TYPES = [
  "music-promo",
  "behind-the-scenes",
  "tutorial",
  "announcement",
] as const;
type VideoType = (typeof VIDEO_TYPES)[number];

const VIDEO_TYPE_DIRECTION: Record<VideoType, string> = {
  "music-promo": "promoting an original song or music video",
  "behind-the-scenes": "behind-the-scenes / process content from a creator's studio life",
  "tutorial": "a quick tutorial teaching one creator skill",
  "announcement": "announcing a release, drop, show, or big creator news",
};

/* 1 credit per generation — env-overridable without a deploy. A hook or
   pre-flight call is a short GPT-6 Sol completion (a fraction of a cent in
   provider fees), so 1 credit holds a deep margin while staying an impulse
   buy — and honors the standing rule that every AI feature costs a fee. */
const HOOK_STUDIO_CREDITS = Number(process.env["HOOK_STUDIO_CREDIT_COST"]) || 1;

const hooksSchema = z.object({
  mode: z.literal("hooks"),
  videoType: z.enum(VIDEO_TYPES),
  topic: z.string().max(300).optional().default(""),
});

const preflightSchema = z.object({
  mode: z.literal("preflight"),
  title: z.string().min(1, "Title is required.").max(200),
  caption: z.string().max(1000).optional().default(""),
  hashtags: z.string().max(500).optional().default(""),
  description: z.string().max(1000).optional().default(""),
});

const PLATFORMS = ["tiktok", "instagram", "youtube", "twitter"] as const;

const captionsSchema = z.object({
  mode: z.literal("captions"),
  topic: z.string().min(1, "Tell us what the post is about.").max(500),
  platform: z.enum(PLATFORMS).default("tiktok"),
  tone: z.string().max(100).optional().default(""),
});

const hookStudioSchema = z.discriminatedUnion("mode", [hooksSchema, preflightSchema, captionsSchema]);

/* Text model: centralized in getTextModel() (default gpt-6-sol, env-overridable
   via OPENAI_TEXT_MODEL). Called per-request like every other route —
   do not hardcode model IDs. */

/* POST /api/hook-studio { mode, ... } → 200 { hooks | scorecard | captions, creditsUsed, creditsRemaining }
   Paid: 1 credit per generation (all modes). Auth required; credits are
   deducted BEFORE the model call using the same pre-check + deductCredits +
   recordCreditUsage pattern as the randomizer and chat paid mode. */
router.post("/hook-studio", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = hookStudioSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid hook studio request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < HOOK_STUDIO_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to keep using the Hook Studio.",
    });
    return;
  }
  let creditsRemaining = balance;
  const actionName =
    parsed.data.mode === "hooks" ? "Hook Generator"
    : parsed.data.mode === "captions" ? "Caption & Hashtag Generator"
    : "Virality Pre-flight";
  try {
    creditsRemaining = await chargeCredits(req.userId!, HOOK_STUDIO_CREDITS, { action: actionName });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to keep using the Hook Studio.",
      });
      return;
    }
    throw err;
  }

  try {
    if (parsed.data.mode === "hooks") {
      const { videoType, topic } = parsed.data;
      const direction = VIDEO_TYPE_DIRECTION[videoType];
      const topicLine = topic.trim()
        ? ` The video is about: "${topic.trim()}".`
        : "";

      const completion = await getOpenAI().chat.completions.create({
        model: getTextModel(),
        messages: [
          {
            role: "system",
            content:
              `You are a viral content strategist for independent music creators. ` +
              `The first 3 seconds decide everything — write opening hooks (the exact spoken or on-screen ` +
              `first line) for a video ${direction}.${topicLine} ` +
              `Generate exactly 5 hooks. Each must be one punchy line (max 18 words), spoken-style, ` +
              `built on curiosity gaps, bold claims, or pattern interrupts — no generic advice, no ` +
              `duplicates, no filler. Speak directly to the viewer ("you"). ` +
              `Return ONLY JSON: {"hooks": ["...", "...", "...", "...", "..."]}.`,
          },
          { role: "user", content: `Give me 5 first-3-second hooks for a video ${direction}.${topicLine}` },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 600,
        temperature: 0.9,
      });

      const raw = completion.choices[0]?.message?.content ?? "{}";
      let hooks: string[] = [];
      try {
        const parsedJson = JSON.parse(raw) as { hooks?: unknown };
        if (Array.isArray(parsedJson.hooks)) {
          hooks = parsedJson.hooks
            .filter((h): h is string => typeof h === "string" && h.trim().length > 0)
            .map((h) => h.trim())
            .slice(0, 5);
        }
      } catch {
        /* fall through to the empty check below */
      }
      if (hooks.length === 0) {
        throw new Error("Model returned no usable hooks");
      }

      res.json({ hooks, creditsUsed: HOOK_STUDIO_CREDITS, creditsRemaining });
      return;
    }

    /* ── captions mode: captions + hashtags + CTA ────────────────────────────
       Generates ready-to-post packaging: 3 caption options, tiered hashtags
       (niche / broad / trending), and a call-to-action. */
    if (parsed.data.mode === "captions") {
      const { topic, platform, tone } = parsed.data;
      const toneLine = tone.trim() ? ` Tone/vibe: "${tone.trim()}".` : "";

      const completion = await getOpenAI().chat.completions.create({
        model: getTextModel(),
        messages: [
          {
            role: "system",
            content:
              `You are a social media copywriter for independent music creators. ` +
              `Write post packaging for ${platform}. ` +
              `Generate: (1) exactly 3 caption options — each 1-3 punchy lines, written in the creator's ` +
              `voice, with personality and zero corporate speak; (2) hashtags in 3 tiers — 5 niche tags ` +
              `(specific to the content, under 500K posts), 5 broad tags (1M+ posts, high discovery), ` +
              `3 trending-style tags (current formats/challenges energy); (3) one call-to-action line ` +
              `that drives comments, saves, or shares. ` +
              `Every hashtag WITHOUT the # symbol (frontend adds it). No duplicates across tiers. ` +
              `Return ONLY JSON: {"captions": ["...", "...", "..."], ` +
              `"hashtags": {"niche": ["..."], "broad": ["..."], "trending": ["..."]}, ` +
              `"cta": "..."}.`,
          },
          { role: "user", content: `Write post packaging for this: "${topic}".${toneLine}` },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 800,
        temperature: 0.8,
      });

      const raw = completion.choices[0]?.message?.content ?? "{}";
      let captions: string[] = [];
      let hashtags = { niche: [] as string[], broad: [] as string[], trending: [] as string[] };
      let cta = "";
      try {
        const parsedJson = JSON.parse(raw) as {
          captions?: unknown; hashtags?: unknown; cta?: unknown;
        };
        if (Array.isArray(parsedJson.captions)) {
          captions = parsedJson.captions
            .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
            .map((c) => c.trim())
            .slice(0, 3);
        }
        const h = parsedJson.hashtags as { niche?: unknown; broad?: unknown; trending?: unknown } | undefined;
        if (h) {
          for (const tier of ["niche", "broad", "trending"] as const) {
            const arr = h[tier];
            if (Array.isArray(arr)) {
              hashtags[tier] = arr
                .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
                .map((t) => t.trim().replace(/^#+/, ""))
                .slice(0, 8);
            }
          }
        }
        if (typeof parsedJson.cta === "string" && parsedJson.cta.trim()) {
          cta = parsedJson.cta.trim();
        }
      } catch {
        /* fall through to the empty check below */
      }
      if (captions.length === 0) {
        throw new Error("Model returned no usable captions");
      }

      res.json({ captions, hashtags, cta, creditsUsed: HOOK_STUDIO_CREDITS, creditsRemaining });
      return;
    }

    /* ── preflight mode: viral-readiness scorecard ───────────────────────────
       Honest framing: this scores READINESS, never a virality guarantee —
       no AI can predict what actually goes viral. */
    const { title, caption, hashtags, description } = parsed.data;
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a brutally honest viral-content coach for independent music creators. ` +
            `Score the creator's post for VIRAL READINESS (0-100) — how well it is engineered to earn ` +
            `attention on TikTok, Reels, and Shorts. This is a readiness score, NOT a prediction: be ` +
            `explicit that no one can guarantee virality. Judge: (1) hook strength — does the title/first ` +
            `line stop the scroll in 3 seconds, (2) title quality — curiosity, specificity, length, ` +
            `(3) caption quality — does it add value or a CTA instead of dead weight, (4) hashtag ` +
            `quality — specific and discoverable vs. generic spam, (5) platform best practices — vertical ` +
            `format cues, posting signals, comment-bait, save/share triggers implied by the packaging. ` +
            `Every check needs one concrete, specific fix the creator can apply in 2 minutes. ` +
            `Return ONLY JSON: {"score": <0-100 overall>, "verdict": "<one blunt sentence>", ` +
            `"disclaimer": "A readiness score, not a virality guarantee — no AI can predict what blows up.", ` +
            `"checks": [{"label": "<check name>", "score": <0-100>, "fix": "<specific 2-minute fix>"}, ...]} ` +
            `with exactly the 5 checks listed above, in that order.`,
        },
        {
          role: "user",
          content:
            `Score this post for viral readiness.\n` +
            `Title: ${title}\n` +
            `Caption: ${caption || "(none)"}\n` +
            `Hashtags: ${hashtags || "(none)"}\n` +
            `Video description: ${description || "(not provided)"}`,
        },
      ],
      response_format: { type: "json_object" },
      max_completion_tokens: 1200,
      temperature: 0.4,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let score = 0;
    let verdict = "";
    let disclaimer = "A readiness score, not a virality guarantee — no AI can predict what blows up.";
    let checks: Array<{ label: string; score: number; fix: string }> = [];
    try {
      const parsedJson = JSON.parse(raw) as {
        score?: unknown; verdict?: unknown; disclaimer?: unknown; checks?: unknown;
      };
      if (typeof parsedJson.score === "number") score = Math.max(0, Math.min(100, Math.round(parsedJson.score)));
      if (typeof parsedJson.verdict === "string" && parsedJson.verdict.trim()) verdict = parsedJson.verdict.trim();
      if (typeof parsedJson.disclaimer === "string" && parsedJson.disclaimer.trim()) disclaimer = parsedJson.disclaimer.trim();
      if (Array.isArray(parsedJson.checks)) {
        checks = parsedJson.checks
          .filter(
            (c): c is { label: string; score: number; fix: string } =>
              !!c &&
              typeof (c as { label?: unknown }).label === "string" &&
              typeof (c as { score?: unknown }).score === "number" &&
              typeof (c as { fix?: unknown }).fix === "string"
          )
          .map((c) => ({
            label: c.label.trim(),
            score: Math.max(0, Math.min(100, Math.round(c.score))),
            fix: c.fix.trim(),
          }))
          .slice(0, 5);
      }
    } catch {
      /* fall through to the empty check below */
    }
    if (checks.length === 0) {
      throw new Error("Model returned no usable scorecard");
    }

    res.json({
      score,
      verdict,
      disclaimer,
      checks,
      creditsUsed: HOOK_STUDIO_CREDITS,
      creditsRemaining,
    });
  } catch (err) {
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err, mode: parsed.data.mode }, "[hook-studio] OpenAI rate limit / quota");
      res.status(503).json({ error: "The studio is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err, mode: parsed.data.mode }, "[hook-studio] generation failed");
    res.status(502).json({ error: "The studio hiccupped — try again." });
  }
});

export default router;
