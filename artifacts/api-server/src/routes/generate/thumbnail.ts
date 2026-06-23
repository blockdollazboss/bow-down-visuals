import { Router } from "express";
import OpenAI from "openai";
import { requireAuth } from "../../middlewares/require-auth";
import { recordCreditUsage } from "../../lib/payment-record";

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

router.post("/generate-thumbnail", requireAuth, async (req, res) => {
  const {
    artistName, songTitle, platform, artStyle, colorTheme, mood, featuredText, specialRequests,
  } = req.body as Record<string, string>;

  const artistVault = req.body.artistVault as VaultData | null | undefined;

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

  const prompt = `Create a complete, premium thumbnail and cover art package for the following release. Every prompt must be specific enough to paste directly into Midjourney, DALL-E, Stable Diffusion, or Ideogram.

BOW DOWN VISUALS — CREATOR PACKAGE

Artist: ${artistName || "Unknown Artist"}
Song / Video Title: "${songTitle || "Untitled"}"
Platform: ${platform || "YouTube"}
Art Style: ${artStyle || "Cinematic"}
Color Theme: ${colorTheme || "Black and gold"}
Mood: ${mood || "Dark"}
Featured Text: ${featuredText || "None"}
${specialRequests ? `Special Requests: ${specialRequests}` : ""}
${buildVaultContext(artistVault)}

Return the output using EXACTLY these ## section headers in this order. Write detailed, actionable, AI-ready content for every section.

## THUMBNAIL CONCEPT
Describe the complete thumbnail concept: what the viewer sees, the emotional impact, why it stops the scroll, and how it represents the artist and song.

## COVER ART CONCEPT
Describe the album/single cover art concept: visual story, composition, symbolism, and how it stands out in a music streaming context (Spotify, Apple Music, etc.).

## MAIN IMAGE PROMPT
Write the primary AI image generation prompt. Include: subject description, pose, expression, clothing, setting/background, lighting, camera angle, color palette, art style, quality modifiers, and aspect ratio recommendation.

## TEXT LAYOUT
Describe the exact text treatment: artist name placement and style, song title placement and style, font personality (bold/serif/script/etc.), text color and any glow or shadow effects, and hierarchy.

## COLOR PALETTE
List the exact color palette with hex codes or precise color names: primary color, secondary color, accent color, background color, text color. Explain how these colors create the intended emotional impact.

## LIGHTING DIRECTION
Describe the lighting setup in detail: key light direction and quality, fill light, rim/backlight, shadows, time of day aesthetic (golden hour, night, studio, etc.), and mood the lighting creates.

## NEGATIVE PROMPT
Write a comprehensive negative prompt — everything to exclude from the image generation to ensure quality and brand safety.

## ALTERNATE THUMBNAIL IDEAS
Write 5 alternate thumbnail concepts. For each: a short concept description and a full ready-to-paste AI image prompt. Number them clearly (Alternate 1 through Alternate 5).`;

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

    await req.userSupabase!.from("profiles").update({ credits: creditsAfter }).eq("id", req.userId!);
    recordCreditUsage({ userId: req.userId!, action: "Thumbnail Maker", creditsUsed: CREDIT_COST }).catch(() => {});

    if (process.env["NODE_ENV"] === "development") {
      console.log(`[generate-thumbnail] success userId=${req.userId} creditsAfter=${creditsAfter}`);
    }

    res.json({ result: content, creditsRemaining: creditsAfter });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Generation failed";
    res.status(500).json({ error: message });
  }
});

export default router;
