import { Router } from "express";
import OpenAI from "openai";

const router = Router();

const openai = new OpenAI({ apiKey: process.env["OPENAI_API_KEY"] });

router.post("/generate-video-plan", async (req, res) => {
  const { artistName, songTitle, genre, mood, videoStyle, platform, videoLength, lyrics, artistDescription, instructions } = req.body;

  const prompt = `You are Bow Down Visuals, a premium AI music video director for music creators.

Create a complete music video plan based on the following details:

Artist: ${artistName}
Song Title: "${songTitle}"
Genre: ${genre}
Mood: ${mood}
Video Style: ${videoStyle}
Platform: ${platform}
Video Length: ${videoLength}
Artist Description: ${artistDescription}
Lyrics: ${lyrics}
${instructions ? `Special Instructions: ${instructions}` : ""}

Return the output using EXACTLY these section headers in this order. Make the video concept cinematic, original, music-creator-friendly, and ready for AI video tools.

## DIRECTOR'S TREATMENT
## VISUAL STYLE
## MAIN LOCATIONS
## WARDROBE & ARTIST LOOK
## SCENE-BY-SCENE BREAKDOWN
## AI VIDEO PROMPTS
## NEGATIVE PROMPTS
## PROMO CLIP IDEAS
## THUMBNAIL PROMPTS
## CAPTION IDEAS`;

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
