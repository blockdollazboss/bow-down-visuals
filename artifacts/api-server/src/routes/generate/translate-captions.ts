import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  refundCreditsGuaranteed,
  OutOfCreditsError,
  buildChargeIdempotencyKey,
  voidChargeIdempotencyKey,
} from "../../lib/credits";
import { withReplayProtection, ReplayShortCircuit } from "./ca6-replay-guard";
import { getTextModel } from "../../lib/ai-clients";
import {
  DUB_CAPTION_LANGUAGES,
  unsupportedDubCaptionLanguages,
} from "../../lib/dub-caption-languages";

const router = Router();

/* ─── Caption translation ───
   Translates video captions to multiple languages.
   50 Visual Bucs per language. */

const TRANSLATE_COST_PER_LANG = 50;

/** Canonical catalog (lib/dub-caption-languages.ts) — shared with the
 *  video translator + video dub; widened 10 → 15 (adds en/nl/pl/ru/tr).
 *  One list for UI + validation. */
export const SUPPORTED_LANGUAGES = DUB_CAPTION_LANGUAGES.map((l) => ({
  code: l.code,
  label: l.label,
}));

const translateSchema = z.object({
  captions: z.array(z.object({
    start: z.number(),
    end: z.number(),
    text: z.string(),
  })).min(1).max(500),
  targetLanguages: z.array(z.string()).min(1).max(DUB_CAPTION_LANGUAGES.length),
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

  // Validate BEFORE charging: unknown codes used to be silently skipped
  // inside the translation loop after the charge had already landed.
  const unsupported = unsupportedDubCaptionLanguages(parsed.data.targetLanguages);
  if (unsupported.length > 0) {
    res.status(400).json({ error: `Unsupported language(s): ${unsupported.join(", ")}` });
    return;
  }
  // Dedupe so a repeated code is never charged or translated twice.
  const targetLanguages = [...new Set(parsed.data.targetLanguages)];

  const totalCost = TRANSLATE_COST_PER_LANG * targetLanguages.length;

  /* CA-6 replay protection (charge audit B6): server-derived key over
     the caption set + the deduped language set (the price driver); the
     guard's stored-result pre-check runs before the balance gate and
     any funding. A failed translation refunds as before and voids. */
  const idempotencyKey = buildChargeIdempotencyKey("translate-captions", req.userId!, null, {
    captions: parsed.data.captions,
    targetLanguages,
  });

  try {
    const outcome = await withReplayProtection("translate-captions", idempotencyKey, req.userId!, async () => {
  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < totalCost) {
    throw new ReplayShortCircuit(402, {
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, totalCost, {
      action: `Caption Translation (${targetLanguages.length} langs)`,
    }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      throw new ReplayShortCircuit(402, { error: "out_of_credits", message: "Not enough Visual Bucs." });
    }
    throw err;
  }

  try {
    const model = getTextModel();
    const translations: Record<string, typeof parsed.data.captions> = {};

    // Translate to each language
    await Promise.all(targetLanguages.map(async (langCode) => {
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

    return {
      translations,
      creditsRemaining: creditsAfter,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Translation failed.";
    req.log.error({ err: message }, "[translate-captions] failed");
    const refunded = await refundCreditsGuaranteed(req.userId!, totalCost, {
      action: "Caption Translation — Refund",
    });
    /* CA-6: a landed refund voids the key, so the retry re-charges. */
    if (refunded) {
      await voidChargeIdempotencyKey(idempotencyKey).catch(() => false);
    }
    throw err;
  }
    });
    res.json(outcome.replayed ? { ...outcome.body, replayed: true } : outcome.body);
  } catch (err) {
    if (err instanceof ReplayShortCircuit) {
      res.status(err.status).json(err.body);
      return;
    }
    const message = err instanceof Error ? err.message : "Translation failed.";
    res.status(500).json({ error: message });
  }
});

export default router;
