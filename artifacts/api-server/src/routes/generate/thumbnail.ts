import { Router } from "express";
import OpenAI from "openai";
import { requireAuth } from "../../middlewares/require-auth";

const router = Router();
const openai = new OpenAI({ apiKey: process.env["OPENAI_API_KEY"] });

const CREDIT_COST = 1;
const TOOL_TYPE = "Thumbnail Maker";
const SYSTEM_PROMPT = `You are Bow Down Visuals, a premium AI creative director for music creators.\n\nYou help rappers, singers, producers, AI artists, content creators, and labels create songs, lyrics, music video plans, AI video prompts, promo clip ideas, thumbnails, captions, and release content.\n\nThink like a songwriter, music video director, cinematographer, editor, creative director, and social media strategist.\n\nMake everything original, cinematic, practical, and easy for a music creator to use.\n\nDo not copy real artists' exact songs, lyrics, videos, or celebrity likenesses. Do not include copyrighted logos unless the user says they own them.`;

router.post("/generate-thumbnail", requireAuth, async (req, res) => {
  const { artistName, songTitle, platform, artStyle, colorTheme, mood, featuredText, requests } = req.body as Record<string, string>;

  const currentCredits = req.userCredits ?? 0;

  if (process.env["NODE_ENV"] === "development") {
    console.log(`[generate-thumbnail] userId=${req.userId} credits=${currentCredits} required=${CREDIT_COST}`);
  }

  const isDev = process.env["NODE_ENV"] === "development";
  if (!isDev && currentCredits < CREDIT_COST) {
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
Featured Text: ${featuredText}
${requests ? `Special Requests: ${requests}` : ""}

Return the output using EXACTLY these section headers:

## THUMBNAIL CONCEPT
## LAYOUT & COMPOSITION
## COLOR PALETTE
## TYPOGRAPHY
## BACKGROUND DESIGN
## FOREGROUND ELEMENTS
## AI IMAGE PROMPT
## VARIATION IDEAS`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      max_tokens: 1500,
    });

    const content = completion.choices[0]?.message?.content ?? "";
    const creditsAfter = currentCredits - CREDIT_COST;

    await req.userSupabase!.from("profiles").update({ credits: creditsAfter }).eq("id", req.userId!);

    if (process.env["NODE_ENV"] === "development") {
      console.log(`[generate-thumbnail] success userId=${req.userId} creditsAfter=${creditsAfter}`);
    }

    const title = [artistName, songTitle ? `${songTitle} Thumbnail` : "Thumbnail"].filter(Boolean).join(" — ") || TOOL_TYPE;
    await req.userSupabase!.from("projects").insert({
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
