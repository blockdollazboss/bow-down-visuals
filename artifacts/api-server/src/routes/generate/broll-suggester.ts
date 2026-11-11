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
import {
  findStoredGenerationResult,
  storeGenerationResult,
} from "../../lib/generation-stored-results";

/* CA-1 replay note (CA-KEY wording pattern). */
const BROLL_REPLAY_NOTE =
  "These are the B-roll ideas you already got for this script — change the script for fresh ones.";
import { getTextModel } from "../../lib/ai-clients";

const router = Router();

/* ─── AI B-roll suggester ───
   Takes script/narration text, AI splits it into sections and suggests
   B-roll shots for each: a detailed shot description plus search keywords
   for stock footage sites. 75 Visual Bucs. */

const BROLL_COST = Number(process.env["BROLL_CREDITS"]) || 75;

const brollSchema = z.object({
  /** The narration script to break down. */
  script: z.string().trim().min(20).max(8000),
  /** Max number of B-roll sections to return. */
  maxSections: z.number().int().min(2).max(20).optional().default(10),
});

const brollSuggestionSchema = z.object({
  narration: z.string(),
  brollPrompt: z.string(),
  keywords: z.array(z.string()),
});

router.post("/broll-suggest", requireAuth, async (req, res) => {
  const parsed = brollSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  /* CA-1: server-derived key + stored-result pre-check BEFORE funding. */
  const idempotencyKey = buildChargeIdempotencyKey(
    "broll-suggester", req.userId!, undefined, parsed.data,
  );
  const stored = await findStoredGenerationResult("broll-suggester", idempotencyKey, req.userId!);
  if (stored) {
    res.json({ ...stored, replayed: true, replayNote: BROLL_REPLAY_NOTE });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < BROLL_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, BROLL_COST, {
      action: "B-roll Suggestions",
    }, { idempotencyKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  try {
    const model = getTextModel();
    const prompt =
      `You are a video editor's assistant. Read this narration script and split it into ` +
      `up to ${parsed.data.maxSections} logical sections. For each section, suggest B-roll footage.\n\n` +
      `For every section return:\n` +
      `- "narration": the excerpt of narration covered by this section (keep original wording, max ~30 words)\n` +
      `- "brollPrompt": a vivid, detailed shot description a videographer could film or an AI could generate (1-2 sentences, describe subject, framing, movement, lighting)\n` +
      `- "keywords": 3-5 short search keywords for stock footage sites (e.g. ["city skyline", "aerial drone", "night"])\n\n` +
      `Order sections in script order. Return ONLY valid JSON: ` +
      `{"suggestions": [{"narration": "...", "brollPrompt": "...", "keywords": ["..."]}]}\n\n` +
      `Script:\n${parsed.data.script}`;

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

    if (!response.ok) throw new Error("B-roll analysis failed.");
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("Empty B-roll analysis.");

    const parsedContent = JSON.parse(content) as { suggestions?: unknown[] };
    const suggestions = z.array(brollSuggestionSchema).parse(parsedContent.suggestions ?? []);

    if (suggestions.length === 0) throw new Error("No B-roll suggestions generated.");

    // Estimate a timestamp for each section (~2.5 words/sec narration rate)
    let cursorSec = 0;
    const withTimestamps = suggestions.map((s) => {
      const wordCount = s.narration.split(/\s+/).length;
      const duration = Math.max(2, wordCount / 2.5);
      const timestamp = Math.round(cursorSec * 10) / 10;
      cursorSec += duration;
      return { timestamp, ...s };
    });

    const resultBody = {
      suggestions: withTimestamps,
      count: withTimestamps.length,
      creditsRemaining: creditsAfter,
    };
    await storeGenerationResult("broll-suggester", idempotencyKey, req.userId!, resultBody);
    res.json(resultBody);
  } catch (err) {
    const message = err instanceof Error ? err.message : "B-roll suggestion failed.";
    req.log.error({ err: message }, "[broll-suggest] failed");
    /* CA-1: a landed refund VOIDS the key so the retry charges fresh. */
    await refundCreditsGuaranteed(req.userId!, BROLL_COST, {
      action: "B-roll Suggestions — Refund",
    }, { idempotencyKey: idempotencyKey });
    res.status(500).json({ error: message });
  }
});

export default router;
