import { Router } from "express";
import { z } from "zod";
import { writeFile, readFile, mkdtemp } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../../lib/objectStorage";

const router = Router();

/* ─── Social media kit generator ───
   Generates a complete branded social kit in one shot:
   - profile picture (1024×1024)
   - YouTube banner (2560×1440)
   - Twitter/X header (1500×500)
   - Instagram highlight covers (1080×1920 each)
   All assets share one consistent brand style. 400 Visual Bucs. */

const SOCIAL_KIT_COST = Number(process.env["SOCIAL_KIT_CREDITS"]) || 400;

const STYLES = [
  {
    id: "gold-luxury",
    label: "Gold Luxury",
    blurb: "Black background, gold accents — the Bow Down signature look",
    styleSuffix:
      "luxurious gold-on-black design, dark charcoal background, rich metallic gold accents and borders, elegant premium feel",
  },
  {
    id: "neon-pop",
    label: "Neon Pop",
    blurb: "Bright neon energy for gaming and entertainment brands",
    styleSuffix:
      "bold neon design, electric purple and gold glow effects on dark background, high-energy modern aesthetic",
  },
  {
    id: "minimal",
    label: "Minimal Clean",
    blurb: "Simple and clean for professionals and educators",
    styleSuffix:
      "clean minimal design, soft dark gradient background, subtle gold line accents, professional and uncluttered",
  },
] as const;

const ASSET_SPECS = [
  { id: "profile-picture", label: "Profile picture", width: 1024, height: 1024, genSize: "1024x1024" as const },
  { id: "youtube-banner", label: "YouTube banner", width: 2560, height: 1440, genSize: "1792x1024" as const },
  { id: "twitter-header", label: "Twitter/X header", width: 1500, height: 500, genSize: "1792x1024" as const },
  { id: "highlight-covers", label: "Instagram highlight covers", width: 1080, height: 1920, genSize: "1024x1792" as const },
] as const;

const socialKitSchema = z.object({
  brandName: z.string().trim().min(2).max(60),
  tagline: z.string().trim().min(2).max(120),
  style: z.enum(["gold-luxury", "neon-pop", "minimal"]).optional().default("gold-luxury"),
  highlightNames: z
    .array(z.string().trim().min(1).max(24))
    .min(1)
    .max(4)
    .optional()
    .default(["About", "Music", "Videos", "Tour"]),
});

const execFileAsync = promisify(execFile);

async function generateImage(prompt: string, size: string, outputPath: string): Promise<void> {
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
      size,
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

/** Resize/crop a generated image to exact platform dimensions (cover fit). */
async function fitToSize(inputPath: string, outputPath: string, width: number, height: number): Promise<void> {
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    inputPath,
    "-vf",
    `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
    "-frames:v",
    "1",
    outputPath,
  ], { timeout: 120_000 });
}

router.get("/social-kit/specs", requireAuth, (_req, res) => {
  res.json({
    assets: ASSET_SPECS.map((a) => ({
      id: a.id,
      label: a.label,
      width: a.width,
      height: a.height,
    })),
    styles: STYLES.map((s) => ({ id: s.id, label: s.label, blurb: s.blurb })),
    cost: SOCIAL_KIT_COST,
  });
});

router.post("/social-kit", requireAuth, async (req, res) => {
  const parsed = socialKitSchema.safeParse(req.body ?? {});
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
  if (currentCredits < SOCIAL_KIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, SOCIAL_KIT_COST, {
      action: "Social Media Kit",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "social-kit-"));

  try {
    const { brandName, tagline, style, highlightNames } = parsed.data;
    const chosen = STYLES.find((s) => s.id === style) ?? STYLES[0];
    const base = `${chosen.styleSuffix}. Spell all text exactly right. No other text.`;

    const jobId = randomUUID();
    const assets: Array<{ asset: string; url: string; storageRef: string; width: number; height: number }> = [];

    async function buildAsset(
      assetId: string,
      prompt: string,
      genSize: string,
      width: number,
      height: number,
      filename: string
    ): Promise<void> {
      const rawPath = join(workDir, `raw-${filename}.png`);
      const finalPath = join(workDir, `${filename}.png`);
      await generateImage(prompt, genSize, rawPath);
      if (width === 1024 && height === 1024) {
        // Already exact.
        await writeFile(finalPath, await readFile(rawPath));
      } else {
        await fitToSize(rawPath, finalPath, width, height);
      }
      const buffer = await readFile(finalPath);
      const objectName = `social-kit/${req.userId}/${jobId}/${filename}.png`;
      const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "image/png");
      const url = await refreshSupabaseStorageUrl(storageRef);
      assets.push({ asset: assetId, url, storageRef, width, height });
    }

    // 1. Profile picture — logo-style mark.
    await buildAsset(
      "profile-picture",
      `Square 1:1 social media profile picture / logo mark for a brand called "${brandName}". ${base} ` +
        `Centered emblem design with the exact text "${brandName}" as a short bold brand mark. Clean, iconic, readable at small sizes.`,
      "1024x1024",
      1024,
      1024,
      "profile-picture"
    );

    // 2. YouTube banner.
    await buildAsset(
      "youtube-banner",
      `Wide YouTube channel banner art for "${brandName}". ${base} ` +
        `Render the exact text "${brandName}" as a large bold headline and the exact text "${tagline}" as a smaller subtitle beneath it. ` +
        `Keep the center area clear of critical elements so it is safe on all devices.`,
      "1792x1024",
      2560,
      1440,
      "youtube-banner"
    );

    // 3. Twitter/X header.
    await buildAsset(
      "twitter-header",
      `Wide Twitter/X profile header banner for "${brandName}". ${base} ` +
        `Render the exact text "${brandName}" as a bold headline on the left side with the exact text "${tagline}" beneath it. ` +
        `Keep the left-center area clear for the profile photo overlap.`,
      "1792x1024",
      1500,
      500,
      "twitter-header"
    );

    // 4. Instagram highlight covers.
    for (let i = 0; i < highlightNames.length; i++) {
      const name = highlightNames[i]!;
      await buildAsset(
        `highlight-cover-${i + 1}`,
        `Vertical 9:16 Instagram story highlight cover icon for "${name}". ${base} ` +
          `Simple centered icon-style design with the exact text "${name}" as a small bold label at the bottom. Minimal, readable at small sizes.`,
        "1024x1792",
        1080,
        1920,
        `highlight-cover-${i + 1}`
      );
    }

    res.json({
      brandName,
      style: chosen.id,
      assets,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Social kit generation failed.";
    req.log.error({ err: message }, "[social-kit] failed");
    await refundCredits(req.userId!, SOCIAL_KIT_COST, {
      action: "Social Media Kit — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
