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

/* ─── AI thumbnail background generator ───
   Generates 3 thumbnail background images from a theme/mood — pure visuals
   with NO text, composed with clear negative space so the user's own
   overlay text reads perfectly on top.
   200 Visual Bucs (covers 3 generations). */

const THUMB_BG_COST = 200;

const thumbBgSchema = z.object({
  theme: z.string().trim().min(2).max(300),
  /** Optional extra mood/vibe to steer the art direction. */
  mood: z.string().trim().max(200).optional().default(""),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).optional().default("16:9"),
});

/* Three composition directions — all leave room for text overlay. */
const COMPOSITIONS = [
  {
    id: "dark-drama",
    label: "Dark Drama",
    blurb: "Dark moody background, open space at top for big text",
    styleSuffix:
      "dark dramatic thumbnail background, rich shadows, cinematic depth, wide open negative space at the top third for text overlay",
  },
  {
    id: "bright-pop",
    label: "Bright Pop",
    blurb: "Bright vibrant background, clean area on the left for text",
    styleSuffix:
      "bright vibrant thumbnail background, punchy saturated colors, clean uncluttered negative space on the left third for text overlay",
  },
  {
    id: "depth-side",
    label: "Depth Focus",
    blurb: "Shallow depth of field, subject right, text space left",
    styleSuffix:
      "shallow depth of field thumbnail background, blurred bokeh, single striking visual element on the right side, generous empty space on the left for text overlay",
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

router.get("/thumb-background/styles", requireAuth, (_req, res) => {
  res.json({
    styles: COMPOSITIONS.map((c) => ({
      id: c.id,
      label: c.label,
      blurb: c.blurb,
    })),
  });
});

router.post("/thumb-background", requireAuth, async (req, res) => {
  const parsed = thumbBgSchema.safeParse(req.body ?? {});
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
  if (currentCredits < THUMB_BG_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, THUMB_BG_COST, {
      action: "Thumbnail Backgrounds (3)",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "thumb-bg-"));

  try {
    const { theme, mood, aspectRatio } = parsed.data;
    const moodHint = mood ? ` ${mood} mood,` : "";
    const ratioHint =
      aspectRatio === "9:16"
        ? " Vertical 9:16 composition."
        : aspectRatio === "1:1"
          ? " Square 1:1 composition."
          : " Wide 16:9 composition.";

    const results = await Promise.all(
      COMPOSITIONS.map(async (composition, i) => {
        const fullPrompt =
          `YouTube thumbnail background image about "${theme}".` +
          `${moodHint} ${composition.styleSuffix}.` +
          " IMPORTANT: no text, no words, no letters, no typography anywhere in the image — pure visual background only." +
          ratioHint;
        const imagePath = join(workDir, `bg-${i}.png`);
        await generateImage(fullPrompt, imagePath);

        const buffer = await readFile(imagePath);
        const objectName = `thumb-bg/${req.userId}/${randomUUID()}.png`;
        const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "image/png");
        const url = await refreshSupabaseStorageUrl(storageRef);

        return {
          styleId: composition.id,
          label: composition.label,
          blurb: composition.blurb,
          url,
          storageRef,
        };
      })
    );

    res.json({
      backgrounds: results,
      theme,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Thumbnail background generation failed.";
    req.log.error({ err: message }, "[thumb-background] failed");
    await refundCredits(req.userId!, THUMB_BG_COST, {
      action: "Thumbnail Backgrounds — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
