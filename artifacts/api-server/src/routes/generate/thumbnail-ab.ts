import { Router } from "express";
import { z } from "zod";
import { writeFile, readFile, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";

const router = Router();

/* ─── Thumbnail A/B testing ───
   Generates 3 different thumbnail variations from one prompt, each with a
   different style/angle, so the user can A/B test which performs best.
   300 Visual Bucs (covers 3 generations). */

const THUMBNAIL_AB_COST = 300;

const thumbnailAbSchema = z.object({
  prompt: z.string().trim().min(3).max(2000),
  /** Optional overlay text baked into the art direction. */
  overlayText: z.string().trim().max(120).optional().default(""),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).optional().default("16:9"),
});

/* Three distinct style/angle directions for the A/B variants. */
const VARIATIONS = [
  {
    id: "bold-pop",
    label: "Bold Pop",
    blurb: "High-contrast, punchy colors, big visual energy",
    styleSuffix:
      "bold vibrant high-contrast thumbnail style, saturated punchy colors, dramatic lighting, eye-catching composition",
  },
  {
    id: "cinematic",
    label: "Cinematic",
    blurb: "Moody, film-still look with depth",
    styleSuffix:
      "cinematic film-still style, moody lighting, shallow depth of field, dramatic atmosphere, premium look",
  },
  {
    id: "clean-minimal",
    label: "Clean Minimal",
    blurb: "Simple, uncluttered, strong focal point",
    styleSuffix:
      "clean minimalist thumbnail style, simple uncluttered composition, strong single focal point, soft balanced lighting",
  },
] as const;

async function generateImage(prompt: string, outputPath: string): Promise<void> {
  const model = process.env.OPENAI_IMAGE_MODEL || "dall-e-3";
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      size: "1792x1024",
      quality: "standard",
      n: 1,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) throw new Error("Image generation failed.");
  const data = (await response.json()) as { data?: Array<{ url?: string }> };
  const imageUrl = data.data?.[0]?.url;
  if (!imageUrl) throw new Error("No image URL returned.");

  const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(120_000) });
  if (!imgRes.ok) throw new Error("Could not download generated image.");
  await writeFile(outputPath, Buffer.from(await imgRes.arrayBuffer()));
}

router.get("/thumbnail-ab/variations", requireAuth, (_req, res) => {
  res.json({
    variations: VARIATIONS.map((v) => ({
      id: v.id,
      label: v.label,
      blurb: v.blurb,
    })),
  });
});

router.post("/thumbnail-ab", requireAuth, async (req, res) => {
  const parsed = thumbnailAbSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < THUMBNAIL_AB_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, THUMBNAIL_AB_COST, {
      action: "Thumbnail A/B Test",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "thumbnail-ab-"));

  try {
    const { prompt, overlayText, aspectRatio } = parsed.data;
    const textHint = overlayText
      ? ` Leave clear negative space for the text overlay: "${overlayText}".`
      : "";
    const ratioHint =
      aspectRatio === "9:16"
        ? " Vertical 9:16 composition."
        : aspectRatio === "1:1"
          ? " Square 1:1 composition."
          : " Wide 16:9 composition.";

    const results = await Promise.all(
      VARIATIONS.map(async (variation, i) => {
        const fullPrompt = `${prompt}. ${variation.styleSuffix}.${textHint}${ratioHint}`;
        const imagePath = join(workDir, `variant-${i}.png`);
        await generateImage(fullPrompt, imagePath);

        const buffer = await readFile(imagePath);
        const objectName = `thumbnail-ab/${req.userId}/${randomUUID()}.png`;
        const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "image/png");
        const url = await refreshSupabaseStorageUrl(storageRef);

        return {
          variationId: variation.id,
          label: variation.label,
          blurb: variation.blurb,
          url,
          storageRef,
        };
      })
    );

    res.json({
      variants: results,
      prompt,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Thumbnail A/B generation failed.";
    req.log.error({ err: message }, "[thumbnail-ab] failed");
    await refundCredits(req.userId!, THUMBNAIL_AB_COST, {
      action: "Thumbnail A/B Test — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
