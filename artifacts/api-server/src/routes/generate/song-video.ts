import { Router } from "express";
import OpenAI from "openai";
import { requireAuth, createUserSupabase } from "../../middlewares/require-auth";

const router = Router();
const openai = new OpenAI({ apiKey: process.env["OPENAI_API_KEY"] });

const CREDIT_COST = 2;
const TOOL_TYPE = "Make Song + Video";
const SYSTEM_PROMPT = `You are Bow Down Visuals, a premium AI creative director for music creators.\n\nYou help rappers, singers, producers, AI artists, content creators, and labels create songs, lyrics, music video plans, AI video prompts, promo clip ideas, thumbnails, captions, and release content.\n\nThink like a songwriter, music video director, cinematographer, editor, creative director, and social media strategist.\n\nMake everything original, cinematic, practical, and easy for a music creator to use.\n\nDo not copy real artists' exact songs, lyrics, videos, or celebrity likenesses. Do not include copyrighted logos unless the user says they own them.`;

router.post("/generate-song-video", requireAuth, async (req, res) => {
  const { artistName, songTitle, genre, mood, explicit, songTopic, voiceStyle, beatStyle, songLength, videoStyle, platform, videoLength, artistDescription, instructions } = req.body as Record<string, string>;

  const supabase = createUserSupabase(req.accessToken!);

  const { data: profile } = await supabase
    .from("profiles")
    .select("credits")
    .eq("id", req.userId)
    .single();

  if (!profile || profile.credits < CREDIT_COST) {
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
Write a catchy, memorable hook perfect for the genre and mood.

## VERSE 1
Write verse 1 with strong imagery and flow matching the voice style.

## VERSE 2
Write verse 2 building on verse 1 with fresh details.

## AI MUSIC PROMPT
A detailed text prompt for Suno or Udio describing tempo, instruments, production style, vocal style, and energy.

## VIDEO CONCEPT
A 2-3 sentence high-level creative concept for the music video.

## SCENE PROMPTS
Write 4 detailed scene prompts (usable for AI video generation tools) with visual descriptions, color, lighting, and action.

## THUMBNAIL IDEAS
Write 3 specific thumbnail concepts with composition, color palette, text overlay, and mood.

## CAPTIONS
Write 5 platform-ready social media captions (mix of Instagram, TikTok, and Twitter styles).

## PROMO IDEAS
Write 3 creative promo ideas for the release rollout (teasers, countdowns, content ideas).`;

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

    await supabase
      .from("profiles")
      .update({ credits: profile.credits - CREDIT_COST })
      .eq("id", req.userId);

    const title = [artistName, songTitle].filter(Boolean).join(" — ") || TOOL_TYPE;
    const { data: project } = await supabase
      .from("projects")
      .insert({ user_id: req.userId, title, type: TOOL_TYPE, content, credits_used: CREDIT_COST })
      .select("id")
      .single();

    res.json({ result: content, projectId: project?.id, creditsRemaining: profile.credits - CREDIT_COST });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Generation failed";
    res.status(500).json({ error: message });
  }
});

export default router;
