import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { getTextModel } from "../../lib/ai-clients";

const router = Router();

/* ─── AI video title generator ───
   Generates 10 click-worthy YouTube titles from a video topic/description,
   across 5 proven styles: curiosity gap, numbers, how-to, bold claim, question.
   Each title gets a predicted CTR score (1-10).
   50 Visual Bucs. */

const TITLES_COST = Number(process.env["VIDEO_TITLES_CREDITS"]) || 50;

const TITLE_STYLES = [
  { id: "curiosity-gap", label: "Curiosity Gap", blurb: "Teases the payoff without revealing it" },
  { id: "numbers", label: "Numbers / Lists", blurb: "Specific numbers that promise value" },
  { id: "how-to", label: "How-To", blurb: "Clear outcome-driven tutorials" },
  { id: "bold-claim", label: "Bold Claim", blurb: "Confident statements that spark debate" },
  { id: "question", label: "Question", blurb: "Opens a loop the viewer must close" },
] as const;

type TitleStyleId = (typeof TITLE_STYLES)[number]["id"];

const titlesSchema = z.object({
  topic: z.string().trim().min(3).max(500),
  description: z.string().trim().max(2000).optional().default(""),
  /** Subset of style ids to use; defaults to all 5. */
  styles: z
    .array(z.string().refine((v): v is TitleStyleId => TITLE_STYLES.some((s) => s.id === v), {
      message: `Style must be one of: ${TITLE_STYLES.map((s) => s.id).join(", ")}`,
    }))
    .min(1)
    .max(5)
    .optional(),
});

interface GeneratedTitle {
  title: string;
  style: TitleStyleId;
  ctrScore: number;
}

router.get("/video-title-styles", requireAuth, (_req, res) => {
  res.json({ styles: TITLE_STYLES });
});

router.post("/video-titles", requireAuth, async (req, res) => {
  const parsed = titlesSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < TITLES_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, TITLES_COST, {
      action: "Video Title Generator",
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
    const styles: TitleStyleId[] =
      parsed.data.styles && parsed.data.styles.length > 0
        ? (parsed.data.styles as TitleStyleId[])
        : TITLE_STYLES.map((s) => s.id);

    // 2 titles per style → 10 titles for all 5 styles; scale evenly for subsets.
    const perStyle = Math.max(1, Math.ceil(10 / styles.length));
    const styleList = styles
      .map((s) => {
        const meta = TITLE_STYLES.find((t) => t.id === s)!;
        return `- ${meta.label}: ${meta.blurb}`;
      })
      .join("\n");

    const context = parsed.data.description
      ? `Topic: ${parsed.data.topic}\nDescription: ${parsed.data.description}`
      : `Topic: ${parsed.data.topic}`;

    const prompt =
      `You are a YouTube title expert. Write ${perStyle} click-worthy YouTube titles ` +
      `for EACH of these styles (${styles.length} styles total, ${perStyle * styles.length} titles):\n` +
      `${styleList}\n\n` +
      `${context}\n\n` +
      `Rules:\n` +
      `- Under 60 characters each\n` +
      `- No clickbait lies — titles must stay honest to the topic\n` +
      `- No ALL CAPS words\n` +
      `- Score each title 1-10 for predicted CTR based on curiosity, specificity, and emotional pull\n\n` +
      `Return ONLY valid JSON in this shape: {"titles": [{"title": "...", "style": "<style-id>", "ctrScore": <1-10>}]}`;

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

    if (!response.ok) throw new Error("Title generation failed.");
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty title generation result.");

    const parsedContent = JSON.parse(content) as { titles?: GeneratedTitle[] };
    let titles = (parsedContent.titles ?? [])
      .filter((t) => t && typeof t.title === "string" && t.title.trim().length > 0)
      .map((t) => ({
        title: t.title.trim().slice(0, 100),
        style: (TITLE_STYLES.some((s) => s.id === t.style) ? t.style : styles[0]!) as TitleStyleId,
        ctrScore: Math.min(10, Math.max(1, Math.round(Number(t.ctrScore) || 5))),
      }));

    if (titles.length === 0) throw new Error("No titles were generated.");

    // Best first
    titles.sort((a, b) => b.ctrScore - a.ctrScore);

    res.json({
      titles,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Title generation failed.";
    req.log.error({ err: message }, "[video-titles] failed");
    await refundCredits(req.userId!, TITLES_COST, {
      action: "Video Title Generator — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  }
});

export default router;
