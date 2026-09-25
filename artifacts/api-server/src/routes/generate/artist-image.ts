import { Router } from "express";
import { createWriteStream, unlinkSync, existsSync, readFileSync } from "fs";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";
import path from "path";
import os from "os";
import RunwayML from "@runwayml/sdk";
import { getOpenAI } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { recordCreditUsage } from "../../lib/payment-record";
import { getSupabaseAdmin } from "../../lib/supabase-admin";
import {
  GEN4_IMAGE_CREDIT_COST,
  GEN4_IMAGE_TURBO_CREDIT_COST,
  GPT_IMAGE_25_SUNBURST_CREDIT_COST,
  resolveArtistImagePlan,
} from "./artist-image-pricing";

const router = Router();

/* Site credits per generated artist image. Env-overridable without a deploy. */
const PRO_CREDITS = Number(process.env["ARTIST_IMAGE_CREDITS"]) || GEN4_IMAGE_CREDIT_COST;
const TURBO_CREDITS = Number(process.env["ARTIST_IMAGE_TURBO_CREDITS"]) || GEN4_IMAGE_TURBO_CREDIT_COST;
const SUNBURST_CREDITS = Number(process.env["ARTIST_IMAGE_SUNBURST_CREDITS"]) || GPT_IMAGE_25_SUNBURST_CREDIT_COST;

/** Newest OpenAI image model — env-overridable so upgrades are one-line changes. */
const SUNBURST_MODEL = process.env["OPENAI_IMAGE_MODEL_25"] || "gpt-image-2.5-sunburst";

/** Maps the site's ratio picker to OpenAI image sizes. */
const SUNBURST_SIZES: Record<string, "1024x1024" | "1024x1536" | "1536x1024"> = {
  "1080:1920": "1024x1536",
  "1080:1080": "1024x1024",
  "1920:1080": "1536x1024",
};

/** Supabase Storage bucket the Artist Profiles page already uses for photos. */
const ARTIST_BUCKET = "artist-references";

/**
 * Tracks submitted image tasks so credits are only charged on SUCCEEDED.
 * Key: Runway taskId  Value: { userId, credits }
 */
const pendingImageTasks = new Map<string, { userId: string; credits: number }>();

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
 * Deducts site credits after a successful synchronous (OpenAI) generation.
 * Mirrors the charge logic in the Runway poller: charges once, records usage.
 */
async function chargeForImage(req: {
  userId?: string;
  userSupabase?: ReturnType<typeof getSupabaseAdmin>;
  log: { info: (...a: unknown[]) => void; error: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };
}, credits: number): Promise<void> {
  const { data: freshProfile } = await req.userSupabase!
    .from("profiles")
    .select("credits")
    .eq("id", req.userId!)
    .single();
  const freshCredits: number = (freshProfile as { credits?: number } | null)?.credits ?? 0;
  const creditsAfter = Math.max(0, freshCredits - credits);
  const { error: deductErr } = await getSupabaseAdmin()
    .from("profiles")
    .update({ credits: creditsAfter })
    .eq("id", req.userId!);

  if (deductErr) {
    req.log.error({ err: deductErr }, "[artist-image] credit deduction FAILED — image delivered without charge");
  } else {
    req.log.info({ userId: req.userId, creditsAfter, deducted: credits }, "[artist-image] credits deducted (OpenAI)");
    recordCreditUsage({
      userId: req.userId!,
      action: "Artist Image (GPT Image 2.5)",
      creditsUsed: credits,
      projectId: null,
    }).catch((e) => req.log.warn({ err: e }, "[artist-image] credit_usage save failed (non-fatal)"));
  }
}

/** Uploads a buffer to the artist-references bucket; returns public URL + path. */
async function uploadGeneratedImage(userId: string, buffer: Buffer): Promise<{ url: string; path: string | null }> {
  const filePath = `${userId}/generated/${randomUUID()}.png`;
  const { error: upErr } = await getSupabaseAdmin().storage
    .from(ARTIST_BUCKET)
    .upload(filePath, buffer, { contentType: "image/png", upsert: false });
  if (upErr) throw upErr;
  const { data: { publicUrl } } = getSupabaseAdmin().storage
    .from(ARTIST_BUCKET)
    .getPublicUrl(filePath);
  return { url: publicUrl, path: filePath };
}

/* ─────────────────────────────────────────────────────────────────────────────
   POST /generate-artist-image
   1. Credit pre-check — always enforced (no dev bypass).
   2. Submit text-to-image job to Runway.
   3. Track task — credits NOT yet charged.
   4. Return { taskId, creditCost, model }.
───────────────────────────────────────────────────────────────────────────── */
router.post("/generate-artist-image", requireAuth, async (req, res) => {
  const { promptText, model, ratio, referenceImageUrl, vaultId } = req.body as {
    promptText?: string;
    model?: string;
    ratio?: string;
    /** Existing vault photo — passed as a face/identity reference so the
     *  generated look keeps the artist's identity. */
    referenceImageUrl?: string | null;
    vaultId?: string | null;
  };

  if (!promptText?.trim()) {
    res.status(400).json({ error: "promptText is required" });
    return;
  }

  const plan = resolveArtistImagePlan({
    model,
    ratio,
    proCredits: PRO_CREDITS,
    turboCredits: TURBO_CREDITS,
    sunburstCredits: SUNBURST_CREDITS,
  });
  const creditCost = plan.creditCost;

  /* ── Credit pre-check — always enforced ── */
  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < creditCost) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough credits. Please buy more credits to continue.",
    });
    return;
  }

  /* ── GPT Image 2.5 Sunburst path: synchronous, best quality ── */
  if (plan.model === "gpt-image-2.5-sunburst") {
    try {
      req.log.info(
        { userId: req.userId, ratio: plan.ratio, vaultId: vaultId ?? null },
        "[artist-image] GPT Image 2.5 generation started",
      );
      const imageResp = await getOpenAI().images.generate({
        model: SUNBURST_MODEL,
        prompt: promptText.trim().slice(0, 4000),
        size: SUNBURST_SIZES[plan.ratio] ?? "1024x1536",
        quality: "high",
        n: 1,
      });
      const b64 = imageResp.data?.[0]?.b64_json;
      if (!b64) {
        res.status(500).json({ error: "Image generation returned no image data." });
        return;
      }
      await chargeForImage(req, creditCost);
      const { url, path: storagePath } = await uploadGeneratedImage(req.userId!, Buffer.from(b64, "base64"));
      res.json({
        taskId: `oai-${randomUUID()}`,
        status: "succeeded",
        url,
        path: storagePath,
        creditCost,
        model: plan.model,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "OpenAI image generation failed";
      req.log.error({ err: msg }, "[artist-image] GPT Image 2.5 generation failed — no credits charged");
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
  const finalPrompt = useRefImage
    ? `${IDENTITY_DIRECTIVE} ${promptText.trim()}`.slice(0, 1000)
    : promptText.trim().slice(0, 1000);

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

    pendingImageTasks.set(task.id, { userId: req.userId!, credits: creditCost });
    req.log.info({ taskId: task.id, userId: req.userId }, "[artist-image] task submitted — credits pending on SUCCEEDED");

    res.json({ taskId: task.id, creditCost, model: plan.model, ratio: plan.ratio });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Runway API returned an error";
    req.log.error({ err: msg }, "[artist-image] submission failed — no credits charged");
    res.status(500).json({ error: msg });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /generate-artist-image/:taskId
   Poll Runway task status.
   - SUCCEEDED → deduct credits → upload to artist-references bucket → return
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
      const runwayUrl = (task.output as string[] | undefined)?.[0] ?? null;
      if (!runwayUrl) {
        pendingImageTasks.delete(taskId);
        res.json({ status: "succeeded", url: null });
        return;
      }

      const pending = pendingImageTasks.get(taskId);

      /* ── Charge credits (only once, guarded by pendingImageTasks presence) ── */
      if (pending && pending.userId === req.userId) {
        const chargeCredits = pending.credits ?? GEN4_IMAGE_CREDIT_COST;
        const { data: freshProfile } = await req.userSupabase!
          .from("profiles")
          .select("credits")
          .eq("id", req.userId!)
          .single();
        const freshCredits: number = (freshProfile as { credits?: number } | null)?.credits ?? 0;
        const creditsAfter = Math.max(0, freshCredits - chargeCredits);
        const { error: deductErr } = await getSupabaseAdmin()
          .from("profiles")
          .update({ credits: creditsAfter })
          .eq("id", req.userId!);

        if (deductErr) {
          req.log.error({ err: deductErr, taskId }, "[artist-image] credit deduction FAILED — image delivered without charge");
        } else {
          req.log.info({ taskId, userId: req.userId, creditsAfter, deducted: chargeCredits }, "[artist-image] credits deducted");
          recordCreditUsage({
            userId: req.userId!,
            action: "Artist Image",
            creditsUsed: chargeCredits,
            projectId: null,
          }).catch((e) => req.log.warn({ err: e }, "[artist-image] credit_usage save failed (non-fatal)"));
        }
        pendingImageTasks.delete(taskId);
      } else if (!pending) {
        req.log.info({ taskId }, "[artist-image] SUCCEEDED poll after charge already processed — skipping duplicate");
      }

      /* ── Upload to the artist-references bucket (same bucket the page's
         manual upload uses) and return the public URL + path ── */
      const tmpFile = path.join(os.tmpdir(), `artist-img-${randomUUID()}.jpg`);
      try {
        await downloadToFile(runwayUrl, tmpFile);
        const filePath = `${req.userId}/generated/${randomUUID()}.jpg`;
        const { error: upErr } = await getSupabaseAdmin().storage
          .from(ARTIST_BUCKET)
          .upload(filePath, readFileSync(tmpFile), { contentType: "image/jpeg", upsert: false });
        if (upErr) throw upErr;
        const { data: { publicUrl } } = getSupabaseAdmin().storage
          .from(ARTIST_BUCKET)
          .getPublicUrl(filePath);
        res.json({ status: "succeeded", url: publicUrl, path: filePath });
      } catch (uploadErr: unknown) {
        req.log.error({ err: uploadErr }, "[artist-image] bucket upload failed — returning raw Runway URL as fallback");
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
      req.log.info({ taskId, status: task.status, failureCode }, "[artist-image] task failed — no credits charged");
      pendingImageTasks.delete(taskId);
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
