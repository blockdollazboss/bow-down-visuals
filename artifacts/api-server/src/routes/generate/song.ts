import { Router } from "express";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { recordGenerationHistory, markGenerationHistoryCharged } from "../../lib/payment-record";
import { chargeCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";

const router = Router();

const CREDIT_COST = 1;

const SYSTEM_PROMPT = `You are Bow Down Visuals, a premium AI creative director for music creators.

You help rappers, singers, producers, AI artists, content creators, and labels create professional songs, hooks, lyrics, music video plans, AI video prompts, thumbnails, captions, and promo campaigns.

Think like:
- a Grammy-winning songwriter and producer
- a music video director
- a cinematographer
- a social media strategist
- a creative director
- a release rollout planner

Write and produce like a Grammy-winning songwriter and producer: melodies that stick after one listen, quotable lyrics, arrangements with real dynamics. Every song engineered like it's headed for the charts. If it wouldn't win, rewrite it.

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

router.post("/generate-song", requireAuth, async (req, res) => {
  const {
    artistName, songTitle, genre, mood, songTopic,
    explicit, voiceStyle, beatStyle, songLength, instructions,
  } = req.body as Record<string, string>;

  const artistVault = req.body.artistVault as VaultData | null | undefined;

  const currentCredits = req.userCredits ?? 0;

  if (process.env["NODE_ENV"] === "development") {
    console.log(`[generate-song] userId=${req.userId} credits=${currentCredits} required=${CREDIT_COST}`);
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

  const prompt = `Create a complete, premium song package for the following release. Make it ready to use in AI music tools, recording sessions, and promo campaigns.

BOW DOWN VISUALS — CREATOR PACKAGE

Artist: ${artistName || "Unknown Artist"}
Song Title: "${songTitle || "Untitled"}"
Genre: ${genre || "Hip Hop"}
Mood: ${mood || "Dark"}
Topic / Story: ${songTopic}
Content Rating: ${isExplicit ? "Explicit — adult language allowed, no filter" : "Clean — absolutely no profanity or explicit content"}
Voice Style: ${voiceStyle || "Not specified"}
Beat Style: ${beatStyle || "Not specified"}
Song Length: ${songLength || "Not specified"}
${instructions ? `Special Instructions: ${instructions}` : ""}
${buildVaultContext(artistVault)}

Return the output using EXACTLY these ## section headers in this order. Write full, original, high-quality content for every section. Make the lyrics match the genre, mood, topic, voice style, and beat style.

## SONG CONCEPT
Describe the story, emotion, and creative vision behind this song. What is it really about? What feeling should it leave the listener with?

## BEST SONG TITLE
Suggest the strongest title for this release (may differ from or improve on the working title).

## ALTERNATE TITLE IDEAS
List 5 alternate title options with a one-line note on each.

## FULL LYRICS
Write complete, polished lyrics: intro (if any), verse 1, hook, verse 2, hook, bridge, hook, outro. Label each section clearly within the lyrics block.

## HOOK
Write the hook on its own — clean, punchy, and highly repeatable. This is what people remember.

## VERSE 1
Full verse 1 lyrics only.

## VERSE 2
Full verse 2 lyrics only.

## BRIDGE
Bridge lyrics — shift the energy or emotion here.

## OUTRO
Outro lines or ad libs to close the song.

## AI MUSIC PROMPT
Write a detailed prompt ready to paste into Suno, Udio, or similar AI music tools. Include: genre, sub-genre, tempo (BPM), key, mood, instrumentation, arrangement notes, vocal style, and mastering target (e.g. -14 LUFS streaming).

## BEAT DIRECTION
Describe the ideal beat in detail: drum pattern, bassline, melodic elements, samples or synths, energy arc, drops, and any production references.

## VOCAL DIRECTION
Describe how the artist should perform this: delivery, flow, cadence, ad libs, where to go hard vs. soft, breath control notes.

## MIXING & MASTERING VIBE
Describe the sonic goal: frequency balance, vocal placement, reverb/delay character, loudness target, reference tracks (generic descriptions only, no copyrighted names).

## COVER ART PROMPT
Write a detailed AI image generation prompt for the cover art. Include: subject, composition, lighting, color palette, mood, style, and any text treatment.

## MUSIC VIDEO IDEA
Give a one-paragraph cinematic concept for the music video. Describe the setting, visual tone, key scenes, and overall feel.

## PROMO CAPTION IDEAS
Write 5 ready-to-post captions for social media — mix of hype, storytelling, and call-to-action styles.`;

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      max_completion_tokens: 4000,
    });

    const content = completion.choices[0]?.message?.content ?? "";

    // Step 1: Save to history FIRST (throws → outer catch returns 500, no credits charged)
    const genHistoryId = await recordGenerationHistory({
      userId:         req.userId!,
      generationType: "Make a Song",
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
      creditsAfter = await chargeCredits(req.userId!, CREDIT_COST, { action: "Make a Song" });
    } catch (deductErr) {
      if (deductErr instanceof OutOfCreditsError) {
        res.status(402).json({
          error: "out_of_credits",
          message: "You are out of credits. Join the waitlist or upgrade soon to keep creating.",
        });
        return;
      }
      if (deductErr instanceof LedgerWriteError) {
        res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed — no credits were charged. Please try again." });
        return;
      }
      throw deductErr;
    }

    // Step 3: Fire-and-forget — mark charged (usage already logged by chargeCredits)
    markGenerationHistoryCharged(genHistoryId).catch(() => {});

    res.json({ result: content, creditsRemaining: creditsAfter, genHistoryId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Generation failed";
    res.status(500).json({ error: message });
  }
});

export default router;
