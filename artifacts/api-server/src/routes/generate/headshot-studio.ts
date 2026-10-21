import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { invokeRailHandler, type RailCoreDeps, type RailCoreResult } from "../../lib/rail-core";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middlewares/require-auth";
import { generationLimiter } from "../../lib/rate-limit";
import { chargeCredits as chargeCreditsAtomic, LedgerWriteError } from "../../lib/credits";
import { r2Upload } from "../../lib/r2-client";

const router = Router();

/**
 * PLACEHOLDER credit price for AI Headshots — the user must approve the real
 * price before this goes live. 100 credits (~$0.50) matches the Nano Banana
 * 2.1 artist-image tier and holds a healthy margin on ~$0.05 real cost.
 * Env-overridable without a deploy.
 */
export const HEADSHOT_STUDIO_CREDIT_COST = 100;
export const HEADSHOT_CREDITS = Number(process.env["HEADSHOT_CREDITS"]) || HEADSHOT_STUDIO_CREDIT_COST;

/** Google Gemini image model (Nano Banana 2.1) — env-overridable. Requires GEMINI_API_KEY. */
const NANO_MODEL = process.env["GEMINI_IMAGE_MODEL"] || "gemini-nano-banana-2.1";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${NANO_MODEL}:generateContent`;

/** Headshots are profile pictures: always square. */
const NANO_ASPECT = "1:1" as const;
const IDEOGRAM_ASPECT = "1x1";

/* ── Style presets ── */
const HEADSHOT_PRESETS = {
  studio: {
    label: "Studio",
    fragment:
      "in a professional photography studio with a seamless dark backdrop and soft key light, softbox rim lighting, shallow depth of field, professional headshot photograph",
  },
  stage: {
    label: "Stage",
    fragment:
      "on a concert stage with dramatic spotlights and warm crowd bokeh behind, cinematic stage lighting on the face, professional performance headshot photograph",
  },
  street: {
    label: "Street",
    fragment:
      "outdoors on a city street at golden hour, urban fashion-editorial look, natural warm light, blurred city background, professional street headshot photograph",
  },
  luxury: {
    label: "Luxury",
    fragment:
      "in an opulent luxury setting — marble and gold interior, soft window light, high-end fashion editorial, wealth-aesthetic, professional luxury headshot photograph",
  },
} as const;

type HeadshotPresetId = keyof typeof HEADSHOT_PRESETS;

const AUTOPILOT_PROMPT =
  "Professional AI-selected flattering headshot: photorealistic upper-body portrait of the person, front-facing, looking at the camera with a confident relaxed expression, premium photography studio with a soft neutral backdrop, cinematic soft lighting, shallow depth of field, ultra sharp focus on the eyes, high-end editorial quality.";

/** Fetches a reference image URL and returns it as base64 + mime type.
 *  Used to give Nano Banana a face/identity reference (character lock).
 *  Returns null when the fetch fails — generation proceeds without it. */
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

interface GeminiPart { inlineData?: { data?: string }; text?: string }
interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
  promptFeedback?: { blockReason?: string };
}

/** Calls Nano Banana 2.1 via the Gemini API. Returns the generated PNG buffer. */
async function generateWithNanoBanana(opts: {
  prompt: string;
  referenceImageUrl?: string | null;
  log: { warn: (...a: unknown[]) => void };
}): Promise<Buffer> {
  const apiKey = process.env["GEMINI_API_KEY"];
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured on the server");

  const parts: Record<string, unknown>[] = [{ text: opts.prompt }];
  const refUrl = opts.referenceImageUrl?.trim();
  if (refUrl && /^https:\/\//i.test(refUrl)) {
    const ref = await fetchReferenceAsBase64(refUrl);
    if (ref) {
      parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
    } else {
      opts.log.warn("[headshot-studio] Nano Banana reference image fetch failed — generating without it");
    }
  }

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: NANO_ASPECT, imageSize: "2K" },
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
        ? `Nano Banana blocked this image (${blockReason}). Try a different description.`
        : "Nano Banana returned no image data.",
    );
  }
  return Buffer.from(b64, "base64");
}

/** Calls Ideogram 4.0. Returns the PNG buffer. Ideogram URLs are ephemeral,
 *  so the image is downloaded immediately. */
async function generateWithIdeogram(prompt: string): Promise<Buffer> {
  const apiKey = process.env["IDEOGRAM_API_KEY"];
  if (!apiKey) throw new Error("IDEOGRAM_API_KEY is not configured on the server");

  const form = new FormData();
  form.append("text_prompt", prompt.slice(0, 4000));
  /* rendering_speed FLASH is not yet supported (API returns 400). */
  form.append("rendering_speed", "DEFAULT");
  form.append("aspect_ratio", IDEOGRAM_ASPECT);

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

/* ── Request validation ── */
const headshotStudioSchema = z.object({
  mode: z.enum(["autopilot", "preset", "manual"]).default("autopilot"),
  preset: z.enum(["studio", "stage", "street", "luxury"]).optional(),
  /** Required only when mode === "manual". */
  promptText: z.string().max(2000).optional().nullable(),
  /** Existing profile photo — passed as a face/identity reference so the
   *  generated headshot keeps the creator's identity. */
  referenceImageUrl: z.string().max(2048).optional().nullable(),
  /** nano-banana-2.1 (default, fast) or ideogram-4.0 (shaped alternative). */
  model: z.enum(["nano-banana-2.1", "ideogram-4.0"]).optional().default("nano-banana-2.1"),
});

/**
 * 503 key-gate: clear "not connected" message naming the exact env var, so
 * the frontend can show an actionable error instead of a generic 500.
 */
function providerKeyGate(model: "nano-banana-2.1" | "ideogram-4.0") {
  if (model === "ideogram-4.0") {
    if (!process.env["IDEOGRAM_API_KEY"]) {
      return {
        status: 503,
        body: {
          error: "Ideogram is not connected. Add IDEOGRAM_API_KEY to enable headshots.",
          code: "provider_not_connected",
        },
      };
    }
  } else {
    if (!process.env["GEMINI_API_KEY"]) {
      return {
        status: 503,
        body: {
          error: "AI Headshots are not connected. Add GEMINI_API_KEY to enable headshots.",
          code: "provider_not_connected",
        },
      };
    }
  }
  return null;
}

function composePrompt(mode: "autopilot" | "preset" | "manual", preset?: HeadshotPresetId, manual?: string | null): string {
  if (mode === "manual") {
    return (manual ?? "").trim().slice(0, 2000);
  }
  if (mode === "preset" && preset) {
    return `Photorealistic headshot photograph, upper-body, front-facing, looking at the camera, confident expression, sharp focus on the eyes. ${HEADSHOT_PRESETS[preset].fragment}.`;
  }
  return AUTOPILOT_PROMPT;
}

/* ─────────────────────────────────────────────────────────────────────────────
   POST /generate-headshot
   1. Key gate (503) — provider missing → clear "not connected" error.
   2. Credit pre-check (402) — always enforced, no dev bypass.
   3. Compose prompt: autopilot (AI picks) / preset style / manual free text.
   4. Synchronous generation via Nano Banana 2.1 or Ideogram 4.0.
   5. Charge credits only on success → upload to storage → return URL.
───────────────────────────────────────────────────────────────────────────── */
const generateHeadshotHandler = async (req: Request, res: Response) => {
  const parsed = headshotStudioSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid headshot request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { mode, preset, promptText, referenceImageUrl, model } = parsed.data;

  if (mode === "manual" && !(promptText ?? "").trim()) {
    res.status(400).json({ error: "Describe the headshot look first — promptText is required in manual mode." });
    return;
  }
  if (mode === "preset" && !preset) {
    res.status(400).json({ error: "Pick a style preset — preset is required in preset mode." });
    return;
  }

  /* ── Key gate — 503 with a clear "not connected" message ── */
  const gate = providerKeyGate(model);
  if (gate) {
    res.status(gate.status).json(gate.body);
    return;
  }

  /* ── Credit pre-check — always enforced ── */
  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < HEADSHOT_CREDITS) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Please buy more Visual Bucs to continue.",
    });
    return;
  }

  const refUrl = referenceImageUrl?.trim();
  const useRefImage = !!refUrl && /^https:\/\//i.test(refUrl);
  const basePrompt = composePrompt(mode, preset as HeadshotPresetId | undefined, promptText);
  const finalPrompt = useRefImage
    ? `Use the provided reference photo as the exact face, identity, and likeness reference for the person in this image. Preserve their facial features, skin tone, and identity precisely. ${basePrompt}`.slice(0, 3000)
    : basePrompt;

  req.log.info(
    { userId: req.userId, mode, preset: preset ?? null, model, identityRef: useRefImage },
    "[headshot-studio] generation started",
  );

  try {
    const buffer =
      model === "ideogram-4.0"
        ? await generateWithIdeogram(finalPrompt)
        : await generateWithNanoBanana({ prompt: finalPrompt, referenceImageUrl: useRefImage ? refUrl : null, log: req.log });

    /* ── Charge credits (only on success) ── */
    try {
      const creditsAfter = await chargeCreditsAtomic(
        req.userId!,
        HEADSHOT_CREDITS,
        { action: "AI Headshot" },
        { rollbackOnLedgerFailure: false },
      );
      req.log.info({ userId: req.userId, creditsAfter, deducted: HEADSHOT_CREDITS }, "[headshot-studio] credits deducted");
    } catch (err) {
      if (err instanceof LedgerWriteError) {
        req.log.error({ err }, "[headshot-studio] CRITICAL: ledger write failed after deduction — headshot delivered, charge has no ledger trace");
      } else {
        req.log.error({ err }, "[headshot-studio] credit deduction FAILED — headshot delivered without charge");
      }
    }

    const filePath = `${req.userId}/generated/headshot-${randomUUID()}.png`;
    const publicUrl = await r2Upload(filePath, buffer, "image/png");
    res.json({
      taskId: `headshot-${randomUUID()}`,
      status: "succeeded",
      url: publicUrl,
      path: filePath,
      creditCost: HEADSHOT_CREDITS,
      model,
      mode,
      preset: preset ?? null,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Headshot generation failed";
    req.log.error({ err: msg }, "[headshot-studio] generation failed — no credits charged");
    res.status(500).json({ error: msg });
  }
};

router.post("/generate-headshot", requireAuth, generationLimiter, generateHeadshotHandler);

/* Operator core (Phase 2 Lane E): the Tier 3 headshot.generate tool
   runs this exact handler in-process (lib/rail-core) — same key gate,
   same charge-on-success the page gets. (HTTP rate limiting stays on
   the route; the operator path carries the executor's own gates.) */
export async function runGenerateHeadshot(
  deps: RailCoreDeps,
  body: unknown,
): Promise<RailCoreResult> {
  return invokeRailHandler(generateHeadshotHandler as never, deps, { body });
}

export default router;
