import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { getTextModel } from "../../lib/ai-clients";

const router = Router();

/* ─── Thumbnail text optimizer ───
   Generates 10 high-impact thumbnail text options (3 words or fewer)
   from a video topic, each scored 1-10 for curiosity.
   50 Visual Bucs. */

const TEXT_COST = Number(process.env["THUMBNAIL_TEXT_CREDITS"]) || 50;

const TEXT_STYLES = [
  { id: "shock", label: "Shock", blurb: "Bold, visceral reactions (e.g. \"UNBELIEVABLE\", \"I QUIT\")" },
  { id: "curiosity", label: "Curiosity", blurb: "Open loops that demand a click (e.g. \"The TRUTH\", \"Nobody Knows\")" },
  { id: "number", label: "Numbers", blurb: "Specific, punchy figures (e.g. \"$1M in 7 DAYS\")" },
  { id: "command", label: "Command", blurb: "Direct instructions (e.g. \"DO THIS NOW\")" },
  { id: "versus", label: "Versus", blurb: "Comparisons and showdowns (e.g. \"WINNER REVEALED\")" },
] as const;

type TextStyleId = (typeof TEXT_STYLES)[number]["id"];

const thumbnailTextSchema = z.object({
  topic: z.string().trim().min(3).max(500),
  description: z.string().trim().max(2000).optional().default(""),
  /** Subset of style ids to use; defaults to all 5. */
  styles: z
    .array(z.string().refine((v): v is TextStyleId => TEXT_STYLES.some((s) => s.id === v), {
      message: `Style must be one of: ${TEXT_STYLES.map((s) => s.id).join(", ")}`,
    }))
    .min(1)
    .max(5)
    .optional(),
});

interface GeneratedThumbnailText {
  text: string;
  style: TextStyleId;
  curiosityScore: number;
}

router.get("/thumbnail-text-styles", requireAuth, (_req, res) => {
  res.json({ styles: TEXT_STYLES });
});

router.post("/thumbnail-text", requireAuth, async (req, res) => {
  const parsed = thumbnailTextSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < TEXT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, TEXT_COST, {
      action: "Thumbnail Text Optimizer",
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
    const styles: TextStyleId[] =
      parsed.data.styles && parsed.data.styles.length > 0
        ? (parsed.data.styles as TextStyleId[])
        : TEXT_STYLES.map((s) => s.id);

    // 2 options per style → 10 for all 5 styles; scale evenly for subsets.
    const perStyle = Math.max(1, Math.ceil(10 / styles.length));
    const styleList = styles
      .map((s) => {
        const meta = TEXT_STYLES.find((t) => t.id === s)!;
        return `- ${meta.label}: ${meta.blurb}`;
      })
      .join("\n");

    const context = parsed.data.description
      ? `Topic: ${parsed.data.topic}\nDescription: ${parsed.data.description}`
      : `Topic: ${parsed.data.topic}`;

    const prompt =
      `You are a YouTube thumbnail text expert. Write ${perStyle} thumbnail text options ` +
      `for EACH of these styles (${styles.length} styles total, ${perStyle * styles.length} options):\n` +
      `${styleList}\n\n` +
      `${context}\n\n` +
      `Rules:\n` +
      `- 3 WORDS OR FEWER per option — thumbnail text must be readable at a glance\n` +
      `- High impact, emotionally charged, all caps where it adds punch\n` +
      `- No repeating the full video title — complement it, tease it\n` +
      `- Score each option 1-10 for curiosity: would a scroller STOP and click?\n\n` +
      `Return ONLY valid JSON in this shape: {"texts": [{"text": "...", "style": "<style-id>", "curiosityScore": <1-10>}]}`;

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

    if (!response.ok) throw new Error("Thumbnail text generation failed.");
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty thumbnail text result.");

    const parsedContent = JSON.parse(content) as { texts?: GeneratedThumbnailText[] };
    let texts = (parsedContent.texts ?? [])
      .filter((t) => t && typeof t.text === "string" && t.text.trim().length > 0)
      .map((t) => ({
        text: t.text.trim().slice(0, 60),
        style: (TEXT_STYLES.some((s) => s.id === t.style) ? t.style : styles[0]!) as TextStyleId,
        curiosityScore: Math.min(10, Math.max(1, Math.round(Number(t.curiosityScore) || 5))),
      }));

    if (texts.length === 0) throw new Error("No thumbnail texts were generated.");

    // Best first
    texts.sort((a, b) => b.curiosityScore - a.curiosityScore);

    res.json({
      texts,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Thumbnail text generation failed.";
    req.log.error({ err: message }, "[thumbnail-text] failed");
    await refundCredits(req.userId!, TEXT_COST, {
      action: "Thumbnail Text Optimizer — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  }
});

export default router;
