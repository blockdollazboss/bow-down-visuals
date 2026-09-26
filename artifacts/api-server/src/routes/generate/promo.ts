import { Router } from "express";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { buildCoStarContext } from "../../lib/co-stars";
import { recordCreditUsage } from "../../lib/payment-record";
import { chargeCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";

const router = Router();

const CREDIT_COST = 1;

const SYSTEM_PROMPT = `You are Bow Down Visuals, a premium AI creative director for music creators.

You help rappers, singers, producers, AI artists, content creators, and labels create professional songs, hooks, lyrics, music video plans, AI video prompts, thumbnails, captions, and promo campaigns.

Think like:
- a Grammy-winning hit songwriter
- an Oscar-winning music video director
- a cinematographer
- a social media strategist
- a creative director
- a release rollout planner

Hold everything to an award-winning bar: hooks engineered like chart-toppers, visuals composed like cinema frames. If it wouldn't win, rewrite it.

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
  if (vault["brandColors"]) lines.push(`Brand Colors: ${vault["brandColors"]}`);
  if (vault["imageReferenceNotes"]) lines.push(`Image Reference Notes: ${vault["imageReferenceNotes"]}`);
  if (vault["doNotChangeRules"]) {
    lines.push("", `⛔ DO NOT CHANGE RULES — NEVER VIOLATE THESE:\n${vault["doNotChangeRules"]}`);
  }
  if (vault["specialStyleRules"]) {
    lines.push("", `✅ SPECIAL STYLE RULES — ALWAYS APPLY THESE:\n${vault["specialStyleRules"]}`);
  }
  return lines.join("\n");
}

router.post("/generate-promo-clips", requireAuth, async (req, res) => {
  const {
    artistName, songTitle, genre, mood, platform, promoGoal, songHook, instructions,
    promoType, lyrics, hasRunwayClips, clipCount,
  } = req.body as Record<string, string | boolean | number>;

  const artistVault = req.body.artistVault as VaultData | null | undefined;
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

  const promoTypeLine = promoType ? `\nPromo Type Focus: ${promoType} — tailor ALL output specifically for this promo format.` : "";
  const lyricsBlock = lyrics
    ? `\nFull Lyrics / Song Content:\n"""\n${String(lyrics).slice(0, 1200)}\n"""`
    : songHook
    ? `\nSong Hook / Key Lyric: ${songHook}`
    : "";
  const clipsLine = hasRunwayClips
    ? `\nAI Video Clips Available: ${clipCount} Runway-generated video clips exist for this project. Reference these in your shot suggestions and timing breakdown.`
    : "";

  const prompt = `Create a complete, platform-ready promo content pack for the following music release. Every idea must be specific, scroll-stopping, and immediately actionable.

BOW DOWN VISUALS — CREATOR PROMO PACKAGE

Artist: ${artistName || "Unknown Artist"}
Song / Project Title: "${songTitle || "Untitled"}"
Genre: ${genre || "Hip Hop"}
Mood: ${mood || "Dark"}
Primary Platform: ${platform || "TikTok 9:16"}
Promo Goal: ${promoGoal || "Drive streams"}${promoTypeLine}${lyricsBlock}${clipsLine}
${instructions ? `Special Instructions: ${instructions}` : ""}
${buildVaultContext(artistVault)}${await buildCoStarContext((artistVault as Record<string, string | null | undefined> | null | undefined)?.["vaultId"] ?? (artistVault as Record<string, string | null | undefined> | null | undefined)?.["id"], req.userId)}

Return the output using EXACTLY these ## section headers in this order. Every idea must be platform-specific, creative, and ready to execute immediately.

## BEST 15-SECOND PROMO IDEA
Write the single best 15-second promo clip concept for this song. Include: visual setup, what happens second-by-second, the exact lyric or hook moment to feature, on-screen text, and which platforms it hits hardest.

## BEST 30-SECOND PROMO IDEA
Write the single best 30-second promo clip concept. Include: full shot-by-shot breakdown (every 5-10 seconds), on-screen text for each moment, transition style, and platform fit.

## HOOK CLIP SCRIPT
Write a complete shot-by-shot script for a hook-focused promo clip (15-30 seconds). Include: scene descriptions, artist direction, on-screen text and its timing, audio cues, and visual mood. Format it as a proper shot script.

## ON-SCREEN TEXT
Write 12 ready-to-use on-screen text options: 4 lyric-based overlays, 4 hype/announcement statements, and 4 engagement-focused prompts. Keep each one punchy, scroll-stopping, and under 8 words where possible.

## CAPTION IDEAS
Write 6 ready-to-post social media captions: 2 drop-day announcement captions, 2 engagement/question captions that drive comments, and 2 emotional/storytelling captions. Include relevant emojis and make each one complete and ready to paste.

## HASHTAGS
Write 3 hashtag sets:
- Set 1: Genre and niche hashtags (10 tags)
- Set 2: Trending and broad-reach hashtags (8 tags)
- Set 3: Artist branding hashtags to own (5 custom tags)

## CALL-TO-ACTION IDEAS
Write 10 CTAs ready to add to clips and captions: 3 stream CTAs, 2 follow CTAs, 2 share CTAs, 2 comment CTAs, and 1 playlist-add CTA. Make each one direct and compelling.

## SUGGESTED VISUAL SHOTS
Write 6 specific shot ideas with camera directions, locations, and visual details. Each shot should be executable on a phone or basic setup. Include: shot type, location, artist direction, lighting, and what makes it stop the scroll.

## SUGGESTED CLIP TIMING
Write a detailed timing breakdown for a 30-second promo clip. Break it down second-by-second (0-5s, 5-10s, 10-15s, 15-20s, 20-25s, 25-30s). For each window: what is happening visually, what text appears, what audio moment plays, and what the viewer feels.

## THUMBNAIL FRAME SUGGESTION
Write a specific description of the perfect thumbnail or cover frame for this promo content. Include: exact composition, color palette, what the artist is doing, text overlay (font style and positioning), background/setting, and the overall visual mood. Make it detailed enough to recreate exactly.`;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      max_completion_tokens: 4500,
    });

    const content = completion.choices[0]?.message?.content ?? "";
    // Atomic single-statement deduction — race-safe (no read-modify-write).
    let creditsAfter: number;
    try {
      creditsAfter = await chargeCredits(req.userId!, CREDIT_COST, { action: "Promo Clips" });
    } catch (deductErr) {
      if (deductErr instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: "You are out of credits. Join the waitlist or upgrade soon to keep creating.",
        });
        return;
      }
      if (deductErr instanceof LedgerWriteError) {
        res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed \u2014 no credits were charged. Please try again." });
        return;
      }
      throw deductErr;
    }

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
