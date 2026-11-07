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
import { r2Upload } from "../../lib/r2-client";
import { logger } from "../../lib/logger";
import { attributionOptIn, burnAttributionIntoImage } from "../../lib/attribution";

const router = Router();

/* ─── Pricing ───────────────────────────────────────────────────────────────
   200 Visual Bucs standard / 300 premium — in line with site image
   pricing. Env-overridable without a deploy.
   REGISTRY: this route owns the cover-art lists of record (styles,
   ratios, tier prices below). The FE mirror in lib/cover-art.ts is
   pinned to them by cover-art-registry-parity.test.ts — edit here
   and the pin carries the change; edit only the FE and it fails. */
export const COVER_ART_STANDARD_CREDITS =
  Number(process.env["COVER_ART_STANDARD_CREDITS"]) || 200;
export const COVER_ART_PREMIUM_CREDITS =
  Number(process.env["COVER_ART_PREMIUM_CREDITS"]) || 300;

/** Newest OpenAI image model — env-overridable so upgrades are one-line changes. */
const IMAGE_MODEL = process.env["OPENAI_IMAGE_MODEL_25"] || "gpt-image-2.5-sunburst";

/** Supabase Storage bucket for generated cover art. */
const COVER_ART_BUCKET = "artist-references";

/* ─── Style presets ─────────────────────────────────────────────────────────
   The registry of record — coverArtSchema validates against these keys
   and resolveCoverArtStyle reads the direction from here. The FE mirror
   adds only its swatch field; key/label/blurb are pinned identical. */
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

/* ─── Aspect ratios ─────────────────────────────────────────────────────────
   The registry of record — the FE mirror adds only its css field;
   key/label/blurb are pinned identical. */
export const COVER_ART_RATIOS = [
  { key: "1:1", label: "Square 1:1", blurb: "Streaming platforms", size: "1024x1024" },
  { key: "16:9", label: "Wide 16:9", blurb: "YouTube banner", size: "1536x1024" },
  { key: "9:16", label: "Story 9:16", blurb: "Stories & Shorts", size: "1024x1536" },
] as const;

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

/* ─── Layout templates ──────────────────────────────────────────────────────
   Composition templates on top of styles + ratios: where the title sits,
   where the artist name goes, which zone stays clean for them. The FE
   mirror lives in lib/cover-art.ts (COVER_ART_LAYOUTS — keep keys, labels,
   and blurbs in sync). Layout is OPTIONAL on the request: when a client
   sends none, the prompts are built exactly as they were before layouts
   existed — the art director free-styles the typography. */
export const COVER_ART_LAYOUTS = [
  {
    key: "center-stage",
    label: "Center Stage",
    blurb: "Title front and center, artist right beneath",
    direction:
      "centered composition — the song title sits dead-center of the frame " +
      "at hero size in a bold stacked treatment, with the artist name " +
      "directly beneath it in smaller letter-spaced capitals; the artwork's " +
      "subject frames the center so the text zone stays clean and uncluttered",
    imageZone:
      "Leave the center of the composition clean and uncluttered where the song title will sit.",
  },
  {
    key: "headline-top",
    label: "Headline Top",
    blurb: "Artist up top, title right under it — classic billing",
    direction:
      "classic top billing — the artist name in small capitals across the " +
      "very top of the frame, the song title large directly beneath it; " +
      "the artwork's subject fills the lower two-thirds and the top band " +
      "stays clean for the text",
    imageZone:
      "Leave a clean uncluttered band across the top of the composition where the title will sit.",
  },
  {
    key: "bottom-band",
    label: "Bottom Band",
    blurb: "Artwork breathes up top, title band along the bottom",
    direction:
      "the artwork fills the upper two-thirds of the frame; a clean band " +
      "across the bottom carries the song title large and left-aligned, " +
      "with the artist name beneath it in smaller type",
    imageZone:
      "Leave a clean uncluttered band across the bottom of the composition where the title will sit.",
  },
  {
    key: "split-frame",
    label: "Split Frame",
    blurb: "Subject on one side, words on the other",
    direction:
      "split composition — the artwork's subject occupies the right half " +
      "of the frame while the left half stays clean and uncluttered for a " +
      "left-aligned text block: the song title large near the top, the " +
      "artist name beneath it",
    imageZone:
      "Leave the left half of the composition clean and uncluttered where the title will sit.",
  },
  {
    key: "corner-mark",
    label: "Corner Mark",
    blurb: "Small title block in the corner — art does the talking",
    direction:
      "artwork-first composition filling the whole frame; the only text " +
      "is a small block tucked into the bottom-left corner — the song " +
      "title in compact type with the artist name beneath it — and " +
      "everything else stays pure artwork",
    imageZone:
      "Leave only a small clean area in the bottom-left corner where the title will sit, and fill the rest of the frame fully.",
  },
  {
    key: "corner-seal",
    label: "Corner Seal",
    blurb: "Title up top, artist at the foot, corner kept clear for a seal",
    direction:
      "the song title sits centered across the top of the frame at medium " +
      "size and the artist name sits centered at the very bottom in small " +
      "type; the bottom-right corner stays clean and uncluttered, " +
      "reserved for a small seal or badge",
    imageZone:
      "Leave a clean uncluttered strip across the top of the composition and keep the bottom-right corner clear where the title and a small seal will sit.",
  },
  {
    key: "pure-art",
    label: "Pure Art",
    blurb: "No words at all — the artwork is the cover",
    direction:
      "no typography at all — the artwork fills the entire frame edge to " +
      "edge and no text zone is reserved; the image alone is the cover",
    imageZone: "Fill the entire frame with the artwork — no text zone needed.",
  },
  {
    key: "tracklist-back",
    label: "Tracklist Back",
    blurb: "The back cover — tracklist, credits and a barcode corner",
    direction:
      "back-cover composition — the artist name sits in small capitals " +
      "across the very top with the album title at medium size directly " +
      "beneath it; below them a clean tracklist block runs down the left " +
      "with a credits column beside it, and the bottom-right corner " +
      "stays clear, reserved for a barcode",
    imageZone:
      "Keep the frame calm and readable behind a tracklist and credits, and keep the bottom-right corner clear where a barcode will sit.",
  },
  {
    key: "frame-in-frame",
    label: "Frame in Frame",
    blurb: "Art inside a matted frame, title in the mat below",
    direction:
      "framed composition — the artwork sits inside an inset bordered " +
      "frame, like a picture in a mat, filling the upper portion of the " +
      "cover; the song title is set in the mat band beneath the frame " +
      "with the artist name below it in smaller type",
    imageZone:
      "Concentrate the artwork in the upper portion inside an inset frame, and leave the band beneath the frame clean where the title will sit.",
  },
  {
    key: "magazine-cover",
    label: "Magazine Cover",
    blurb: "Editorial masthead up top, cover lines down the sides",
    direction:
      "editorial magazine composition — a bold masthead title spans the " +
      "top of the frame at hero size with the artist name beneath it in " +
      "smaller type; short cover lines run down both sides and a feature " +
      "image fills the whole cover behind the text",
    imageZone:
      "Fill the entire frame with the feature artwork, keeping the top strip and both side edges calm enough for a masthead and cover lines.",
  },
] as const;
export type CoverArtLayoutKey = (typeof COVER_ART_LAYOUTS)[number]["key"];

/** No key (or an absent field) means freeform — returns undefined so the
    prompt builders can leave their wording exactly as it was pre-layouts. */
export function resolveCoverArtLayout(key: string | undefined) {
  if (!key) return undefined;
  return COVER_ART_LAYOUTS.find((l) => l.key === key);
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
  /** Optional composition template — absent means freeform (pre-layout behavior). */
  layout: z
    .string()
    .refine((v) => COVER_ART_LAYOUTS.some((l) => l.key === v), {
      message: "Unknown layout template.",
    })
    .optional(),
  tier: z.enum(["standard", "premium"]).default("standard"),
  /** Virality: opt-in "Made with Bow Down Visuals" corner credit burned post-generation (paid export → opt-in). */
  attribution: attributionOptIn(),
});
type CoverArtInput = z.infer<typeof coverArtSchema>;

interface ArtDirection {
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
  const layout = resolveCoverArtLayout(input.layout);
  const layoutLine = layout ? ` Layout: ${layout.direction}.` : "";
  return {
    model: getTextModel(),
    messages: [
      {
        role: "system" as const,
        content:
          `You are an award-winning album-cover art director. ` +
          `Design a cover for the song "${input.songTitle}" by ${input.artistName}.${moodLine} ` +
          `Style: ${style.direction}.${layoutLine} ` +
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
  /* With a layout, the clean zone moves to the layout's placement; without
     one this sentence is byte-identical to the pre-layout wording. */
  const layout = resolveCoverArtLayout(input.layout);
  const zoneLine = layout
    ? ` ${layout.imageZone}`
    : " Leave a clean uncluttered area in the composition where a song title can be placed.";
  return (
    `Album cover artwork, no text, no words, no letters, no logos. ` +
    `${style.direction}.${conceptLine}${paletteLine}` +
    `${zoneLine} ` +
    `Professional music-industry quality, high detail, striking focal point.`
  ).slice(0, 4000);
}

/* ─── Reusable image generation (lyric-stories + friends) ─────────────────
   Standalone wrapper around the same GPT Image pipeline this route uses, so
   other routes can generate artwork without duplicating provider code. */
interface CoverImageJob {
  prompt: string;
  ratio: "1:1" | "16:9" | "9:16";
  tier: "standard" | "premium";
}

export async function generateCoverImageBuffer(job: CoverImageJob): Promise<Buffer> {
  const imageResp = await getOpenAI().images.generate({
    model: IMAGE_MODEL,
    prompt: job.prompt,
    size: resolveCoverArtSize(job.ratio),
    quality: job.tier === "premium" ? "high" : "medium",
    n: 1,
  });
  const b64 = imageResp.data?.[0]?.b64_json;
  if (!b64) throw new Error("Image generation returned no image data.");
  return Buffer.from(b64, "base64");
}

export async function storeGeneratedArtwork(
  userId: string,
  buffer: Buffer,
  prefix = "cover-art",
): Promise<{ url: string; path: string }> {
  const filePath = `${userId}/${prefix}/${randomUUID()}.png`;
  const publicUrl = await r2Upload(filePath, buffer, "image/png");
  return { url: publicUrl, path: filePath };
}

/* ─── Storage ─────────────────────────────────────────────────────────────── */
async function uploadCoverArt(userId: string, buffer: Buffer): Promise<{ url: string; path: string }> {
  const filePath = `${userId}/cover-art/${randomUUID()}.png`;
  const publicUrl = await r2Upload(filePath, buffer, "image/png");
  return { url: publicUrl, path: filePath };
}

/* ─────────────────────────────────────────────────────────────────────────────
   POST /api/cover-art
   Paid: 200 Visual Bucs standard / 300 premium. Auth required.
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
      message: "Not enough Visual Bucs — top up to generate cover art.",
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
        message: "Not enough Visual Bucs — top up to generate cover art.",
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
      let artBuffer: Buffer = Buffer.from(b64, "base64");
      /* Virality: opt-in quiet corner credit burned post-generation (paid export → opt-in). */
      if (input.attribution) {
        const sizeStr = resolveCoverArtSize(input.aspectRatio);
        const outW = parseInt(sizeStr.split("x")[0] ?? "1024", 10) || 1024;
        artBuffer = await burnAttributionIntoImage(artBuffer, outW);
      }
      stored = await uploadCoverArt(req.userId!, artBuffer);
    } catch (upErr) {
      await refundAndFail(500, "Could not save your cover art — Visual Bucs refunded.", {
        userId: req.userId,
        err: upErr instanceof Error ? upErr.message : upErr,
      });
      return;
    }

    logger.info(
      {
        userId: req.userId,
        style: input.style,
        ratio: input.aspectRatio,
        tier: input.tier,
        layout: input.layout ?? "freeform",
      },
      "[cover-art] generation succeeded",
    );
    res.json({
      url: stored.url,
      path: stored.path,
      attribution: input.attribution,
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
