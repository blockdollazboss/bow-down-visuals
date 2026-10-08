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

/* ─── Release promo cards (DistroKid promo-cards parity) ────────────────────
   AI-designed release-day social cards for one release:
   - one card style per pack: announcement / out-now / pre-save / milestone
   - three platform sizes per pack: 1:1 (feed), 9:16 (stories/reels),
     16:9 (YouTube/banner)
   Pipeline per card:
   1. AI-generate a gold-black luxury background (no text — we burn crisp
      text with ffmpeg, which is always spelled right).
   2. Fit to exact platform dimensions.
   3. Composite the release cover art (when provided) as a framed window.
   4. Burn headline / title / artist + optional "Made with Bow Down Visuals"
      micro-attribution with ffmpeg drawtext.
   100 Visual Bucs per pack (3 cards): 402 pre-check → charge → auto-refund
   on failure. */

const PROMO_CARDS_COST = Number(process.env["PROMO_CARDS_CREDITS"]) || 100;
const FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const ATTRIBUTION_TEXT = "Made with Bow Down Visuals";

const STYLES = [
  {
    id: "announcement",
    label: "Announcement",
    blurb: "Tease the drop — release name, artist, coming soon",
    headline: "ANNOUNCEMENT",
    bgSuffix:
      "dramatic announcement teaser poster background, dark charcoal-to-black gradient with rich metallic gold light rays and particles, mysterious and exciting, cinematic",
    caption: (title: string, artist: string, _milestone: string) =>
      `🚨 ANNOUNCEMENT 🚨\n"${title}" by ${artist} is on the way. Stay locked in. 🔥\n#NewMusic #ComingSoon`,
  },
  {
    id: "out-now",
    label: "Out Now",
    blurb: "Release-day card — streaming everywhere call to action",
    headline: "OUT NOW",
    bgSuffix:
      "explosive release-day poster background, dark black background with molten gold fireworks and glowing embers, triumphant high-energy celebration, cinematic",
    caption: (title: string, artist: string, _milestone: string) =>
      `🔥 OUT NOW 🔥\n"${title}" by ${artist} — streaming everywhere. Link in bio. 🎧\n#OutNow #NewMusic`,
  },
  {
    id: "pre-save",
    label: "Pre-Save",
    blurb: "Drive pre-saves before release day",
    headline: "PRE-SAVE",
    bgSuffix:
      "anticipation-building poster background, deep black background with a glowing gold countdown-style light beam and rising gold dust, urgent and exciting",
    caption: (title: string, artist: string, _milestone: string) =>
      `⏳ PRE-SAVE ⏳\nBe first when "${title}" by ${artist} drops. Hit the link in bio. 🙏\n#PreSave #NewMusic`,
  },
  {
    id: "milestone",
    label: "Milestone",
    blurb: "Celebrate streams, chart positions, anniversaries",
    headline: "", // replaced by the milestone label at render time
    bgSuffix:
      "victory celebration poster background, black background with a golden trophy-glow burst and falling gold confetti, proud triumphant mood, cinematic",
    caption: (title: string, artist: string, milestone: string) =>
      `🏆 ${milestone} 🏆\n"${title}" by ${artist} just hit ${milestone}! Thank you all. 🖤\n#Milestone #ThankYou`,
  },
] as const;

type StyleId = (typeof STYLES)[number]["id"];

const SIZES = [
  {
    id: "1:1",
    label: "Square — Instagram / Facebook feed",
    width: 1080,
    height: 1080,
    genSize: "1024x1024" as const,
    platforms: ["instagram", "facebook"],
  },
  {
    id: "9:16",
    label: "Vertical — TikTok / Reels / Stories",
    width: 1080,
    height: 1920,
    genSize: "1024x1792" as const,
    platforms: ["tiktok", "instagram"],
  },
  {
    id: "16:9",
    label: "Wide — YouTube / X banner",
    width: 1920,
    height: 1080,
    genSize: "1792x1024" as const,
    platforms: ["facebook"],
  },
] as const;

type SizeId = (typeof SIZES)[number]["id"];

/* Text layout per size: artwork window + stacked headline/title/artist.
   16:9 uses a left-artwork / right-text split instead of the stack. */
interface CardLayout {
  artSize: number;
  artX: number;
  artY: number;
  stack: boolean;
  textCenterX: number;
  headlineY: number;
  headlineSize: number;
  titleY: number;
  titleSize: number;
  artistY: number;
  artistSize: number;
  attrY: number;
  attrSize: number;
}

const LAYOUTS: Record<SizeId, CardLayout> = {
  "1:1": {
    artSize: 500, artX: 290, artY: 110, stack: true, textCenterX: 540,
    headlineY: 680, headlineSize: 84, titleY: 790, titleSize: 62,
    artistY: 875, artistSize: 46, attrY: 1032, attrSize: 26,
  },
  "9:16": {
    artSize: 600, artX: 240, artY: 360, stack: true, textCenterX: 540,
    headlineY: 1050, headlineSize: 92, titleY: 1175, titleSize: 66,
    artistY: 1270, artistSize: 50, attrY: 1872, attrSize: 28,
  },
  "16:9": {
    artSize: 500, artX: 170, artY: 290, stack: false, textCenterX: 1330,
    headlineY: 380, headlineSize: 96, titleY: 520, titleSize: 70,
    artistY: 625, artistSize: 52, attrY: 1032, attrSize: 28,
  },
};

const optionalUrl = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().trim().url().max(2048).optional()
);

const promoCardsSchema = z.object({
  releaseTitle: z.string().trim().min(2).max(60),
  artistName: z.string().trim().min(2).max(60),
  style: z.enum(["announcement", "out-now", "pre-save", "milestone"]),
  sizes: z.array(z.enum(["1:1", "9:16", "16:9"])).min(1).max(3).optional().default(["1:1", "9:16", "16:9"]),
  coverArtUrl: optionalUrl,
  /** Label burned on milestone cards, e.g. "100K STREAMS". */
  milestoneLabel: z.string().trim().min(2).max(24).optional().default("1M STREAMS"),
  /** Burn the "Made with Bow Down Visuals" micro-attribution — free, on by default. */
  attribution: z.boolean().optional().default(true),
  /** Optional caption override; otherwise a style-matched caption is suggested. */
  caption: z.string().trim().max(280).optional(),
});

const execFileAsync = promisify(execFile);

/** Escape text for ffmpeg drawtext. */
function escapeDrawtext(t: string): string {
  return t
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "%%");
}

/** Fit a string to a max char count without breaking words. */
function clampText(t: string, max: number): string {
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

async function generateImage(prompt: string, size: string, outputPath: string): Promise<void> {
  const model = process.env.OPENAI_IMAGE_MODEL || "dall-e-3";
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, prompt, size, quality: "standard", n: 1 }),
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
  await execFileAsync(
    "ffmpeg",
    [
      "-y", "-i", inputPath,
      "-vf", `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
      "-frames:v", "1", outputPath,
    ],
    { timeout: 120_000 }
  );
}

/** Try to download the release cover art; returns null on any failure (non-fatal). */
async function fetchCoverArt(url: string, outputPath: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1024 || buf.length > 25 * 1024 * 1024) return false;
    await writeFile(outputPath, buf);
    return true;
  } catch {
    return false;
  }
}

/**
 * Composite one finished promo card:
 *  - background fitted to exact size
 *  - cover art framed window (when available)
 *  - crisp burned text: headline / title / artist / optional attribution
 */
async function composeCard(opts: {
  backgroundPath: string;
  artPath: string | null;
  outputPath: string;
  layout: CardLayout;
  headline: string;
  title: string;
  artist: string;
  attribution: boolean;
}): Promise<void> {
  const { backgroundPath, artPath, outputPath, layout, headline, title, artist, attribution } = opts;
  const GOLD = "0xE8B64C";
  const WHITE = "0xFFFFFF";

  const filter: string[] = [];
  const inputs = ["-y", "-i", backgroundPath];
  if (artPath) inputs.push("-i", artPath);

  let v = "[0:v]";
  if (artPath) {
    const a = layout.artSize;
    // Square-crop the artwork, overlay it, then frame it with a gold border.
    filter.push(
      `[1:v]scale=${a}:${a}:force_original_aspect_ratio=increase,crop=${a}:${a}[art]`,
      `${v}[art]overlay=${layout.artX}:${layout.artY},` +
        `drawbox=x=${layout.artX - 5}:y=${layout.artY - 5}:w=${a + 10}:h=${a + 10}:c=${GOLD}:t=5[vbg]`
    );
    v = "[vbg]";
  }

  const cx = layout.textCenterX;
  const dt = (text: string, y: number, size: number, color: string, box = false) =>
    `drawtext=fontfile='${FONT_PATH}':text='${escapeDrawtext(text)}':` +
    `fontsize=${size}:fontcolor=${color}:x=${cx}-text_w/2:y=${y}` +
    (box ? ":box=1:boxcolor=0x000000AA:boxborderw=24" : "");

  filter.push(`${v}${dt(headline, layout.headlineY, layout.headlineSize, GOLD, true)}[t1]`);
  filter.push(`[t1]${dt(clampText(title, 30), layout.titleY, layout.titleSize, WHITE)}[t2]`);
  filter.push(`[t2]${dt(clampText(artist, 34), layout.artistY, layout.artistSize, "0xFFFFFFCC")}[t3]`);
  v = "[t3]";

  if (attribution) {
    filter.push(
      `${v}drawtext=fontfile='${FONT_PATH}':text='${escapeDrawtext(ATTRIBUTION_TEXT)}':` +
        `fontsize=${layout.attrSize}:fontcolor=0xFFFFFF66:x=w-text_w-28:y=${layout.attrY}[t4]`
    );
    v = "[t4]";
  }

  await execFileAsync(
    "ffmpeg",
    [...inputs, "-filter_complex", filter.join(";"), "-map", v, "-frames:v", "1", outputPath],
    { timeout: 180_000 }
  );
}

router.get("/promo-cards/specs", requireAuth, (_req, res) => {
  res.json({
    styles: STYLES.map((s) => ({ id: s.id, label: s.label, blurb: s.blurb })),
    sizes: SIZES.map((s) => ({ id: s.id, label: s.label, width: s.width, height: s.height })),
    cost: PROMO_CARDS_COST,
  });
});

router.post("/promo-cards", requireAuth, async (req, res) => {
  const parsed = promoCardsSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < PROMO_CARDS_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, PROMO_CARDS_COST, {
      action: "Release Promo Cards",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  const workDir = await mkdtemp(join(tmpdir(), "promo-cards-"));

  try {
    const { releaseTitle, artistName, style, sizes, coverArtUrl, milestoneLabel, attribution, caption } = parsed.data;
    const chosen = STYLES.find((s) => s.id === (style as StyleId)) ?? STYLES[0];
    const headline = style === "milestone" ? milestoneLabel.toUpperCase() : chosen.headline;

    const jobId = randomUUID();
    const cards: Array<{
      style: string; size: string; url: string; storageRef: string;
      width: number; height: number; platforms: string[];
    }> = [];

    // Download the cover art once (non-fatal if it fails).
    let artPath: string | null = null;
    if (coverArtUrl) {
      const candidate = join(workDir, "cover-art.png");
      if (await fetchCoverArt(coverArtUrl, candidate)) artPath = candidate;
      else req.log.warn("[promo-cards] cover art download failed; continuing without it");
    }

    for (const sizeId of sizes) {
      const spec = SIZES.find((s) => s.id === (sizeId as SizeId))!;
      const layout = LAYOUTS[spec.id];
      const slug = `${chosen.id}-${spec.id.replace(":", "x")}`;

      const rawPath = join(workDir, `raw-${slug}.png`);
      const bgPath = join(workDir, `bg-${slug}.png`);
      const finalPath = join(workDir, `${slug}.png`);

      await generateImage(
        `Social media promo card background for a music release. ${chosen.bgSuffix}. ` +
          `Leave a large clean central area empty for artwork and text. ` +
          `ABSOLUTELY NO text, words, letters, logos, or watermarks anywhere in the image. ` +
          `Gold and black luxury aesthetic.`,
        spec.genSize,
        rawPath
      );
      await fitToSize(rawPath, bgPath, spec.width, spec.height);
      await composeCard({
        backgroundPath: bgPath,
        artPath,
        outputPath: finalPath,
        layout,
        headline,
        title: releaseTitle,
        artist: artistName,
        attribution,
      });

      const buffer = await readFile(finalPath);
      const objectName = `promo-cards/${req.userId}/${jobId}/${slug}.png`;
      const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "image/png");
      const url = await refreshSupabaseStorageUrl(storageRef);
      cards.push({
        style: chosen.id, size: spec.id, url, storageRef,
        width: spec.width, height: spec.height, platforms: [...spec.platforms],
      });
    }

    const suggestedCaption =
      caption?.trim() ||
      chosen.caption(releaseTitle, artistName, milestoneLabel.toUpperCase()) +
        (attribution ? `\n${ATTRIBUTION_TEXT}` : "");

    res.json({
      releaseTitle,
      artistName,
      style: chosen.id,
      headline,
      cards,
      suggestedCaption,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Promo card generation failed.";
    req.log.error({ err: message }, "[promo-cards] failed");
    await refundCredits(req.userId!, PROMO_CARDS_COST, {
      action: "Release Promo Cards — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  } finally {
    const { rm } = await import("fs/promises");
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

export default router;
