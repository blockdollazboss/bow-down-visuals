import { Router } from "express";
import OpenAI from "openai";
import { requireAuth, createUserSupabase } from "../../middlewares/require-auth";

const router = Router();
const openai = new OpenAI({ apiKey: process.env["OPENAI_API_KEY"] });

const CREDIT_COST = 1;
const TOOL_TYPE = "Thumbnail Maker";
const SYSTEM_PROMPT = `You are Bow Down Visuals, a premium AI creative director for music creators.\n\nYou help rappers, singers, producers, AI artists, content creators, and labels create songs, lyrics, music video plans, AI video prompts, promo clip ideas, thumbnails, captions, and release content.\n\nThink like a songwriter, music video director, cinematographer, editor, creative director, and social media strategist.\n\nMake everything original, cinematic, practical, and easy for a music creator to use.\n\nDo not copy real artists' exact songs, lyrics, videos, or celebrity likenesses. Do not include copyrighted logos unless the user says they own them.`;

router.post("/generate-thumbnail", requireAuth, async (req, res) => {
  const { artistName, songTitle, platform, artStyle, colorTheme, mood, featuredText, requests } = req.body as Record<string, string>;

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

  const prompt = `Generate detailed thumbnail and cover art concepts:

Artist: ${artistName}
Song/Video Title: "${songTitle}"
Platform: ${platform}
Art Style: ${artStyle}
Color Theme: ${colorTheme}
Mood: ${mood}
${featuredText ? `Featured Text: "${featuredText}"` : ""}
${requests ? `Special Requests: ${requests}` : ""}

Generate the following sections clearly labeled:

## CONCEPT 1
Write a detailed visual concept including: composition layout, subject placement, background, lighting, color usage, and text treatment. Make it specific enough to brief a designer or use as an AI image prompt.

## CONCEPT 2
Write a second distinct concept with a different approach — different composition, feel, or visual angle.

## CONCEPT 3
Write a third concept that takes a more unexpected or bold creative risk.

## AI IMAGE PROMPTS
Write 3 ready-to-use prompts for AI image generation tools (like Midjourney or DALL-E) — one for each concept above. Be very specific about style, lighting, composition, and mood.

## TYPOGRAPHY RECOMMENDATIONS
Describe the ideal font style, weight, size hierarchy, and placement for the title text "${songTitle}" and artist name "${artistName}".

## DESIGNER BRIEF
Write a concise brief (3-5 bullet points) a freelance designer could use to create this artwork.`;

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

    const title = [artistName, songTitle ? `${songTitle} Thumbnail` : "Thumbnail"].filter(Boolean).join(" — ") || TOOL_TYPE;
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
