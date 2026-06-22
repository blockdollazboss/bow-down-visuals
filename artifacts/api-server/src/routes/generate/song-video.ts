import { Router } from "express";
import OpenAI from "openai";
import { requireAuth } from "../../middlewares/require-auth";

const router = Router();
const openai = new OpenAI({ apiKey: process.env["OPENAI_API_KEY"] });

const CREDIT_COST = 2;

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
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      max_tokens: 6000,
    });

    const content = completion.choices[0]?.message?.content ?? "";
    const creditsAfter = currentCredits - CREDIT_COST;

    await req.userSupabase!.from("profiles").update({ credits: creditsAfter }).eq("id", req.userId!);

    if (process.env["NODE_ENV"] === "development") {
      console.log(`[generate-song-video] success userId=${req.userId} creditsAfter=${creditsAfter}`);
    }

    res.json({ result: content, creditsRemaining: creditsAfter });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Generation failed";
    res.status(500).json({ error: message });
  }
});

export default router;
