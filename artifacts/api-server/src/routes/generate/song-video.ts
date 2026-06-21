import { Router } from "express";
import OpenAI from "openai";
import { requireAuth, supabaseMutate } from "../../middlewares/require-auth";

const router = Router();
const openai = new OpenAI({ apiKey: process.env["OPENAI_API_KEY"] });

const CREDIT_COST = 2;
const TOOL_TYPE = "Make Song + Video";
const SYSTEM_PROMPT = `You are Bow Down Visuals, a premium AI creative director for music creators.\n\nYou help rappers, singers, producers, AI artists, content creators, and labels create songs, lyrics, music video plans, AI video prompts, promo clip ideas, thumbnails, captions, and release content.\n\nThink like a songwriter, music video director, cinematographer, editor, creative director, and social media strategist.\n\nMake everything original, cinematic, practical, and easy for a music creator to use.\n\nDo not copy real artists' exact songs, lyrics, videos, or celebrity likenesses. Do not include copyrighted logos unless the user says they own them.`;

router.post("/generate-song-video", requireAuth, async (req, res) => {
  const { artistName, songTitle, genre, mood, explicit, songTopic, voiceStyle, beatStyle, songLength, videoStyle, platform, videoLength, artistDescription, instructions } = req.body as Record<string, string>;

  const currentCredits = req.userCredits ?? 0;

  if (process.env["NODE_ENV"] === "development") {
    console.log(`[generate-song-video] userId=${req.userId} credits=${currentCredits} required=${CREDIT_COST}`);
  }

  const isDev = process.env["NODE_ENV"] === "development";
  if (!isDev && currentCredits < CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You are out of credits. Join the waitlist or upgrade soon to keep creating.",
    });
    return;
  }

  const prompt = `Generate a complete creative package for a new release:

Artist: ${artistName}
Song Title: "${songTitle}"
Genre: ${genre}
Mood: ${mood}
Content Rating: ${explicit === "explicit" ? "Explicit" : "Clean"}
Song Topic: ${songTopic}
Voice Style: ${voiceStyle}
Beat Style: ${beatStyle}
Song Length: ${songLength}
Video Style: ${videoStyle}
Platform: ${platform}
Video Length: ${videoLength}
Artist Description: ${artistDescription}
${instructions ? `Special Instructions: ${instructions}` : ""}

Generate ALL of the following sections clearly labeled:

## HOOK
## VERSE 1
## VERSE 2
## BRIDGE
## OUTRO
## AI MUSIC PROMPT
## DIRECTOR'S TREATMENT
## SCENE-BY-SCENE BREAKDOWN
## AI VIDEO PROMPTS
## PROMO CLIP IDEAS
## THUMBNAIL PROMPTS
## CAPTION IDEAS`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      max_tokens: 3000,
    });

    const content = completion.choices[0]?.message?.content ?? "";
    const creditsAfter = currentCredits - CREDIT_COST;

    await supabaseMutate(req.accessToken!, "PATCH", "profiles", `id=eq.${req.userId}`, { credits: creditsAfter });

    if (process.env["NODE_ENV"] === "development") {
      console.log(`[generate-song-video] success userId=${req.userId} creditsAfter=${creditsAfter}`);
    }

    const title = [artistName, songTitle].filter(Boolean).join(" — ") || TOOL_TYPE;
    await supabaseMutate(req.accessToken!, "POST", "projects", "", {
      user_id: req.userId,
      title,
      type: TOOL_TYPE,
      content,
      credits_used: CREDIT_COST,
    });

    res.json({ result: content, creditsRemaining: creditsAfter });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Generation failed";
    res.status(500).json({ error: message });
  }
});

export default router;
