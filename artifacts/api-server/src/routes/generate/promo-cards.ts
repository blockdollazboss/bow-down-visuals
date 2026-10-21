import { Router } from "express";
import { z } from "zod";
import { writeFile, readFile, mkdtemp } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { requireAuth } from "../../middlewares/require-auth";
import { db, promoCardsTable, type PromoCardBrandSnapshot } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { readBrandKit, type StoredBrandKit } from "../../lib/brand-record";
import { getOpenAI } from "../../lib/ai-clients";
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
   on failure.
   Brand kit (Stack-4 wave-2 #4): the caller's kit is read ONCE at
   generation time — the same snapshot pattern UGC ads use (0164). The
   snapshot steers the pack: palette + vibe direct the background
   prompt, the primary color becomes the headline/frame accent, the
   logo is composited as a brand badge, and the lead font pairing
   resolves to a bundled face where one exists. The snapshot is stored
   on every card row (migration 0182), so editing the kit afterwards
   never mutates already-generated cards. No kit → the pack generates
   exactly as it did before the kit was wired in, never an error. */

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
    genSize: "1024x1536" as const,
    platforms: ["tiktok", "instagram"],
  },
  {
    id: "16:9",
    label: "Wide — YouTube / X banner",
    width: 1920,
    height: 1080,
    genSize: "1536x1024" as const,
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
  /** Brand-logo badge box (bottom-left, opposite the attribution):
   *  the kit logo is fitted inside it, aspect preserved. */
  logoSize: number;
  logoX: number;
  logoY: number;
}

const LAYOUTS: Record<SizeId, CardLayout> = {
  "1:1": {
    artSize: 500, artX: 290, artY: 110, stack: true, textCenterX: 540,
    headlineY: 680, headlineSize: 84, titleY: 790, titleSize: 62,
    artistY: 875, artistSize: 46, attrY: 1032, attrSize: 26,
    logoSize: 120, logoX: 28, logoY: 932,
  },
  "9:16": {
    artSize: 600, artX: 240, artY: 360, stack: true, textCenterX: 540,
    headlineY: 1050, headlineSize: 92, titleY: 1175, titleSize: 66,
    artistY: 1270, artistSize: 50, attrY: 1872, attrSize: 28,
    logoSize: 150, logoX: 32, logoY: 1738,
  },
  "16:9": {
    artSize: 500, artX: 170, artY: 290, stack: false, textCenterX: 1330,
    headlineY: 380, headlineSize: 96, titleY: 520, titleSize: 70,
    artistY: 625, artistSize: 52, attrY: 1032, attrSize: 28,
    logoSize: 140, logoX: 36, logoY: 904,
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

/* ─── Brand-kit snapshot (Stack-4 wave-2 #4) ─────────────────────────
   Mirrors the UGC lane's snapshot (routes/ugc-ads.ts): the kit is read
   at generation time and reduced to a snapshot whose four core fields
   derive exactly the way UgcBrandSnapshot's do (brandName/logoUrl
   carried through, primaryColor = the kit's first color, vibe carried
   through). Colors and fonts ride in full because the card composer
   burns text and frames with them. Every value is COPIED — the
   snapshot never aliases the kit record, so a later kit edit cannot
   reach into a pack that was already generated. */

/** The stored kit → the generation snapshot, or null for no kit. */
export function promoCardBrandSnapshot(kit: StoredBrandKit | null): PromoCardBrandSnapshot | null {
  if (!kit) return null;
  return {
    brandName: kit.brandName || null,
    logoUrl: kit.logoUrl ?? null,
    primaryColor: kit.colors?.[0]?.hex ?? null,
    vibe: kit.vibe || null,
    colors: (kit.colors ?? []).map((c) => ({ hex: c.hex, name: c.name, role: c.role })),
    fonts: (kit.fonts ?? []).map((f) => ({ heading: f.heading, body: f.body, usage: f.usage })),
  };
}

/** Read the caller's kit and snapshot it. Best-effort by design: a
 *  failed read is "no kit" (the pre-kit behavior), never a failed
 *  generation — the same contract the UGC lane runs. */
export async function readPromoCardBrandSnapshot(userId: string): Promise<PromoCardBrandSnapshot | null> {
  try {
    return promoCardBrandSnapshot(await readBrandKit(userId));
  } catch {
    return null;
  }
}

/** The background prompt for one card style. No snapshot → the exact
 *  pre-kit prompt, byte for byte. With a snapshot, the brand line is
 *  appended: palette + vibe + typography mood steer the render, and
 *  the brand direction overrides the default gold where they differ.
 *  The generated background still carries NO text or logos — the real
 *  logo is composited from the kit file, never hallucinated. */
export function buildPromoCardBackgroundPrompt(
  style: (typeof STYLES)[number],
  brand: PromoCardBrandSnapshot | null,
): string {
  const base =
    `Social media promo card background for a music release. ${style.bgSuffix}. ` +
    `Leave a large clean central area empty for artwork and text. ` +
    `ABSOLUTELY NO text, words, letters, logos, or watermarks anywhere in the image. ` +
    `Gold and black luxury aesthetic.`;
  if (!brand) return base;
  const palette = brand.colors
    .map((c) => `${c.hex}${c.name ? ` (${c.name}${c.role ? `, ${c.role}` : ""})` : c.role ? ` (${c.role})` : ""}`)
    .join(", ");
  const leadFont = brand.fonts[0];
  return (
    base +
    ` Creator brand direction — this card is for ${brand.brandName ? `"${brand.brandName}"` : "the creator's own brand"}` +
    `${brand.vibe ? `, whose vibe is ${brand.vibe}` : ""}.` +
    (palette
      ? ` Build the background on the brand palette instead of the default gold where they differ: ${palette}.`
      : "") +
    (leadFont
      ? ` Typography mood for the composition: ${leadFont.heading} headlines with ${leadFont.body} supporting text.`
      : "")
  );
}

const DEFAULT_ACCENT = "0xE8B64C";

/** The headline/frame accent for a pack: the snapshot's primary color
 *  as an ffmpeg color, or the house gold when there is no kit (or the
 *  stored hex is not a usable #RRGGBB). */
export function promoCardAccentColor(brand: PromoCardBrandSnapshot | null): string {
  const hex = brand?.primaryColor?.trim() ?? "";
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? `0x${hex.slice(1).toUpperCase()}` : DEFAULT_ACCENT;
}

/* Kit font pairings name faces the generator chose; the card text can
   only burn a face the server actually carries. These are the bundled
   caption faces (lib/fonts.ts) and their vendored TTF filenames
   (docker/fonts/) — a kit font outside the bundle honestly falls back
   to the default face for the burned text while still steering the
   background prompt above. */
const BUNDLED_FONT_FILES: Record<string, string> = {
  "Anton": "Anton-Regular.ttf",
  "Alfa Slab One": "AlfaSlabOne-Regular.ttf",
  "Archivo Black": "ArchivoBlack-Regular.ttf",
  "Barlow Condensed": "BarlowCondensed-Bold.ttf",
  "Bebas Neue": "BebasNeue-Regular.ttf",
  "Bungee": "Bungee-Regular.ttf",
  "Cinzel": "Cinzel-Variable.ttf",
  "Luckiest Guy": "LuckiestGuy-Regular.ttf",
  "Permanent Marker": "PermanentMarker-Regular.ttf",
  "Poppins": "Poppins-Bold.ttf",
  "Righteous": "Righteous-Regular.ttf",
  "Titan One": "TitanOne-Regular.ttf",
};

/** Resolve a kit font family to a vendored TTF on disk, or null. */
export function promoCardBrandFontFile(family: string | null | undefined): string | null {
  if (!family) return null;
  const file = BUNDLED_FONT_FILES[family.trim()];
  if (!file) return null;
  const candidates = [
    `/usr/share/fonts/bdv/${file}`,
    join(dirname(fileURLToPath(import.meta.url)), `../../../../../docker/fonts/${file}`),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

/** The snapshot's lead pairing as burnable font files: heading for the
 *  headline/title, body for the artist/attribution (falling back to
 *  the heading face, then to null = the route's default face). */
export function promoCardBrandFonts(brand: PromoCardBrandSnapshot | null): {
  heading: string | null;
  body: string | null;
} {
  const lead = brand?.fonts[0];
  if (!lead) return { heading: null, body: null };
  const heading = promoCardBrandFontFile(lead.heading);
  const body = promoCardBrandFontFile(lead.body) ?? heading;
  return { heading, body };
}

const execFileAsync = promisify(execFile);

/* ─── Card records (STACK-20 R2 #17, migration 0161) ──────────────────────
   One promo_cards row per generated card, written in the same request
   that mints the pack — this is the record the history list reads and
   the delete owns. Exported so route tests can pin the record step
   without running the image pipeline. Throws on failure; the caller
   decides (generation has already been paid for and produced real
   cards, so the POST logs and continues with id-less cards rather
   than failing a finished pack). */
export interface PromoCardPackCard {
  style: string;
  size: string;
  storageRef: string;
  width: number;
  height: number;
  platforms: string[];
}

export async function recordPromoCardPack(input: {
  userId: string;
  jobId: string;
  releaseTitle: string;
  artistName: string;
  caption: string | null;
  /** The generation-time brand-kit snapshot (0182); null = no kit. */
  brandSnapshot?: PromoCardBrandSnapshot | null;
  cards: PromoCardPackCard[];
}): Promise<(string | null)[]> {
  if (input.cards.length === 0) return [];
  const rows = await db
    .insert(promoCardsTable)
    .values(
      input.cards.map((c) => ({
        userId: input.userId,
        jobId: input.jobId,
        style: c.style,
        size: c.size,
        storageRef: c.storageRef,
        releaseTitle: input.releaseTitle,
        artistName: input.artistName,
        caption: input.caption,
        brandSnapshot: input.brandSnapshot ?? null,
        width: c.width,
        height: c.height,
        platforms: c.platforms,
      })),
    )
    .returning({ id: promoCardsTable.id });
  return input.cards.map((_, i) => rows[i]?.id ?? null);
}

/** The history DTO: everything from the caller's own row, with the
 *  playable URL minted fresh from the stable storage ref on every
 *  read (a stored URL would expire; the ref never does). */
async function promoCardDto(row: typeof promoCardsTable.$inferSelect) {
  return {
    id: row.id,
    style: row.style,
    size: row.size,
    url: await refreshSupabaseStorageUrl(row.storageRef),
    releaseTitle: row.releaseTitle,
    artistName: row.artistName,
    caption: row.caption,
    /* The brand-kit snapshot the card was generated with (0182);
       null for cards made without a kit (including every card
       recorded before the snapshot shipped). */
    brand: row.brandSnapshot ?? null,
    width: row.width,
    height: row.height,
    platforms: row.platforms ?? [],
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  };
}

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

export async function generateImage(prompt: string, size: string, outputPath: string): Promise<void> {
  const model = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.5-sunburst";
  /* GPT Image models return base64 (b64_json), never a hosted URL — same
     SDK call shape as the cover-art / thumbnail-generator fleet. */
  let b64: string | undefined;
  try {
    const imageResp = await getOpenAI().images.generate(
      {
        model,
        prompt,
        size,
        quality: "high",
      },
      { signal: AbortSignal.timeout(180_000) },
    );
    b64 = imageResp.data?.[0]?.b64_json;
  } catch {
    throw new Error("Image generation failed.");
  }
  if (!b64) throw new Error("No image data returned.");
  await writeFile(outputPath, Buffer.from(b64, "base64"));
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

/** Try to download an image (release cover art, brand logo); returns
 *  false on any failure — a missing image is never fatal to a pack. */
async function fetchImageToFile(url: string, outputPath: string): Promise<boolean> {
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
 *  - brand logo badge (when the generation snapshot carries a logo
 *    that downloaded) in the layout's bottom-left box
 *  - crisp burned text: headline / title / artist / optional attribution
 *  Brand styling comes from the generation snapshot: the accent color
 *  (the kit's primary, else house gold) frames the artwork and colors
 *  the headline; the kit's lead font pairing burns the text when it
 *  resolved to bundled faces, else the default face does.
 */
async function composeCard(opts: {
  backgroundPath: string;
  artPath: string | null;
  logoPath?: string | null;
  outputPath: string;
  layout: CardLayout;
  headline: string;
  title: string;
  artist: string;
  attribution: boolean;
  accentColor?: string;
  headingFontPath?: string | null;
  bodyFontPath?: string | null;
}): Promise<void> {
  const { backgroundPath, artPath, outputPath, layout, headline, title, artist, attribution } = opts;
  const logoPath = opts.logoPath ?? null;
  const accent = opts.accentColor ?? DEFAULT_ACCENT;
  const headingFont = opts.headingFontPath ?? FONT_PATH;
  const bodyFont = opts.bodyFontPath ?? FONT_PATH;
  const WHITE = "0xFFFFFF";

  const filter: string[] = [];
  const inputs = ["-y", "-i", backgroundPath];
  let nextInput = 1;
  let artIndex = -1;
  let logoIndex = -1;
  if (artPath) { artIndex = nextInput++; inputs.push("-i", artPath); }
  if (logoPath) { logoIndex = nextInput++; inputs.push("-i", logoPath); }

  let v = "[0:v]";
  if (artPath) {
    const a = layout.artSize;
    // Square-crop the artwork, overlay it, then frame it with an accent border.
    filter.push(
      `[${artIndex}:v]scale=${a}:${a}:force_original_aspect_ratio=increase,crop=${a}:${a}[art]`,
      `${v}[art]overlay=${layout.artX}:${layout.artY},` +
        `drawbox=x=${layout.artX - 5}:y=${layout.artY - 5}:w=${a + 10}:h=${a + 10}:c=${accent}:t=5[vbg]`
    );
    v = "[vbg]";
  }

  if (logoPath) {
    const b = layout.logoSize;
    // Fit the logo inside its badge box, aspect preserved, centered on
    // a transparent pad so placement is exact whatever its shape is.
    filter.push(
      `[${logoIndex}:v]format=rgba,scale=${b}:${b}:force_original_aspect_ratio=decrease,` +
        `pad=${b}:${b}:(ow-iw)/2:(oh-ih)/2:color=black@0[logo]`,
      `${v}[logo]overlay=${layout.logoX}:${layout.logoY}[vlogo]`
    );
    v = "[vlogo]";
  }

  const cx = layout.textCenterX;
  const dt = (text: string, y: number, size: number, color: string, box = false, fontPath: string = FONT_PATH) =>
    `drawtext=fontfile='${fontPath}':text='${escapeDrawtext(text)}':` +
    `fontsize=${size}:fontcolor=${color}:x=${cx}-text_w/2:y=${y}` +
    (box ? ":box=1:boxcolor=0x000000AA:boxborderw=24" : "");

  filter.push(`${v}${dt(headline, layout.headlineY, layout.headlineSize, accent, true, headingFont)}[t1]`);
  filter.push(`[t1]${dt(clampText(title, 30), layout.titleY, layout.titleSize, WHITE, false, headingFont)}[t2]`);
  filter.push(`[t2]${dt(clampText(artist, 34), layout.artistY, layout.artistSize, "0xFFFFFFCC", false, bodyFont)}[t3]`);
  v = "[t3]";

  if (attribution) {
    filter.push(
      `${v}drawtext=fontfile='${bodyFont}':text='${escapeDrawtext(ATTRIBUTION_TEXT)}':` +
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

/* ─── History (STACK-20 R2 #17) ───────────────────────────────────────────
   The caller's own cards, newest first. Bounded: `limit` defaults to
   50 and never exceeds 100 — the response carries the limit it applied
   and whether more cards sit beyond it, so the bound is stated, never
   silent. Only rows recorded at generation time (migration 0161) can
   appear; there is no other record of a card to read. */
const HISTORY_DEFAULT_LIMIT = 50;
const HISTORY_MAX_LIMIT = 100;

router.get("/promo-cards", requireAuth, async (req, res) => {
  const rawLimit = Number(req.query["limit"]);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0
    ? Math.min(HISTORY_MAX_LIMIT, Math.floor(rawLimit))
    : HISTORY_DEFAULT_LIMIT;
  try {
    const rows = await db
      .select()
      .from(promoCardsTable)
      .where(eq(promoCardsTable.userId, req.userId!))
      .orderBy(desc(promoCardsTable.createdAt), desc(promoCardsTable.id))
      .limit(limit + 1);
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const cards = await Promise.all(page.map(promoCardDto));
    res.json({ cards, limit, hasMore });
  } catch (err) {
    req.log.error({ err }, "[promo-cards] history list failed");
    res.status(500).json({ error: "Could not load your promo cards." });
  }
});

/* Delete one of the caller's own cards: the ROW goes away (the card
   leaves the creator's history); the storage object is deliberately
   NOT purged — media removal is its own deliberate act. Another
   member's card id, or one that never existed, is the same honest
   404: the route never confirms a card the caller doesn't own. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.delete("/promo-cards/:id", requireAuth, async (req, res) => {
  const rawId = req.params["id"];
  const id = typeof rawId === "string" ? rawId : "";
  if (!UUID_RE.test(id)) {
    res.status(404).json({ error: "Promo card not found." });
    return;
  }
  try {
    const owned = await db
      .select({ id: promoCardsTable.id })
      .from(promoCardsTable)
      .where(and(eq(promoCardsTable.id, id), eq(promoCardsTable.userId, req.userId!)))
      .limit(1);
    if (owned.length === 0) {
      res.status(404).json({ error: "Promo card not found." });
      return;
    }
    await db
      .delete(promoCardsTable)
      .where(and(eq(promoCardsTable.id, id), eq(promoCardsTable.userId, req.userId!)));
    res.json({ ok: true, id });
  } catch (err) {
    req.log.error({ err }, "[promo-cards] delete failed");
    res.status(500).json({ error: "Could not delete that promo card." });
  }
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

  /* Brand kit, read ONCE at generation time (best-effort: no kit =
     the pre-kit behavior, never a failed generation). This snapshot
     steers the whole pack below and is recorded on every card row —
     later kit edits can't reach back into it. */
  const brand = await readPromoCardBrandSnapshot(req.userId!);

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
      id: string | null;
      style: string; size: string; url: string; storageRef: string;
      width: number; height: number; platforms: string[];
    }> = [];

    // Download the cover art once (non-fatal if it fails).
    let artPath: string | null = null;
    if (coverArtUrl) {
      const candidate = join(workDir, "cover-art.png");
      if (await fetchImageToFile(coverArtUrl, candidate)) artPath = candidate;
      else req.log.warn("[promo-cards] cover art download failed; continuing without it");
    }

    // Download the snapshot's brand logo once (non-fatal if it fails —
    // the pack still carries the kit's palette, vibe, and fonts).
    let logoPath: string | null = null;
    if (brand?.logoUrl) {
      const candidate = join(workDir, "brand-logo.png");
      if (await fetchImageToFile(brand.logoUrl, candidate)) logoPath = candidate;
      else req.log.warn("[promo-cards] brand logo download failed; continuing without it");
    }
    const brandFonts = promoCardBrandFonts(brand);
    const accentColor = promoCardAccentColor(brand);

    for (const sizeId of sizes) {
      const spec = SIZES.find((s) => s.id === (sizeId as SizeId))!;
      const layout = LAYOUTS[spec.id];
      const slug = `${chosen.id}-${spec.id.replace(":", "x")}`;

      const rawPath = join(workDir, `raw-${slug}.png`);
      const bgPath = join(workDir, `bg-${slug}.png`);
      const finalPath = join(workDir, `${slug}.png`);

      await generateImage(
        buildPromoCardBackgroundPrompt(chosen, brand),
        spec.genSize,
        rawPath
      );
      await fitToSize(rawPath, bgPath, spec.width, spec.height);
      await composeCard({
        backgroundPath: bgPath,
        artPath,
        logoPath,
        outputPath: finalPath,
        layout,
        headline,
        title: releaseTitle,
        artist: artistName,
        attribution,
        accentColor,
        headingFontPath: brandFonts.heading,
        bodyFontPath: brandFonts.body,
      });

      const buffer = await readFile(finalPath);
      const objectName = `promo-cards/${req.userId}/${jobId}/${slug}.png`;
      const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "image/png");
      const url = await refreshSupabaseStorageUrl(storageRef);
      cards.push({
        id: null,
        style: chosen.id, size: spec.id, url, storageRef,
        width: spec.width, height: spec.height, platforms: [...spec.platforms],
      });
    }

    const suggestedCaption =
      caption?.trim() ||
      chosen.caption(releaseTitle, artistName, milestoneLabel.toUpperCase()) +
        (attribution ? `\n${ATTRIBUTION_TEXT}` : "");

    /* Record the pack (migration 0161) so these cards live in the
       creator's history after this response is gone. Best-effort by
       design: the pack is generated and already paid for, so a failed
       record write must not fail the response — the cards simply come
       back without history ids and can't be listed or deleted later. */
    try {
      const ids = await recordPromoCardPack({
        userId: req.userId!,
        jobId,
        releaseTitle,
        artistName,
        caption: suggestedCaption,
        brandSnapshot: brand,
        cards,
      });
      cards.forEach((c, i) => {
        c.id = ids[i] ?? null;
      });
    } catch (recErr) {
      req.log.error({ err: recErr }, "[promo-cards] failed to record pack in history");
    }

    res.json({
      releaseTitle,
      artistName,
      style: chosen.id,
      headline,
      /* The brand-kit snapshot this pack was generated with (0182);
         null when the creator has no kit — the pre-kit behavior. */
      brand,
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
