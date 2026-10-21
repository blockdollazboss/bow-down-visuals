import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { toFile } from "openai";
import { getOpenAI } from "../lib/ai-clients";
import { publicApiLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../lib/credits";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../lib/objectStorage";

const router = Router();

/** 75 Visual Bucs total — matches the credit registry entry for this path. */
const VARIANTS_COST = 75;
/** Image model — env-overridable like the other image routes. */
const IMAGE_MODEL = process.env["OPENAI_IMAGE_MODEL"] || "gpt-image-2.5";

const bodySchema = z.object({
  sourceImageUrl: z.string().url().max(2000),
  title: z.string().max(200).optional().default(""),
  niche: z.string().max(100).optional().default(""),
});

interface VariantSpec {
  label: string;
  prompt: string;
}

/** Download the generated source thumbnail so it can ride along as the edit reference. */
async function fetchSourceFile(sourceImageUrl: string) {
  const resp = await fetch(sourceImageUrl, { redirect: "follow" });
  if (!resp.ok) {
    throw new Error(`Could not fetch source thumbnail (HTTP ${resp.status}).`);
  }
  const contentType = resp.headers.get("content-type") || "image/png";
  const buffer = Buffer.from(await resp.arrayBuffer());
  if (buffer.length === 0) {
    throw new Error("Source thumbnail download returned no data.");
  }
  return await toFile(buffer, "thumbnail-source.png", { type: contentType });
}

router.post("/wave8/thumbnail-ab/variants", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }
  const { sourceImageUrl, title, niche } = parsed.data;

  /* Provider key check FIRST — 503 with no charge when the key is absent. */
  let openai;
  try {
    openai = getOpenAI();
  } catch {
    res.status(503).json({
      error: "ai_unavailable",
      message: "AI image generation is not configured on this server.",
    });
    return;
  }

  let creditsRemaining = req.userCredits ?? 0;
  try {
    creditsRemaining = await chargeCredits(req.userId!, VARIANTS_COST, {
      action: "Thumbnail A/B Variants",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits" });
      return;
    }
    throw err;
  }

  const contextBits = [title.trim(), niche.trim()].filter(Boolean);
  const subject = contextBits.length > 0 ? ` ("${contextBits.join(" — ")}")` : "";
  const variantSpecs: VariantSpec[] = [
    {
      label: "Variant A — Bold text layout",
      prompt:
        `Redesign this YouTube thumbnail${subject} keeping the exact same subject and characters, ` +
        `but with a bolder text layout: huge punchy high-contrast title words, fewer words, ` +
        `text repositioned to the strongest compositional spot, heavy drop shadow, ` +
        `gold luxury accents (#C9A84C), crisp and scroll-stopping.`,
    },
    {
      label: "Variant B — Close-up + high contrast",
      prompt:
        `Redesign this YouTube thumbnail${subject} keeping the exact same subject and characters, ` +
        `but as a dramatic close-up crop: tighter framing on the main subject's face/action, ` +
        `much higher contrast and saturation, deeper blacks, vivid gold highlights (#C9A84C), ` +
        `maximum visual punch for a small feed tile.`,
    },
  ];

  try {
    const variants: Array<{ url: string; label: string; prompt: string }> = [];
    let referenceFile: Awaited<ReturnType<typeof toFile>> | null = null;
    try {
      referenceFile = await fetchSourceFile(sourceImageUrl);
    } catch (fetchErr) {
      /* Fall back to pure text-to-image if the source can't be downloaded. */
      logger.warn(
        { userId: req.userId, err: fetchErr instanceof Error ? fetchErr.message : String(fetchErr) },
        "[wave8] thumbnail-ab source fetch failed — falling back to text-to-image",
      );
    }

    for (let i = 0; i < variantSpecs.length; i += 1) {
      const spec = variantSpecs[i]!;
      let b64: string | undefined;
      if (referenceFile) {
        const editResp = await openai.images.edit({
          model: IMAGE_MODEL,
          image: referenceFile,
          prompt: spec.prompt,
          size: "1536x1024",
        });
        b64 = editResp.data?.[0]?.b64_json ?? undefined;
      } else {
        const genResp = await openai.images.generate({
          model: IMAGE_MODEL,
          prompt:
            `YouTube thumbnail art${subject}: ${spec.prompt} ` +
            `16:9 landscape composition, no watermark.`,
          size: "1536x1024",
          n: 1,
        });
        b64 = genResp.data?.[0]?.b64_json ?? undefined;
      }
      if (!b64) {
        throw new Error(`${spec.label} returned no image data.`);
      }

      const objectName = `wave8/thumbnail-ab/${randomUUID()}.png`;
      const storageRef = await uploadMediaToSupabaseStorage(
        objectName,
        Buffer.from(b64, "base64"),
        "image/png",
      );
      const url = await refreshSupabaseStorageUrl(storageRef);
      variants.push({ url, label: spec.label, prompt: spec.prompt });
      logger.info({ userId: req.userId, variant: spec.label }, "[wave8] thumbnail-ab variant complete");
    }

    res.json({ variants, creditsRemaining });
  } catch (err) {
    try {
      await refundCredits(req.userId!, VARIANTS_COST, {
        action: "Thumbnail A/B Variants (refund)",
      });
    } catch {
      /* refund logged inside refundCredits */
    }
    logger.error({ err, userId: req.userId }, "[wave8] thumbnail-ab failed");
    res.status(500).json({ error: "generation_failed" });
  }
});

export default router;
