import { Router } from "express";
import OpenAI from "openai";

const router = Router();

const openai = new OpenAI({ apiKey: process.env["OPENAI_API_KEY"] });

router.post("/generate-video-plan", async (req, res) => {
  const { artistName, songTitle, genre, mood, videoStyle, platform, videoLength, lyrics, artistDescription, instructions } = req.body;

  const prompt = `You are a professional music video director and creative director. Create a detailed music video treatment for the following:

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

Generate the following sections clearly labeled:

## VIDEO CONCEPT
Write a 2-3 sentence high-level creative concept that captures the essence of the video.

## VISUAL TONE & AESTHETIC
Describe the color palette, lighting, camera style, and overall cinematic feel.

## SCENE-BY-SCENE BREAKDOWN
Write 4-6 detailed scene descriptions. For each scene include: location, action, camera angles, and how it connects to the lyrics.

## WARDROBE & STYLING
Describe the artist's look, wardrobe, and styling choices for each scene.

## LOCATION SUGGESTIONS
List 3-4 specific location ideas with brief descriptions of why they work for this concept.

## DIRECTOR'S NOTES
Write key creative notes a director should keep in mind to nail this video.`;

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
