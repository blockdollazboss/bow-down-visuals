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

const BIO_COST = Number(process.env["BIO_GENERATOR_CREDITS"]) || 50;

/** Character limits enforced per platform (generous-safe margins). */
const PLATFORM_LIMITS = {
  instagram: { limit: 150, label: "Instagram" },
  tiktok: { limit: 80, label: "TikTok" },
  twitter: { limit: 160, label: "Twitter/X" },
  youtube: { limit: 400, label: "YouTube" },
} as const;

type PlatformId = keyof typeof PLATFORM_LIMITS;

const bioSchema = z.object({
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

interface PlatformBio {
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

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, BIO_COST, {
      action: "Bio Generator",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  try {
    const model = getTextModel();
    const { niche, personality, achievements, cta, handle } = parsed.data;

    const achievementLine = achievements.length > 0
      ? `Achievements / proof to weave in: ${achievements.join(" • ")}\n`
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
      `- instagram: max ${PLATFORM_LIMITS.instagram.limit} characters — punchy, line breaks allowed, 1-2 emojis\n` +
      `- tiktok: max ${PLATFORM_LIMITS.tiktok.limit} characters — ultra short, hooky, Gen-Z energy\n` +
      `- twitter: max ${PLATFORM_LIMITS.twitter.limit} characters — witty, keyword-rich\n` +
      `- youtube: max ${PLATFORM_LIMITS.youtube.limit} characters — slightly longer channel bio, what viewers get\n\n` +
      `Rules:\n` +
      `- Never exceed a platform's character limit — shorten rather than overflow\n` +
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
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
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

    res.json({
      bios,
      niche: parsed.data.niche,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Bio generation failed.";
    req.log.error({ err: message }, "[bio-generator] failed");
    await refundCredits(req.userId!, BIO_COST, {
      action: "Bio Generator — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  }
});

export default router;
