import { Router } from "express";
import OpenAI from "openai";

const router = Router();

const openai = new OpenAI({ apiKey: process.env["OPENAI_API_KEY"] });

router.post("/generate-promo", async (req, res) => {
  const { artistName, songTitle, releaseDate, platform, vibe, keyMessage, notes } = req.body;

  const prompt = `You are a music marketing strategist and social media expert. Create a promo content plan for a music release:

Artist: ${artistName}
Song/Project Title: "${songTitle}"
Release Date: ${releaseDate}
Platform: ${platform}
Vibe/Energy: ${vibe}
Key Message: ${keyMessage}
${notes ? `Additional Notes: ${notes}` : ""}

Generate the following sections clearly labeled:

## PROMO CONCEPT
Write a 2-sentence overarching promo campaign concept that captures the energy and message.

## TEASER CAPTIONS (5)
Write 5 different short, punchy captions (under 150 chars each) for pre-release teasers. Include relevant hashtag suggestions.

## COUNTDOWN CONTENT
Write a 3-day countdown plan with specific content ideas for each day leading up to release.

## STORY/REEL SCRIPT
Write a short 15-30 second script for a Story or Reel teaser — include action directions and text overlays.

## PRESS & BIO QUOTE
Write a compelling one-sentence quote from the artist about this release (for press and bio links).

## HASHTAG STRATEGY
List 10 targeted hashtags to use across posts, categorized by: brand tags, genre tags, and trending tags.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2000,
    });

    const content = completion.choices[0]?.message?.content ?? "";
    res.json({ result: content });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Generation failed";
    res.status(500).json({ error: message });
  }
});

export default router;
