import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { getTextModel } from "../../lib/ai-clients";

const router = Router();

/* ─── AI clip description generator ───
   Generates an SEO-optimized YouTube description from a video topic + style:
   hook intro, keyword-rich body, chapter timestamps, links section, hashtags.
   50 Visual Bucs. */

const DESCRIPTIONS_COST = Number(process.env["CLIP_DESCRIPTIONS_CREDITS"]) || 50;

const DESCRIPTION_STYLES = [
  { id: "vlog", label: "Vlog", blurb: "Casual, personality-driven narration style" },
  { id: "tutorial", label: "Tutorial", blurb: "Step-by-step, value-first instructional tone" },
  { id: "music-video", label: "Music Video", blurb: "Artist promo with credits and streaming links" },
  { id: "gaming", label: "Gaming", blurb: "Hype, highlights-focused gamer tone" },
  { id: "podcast", label: "Podcast", blurb: "Episode summary with guest/topic highlights" },
  { id: "review", label: "Review", blurb: "Balanced product/content review framing" },
  { id: "shorts", label: "Shorts / Clips", blurb: "Punchy, short-form optimized description" },
] as const;

type DescriptionStyleId = (typeof DESCRIPTION_STYLES)[number]["id"];

const clipDescriptionSchema = z.object({
  /** What the video is about. */
  topic: z.string().trim().min(3).max(500),
  /** Description style — defaults to vlog. */
  style: z
    .string()
    .refine((v): v is DescriptionStyleId => DESCRIPTION_STYLES.some((s) => s.id === v), {
      message: `Style must be one of: ${DESCRIPTION_STYLES.map((s) => s.id).join(", ")}`,
    })
    .optional()
    .default("vlog"),
  /** Approximate video length in seconds — used to space chapter timestamps. */
  videoLengthSec: z.number().int().min(15).max(43200).optional(),
  /** Optional extra keywords to weave in. */
  keywords: z.array(z.string().trim().min(1).max(60)).max(10).optional().default([]),
  /** Optional social/channel links to include in the links section. */
  links: z
    .array(
      z.object({
        label: z.string().trim().min(1).max(80),
        url: z.string().trim().min(1).max(2048),
      })
    )
    .max(10)
    .optional()
    .default([]),
});

interface GeneratedChapter {
  time: string;
  label: string;
}

interface GeneratedDescription {
  hook: string;
  body: string;
  chapters: GeneratedChapter[];
  linksSection: string;
  hashtags: string[];
  /** The full assembled description, ready to paste into YouTube. */
  fullDescription: string;
}

router.get("/clip-description-styles", requireAuth, (_req, res) => {
  res.json({ styles: DESCRIPTION_STYLES });
});

router.post("/clip-description", requireAuth, async (req, res) => {
  const parsed = clipDescriptionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < DESCRIPTIONS_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, DESCRIPTIONS_COST, {
      action: "Clip Description Generator",
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
    const styleMeta = DESCRIPTION_STYLES.find((s) => s.id === parsed.data.style)!;

    const keywordLine = parsed.data.keywords.length > 0
      ? `Target keywords to weave in naturally: ${parsed.data.keywords.join(", ")}\n`
      : "";
    const lengthLine = parsed.data.videoLengthSec
      ? `Video length: ~${parsed.data.videoLengthSec} seconds (space chapter timestamps evenly across it)\n`
      : `Video length unknown — invent 4-6 plausible chapter timestamps for a mid-length video\n`;
    const linksLine = parsed.data.links.length > 0
      ? `Links to include in the links section:\n${parsed.data.links.map((l) => `- ${l.label}: ${l.url}`).join("\n")}\n`
      : `Links section: include labeled placeholder link lines (e.g. Instagram, TikTok, subscribe URL) the creator can fill in\n`;

    const prompt =
      `You are a YouTube SEO expert. Write an SEO-optimized YouTube video description.\n\n` +
      `Topic: ${parsed.data.topic}\n` +
      `Style: ${styleMeta.label} — ${styleMeta.blurb}\n` +
      `${keywordLine}` +
      `${lengthLine}` +
      `${linksLine}\n` +
      `Rules:\n` +
      `- Hook: 1-2 sentences that grab attention and include the main keyword in the first 150 characters\n` +
      `- Body: 2-3 short paragraphs, keyword-rich but natural, written in the ${styleMeta.label} style\n` +
      `- Chapters: 4-8 timestamped chapters in mm:ss format with short labels\n` +
      `- Hashtags: 5-8 relevant hashtags, lowercase, no spaces, leading #\n` +
      `- Never use clickbait lies — stay honest to the topic\n` +
      `- Keep total description under 1500 characters\n\n` +
      `Return ONLY valid JSON in this shape: {"hook": "...", "body": "...", "chapters": [{"time": "00:00", "label": "..."}], "linksSection": "...", "hashtags": ["#example"]}`;

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
      signal: AbortSignal.timeout(120_000),
    });

    if (!response.ok) throw new Error("Description generation failed.");
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty description generation result.");

    const parsedContent = JSON.parse(content) as {
      hook?: string;
      body?: string;
      chapters?: Array<{ time?: string; label?: string }>;
      linksSection?: string;
      hashtags?: string[];
    };

    const hook = String(parsedContent.hook ?? "").trim().slice(0, 400);
    const body = String(parsedContent.body ?? "").trim().slice(0, 2000);
    const chapters: GeneratedChapter[] = (Array.isArray(parsedContent.chapters) ? parsedContent.chapters : [])
      .filter((c) => c && typeof c.label === "string" && c.label.trim().length > 0)
      .slice(0, 10)
      .map((c) => ({
        time: /^\d{1,2}:\d{2}(:\d{2})?$/.test(String(c.time ?? "").trim()) ? String(c.time).trim() : "00:00",
        label: String(c.label).trim().slice(0, 80),
      }));
    const linksSection = String(parsedContent.linksSection ?? "").trim().slice(0, 800);
    const hashtags = (Array.isArray(parsedContent.hashtags) ? parsedContent.hashtags : [])
      .map((h) => String(h).trim().toLowerCase().replace(/\s+/g, ""))
      .map((h) => (h.startsWith("#") ? h : `#${h}`))
      .filter((h) => h.length > 1 && h.length <= 60);
    const dedupedHashtags = [...new Set(hashtags)].slice(0, 10);

    if (!hook || !body) throw new Error("No description was generated.");

    const fullDescription = [
      hook,
      "",
      body,
      "",
      "⏱️ CHAPTERS",
      ...chapters.map((c) => `${c.time} — ${c.label}`),
      "",
      "🔗 LINKS",
      linksSection || "Add your links here",
      "",
      dedupedHashtags.join(" "),
    ]
      .join("\n")
      .trim();

    const result: GeneratedDescription = {
      hook,
      body,
      chapters,
      linksSection,
      hashtags: dedupedHashtags,
      fullDescription,
    };

    res.json({
      description: result,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Description generation failed.";
    req.log.error({ err: message }, "[clip-descriptions] failed");
    await refundCredits(req.userId!, DESCRIPTIONS_COST, {
      action: "Clip Description Generator — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  }
});

export default router;
