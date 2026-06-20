import { Router } from "express";
import OpenAI from "openai";

const router = Router();

const openai = new OpenAI({ apiKey: process.env["OPENAI_API_KEY"] });

router.post("/generate-song", async (req, res) => {
  const { artistName, songTitle, genre, mood, songTopic, explicit, voiceStyle, beatStyle, songLength, instructions } = req.body;

  const prompt = `You are a professional music content creator and ghostwriter. Generate structured song content for the following:

Artist: ${artistName}
Song Title: "${songTitle}"
Genre: ${genre}
Mood: ${mood}
Topic: ${songTopic}
Content Rating: ${explicit === "explicit" ? "Explicit (adult language allowed)" : "Clean (no profanity)"}
Voice Style: ${voiceStyle}
Beat Style: ${beatStyle}
Song Length: ${songLength}
${instructions ? `Special Instructions: ${instructions}` : ""}

Generate the following sections clearly labeled:

## HOOK
Write a catchy, memorable hook that fits the mood and genre.

## VERSE 1
Write verse 1 with strong imagery and flow that matches the voice style.
${songLength === "2 Verses + Hook" || songLength === "Full Song" ? `
## VERSE 2
Write verse 2 that builds on verse 1 with different details.` : ""}
${songLength === "Full Song" ? `
## BRIDGE
Write a bridge that provides emotional contrast or resolution.` : ""}

## AI MUSIC PROMPT
Write a detailed text prompt for an AI music generator (like Suno or Udio) describing the exact sound: tempo, instruments, production style, vocal style, energy level.

## CAPTION IDEAS
Write 3 short social media captions for posting this song (Instagram/TikTok style, under 150 characters each).`;

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
