import { Router } from "express";
import OpenAI from "openai";

const router = Router();

const openai = new OpenAI({ apiKey: process.env["OPENAI_API_KEY"] });

router.post("/generate-song", async (req, res) => {
  const { artistName, songTitle, genre, mood, songTopic, explicit, voiceStyle, beatStyle, songLength, instructions } = req.body;

  const prompt = `You are Bow Down Visuals, a premium AI songwriter and music creator assistant.

Create a complete song package for the user based on the following details:

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

Return the output using EXACTLY these section headers in this order. Make the lyrics match the genre, mood, topic, clean/explicit choice, voice style, beat style, and special instructions.

## SONG CONCEPT
## TITLE IDEAS
## FULL LYRICS
## HOOK
## VERSE 1
## VERSE 2
## BRIDGE
## OUTRO
## AI MUSIC PROMPT
## SUGGESTED BEAT STYLE
## SUGGESTED VOCAL STYLE
## COVER ART PROMPT
## MUSIC VIDEO IDEA`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: `You are Bow Down Visuals, a premium AI creative director for music creators.\n\nYou help rappers, singers, producers, AI artists, content creators, and labels create songs, lyrics, music video plans, AI video prompts, promo clip ideas, thumbnails, captions, and release content.\n\nThink like a songwriter, music video director, cinematographer, editor, creative director, and social media strategist.\n\nMake everything original, cinematic, practical, and easy for a music creator to use.\n\nDo not copy real artists' exact songs, lyrics, videos, or celebrity likenesses. Do not include copyrighted logos unless the user says they own them.` },
        { role: "user", content: prompt },
      ],
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
