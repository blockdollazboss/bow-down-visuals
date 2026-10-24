import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { getTextModel } from "../../lib/ai-clients";

const router = Router();

/* ─── AI social media bio generator ───
   Generates optimized profile bios for Instagram, TikTok, Twitter/X, and
   YouTube from a niche, personality traits, and achievements — each platform
   bio respects that platform's character limit.
   50 Visual Bucs. */

/* 100 VB — the published operator price (owner ruling 2026-10-24: the
   operator list said 100 while this rail's default charged 50; the rail
   aligns to the published price). Env override unchanged. */
export const BIO_COST = Number(process.env["BIO_GENERATOR_CREDITS"]) || 100;

/** Character limits enforced per platform (generous-safe margins). */
export const PLATFORM_LIMITS = {
  instagram: { limit: 150, label: "Instagram" },
  tiktok: { limit: 80, label: "TikTok" },
  twitter: { limit: 160, label: "Twitter/X" },
  youtube: { limit: 400, label: "YouTube" },
} as const;

type PlatformId = keyof typeof PLATFORM_LIMITS;

export const bioSchema = z.object({
  /** Creator's niche / content vertical. */
  niche: z.string().trim().min(2).max(120),
  /** Personality traits / vibe words, e.g. funny, bold, luxury. */
  personality: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
  /** Achievements, stats, or proof points to brag about. */
  achievements: z.array(z.string().trim().min(1).max(120)).max(6).optional().default([]),
  /** Optional call-to-action line (link in bio, booking, etc.). */
  cta: z.string().trim().min(1).max(120).optional(),
  /** Optional name/handle to mention. */
  handle: z.string().trim().min(1).max(60).optional(),
});

export interface PlatformBio {
  platform: string;
  bio: string;
  charCount: number;
  limit: number;
}

router.get("/bio-platforms", requireAuth, (_req, res) => {
  res.json({
    platforms: Object.entries(PLATFORM_LIMITS).map(([id, meta]) => ({
      id,
      label: meta.label,
      charLimit: meta.limit,
    })),
  });
});

export interface BioGenerationResult {
  bios: PlatformBio[];
  creditsRemaining: number;
}

/**
 * The Bio Generator rail's charging core — shared VERBATIM by the website
 * route below and the Public Creator API (POST /api/v1/generate/bio), so
 * both surfaces charge the SAME BIO_COST from this one constant, through
 * the SAME ledger, with the SAME refund-on-failure behaviour. The price
 * is never client-supplied on either surface.
 *
 * Charge discipline (mirrors the operator-hands law):
 * - chargeCredits() lands exactly one ledger row per completed call;
 *   OutOfCreditsError propagates BEFORE any generation runs, so a key
 *   (or click) can never spend past the owner's balance.
 * - Any generation failure refunds in full under "<action> — Refund".
 * - `action` is the ledger label: the website passes "Bio Generator";
 *   the API passes "API: Bio Generator" so every API charge is
 *   identifiable as API-originated in the ledger/activity.
 * - `idempotencyKey`, when given, makes a retried call charge once.
 */
export async function generateBiosForUser(
  userId: string,
  data: z.infer<typeof bioSchema>,
  opts: { action: string; idempotencyKey?: string | null },
): Promise<BioGenerationResult> {
  const creditsAfter = await chargeCredits(userId, BIO_COST, { action: opts.action }, {
    idempotencyKey: opts.idempotencyKey ?? null,
  });

  try {
    const model = getTextModel();
    const { niche, personality, achievements, cta, handle } = data;

    const achievementLine = achievements.length > 0
      ? `Achievements / proof to weave in: ${achievements.join(" \u2022 ")}\n`
      : "";
    const ctaLine = cta ? `Call to action to include where it fits: ${cta}\n` : "";
    const handleLine = handle ? `Handle/name: ${handle}\n` : "";

    const prompt =
      `You are a social media branding expert. Write optimized profile bios for a creator.\n\n` +
      `Niche: ${niche}\n` +
      `Personality: ${personality.join(", ")}\n` +
      `${achievementLine}` +
      `${ctaLine}` +
      `${handleLine}\n` +
      `Write ONE bio per platform, each respecting its hard character limit (including spaces and emojis):\n` +
      `- instagram: max ${PLATFORM_LIMITS.instagram.limit} characters \u2014 punchy, line breaks allowed, 1-2 emojis\n` +
      `- tiktok: max ${PLATFORM_LIMITS.tiktok.limit} characters \u2014 ultra short, hooky, Gen-Z energy\n` +
      `- twitter: max ${PLATFORM_LIMITS.twitter.limit} characters \u2014 witty, keyword-rich\n` +
      `- youtube: max ${PLATFORM_LIMITS.youtube.limit} characters \u2014 slightly longer channel bio, what viewers get\n\n` +
      `Rules:\n` +
      `- Never exceed a platform's character limit \u2014 shorten rather than overflow\n` +
      `- Make each bio distinct; do not copy-paste the same bio across platforms\n` +
      `- No hashtags in bios unless they fit naturally on TikTok/Instagram\n` +
      `- Keep it honest to the niche and achievements provided\n\n` +
      `Return ONLY valid JSON: {"instagram": "...", "tiktok": "...", "twitter": "...", "youtube": "..."}`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.8,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) throw new Error("Bio generation failed.");
    const respData = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = respData.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty bio generation result.");

    const parsedContent = JSON.parse(content) as Record<string, unknown>;

    const bios: PlatformBio[] = (Object.keys(PLATFORM_LIMITS) as PlatformId[]).map((id) => {
      const meta = PLATFORM_LIMITS[id];
      const raw = String(parsedContent[id] ?? "").trim();
      // Hard-enforce the platform limit server-side (trim at a word boundary).
      let bio = raw;
      if (bio.length > meta.limit) {
        const cut = bio.slice(0, meta.limit);
        const lastSpace = cut.lastIndexOf(" ");
        bio = (lastSpace > meta.limit * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
      }
      if (!bio) throw new Error(`No bio was generated for ${meta.label}.`);
      return {
        platform: meta.label,
        bio,
        charCount: bio.length,
        limit: meta.limit,
      };
    });

    return { bios, creditsRemaining: creditsAfter };
  } catch (err) {
    // Failed generations do NOT keep the charge — full refund, exactly as
    // the website rail has always behaved.
    await refundCredits(userId, BIO_COST, {
      action: `${opts.action} \u2014 Refund`,
    }).catch(() => {});
    throw err;
  }
}

router.post("/generate-bio", requireAuth, async (req, res) => {
  const parsed = bioSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < BIO_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  try {
    const { bios, creditsRemaining } = await generateBiosForUser(req.userId!, parsed.data, {
      action: "Bio Generator",
    });
    res.json({
      bios,
      niche: parsed.data.niche,
      creditsRemaining,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    const message = err instanceof Error ? err.message : "Bio generation failed.";
    req.log.error({ err: message }, "[bio-generator] failed");
    res.status(500).json({ error: message });
  }
});

export default router;
