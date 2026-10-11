import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middlewares/require-auth";
import { generationLimiter } from "../../lib/rate-limit";
import { chargeCredits as chargeCreditsAtomic, LedgerWriteError } from "../../lib/credits";
import { saveGeneration } from "../../lib/save-generation";
import { r2Upload } from "../../lib/r2-client";

/* ─── Product Photo Studio ────────────────────────────────────────────────
   AI product photography for the branding shop / storefront SELL flow:
   clean white-background packshots + styled lifestyle scenes, generated
   from the seller's own product photo.

   Provider pattern mirrors generate/artist-image.ts exactly:
   Nano Banana 2.1 (GEMINI_API_KEY) is the default product-accurate model;
   Ideogram 4.0 (IDEOGRAM_API_KEY) is the shaped alternative for products
   with text/logos. Both are synchronous — no polling.
   ───────────────────────────────────────────────────────────────────────── */

const router = Router();

/* Site credits per generated product photo. Env-overridable without a deploy.
   PLACEHOLDER prices — the user has NOT approved real prices yet. */
const PACKSHOT_CREDITS = Number(process.env["PRODUCT_PHOTO_PACKSHOT_CREDITS"]) || 100;
const LIFESTYLE_CREDITS = Number(process.env["PRODUCT_PHOTO_LIFESTYLE_CREDITS"]) || 150;

/** Google Gemini image model (Nano Banana 2.1) — env-overridable. Requires GEMINI_API_KEY. */
const NANO_MODEL = process.env["GEMINI_IMAGE_MODEL"] || "gemini-nano-banana-2.1";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${NANO_MODEL}:generateContent`;

/** Maps the site's ratio picker to Gemini aspect ratios. */
const NANO_ASPECT: Record<string, "9:16" | "1:1" | "16:9"> = {
  "1080:1920": "9:16",
  "1080:1080": "1:1",
  "1920:1080": "16:9",
};

/** Maps the site's ratio picker to Ideogram v4 aspect_ratio values. */
const IDEOGRAM_ASPECT: Record<string, "9x16" | "1x1" | "16x9"> = {
  "1080:1920": "9x16",
  "1080:1080": "1x1",
  "1920:1080": "16x9",
};

/* ── Scene presets (frontend sends the id; the prompt text lives here) ── */
export const PACKSHOT_PRESETS = {
  "studio-white": "Seamless pure white studio background, soft even commercial lighting, gentle soft shadow beneath the product. Premium e-commerce packshot.",
  "light-grey": "Clean light grey studio sweep background, soft diffused lighting, subtle soft shadow. Premium calm e-commerce packshot.",
  "infinity-white": "White infinity cove studio, high-key commercial lighting, crisp subtle reflections beneath the product. High-end e-commerce packshot.",
} as const;

export const LIFESTYLE_PRESETS = {
  "marble-luxe": "Luxurious marble countertop scene, soft window light, elegant gold accents softly blurred in the background, high-end editorial product photography.",
  "street-style": "Urban street-style scene in daylight, the product worn and styled in a candid city environment, shallow depth of field, fashion editorial product photography.",
  "golden-hour": "Warm golden-hour sunlight scene, cozy premium atmosphere, soft bokeh background, lifestyle product photography.",
  "cozy-home": "Stylish modern home interior, soft natural daylight, the product styled on a wooden table with plants nearby, warm lifestyle product photography.",
} as const;

export type PackshotPresetId = keyof typeof PACKSHOT_PRESETS;
export type LifestylePresetId = keyof typeof LIFESTYLE_PRESETS;

/* ── AI autopilot: picks the fitting scene from the product kind ── */
const AUTOPILOT_SCENES: Record<string, string> = {
  apparel: LIFESTYLE_PRESETS["street-style"],
  drinkware: LIFESTYLE_PRESETS["golden-hour"],
  jewelry: LIFESTYLE_PRESETS["marble-luxe"],
  poster: LIFESTYLE_PRESETS["cozy-home"],
  accessory: LIFESTYLE_PRESETS["street-style"],
  home: LIFESTYLE_PRESETS["cozy-home"],
  other: LIFESTYLE_PRESETS["marble-luxe"],
};

/** Product-identity lock: the reference photo IS the product — the model
 *  must restage it, never redesign it. */
const IDENTITY_DIRECTIVE =
  "Use the provided product reference photo as the exact product reference. " +
  "Preserve the product's exact shape, color, materials, branding, logos, and any printed text precisely — " +
  "do not redesign, recolor, or alter the product itself. Only change the setting, lighting, and background around it.";

interface GeminiPart { inlineData?: { data?: string }; text?: string }
interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
  promptFeedback?: { blockReason?: string };
}

/** Fetches a reference image URL and returns it as base64 + mime type.
 *  Returns null when the fetch fails. */
async function fetchReferenceAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 8 * 1024 * 1024) return null;
    const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
    return { data: buf.toString("base64"), mimeType };
  } catch {
    return null;
  }
}

/** Calls Nano Banana 2.1 via the Gemini API. Returns the generated PNG buffer. */
async function generateWithNanoBanana(opts: {
  prompt: string;
  aspectRatio: "9:16" | "1:1" | "16:9";
  referenceImageUrl: string;
  log: { warn: (...a: unknown[]) => void };
}): Promise<Buffer> {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured on the server");

  const ref = await fetchReferenceAsBase64(opts.referenceImageUrl);
  if (!ref) throw new Error("Could not load your product photo. Check the image URL and try again.");

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: opts.prompt }, { inlineData: { mimeType: ref.mimeType, data: ref.data } }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: opts.aspectRatio, imageSize: "2K" },
      },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini API error (${res.status}): ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as GeminiResponse;
  const b64 = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
  if (!b64) {
    const blockReason = json.promptFeedback?.blockReason;
    throw new Error(
      blockReason
        ? `Nano Banana blocked this image (${blockReason}). Try a different scene description.`
        : "Nano Banana returned no image data.",
    );
  }
  return Buffer.from(b64, "base64");
}

/** Calls Ideogram 4.0 (best in-image text rendering — product labels/logos).
 *  Mirrors artist-image.ts exactly: the v4 generate endpoint takes the
 *  prompt only, so the product-identity directive rides in the prompt text.
 *  For pixel-accurate product restaging, Nano Banana (reference-image
 *  model) is the recommended model; Ideogram is the text/label alternative.
 *  Ideogram URLs are ephemeral, so the image is downloaded immediately. */
async function generateWithIdeogram(prompt: string, ratio?: string): Promise<Buffer> {
  const apiKey = process.env["IDEOGRAM_API_KEY"];
  if (!apiKey) throw new Error("IDEOGRAM_API_KEY is not configured on the server");

  const form = new FormData();
  form.append("text_prompt", prompt.slice(0, 4000));
  /* magic-prompt auto-enables with text_prompt and improves text layout;
     rendering_speed FLASH is not yet supported (API returns 400). */
  form.append("rendering_speed", "DEFAULT");
  /* Honor the UI's aspect-ratio picker — without this Ideogram falls back
     to its server default regardless of what the user chose. */
  form.append("aspect_ratio", IDEOGRAM_ASPECT[ratio ?? ""] ?? "1x1");

  const res = await fetch("https://api.ideogram.ai/v1/ideogram-v4/generate", {
    method: "POST",
    headers: { "Api-Key": apiKey },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ideogram API error (${res.status}): ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: { url?: string }[] };
  const url = json.data?.[0]?.url;
  if (!url) throw new Error("Ideogram returned no image data.");
  const dl = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!dl.ok) throw new Error(`Ideogram image download failed (${dl.status})`);
  return Buffer.from(await dl.arrayBuffer());
}

/**
 * Deducts site credits after a successful synchronous generation.
 * Mirrors the charge logic in artist-image.ts: charges once, records usage.
 */
async function chargeForProductPhoto(req: {
  userId?: string;
  log: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };
}, credits: number, action = "Product Photo"): Promise<void> {
  // chargeCreditsAtomic(): fresh-read deduct + strict ledger write. The image
  // was already delivered, so on ledger failure the deduction stands (rollback
  // disabled) and the gap is logged CRITICAL for manual reconciliation —
  // never silent.
  try {
    const creditsAfter = await chargeCreditsAtomic(
      req.userId!,
      credits,
      { action },
      { rollbackOnLedgerFailure: false },
    );
    req.log.info({ userId: req.userId, creditsAfter, deducted: credits }, `[product-photo] credits deducted (${action})`);
  } catch (err) {
    if (err instanceof LedgerWriteError) {
      req.log.error({ err }, "[product-photo] CRITICAL: ledger write failed after deduction — image delivered, charge has no ledger trace");
    } else {
      req.log.error({ err }, "[product-photo] credit deduction FAILED — image delivered without charge");
    }
  }
}

/* ── Request validation ── */
const productPhotoSchema = z.object({
  /** The seller's own product photo (public https URL). The AI restages it. */
  productImageUrl: z.string().max(2048),
  productName: z.string().max(120).optional().nullable(),
  productKind: z.enum(["apparel", "drinkware", "jewelry", "poster", "accessory", "home", "other"]).optional().nullable(),
  shotType: z.enum(["packshot", "lifestyle"]).default("packshot"),
  /** autopilot (AI picks), preset (one of the ids below), custom (free text). */
  styleMode: z.enum(["autopilot", "preset", "custom"]).default("autopilot"),
  scenePreset: z.string().max(40).optional().nullable(),
  customPrompt: z.string().max(2000).optional().nullable(),
  model: z.string().max(100).optional(),
  ratio: z.string().max(20).optional(),
});

type ProductPhotoModel = "nano-banana-2.1" | "ideogram-4.0";

function resolveModel(model?: string): ProductPhotoModel {
  return model === "ideogram-4.0" ? "ideogram-4.0" : "nano-banana-2.1";
}

/** Builds the final generation prompt from shot type + style mode. */
function composeScenePrompt(opts: {
  shotType: "packshot" | "lifestyle";
  styleMode: "autopilot" | "preset" | "custom";
  scenePreset?: string | null;
  customPrompt?: string | null;
  productKind?: string | null;
  productName?: string | null;
}): string {
  const { shotType, styleMode, scenePreset, customPrompt, productKind, productName } = opts;
  const nameBit = productName?.trim() ? ` The product is: ${productName.trim()}.` : "";

  let scene: string;
  if (styleMode === "custom") {
    scene = customPrompt?.trim() || "";
  } else if (styleMode === "preset" && scenePreset) {
    const pack = (PACKSHOT_PRESETS as Record<string, string>)[scenePreset];
    const life = (LIFESTYLE_PRESETS as Record<string, string>)[scenePreset];
    scene = (shotType === "packshot" ? pack : life) ?? "";
  } else {
    /* Autopilot: fit the scene to the product kind. */
    if (shotType === "packshot") {
      scene = PACKSHOT_PRESETS["studio-white"];
    } else {
      scene = AUTOPILOT_SCENES[productKind ?? "other"] ?? LIFESTYLE_PRESETS["marble-luxe"];
    }
  }

  /* Packshot safety net: guarantee a clean studio background even if a
     custom prompt forgot it. */
  const needsCleanBg =
    shotType === "packshot" && !/white|gr[ae]y|neutral|studio background|infinity/i.test(scene);
  const bgDirective = needsCleanBg ? " On a seamless pure white studio background." : "";

  return `${IDENTITY_DIRECTIVE} ${scene}${bgDirective}${nameBit} Commercial product photography, sharp product detail, professional lighting.`.slice(0, 4000);
}

/* ─────────────────────────────────────────────────────────────────────────────
   POST /generate-product-photo
   1. Validate.
   2. Provider key gate — 503 with a clear "not connected" message when the
      chosen model's key is missing (before any credit check).
   3. Credit pre-check — always enforced (no dev bypass).
   4. Generate synchronously (Nano Banana / Ideogram), charge on success only,
      upload to R2, save to generation history.
   5. Return { taskId, status: "succeeded", url, path, creditCost, model }.
───────────────────────────────────────────────────────────────────────────── */
router.post("/generate-product-photo", requireAuth, generationLimiter, async (req, res) => {
  const parsed = productPhotoSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid product photo request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { productImageUrl, productName, productKind, shotType, styleMode, scenePreset, customPrompt, model, ratio } = parsed.data;

  const refUrl = productImageUrl?.trim();
  if (!refUrl || !/^https:\/\//i.test(refUrl)) {
    res.status(400).json({ error: "Upload a product photo first — the AI needs to see your product." });
    return;
  }
  if (styleMode === "custom" && !customPrompt?.trim()) {
    res.status(400).json({ error: "Describe the scene first." });
    return;
  }

  const useModel = resolveModel(model);

  /* ── Provider key gate: 503 + clear "not connected" message ── */
  if (useModel === "nano-banana-2.1" && !process.env["GEMINI_API_KEY"]) {
    res.status(503).json({
      error: "Nano Banana is not connected on the server. Connect a Gemini API key to enable product photos.",
    });
    return;
  }
  if (useModel === "ideogram-4.0" && !process.env["IDEOGRAM_API_KEY"]) {
    res.status(503).json({
      error: "Ideogram is not connected on the server. Connect an Ideogram API key to enable product photos.",
    });
    return;
  }

  const creditCost = shotType === "lifestyle" ? LIFESTYLE_CREDITS : PACKSHOT_CREDITS;

  /* ── Credit pre-check — always enforced ── */
  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < creditCost) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Please Buy more Visual Bucs to continue.",
    });
    return;
  }

  const finalPrompt = composeScenePrompt({ shotType, styleMode, scenePreset, customPrompt, productKind, productName });
  const action = shotType === "lifestyle" ? "Product Photo (Lifestyle)" : "Product Photo (Packshot)";

  try {
    req.log.info(
      { userId: req.userId, shotType, styleMode, scenePreset: scenePreset ?? null, model: useModel },
      "[product-photo] generation started",
    );

    const buffer = useModel === "ideogram-4.0"
      ? await generateWithIdeogram(finalPrompt, ratio)
      : await generateWithNanoBanana({
          prompt: finalPrompt,
          aspectRatio: NANO_ASPECT[ratio ?? ""] ?? "1:1",
          referenceImageUrl: refUrl,
          log: req.log,
        });

    await chargeForProductPhoto(req, creditCost, action);

    const filePath = `${req.userId}/product-photos/${randomUUID()}.png`;
    const publicUrl = await r2Upload(filePath, buffer, "image/png");

    saveGeneration({
      userId: req.userId!,
      type: "image",
      title: `Product Photo — ${productName?.trim() || shotType}`,
      fileUrl: publicUrl,
      thumbnailUrl: publicUrl,
      prompt: finalPrompt,
      creditsSpent: creditCost,
      metadata: { shotType, styleMode, model: useModel, productKind: productKind ?? null },
    });

    res.json({
      taskId: `pp-${randomUUID()}`,
      status: "succeeded",
      url: publicUrl,
      path: filePath,
      creditCost,
      model: useModel,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Product photo generation failed";
    req.log.error({ err: msg }, "[product-photo] generation failed — no credits charged");
    const status = /not connected|not configured/i.test(msg) ? 503 : 500;
    res.status(status).json({ error: msg });
  }
});

export default router;
