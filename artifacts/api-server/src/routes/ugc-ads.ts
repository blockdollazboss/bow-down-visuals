import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { invokeRailHandler, type RailCoreDeps, type RailCoreResult } from "../lib/rail-core";
import { randomUUID } from "crypto";
import { createWriteStream, unlinkSync, existsSync } from "fs";
import { pipeline } from "stream/promises";
import { execFile } from "child_process";
import { promisify } from "util";
import { tmpdir } from "os";
import { join } from "path";
import RunwayML from "@runwayml/sdk";
import { requireAuth } from "../middlewares/require-auth";
import { publicApiLimiter, generationLimiter } from "../lib/rate-limit";
import { logger } from "../lib/logger";
import { db, ugcAdsTable, ugcBriefsTable, shopProductsTable, generatedClipsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { chargeCredits, refundCredits, OutOfCreditsError, buildChargeIdempotencyKey } from "../lib/credits";
import { getOpenAI, getTextModel } from "../lib/ai-clients";
import { readBrandKit } from "../lib/brand-record";
import {
  normalizeToStorageRef,
  refreshSupabaseStorageUrl,
  uploadPublicMediaToR2,
  uploadFileStreamToSupabaseStorage,
  SUPABASE_CLIPS_BUCKET,
} from "../lib/objectStorage";
import { mirrorExternalMediaUrl } from "../lib/mirrorMedia";
import { GEN45_CREDIT_COST } from "./generate/clip-pricing";
import type { UgcScript, UgcBrandSnapshot } from "@workspace/db";

const router = Router();
const execFileAsync = promisify(execFile);

/* ─── UGC Product Ads (owner order Oct 19, 2026) ────────────────────────
   The creator side of the UGC ads feature, docked in Promote beside
   Promo Clips and promo cards. A member picks a product (their own
   shop product in one tap, or an uploaded product), a style, and a
   face (their own photo/character, or a generated creator persona —
   which is also how a BUSINESS fronts its own product with no real
   creator), writes a script or lets Turbo write it, and generates a
   9:16 UGC-style video ad.

   PRICES — no new prices invented:
   - Video: GEN45_CREDIT_COST (400 Visual Bucs) — the exact flat rate
     clip-pricing.ts charges for the same gen4.5 clip on the existing
     runway-clip / promo-clip rail (cover-in-motion charges the same
     400 for the identical gen4.5 image-to-video call). A UGC ad is
     one gen4.5 vertical clip, priced exactly like one.
   - Persona portrait: 100 Visual Bucs — the artist-image rail's rate
     for the same OpenAI image model (GPT_IMAGE_25_SUNBURST_CREDIT_COST
     in artist-image-pricing.ts).
   - Script (Turbo): no separate fee in v1 — it is an ingredient of
     the paid ad, not a standalone product.
   Money honesty: charge BEFORE the provider call with a stable
   idempotency key (buildChargeIdempotencyKey), auto-refund on any
   failure, and the ad row records exactly what was charged.

   The video rides the EXISTING generation rail in substance: the same
   Runway SDK gen4.5 image-to-video call runway-clip.ts makes (the
   face — or the product photo — anchors the render), the same
   charge/refund discipline cover-in-motion.ts uses, the same
   generated-clips bucket, and on success the clip is ALSO saved into
   the member's generated-clips library. Captions (the script's lines)
   are burned into the video with ffmpeg when the burn lands; the
   caption track rides the record either way and captionsBurned says
   honestly which happened. The caller's brand kit is read at
   generation time: its palette + vibe steer the render prompt and
   its primary color styles the burned captions, and the snapshot is
   stored on the record. */

export const UGC_VIDEO_CREDIT_COST = GEN45_CREDIT_COST;
export const UGC_PERSONA_CREDIT_COST =
  Number(process.env["UGC_PERSONA_CREDITS"]) || 100;

export const UGC_STYLES = ["unboxing", "honest-review", "problem-fix", "grwm"] as const;
export type UgcStyle = (typeof UGC_STYLES)[number];

const STYLE_DIRECTION: Record<UgcStyle, string> = {
  unboxing:
    "Unboxing energy: genuine first-reaction excitement as the product comes out of its box, close-ups of the product in hand, 'wait for it' reveal moment.",
  "honest-review":
    "Honest review: straight-talking, credible, no hype — the creator weighs the product up on camera, shows it in real use, gives a balanced verdict.",
  "problem-fix":
    "Problem → fix: open on the everyday frustration, then the product solves it on camera — a clear before/after beat the viewer feels.",
  grwm:
    "Get-ready-with-me: casual getting-ready flow, chatting to camera like a friend while the product fits naturally into the routine.",
};

const ScriptSchema = z.object({
  hook: z.string().trim().min(1).max(200),
  lines: z.array(z.string().trim().min(1).max(200)).min(1).max(6),
  cta: z.string().trim().min(1).max(200),
});

const ImageUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .regex(/^https?:\/\//, "must be an http(s) URL");

/* ── Pure builders (exported for tests) ─────────────────────────────── */

/** The caption track for an ad: hook first, spoken lines, CTA last. */
export function buildCaptionLines(script: UgcScript): string[] {
  return [script.hook, ...script.lines, script.cta]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean)
    .slice(0, 6);
}

/** The render prompt handed to the video rail. The spoken script is the
    performance direction; the style block carries the format; the
    brand line (when a kit exists) carries palette + vibe. */
export function buildUgcVideoPrompt(input: {
  productName: string;
  productBlurb: string | null;
  style: UgcStyle;
  script: UgcScript;
  hasFace: boolean;
  brand: UgcBrandSnapshot | null;
}): string {
  const who = input.hasFace
    ? "A content creator films a selfie-style UGC ad, talking directly to camera, holding and using the product"
    : "A selfie-style UGC product ad filmed handheld, the product front and center in real use";
  const blurb = input.productBlurb?.trim() ? ` Product: ${input.productBlurb.trim()}` : "";
  const brandLine = input.brand
    ? ` Brand feel: ${[input.brand.vibe, input.brand.primaryColor ? `palette anchored on ${input.brand.primaryColor}` : ""].filter(Boolean).join(", ")}.`
    : "";
  const spoken = [input.script.hook, ...input.script.lines, input.script.cta].join(" ");
  return (
    `${who} — "${input.productName}".${blurb} ` +
    `Format: ${STYLE_DIRECTION[input.style]} ` +
    `The creator's script (performance + on-screen energy): "${spoken}" ` +
    `Vertical 9:16, natural light, authentic phone-camera feel, real moving video with natural body motion and live energy.${brandLine}`
  ).slice(0, 1400);
}

export function normalizeScript(raw: unknown): UgcScript | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const hook = typeof r["hook"] === "string" ? r["hook"].trim().slice(0, 200) : "";
  const cta = typeof r["cta"] === "string" ? r["cta"].trim().slice(0, 200) : "";
  const lines = Array.isArray(r["lines"])
    ? r["lines"]
        .filter((l): l is string => typeof l === "string" && l.trim().length > 0)
        .map((l) => l.trim().slice(0, 200))
        .slice(0, 6)
    : [];
  if (!hook || lines.length === 0 || !cta) return null;
  return { hook, lines, cta };
}

/* ── Caption burn (injectable for tests, bg-image-client pattern) ───── */

export type CaptionBurner = (
  videoPath: string,
  lines: string[],
  colorHex: string | null,
) => Promise<string | null>;

let captionBurnerOverride: CaptionBurner | null = null;
export function __setUgcCaptionBurnerForTests(b: CaptionBurner | null): void {
  captionBurnerOverride = b;
}

const FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
const CLIP_DURATION_SEC = 5;

function drawtextEscape(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "’")
    .replace(/%/g, "\\%")
    .slice(0, 90);
}

/** Burn the caption lines into the clip, one beat at a time across the
    5-second render, bottom-third, boxed for readability. Returns the
    output path, or null when the burn didn't land (the clean clip is
    delivered and captionsBurned stays false — never dressed up). */
async function defaultCaptionBurner(
  videoPath: string,
  lines: string[],
  colorHex: string | null,
): Promise<string | null> {
  if (lines.length === 0) return null;
  const color = /^#[0-9a-fA-F]{6}$/.test(colorHex ?? "")
    ? `0x${(colorHex as string).slice(1)}`
    : "0xC9A84C";
  const per = CLIP_DURATION_SEC / lines.length;
  const filters = lines
    .map((line, i) => {
      const start = (i * per).toFixed(2);
      const end = ((i + 1) * per).toFixed(2);
      return (
        `drawtext=fontfile=${FONT_PATH}:text='${drawtextEscape(line)}':` +
        `fontcolor=${color}:fontsize=42:borderw=0:box=1:boxcolor=black@0.55:boxborderw=14:` +
        `x=(w-text_w)/2:y=h-240:enable='between(t,${start},${end})'`
      );
    })
    .join(",");
  const outPath = join(tmpdir(), `ugc-captioned-${randomUUID()}.mp4`);
  try {
    await execFileAsync(
      "ffmpeg",
      ["-v", "error", "-y", "-i", videoPath, "-vf", filters, "-c:a", "copy", outPath],
      { timeout: 120_000 },
    );
    if (!existsSync(outPath)) return null;
    return outPath;
  } catch {
    return null;
  }
}

/* ── DTO ────────────────────────────────────────────────────────────── */

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v ?? "");
}

async function refreshOrNull(v: string | null): Promise<string | null> {
  return v ? refreshSupabaseStorageUrl(v) : null;
}

async function toDTO(row: typeof ugcAdsTable.$inferSelect) {
  return {
    id: row.id,
    briefId: row.briefId ?? null,
    productSource: row.productSource,
    shopProductId: row.shopProductId ?? null,
    productName: row.productName,
    productBlurb: row.productBlurb ?? null,
    productPriceCents: row.productPriceCents ?? null,
    productImageUrl: await refreshOrNull(row.productImageRef ?? null),
    style: row.style,
    faceImageUrl: await refreshOrNull(row.faceImageRef ?? null),
    faceKind: row.faceKind,
    script: row.script ?? null,
    captions: Array.isArray(row.captions) ? row.captions : [],
    captionsBurned: row.captionsBurned === true,
    brand: row.brandSnapshot ?? null,
    videoUrl: await refreshOrNull(row.videoRef ?? null),
    status: row.status,
    creditsCharged: row.creditsCharged ?? 0,
    lastError: row.lastError ?? null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

async function ownAd(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(ugcAdsTable)
    .where(and(eq(ugcAdsTable.id, id), eq(ugcAdsTable.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Mirror-on-save for a product photo: permanent values pass through,
    our own storage URLs normalize to their ref, anything else external
    is re-hosted into permanent storage (mirror helper keeps the
    original on failure, logging loudly there). */
async function storeProductImage(raw: string | null, userId: string): Promise<string | null> {
  if (!raw) return null;
  const normalized = normalizeToStorageRef(raw) ?? raw;
  if (!/^https?:\/\//i.test(normalized)) return normalized;
  const mirrored = await mirrorExternalMediaUrl(normalized, { kind: "image", ownerKey: userId });
  return mirrored ?? normalized;
}

/* ── GET /api/ugc-ads/products — my shop products, one-tap source ──── */
router.get("/ugc-ads/products", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(shopProductsTable)
      .where(eq(shopProductsTable.user_id, req.userId!))
      .orderBy(desc(shopProductsTable.created_at))
      .limit(100);
    const products = await Promise.all(
      rows.map(async (p) => ({
        id: p.id,
        name: p.name,
        priceCents: p.price_cents ?? 0,
        imageUrl: p.image_url ? await refreshSupabaseStorageUrl(p.image_url) : null,
      })),
    );
    res.json({ products });
  } catch (err) {
    logger.error({ err }, "[ugc-ads] products load failed");
    res.status(500).json({ error: "Could not load your shop products — try again." });
  }
});

/* ── POST /api/ugc-ads/script — Turbo writes the ad script ─────────── */
const scriptGenSchema = z.object({
  productName: z.string().trim().min(1).max(120),
  productBlurb: z.string().trim().max(600).optional().default(""),
  style: z.enum(UGC_STYLES),
  keyPoints: z.string().trim().max(400).optional().default(""),
});

router.post("/ugc-ads/script", publicApiLimiter, requireAuth, async (req, res) => {
  const parsed = scriptGenSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid script request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { productName, productBlurb, style, keyPoints } = parsed.data;
  try {
    const completion = await getOpenAI().chat.completions.create({
      model: getTextModel(),
      response_format: { type: "json_object" },
      max_completion_tokens: 700,
      temperature: 0.8,
      messages: [
        {
          role: "system",
          content:
            "You write UGC ad scripts — the words a real creator says to camera about a product, " +
            "in their own voice: specific, believable, zero corporate speak, no hype claims that " +
            "can't be true (never promise results, income, or miracles). A script is: a hook (the " +
            "first line, engineered to stop the scroll in under 3 seconds), 3-4 short spoken lines, " +
            "and one clear call to action. Keep every line under 20 words — these are spoken, not read. " +
            'Return ONLY JSON: {"hook": string, "lines": [string, ...], "cta": string}.',
        },
        {
          role: "user",
          content:
            `Write a UGC ad script.\nProduct: ${productName}${productBlurb ? ` — ${productBlurb}` : ""}\n` +
            `Format: ${STYLE_DIRECTION[style]}\n` +
            (keyPoints ? `Key points to land: ${keyPoints}\n` : ""),
        },
      ],
    });
    const script = normalizeScript(JSON.parse(completion.choices[0]?.message?.content ?? "{}"));
    if (!script) {
      res.status(502).json({ error: "The script came back unusable — try again." });
      return;
    }
    res.json({ script });
  } catch (err) {
    logger.error({ err }, "[ugc-ads] script generation failed");
    res.status(502).json({ error: "The script writer hiccupped — try again." });
  }
});

/* ── POST /api/ugc-ads/persona — generate a creator persona face ───── */
const personaSchema = z.object({
  description: z.string().trim().min(10, "Describe the creator in a sentence or two.").max(400),
  idempotencyKey: z.string().trim().max(120).optional(),
});

const generateUgcPersonaHandler = async (req: Request, res: Response) => {
  const parsed = personaSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid persona request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const balance = req.userCredits ?? 0;
  if (balance < UGC_PERSONA_CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "You're out of Visual Bucs — top up to generate a persona.",
    });
    return;
  }
  const key = buildChargeIdempotencyKey("ugc-persona", req.userId!, parsed.data.idempotencyKey, parsed.data.description);
  let creditsRemaining = balance;
  try {
    creditsRemaining = await chargeCredits(
      req.userId!,
      UGC_PERSONA_CREDIT_COST,
      { action: "UGC Persona Portrait" },
      { idempotencyKey: key },
    );
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "You're out of Visual Bucs — top up to generate a persona." });
      return;
    }
    logger.error({ err }, "[ugc-ads] persona charge failed");
    res.status(500).json({ error: "The charge didn't land — no Visual Bucs moved. Try again." });
    return;
  }
  const refund = async () => {
    try {
      await refundCredits(req.userId!, UGC_PERSONA_CREDIT_COST, {
        action: "UGC Persona Portrait — Refund (generation failed)",
      });
    } catch (refundErr) {
      logger.error({ err: refundErr, userId: req.userId }, "[ugc-ads] persona refund failed");
    }
  };
  try {
    const prompt =
      `Photorealistic vertical portrait of a content creator filming a selfie-style product video: ` +
      `${parsed.data.description}. Natural light, genuine warm expression, casual real-world setting, ` +
      `shot on a phone front camera, vertical composition with head and shoulders centered and space ` +
      `below for holding a product. No text, no logos, no watermark.`;
    const resp = await getOpenAI().images.generate({
      model: process.env["OPENAI_IMAGE_MODEL"] || "gpt-image-2.5-sunburst",
      prompt,
      size: "1024x1536",
      n: 1,
    });
    const first = resp.data?.[0];
    let buffer: Buffer | null = null;
    if (first?.b64_json) {
      buffer = Buffer.from(first.b64_json, "base64");
    } else if (first?.url) {
      const dl = await fetch(first.url, { signal: AbortSignal.timeout(120_000) });
      if (!dl.ok) throw new Error(`Persona image download failed (${dl.status})`);
      buffer = Buffer.from(await dl.arrayBuffer());
    }
    if (!buffer || buffer.length === 0) throw new Error("The image model returned no persona.");
    const personaUrl = await uploadPublicMediaToR2(
      "generated-clips",
      `ugc-personas/${req.userId}/${randomUUID()}.png`,
      buffer,
      "image/png",
    );
    res.json({ personaUrl, creditsUsed: UGC_PERSONA_CREDIT_COST, creditsRemaining });
  } catch (err) {
    await refund();
    logger.error({ err }, "[ugc-ads] persona generation failed — refunded");
    res.status(502).json({ error: "The persona didn't come through — your Visual Bucs were refunded. Try again." });
  }
};

router.post("/ugc-ads/persona", generationLimiter, requireAuth, generateUgcPersonaHandler);

/* Operator core (Phase 2 Lane E): the Tier 3 ugc.persona tool runs
   this exact handler in-process (lib/rail-core) — same charge-first
   idempotency discipline (the executor's confirmation key rides in
   as the body's client idempotencyKey) and refund-on-failure. */
export async function runGenerateUgcPersona(
  deps: RailCoreDeps,
  body: unknown,
): Promise<RailCoreResult> {
  return invokeRailHandler(generateUgcPersonaHandler as never, deps, { body });
}

/* ── GET /api/ugc-ads — my ads ──────────────────────────────────────── */
router.get("/ugc-ads", requireAuth, async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(ugcAdsTable)
      .where(eq(ugcAdsTable.userId, req.userId!))
      .orderBy(desc(ugcAdsTable.createdAt))
      .limit(100);
    res.json({ ads: await Promise.all(rows.map(toDTO)) });
  } catch (err) {
    logger.error({ err }, "[ugc-ads] list failed");
    res.status(500).json({ error: "Could not load your UGC ads — try again." });
  }
});

/* ── POST /api/ugc-ads — start an ad ────────────────────────────────── */
const createAdSchema = z.object({
  productSource: z.enum(["shop", "upload"]),
  shopProductId: z.string().uuid().optional(),
  productName: z.string().trim().min(1).max(120).optional(),
  productBlurb: z.string().trim().max(600).optional(),
  productPriceCents: z.number().int().min(0).max(100_000_000).optional(),
  productImageUrl: ImageUrlSchema.optional(),
  style: z.enum(UGC_STYLES).optional(),
  faceImageUrl: ImageUrlSchema.nullable().optional(),
  faceKind: z.enum(["persona", "photo"]).optional(),
  script: ScriptSchema.nullable().optional(),
  briefId: z.string().uuid().optional(),
});

const createUgcAdHandler = async (req: Request, res: Response) => {
  const parsed = createAdSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid ad request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const d = parsed.data;
  try {
    /* Brief pre-fill: the brief must be MINE to answer — claimed by me
       and still in the claimed state. Anything else is a 404 (the
       board's existence rules live in ugc-briefs.ts; an ad can't be
       started against a brief the caller hasn't claimed). */
    let brief: typeof ugcBriefsTable.$inferSelect | null = null;
    if (d.briefId) {
      const [row] = await db
        .select()
        .from(ugcBriefsTable)
        .where(
          and(
            eq(ugcBriefsTable.id, d.briefId),
            eq(ugcBriefsTable.claimedByUserId, req.userId!),
            eq(ugcBriefsTable.status, "claimed"),
          ),
        )
        .limit(1);
      if (!row) {
        res.status(404).json({ error: "That brief isn't claimed by you — claim it on the board first." });
        return;
      }
      brief = row;
    }

    /* Product truth: a shop product's name/price/image come from the
       shop_products row itself (seller = caller), never the client. */
    let productName = d.productName?.trim() ?? "";
    let productPriceCents: number | null = d.productPriceCents ?? null;
    let productImageRaw: string | null = d.productImageUrl ?? null;
    let shopProductId: string | null = null;
    if (d.productSource === "shop") {
      if (!d.shopProductId) {
        res.status(400).json({ error: "Pick one of your shop products." });
        return;
      }
      const [product] = await db
        .select()
        .from(shopProductsTable)
        .where(and(eq(shopProductsTable.id, d.shopProductId), eq(shopProductsTable.user_id, req.userId!)))
        .limit(1);
      if (!product) {
        res.status(404).json({ error: "That product isn't in your shop." });
        return;
      }
      shopProductId = product.id;
      productName = product.name;
      productPriceCents = product.price_cents ?? null;
      productImageRaw = product.image_url ?? null;
    }
    if (brief) {
      if (!productName) productName = brief.productName;
      if (!productImageRaw) productImageRaw = brief.productImageRef ?? null;
    }
    if (!productName) {
      res.status(400).json({ error: "Name the product this ad is for." });
      return;
    }
    const style = d.style ?? (brief ? (brief.style as UgcStyle) : undefined);
    if (!style || !(UGC_STYLES as readonly string[]).includes(style)) {
      res.status(400).json({ error: "Pick a style for the ad." });
      return;
    }

    const productImageRef = await storeProductImage(productImageRaw, req.userId!);
    const faceImageRef = d.faceImageUrl
      ? (normalizeToStorageRef(d.faceImageUrl) ?? d.faceImageUrl)
      : null;

    const [row] = await db
      .insert(ugcAdsTable)
      .values({
        userId: req.userId!,
        briefId: brief?.id ?? null,
        productSource: d.productSource,
        shopProductId,
        productName,
        productBlurb: d.productBlurb?.trim() || null,
        productPriceCents,
        productImageRef,
        style,
        faceImageRef,
        faceKind: faceImageRef ? (d.faceKind ?? "photo") : "none",
        script: d.script ?? null,
        captions: [],
        captionsBurned: false,
        status: "draft",
      })
      .returning();
    res.status(201).json({ ad: await toDTO(row!) });
  } catch (err) {
    logger.error({ err }, "[ugc-ads] create failed");
    res.status(500).json({ error: "Could not start that ad — try again." });
  }
};

router.post("/ugc-ads", publicApiLimiter, requireAuth, createUgcAdHandler);

/* Operator core (Phase 2 Lane E): creating the ad record is the free
   first half of the Tier 3 ugc.video tool — the same handler the
   page's maker calls (brief ownership + shop-product truth intact). */
export async function runCreateUgcAd(
  deps: RailCoreDeps,
  body: unknown,
): Promise<RailCoreResult> {
  return invokeRailHandler(createUgcAdHandler as never, deps, { body });
}

/* ── GET /api/ugc-ads/:id — mine, or delivered to my brief ──────────── */
router.get("/ugc-ads/:id", requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    const mine = await ownAd(req.userId!, id);
    if (mine) {
      res.json({ ad: await toDTO(mine) });
      return;
    }
    /* The one read exception: the brand a brief was delivered to may
       read the delivered ad to review it before approving. */
    const [brief] = await db
      .select()
      .from(ugcBriefsTable)
      .where(and(eq(ugcBriefsTable.deliveredAdId, id), eq(ugcBriefsTable.brandUserId, req.userId!)))
      .limit(1);
    if (brief) {
      const [ad] = await db.select().from(ugcAdsTable).where(eq(ugcAdsTable.id, id)).limit(1);
      if (ad) {
        res.json({ ad: await toDTO(ad), viaBriefId: brief.id });
        return;
      }
    }
    res.status(404).json({ error: "UGC ad not found" });
  } catch (err) {
    logger.error({ err }, "[ugc-ads] get failed");
    res.status(500).json({ error: "Could not load that ad — try again." });
  }
});

/* ── PATCH /api/ugc-ads/:id — edit a draft (script / face / style) ─── */
const patchAdSchema = z.object({
  script: ScriptSchema.nullable().optional(),
  faceImageUrl: ImageUrlSchema.nullable().optional(),
  faceKind: z.enum(["persona", "photo"]).optional(),
  style: z.enum(UGC_STYLES).optional(),
  productBlurb: z.string().trim().max(600).nullable().optional(),
});

router.patch("/ugc-ads/:id", requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  const parsed = patchAdSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid edit.", details: parsed.error.issues });
    return;
  }
  try {
    const row = await ownAd(req.userId!, id);
    if (!row) {
      res.status(404).json({ error: "UGC ad not found" });
      return;
    }
    if (row.status !== "draft" && row.status !== "failed") {
      res.status(409).json({ error: `This ad is ${row.status} — only a draft can be edited.` });
      return;
    }
    const set: Partial<typeof ugcAdsTable.$inferInsert> = { updatedAt: new Date() };
    if (parsed.data.script !== undefined) set.script = parsed.data.script;
    if (parsed.data.style !== undefined) set.style = parsed.data.style;
    if (parsed.data.productBlurb !== undefined) set.productBlurb = parsed.data.productBlurb;
    if (parsed.data.faceImageUrl !== undefined) {
      set.faceImageRef = parsed.data.faceImageUrl
        ? (normalizeToStorageRef(parsed.data.faceImageUrl) ?? parsed.data.faceImageUrl)
        : null;
      set.faceKind = parsed.data.faceImageUrl ? (parsed.data.faceKind ?? "photo") : "none";
    }
    const [saved] = await db
      .update(ugcAdsTable)
      .set(set)
      .where(and(eq(ugcAdsTable.id, id), eq(ugcAdsTable.userId, req.userId!)))
      .returning();
    res.json({ ad: await toDTO(saved!) });
  } catch (err) {
    logger.error({ err }, "[ugc-ads] patch failed");
    res.status(500).json({ error: "Could not save that edit — try again." });
  }
});

/* ── DELETE /api/ugc-ads/:id — row only; storage is never purged ───── */
router.delete("/ugc-ads/:id", requireAuth, async (req, res) => {
  const { id } = req.params as { id: string };
  try {
    const row = await ownAd(req.userId!, id);
    if (!row) {
      res.status(404).json({ error: "UGC ad not found" });
      return;
    }
    await db
      .delete(ugcAdsTable)
      .where(and(eq(ugcAdsTable.id, id), eq(ugcAdsTable.userId, req.userId!)));
    res.json({ success: true });
  } catch (err) {
    logger.error({ err }, "[ugc-ads] delete failed");
    res.status(500).json({ error: "Could not delete that ad — try again." });
  }
});

/* ── POST /api/ugc-ads/:id/generate — make the video ───────────────── */
const generateSchema = z.object({
  idempotencyKey: z.string().trim().max(120).optional(),
});

async function waitForRunwayTask(client: RunwayML, taskId: string): Promise<string> {
  const interval = Number(process.env["UGC_POLL_INTERVAL_MS"]) || 5000;
  const timeout = Number(process.env["UGC_POLL_TIMEOUT_MS"]) || 240_000;
  const deadline = Date.now() + timeout;
  for (;;) {
    const task = await client.tasks.retrieve(taskId);
    if (task.status === "SUCCEEDED") {
      const url = (task.output as string[] | undefined)?.[0];
      if (!url) throw new Error("The render finished but returned no video.");
      return url;
    }
    if (task.status === "FAILED" || task.status === "CANCELLED") {
      const reason = (task as { failure?: string }).failure;
      throw new Error(reason ? `The render failed: ${reason}` : "The render failed on the video desk.");
    }
    if (Date.now() >= deadline) {
      throw new Error("The render is taking too long — your Visual Bucs were refunded. Try again.");
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

async function downloadToTempFile(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Could not download the rendered video (${res.status}).`);
  if (!res.body) throw new Error("The rendered video came back empty.");
  const dest = join(tmpdir(), `ugc-ad-${randomUUID()}.mp4`);
  await pipeline(res.body as Parameters<typeof pipeline>[0], createWriteStream(dest));
  return dest;
}

function cleanupFile(f: string | null) {
  try {
    if (f && existsSync(f)) unlinkSync(f);
  } catch {
    /* best-effort */
  }
}

const generateUgcAdHandler = async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const parsed = generateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid generate request.", details: parsed.error.issues });
    return;
  }
  let ad: typeof ugcAdsTable.$inferSelect | null = null;
  try {
    ad = await ownAd(req.userId!, id);
  } catch (err) {
    logger.error({ err }, "[ugc-ads] generate load failed");
    res.status(500).json({ error: "Could not load that ad — try again." });
    return;
  }
  if (!ad) {
    res.status(404).json({ error: "UGC ad not found" });
    return;
  }
  if (ad.status === "ready") {
    /* Idempotent replay: the video exists — hand it back, charge nothing. */
    res.json({ ad: await toDTO(ad), alreadyGenerated: true, creditsUsed: 0 });
    return;
  }
  if (ad.status === "generating") {
    res.status(409).json({
      error: "This ad is already generating — give it a moment and refresh.",
    });
    return;
  }
  const script = normalizeScript(ad.script);
  if (!script) {
    res.status(400).json({ error: "This ad needs a script first — write one or let Turbo write it." });
    return;
  }

  const attempt = (ad.videoAttempts ?? 0) + 1;
  const key = buildChargeIdempotencyKey("ugc-ad-video", req.userId!, null, {
    adId: id,
    attempt,
    clientKey: parsed.data.idempotencyKey ?? null,
  });

  /* Brand kit, read at generation time (best-effort: no kit = no brand
     line, never a failed generation). */
  let brand: UgcBrandSnapshot | null = null;
  try {
    const kit = await readBrandKit(req.userId!);
    if (kit) {
      brand = {
        brandName: kit.brandName || null,
        logoUrl: kit.logoUrl ?? null,
        primaryColor: kit.colors?.[0]?.hex ?? null,
        vibe: kit.vibe || null,
      };
    }
  } catch {
    brand = null;
  }

  const captions = buildCaptionLines(script);
  const setGenerating = async (patch: Partial<typeof ugcAdsTable.$inferInsert>) => {
    const [row] = await db
      .update(ugcAdsTable)
      .set({ ...patch, updatedAt: new Date() })
      .where(and(eq(ugcAdsTable.id, id), eq(ugcAdsTable.userId, req.userId!)))
      .returning();
    return row ?? null;
  };

  await setGenerating({
    status: "generating",
    generationKey: key,
    videoAttempts: attempt,
    lastError: null,
  });

  /* Charge BEFORE the provider call, keyed idempotently per attempt. */
  let creditsRemaining = req.userCredits ?? 0;
  try {
    creditsRemaining = await chargeCredits(
      req.userId!,
      UGC_VIDEO_CREDIT_COST,
      { action: "UGC Product Ad Video" },
      { idempotencyKey: key },
    );
  } catch (err) {
    await setGenerating({ status: ad.status, generationKey: null });
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({
        error: "out_of_credits",
        message: `You need ${UGC_VIDEO_CREDIT_COST} Visual Bucs to generate this ad — top up to keep creating.`,
      });
      return;
    }
    logger.error({ err }, "[ugc-ads] charge failed");
    res.status(500).json({ error: "The charge didn't land — no Visual Bucs moved. Try again." });
    return;
  }

  const failWithRefund = async (message: string, status = 502) => {
    try {
      await refundCredits(req.userId!, UGC_VIDEO_CREDIT_COST, {
        action: "UGC Product Ad Video — Refund (generation failed)",
      });
    } catch (refundErr) {
      logger.error({ err: refundErr, adId: id }, "[ugc-ads] refund failed after generation error");
    }
    await setGenerating({ status: "failed", lastError: message });
    res.status(status).json({ error: message, refunded: true });
  };

  const apiKey = process.env["RUNWAYML_API_SECRET"];
  if (!apiKey) {
    await failWithRefund("The video desk isn't connected on the server yet — your Visual Bucs were refunded.", 503);
    return;
  }

  let tmpFile: string | null = null;
  let captionedFile: string | null = null;
  try {
    /* The face anchors the render when there is one; otherwise the
       product photo does; otherwise text-to-video carries it. */
    const faceUrl = ad.faceImageRef ? await refreshSupabaseStorageUrl(ad.faceImageRef) : null;
    const productUrl = ad.productImageRef ? await refreshSupabaseStorageUrl(ad.productImageRef) : null;
    const refImage = [faceUrl, productUrl].find((u) => u && /^https:\/\//i.test(u)) ?? null;
    const prompt = buildUgcVideoPrompt({
      productName: ad.productName,
      productBlurb: ad.productBlurb ?? null,
      style: ad.style as UgcStyle,
      script,
      hasFace: !!faceUrl,
      brand,
    });

    const client = new RunwayML({ apiKey });
    const task = refImage
      ? await client.imageToVideo.create({
          model: "gen4.5",
          promptImage: refImage,
          promptText: prompt.slice(0, 1000),
          duration: 5,
          ratio: "720:1280",
          contentModeration: { publicFigureThreshold: "low" },
        })
      : await client.textToVideo.create({
          model: "gen4.5",
          promptText: prompt,
          duration: 5,
          ratio: "720:1280",
        });
    const runwayUrl = await waitForRunwayTask(client, task.id);

    tmpFile = await downloadToTempFile(runwayUrl);
    /* Captions: burn the script's lines in when the burn lands; the
       clean clip + the caption track is the honest fallback. */
    const burner = captionBurnerOverride ?? defaultCaptionBurner;
    captionedFile = await burner(tmpFile, captions, brand?.primaryColor ?? null).catch(() => null);
    const finalFile = captionedFile ?? tmpFile;
    const storageRef = await uploadFileStreamToSupabaseStorage(
      SUPABASE_CLIPS_BUCKET,
      `ugc-ads/${randomUUID()}.mp4`,
      finalFile,
      "video/mp4",
    );

    const [saved] = await db
      .update(ugcAdsTable)
      .set({
        status: "ready",
        videoRef: storageRef,
        captions,
        captionsBurned: captionedFile !== null,
        brandSnapshot: brand,
        creditsCharged: (ad.creditsCharged ?? 0) + UGC_VIDEO_CREDIT_COST,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(and(eq(ugcAdsTable.id, id), eq(ugcAdsTable.userId, req.userId!)))
      .returning();
    if (!saved) throw new Error("The ad record vanished mid-generation.");

    /* Save to the member's clip library too (best-effort — the ad
       record above is the source of truth). */
    try {
      await db.insert(generatedClipsTable).values({
        user_id: req.userId!,
        title: `${ad.productName} — UGC ad`,
        prompt,
        final_prompt: prompt,
        runway_job_id: task.id,
        video_url: storageRef,
        status: "completed",
      });
    } catch (libErr) {
      logger.warn({ err: libErr, adId: id }, "[ugc-ads] library save failed (ad record stands)");
    }

    res.json({
      ad: await toDTO(saved),
      creditsUsed: UGC_VIDEO_CREDIT_COST,
      creditsRemaining,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "The render failed — your Visual Bucs were refunded.";
    logger.error({ err, adId: id }, "[ugc-ads] generation failed — refunding");
    await failWithRefund(message);
  } finally {
    cleanupFile(tmpFile);
    if (captionedFile && captionedFile !== tmpFile) cleanupFile(captionedFile);
  }
};

router.post("/ugc-ads/:id/generate", generationLimiter, requireAuth, generateUgcAdHandler);

/* Operator core (Phase 2 Lane E): the Tier 3 ugc.video tool renders
   through this exact handler in-process (lib/rail-core) — same
   per-attempt idempotency key (the executor's confirmation key rides
   in as the body's client key) and refund-on-failure. A ready ad
   replays free, exactly as the page's button behaves. */
export async function runGenerateUgcAd(
  deps: RailCoreDeps,
  adId: string,
  body: unknown,
): Promise<RailCoreResult> {
  return invokeRailHandler(generateUgcAdHandler as never, deps, { body, params: { id: adId } });
}

export default router;
