import { Router } from "express";
import OpenAI from "openai";
import { requireAuth } from "../../middlewares/require-auth";

const router = Router();
const openai = new OpenAI({ apiKey: process.env["OPENAI_API_KEY"] });

const CREDIT_COST = 1;

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

type VaultData = Record<string, string | null | undefined>;

function buildVaultContext(vault: VaultData | null | undefined): string {
  if (!vault) return "";
  const lines: string[] = [
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "ARTIST VAULT — BRAND STYLE RULES",
    "Apply ALL of the following to every section of your output.",
    "This artist's outputs must match their established brand identity.",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
  ];
  if (vault["artistType"]) lines.push(`Artist Type: ${vault["artistType"]}`);
  if (vault["artistDescription"]) lines.push(`Artist Description: ${vault["artistDescription"]}`);
  if (vault["visualStyle"]) lines.push(`Visual Style: ${vault["visualStyle"]}`);
  if (vault["hair"]) lines.push(`Hair: ${vault["hair"]}`);
  if (vault["tattoos"]) lines.push(`Tattoos: ${vault["tattoos"]}`);
  if (vault["jewelry"]) lines.push(`Jewelry: ${vault["jewelry"]}`);
  if (vault["clothingStyle"]) lines.push(`Clothing Style: ${vault["clothingStyle"]}`);
  if (vault["brandColors"]) lines.push(`Brand Colors: ${vault["brandColors"]}`);
  if (vault["logoDescription"]) lines.push(`Logo Description: ${vault["logoDescription"]}`);
  if (vault["imageReferenceNotes"]) lines.push(`Image Reference Notes: ${vault["imageReferenceNotes"]}`);
  if (vault["doNotChangeRules"]) {
    lines.push("", `⛔ DO NOT CHANGE RULES — NEVER VIOLATE THESE:\n${vault["doNotChangeRules"]}`);
  }
  if (vault["specialStyleRules"]) {
    lines.push("", `✅ SPECIAL STYLE RULES — ALWAYS APPLY THESE:\n${vault["specialStyleRules"]}`);
  }
  return lines.join("\n");
}

router.post("/generate-video-plan", requireAuth, async (req, res) => {
  const {
    artistName, songTitle, genre, mood, videoStyle,
    platform, videoLength, lyrics, artistDescription, instructions,
  } = req.body as Record<string, string>;

  const artistVault = req.body.artistVault as VaultData | null | undefined;

  const currentCredits = req.userCredits ?? 0;

  if (process.env["NODE_ENV"] === "development") {
    console.log(`[generate-video-plan] userId=${req.userId} credits=${currentCredits} required=${CREDIT_COST}`);
  }

  const isDev = process.env["NODE_ENV"] === "development";
  if (!isDev && currentCredits < CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You are out of credits. Join the waitlist or upgrade soon to keep creating.",
    });
    return;
  }

  const prompt = `Create a complete, cinematic music video package for the following release. Make every scene vivid, production-ready, and usable in AI video tools.

BOW DOWN VISUALS — CREATOR PACKAGE

Artist: ${artistName || "Unknown Artist"}
Song Title: "${songTitle || "Untitled"}"
Genre: ${genre || "Hip Hop"}
Mood: ${mood || "Dark"}
Video Style: ${videoStyle || "Cinematic"}
Platform: ${platform || "YouTube"}
Video Length: ${videoLength || "Not specified"}
Artist Description: ${artistDescription}
${lyrics ? `Lyrics / Key Lines:\n${lyrics}` : ""}
${instructions ? `Special Instructions: ${instructions}` : ""}
${buildVaultContext(artistVault)}

Return the output using EXACTLY these ## section headers in this order. Write full, director-level content for every section.

## DIRECTOR'S TREATMENT
Write a full director's statement: the overarching creative vision, tone, narrative arc, and emotional journey of this video. What is the video really about beneath the visuals?

## VISUAL CONCEPT
Describe the complete visual world: aesthetic references (described generically), color story, texture, era, atmosphere, and how the visuals serve the music.

## COLOR PALETTE
List the exact color palette: primary, secondary, and accent colors with hex codes or descriptive names. Describe how lighting shifts across the video.

## MAIN LOCATIONS
List 3–5 primary shooting locations with detailed descriptions. For each: interior/exterior, time of day, lighting conditions, mood, and why it fits the song.

## WARDROBE & ARTIST LOOK
Describe the artist's wardrobe in full detail for each location or scene change: clothing, accessories, footwear, hair, and overall visual brand impact.

## SCENE-BY-SCENE BREAKDOWN
Write a detailed breakdown of every scene. For each scene include ALL of the following on separate labeled lines:
- Timestamp: (e.g. 0:00–0:15)
- Section: (e.g. Intro, Verse 1, Hook)
- Lyric/Line: (the lyric or moment this scene covers)
- Location: (specific setting)
- Action: (what the artist and any other subjects are doing)
- Camera Movement: (e.g. slow push in, handheld tracking shot, aerial drone pull-back)
- Lighting: (describe the lighting setup and quality)
- Mood: (emotional tone of this scene)
- AI Video Prompt: (ready-to-paste prompt for Runway, Sora, Kling, or Pika)
- Negative Prompt: (what to exclude from this scene)

## CAMERA DIRECTIONS
Write an overall camera direction guide: lens choices, shot types used throughout, camera movement philosophy, and any signature visual techniques.

## AI VIDEO PROMPTS
Write 5 standalone, ready-to-paste AI video generation prompts for key scenes. Each prompt should be self-contained and highly detailed (subject, action, location, lighting, camera, mood, style, negative elements).

## NEGATIVE PROMPTS
Write a master negative prompt list for this video — everything to exclude across all AI generations (bad quality markers, unwanted elements, style conflicts).

## THUMBNAIL PROMPTS
Write 3 AI image prompts for video thumbnail options. Include: composition, subject pose, background, lighting, text treatment, and platform optimization notes (YouTube vs. Instagram vs. TikTok).

## PROMO CLIP IDEAS
Describe 5 specific short-form promo clip ideas cut from this video. For each: which scene to use, how to frame it, what on-screen text to add, and which platform it's best for.

## CAPTION IDEAS
Write 5 ready-to-post social media captions for promoting this video. Mix hype, story, and CTA styles.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      max_tokens: 4000,
    });

    const content = completion.choices[0]?.message?.content ?? "";
    const creditsAfter = currentCredits - CREDIT_COST;

    await req.userSupabase!.from("profiles").update({ credits: creditsAfter }).eq("id", req.userId!);

    if (process.env["NODE_ENV"] === "development") {
      console.log(`[generate-video-plan] success userId=${req.userId} creditsAfter=${creditsAfter}`);
    }

    res.json({ result: content, creditsRemaining: creditsAfter });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Generation failed";
    res.status(500).json({ error: message });
  }
});

export default router;
