import { Router } from "express";
import OpenAI from "openai";
import { requireAuth } from "../../middlewares/require-auth";

const router = Router();
const openai = new OpenAI({ apiKey: process.env["OPENAI_API_KEY"] });

const CREDIT_COST = 1;
const TOOL_TYPE = "Promo Clip Maker";

const SYSTEM_PROMPT = `You are Bow Down Visuals, a premium AI creative director for music creators.

You help rappers, singers, producers, AI artists, content creators, and labels create professional songs, hooks, lyrics, music video plans, AI video prompts, thumbnails, captions, and promo campaigns.

Think like:
- a hit songwriter
- a music video director
- a cinematographer
- a social media strategist
- a creative director
- a release rollout planner

Make everything:
- original
- catchy
- cinematic
- commercially usable
- clear
- structured
- premium
- easy to copy into AI music/video tools

Do not copy real artists' exact lyrics, songs, videos, or celebrity likenesses.
Do not include copyrighted logos unless the user says they own them.
Do not mention copyrighted brands unless the user specifically provides them.`;

router.post("/generate-promo-clips", requireAuth, async (req, res) => {
  const {
    artistName, songTitle, genre, mood, platform, promoGoal, songHook, instructions,
  } = req.body as Record<string, string>;

  const currentCredits = req.userCredits ?? 0;

  if (process.env["NODE_ENV"] === "development") {
    console.log(`[generate-promo-clips] userId=${req.userId} credits=${currentCredits} required=${CREDIT_COST}`);
  }

  const isDev = process.env["NODE_ENV"] === "development";
  if (!isDev && currentCredits < CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You are out of credits. Join the waitlist or upgrade soon to keep creating.",
    });
    return;
  }

  const prompt = `Create a complete, platform-ready promo content pack for the following music release. Make every idea specific, scroll-stopping, and immediately actionable.

BOW DOWN VISUALS — CREATOR PACKAGE

Artist: ${artistName || "Unknown Artist"}
Song / Project Title: "${songTitle || "Untitled"}"
Genre: ${genre || "Hip Hop"}
Mood: ${mood || "Dark"}
Primary Platform: ${platform || "TikTok"}
Promo Goal: ${promoGoal || "Drive streams"}
Song Hook / Key Lyric: ${songHook}
${instructions ? `Special Instructions: ${instructions}` : ""}

Return the output using EXACTLY these ## section headers in this order. Make every idea platform-specific, creative, and ready to execute.

## TIKTOK IDEAS
Write 3 TikTok promo clip concepts. For each: the clip concept, what the artist does on screen, the hook lyric to use, on-screen text, trending audio angle, and estimated duration.

## INSTAGRAM REEL IDEAS
Write 3 Instagram Reel concepts. For each: the visual setup, the lyric or moment to highlight, on-screen text treatment, caption hook, and reel duration.

## YOUTUBE SHORT IDEAS
Write 3 YouTube Shorts concepts. For each: the concept, what happens in the first 3 seconds (the hook), on-screen text, end screen CTA, and length.

## HOOK CLIP CONCEPTS
Write 3 short-form clip ideas built entirely around the hook of the song. These should be designed to make the hook go viral. Include: visual concept, on-screen treatment, caption angle, and which platforms to post on.

## BEST-BAR CLIP CONCEPTS
Write 3 clip ideas that highlight the best lyric or punchline in the song. Include: the specific bar, visual treatment, text style (bold, animated, etc.), and platform.

## ON-SCREEN TEXT
Write 10 ready-to-use on-screen text options for clips: 5 lyric-based and 5 artist-brand/hype statements. Keep them punchy, short, and scroll-stopping.

## CAPTION IDEAS
Write 8 ready-to-post social media captions — include hype captions, storytelling captions, question-based engagement captions, and out-now announcement captions.

## HASHTAGS
Write 3 hashtag sets:
- Set 1: Genre/niche hashtags (10 tags)
- Set 2: Trending/broad reach hashtags (10 tags)
- Set 3: Artist branding hashtags (5 custom tags the artist should own)

## POSTING STRATEGY
Write a 7-day posting schedule for this release: what to post each day, which platform, what format (clip, image, story, reel), and the goal of each post.

## CALL-TO-ACTION IDEAS
Write 10 CTAs ready to add to clips and captions. Mix stream CTAs, follow CTAs, share CTAs, comment CTAs, and playlist-add CTAs.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      max_tokens: 3500,
    });

    const content = completion.choices[0]?.message?.content ?? "";
    const creditsAfter = currentCredits - CREDIT_COST;

    await req.userSupabase!.from("profiles").update({ credits: creditsAfter }).eq("id", req.userId!);

    if (process.env["NODE_ENV"] === "development") {
      console.log(`[generate-promo-clips] success userId=${req.userId} creditsAfter=${creditsAfter}`);
    }

    res.json({ result: content, creditsRemaining: creditsAfter });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Generation failed";
    res.status(500).json({ error: message });
  }
});

export default router;
