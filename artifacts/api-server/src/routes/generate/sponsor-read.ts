import { Router } from "express";
import { z } from "zod";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { publicApiLimiter } from "../../lib/rate-limit";
import { logger } from "../../lib/logger";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { recordCreditUsage } from "../../lib/payment-record";

const router = Router();

/* ─── Sponsor Read Generator ──────────────────────────────────────────────
   Writes the actual sponsor read script once a deal is landed — the spoken
   ad-read a creator records into their content. Lives inside the Sponsorship
   Outreach workflow: outreach kit wins the deal, the sponsor read fulfills it.
   100 Visual Bucs per read (env-overridable). */

/* 100 Visual Bucs per sponsor read — env-overridable without a deploy. One
   read is a single structured GPT-6 Sol completion (script + hook + CTA),
   a fraction of a cent in provider fees, so 100 Visual Bucs holds a deep
   margin while staying an impulse buy. */
export const SPONSOR_READ_CREDIT_COST = Number(process.env["SPONSOR_READ_CREDITS"]) || 100;

export const sponsorReadSchema = z.object({
  brandName: z.string().trim().min(1, "Brand name is required.").max(100),
  productDescription: z.string().trim().max(500).optional().default(""),
  readLength: z.enum(["30", "60", "90"], {
    message: "Read length must be one of: 30, 60, 90 (seconds).",
  }),
  tone: z.enum(["energetic", "casual", "luxury", "humorous"], {
    message: "Tone must be one of: energetic, casual, luxury, humorous.",
  }),
  keyPoints: z
    .array(z.string().trim().min(1).max(200))
    .min(1, "Add at least one talking point the sponsor requires.")
    .max(10, "Keep it to 10 talking points or fewer."),
});

export type SponsorReadRequest = z.infer<typeof sponsorReadSchema>;

export interface SponsorRead {
  script: string;
  hookLine: string;
  ctaLine: string;
  estimatedSeconds: number;
}

/* Word targets per read length — spoken English runs ~140-150 wpm in ad reads. */
const WORD_TARGETS: Record<string, { min: number; max: number }> = {
  "30": { min: 60, max: 75 },
  "60": { min: 130, max: 150 },
  "90": { min: 200, max: 225 },
};

function clampText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

/** Parse + sanitize the model's JSON output. Returns null when unusable (triggers refund). */
export function parseSponsorRead(raw: string): SponsorRead | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const o = parsed as Record<string, unknown>;

  const script = clampText(o.script, 3000);
  const hookLine = clampText(o.hookLine, 300);
  const ctaLine = clampText(o.ctaLine, 400);
  if (!script || !hookLine || !ctaLine) return null;

  const wordCount = script.replace(/\[(?:PAUSE|EMPHASIS)\]/gi, "").trim().split(/\s+/).filter(Boolean).length;
  const estimatedSeconds =
    typeof o.estimatedSeconds === "number" && Number.isFinite(o.estimatedSeconds)
      ? Math.max(5, Math.min(180, Math.round(o.estimatedSeconds)))
      : Math.round((wordCount / 145) * 60);

  return { script, hookLine, ctaLine, estimatedSeconds };
}

/* POST /api/sponsor-read { brandName, productDescription?, readLength, tone, keyPoints[] }
   → 200 { read, creditsUsed, creditsRemaining }
   Paid: 100 Visual Bucs per read. Auth required; credits are deducted BEFORE
   the model call, with automatic refund on provider failure or unusable output. */
router.post("/sponsor-read", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = sponsorReadSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid sponsor read request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < SPONSOR_READ_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to generate your sponsor read.",
    });
    return;
  }
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, SPONSOR_READ_CREDIT_COST, {
      action: "Sponsor Read",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You're out of Visual Bucs — top up to generate your sponsor read.",
      });
      return;
    }
    throw err;
  }

  async function refund() {
    try {
      await refundCredits(req.userId!, SPONSOR_READ_CREDIT_COST, {
        action: "Sponsor Read — Refund (generation failed)",
      });
    } catch (refundErr) {
      void refundErr; // logged inside refundCredits; don't mask the original failure
    }
  }

  try {
    const d = parsed.data;
    const seconds = Number(d.readLength);
    const target = WORD_TARGETS[d.readLength] ?? WORD_TARGETS["60"]!;
    const productLine = d.productDescription.trim()
      ? ` Product: ${d.productDescription.trim()}.`
      : "";
    const pointsLine = d.keyPoints.map((p, i) => `${i + 1}. ${p}`).join("\n");

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      max_completion_tokens: 2500,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a direct-response copywriter for creator sponsorships. Write sponsor reads that sound like the creator genuinely uses the product — conversational, specific, and believable, never a corporate press release. " +
            "Weave every required talking point in naturally. Mark delivery beats with a [PAUSE] token where a beat of silence sells the line, and an [EMPHASIS] token right before a word or phrase the creator should stress. " +
            "The hook line must grab attention in the first 3 seconds. The CTA line must be a single clear action (link in description, code, etc.). Respond with JSON only.",
        },
        {
          role: "user",
          content:
            `Brand: ${d.brandName.trim()}.${productLine}\n` +
            `Read length: ${seconds} seconds (target ${target.min}-${target.max} words).\n` +
            `Tone: ${d.tone}.\n` +
            `Required talking points (all must appear in the script):\n${pointsLine}\n\n` +
            `Generate a sponsor read as JSON with exactly these keys:\n` +
            `- "script": string (the full read, ${target.min}-${target.max} words, written as spoken lines; include [PAUSE] and [EMPHASIS] delivery cues where they help; do NOT include the hook line or CTA line separately — weave them in)\n` +
            `- "hookLine": string (the opening attention-grabber, standalone)\n` +
            `- "ctaLine": string (the closing call to action, standalone)\n` +
            `- "estimatedSeconds": number (your honest estimate of the read time at natural ad-read pace)`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "";
    const read = parseSponsorRead(raw);
    if (!read) {
      await refund();
      res.status(502).json({
        error: "generation_failed",
        message: "The sponsor read came back unusable — your Visual Bucs were refunded. Try again.",
      });
      return;
    }

    await recordCreditUsage({ userId: req.userId!, action: "Sponsor Read", creditsUsed: SPONSOR_READ_CREDIT_COST });
    res.json({ read, creditsUsed: SPONSOR_READ_CREDIT_COST, creditsRemaining });
  } catch (err) {
    await refund();
    logger.error({ err }, "sponsor-read: generation failed, Visual Bucs refunded");
    res.status(502).json({
      error: "generation_failed",
      message: "Something went wrong generating your sponsor read — your Visual Bucs were refunded.",
    });
  }
});

export default router;
