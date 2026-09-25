import { Router } from "express";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { randomUUID } from "crypto";
import { toFile } from "openai";
import { requireAuth } from "../../middlewares/require-auth";
import { recordThumbnailHistory } from "../../lib/payment-record";
import { chargeCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";
import { uploadMediaToSupabaseStorage, refreshSupabaseStorageUrl, normalizeToStorageRef } from "../../lib/objectStorage";
import { isAllowedStemUrl } from "../../lib/audioExport";

const router = Router();

/** Text (concept + prompts) generation cost, charged whenever the AI text call succeeds. */
const TEXT_CREDIT_COST = 1;
/** Extra cost for actually rendering the AI thumbnail image, charged only if the image succeeds. */
const IMAGE_CREDIT_COST = 2;
/** Total credits required up-front to attempt a full generation (text + image). */
const CREDIT_COST = TEXT_CREDIT_COST + IMAGE_CREDIT_COST;

const SYSTEM_PROMPT = `You are Bow Down Visuals, a premium AI creative director for music creators.

You help rappers, singers, producers, AI artists, content creators, and labels create professional songs, hooks, lyrics, music video plans, AI video prompts, thumbnails, captions, and promo campaigns.

Think like:
- a hit songwriter
- a music video director
- an Oscar-winning cinematographer and art director
- a social media strategist
- a creative director
- a release rollout planner

Art-direct every concept like an Oscar-winning cinematographer: compositions engineered to stop the scroll, lighting with intent, color with emotion. If it wouldn't own a theater poster wall, rework it.

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

/**
 * Matches the canonical camelCase Artist Vault payload shape sent by the client
 * (see `vaultToPayload` in `artifacts/bow-down-visuals/src/lib/prompt-improve.ts`,
 * also used by `/api/improve-prompt`). Keeping the field names identical here is
 * what makes "character lock" actually work — a prior mismatched key set here
 * silently meant this route never read the vault at all.
 */
interface VaultInput {
  artistType?: string | null;
  artistDescription?: string | null;
  visualStyle?: string | null;
  hair?: string | null;
  tattoos?: string | null;
  jewelry?: string | null;
  clothingStyle?: string | null;
  brandColors?: string | null;
  doNotChangeRules?: string | null;
  consistencyPrompt?: string | null;
  referenceImageUrl?: string | null;
}

function buildVaultContext(vault: VaultInput | null | undefined): string {
  if (!vault) return "";
  const lines: string[] = [
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "ARTIST VAULT — CHARACTER LOCK & BRAND STYLE RULES",
    "This artist must look and feel IDENTICAL across every generation.",
    "Apply ALL of the following to every section of your output, especially the MAIN IMAGE PROMPT.",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "",
  ];
  if (vault.artistType) lines.push(`Artist Type: ${vault.artistType}`);
  if (vault.artistDescription) lines.push(`Artist Description / Personality: ${vault.artistDescription}`);
  if (vault.visualStyle) lines.push(`Visual Style: ${vault.visualStyle}`);
  if (vault.hair) lines.push(`Hair: ${vault.hair}`);
  if (vault.tattoos) lines.push(`Tattoos: ${vault.tattoos}`);
  if (vault.jewelry) lines.push(`Jewelry: ${vault.jewelry}`);
  if (vault.clothingStyle) lines.push(`Clothing Style / Wardrobe: ${vault.clothingStyle}`);
  if (vault.brandColors) lines.push(`Brand Colors: ${vault.brandColors}`);
  if (vault.consistencyPrompt) lines.push(`Saved Consistency Prompt: ${vault.consistencyPrompt}`);
  if (vault.referenceImageUrl) {
    lines.push(
      "A reference photo of this exact artist is available and will be used directly as the base image for the " +
      "MAIN IMAGE PROMPT generation — describe the scene/setting/wardrobe/lighting around them, but do not " +
      "invent a different face, body type, or skin tone than the artist's actual appearance.",
    );
  }
  if (vault.doNotChangeRules) {
    lines.push("", `⛔ DO NOT CHANGE RULES — NEVER VIOLATE THESE:\n${vault.doNotChangeRules}`);
  }
  return lines.join("\n");
}

/** Pulls the body text of a single "## HEADER" section out of the AI's markdown output. */
function extractSection(content: string, headerRegex: RegExp): string | null {
  const lines = content.split("\n");
  let capturing = false;
  const collected: string[] = [];
  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (capturing) break;
      capturing = headerRegex.test(line);
      continue;
    }
    if (capturing) collected.push(line);
  }
  const text = collected.join("\n").trim();
  return text.length > 0 ? text : null;
}

/** Hard cap on downloaded reference-photo size, mirroring the SSRF/DoS guard used for stem downloads. */
const MAX_REFERENCE_IMAGE_BYTES = 15 * 1024 * 1024;

/**
 * Downloads the artist's reference photo for use as the base image in an
 * OpenAI image *edit* call (character lock). Only fetches from our own
 * Supabase storage host (SSRF guard) and enforces a size cap. Returns null
 * on any failure — the caller falls back to plain text-to-image.
 */
async function fetchReferenceImageBuffer(url: string): Promise<Buffer | null> {
  if (!isAllowedStemUrl(url)) return null;
  try {
    const resp = await fetch(url);
    if (!resp.ok || !resp.body) return null;
    const contentLength = resp.headers.get("content-length");
    if (contentLength && Number(contentLength) > MAX_REFERENCE_IMAGE_BYTES) return null;
    const arrayBuffer = await resp.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_REFERENCE_IMAGE_BYTES) return null;
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

/**
 * Actually renders the AI thumbnail image (not just a prompt) using the
 * "MAIN IMAGE PROMPT" / "NEGATIVE PROMPT" sections of the text output, then
 * uploads it to object storage so it survives across sessions. Returns null
 * (with a reason) instead of throwing so a failed image never blocks the
 * text package the user already paid for.
 *
 * When the artist's vault has a `referenceImageUrl`, this uses OpenAI's image
 * *edit* endpoint with that photo as the base image ("character lock") instead
 * of pure text-to-image, so the artist's actual face/appearance carries over
 * into every thumbnail rather than being re-imagined from a text description.
 */
async function generateThumbnailImage(
  content: string,
  platform: string | undefined,
  referenceImageUrl: string | null | undefined,
  log?: { info: (obj: Record<string, unknown>, msg: string) => void },
): Promise<{ url: string | null; error: string | null }> {
  const mainImagePrompt = extractSection(content, /main image prompt/i);
  if (!mainImagePrompt) {
    return { url: null, error: "Could not find an image prompt in the generated package." };
  }
  const negativePrompt = extractSection(content, /negative prompt/i);
  const imagePrompt = negativePrompt
    ? `${mainImagePrompt}\n\nDo not include: ${negativePrompt}`
    : mainImagePrompt;

  try {
    const size = platform === "Spotify" || platform === "Apple Music" ? "1024x1024" : "1536x1024";
    const referenceBuffer = referenceImageUrl ? await fetchReferenceImageBuffer(referenceImageUrl) : null;

    let b64: string | undefined;
    if (referenceBuffer) {
      log?.info({ mode: "image-edit-character-lock" }, "[generate-thumbnail] using reference photo for character lock");
      const referenceFile = await toFile(referenceBuffer, "artist-reference.png", { type: "image/png" });
      const lockedPrompt =
        `Using the exact artist/person shown in the reference photo (same face, skin tone, body type — do not change ` +
        `their identity), create this scene: ${imagePrompt}`.slice(0, 4000);
      const editResp = await getOpenAI().images.edit({
        model: "gpt-image-1",
        image: referenceFile,
        prompt: lockedPrompt,
        size,
        n: 1,
      });
      b64 = editResp.data?.[0]?.b64_json;
    } else {
      log?.info(
        { mode: "text-to-image", hadReferenceUrl: Boolean(referenceImageUrl) },
        "[generate-thumbnail] no usable reference photo, falling back to text-to-image",
      );
      const imageResp = await getOpenAI().images.generate({
        model: "gpt-image-1",
        prompt: imagePrompt.slice(0, 4000),
        size,
        n: 1,
      });
      b64 = imageResp.data?.[0]?.b64_json;
    }

    if (!b64) {
      return { url: null, error: "Image generation returned no image data." };
    }
    const buffer = Buffer.from(b64, "base64");
    /* Persist the stable storage ref; mint a short-lived URL for immediate display. */
    const objectName = `thumbnails/${randomUUID()}.png`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "image/png");
    const url = await refreshSupabaseStorageUrl(storageRef);
    return { url, error: null };
  } catch (err: unknown) {
    return { url: null, error: err instanceof Error ? err.message : "Image generation failed." };
  }
}

router.post("/generate-thumbnail", requireAuth, async (req, res) => {
  const {
    artistName, songTitle, platform, artStyle, colorTheme, mood, featuredText, specialRequests,
  } = req.body as Record<string, string>;

  const artistVault = req.body.artistVault as VaultInput | null | undefined;

  const currentCredits = req.userCredits ?? 0;
  const isDev = process.env["NODE_ENV"] === "development";
  req.log.info({ userId: req.userId, currentCredits, required: CREDIT_COST }, "[generate-thumbnail] request received");
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
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      max_completion_tokens: 3000,
    });

    const content = completion.choices[0]?.message?.content ?? "";

    const { url: thumbnailImageUrl, error: imageError } = await generateThumbnailImage(
      content,
      platform,
      artistVault?.referenceImageUrl,
      req.log,
    );
    const creditsUsed = TEXT_CREDIT_COST + (thumbnailImageUrl ? IMAGE_CREDIT_COST : 0);
    // chargeCredits(): fresh-read deduct + strict ledger write. A ledger
    // failure rolls the deduction back and throws LedgerWriteError (loud).
    let creditsAfter: number;
    try {
      creditsAfter = await chargeCredits(req.userId!, creditsUsed, { action: "Thumbnail Maker" });
    } catch (chargeErr) {
      if (chargeErr instanceof OutOfCreditsError) {
        res.status(402).json({ error: "out_of_credits", message: "You are out of credits. Join the waitlist or upgrade soon to keep creating." });
        return;
      }
      if (chargeErr instanceof LedgerWriteError) {
        res.status(500).json({ error: "ledger_write_failed", message: "Credit ledger write failed \u2014 no credits were charged. Please try again." });
        return;
      }
      throw chargeErr;
    }
    if (thumbnailImageUrl) {
      /* Store the stable storage ref in history (not the short-lived signed
         URL) — the history reader mints a fresh URL on every read. */
      const storedThumbnailRef = normalizeToStorageRef(thumbnailImageUrl) ?? thumbnailImageUrl;
      void recordThumbnailHistory({
        userId:       req.userId!,
        prompt,
        content,
        thumbnailUrl: storedThumbnailRef,
        artistName,
        songTitle,
        creditsUsed,
      });
    }

    req.log.info(
      { userId: req.userId, creditsAfter, imageGenerated: Boolean(thumbnailImageUrl), imageError },
      "[generate-thumbnail] success",
    );

    res.json({
      result: content,
      thumbnailImageUrl,
      imageError: thumbnailImageUrl ? null : imageError,
      creditsUsed,
      creditsRemaining: creditsAfter,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Generation failed";
    res.status(500).json({ error: message });
  }
});

export default router;
