import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";

const router = Router();

/* ─── AI background music ───
   Generates royalty-free background music for videos.
   Specify mood, genre, and duration. Uses the music generation pipeline
   with instrumental-only output optimized for background use.
   400 Visual Bucs. */

const BG_MUSIC_COST = Number(process.env["BG_MUSIC_CREDITS"]) || 400;

const bgMusicSchema = z.object({
  mood: z.string().trim().min(1).max(100),
  genre: z.string().trim().max(100).optional().default("ambient"),
  /** Duration in seconds (15-180) */
  durationSec: z.number().int().min(15).max(180).optional().default(60),
  /** Energy level 1-10 */
  energy: z.number().int().min(1).max(10).optional().default(5),
});

const MOOD_PRESETS = [
  { id: "upbeat", label: "Upbeat", genre: "pop", energy: 8 },
  { id: "chill", label: "Chill", genre: "lo-fi", energy: 3 },
  { id: "epic", label: "Epic", genre: "cinematic", energy: 9 },
  { id: "corporate", label: "Corporate", genre: "ambient", energy: 5 },
  { id: "emotional", label: "Emotional", genre: "piano", energy: 4 },
  { id: "energetic", label: "Energetic", genre: "electronic", energy: 8 },
] as const;

router.get("/bg-music-presets", requireAuth, (_req, res) => {
  res.json({ presets: MOOD_PRESETS });
});

router.post("/bg-music", requireAuth, async (req, res) => {
  const parsed = bgMusicSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < BG_MUSIC_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, BG_MUSIC_COST, {
      action: "Background Music",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  try {
    // Build a music generation prompt optimized for background use
    const { mood, genre, durationSec, energy } = parsed.data;
    const musicPrompt =
      `Instrumental background music, ${genre} style, ${mood} mood. ` +
      `Energy level ${energy}/10. No vocals, no lyrics. ` +
      `Designed to sit under dialogue/narration. ${durationSec} seconds. ` +
      `Royalty-free, clean mix with space for voiceover.`;

    // Call the existing music generation with instrumental settings
    const musicRes = await fetch(
      `${process.env.API_BASE_URL || "http://localhost:3001"}/api/generate-music-audio`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": req.headers.authorization || "",
        },
        body: JSON.stringify({
          prompt: musicPrompt,
          instrumental: true,
          duration: durationSec,
          style: `${genre} background music`,
        }),
        signal: AbortSignal.timeout(300_000),
      }
    );

    if (!musicRes.ok) throw new Error("Music generation failed.");
    const musicData = await musicRes.json() as { url?: string; audioUrl?: string };

    const url = musicData.url || musicData.audioUrl;
    if (!url) throw new Error("No audio URL returned.");

    res.json({
      url,
      mood,
      genre,
      durationSec,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Background music generation failed.";
    req.log.error({ err: message }, "[bg-music] failed");
    await refundCredits(req.userId!, BG_MUSIC_COST, {
      action: "Background Music — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  }
});

export default router;
