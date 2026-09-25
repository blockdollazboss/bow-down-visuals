import { Router } from "express";
import { z } from "zod";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { recordCreditUsage } from "../../lib/payment-record";

const router = Router();

/* ─── Sponsorship Outreach ────────────────────────────────────────────────
   AI-crafted outreach to brands for sponsorships. Pairs with the Sponsor
   Marketplace (brands list campaigns there; creators pitch them here).
   2 credits per outreach kit. The tracker is free client-side state. */

/* 2 credits per outreach kit — env-overridable without a deploy. One kit is
   a single structured GPT-6 Sol completion (pitch email + DM + media kit +
   follow-ups), a fraction of a cent in provider fees, so 2 credits holds a
   deep margin while staying an impulse buy — and honors the standing rule
   that every AI feature costs a fee. */
export const OUTREACH_CREDIT_COST = Number(process.env["OUTREACH_CREDIT_COST"]) || 2;

export const outreachSchema = z.object({
  /* Creator profile */
  creatorName: z.string().min(1, "Creator name is required.").max(100),
  niche: z.string().min(1, "Niche is required.").max(100),
  audienceSize: z.string().min(1, "Audience size is required.").max(50),
  platforms: z.array(z.string().max(50)).min(1, "Pick at least one platform.").max(8),
  engagement: z.string().max(200).optional().default(""),
  notableWins: z.string().max(500).optional().default(""),
  /* Brand / target */
  brandName: z.string().min(1, "Brand name is required.").max(100),
  product: z.string().max(200).optional().default(""),
  campaignGoal: z.string().max(300).optional().default(""),
  contactName: z.string().max(100).optional().default(""),
});

export type OutreachRequest = z.infer<typeof outreachSchema>;

export interface FollowUp {
  day: number;
  subject: string;
  body: string;
}

export interface OutreachKit {
  pitchEmail: { subject: string; body: string };
  dmVersion: string;
  mediaKitSummary: string;
  followUps: FollowUp[];
  disclaimer: string;
}

const DISCLAIMER =
  "Outreach drafts are a starting point — personalize each one before sending. " +
  "A great pitch opens doors; it doesn't guarantee a deal.";

function clampText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.slice(0, max);
}

function clampFollowUp(value: unknown): FollowUp | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const day = typeof v.day === "number" && Number.isFinite(v.day) ? Math.max(1, Math.min(30, Math.round(v.day))) : null;
  if (day === null) return null;
  return {
    day,
    subject: clampText(v.subject, 200),
    body: clampText(v.body, 2000),
  };
}

/** Parse + sanitize the model's JSON output. Returns null when unusable (triggers refund). */
export function parseOutreachKit(raw: string): OutreachKit | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const o = parsed as Record<string, unknown>;

  const email = o.pitchEmail as Record<string, unknown> | undefined;
  const subject = clampText(email?.subject, 200);
  const body = clampText(email?.body, 4000);
  const dmVersion = clampText(o.dmVersion, 1500);
  const mediaKitSummary = clampText(o.mediaKitSummary, 2000);
  const followUpsRaw = Array.isArray(o.followUps) ? o.followUps : [];
  const followUps = followUpsRaw
    .map(clampFollowUp)
    .filter((f): f is FollowUp => f !== null)
    .slice(0, 3);

  if (!subject || !body || !dmVersion || !mediaKitSummary || followUps.length === 0) {
    return null;
  }
  return {
    pitchEmail: { subject, body },
    dmVersion,
    mediaKitSummary,
    followUps,
    disclaimer: DISCLAIMER,
  };
}

/* POST /api/outreach { creator..., brand... } → 200 { kit, creditsUsed, creditsRemaining }
   Paid: 2 credits per outreach kit. Auth required; credits are deducted BEFORE
   the model call, with automatic refund on provider failure or unusable output. */
router.post("/outreach", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = outreachSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid outreach request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < OUTREACH_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of credits — top up to generate your outreach kit.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, OUTREACH_CREDIT_COST, {
      action: "Sponsorship Outreach Kit",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of credits — top up to generate your outreach kit.",
      });
      return;
    }
    throw err;
  }

  async function refund() {
    try {
      await refundCredits(req.userId!, OUTREACH_CREDIT_COST, {
        action: "Sponsorship Outreach Kit — Refund (generation failed)",
      });
    } catch (refundErr) {
      void refundErr; // logged inside refundCredits; don't mask the original failure
    }
  }

  try {
    const d = parsed.data;
    const contactLine = d.contactName.trim()
      ? ` The contact's name is ${d.contactName.trim()} — address them by name.`
      : "";
    const productLine = d.product.trim() ? ` They're promoting: ${d.product.trim()}.` : "";
    const goalLine = d.campaignGoal.trim() ? ` Their campaign goal: ${d.campaignGoal.trim()}.` : "";
    const engagementLine = d.engagement.trim() ? ` Engagement: ${d.engagement.trim()}.` : "";
    const winsLine = d.notableWins.trim() ? ` Notable wins: ${d.notableWins.trim()}.` : "";

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      max_completion_tokens: 2500,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a sponsorship deal-maker for independent creators. Write outreach that sounds like a confident peer, not a desperate fan. " +
            "Lead with what the BRAND gets (audience fit, authentic integration, content output), keep it specific and short, and always include a clear low-friction call to action. " +
            "Never promise results the creator can't control. Respond with JSON only.",
        },
        {
          role: "user",
          content:
            `Creator: ${d.creatorName.trim()} — ${d.niche.trim()} creator with ${d.audienceSize.trim()} followers across ${d.platforms.join(", ")}.${engagementLine}${winsLine}\n` +
            `Brand: ${d.brandName.trim()}.${productLine}${goalLine}${contactLine}\n\n` +
            `Generate a sponsorship outreach kit as JSON with exactly these keys:\n` +
            `- "pitchEmail": { "subject": string (under 60 chars, curiosity-driven), "body": string (under 250 words: hook, why-this-brand, what-they-get, one CTA) }\n` +
            `- "dmVersion": string (under 100 words, casual DM-style version of the pitch)\n` +
            `- "mediaKitSummary": string (under 150 words: punchy one-paragraph creator bio + audience snapshot a brand can skim)\n` +
            `- "followUps": array of exactly 3 objects, each { "day": number (7, 14, 21), "subject": string, "body": string (under 80 words, polite nudge with new value each time) }`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const kit = parseOutreachKit(raw);
    if (!kit) {
      await refund();
      res.status(502).json({
        error: "generation_failed",
        message: "The outreach kit came back unusable — your credits were refunded. Try again.",
      });
      return;
    }

    await recordCreditUsage({ userId: req.userId!, action: "Sponsorship Outreach Kit", creditsUsed: OUTREACH_CREDIT_COST });
    res.json({ kit, creditsUsed: OUTREACH_CREDIT_COST, creditsRemaining });
  } catch (err) {
    await refund();
    logger.error({ err }, "sponsorship-outreach: generation failed, credits refunded");
    res.status(502).json({
      error: "generation_failed",
      message: "Something went wrong generating your outreach kit — your credits were refunded.",
    });
  }
});

export default router;
