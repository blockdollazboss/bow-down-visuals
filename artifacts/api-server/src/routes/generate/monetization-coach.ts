import { Router } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { deductCredits, OutOfCreditsError } from "../../lib/credits";
import { recordCreditUsage } from "../../lib/payment-record";

const router = Router();

/* Platforms supported by the coach — keep in sync with the frontend /coach page. */
const PLATFORMS = ["youtube", "tiktok", "instagram"] as const;
type Platform = (typeof PLATFORMS)[number];

const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
};

/* 1 credit per money plan — env-overridable without a deploy. A coach call is a
   medium-length GPT-6 Sol completion (a fraction of a cent in provider fees),
   so 1 credit holds a deep margin while staying an impulse buy — and honors
   the standing rule that every AI feature costs a fee. */
const COACH_CREDITS = Number(process.env["MONETIZATION_COACH_CREDIT_COST"]) || 1;

const coachSchema = z.object({
  niche: z.string().min(1, "Niche is required.").max(120),
  platforms: z.array(z.enum(PLATFORMS)).min(1, "Pick at least one platform.").max(3),
  followers: z
    .object({
      youtube: z.number().int().min(0).max(1000000000).optional().default(0),
      tiktok: z.number().int().min(0).max(1000000000).optional().default(0),
      instagram: z.number().int().min(0).max(1000000000).optional().default(0),
    })
    .optional()
    .default({ youtube: 0, tiktok: 0, instagram: 0 }),
  cadence: z.number().int().min(0).max(100),
});

/* Text model: centralized in getTextModel() (default gpt-6-sol, env-overridable
   via OPENAI_TEXT_MODEL). Called per-request like every other route —
   do not hardcode model IDs. */

/* POST /api/monetization-coach { niche, platforms, followers, cadence }
   → 200 { eligibility[], earnings, moneyMoves[], creditsUsed, creditsRemaining }
   Paid: 1 credit per plan. Auth required; credits are deducted BEFORE the
   model call using the same pre-check + deductCredits + recordCreditUsage
   pattern as hook-studio and the randomizer. */
router.post("/monetization-coach", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = coachSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid money plan request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < COACH_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to build your money plan.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await deductCredits(req.userId!, COACH_CREDITS);
    recordCreditUsage({
      userId: req.userId!,
      action: "Monetization Coach",
      creditsUsed: COACH_CREDITS,
    }).catch(() => {});
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to build your money plan.",
      });
      return;
    }
    throw err;
  }

  /* ── money plan generation ──────────────────────────────────────────────
     Honest framing: thresholds and RPMs shift over time and vary by region,
     so the model must label figures as estimates ("as of 2026", ranges not
     promises) and tell the creator to verify current program terms. */
  const { niche, platforms, followers, cadence } = parsed.data;
  const platformLines = platforms
    .map((p) => `- ${PLATFORM_LABEL[p]}: ${followers[p] ?? 0} followers/subscribers`)
    .join("\n");

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content:
            `You are a no-nonsense monetization coach for independent content creators. ` +
            `A creator tells you their niche, platforms, follower counts, and posting cadence. ` +
            `You return a concrete money plan as JSON. Be specific and practical — no vague ` +
            `"post consistently" fluff. ` +
            `Eligibility: for each platform state the monetization program name, the entry ` +
            `threshold (use your best knowledge as of 2026, e.g. YouTube Partner Program: ` +
            `1,000 subs + 4,000 watch hours/12mo or 10M Shorts views/90d; TikTok Creator ` +
            `Rewards: 10k followers + 100k views/30d on 1min+ videos, 18+; Instagram: ` +
            `invitation-based bonuses plus gifts/subscriptions), estimate progress 0-100 ` +
            `from their follower count, set status to "eligible", "close", or "building", ` +
            `and give ONE specific next step to hit the threshold faster. ` +
            `Earnings: give realistic RPM/revenue ranges for their niche per platform as ` +
            `estimates (label them estimates — never promises), name which format ` +
            `(long-form, Shorts/Reels, TikTok 1min+) earns most for THEIR situation, and ` +
            `recommend a weekly cadence. Money moves: exactly 3 prioritized actions for ` +
            `the next 30 days, each one sentence, ordered by revenue impact. ` +
            `Return ONLY JSON: {"eligibility": [{"platform": "...", "program": "...", ` +
            `"threshold": "...", "progress": <0-100>, "status": "eligible|close|building", ` +
            `"nextStep": "..."}], "earnings": {"rpmNotes": "...", "bestFormat": "...", ` +
            `"bestCadence": "..."}, "moneyMoves": ["...", "...", "..."], ` +
            `"note": "Thresholds and RPMs are estimates as of 2026 — verify current program terms."}`,
        },
        {
          role: "user",
          content:
            `Build my money plan.\n` +
            `Niche: ${niche.trim()}\n` +
            `Platforms:\n${platformLines}\n` +
            `Posting cadence: ${cadence} videos per week`,
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 1500,
      temperature: 0.4,
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    interface EligibilityItem { platform: string; program: string; threshold: string; progress: number; status: string; nextStep: string }
    interface PlanJson {
      eligibility?: unknown; earnings?: unknown; moneyMoves?: unknown; note?: unknown;
    }
    const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
    let eligibility: EligibilityItem[] = [];
    let earnings: { rpmNotes: string; bestFormat: string; bestCadence: string } = {
      rpmNotes: "", bestFormat: "", bestCadence: "",
    };
    let moneyMoves: string[] = [];
    let note = "Thresholds and RPMs are estimates as of 2026 — verify current program terms.";
    try {
      const j = JSON.parse(raw) as PlanJson;
      if (Array.isArray(j.eligibility)) {
        eligibility = j.eligibility
          .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
          .map((e) => ({
            platform: String(e["platform"] ?? "").trim(),
            program: String(e["program"] ?? "").trim(),
            threshold: String(e["threshold"] ?? "").trim(),
            progress: typeof e["progress"] === "number" ? clamp(e["progress"]) : 0,
            status: ["eligible", "close", "building"].includes(String(e["status"]))
              ? String(e["status"])
              : "building",
            nextStep: String(e["nextStep"] ?? "").trim(),
          }))
          .filter((e) => e.platform && e.program)
          .slice(0, 3);
      }
      if (j.earnings && typeof j.earnings === "object") {
        const er = j.earnings as Record<string, unknown>;
        earnings = {
          rpmNotes: String(er["rpmNotes"] ?? "").trim(),
          bestFormat: String(er["bestFormat"] ?? "").trim(),
          bestCadence: String(er["bestCadence"] ?? "").trim(),
        };
      }
      if (Array.isArray(j.moneyMoves)) {
        moneyMoves = j.moneyMoves
          .filter((m): m is string => typeof m === "string" && m.trim().length > 0)
          .map((m) => m.trim())
          .slice(0, 3);
      }
      if (typeof j.note === "string" && j.note.trim()) note = j.note.trim();
    } catch {
      /* fall through to the empty check below */
    }
    if (eligibility.length === 0 || moneyMoves.length === 0) {
      throw new Error("Model returned no usable money plan");
    }

    res.json({
      eligibility,
      earnings,
      moneyMoves,
      note,
      creditsUsed: COACH_CREDITS,
      creditsRemaining,
    });
  } catch (err) {
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[monetization-coach] OpenAI rate limit / quota");
      res.status(503).json({ error: "The coach is catching its breath — try again in a moment." });
      return;
    }
    logger.error({ err }, "[monetization-coach] generation failed");
    res.status(502).json({ error: "The coach hiccupped — try again." });
  }
});

export default router;
