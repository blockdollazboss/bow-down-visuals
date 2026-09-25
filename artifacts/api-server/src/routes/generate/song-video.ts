import { Router } from "express";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { recordCreditUsage, recordGenerationHistory, markGenerationHistoryCharged } from "../../lib/payment-record";
import { deductCredits, OutOfCreditsError } from "../../lib/credits";

const router = Router();

const CREDIT_COST = 3;

const SYSTEM_PROMPT = `You are Bow Down Visuals, a premium AI creative director for music creators.

You help rappers, singers, producers, AI artists, content creators, and labels create professional songs, hooks, lyrics, music video plans, AI video prompts, thumbnails, captions, and promo campaigns.

Think like:
- a Grammy-winning hit songwriter
- an Oscar-winning music video director
- a cinematographer
- a social media strategist
- a creative director
- a release rollout planner

Write songs like a Grammy-winning songwriter and direct visuals like an Oscar-winning filmmaker. Every hook engineered to stick, every frame composed for the big screen. If it wouldn't win, rewrite it.

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

router.post("/generate-song-video", requireAuth, async (req, res) => {
  const {
    artistName, songTitle, genre, mood, explicit, songTopic,
    voiceStyle, beatStyle, songLength, videoStyle, platform,
    artistDescription, instructions, existingLyrics,
  } = req.body as Record<string, string>;

  const artistVault = req.body.artistVault as VaultData | null | undefined;
  const songStructure = req.body.songStructure as SongStructureData;

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

  const isExplicit = explicit?.toLowerCase() === "explicit";

  const prompt = `Create a complete, premium Song + Video package for the following release. The song and video must feel like they were designed together — same world, same story, same energy.

BOW DOWN VISUALS — CREATOR PACKAGE

Artist: ${artistName || "Unknown Artist"}
Song Title: "${songTitle || "Untitled"}"
Genre: ${genre || "Hip Hop"}
Mood: ${mood || "Dark"}
Content Rating: ${isExplicit ? "Explicit — adult language allowed" : "Clean — no profanity"}
Song Topic / Story: ${songTopic}
Voice Style: ${voiceStyle || "Not specified"}
Beat Style: ${beatStyle || "Not specified"}
Song Length: ${songLength || "Not specified"}
Video Style: ${videoStyle || "Cinematic"}
Platform: ${platform || "YouTube"}
Artist Description: ${artistDescription || "Not specified"}
${existingLyrics ? `\nExisting Lyrics (use as the base — preserve the core content, polish and expand as needed):\n${existingLyrics}` : ""}
${songStructure ? `\nSONG STRUCTURE ANALYSIS — use this to align lyrics and video breakdown to these sections:\n${formatSongStructure(songStructure)}` : ""}
${instructions ? `Special Instructions: ${instructions}` : ""}
${buildVaultContext(artistVault)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 1 — SONG PACKAGE
━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return the following sections with EXACTLY these ## headers:

## SONG CONCEPT
The creative vision and emotional core of this song.

## BEST SONG TITLE
The strongest title for this release.

## ALTERNATE TITLE IDEAS
5 alternate titles with a brief note on each.

## FULL LYRICS
Complete, polished lyrics: intro (if any), verse 1, hook, verse 2, hook, bridge, hook, outro. Label each part within the lyrics block.

## HOOK
The hook on its own — catchy, repeatable, punchy.

## VERSE 1
Full verse 1 only.

## VERSE 2
Full verse 2 only.

## BRIDGE
Bridge lyrics — shift the energy here.

## OUTRO
Closing lines or ad libs.

## AI MUSIC PROMPT
Detailed prompt ready to paste into Suno, Udio, or similar tools. Include: genre, sub-genre, BPM, key, mood, instrumentation, vocal style, mastering target.

## BEAT DIRECTION
Ideal beat breakdown: drums, bass, melody, samples/synths, energy arc, drops.

## VOCAL DIRECTION
How to perform it: delivery, flow, ad libs, energy shifts, breath control.

━━━━━━━━━━━━━━━━━━━━━━━━━━━
PART 2 — VISUAL PACKAGE
━━━━━━━━━━━━━━━━━━━━━━━━━━━

## DIRECTOR'S TREATMENT
Full creative vision for the video — narrative, tone, emotional arc, and how it connects to the song.

## VISUAL CONCEPT
The complete visual world: aesthetic, color story, texture, era, atmosphere.

## COLOR PALETTE
Primary, secondary, and accent colors. How lighting shifts scene to scene.

## MAIN LOCATIONS
3–5 locations with full descriptions: interior/exterior, time of day, lighting, mood.

## WARDROBE & ARTIST LOOK
Full wardrobe breakdown per scene or look change.

## SCENE-BY-SCENE BREAKDOWN
Every scene with these labeled elements:
- Timestamp
- Section (Intro / Verse 1 / Hook / etc.)
- Lyric/Line
- Location
- Action
- Camera Movement
- Lighting
- Mood
- AI Video Prompt
- Negative Prompt

## AI VIDEO PROMPTS
5 standalone ready-to-paste prompts for Runway, Sora, Kling, or Pika.

## NEGATIVE PROMPTS
Master exclusion list for all AI generations.

## THUMBNAIL PROMPTS
3 AI image prompts for video thumbnail options.

## PROMO CLIP IDEAS
5 short-form promo clip ideas with scene reference, framing, on-screen text, and platform.

## CAPTION IDEAS
5 ready-to-post captions — mix of hype, story, and CTA.`;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      max_tokens: 6000,
    });

    const content = completion.choices[0]?.message?.content ?? "";

    // Step 1: Save to history FIRST (throws → outer catch returns 500, no credits charged)
    const genHistoryId = await recordGenerationHistory({
      userId:         req.userId!,
      generationType: "Make Song + Video",
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
      creditsAfter = await deductCredits(req.userId!, CREDIT_COST);
    } catch (deductErr) {
      if (deductErr instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: "You are out of credits. Join the waitlist or upgrade soon to keep creating.",
        });
        return;
      }
      throw deductErr;
    }

    // Step 3: Fire-and-forget — mark charged + log usage
    markGenerationHistoryCharged(genHistoryId).catch(() => {});
    recordCreditUsage({ userId: req.userId!, action: "Make Song + Video", creditsUsed: CREDIT_COST }).catch(() => {});

    res.json({ result: content, creditsRemaining: creditsAfter, genHistoryId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Generation failed";
    res.status(500).json({ error: message });
  }
});

export default router;
