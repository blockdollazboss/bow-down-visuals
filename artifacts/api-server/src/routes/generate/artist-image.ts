import { Router } from "express";
import { attachJobMapTtl } from "../../lib/job-map-sweeper";
import { z } from "zod";
import { createWriteStream, unlinkSync, existsSync, readFileSync } from "fs";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";
import path from "path";
import os from "os";
import RunwayML from "@runwayml/sdk";
import { getOpenAI } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { generationLimiter } from "../../lib/rate-limit";
import {
  generationChargeIntentStore,
  resolvePendingCharge,
  settleGenerationCharge,
  markGenerationIntentDelivered,
  markGenerationIntentFailed,
  chargeGenerationReserve,
  recordGenerationReserve,
  confirmGenerationReserve,
  refundGenerationReserve,
  refundOrFailGenerationIntent,
  generationChargeKey,
  type ResolvedPendingCharge,
  type ReserveOutcome,
} from "../../lib/generation-charge-intents";
import { saveGeneration, asVaultId } from "../../lib/save-generation";
import { r2Upload } from "../../lib/r2-client";
import {
  GEN4_IMAGE_CREDIT_COST,
  GEN4_IMAGE_TURBO_CREDIT_COST,
  GPT_IMAGE_25_SUNBURST_CREDIT_COST,
  NANO_BANANA_21_CREDIT_COST,
  IDEOGRAM_40_CREDIT_COST,
  resolveArtistImagePlan,
} from "./artist-image-pricing";

const router = Router();

/* Site credits per generated artist image. Env-overridable without a deploy. */
const PRO_CREDITS = Number(process.env["ARTIST_IMAGE_CREDITS"]) || GEN4_IMAGE_CREDIT_COST;
const TURBO_CREDITS = Number(process.env["ARTIST_IMAGE_TURBO_CREDITS"]) || GEN4_IMAGE_TURBO_CREDIT_COST;
const SUNBURST_CREDITS = Number(process.env["ARTIST_IMAGE_SUNBURST_CREDITS"]) || GPT_IMAGE_25_SUNBURST_CREDIT_COST;
const NANO_CREDITS = Number(process.env["ARTIST_IMAGE_NANO_CREDITS"]) || NANO_BANANA_21_CREDIT_COST;
const IDEOGRAM_CREDITS = Number(process.env["ARTIST_IMAGE_IDEOGRAM_CREDITS"]) || IDEOGRAM_40_CREDIT_COST;

/** Newest OpenAI image model — env-overridable so upgrades are one-line changes. */
const SUNBURST_MODEL = process.env["OPENAI_IMAGE_MODEL_25"] || "gpt-image-2.5-sunburst";

/** Google Gemini image model (Nano Banana 2.1) — env-overridable. Requires GEMINI_API_KEY. */
const NANO_MODEL = process.env["GEMINI_IMAGE_MODEL"] || "gemini-nano-banana-2.1";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${NANO_MODEL}:generateContent`;

/** Maps the site's ratio picker to OpenAI image sizes. */
const SUNBURST_SIZES: Record<string, "1024x1024" | "1024x1536" | "1536x1024"> = {
  "1080:1920": "1024x1536",
  "1080:1080": "1024x1024",
  "1920:1080": "1536x1024",
};

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

/** Supabase Storage bucket the Artist Profiles page already uses for photos. */
const ARTIST_BUCKET = "artist-references";

/**
 * Tracks submitted image tasks. Reserve-at-submit (stack1400 ruling
 * #43): credits are CHARGED at submit, before the provider call; the
 * success poll confirms the reserve, a failure poll refunds it.
 * Key: Runway taskId  Value: { userId, credits }
 */
/* OOM fix (2026-10-25): abandoned tasks were never deleted — bounded
 * by the house job-map TTL (2h), like the other pending-task maps. */
const pendingImageTasks = attachJobMapTtl(new Map<string, { userId: string; credits: number; prompt: string; artistVaultId?: string | null; chargeKey: string }>());

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url.slice(0, 80)}`);
  const ws = createWriteStream(dest);
  await pipeline(res.body as Parameters<typeof pipeline>[0], ws);
}

function cleanup(f: string) {
  try { if (existsSync(f)) unlinkSync(f); } catch { /* best-effort */ }
}

/**
 * RESERVE-AT-SUBMIT for the synchronous image variants (stack1400
 * ruling #43): the charge lands BEFORE the provider call, keyed to a
 * minted sync-<uuid> task id, and the intent row records the reserve.
 * Provider failure / no-output / save failure refunds the reserve in
 * full (refundSyncImageReserve); success confirms it
 * (confirmSyncImageReserve) — no second charge ever.
 */
interface SyncImageReserve {
  taskId: string;
  chargeKey: string;
  balance: number;
  resolved: ResolvedPendingCharge;
}

type ReqLike = {
  userId?: string;
  log: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };
};

async function reserveForImage(
  req: ReqLike,
  credits: number,
  action = "Artist Image",
): Promise<{ ok: true; reserve: SyncImageReserve } | { ok: false; outcome: ReserveOutcome }> {
  const taskId = `sync-${randomUUID()}`;
  const chargeKey = generationChargeKey(taskId);
  const outcome = await chargeGenerationReserve({
    userId: req.userId!,
    credits,
    action,
    chargeKey,
  });
  if (!outcome.ok) return { ok: false, outcome };
  await recordGenerationReserve(generationChargeIntentStore, {
    taskId,
    rail: "artist-image",
    userId: req.userId!,
    credits,
    action,
    chargeKey,
  });
  const rowFound = (await generationChargeIntentStore.getIntent(taskId).catch(() => null)) !== null;
  req.log.info({ userId: req.userId, deducted: credits, taskId }, `[artist-image] credits reserved at submit (${action})`);
  return {
    ok: true,
    reserve: {
      taskId,
      chargeKey,
      balance: outcome.balance,
      resolved: {
        userId: req.userId!,
        credits,
        projectId: null,
        action,
        extra: null,
        intentStatus: rowFound ? "reserved" : null,
        source: rowFound ? "intent" : "memory",
        reserved: true,
        chargeKey,
      },
    },
  };
}

async function refundSyncImageReserve(req: ReqLike, reserve: SyncImageReserve, reason: string): Promise<void> {
  const out = await refundGenerationReserve(generationChargeIntentStore, reserve.taskId, reserve.resolved, reason);
  if (out === "refund_failed") {
    req.log.error({ taskId: reserve.taskId }, "[artist-image] CRITICAL: sync reserve refund failed — reserve stays reserved for the sweeper");
  }
}

async function confirmSyncImageReserve(reserve: SyncImageReserve): Promise<void> {
  await confirmGenerationReserve(generationChargeIntentStore, reserve.taskId, reserve.resolved);
  await markGenerationIntentDelivered(generationChargeIntentStore, reserve.taskId);
}

/** Map a refused reserve onto the rail's existing response shapes.
 *  Returns true when the reserve was refused (response sent). */
function respondReserveRefused(
  req: ReqLike,
  res: { status: (n: number) => { json: (b: unknown) => void } },
  outcome: ReserveOutcome,
): boolean {
  if (outcome.ok) return false;
  if (outcome.reason === "insufficient") {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Please Buy more Visual Bucs to continue.",
    });
    return true;
  }
  if (outcome.reason === "disabled") {
    res.status(403).json({ error: "credits_disabled", message: "Credit spending is not enabled for this account." });
    return true;
  }
  req.log.error({ err: outcome.err }, "[artist-image] reserve charge failed at submit — request refused");
  res.status(500).json({ error: "Could not reserve your Visual Bucs. Please try again." });
  return true;
}

/** Uploads a buffer to the artist-references bucket; returns public URL + path. */
async function uploadGeneratedImage(userId: string, buffer: Buffer): Promise<{ url: string; path: string | null }> {
  const filePath = `${userId}/generated/${randomUUID()}.png`;
  const publicUrl = await r2Upload(filePath, buffer, "image/png");
  return { url: publicUrl, path: filePath };
}

/* ─────────────────────────────────────────────────────────────────────────────
   POST /generate-artist-image
   1. Credit pre-check — always enforced (no dev bypass).
   2. Submit text-to-image job to Runway.
   3. Track task — credits RESERVED at step 2.5 (charged up front).
   4. Return { taskId, creditCost, model }.
───────────────────────────────────────────────────────────────────────────── */
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
  aspectRatio: "9:16" | "1:1" | "16:9";
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
      opts.log.warn("[artist-image] Nano Banana reference image fetch failed — generating without it");
    }
  }

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
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
        ? `Nano Banana blocked this image (${blockReason}). Try a different description.`
        : "Nano Banana returned no image data.",
    );
  }
  return Buffer.from(b64, "base64");
}

/** Calls Ideogram 4.0 (best in-image text rendering). Returns the PNG buffer.
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

/* ── Request validation ── */
const artistImageSchema = z.object({
  promptText: z.string().min(1, "promptText is required").max(5000),
  model: z.string().max(100).optional(),
  ratio: z.string().max(20).optional(),
  /** Existing vault photo — passed as a face/identity reference so the
   *  generated look keeps the artist's identity. */
  referenceImageUrl: z.string().max(2048).optional().nullable(),
  vaultId: z.string().max(100).optional().nullable(),
});

router.post("/generate-artist-image", requireAuth, generationLimiter, async (req, res) => {
  const parsed = artistImageSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid artist image request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { promptText, model, ratio, referenceImageUrl, vaultId } = parsed.data;

  if (!promptText.trim()) {
    res.status(400).json({ error: "promptText is required" });
    return;
  }

  const plan = resolveArtistImagePlan({
    model,
    ratio,
    proCredits: PRO_CREDITS,
    turboCredits: TURBO_CREDITS,
    sunburstCredits: SUNBURST_CREDITS,
    nanoCredits: NANO_CREDITS,
    ideogramCredits: IDEOGRAM_CREDITS,
  });
  const creditCost = plan.creditCost;

  /* ── Credit pre-check — always enforced ── */
  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < creditCost) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Please Buy more Visual Bucs to continue.",
    });
    return;
  }

  /* ── GPT Image 2.5 Sunburst path: synchronous, best quality ── */
  if (plan.model === "gpt-image-2.5-sunburst") {
    const held = await reserveForImage(req, creditCost, "Artist Image (GPT Image 2.5)");
    if (!held.ok) {
      respondReserveRefused(req, res as never, held.outcome);
      return;
    }
    const reserve = held.reserve;
    try {
      req.log.info(
        { userId: req.userId, ratio: plan.ratio, vaultId: vaultId ?? null },
        "[artist-image] GPT Image 2.5 generation started",
      );
      let b64: string | undefined;
      try {
        const imageResp = await getOpenAI().images.generate({
          model: SUNBURST_MODEL,
          prompt: promptText.trim().slice(0, 4000),
          size: SUNBURST_SIZES[plan.ratio] ?? "1024x1536",
          quality: "high",
          n: 1,
        });
        b64 = imageResp.data?.[0]?.b64_json;
      } catch (genErr: unknown) {
        await refundSyncImageReserve(req, reserve, "provider failed");
        throw genErr;
      }
      if (!b64) {
        await refundSyncImageReserve(req, reserve, "no output");
        res.status(500).json({ error: "Image generation returned no image data." });
        return;
      }
      let uploaded: { url: string; path: string | null };
      try {
        uploaded = await uploadGeneratedImage(req.userId!, Buffer.from(b64, "base64"));
      } catch (saveErr: unknown) {
        await refundSyncImageReserve(req, reserve, "save failed");
        throw saveErr;
      }
      await confirmSyncImageReserve(reserve);
      res.json({
        taskId: `oai-${randomUUID()}`,
        status: "succeeded",
        url: uploaded.url,
        path: uploaded.path,
        creditCost,
        model: plan.model,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "OpenAI image generation failed";
      req.log.error({ err: msg }, "[artist-image] GPT Image 2.5 generation failed — reserve refunded");
      res.status(500).json({ error: msg });
    }
    return;
  }

  /* ── Ideogram 4.0 path: synchronous, best text rendering (thumbnails/posters) ── */
  if (plan.model === "ideogram-4.0") {
    const held = await reserveForImage(req, creditCost, "Artist Image (Ideogram 4.0)");
    if (!held.ok) {
      respondReserveRefused(req, res as never, held.outcome);
      return;
    }
    const reserve = held.reserve;
    try {
      req.log.info(
        { userId: req.userId, ratio: plan.ratio, vaultId: vaultId ?? null },
        "[artist-image] Ideogram 4.0 generation started",
      );
      let buffer: Buffer;
      try {
        buffer = await generateWithIdeogram(promptText.trim(), plan.ratio);
      } catch (genErr: unknown) {
        await refundSyncImageReserve(req, reserve, "provider failed");
        throw genErr;
      }
      let uploaded: { url: string; path: string | null };
      try {
        uploaded = await uploadGeneratedImage(req.userId!, buffer);
      } catch (saveErr: unknown) {
        await refundSyncImageReserve(req, reserve, "save failed");
        throw saveErr;
      }
      await confirmSyncImageReserve(reserve);
      res.json({
        taskId: `ideogram-${randomUUID()}`,
        status: "succeeded",
        url: uploaded.url,
        path: uploaded.path,
        creditCost,
        model: plan.model,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Ideogram image generation failed";
      req.log.error({ err: msg }, "[artist-image] Ideogram 4.0 generation failed — reserve refunded");
      res.status(500).json({ error: msg });
    }
    return;
  }

  /* ── Nano Banana 2.1 path: synchronous, fast, character-locked ── */
  if (plan.model === "nano-banana-2.1") {
    const held = await reserveForImage(req, creditCost, "Artist Image (Nano Banana 2.1)");
    if (!held.ok) {
      respondReserveRefused(req, res as never, held.outcome);
      return;
    }
    const reserve = held.reserve;
    try {
      const refUrl = referenceImageUrl?.trim();
      const useRefImage = !!refUrl && /^https:\/\//i.test(refUrl);
      const prompt = useRefImage
        ? `Use the provided reference photo as the exact face, identity, and likeness reference for the person in this image. Preserve their facial features, skin tone, and identity precisely. ${promptText.trim()}`.slice(0, 4000)
        : promptText.trim().slice(0, 4000);
      req.log.info(
        { userId: req.userId, ratio: plan.ratio, identityRef: useRefImage, vaultId: vaultId ?? null },
        "[artist-image] Nano Banana 2.1 generation started",
      );
      let buffer: Buffer;
      try {
        buffer = await generateWithNanoBanana({
          prompt,
          aspectRatio: NANO_ASPECT[plan.ratio] ?? "9:16",
          referenceImageUrl: useRefImage ? refUrl : null,
          log: req.log,
        });
      } catch (genErr: unknown) {
        await refundSyncImageReserve(req, reserve, "provider failed");
        throw genErr;
      }
      let uploaded: { url: string; path: string | null };
      try {
        uploaded = await uploadGeneratedImage(req.userId!, buffer);
      } catch (saveErr: unknown) {
        await refundSyncImageReserve(req, reserve, "save failed");
        throw saveErr;
      }
      await confirmSyncImageReserve(reserve);
      res.json({
        taskId: `nano-${randomUUID()}`,
        status: "succeeded",
        url: uploaded.url,
        path: uploaded.path,
        creditCost,
        model: plan.model,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Nano Banana image generation failed";
      req.log.error({ err: msg }, "[artist-image] Nano Banana 2.1 generation failed — reserve refunded");
      res.status(500).json({ error: msg });
    }
    return;
  }

  const apiKey = process.env["RUNWAYML_API_SECRET"];
  if (!apiKey) {
    res.status(500).json({ error: "Runway API key is not configured on the server" });
    return;
  }

  /* ── Identity lock: when the vault already has a photo, send it as a
     tagged reference so the model preserves the artist's face/identity. ── */
  const refUrl = referenceImageUrl?.trim();
  const useRefImage = !!refUrl && /^https:\/\//i.test(refUrl);
  const IDENTITY_DIRECTIVE =
    "Use @artistface as the exact face, identity, and likeness reference for the person in this image. " +
    "Preserve their facial features, skin tone, and identity precisely.";
  /* ── Character sheet rule: vault reference images (no existing photo)
     must use a clean light grey studio background. Enforced here as a
     backend safety net in case the frontend prompt lacks it. ── */
  const isCharacterSheet = !!vaultId && !useRefImage;
  const needsGreyBg =
    isCharacterSheet && !/light gr[ae]y|studio background/i.test(promptText);
  const bgDirective = needsGreyBg ? " On a clean light grey studio background." : "";
  const finalPrompt = useRefImage
    ? `${IDENTITY_DIRECTIVE} ${promptText.trim()}${bgDirective}`.slice(0, 1000)
    : `${promptText.trim()}${bgDirective}`.slice(0, 1000);

  const client = new RunwayML({ apiKey });
  req.log.info(
    { userId: req.userId, model: plan.model, ratio: plan.ratio, identityRef: useRefImage, vaultId: vaultId ?? null },
    "[artist-image] Runway generation started",
  );

  /* ── Turbo requires 1–3 reference images per the API — it only makes
     sense as an identity-locked variant when a photo already exists. ── */
  const useTurbo = plan.model === "gen4_image_turbo";
  if (useTurbo && !useRefImage) {
    res.status(400).json({
      error: "The Turbo model needs your existing artist photo as a face reference. Upload a photo first, or use Gen4 Image.",
    });
    return;
  }

  /* RESERVE at submit (ruling #43): charge BEFORE the provider call
     under a submit-minted job id (the Runway task id doesn't exist
     yet); the intent row recorded below carries the key. A refused
     charge refuses the submit — the provider is never called. */
  const jobId = `job-${randomUUID()}`;
  const chargeKey = generationChargeKey(jobId);
  const reserve = await chargeGenerationReserve({
    userId: req.userId!,
    credits: creditCost,
    action: "Artist Image",
    chargeKey,
  });
  if (!reserve.ok) {
    respondReserveRefused(req, res as never, reserve);
    return;
  }

  try {
    const referenceImages = useRefImage ? [{ uri: refUrl!, tag: "artistface" }] : undefined;
    /* Note: Gen4ImageTurbo declares referenceImages as required, so it is
       always passed there (guarded above); Gen4Image keeps it optional. */
    const task = useTurbo
      ? await client.textToImage.create({
          model: "gen4_image_turbo",
          promptText: finalPrompt,
          ratio: plan.ratio,
          referenceImages: referenceImages!,
          contentModeration: { publicFigureThreshold: "low" },
        })
      : await client.textToImage.create({
          model: "gen4_image",
          promptText: finalPrompt,
          ratio: plan.ratio,
          ...(referenceImages ? { referenceImages } : {}),
          contentModeration: { publicFigureThreshold: "low" },
        });

    pendingImageTasks.set(task.id, {
      userId: req.userId!,
      credits: creditCost,
      prompt: finalPrompt,
      artistVaultId: asVaultId((req.body as { artistVaultId?: unknown } | undefined)?.artistVaultId),
      chargeKey,
    });
    /* Durable reserve record (0317): survives the restarts the
       in-memory map cannot; prompt + vault ride along for the
       post-restart history save. */
    await recordGenerationReserve(generationChargeIntentStore, {
      taskId: task.id,
      rail: "artist-image",
      userId: req.userId!,
      credits: creditCost,
      action: "Artist Image",
      extra: {
        prompt: finalPrompt,
        artistVaultId: asVaultId((req.body as { artistVaultId?: unknown } | undefined)?.artistVaultId) ?? null,
      },
      chargeKey,
    });
    req.log.info({ taskId: task.id, userId: req.userId }, "[artist-image] task submitted — credits reserved at submit");

    res.json({ taskId: task.id, creditCost, model: plan.model, ratio: plan.ratio });
  } catch (err: unknown) {
    /* Provider submission failed AFTER the reserve — refund in full
       in-request; no poll will ever come for a task that never was. */
    const refundOutcome = await refundOrFailGenerationIntent(generationChargeIntentStore, jobId, {
      userId: req.userId!,
      credits: creditCost,
      projectId: null,
      action: "Artist Image",
      extra: null,
      intentStatus: null,
      source: "memory",
      reserved: true,
      chargeKey,
    }, "submission failed");
    if (refundOutcome === "refund_failed") {
      req.log.error({ taskId: jobId, userId: req.userId }, "[artist-image] CRITICAL: submission-failure refund failed — reserve stands under the job id for manual reconciliation");
    }
    const msg = err instanceof Error ? err.message : "Runway API returned an error";
    req.log.error({ err: msg }, "[artist-image] submission failed — reserve refunded");
    res.status(500).json({ error: msg });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /generate-artist-image/:taskId
   Poll Runway task status.
   - SUCCEEDED → confirm reserve → upload to artist-references bucket → return
     public URL + storage path (the Artist Profiles page persists both on Save)
   - FAILED/CANCELLED → no charge → return error
   - Still running → return { status: "processing", progress }
───────────────────────────────────────────────────────────────────────────── */
router.get("/generate-artist-image/:taskId", requireAuth, async (req, res) => {
  const { taskId } = req.params as { taskId: string };

  const apiKey = process.env["RUNWAYML_API_SECRET"];
  if (!apiKey) {
    res.status(500).json({ error: "Runway API key is not configured on the server" });
    return;
  }

  const client = new RunwayML({ apiKey });

  try {
    const task = await client.tasks.retrieve(taskId);

    if (task.status === "SUCCEEDED") {
      const pending0 = pendingImageTasks.get(taskId);
      const resolved0 = await resolvePendingCharge(
        generationChargeIntentStore,
        taskId,
        pending0
          ? {
              userId: pending0.userId,
              credits: pending0.credits,
              action: "Artist Image",
              extra: { prompt: pending0.prompt, artistVaultId: pending0.artistVaultId ?? null },
              reserved: true,
              chargeKey: pending0.chargeKey,
            }
          : null,
      );
      const runwayUrl = (task.output as string[] | undefined)?.[0] ?? null;
      if (!runwayUrl) {
        /* SUCCEEDED but no output — refund the reserve in full. */
        pendingImageTasks.delete(taskId);
        if (resolved0) {
          await refundOrFailGenerationIntent(generationChargeIntentStore, taskId, resolved0, "no output");
        } else {
          await markGenerationIntentFailed(generationChargeIntentStore, taskId);
        }
        res.json({ status: "succeeded", url: null });
        return;
      }

      /* ── Confirm the reserve (only once) — resolved from the
         in-memory map OR the durable reserve row (0317). Confirming
         moves NO money: the charge landed at submit. Legacy
         pre-0317 rows still settle here via settleGenerationCharge. ── */
      const resolved = resolved0;
      if (resolved && resolved.userId === req.userId) {
        const cost = resolved.credits ?? GEN4_IMAGE_CREDIT_COST;
        let outcome: string;
        if (resolved.reserved) {
          const c = await confirmGenerationReserve(generationChargeIntentStore, taskId, resolved);
          outcome = c === "not_reserved" ? "skipped" : c;
          if (c === "refunded") {
            req.log.error({ taskId }, "[artist-image] SUCCEEDED poll found the reserve already refunded — delivering; the member was not charged");
          }
        } else {
          outcome = await settleGenerationCharge(generationChargeIntentStore, taskId, resolved);
        }
        if (outcome !== "charge_failed" && outcome !== "skipped") {
          req.log.info({ taskId, userId: req.userId, deducted: cost, source: resolved.source }, "[artist-image] credits confirmed (reserved at submit)");
        }
        /* legacy charge_failed: settle logged CRITICAL, intent stays
           awaiting; delivery is stamped below and the sweeper retries. */
        pendingImageTasks.delete(taskId);
      } else if (resolved && resolved.userId !== req.userId) {
        req.log.warn({ taskId, submitter: resolved.userId, poller: req.userId }, "[artist-image] userId mismatch on poll — skipping confirm");
      } else if (!resolved) {
        req.log.error({ taskId }, "[artist-image] SUCCEEDED with NO charge record (no memory entry, no intent row) — delivering uncharged; only possible for tasks submitted before migration 0298 or a failed intent record (logged CRITICAL at submit)");
      }

      /* ── Upload to the artist-references bucket (same bucket the page's
         manual upload uses) and return the public URL + path ── */
      const tmpFile = path.join(os.tmpdir(), `artist-img-${randomUUID()}.jpg`);
      try {
        await downloadToFile(runwayUrl, tmpFile);
        const filePath = `${req.userId}/generated/${randomUUID()}.jpg`;
        const publicUrl = await r2Upload(filePath, readFileSync(tmpFile), "image/jpeg");
        /* Auto-save to generation history */
        if (resolved) {
          saveGeneration({
            userId: resolved.userId,
            type: "image",
            artistVaultId: (resolved.extra?.["artistVaultId"] as string | null | undefined) ?? null,
            title: "Artist Image",
            fileUrl: publicUrl,
            thumbnailUrl: publicUrl,
            prompt: (resolved.extra?.["prompt"] as string | undefined) ?? "",
            creditsSpent: resolved.credits,
          });
        }
        await markGenerationIntentDelivered(generationChargeIntentStore, taskId);
        res.json({ status: "succeeded", url: publicUrl, path: filePath });
      } catch (uploadErr: unknown) {
        req.log.error({ err: uploadErr }, "[artist-image] bucket upload failed — returning raw Runway URL as fallback");
        await markGenerationIntentDelivered(generationChargeIntentStore, taskId);
        res.json({ status: "succeeded", url: runwayUrl, path: null });
      } finally {
        cleanup(tmpFile);
      }

    } else if (task.status === "FAILED" || task.status === "CANCELLED") {
      const rawFailure = (task as { failure?: string }).failure ?? null;
      const failureCode = (task as { failureCode?: string }).failureCode ?? null;
      const code = (failureCode ?? "").toUpperCase();
      const errMsg = code.includes("MODERATION") || code.includes("SAFETY") || code.includes("CONTENT")
        ? "Runway rejected this image (content moderation). Try a different description."
        : rawFailure ?? "Runway image generation failed with no further details.";
      req.log.info({ taskId, status: task.status, failureCode }, "[artist-image] task failed — reserve refunded");
      /* Provider failure — refund the reserve in full, exactly once
         (legacy rows: no money was ever held, bookkeeping only). */
      const pendingF = pendingImageTasks.get(taskId);
      const resolvedF = await resolvePendingCharge(
        generationChargeIntentStore,
        taskId,
        pendingF
          ? {
              userId: pendingF.userId,
              credits: pendingF.credits,
              action: "Artist Image",
              extra: { prompt: pendingF.prompt, artistVaultId: pendingF.artistVaultId ?? null },
              reserved: true,
              chargeKey: pendingF.chargeKey,
            }
          : null,
      );
      pendingImageTasks.delete(taskId);
      if (resolvedF) {
        await refundOrFailGenerationIntent(generationChargeIntentStore, taskId, resolvedF, task.status === "CANCELLED" ? "provider cancelled" : "provider failed");
      } else {
        await markGenerationIntentFailed(generationChargeIntentStore, taskId);
      }
      res.json({ status: task.status === "CANCELLED" ? "cancelled" : "failed", error: errMsg });

    } else {
      const running = task as { progress?: number };
      res.json({ status: "processing", progress: running.progress ?? null });
    }

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to poll image task";
    res.status(500).json({ error: msg });
  }
});

export default router;
