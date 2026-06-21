import { Router } from "express";
import OpenAI from "openai";
import { requireAuth, createUserSupabase } from "../../middlewares/require-auth";

const router = Router();
const openai = new OpenAI({ apiKey: process.env["OPENAI_API_KEY"] });

const CREDIT_COST = 1;
const TOOL_TYPE = "Make a Music Video";
const SYSTEM_PROMPT = `You are Bow Down Visuals, a premium AI creative director for music creators.\n\nYou help rappers, singers, producers, AI artists, content creators, and labels create songs, lyrics, music video plans, AI video prompts, promo clip ideas, thumbnails, captions, and release content.\n\nThink like a songwriter, music video director, cinematographer, editor, creative director, and social media strategist.\n\nMake everything original, cinematic, practical, and easy for a music creator to use.\n\nDo not copy real artists' exact songs, lyrics, videos, or celebrity likenesses. Do not include copyrighted logos unless the user says they own them.`;

router.post("/generate-video-plan", requireAuth, async (req, res) => {
  const { artistName, songTitle, genre, mood, videoStyle, platform, videoLength, lyrics, artistDescription, instructions } = req.body as Record<string, string>;

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

  const prompt = `Create a complete music video plan based on the following details:

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
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      max_tokens: 2000,
    });

    const content = completion.choices[0]?.message?.content ?? "";

    await supabase
      .from("profiles")
      .update({ credits: profile.credits - CREDIT_COST })
      .eq("id", req.userId);

    const title = [artistName, songTitle ? `${songTitle} Video` : "Music Video"].filter(Boolean).join(" — ") || TOOL_TYPE;
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
