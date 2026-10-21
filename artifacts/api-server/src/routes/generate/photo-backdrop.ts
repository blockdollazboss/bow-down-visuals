import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middlewares/require-auth";
import { generationLimiter } from "../../lib/rate-limit";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../../lib/credits";
import { r2Upload } from "../../lib/r2-client";

const router = Router();

/* ─── AI photo backdrops (Background Studio tab) ────────────────────────────
   Generates a NEW AI backdrop for a cut-out photo (e.g. after
   POST /api/remove-background). Provider pattern mirrors artist-image.ts
   exactly:

   - Nano Banana 2.1 (default) via GEMINI_API_KEY → Gemini generateContent
     with responseModalities: ["IMAGE"], imageSize 2K
   - Ideogram 4.0 (alternative) via IDEOGRAM_API_KEY → ideogram-v4/generate

   GATED: returns 503 naming the missing env var when the chosen provider's
   key is not configured — the UI shows a clear "not connected" message and
   disables the option. No job is created and no credits are charged when
   unconfigured.

   *** PRICE PLACEHOLDER — NOT USER-APPROVED ***
   Draft price 100 VB (~$0.50). Real provider cost is ~$0.03–$0.05 per image
   so this holds a healthy margin, but the user must approve the real price
   before this goes live. Env-overridable via PHOTO_BACKDROP_CREDITS. */

const BACKDROP_COST = Number(process.env["PHOTO_BACKDROP_CREDITS"]) || 100;

/** Google Gemini image model (Nano Banana 2.1) — env-overridable. Requires GEMINI_API_KEY. */
const NANO_MODEL = process.env["GEMINI_IMAGE_MODEL"] || "gemini-nano-banana-2.1";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${NANO_MODEL}:generateContent`;

/** Maps the UI's ratio picker to Gemini aspect ratios. */
const NANO_ASPECT: Record<string, "9:16" | "1:1" | "16:9"> = {
  "1080:1920": "9:16",
  "1080:1080": "1:1",
  "1920:1080": "16:9",
};

/** Maps the UI's ratio picker to Ideogram v4 aspect_ratio values. */
const IDEOGRAM_ASPECT: Record<string, "9x16" | "1x1" | "16x9"> = {
  "1080:1920": "9x16",
  "1080:1080": "1x1",
  "1920:1080": "16x9",
};

const PROVIDERS = ["nano-banana-2.1", "ideogram-4.0"] as const;
type BackdropProvider = (typeof PROVIDERS)[number];

/** Returns the missing env var for a provider, or null when it is connected. */
function missingKey(provider: BackdropProvider): string | null {
  if (provider === "ideogram-4.0") {
    return process.env["IDEOGRAM_API_KEY"] ? null : "IDEOGRAM_API_KEY";
  }
  return process.env["GEMINI_API_KEY"] ? null : "GEMINI_API_KEY";
}

const backdropSchema = z.object({
  /** Backdrop description — text only, no subject (the cut-out photo layers on top). */
  prompt: z.string().trim().min(1, "prompt is required").max(2000),
  provider: z.enum(PROVIDERS).optional().default("nano-banana-2.1"),
  ratio: z.enum(["1080:1920", "1080:1080", "1920:1080"]).optional().default("1080:1080"),
});

interface GeminiPart { inlineData?: { data?: string }; text?: string }
interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
  promptFeedback?: { blockReason?: string };
}

/** Calls Nano Banana 2.1 via the Gemini API. Returns the generated PNG buffer. */
async function generateWithNanoBanana(prompt: string, aspectRatio: "9:16" | "1:1" | "16:9"): Promise<Buffer> {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured on the server");

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio, imageSize: "2K" },
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
        ? `Nano Banana blocked this backdrop (${blockReason}). Try a different description.`
        : "Nano Banana returned no image data.",
    );
  }
  return Buffer.from(b64, "base64");
}

/** Calls Ideogram 4.0. Ideogram URLs are ephemeral, so the image is downloaded immediately. */
async function generateWithIdeogram(prompt: string, ratio?: string): Promise<Buffer> {
  const apiKey = process.env["IDEOGRAM_API_KEY"];
  if (!apiKey) throw new Error("IDEOGRAM_API_KEY is not configured on the server");

  const form = new FormData();
  form.append("text_prompt", prompt.slice(0, 4000));
  form.append("rendering_speed", "DEFAULT");
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

/* ─────────────────────────────────────────────────────────────────────────────
   GET /photo-backdrop/status
   Lets the Background Studio UI know whether each provider is connected
   before the user ever picks "AI backdrop" (gate UI, not just error UI).
───────────────────────────────────────────────────────────────────────────── */
router.get("/photo-backdrop/status", requireAuth, async (_req, res) => {
  res.json({
    configured: !missingKey("nano-banana-2.1") || !missingKey("ideogram-4.0"),
    nanoConfigured: !missingKey("nano-banana-2.1"),
    ideogramConfigured: !missingKey("ideogram-4.0"),
    creditCost: BACKDROP_COST,
    /* Draft price — NOT user-approved. */
    pricePlaceholder: true,
  });
});

/* ─────────────────────────────────────────────────────────────────────────────
   POST /photo-backdrop
   Synchronous AI backdrop generation for the Background Studio.
   - 400 invalid body
   - 402 out of credits
   - 503 chosen provider not connected (no charge)
   - 200 { status, url, path, creditCost, model }
   Credits are charged upfront and REFUNDED on failure (mirrors
   background-removal.ts).
───────────────────────────────────────────────────────────────────────────── */
router.post("/photo-backdrop", requireAuth, generationLimiter, async (req, res) => {
  const parsed = backdropSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid backdrop request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { prompt, provider, ratio } = parsed.data;

  /* ── Gate FIRST: clear 503 before any credit check or spend ── */
  const missing = missingKey(provider);
  if (missing) {
    res.status(503).json({
      error: "PROVIDER_NOT_CONNECTED",
      message: `AI backdrops are not connected on this server (${missing} is not set). Pick a solid color or preset scene instead.`,
    });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < BACKDROP_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, BACKDROP_COST, {
      action: "Photo AI Backdrop",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }

  try {
    req.log.info(
      { userId: req.userId, provider, ratio },
      "[photo-backdrop] AI backdrop generation started",
    );

    const buffer =
      provider === "ideogram-4.0"
        ? await generateWithIdeogram(prompt, ratio)
        : await generateWithNanoBanana(prompt, NANO_ASPECT[ratio] ?? "1:1");

    const filePath = `photo-backdrops/${req.userId}/${randomUUID()}.png`;
    const url = await r2Upload(filePath, buffer, "image/png");

    res.json({
      status: "succeeded",
      url,
      path: filePath,
      creditCost: BACKDROP_COST,
      model: provider,
      creditsRemaining: creditsAfter,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI backdrop generation failed.";
    req.log.error({ err: message }, "[photo-backdrop] failed");
    await refundCredits(req.userId!, BACKDROP_COST, {
      action: "Photo AI Backdrop — Refund",
    }).catch(() => {});
    res.status(500).json({ error: message });
  }
});

export default router;
