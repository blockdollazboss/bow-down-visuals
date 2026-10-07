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

/* ─── AI chapter art generator ───
   Generates a small branded chapter thumbnail image for a video chapter —
   gold/black Bow Down Visuals styling with the chapter title rendered as
   bold, readable text. 150 Visual Bucs. */

const CHAPTER_ART_COST = Number(process.env["CHAPTER_ART_CREDITS"]) || 150;

const STYLES = [
  {
    id: "gold-luxury",
    label: "Gold Luxury",
    blurb: "Black background, gold accents — matches the Bow Down brand",
    styleSuffix:
      "luxurious gold-on-black design, dark charcoal background, rich metallic gold accents and borders, elegant premium feel",
  },
  {
    id: "neon-pop",
    label: "Neon Pop",
    blurb: "Bright neon energy for gaming and entertainment chapters",
    styleSuffix:
      "bold neon design, electric purple and gold glow effects on dark background, high-energy gaming aesthetic",
  },
  {
    id: "minimal",
    label: "Minimal Clean",
    blurb: "Simple and clean for tutorials and education chapters",
    styleSuffix:
      "clean minimal design, soft dark gradient background, subtle gold line accents, professional and uncluttered",
  },
] as const;

const chapterArtSchema = z.object({
  chapterTitle: z.string().trim().min(2).max(120),
  videoTopic: z.string().trim().min(2).max(300),
  style: z.enum(["gold-luxury", "neon-pop", "minimal"]).optional().default("gold-luxury"),
});

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
      size: "1024x1024",
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

router.get("/chapter-art/styles", requireAuth, (_req, res) => {
  res.json({
    styles: STYLES.map((s) => ({
      id: s.id,
      label: s.label,
      blurb: s.blurb,
    })),
  });
});

router.post("/chapter-art", requireAuth, async (req, res) => {
  const parsed = chapterArtSchema.safeParse(req.body ?? {});
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
  if (currentCredits < CHAPTER_ART_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, CHAPTER_ART_COST, {
      action: "Chapter Art",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "chapter-art-"));

  try {
    const { chapterTitle, videoTopic, style } = parsed.data;
    const chosen = STYLES.find((s) => s.id === style) ?? STYLES[0];

    const fullPrompt =
      `Square 1:1 YouTube chapter thumbnail card about "${chapterTitle}" for a video about "${videoTopic}". ` +
      `${chosen.styleSuffix}. ` +
      `Render the exact text "${chapterTitle}" as large, bold, perfectly spelled, centered title text. ` +
      "Keep the text short and punchy if needed, but spell it exactly right. No other text.";

    const imagePath = join(workDir, "chapter-art.png");
    await generateImage(fullPrompt, imagePath);

    const buffer = await readFile(imagePath);
    const objectName = `chapter-art/${req.userId}/${randomUUID()}.png`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "image/png");
    const url = await refreshSupabaseStorageUrl(storageRef);

    res.json({
      url,
      storageRef,
      chapterTitle,
      style: chosen.id,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Chapter art generation failed.";
    req.log.error({ err: message }, "[chapter-art] failed");
    await refundCredits(req.userId!, CHAPTER_ART_COST, {
      action: "Chapter Art — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
