import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { getTextModel } from "../../lib/ai-clients";

const router = Router();

/* ─── AI community post generator ───
   Generates text-first engagement posts for YouTube Community, X, Instagram,
   and Threads from a topic, tone, and optional call-to-action — three
   distinct variants, each hard-capped at the platform's character limit, plus
   an AI best-posting-time suggestion.
   50 Visual Bucs (env-overridable via COMMUNITY_POST_CREDITS). */

const COMMUNITY_POST_COST = Number(process.env["COMMUNITY_POST_CREDITS"]) || 50;

/** Character limits enforced per platform (generous-safe margins). */
const PLATFORM_LIMITS = {
  "youtube-community": { limit: 5000, label: "YouTube Community" },
  x: { limit: 280, label: "X" },
  instagram: { limit: 2200, label: "Instagram" },
  threads: { limit: 500, label: "Threads" },
} as const;

type PlatformId = keyof typeof PLATFORM_LIMITS;

const TONES = [
  "hyped",
  "funny",
  "motivational",
  "chill",
  "luxury",
  "bold",
  "question",
  "story",
] as const;

const communityPostSchema = z.object({
  /** What the post is about (release, poll idea, behind-the-scenes, hot take, ...). */
  topic: z.string().trim().min(2).max(300),
  /** Target platform — drives the character limit and post style. */
  platform: z.enum(Object.keys(PLATFORM_LIMITS) as [PlatformId, ...PlatformId[]]),
  /** Voice of the post. */
  tone: z.enum(TONES).optional().default("hyped"),
  /** Optional call-to-action to weave in (pre-save, vote, comment, ...). */
  cta: z.string().trim().min(1).max(160).optional(),
  /** Optional niche hint so the copy reads native to the audience. */
  niche: z.string().trim().min(1).max(60).optional(),
});

interface PostVariant {
  text: string;
  charCount: number;
  limit: number;
  over: boolean;
}

interface BestPostingTime {
  day: string;
  time: string;
  reason: string;
}

router.get("/community-post-platforms", requireAuth, (_req, res) => {
  res.json({
    platforms: Object.entries(PLATFORM_LIMITS).map(([id, meta]) => ({
      id,
      label: meta.label,
      charLimit: meta.limit,
    })),
    tones: [...TONES],
    cost: COMMUNITY_POST_COST,
  });
});

router.post("/generate-community-post", requireAuth, async (req, res) => {
  const parsed = communityPostSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < COMMUNITY_POST_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, COMMUNITY_POST_COST, {
      action: "Community Post Generator",
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
    const { topic, platform, tone, cta, niche } = parsed.data;
    const meta = PLATFORM_LIMITS[platform];

    const ctaLine = cta ? `Call to action to weave in naturally: ${cta}\n` : "";
    const nicheLine = niche ? `Audience niche: ${niche}\n` : "";

    const prompt =
      `You are a social media copywriter for content creators. Write 3 DISTINCT text-first engagement posts.\n\n` +
      `Topic: ${topic}\n` +
      `Platform: ${meta.label}\n` +
      `Tone: ${tone}\n` +
      `${nicheLine}` +
      `${ctaLine}\n` +
      `Hard rules:\n` +
      `- EVERY post must be at most ${meta.limit} characters (including spaces and emojis) — shorten rather than overflow\n` +
      `- Make the 3 posts genuinely different angles (e.g. question vs. story vs. hype), not rewordings\n` +
      `- No hashtags unless they fit naturally; never more than 3\n` +
      `- Write like a creator talking to their own community, not like a brand\n\n` +
      `Also suggest the single best day + time to post for this platform and a one-sentence reason.\n\n` +
      `Return ONLY valid JSON: {"posts": ["...", "...", "..."], "bestTime": {"day": "...", "time": "...", "reason": "..."}}`;

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
        temperature: 0.85,
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) throw new Error("Community post generation failed.");
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty community post generation result.");

    const parsedContent = JSON.parse(content) as {
      posts?: unknown;
      bestTime?: { day?: unknown; time?: unknown; reason?: unknown };
    };

    const rawPosts = Array.isArray(parsedContent.posts) ? parsedContent.posts : [];
    if (rawPosts.length === 0) throw new Error("No posts were generated.");

    const variants: PostVariant[] = rawPosts.slice(0, 3).map((raw) => {
      // Hard-enforce the platform limit server-side (trim at a word boundary).
      let text = String(raw ?? "").trim();
      if (text.length > meta.limit) {
        const cut = text.slice(0, meta.limit);
        const lastSpace = cut.lastIndexOf(" ");
        text = (lastSpace > meta.limit * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
      }
      if (!text) throw new Error("A generated post came back empty.");
      return {
        text,
        charCount: text.length,
        limit: meta.limit,
        over: false,
      };
    });

    const bt = parsedContent.bestTime ?? {};
    const bestTime: BestPostingTime = {
      day: String(bt.day ?? "").trim() || "—",
      time: String(bt.time ?? "").trim() || "—",
      reason: String(bt.reason ?? "").trim() || "—",
    };

    res.json({
      posts: variants,
      bestTime,
      platform: { id: platform, label: meta.label, charLimit: meta.limit },
      tone,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Community post generation failed.";
    req.log.error({ err: message }, "[community-post] failed");
    await refundCredits(req.userId!, COMMUNITY_POST_COST, {
      action: "Community Post Generator — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  }
});

export default router;
