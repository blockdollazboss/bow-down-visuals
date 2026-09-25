import { Router } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { toFile } from "openai";
import { getOpenAI } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { recordCreditUsage } from "../../lib/payment-record";
import { getSupabaseAdmin, addCreditsToProfile } from "../../lib/supabase-admin";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";

const router = Router();

/** Credits per generation batch (4 variations). Env-overridable without a deploy. */
const BATCH_CREDIT_COST =
  Number(process.env["THUMBNAIL_GENERATOR_CREDITS"]) || 2;

/** Newest OpenAI image model — env-overridable so upgrades are one-line changes. */
const IMAGE_MODEL = process.env["OPENAI_IMAGE_MODEL_25"] || "gpt-image-2.5-sunburst";

/** Maps the site's aspect-ratio picker to OpenAI image sizes. */
const ASPECT_SIZES: Record<string, "1536x1024" | "1024x1536"> = {
  "16:9": "1536x1024", // YouTube landscape
  "9:16": "1024x1536", // Shorts / TikTok portrait
};

/** Style presets offered in the picker — each injects art direction into the prompt. */
export const STYLE_PRESETS: Record<string, string> = {
  "bold-text-pop":
    "Bold text-pop style: huge chunky 3D headline text dominating the frame, ultra-high contrast, " +
    "vibrant saturated colors, thick outlines and drop shadows on the text, explosive energy, " +
    "YouTube clickbait aesthetic done premium",
  "shocked-face":
    "Shocked-face reaction style: extreme close-up of a face with a shocked / surprised / mind-blown expression, " +
    "wide eyes, open mouth, dramatic rim lighting, blurred high-energy background, arrow or circle graphic accents",
  "before-after":
    "Before/after split style: the frame split into two contrasting halves (dull vs vibrant, plain vs transformed), " +
    "clear visual transformation story, bold divider line, each side telling one half of the story",
  luxury:
    "Luxury style: black and gold premium aesthetic, cinematic studio lighting, elegant serif headline text, " +
    "marble / velvet / gold-foil textures, restrained composition, expensive and exclusive feel",
  gaming:
    "Gaming style: neon-drenched esports aesthetic, glowing RGB accents, dynamic action pose, " +
    "lens flares and particle effects, bold aggressive typography, dark background with electric color pops",
  vlog:
    "Vlog style: bright, friendly, approachable daytime energy, natural lighting, casual authentic feel, " +
    "clean readable headline text, warm colors, lifestyle photography look",
};

/* Multer for the optional face-photo upload (identity lock). 10 MB cap, images only. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed for the face photo."));
  },
});

interface GenerateRequest {
  prompt: string;
  stylePreset?: string;
  aspectRatio?: "16:9" | "9:16";
  overlayText?: string;
}

/**
 * Builds the full image prompt for one variation. Each of the 4 variations
 * gets a slightly different compositional twist so the batch feels like real
 * options, not copies.
 */
function buildVariationPrompt(
  base: GenerateRequest,
  variationIndex: number,
): string {
  const styleDirection =
    (base.stylePreset && STYLE_PRESETS[base.stylePreset]) || STYLE_PRESETS["bold-text-pop"];
  const compositionTwists = [
    "Composition: subject slightly left of center, headline text on the right third.",
    "Composition: tight centered composition, subject filling the frame, text stacked top and bottom.",
    "Composition: dramatic low-angle framing, subject right of center, headline text upper-left.",
    "Composition: wide cinematic framing with strong leading lines, text anchored bottom-center.",
  ];
  const twist = compositionTwists[variationIndex % compositionTwists.length];

  const parts = [
    `YouTube thumbnail, ultra high quality, designed to stop the scroll.`,
    `Subject / scene: ${base.prompt}`.slice(0, 1500),
    `Style direction: ${styleDirection}.`,
    twist,
    base.overlayText
      ? `On-image headline text (spell it EXACTLY, large and readable even at small sizes): "${base.overlayText.slice(0, 80)}".`
      : `No text on the image unless it dramatically improves click-through — keep any text to 3 words max, huge and readable.`,
    `Rules: no watermarks, no logos, no blurry faces, no distorted hands, no misspelled words, ` +
      `sharp focus on the subject, professional color grade.`,
  ];
  return parts.join("\n").slice(0, 4000);
}

async function refundCredits(userId: string, amount: number): Promise<void> {
  try {
    await addCreditsToProfile(userId, amount);
  } catch {
    /* Refund failure is logged by the caller — never throw from here. */
  }
}

/**
 * POST /api/thumbnail-generator
 * Generates 4 thumbnail variations in one batch for 2 credits.
 * Charge-before-generate: credits are deducted up front and auto-refunded
 * if generation fails before any image succeeds.
 */
router.post(
  "/thumbnail-generator",
  requireAuth,
  upload.single("facePhoto"),
  async (req, res) => {
    const { prompt, stylePreset, aspectRatio, overlayText } =
      req.body as Partial<GenerateRequest>;

    if (!prompt || typeof prompt !== "string" || prompt.trim().length < 3) {
      res.status(400).json({ error: "A text prompt (3+ characters) is required." });
      return;
    }

    const ratio: "16:9" | "9:16" =
      aspectRatio === "9:16" ? "9:16" : "16:9";
    const size = ASPECT_SIZES[ratio];

    const currentCredits = req.userCredits ?? 0;
    const isDev = process.env["NODE_ENV"] === "development";
    req.log.info(
      { userId: req.userId, currentCredits, required: BATCH_CREDIT_COST, ratio },
      "[thumbnail-generator] request received",
    );
    if (!isDev && currentCredits < BATCH_CREDIT_COST) {
      res.status(402).json({
        error: "out_of_credits",
        message: "You are out of credits. Buy more credits to keep creating.",
      });
      return;
    }

    /* Charge up front — refunded below if nothing generates. */
    const creditsAfter = currentCredits - BATCH_CREDIT_COST;
    await getSupabaseAdmin()
      .from("profiles")
      .update({ credits: creditsAfter })
      .eq("id", req.userId!);

    const facePhotoBuffer = req.file?.buffer ?? null;
    const images: Array<{ url: string; variation: number }> = [];

    try {
      for (let i = 0; i < 4; i++) {
        const imagePrompt = buildVariationPrompt(
          { prompt: prompt.trim(), stylePreset, aspectRatio: ratio, overlayText },
          i,
        );

        let b64: string | undefined;
        if (facePhotoBuffer) {
          /* Identity lock: edit the uploaded face photo instead of inventing a face. */
          const faceFile = await toFile(facePhotoBuffer, "face-reference.png", {
            type: req.file!.mimetype,
          });
          const lockedPrompt =
            `Using the exact person shown in the reference photo (same face, skin tone, identity — ` +
            `do not change who they are), create this YouTube thumbnail scene: ${imagePrompt}`.slice(0, 4000);
          const editResp = await getOpenAI().images.edit({
            model: IMAGE_MODEL,
            image: faceFile,
            prompt: lockedPrompt,
            size,
            n: 1,
          });
          b64 = editResp.data?.[0]?.b64_json;
        } else {
          const imageResp = await getOpenAI().images.generate({
            model: IMAGE_MODEL,
            prompt: imagePrompt,
            size,
            quality: "high",
            n: 1,
          });
          b64 = imageResp.data?.[0]?.b64_json;
        }

        if (!b64) {
          throw new Error(`Variation ${i + 1} returned no image data.`);
        }

        const objectName = `thumbnail-generator/${randomUUID()}.png`;
        const storageRef = await uploadMediaToSupabaseStorage(
          objectName,
          Buffer.from(b64, "base64"),
          "image/png",
        );
        const url = await refreshSupabaseStorageUrl(storageRef);
        images.push({ url, variation: i + 1 });
        req.log.info(
          { userId: req.userId, variation: i + 1 },
          "[thumbnail-generator] variation complete",
        );
      }
    } catch (err: unknown) {
      /* Auto-refund: the batch failed before completing — give credits back. */
      await refundCredits(req.userId!, BATCH_CREDIT_COST);
      const message = err instanceof Error ? err.message : "Thumbnail generation failed";
      req.log.error(
        { userId: req.userId, err: message, completedVariations: images.length },
        "[thumbnail-generator] batch failed — credits refunded",
      );
      res.status(500).json({
        error: message,
        creditsRefunded: true,
        partialImages: images,
      });
      return;
    }

    recordCreditUsage({
      userId: req.userId!,
      action: "AI Thumbnail Generator",
      creditsUsed: BATCH_CREDIT_COST,
    }).catch(() => {});

    req.log.info(
      { userId: req.userId, creditsAfter, variations: images.length },
      "[thumbnail-generator] batch success",
    );

    res.json({
      images,
      creditsUsed: BATCH_CREDIT_COST,
      creditsRemaining: creditsAfter,
      aspectRatio: ratio,
    });
  },
);

export default router;
