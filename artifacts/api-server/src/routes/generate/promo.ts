import { Router } from "express";
import OpenAI from "openai";

const router = Router();

const openai = new OpenAI({ apiKey: process.env["OPENAI_API_KEY"] });

router.post("/generate-promo-clips", async (req, res) => {
  const { artistName, songTitle, genre, mood, platform, promoGoal, songHook, instructions } = req.body as Record<string, string>;

  const prompt = `You are a music marketing strategist and social media expert for independent artists. Create a complete promo content plan for a music release:

Artist: ${artistName}
Song/Project Title: "${songTitle}"
Genre: ${genre}
Mood: ${mood}
Platform: ${platform}
Promo Goal: ${promoGoal}
Song Hook / Best Bar: "${songHook}"
${instructions ? `Additional Notes: ${instructions}` : ""}

Generate the following sections clearly labeled:

## PROMO CONCEPT
Write a 2-sentence overarching promo campaign concept that captures the energy and message.

## TIKTOK IDEAS
Write 3 specific TikTok video concepts — include hook, action, and audio cue for each.

## REEL CONCEPTS
Write 3 Instagram Reel concepts — include visual direction, text overlay, and mood for each.

## YOUTUBE SHORTS
Write 2 YouTube Shorts ideas — include topic, hook line, and format.

## HOOK CLIPS
Write 3 hook-focused short clip ideas using the song hook: "${songHook || "the best bar"}". Make them viral-optimized.

## CAPTION PACK
Write 5 platform-ready captions (mix of Instagram, TikTok, Twitter) for release day and rollout.

## HASHTAG STRATEGY
List 10 targeted hashtags categorized as: brand tags, genre tags, and trending tags.

## POSTING STRATEGY
Write a 7-day posting schedule with specific content ideas for each day around the release.

## CALL-TO-ACTION IDEAS
Write 5 different CTAs optimized for streams, follows, and shares.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2500,
    });

    const content = completion.choices[0]?.message?.content ?? "";
    res.json({ result: content });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Generation failed";
    res.status(500).json({ error: message });
  }
});

export default router;
