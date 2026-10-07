import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { getTextModel } from "../../lib/ai-clients";

const router = Router();

/* ─── AI hashtag generator ───
   Generates 20 relevant hashtags optimized for TikTok/Instagram/YouTube,
   grouped by reach: high-reach (broad), medium (community), niche (targeted).
   50 Visual Bucs. */

const HASHTAG_COST = Number(process.env["HASHTAG_CREDITS"]) || 50;

const PLATFORMS = ["tiktok", "instagram", "youtube", "all"] as const;

const hashtagsSchema = z.object({
  topic: z.string().trim().min(2).max(500),
  /** Optional platform focus for platform-specific tags */
  platform: z.enum(PLATFORMS).optional().default("all"),
});

const hashtagsOutputSchema = z.object({
  high: z.array(z.string()),
  medium: z.array(z.string()),
  niche: z.array(z.string()),
});

router.post("/hashtags", requireAuth, async (req, res) => {
  const parsed = hashtagsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < HASHTAG_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, HASHTAG_COST, {
      action: "Hashtag Generator",
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
    const { topic, platform } = parsed.data;

    const platformHint =
      platform === "all"
        ? "for TikTok, Instagram, and YouTube"
        : `optimized for ${platform === "tiktok" ? "TikTok" : platform === "instagram" ? "Instagram" : "YouTube"}`;

    const prompt =
      `Generate exactly 20 hashtags for content about: "${topic}", ${platformHint}.\n\n` +
      `Group them by expected reach:\n` +
      `- "high": 7 broad high-reach hashtags (e.g. #viral #fyp style — huge volume, competitive)\n` +
      `- "medium": 7 community/mid-reach hashtags (active communities, good engagement)\n` +
      `- "niche": 6 niche/targeted hashtags (specific audiences, less competition)\n\n` +
      `Rules: no spaces inside tags, lowercase, no duplicates, no generic off-topic tags.\n` +
      `Return ONLY valid JSON: {"high": [...], "medium": [...], "niche": [...]}`;

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
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) throw new Error("Hashtag generation failed.");
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty hashtag result.");

    const parsedContent = JSON.parse(content) as unknown;
    const grouped = hashtagsOutputSchema.safeParse(parsedContent);
    if (!grouped.success) throw new Error("Invalid hashtag response format.");

    // Sanitize: ensure leading #, lowercase, dedupe
    const clean = (tags: string[]) => {
      const seen = new Set<string>();
      return tags
        .map((t) => {
          const tag = t.trim().toLowerCase().replace(/\s+/g, "");
          return tag.startsWith("#") ? tag : `#${tag}`;
        })
        .filter((t) => t.length > 1 && !seen.has(t) && (seen.add(t), true));
    };

    const hashtags = {
      high: clean(grouped.data.high),
      medium: clean(grouped.data.medium),
      niche: clean(grouped.data.niche),
    };

    res.json({
      hashtags,
      platform,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Hashtag generation failed.";
    req.log.error({ err: message }, "[hashtags] failed");
    await refundCredits(req.userId!, HASHTAG_COST, {
      action: "Hashtag Generator — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  }
});

export default router;
