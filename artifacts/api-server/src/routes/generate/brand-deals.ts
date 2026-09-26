import { Router, type Request, type Response } from "express";
import { z } from "zod";
import OpenAI from "openai";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { recordCreditUsage } from "../../lib/payment-record";

const router = Router();

/* ─── Brand Deal Finder (finder phase) ──────────────────────────────────────
   AI hunts down brand partnership/sponsorship opportunities matched to the
   creator's niche, audience size, and content style. This is the FINDER —
   it surfaces opportunities; it does NOT run a two-sided marketplace
   (brands posting campaigns lives in /sponsors; that's a later phase).
   Pairs with sponsorship-outreach: once a creator picks a brand here, they
   can build a full outreach kit there.
   - POST /api/brand-deals           → 2 credits per search
   - POST /api/brand-deals/outreach  → 1 credit per outreach draft
   Honest framing: the model has no live brand-deals database. It must
   prefer brands with real, public creator programs (affiliate programs,
   ambassador programs, known sponsorship-friendly categories), attach a
   verifyNote to every result, and the frontend carries the disclaimer that
   programs and payouts must be verified on the brand's official pages.
   Never present specifics as verified fact. */

/* 2 credits per finder search — env-overridable without a deploy. One search
   is a single structured GPT-6 Sol completion (a fraction of a cent in
   provider fees), so 2 credits holds a deep margin while staying an impulse
   buy — and honors the standing rule that every AI feature costs a fee. */
export const BRAND_DEAL_CREDIT_COST =
  Number(process.env["BRAND_DEAL_CREDIT_COST"]) || 2;

export const BRAND_DEAL_OUTREACH_CREDIT_COST =
  Number(process.env["BRAND_DEAL_OUTREACH_CREDIT_COST"]) || 1;

const DEAL_TYPES = [
  "sponsored-post",
  "affiliate",
  "ambassadorship",
  "product-gifting",
  "usage-licensing",
] as const;

const DEAL_TYPE_LABEL: Record<(typeof DEAL_TYPES)[number], string> = {
  "sponsored-post": "Sponsored Post",
  affiliate: "Affiliate",
  ambassadorship: "Ambassadorship",
  "product-gifting": "Product Gifting",
  "usage-licensing": "Usage Licensing",
};

const AUDIENCE_SIZES = [
  "under-1k",
  "1k-10k",
  "10k-50k",
  "50k-250k",
  "250k-plus",
] as const;

const AUDIENCE_LABEL: Record<(typeof AUDIENCE_SIZES)[number], string> = {
  "under-1k": "Under 1K followers",
  "1k-10k": "1K – 10K followers",
  "10k-50k": "10K – 50K followers",
  "50k-250k": "50K – 250K followers",
  "250k-plus": "250K+ followers",
};

const finderSchema = z.object({
  niche: z.string().min(1, "Niche is required.").max(100),
  audienceSize: z.enum(AUDIENCE_SIZES),
  platforms: z.array(z.string().max(50)).min(1, "Pick at least one platform.").max(8),
  contentStyle: z.string().min(1, "Content style is required.").max(200),
  dealTypes: z.array(z.enum(DEAL_TYPES)).min(1, "Pick at least one deal type.").max(5).optional().default(["sponsored-post", "affiliate", "ambassadorship"]),
});

const outreachSchema = z.object({
  brand: z.string().min(1, "Brand is required.").max(120),
  dealType: z.string().max(60).optional().default(""),
  creatorName: z.string().min(1, "Creator name is required.").max(100),
  niche: z.string().min(1, "Niche is required.").max(100),
  audienceSize: z.enum(AUDIENCE_SIZES),
  platforms: z.array(z.string().max(50)).min(1).max(8),
  contentStyle: z.string().max(200).optional().default(""),
});

export interface BrandDeal {
  brand: string;
  dealType: string;
  fitScore: number;
  fitReason: string;
  valueRange: string;
  outreachAngle: string;
  verifyNote: string;
}

const VERIFY_DISCLAIMER =
  "Deals are AI-matched from public knowledge as of 2026 — programs, payouts, and eligibility change. Verify every program on the brand's official creator/affiliate pages before you pitch.";

function clampText(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function clampScore(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v)
    ? Math.max(0, Math.min(100, Math.round(v)))
    : 0;
}

function parseDeals(raw: string): BrandDeal[] {
  try {
    const j = JSON.parse(raw) as { deals?: unknown };
    if (!Array.isArray(j.deals)) return [];
    return j.deals
      .filter((d): d is Record<string, unknown> => !!d && typeof d === "object")
      .map((d) => ({
        brand: clampText(d["brand"], 120),
        dealType: clampText(d["dealType"], 60),
        fitScore: clampScore(d["fitScore"]),
        fitReason: clampText(d["fitReason"], 400),
        valueRange: clampText(d["valueRange"], 200),
        outreachAngle: clampText(d["outreachAngle"], 400),
        verifyNote: clampText(d["verifyNote"], 300),
      }))
      .filter((d) => d.brand && d.fitReason && d.outreachAngle)
      .slice(0, 8);
  } catch {
    return [];
  }
}

async function preCharge(
  req: Request,
  cost: number,
  action: string,
  res: Response,
): Promise<number | null> {
  const balance = req.userCredits ?? 0;
  if (balance < cost) {
    res.status(402).json({ error: "out_of_credits", message: "You're out of credits — top up to keep hunting." });
    return null;
  }
  try {
    return await chargeCredits(req.userId!, cost, { action });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "You're out of credits — top up to keep hunting." });
      return null;
    }
    throw err;
  }
}

async function refund(userId: string, cost: number, action: string) {
  try {
    await refundCredits(userId, cost, { action: `${action} — Refund (generation failed)` });
  } catch (refundErr) {
    void refundErr; // logged inside refundCredits; don't mask the original failure
  }
}

/* Text model: centralized in getTextModel() (default gpt-6-sol, env-overridable
   via OPENAI_TEXT_MODEL). Called per-request like every other route —
   do not hardcode model IDs. */

/* POST /api/brand-deals { niche, audienceSize, platforms, contentStyle, dealTypes }
   → 200 { deals[], disclaimer, creditsUsed, creditsRemaining }
   Paid: 2 credits per search. Auth required; credits are deducted BEFORE the
   model call and refunded if generation fails. */
router.post("/brand-deals", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = finderSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid brand deal finder request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const creditsRemaining = await preCharge(req, BRAND_DEAL_CREDIT_COST, "Brand Deal Finder", res);
  if (creditsRemaining === null) return;

  const d = parsed.data;
  const dealTypeLines = d.dealTypes.map((t) => DEAL_TYPE_LABEL[t]).join(", ");

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      max_completion_tokens: 2500,
      response_format: { type: "json_object" },
      temperature: 0.5,
      messages: [
        {
          role: "system",
          content:
            "You are a brand-partnership scout for independent creators. You match creators " +
            "with brand deal opportunities that fit their niche, audience size, and content style. " +
            "You have no live deals database: prefer brands with real, public creator programs " +
            "(affiliate programs, ambassador programs, categories known to sponsor creators like " +
            "music gear, fashion, beverages, tech, beauty). Never invent a specific campaign, " +
            "contact, or guaranteed payout as verified fact — valueRange must be a labeled " +
            "estimate range for their audience tier (e.g. 'roughly $50–$250 per post at this tier — estimate'). " +
            "Every deal gets a verifyNote naming exactly what to check (official affiliate page, " +
            "program terms, minimum follower requirements). The fitReason must tie the brand to " +
            "THIS creator's niche and content style; the outreachAngle is the one-sentence hook " +
            "for why this brand should care. Be realistic about audience size: under-1k creators " +
            "get affiliate and gifting plays, not five-figure ambassadorships. Respond with JSON only.",
        },
        {
          role: "user",
          content:
            `Find brand deal opportunities for this creator.\n` +
            `Niche: ${d.niche.trim()}\n` +
            `Audience: ${AUDIENCE_LABEL[d.audienceSize]}\n` +
            `Platforms: ${d.platforms.join(", ")}\n` +
            `Content style: ${d.contentStyle.trim()}\n` +
            `Deal types wanted: ${dealTypeLines}\n\n` +
            `Return JSON with exactly this shape:\n` +
            `{"deals": [ {"brand": string, "dealType": string (one of: Sponsored Post, Affiliate, Ambassadorship, Product Gifting, Usage Licensing), ` +
            `"fitScore": number (0-100), "fitReason": string (2-3 sentences tying the brand to THIS creator), ` +
            `"valueRange": string (labeled estimate for their tier, e.g. "roughly $X–$Y per post — estimate"), ` +
            `"outreachAngle": string (one-sentence hook for the pitch), ` +
            `"verifyNote": string (exactly what to double-check before pitching)} ]}\n` +
            `Return 5 to 8 deals, ordered by fitScore descending.`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const deals = parseDeals(raw);
    if (deals.length === 0) {
      await refund(req.userId!, BRAND_DEAL_CREDIT_COST, "Brand Deal Finder");
      res.status(502).json({
        error: "generation_failed",
        message: "The scout came back empty — your credits were refunded. Try broadening the filters.",
      });
      return;
    }

    await recordCreditUsage({ userId: req.userId!, action: "Brand Deal Finder", creditsUsed: BRAND_DEAL_CREDIT_COST });
    res.json({
      deals,
      disclaimer: VERIFY_DISCLAIMER,
      creditsUsed: BRAND_DEAL_CREDIT_COST,
      creditsRemaining,
    });
  } catch (err) {
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[brand-deals] OpenAI rate limit / quota");
      res.status(503).json({ error: "The scout is catching its breath — try again in a moment." });
      return;
    }
    await refund(req.userId!, BRAND_DEAL_CREDIT_COST, "Brand Deal Finder");
    logger.error({ err }, "[brand-deals] generation failed, credits refunded");
    res.status(502).json({ error: "The scout hiccupped — credits refunded, try again." });
  }
});

/* POST /api/brand-deals/outreach { brand, dealType, creatorName, niche, audienceSize, platforms, contentStyle }
   → 200 { outreach: { subject, message }, tips[], creditsUsed, creditsRemaining }
   Paid: 1 credit per outreach draft. Auth required; refunded on failure. */
router.post("/brand-deals/outreach", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = outreachSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid outreach request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const creditsRemaining = await preCharge(req, BRAND_DEAL_OUTREACH_CREDIT_COST, "Brand Deal Outreach", res);
  if (creditsRemaining === null) return;

  try {
    const d = parsed.data;
    const dealLine = d.dealType.trim() ? ` (${d.dealType.trim()})` : "";
    const styleLine = d.contentStyle.trim() ? ` Content style: ${d.contentStyle.trim()}.` : "";

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      max_completion_tokens: 1200,
      response_format: { type: "json_object" },
      temperature: 0.6,
      messages: [
        {
          role: "system",
          content:
            "You write brand outreach for independent creators. Sound like a confident peer, " +
            "not a desperate fan. Lead with what the BRAND gets (audience fit, authentic " +
            "integration, content output), keep it specific and short, and end with one clear " +
            "low-friction call to action. Never invent fake metrics, past deals, or follower " +
            "counts. Respond with JSON only.",
        },
        {
          role: "user",
          content:
            `Draft a brand outreach message.\n` +
            `Brand: ${d.brand.trim()}${dealLine}\n` +
            `Creator: ${d.creatorName.trim()} — ${d.niche.trim()} creator, ${AUDIENCE_LABEL[d.audienceSize]} on ${d.platforms.join(", ")}.${styleLine}\n\n` +
            `Return JSON with exactly these keys:\n` +
            `- "subject": string (under 60 chars, curiosity-driven)\n` +
            `- "message": string (under 220 words: hook, why-this-brand, what-they-get, one CTA)\n` +
            `- "tips": array of 3 short strings (personalization tips for this specific brand)`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    let outreach = { subject: "", message: "" };
    let tips: string[] = [];
    try {
      const j = JSON.parse(raw) as Record<string, unknown>;
      outreach = {
        subject: clampText(j["subject"], 120),
        message: clampText(j["message"], 2000),
      };
      if (Array.isArray(j["tips"])) {
        tips = j["tips"]
          .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
          .map((t) => t.trim().slice(0, 200))
          .slice(0, 3);
      }
    } catch {
      /* fall through to the empty check below */
    }
    if (!outreach.subject || !outreach.message) {
      await refund(req.userId!, BRAND_DEAL_OUTREACH_CREDIT_COST, "Brand Deal Outreach");
      res.status(502).json({
        error: "generation_failed",
        message: "The draft came back unusable — your credit was refunded. Try again.",
      });
      return;
    }

    await recordCreditUsage({ userId: req.userId!, action: "Brand Deal Outreach", creditsUsed: BRAND_DEAL_OUTREACH_CREDIT_COST });
    res.json({ outreach, tips, creditsUsed: BRAND_DEAL_OUTREACH_CREDIT_COST, creditsRemaining });
  } catch (err) {
    if (err instanceof OpenAI.APIError && (err.status === 429 || err.code === "insufficient_quota")) {
      logger.warn({ err }, "[brand-deals/outreach] OpenAI rate limit / quota");
      res.status(503).json({ error: "The writer is catching its breath — try again in a moment." });
      return;
    }
    await refund(req.userId!, BRAND_DEAL_OUTREACH_CREDIT_COST, "Brand Deal Outreach");
    logger.error({ err }, "[brand-deals/outreach] generation failed, credits refunded");
    res.status(502).json({ error: "The writer hiccupped — credit refunded, try again." });
  }
});

export default router;
