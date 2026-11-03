import { Router } from "express";
import { z } from "zod";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { recordCreation } from "../../lib/retention";
import { buildCoStarContext } from "../../lib/co-stars";
import { recordGenerationHistory, markGenerationHistoryCharged } from "../../lib/payment-record";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";
import { isAdminRequest } from "../../lib/admin";
import {
  creditCostForLength,
  SongTooLongError,
  SONG_PRICE_TIERS,
  MAX_LENGTH_MS,
} from "./music-audio";

const router = Router();

/* ── Pricing — the SAME duration tiers as the audio rail ──────────
   Price-accuracy audit #5 (2026-11-02): this legacy rail used to
   charge a flat 400 VB regardless of the requested length, so any
   long song reaching it bypassed the ruled duration tiers and the
   site told two song price stories. The charge now derives from
   routes/generate/music-audio.ts — SONG_PRICE_TIERS /
   creditCostForLength are IMPORTED here, never copied — so there
   is one song price story: 400 (≤1 min) / 800 (≤3 min) / 1,200
   (≤5 min) / 2,400 (≤10 min).

   This rail's length arrives as a descriptive label (the Make Song
   form's songLength select: "30 seconds", "2 minutes", "Full
   song", …), not the audio rail's numeric lengthSeconds — so the
   label is parsed to milliseconds and priced through the same
   function. A caller may also send the audio rail's numeric
   lengthSeconds, which wins when present. Two reviewed defaults:
   - no / unrecognised length → 60 seconds (the audio rail's own
     DEFAULT_LENGTH_MS), i.e. the 400 first tier — the price this
     rail always charged for an unspecified length;
   - "Full song" → 180 seconds, the site's standard full-song
     length (the "Standard (3 min)" default the song-and-video
     journey posts), i.e. the 800 tier.
   Past 10 minutes the tier function throws SongTooLongError and a
   member is refused plainly BEFORE any charge — the audio rail's
   exact behaviour — while an admin caller (fail-closed
   ADMIN_EMAILS allowlist) is priced at the 2,400 top tier, the
   audio rail's owner exemption. */
export const DEFAULT_SONG_LENGTH_MS = 60_000;
export const FULL_SONG_LENGTH_MS = 180_000;

/** Parse a descriptive song-length label to milliseconds.
 *  Returns null when the label names no length we can price. */
export function songLengthMsFromLabel(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  if (text.includes("full song")) return FULL_SONG_LENGTH_MS;
  const clock = text.match(/(\d+):([0-5]\d)/);
  if (clock) return Number(clock[1]) * 60_000 + Number(clock[2]) * 1_000;
  let ms = 0;
  let found = false;
  const minutes = text.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?)\b/);
  if (minutes) {
    ms += Math.round(Number(minutes[1]) * 60_000);
    found = true;
  }
  const seconds = text.match(/(\d+(?:\.\d+)?)\s*(?:seconds?|secs?)\b/);
  if (seconds) {
    ms += Math.round(Number(seconds[1]) * 1_000);
    found = true;
  }
  return found ? ms : null;
}

/** The length a generate-song request is priced on: an explicit
 *  numeric lengthSeconds wins, then the songLength label, then the
 *  60-second default. */
export function songLengthMsForRequest(input: {
  songLength?: string | null;
  lengthSeconds?: number | null;
}): number {
  if (
    typeof input.lengthSeconds === "number" &&
    Number.isFinite(input.lengthSeconds) &&
    input.lengthSeconds > 0
  ) {
    return Math.round(input.lengthSeconds * 1000);
  }
  return songLengthMsFromLabel(input.songLength) ?? DEFAULT_SONG_LENGTH_MS;
}

/** This rail's charge for a request, through the audio rail's tier
 *  function. Throws SongTooLongError past 10 minutes for a member;
 *  an admin caller past the top tier pays the top tier instead. */
export function creditCostForSongRequest(
  input: { songLength?: string | null; lengthSeconds?: number | null },
  isAdmin: boolean,
): number {
  const lengthMs = songLengthMsForRequest(input);
  if (isAdmin && lengthMs > MAX_LENGTH_MS) {
    return SONG_PRICE_TIERS[SONG_PRICE_TIERS.length - 1]!.cost;
  }
  return creditCostForLength(lengthMs);
}

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

/* ── Request validation ── */
const songGenerateSchema = z.object({
  artistName: z.string().max(200).optional(),
  songTitle: z.string().max(300).optional(),
  genre: z.string().max(100).optional(),
  mood: z.string().max(100).optional(),
  songTopic: z.string().max(5000).optional(),
  explicit: z.string().max(20).optional(),
  voiceStyle: z.string().max(200).optional(),
  beatStyle: z.string().max(200).optional(),
  songLength: z.string().max(50).optional(),
  /** The audio rail's numeric length (seconds) — wins over the
   *  songLength label when present; priced on the same tiers. */
  lengthSeconds: z.number().optional(),
  instructions: z.string().max(5000).optional(),
  artistVault: z.record(z.string(), z.string().nullable().optional()).nullable().optional(),
});

router.post("/generate-song", requireAuth, async (req, res) => {
  const parsed = songGenerateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid song request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const {
    artistName, songTitle, genre, mood, songTopic,
    explicit, voiceStyle, beatStyle, songLength, instructions,
  } = parsed.data;

  const artistVault = parsed.data.artistVault as VaultData | null | undefined;

  /* The tiered charge for THIS request's length (see the pricing
     note at the top of the file). Priced before the affordability
     check; a member past 10 minutes is refused plainly here,
     before any charge — the audio rail's song_too_long answer. */
  let creditCost: number;
  try {
    creditCost = creditCostForSongRequest(
      { songLength, lengthSeconds: parsed.data.lengthSeconds },
      isAdminRequest(req),
    );
  } catch (pricingErr) {
    if (pricingErr instanceof SongTooLongError) {
      res.status(400).json({
        error:
          "Songs can be up to 10 minutes long — pick a length of 10 minutes or less and try again. Nothing was charged.",
        code: "song_too_long",
      });
      return;
    }
    throw pricingErr;
  }

  const currentCredits = req.userCredits ?? 0;

  if (process.env["NODE_ENV"] === "development") {
    console.log(`[generate-song] userId=${req.userId} credits=${currentCredits} required=${creditCost}`);
  }

  const isDev = process.env["NODE_ENV"] === "development";
  if (!isDev && currentCredits < creditCost) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You are out of Visual Bucs. Join the waitlist or upgrade soon to keep creating.",
    });
    return;
  }

  /* ── Reserve at job start (spend-pacing, stack1000 P2) ──
     The charge lands BEFORE the provider call; every failure exit
     below refunds it in full. This handler used to generate, save
     history, and charge last — the pre-check above reads the
     auth-time balance snapshot, so concurrent requests all passed
     it against one balance, each burned real provider money, and
     all but the first charge failed. Same price, same action. */
  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, creditCost, { action: "Make a Song" });
  } catch (deductErr) {
    if (deductErr instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You are out of Visual Bucs. Join the waitlist or upgrade soon to keep creating.",
      });
      return;
    }
    if (deductErr instanceof LedgerWriteError) {
      res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed \u2014 no Visual Bucs were charged. Please try again." });
      return;
    }
    res.status(500).json({ error: deductErr instanceof Error ? deductErr.message : "Generation failed" });
    return;
  }
  let chargeLive = true;
  const refundCharge = async () => {
    if (!chargeLive) return;
    chargeLive = false;
    await refundCredits(req.userId!, creditCost, { action: "Make a Song — Refund" }).catch(() => {});
  };

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
${buildVaultContext(artistVault)}${await buildCoStarContext((artistVault as Record<string, string | null | undefined> | null | undefined)?.["vaultId"] ?? (artistVault as Record<string, string | null | undefined> | null | undefined)?.["id"], req.userId)}

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

    // Step 1: Save to history (throws → outer catch refunds the reserve and returns 500)
    const genHistoryId = await recordGenerationHistory({
      userId:         req.userId!,
      generationType: "Make a Song",
      prompt:         `${artistName || "Unknown"} — ${songTitle || "Untitled"} (${genre || "?"}, ${mood || "?"})`,
      content,
      artistName:     artistName || undefined,
      songTitle:      songTitle  || undefined,
      creditsUsed:    creditCost,
    });

    // (The charge already landed at reserve-at-start, above.)

    // Step 3: Fire-and-forget — mark charged (usage already logged by chargeCredits)
    markGenerationHistoryCharged(genHistoryId).catch(() => {});

    res.json({ result: content, creditsRemaining: creditsAfter, creditsUsed: creditCost, genHistoryId });
    // Retention hook: counts as a creation day + feeds the song quest.
    void recordCreation(req.userId!, "song");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Generation failed";
    await refundCharge();
    res.status(500).json({ error: message });
  }
});

export default router;
