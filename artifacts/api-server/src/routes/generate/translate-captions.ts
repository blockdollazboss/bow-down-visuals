import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { getTextModel } from "../../lib/ai-clients";

const router = Router();

/* ─── Caption translation ───
   Translates video captions to multiple languages.
   50 Visual Bucs per language. */

const TRANSLATE_COST_PER_LANG = 50;

const SUPPORTED_LANGUAGES = [
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "it", label: "Italian" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
  { code: "ar", label: "Arabic" },
  { code: "hi", label: "Hindi" },
] as const;

const translateSchema = z.object({
  captions: z.array(z.object({
    start: z.number(),
    end: z.number(),
    text: z.string(),
  })).min(1).max(500),
  targetLanguages: z.array(z.string()).min(1).max(10),
});

router.get("/translate-languages", requireAuth, (_req, res) => {
  res.json({ languages: SUPPORTED_LANGUAGES });
});

router.post("/translate-captions", requireAuth, async (req, res) => {
  const parsed = translateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const totalCost = TRANSLATE_COST_PER_LANG * parsed.data.targetLanguages.length;
  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < totalCost) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, totalCost, {
      action: `Caption Translation (${parsed.data.targetLanguages.length} langs)`,
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
    const translations: Record<string, typeof parsed.data.captions> = {};

    // Translate to each language
    await Promise.all(parsed.data.targetLanguages.map(async (langCode) => {
      const lang = SUPPORTED_LANGUAGES.find((l) => l.code === langCode);
      if (!lang) return;

      const texts = parsed.data.captions.map((c) => c.text);
      const prompt =
        `Translate these video captions to ${lang.label}. ` +
        `Keep the same order and formatting. Return ONLY a JSON array of translated strings.\n\n` +
        JSON.stringify(texts);

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
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(120_000),
      });

      if (!response.ok) throw new Error(`Translation to ${lang.label} failed.`);
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("Empty translation.");

      const parsedContent = JSON.parse(content) as { translations?: string[] } | string[];
      const translatedTexts = Array.isArray(parsedContent) ? parsedContent : parsedContent.translations;
      if (!translatedTexts || translatedTexts.length !== texts.length) {
        throw new Error(`Translation count mismatch for ${lang.label}.`);
      }

      translations[langCode] = parsed.data.captions.map((cap, i) => ({
        ...cap,
        text: translatedTexts[i] || cap.text,
      }));
    }));

    res.json({
      translations,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Translation failed.";
    req.log.error({ err: message }, "[translate-captions] failed");
    await refundCredits(req.userId!, totalCost, {
      action: "Caption Translation — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  }
});

export default router;
