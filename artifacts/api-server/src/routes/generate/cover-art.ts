import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { getOpenAI, getTextModel } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
} from "../../lib/credits";
import { getSupabaseAdmin } from "../../lib/supabase-admin";
import { logger } from "../../lib/logger";

const router = Router();

/* ─── Pricing ───────────────────────────────────────────────────────────────
   2 credits standard / 3 credits premium — in line with site image pricing
   (Pro 2cr, Turbo 1cr, Sunburst 1-2cr). Env-overridable without a deploy. */
export const COVER_ART_STANDARD_CREDITS =
  Number(process.env["COVER_ART_STANDARD_CREDITS"]) || 2;
export const COVER_ART_PREMIUM_CREDITS =
  Number(process.env["COVER_ART_PREMIUM_CREDITS"]) || 3;

/** Newest OpenAI image model — env-overridable so upgrades are one-line changes. */
const IMAGE_MODEL = process.env["OPENAI_IMAGE_MODEL_25"] || "gpt-image-2.5-sunburst";

/** Supabase Storage bucket for generated cover art. */
const COVER_ART_BUCKET = "artist-references";

/* ─── Style presets ───────────────────────────────────────────────────────── */
export const COVER_ART_STYLES = [
  {
    key: "luxury-gold",
    label: "Luxury Gold",
    blurb: "Black & gold opulence — the Bow Down signature",
    direction:
      "opulent black-and-gold luxury aesthetic, deep black background with " +
      "rich metallic gold accents, dramatic rim lighting, premium editorial " +
      "photography feel",
  },
  {
    key: "dark-moody",
    label: "Dark Moody",
    blurb: "Cinematic shadows, mysterious and intense",
    direction:
      "dark moody cinematic aesthetic, deep shadows and low-key lighting, " +
      "smoky atmosphere, desaturated tones with a single bold accent color, " +
      "mysterious and intense",
  },
  {
    key: "vibrant-pop",
    label: "Vibrant Pop",
    blurb: "Bold color, high energy, made to stop thumbs",
    direction:
      "vibrant pop aesthetic, bold saturated colors, neon gradients, " +
      "high-energy composition, glossy finish, eye-catching and modern",
  },
  {
    key: "retro",
    label: "Retro",
    blurb: "Vintage grain — 70s/80s vinyl energy",
    direction:
      "retro vintage aesthetic, film grain and warm analog tones, 70s/80s " +
      "album-cover energy, slightly faded colors, nostalgic typography feel",
  },
  {
    key: "minimal",
    label: "Minimal",
    blurb: "Clean, confident — negative space does the talking",
    direction:
      "minimalist aesthetic, generous negative space, one striking focal " +
      "element, restrained color palette, clean confident composition",
  },
] as const;
export type CoverArtStyleKey = (typeof COVER_ART_STYLES)[number]["key"];

/* ─── Aspect ratios ───────────────────────────────────────────────────────── */
export const COVER_ART_RATIOS = [
  { key: "1:1", label: "Square 1:1", blurb: "Streaming platforms", size: "1024x1024" },
  { key: "16:9", label: "Wide 16:9", blurb: "YouTube banner", size: "1536x1024" },
  { key: "9:16", label: "Story 9:16", blurb: "Stories & Shorts", size: "1024x1536" },
] as const;
export type CoverArtRatioKey = (typeof COVER_ART_RATIOS)[number]["key"];

export function resolveCoverArtSize(ratio: string): "1024x1024" | "1536x1024" | "1024x1536" {
  const found = COVER_ART_RATIOS.find((r) => r.key === ratio);
  return (found?.size ?? "1024x1024") as "1024x1024" | "1536x1024" | "1024x1536";
}

export function resolveCoverArtStyle(key: string) {
  return COVER_ART_STYLES.find((s) => s.key === key) ?? COVER_ART_STYLES[0];
}

export function resolveCoverArtCredits(tier: string): number {
  return tier === "premium" ? COVER_ART_PREMIUM_CREDITS : COVER_ART_STANDARD_CREDITS;
}

/* ─── Request validation ──────────────────────────────────────────────────── */
export const coverArtSchema = z.object({
  songTitle: z.string().min(1, "Song title is required.").max(120),
  artistName: z.string().min(1, "Artist name is required.").max(120),
  mood: z.string().max(300).optional().default(""),
  style: z
    .string()
    .refine((v) => COVER_ART_STYLES.some((s) => s.key === v), {
      message: "Unknown style preset.",
    })
    .default("luxury-gold"),
  aspectRatio: z
    .string()
    .refine((v) => COVER_ART_RATIOS.some((r) => r.key === v), {
      message: "Unknown aspect ratio.",
    })
    .default("1:1"),
  tier: z.enum(["standard", "premium"]).default("standard"),
});
export type CoverArtInput = z.infer<typeof coverArtSchema>;

export interface ArtDirection {
  concept: string;
  typography: string;
  palette: string[];
}

/* ─── AI art direction ──────────────────────────────────────────────────────
   GPT-6 writes the cover concept + typography layout first, so the image
   model gets precise direction instead of a bare title. Built as a pure
   function so tests can assert the token parameter without a live call.
   NOTE: GPT-6 rejects `max_tokens` — always use `max_completion_tokens`. */
export function buildArtDirectionRequest(input: CoverArtInput) {
  const style = resolveCoverArtStyle(input.style);
  const moodLine = input.mood.trim() ? ` Mood/genre: "${input.mood.trim()}".` : "";
  return {
    model: getTextModel(),
    messages: [
      {
        role: "system" as const,
        content:
          `You are an award-winning album-cover art director. ` +
          `Design a cover for the song "${input.songTitle}" by ${input.artistName}.${moodLine} ` +
          `Style: ${style.direction}. ` +
          `Write: (1) a one-paragraph visual concept for the artwork (no text in the concept ` +
          `itself — the image model cannot render words); (2) typography direction — exactly ` +
          `how the song title "${input.songTitle}" and artist name "${input.artistName}" ` +
          `should appear (font feel, placement, size relationship, color) so a designer can ` +
          `composite them afterward; (3) a 3-color palette as hex codes. ` +
          `Keep the composition uncluttered where the title will sit. ` +
          `Return ONLY JSON: {"concept": "...", "typography": "...", "palette": ["#...", "#...", "#..."]}.`,
      },
      {
        role: "user" as const,
        content: `Art-direct the cover for "${input.songTitle}" by ${input.artistName} in the ${style.label} style.`,
      },
    ],
    response_format: { type: "json_object" as const },
    max_completion_tokens: 800,
    temperature: 0.8,
  };
}

export function parseArtDirection(raw: string): ArtDirection {
  let concept = "";
  let typography = "";
  let palette: string[] = [];
  try {
    const parsed = JSON.parse(raw) as Partial<ArtDirection>;
    if (typeof parsed.concept === "string") concept = parsed.concept.trim();
    if (typeof parsed.typography === "string") typography = parsed.typography.trim();
    if (Array.isArray(parsed.palette)) {
      palette = parsed.palette
        .filter((c): c is string => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c.trim()))
        .map((c) => c.trim())
        .slice(0, 3);
    }
  } catch {
    /* fall through — empty direction still yields a usable image prompt */
  }
  return { concept, typography, palette };
}

/* ─── Image prompt ──────────────────────────────────────────────────────────
   The image model renders the artwork; typography is composited afterward
   by the designer (image models mangle text), so the prompt keeps a clear
   zone for the title and never asks the model to draw words. */
export function buildCoverImagePrompt(input: CoverArtInput, art: ArtDirection): string {
  const style = resolveCoverArtStyle(input.style);
  const conceptLine = art.concept ? ` Concept: ${art.concept}` : "";
  const paletteLine = art.palette.length > 0 ? ` Color palette: ${art.palette.join(",")}.` : "";
  return (
    `Album cover artwork, no text, no words, no letters, no logos. ` +
    `${style.direction}.${conceptLine}${paletteLine} ` +
    `Leave a clean uncluttered area in the composition where a song title can be placed. ` +
    `Professional music-industry quality, high detail, striking focal point.`
  ).slice(0, 4000);
}

/* ─── Storage ─────────────────────────────────────────────────────────────── */
async function uploadCoverArt(userId: string, buffer: Buffer): Promise<{ url: string; path: string }> {
  const filePath = `${userId}/cover-art/${randomUUID()}.png`;
  const { error: upErr } = await getSupabaseAdmin().storage
    .from(COVER_ART_BUCKET)
    .upload(filePath, buffer, { contentType: "image/png", upsert: false });
  if (upErr) throw upErr;
  const {
    data: { publicUrl },
  } = getSupabaseAdmin().storage.from(COVER_ART_BUCKET).getPublicUrl(filePath);
  return { url: publicUrl, path: filePath };
}

/* ─────────────────────────────────────────────────────────────────────────────
   POST /api/cover-art
   Paid: 2 credits standard / 3 credits premium. Auth required.
   1. Validate input.
   2. Credit pre-check (402 when short).
   3. Charge BEFORE generation.
   4. GPT-6 art direction → GPT Image artwork → Supabase upload.
   5. On ANY provider/storage failure after charging → automatic refund.
───────────────────────────────────────────────────────────────────────────── */
router.post("/cover-art", requireAuth, async (req, res) => {
  const parsed = coverArtSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid cover art request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const input = parsed.data;
  const creditCost = resolveCoverArtCredits(input.tier);

  const balance = req.userCredits ?? 0;
  if (balance < creditCost) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough credits — top up to generate cover art.",
    });
    return;
  }

  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(req.userId!, creditCost, {
      action: `Cover Art (${input.tier})`,
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: "Not enough credits — top up to generate cover art.",
      });
      return;
    }
    throw err;
  }

  /* Refund helper: any failure after the charge returns the credits. */
  const refundAndFail = async (status: number, message: string, logCtx: object) => {
    logger.error(logCtx, "[cover-art] generation failed — refunding credits");
    try {
      await refundCredits(req.userId!, creditCost, {
        action: `Cover Art (${input.tier}) — Refund`,
      });
    } catch (refundErr) {
      logger.error(
        { userId: req.userId, creditCost, refundErr },
        "[cover-art] CRITICAL: refund failed after generation failure",
      );
    }
    res.status(status).json({ error: message, refunded: true });
  };

  try {
    /* Step 1 — GPT-6 art direction (concept + typography layout). */
    const dirReq = buildArtDirectionRequest(input);
    const completion = await getOpenAI().chat.completions.create(dirReq);
    const artDirection = parseArtDirection(completion.choices[0]?.message?.content ?? "{}");

    /* Step 2 — artwork generation. */
    const imageResp = await getOpenAI().images.generate({
      model: IMAGE_MODEL,
      prompt: buildCoverImagePrompt(input, artDirection),
      size: resolveCoverArtSize(input.aspectRatio),
      quality: input.tier === "premium" ? "high" : "medium",
      n: 1,
    });
    const b64 = imageResp.data?.[0]?.b64_json;
    if (!b64) {
      await refundAndFail(500, "Image generation returned no image data.", {
        userId: req.userId,
        input,
      });
      return;
    }

    /* Step 3 — persist to the user's library. */
    let stored: { url: string; path: string };
    try {
      stored = await uploadCoverArt(req.userId!, Buffer.from(b64, "base64"));
    } catch (upErr) {
      await refundAndFail(500, "Could not save your cover art — credits refunded.", {
        userId: req.userId,
        err: upErr instanceof Error ? upErr.message : upErr,
      });
      return;
    }

    logger.info(
      { userId: req.userId, style: input.style, ratio: input.aspectRatio, tier: input.tier },
      "[cover-art] generation succeeded",
    );
    res.json({
      url: stored.url,
      path: stored.path,
      artDirection,
      typography: artDirection.typography,
      creditsUsed: creditCost,
      creditsRemaining,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Cover art generation failed";
    await refundAndFail(500, msg, { userId: req.userId, err: msg, input });
  }
});

export default router;
