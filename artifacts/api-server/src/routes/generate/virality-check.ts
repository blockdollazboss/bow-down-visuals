import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
  LedgerWriteError,
} from "../../lib/credits";

const router = Router();

/* Platforms supported by the Virality Pre-Flight Check — keep in sync with
   the frontend /virality-check page's platform picker. */
const PLATFORMS = ["tiktok", "instagram", "youtube", "x"] as const;
type Platform = (typeof PLATFORMS)[number];

const PLATFORM_DIRECTION: Record<Platform, string> = {
  tiktok: "TikTok (fast scroll, trending sounds, comment-bait)",
  instagram: "Instagram Reels (polished aesthetic, share/save driven, SEO captions)",
  youtube: "YouTube Shorts (title-led discovery, watch-time, subscribe CTA)",
  x: "X / Twitter (quote-post amplification, quote-tweet bait, concise copy)",
};

/* 2 credits per check — env-overridable without a deploy. A scorecard call is
   a short GPT-6 Sol completion (a fraction of a cent in provider fees), so
   2 credits holds a deep margin while honoring the standing rule that every
   AI feature costs a fee. */
const VIRALITY_CHECK_CREDITS =
  Number(process.env["VIRALITY_CHECK_CREDIT_COST"]) || 2;

const viralityCheckSchema = z.object({
  caption: z
    .string()
    .min(1, "Caption is required.")
    .max(2000, "Caption is too long (max 2000 characters)."),
  hashtags: z.string().max(500).optional().default(""),
  hookLine: z.string().max(300).optional().default(""),
  platform: z.enum(PLATFORMS),
});

/* Text model: centralized in getTextModel() (default gpt-6-sol, env-overridable
   via OPENAI_TEXT_MODEL). Called per-request like every other route —
   do not hardcode model IDs. */

/* POST /api/virality-check { caption, hashtags?, hookLine?, platform }
   → 200 { overallScore, hookStrength, captionScore, hashtagAnalysis,
           postingTime, fixes, creditsUsed, creditsRemaining }
   Paid: 2 credits per check. Auth required; credits are deducted BEFORE the
   model call and refunded if the model call fails, so the user never pays
   for a scorecard they didn't get. */
router.post(
  "/virality-check",
  publicApiLimiter,
  requireAuth,
  async (req, res) => {
    const parsed = viralityCheckSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Invalid virality check request.",
        details: parsed.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }

    const balance = req.userCredits ?? 0;
    if (balance < VIRALITY_CHECK_CREDITS) {
      res.status(402).json({
        error: "out_of_credits",
        message:
          "You're out of credits — top up to keep running pre-flight checks.",
      });
      return;
    }
    let creditsRemaining = balance;
    try {
      creditsRemaining = await chargeCredits(
        req.userId!,
        VIRALITY_CHECK_CREDITS,
        { action: "Virality Pre-Flight Check" }
      );
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message:
            "You're out of credits — top up to keep running pre-flight checks.",
        });
        return;
      }
      throw err;
    }

    /* Refund the 2 credits whenever the model call fails — the user paid for
       a scorecard they didn't get. */
    const refund = async () => {
      try {
        await refundCredits(req.userId!, VIRALITY_CHECK_CREDITS, {
          action: "Virality Pre-Flight Check — Refund (generation failed)",
        });
      } catch {
        /* Logged inside refundCredits; don't mask the original failure. */
      }
    };

    try {
      const { caption, hashtags, hookLine, platform } = parsed.data;
      const platformDirection = PLATFORM_DIRECTION[platform];
      const hookLinePart = hookLine.trim()
        ? `Hook (the first line viewers see/hear): "${hookLine.trim()}"`
        : "Hook: (not provided — score hook strength from the caption's opening line)";

      const completion = await getOpenAI().chat.completions.create({
        model: getTextModel(),
        messages: [
          {
            role: "system",
            content:
              `You are a brutally honest viral-content strategist for independent music creators. ` +
              `Score the creator's post packaging for VIRAL READINESS on a 0-100 scale — how well it is ` +
              `engineered to earn attention. This is a READINESS scorecard, never a virality guarantee: ` +
              `no one can predict what actually blows up, and you must never inflate scores to flatter ` +
              `the creator. ` +
              `Score four dimensions: (1) hookStrength — does the hook/first line stop the scroll in the ` +
              `first 3 seconds; (2) captionScore — does the caption add value, personality, or a CTA ` +
              `instead of dead weight; (3) hashtagAnalysis — are the hashtags specific, discoverable, and ` +
              `platform-appropriate vs. generic spam; (4) postingTime — the best posting window for a US ` +
              `audience on this platform, with one honest reason. ` +
              `Hashtag advice MUST be platform-aware: TikTok favors 3-5 specific tags; Instagram Reels ` +
              `reward shareable, niche tags with SEO-style captions; YouTube Shorts lean on title-first ` +
              `discovery (hashtags secondary); X/Twitter rewards 1-2 tags max plus quote-post bait. ` +
              `Posting times should reflect real US audience peaks for the platform (e.g. weekday ` +
              `evenings for TikTok, lunch + evening for Instagram, afternoons for YouTube Shorts, ` +
              `morning/lunch commutes for X). ` +
              `Suggest 5-7 replacement/added hashtags (no # symbol, no duplicates, platform-appropriate ` +
              `mix of niche and broad). End with exactly 3 specific, actionable fixes the creator can ` +
              `apply in minutes — never vague advice. ` +
              `Return ONLY JSON: {"overallScore": <0-100>, ` +
              `"hookStrength": {"score": <0-100>, "feedback": "<blunt, specific>"}, ` +
              `"captionScore": {"score": <0-100>, "feedback": "<blunt, specific>"}, ` +
              `"hashtagAnalysis": {"score": <0-100>, "feedback": "<blunt, specific>", ` +
              `"suggestedHashtags": ["...", ...]}, ` +
              `"postingTime": {"bestTime": "<e.g. Thu 7-9 PM ET>", "reason": "<one line>"}, ` +
              `"fixes": ["<specific fix 1>", "<specific fix 2>", "<specific fix 3>"]}.`,
          },
          {
            role: "user",
            content:
              `Score this post for ${platformDirection}.\n` +
              `${hookLinePart}\n` +
              `Caption: "${caption.trim()}"\n` +
              `Hashtags: ${hashtags.trim() || "(none)"}`,
          },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 1200,
        temperature: 0.4,
      });

      const raw = completion.choices[0]?.message?.content ?? "{}";

      let overallScore = 0;
      let hookStrength = { score: 0, feedback: "" };
      let captionScore = { score: 0, feedback: "" };
      let hashtagAnalysis = {
        score: 0,
        feedback: "",
        suggestedHashtags: [] as string[],
      };
      let postingTime = { bestTime: "", reason: "" };
      let fixes: string[] = [];

      const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
      const clean = (s: unknown) =>
        typeof s === "string" && s.trim().length > 0 ? s.trim() : "";
      const scoreBlock = (v: unknown): { score: number; feedback: string } => {
        const b = v as { score?: unknown; feedback?: unknown } | null;
        return {
          score: typeof b?.score === "number" ? clamp(b.score) : 0,
          feedback: clean(b?.feedback),
        };
      };

      let parsedOk = false;
      try {
        const parsedJson = JSON.parse(raw) as {
          overallScore?: unknown;
          hookStrength?: unknown;
          captionScore?: unknown;
          hashtagAnalysis?: unknown;
          postingTime?: unknown;
          fixes?: unknown;
        };
        if (typeof parsedJson.overallScore === "number") {
          overallScore = clamp(parsedJson.overallScore);
        }
        const hs = scoreBlock(parsedJson.hookStrength);
        const cs = scoreBlock(parsedJson.captionScore);
        const ha = parsedJson.hashtagAnalysis as
          | { score?: unknown; feedback?: unknown; suggestedHashtags?: unknown }
          | null;
        const pt = parsedJson.postingTime as
          | { bestTime?: unknown; reason?: unknown }
          | null;

        if (!hs.feedback || !cs.feedback || !ha?.score || !clean(ha?.feedback)) {
          throw new Error("Model returned an incomplete scorecard");
        }

        hookStrength = hs;
        captionScore = cs;
        hashtagAnalysis = {
          score: typeof ha.score === "number" ? clamp(ha.score) : 0,
          feedback: clean(ha.feedback),
          suggestedHashtags: Array.isArray(ha.suggestedHashtags)
            ? ha.suggestedHashtags
                .filter(
                  (t): t is string =>
                    typeof t === "string" && t.trim().length > 0
                )
                .map((t) => t.trim().replace(/^#+/, ""))
                .slice(0, 10)
            : [],
        };
        postingTime = {
          bestTime: clean(pt?.bestTime) || "Today, 6–9 PM ET",
          reason: clean(pt?.reason) || "US evening scroll peak",
        };
        if (Array.isArray(parsedJson.fixes)) {
          fixes = parsedJson.fixes
            .filter(
              (f): f is string =>
                typeof f === "string" && f.trim().length > 0
            )
            .map((f) => f.trim())
            .slice(0, 3);
        }
        if (fixes.length !== 3 || !postingTime.bestTime) {
          throw new Error("Model returned an incomplete scorecard");
        }
        parsedOk = true;
      } catch {
        /* fall through to the failure below */
      }
      if (!parsedOk) {
        await refund();
        res.status(500).json({
          error: "The check came back empty — credits refunded, try again.",
        });
        return;
      }

      res.json({
        overallScore,
        hookStrength,
        captionScore,
        hashtagAnalysis,
        postingTime,
        fixes,
        creditsUsed: VIRALITY_CHECK_CREDITS,
        creditsRemaining,
      });
    } catch (err) {
      if (
        err instanceof OpenAI.APIError &&
        (err.status === 429 || err.code === "insufficient_quota")
      ) {
        logger.warn({ err }, "[virality-check] OpenAI rate limit / quota");
        await refund();
        res.status(503).json({
          error: "The studio is catching its breath — credits refunded, try again in a moment.",
        });
        return;
      }
      if (err instanceof LedgerWriteError) {
        throw err;
      }
      logger.error({ err }, "[virality-check] generation failed");
      await refund();
      res.status(502).json({
        error: "The studio hiccupped — credits refunded, try again.",
      });
    }
  }
);

export default router;
