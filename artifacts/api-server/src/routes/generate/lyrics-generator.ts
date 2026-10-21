import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";

const router = Router();

/* ─── AI lyrics generator (Suno parity) ───
   Generates full song lyrics from a theme/prompt. 100 Visual Bucs. */

const LYRICS_COST = Number(process.env["LYRICS_GENERATOR_CREDITS"]) || 100;

const lyricsSchema = z.object({
  theme: z.string().trim().min(3).max(500),
  genre: z.string().trim().max(60).optional().default(""),
  mood: z.string().trim().max(60).optional().default(""),
  /** verse-chorus, AABA, etc. */
  structure: z.string().trim().max(60).optional().default("verse-chorus"),
  /** Explicit content filter */
  explicit: z.boolean().optional().default(false),
});

const STRUCTURES: Record<string, string> = {
  "verse-chorus": "Verse 1, Chorus, Verse 2, Chorus, Bridge, Final Chorus",
  "AABA": "A section, A section, B section (bridge), A section",
  "verse-only": "Three verses, no chorus",
  "edm": "Intro, Build, Drop, Breakdown, Build, Drop, Outro",
};

router.post("/generate-lyrics", requireAuth, async (req, res) => {
  const parsed = lyricsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < LYRICS_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, LYRICS_COST, {
      action: "AI Lyrics Generator",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  try {
    const { theme, genre, mood, structure, explicit } = parsed.data;
    const structureDesc = STRUCTURES[structure] ?? STRUCTURES["verse-chorus"];

    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        {
          role: "system",
          content: `You are a professional songwriter. Write complete, original song lyrics. ${explicit ? "" : "Keep it clean — no profanity, no explicit content."} Use vivid imagery, strong rhymes, and memorable hooks. Format with clear section headers like [Verse 1], [Chorus], etc.`,
        },
        {
          role: "user",
          content: `Write song lyrics about: "${theme}"${genre ? `\nGenre: ${genre}` : ""}${mood ? `\nMood: ${mood}` : ""}\nStructure: ${structureDesc}\n\nMake the chorus catchy and repeatable. Keep verses distinct from each other.`,
        },
      ],
      max_completion_tokens: 2000,
      temperature: 0.9,
    });

    const lyrics = completion.choices[0]?.message?.content?.trim();
    if (!lyrics) throw new Error("Lyrics generation returned empty.");

    res.json({
      lyrics,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lyrics generation failed.";
    req.log.error({ err: message }, "[generate-lyrics] failed");
    await refundCredits(req.userId!, LYRICS_COST, {
      action: "AI Lyrics Generator — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  }
});

export default router;
