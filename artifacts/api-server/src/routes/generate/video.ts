import { Router } from "express";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { buildCoStarContext } from "../../lib/co-stars";
import { recordGenerationHistory, markGenerationHistoryCharged } from "../../lib/payment-record";
import { chargeCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";

const router = Router();

const CREDIT_COST = 2;

const SYSTEM_PROMPT = `You are Bow Down Visuals, a premium AI creative director for music creators.

You help rappers, singers, producers, AI artists, content creators, and labels create professional songs, hooks, lyrics, music video plans, AI video prompts, thumbnails, captions, and promo campaigns.

Think like:
- a hit songwriter
- an Oscar-winning music video director
- an Oscar-winning cinematographer
- a social media strategist
- a creative director
- a release rollout planner

Direct like an Oscar-winning filmmaker: every scene composed for the big screen, camera moves motivated by emotion, lighting that carries feeling. If a treatment wouldn't hold up in a theater, rewrite it.

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
    "ACTIVE ARTIST — CHARACTER CONSISTENCY RULES",
    "⚠️  CRITICAL: Every AI video prompt you write MUST feature this specific artist.",
    "Do NOT generate a random person. Use these details to describe the artist in EVERY scene prompt.",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
  ];
  if (vault["artistType"]) lines.push(`Artist Type: ${vault["artistType"]}`);
  if (vault["artistDescription"]) lines.push(`Artist Description / Personality: ${vault["artistDescription"]}`);
  if (vault["visualStyle"]) lines.push(`Visual Style: ${vault["visualStyle"]}`);
  if (vault["hair"]) lines.push(`Hair: ${vault["hair"]}`);
  if (vault["tattoos"]) lines.push(`Tattoos: ${vault["tattoos"]}`);
  if (vault["jewelry"]) lines.push(`Jewelry: ${vault["jewelry"]}`);
  if (vault["clothingStyle"]) lines.push(`Clothing Style: ${vault["clothingStyle"]}`);
  if (vault["brandColors"]) lines.push(`Brand Colors: ${vault["brandColors"]}`);
  if (vault["consistencyPrompt"]) lines.push(`Consistency Prompt: ${vault["consistencyPrompt"]}`);
  if (vault["referenceImageUrl"]) lines.push(`Reference Image: ${vault["referenceImageUrl"]} — treat this as the visual identity guide for all scene prompts.`);
  if (vault["doNotChangeRules"]) {
    lines.push("", `⛔ DO NOT CHANGE RULES — NEVER VIOLATE THESE:\n${vault["doNotChangeRules"]}`);
  }
  lines.push(
    "",
    "CHARACTER CONSISTENCY MANDATE — APPLY TO EVERY AI VIDEO PROMPT:",
    "• Begin each AI Video Prompt with: 'Active artist [artist name] as the main character —'",
    "• Include face, skin tone, hairstyle, body type, tattoos, jewelry, and clothing from the vault above",
    "• Write: 'Do not create a random new person. Keep the same identity as the reference.'",
    "• If a reference image URL is provided above, mention it as the visual consistency guide",
  );
  return lines.join("\n");
}

type SongStructureData = Record<string, unknown> | null | undefined;

function formatSongStructure(s: SongStructureData): string {
  if (!s) return "";
  const sections = (s["sections"] as Array<{ name: string; startTime?: string; endTime?: string; notes?: string }>) ?? [];
  const promo15 = s["promo15"] as { section: string; reason: string } | undefined;
  const promo30 = s["promo30"] as { section: string; reason: string } | undefined;
  const videoPacing = s["videoPacing"] as string | undefined;
  const energyMap = s["energyMap"] as string | undefined;
  const lines: string[] = ["Song Sections:"];
  for (const sec of sections) {
    const time = sec.startTime ? ` [${sec.startTime}${sec.endTime ? `–${sec.endTime}` : ""}]` : "";
    lines.push(`  • ${sec.name}${time}${sec.notes ? `: ${sec.notes}` : ""}`);
  }
  if (promo15?.section) lines.push(`Best 15s promo: ${promo15.section} — ${promo15.reason}`);
  if (promo30?.section) lines.push(`Best 30s promo: ${promo30.section} — ${promo30.reason}`);
  if (videoPacing) lines.push(`Video Pacing: ${videoPacing}`);
  if (energyMap) lines.push(`Energy Arc: ${energyMap}`);
  return lines.join("\n");
}

router.post("/generate-video-plan", requireAuth, async (req, res) => {
  const {
    artistName, songTitle, genre, mood, videoStyle,
    platform, videoLength, lyrics, artistDescription, instructions,
  } = req.body as Record<string, string>;

  const artistVault = req.body.artistVault as VaultData | null | undefined;
  const songStructure = req.body.songStructure as SongStructureData;

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
${songStructure ? `\nSONG STRUCTURE ANALYSIS — align your scene-by-scene breakdown with these sections:\n${formatSongStructure(songStructure)}` : ""}
${instructions ? `Special Instructions: ${instructions}` : ""}
${buildVaultContext(artistVault)}${await buildCoStarContext((artistVault as Record<string, string | null | undefined> | null | undefined)?.["vaultId"] ?? (artistVault as Record<string, string | null | undefined> | null | undefined)?.["id"], req.userId)}

Return the output using EXACTLY these ## section headers in this order. Write full, director-level content for every section.

## DIRECTOR'S TREATMENT
Write a full director's statement: the overarching creative vision, tone, narrative arc, and emotional journey of this video. What is the video really about beneath the visuals?

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

## VISUAL CONCEPT
Describe the complete visual world: aesthetic references (described generically), color story, texture, era, atmosphere, and how the visuals serve the music.

## COLOR PALETTE
List the exact color palette: primary, secondary, and accent colors with hex codes or descriptive names. Describe how lighting shifts across the video.

## MAIN LOCATIONS
List 3–5 primary shooting locations with detailed descriptions. For each: interior/exterior, time of day, lighting conditions, mood, and why it fits the song.

## WARDROBE & ARTIST LOOK
Describe the artist's wardrobe in full detail for each location or scene change: clothing, accessories, footwear, hair, and overall visual brand impact.

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
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      max_completion_tokens: 8000,
    });

    const content = completion.choices[0]?.message?.content ?? "";

    // Step 1: Save to history FIRST (throws → outer catch returns 500, no credits charged)
    const genHistoryId = await recordGenerationHistory({
      userId:         req.userId!,
      generationType: "Make a Music Video",
      prompt:         `${artistName || "Unknown"} — ${songTitle || "Untitled"} (${genre || "?"}, ${mood || "?"})`,
      content,
      artistName:     artistName || undefined,
      songTitle:      songTitle  || undefined,
      creditsUsed:    CREDIT_COST,
    });

    // Step 2: Deduct credits only after history is confirmed saved.
    // Atomic single-statement deduction — race-safe (no read-modify-write).
    let creditsAfter: number;
    try {
      creditsAfter = await chargeCredits(req.userId!, CREDIT_COST, { action: "Make a Music Video" });
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

    // Step 3: Fire-and-forget — mark charged + log usage
    markGenerationHistoryCharged(genHistoryId).catch(() => {});

    res.json({ result: content, creditsRemaining: creditsAfter, genHistoryId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Generation failed";
    res.status(500).json({ error: message });
  }
});

export default router;
