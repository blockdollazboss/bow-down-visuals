import { Router } from "express";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { requireAuth } from "../middlewares/require-auth";
import { freeAiLimiter } from "../lib/rate-limit";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
  LedgerWriteError,
  buildChargeIdempotencyKey,
} from "../lib/credits";
import { z } from "zod";

const router = Router();

/* Charged server-side at the price the UI has always displayed for this
   tool (frontend registry: "/api/analyze-sections" → 100 Visual Bucs).
   Until the owner's 2026-10-14 ruling this route called the paid text
   model for free; now it charges exactly the displayed price. */
const ANALYZE_SECTIONS_CREDIT_COST = 100;

const Schema = z.object({
  lyrics: z.string().min(10),
  idempotencyKey: z.string().max(128).optional(),
});

router.post("/analyze-sections", requireAuth, freeAiLimiter, async (req, res) => {
  const parsed = Schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Lyrics (min 10 chars) are required" });
    return;
  }

  const { lyrics } = parsed.data;

  /* Balance fast-fail on the middleware balance (skipped in dev, the
     thumbnail-generator pattern); chargeCredits re-reads the balance
     fresh and is the authoritative check. */
  const isDev = process.env["NODE_ENV"] === "development";
  if (!isDev && (req.userCredits ?? 0) < ANALYZE_SECTIONS_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You are out of Visual Bucs. Buy more Visual Bucs to keep creating.",
      required: ANALYZE_SECTIONS_CREDIT_COST,
    });
    return;
  }

  /* Charge BEFORE the paid provider call, under a stable idempotency
     key for (user, endpoint, request-intent): a double-tap or retry of
     the same analysis can't double-charge. */
  const idempotencyKey = buildChargeIdempotencyKey(
    "analyze-sections",
    req.userId!,
    parsed.data.idempotencyKey,
    { lyrics },
  );
  try {
    await chargeCredits(req.userId!, ANALYZE_SECTIONS_CREDIT_COST, {
      action: "Analyze Song Sections",
    }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You are out of Visual Bucs. Buy more Visual Bucs to keep creating.",
        required: ANALYZE_SECTIONS_CREDIT_COST,
      });
      return;
    }
    if (err instanceof LedgerWriteError) {
      res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed — no Visual Bucs were charged. Please try again." });
      return;
    }
    throw err;
  }

  const userPrompt = `Analyze the following song lyrics and return a JSON object with this EXACT structure. Only include sections that actually exist in the lyrics. If you detect extra sections (Pre-Hook, Verse 3, etc.) add them.

{
  "hasTimestamps": false,
  "sections": [
    { "name": "Intro", "lyrics": "brief excerpt or empty string", "notes": "tone, energy, director note" },
    { "name": "Hook / Chorus", "lyrics": "the hook lyrics", "notes": "energy level, emotional impact" },
    { "name": "Verse 1", "lyrics": "verse 1 excerpt", "notes": "flow, theme, delivery" },
    { "name": "Verse 2", "lyrics": "verse 2 excerpt", "notes": "flow, theme, shift from verse 1" },
    { "name": "Bridge", "lyrics": "bridge lyrics or empty string", "notes": "emotional shift" },
    { "name": "Outro", "lyrics": "outro lyrics or empty string", "notes": "how it closes" }
  ],
  "promo15": {
    "section": "name of the best single 15-second section for a promo clip",
    "reason": "why this 15 seconds has the most replay/hook value"
  },
  "promo30": {
    "section": "best 30-second section or range (e.g. 'Pre-Hook + Hook')",
    "reason": "why this 30 seconds builds and pays off best"
  },
  "videoPacing": "Describe the ideal scene pacing section by section — how fast/slow cuts should be, camera energy per section. 3-5 sentences.",
  "energyMap": "Describe the full emotional energy arc — where it starts, peaks, dips, and lands. Write as a flowing narrative. 3-4 sentences."
}

SONG LYRICS:
${lyrics}

Return ONLY valid JSON. No markdown, no code blocks, no explanation.`;

  try {
    const response = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content: "You are a Grammy-winning music producer and Oscar-caliber music video director who analyzes song structure and pacing. Analyze with chart-topping instincts: map not just sections but the emotional energy arc — find where the goosebumps live, which 15 seconds would own a stadium, and how the pacing should breathe.",
        },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const jsonText = response.choices[0]?.message?.content ?? "{}";
    const analysis = JSON.parse(jsonText) as unknown;
    res.json(analysis);
  } catch (err) {
    req.log.error({ err }, "Section analysis failed");
    /* The provider call failed after the charge — refund with a ledger
       trace (the standard charge-first/refund-on-failure pattern). */
    await refundCredits(req.userId!, ANALYZE_SECTIONS_CREDIT_COST, {
      action: "Analyze Song Sections — Refund (analysis failed)",
    }).catch(() => {});
    res.status(500).json({ error: "Analysis failed" });
  }
});

export default router;
