import { Router } from "express";
import { randomUUID } from "crypto";
import RunwayML from "@runwayml/sdk";
import { getOpenAI } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits as chargeCreditsAtomic, LedgerWriteError } from "../../lib/credits";
import { getSupabaseAdmin } from "../../lib/supabase-admin";
import {
  resolveLogoPlan,
  isLogoStyleKey,
  buildLogoPrompt,
  LOGO_PREMIUM_CREDIT_COST,
  LOGO_STANDARD_CREDIT_COST,
  type LogoStyleKey,
} from "./logo-pricing";

const router = Router();

const PREMIUM_CREDITS = Number(process.env["LOGO_PREMIUM_CREDITS"]) || LOGO_PREMIUM_CREDIT_COST;
const STANDARD_CREDITS = Number(process.env["LOGO_STANDARD_CREDITS"]) || LOGO_STANDARD_CREDIT_COST;

/** Newest OpenAI image model — env-overridable so upgrades are one-line changes. */
const IMAGE_MODEL = process.env["OPENAI_IMAGE_MODEL_25"] || "gpt-image-2.5-sunburst";

/** Supabase Storage bucket for generated brand assets. */
export const LOGO_BUCKET = "generated-clips";

/**
 * Tracks submitted Runway logo tasks so credits are only charged on SUCCEEDED.
 * Key: Runway taskId  Value: { userId, credits }
 */
const pendingLogoTasks = new Map<string, { userId: string; credits: number }>();
/** Test hook — clears the in-memory task map. */
export function __clearPendingLogoTasks() {
  pendingLogoTasks.clear();
}

async function uploadLogoImage(userId: string, buffer: Buffer, ext: string): Promise<{ url: string; path: string }> {
  const filePath = `logos/${userId}/${randomUUID()}.${ext}`;
  const { error: upErr } = await getSupabaseAdmin().storage
    .from(LOGO_BUCKET)
    .upload(filePath, buffer, { contentType: ext === "png" ? "image/png" : "image/jpeg", upsert: false });
  if (upErr) throw upErr;
  const { data: { publicUrl } } = getSupabaseAdmin().storage
    .from(LOGO_BUCKET)
    .getPublicUrl(filePath);
  return { url: publicUrl, path: filePath };
}

/* ─────────────────────────────────────────────────────────────────────────────
   POST /generate-logo
   1. Validate brandName + style. 2. Credit pre-check (402 when broke).
   3a. Premium (GPT Image 2.5, synchronous): generate → charge → upload → return URL.
   3b. Standard (Runway gen4_image, async): submit → track task → return taskId.
───────────────────────────────────────────────────────────────────────────── */
router.post("/generate-logo", requireAuth, async (req, res) => {
  const { brandName, style, tagline, model } = req.body as {
    brandName?: string;
    style?: string;
    tagline?: string;
    model?: string;
  };

  if (!brandName?.trim()) {
    res.status(400).json({ error: "brandName is required" });
    return;
  }
  if (!isLogoStyleKey(style)) {
    res.status(400).json({ error: "style must be one of: luxury-gold, gaming, minimal, mascot" });
    return;
  }

  const plan = resolveLogoPlan({ model });
  const creditCost = plan.model === "premium" ? PREMIUM_CREDITS : STANDARD_CREDITS;
  const prompt = buildLogoPrompt(brandName, style as LogoStyleKey, tagline);

  /* ── Credit pre-check — always enforced ── */
  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < creditCost) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough credits. Please buy more credits to continue.",
    });
    return;
  }

  /* ── Premium path: GPT Image 2.5, synchronous, best quality ── */
  if (plan.model === "premium") {
    try {
      req.log.info({ userId: req.userId, style }, "[logo] GPT Image 2.5 generation started");
      const imageResp = await getOpenAI().images.generate({
        model: IMAGE_MODEL,
        prompt: prompt.slice(0, 4000),
        size: "1024x1024",
        quality: "high",
        n: 1,
      });
      const b64 = imageResp.data?.[0]?.b64_json;
      if (!b64) {
        res.status(500).json({ error: "Image generation returned no image data." });
        return;
      }
      /* Charge only after the image exists — failure above means no charge. */
      try {
        const creditsAfter = await chargeCreditsAtomic(
          req.userId!,
          creditCost,
          { action: "Logo (Premium)" },
          { rollbackOnLedgerFailure: false },
        );
        req.log.info({ userId: req.userId, creditsAfter, deducted: creditCost }, "[logo] credits deducted (Premium)");
        const { url, path: storagePath } = await uploadLogoImage(req.userId!, Buffer.from(b64, "base64"), "png");
        res.json({ status: "succeeded", url, path: storagePath, creditCost, model: "premium", creditsRemaining: creditsAfter });
      } catch (chargeErr) {
        if (chargeErr instanceof LedgerWriteError) {
          req.log.error({ err: chargeErr }, "[logo] CRITICAL: ledger write failed after deduction");
        } else {
          req.log.error({ err: chargeErr }, "[logo] credit deduction FAILED — logo delivered without charge");
        }
        /* Image was generated; still return it so the user isn't left empty-handed. */
        const { url, path: storagePath } = await uploadLogoImage(req.userId!, Buffer.from(b64, "base64"), "png");
        res.json({ status: "succeeded", url, path: storagePath, creditCost, model: "premium" });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Logo generation failed";
      req.log.error({ err: msg }, "[logo] generation failed — no credits charged");
      res.status(500).json({ error: msg });
    }
    return;
  }

  /* ── Standard path: Runway gen4_image, async ── */
  const apiKey = process.env["RUNWAYML_API_SECRET"];
  if (!apiKey) {
    res.status(500).json({ error: "Runway API key is not configured on the server" });
    return;
  }

  try {
    const client = new RunwayML({ apiKey });
    req.log.info({ userId: req.userId, style }, "[logo] Runway generation started");
    const task = await client.textToImage.create({
      model: "gen4_image",
      promptText: prompt.slice(0, 1000),
      ratio: "1080:1080",
      contentModeration: { publicFigureThreshold: "low" },
    });
    pendingLogoTasks.set(task.id, { userId: req.userId!, credits: creditCost });
    req.log.info({ taskId: task.id, userId: req.userId }, "[logo] task submitted — credits pending on SUCCEEDED");
    res.json({ taskId: task.id, creditCost, model: "standard", status: "processing" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Runway API returned an error";
    req.log.error({ err: msg }, "[logo] submission failed — no credits charged");
    res.status(500).json({ error: msg });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /generate-logo/:taskId
   Poll a Runway standard-tier logo task.
   - SUCCEEDED → deduct credits → upload → return public URL
   - FAILED/CANCELLED → no charge → return error
   - Still running → return { status: "processing" }
───────────────────────────────────────────────────────────────────────────── */
router.get("/generate-logo/:taskId", requireAuth, async (req, res) => {
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
        pendingLogoTasks.delete(taskId);
        res.json({ status: "succeeded", url: null });
        return;
      }

      const pending = pendingLogoTasks.get(taskId);
      let creditsRemaining: number | undefined;
      if (pending && pending.userId === req.userId) {
        try {
          creditsRemaining = await chargeCreditsAtomic(
            req.userId!,
            pending.credits,
            { action: "Logo (Standard)" },
            { rollbackOnLedgerFailure: false },
          );
          req.log.info({ taskId, userId: req.userId, creditsAfter: creditsRemaining, deducted: pending.credits }, "[logo] credits deducted (Standard)");
        } catch (err) {
          if (err instanceof LedgerWriteError) {
            req.log.error({ err, taskId }, "[logo] CRITICAL: ledger write failed after deduction");
          } else {
            req.log.error({ err, taskId }, "[logo] credit deduction FAILED — logo delivered without charge");
          }
        }
        pendingLogoTasks.delete(taskId);
      }

      /* Download from Runway and re-host in our bucket. */
      try {
        const dl = await fetch(runwayUrl, { signal: AbortSignal.timeout(120_000) });
        if (!dl.ok) throw new Error(`Download failed (${dl.status})`);
        const buf = Buffer.from(await dl.arrayBuffer());
        const { url, path: storagePath } = await uploadLogoImage(req.userId!, buf, "jpg");
        res.json({ status: "succeeded", url, path: storagePath, creditsRemaining });
      } catch (uploadErr: unknown) {
        req.log.error({ err: uploadErr }, "[logo] bucket upload failed — returning raw Runway URL as fallback");
        res.json({ status: "succeeded", url: runwayUrl, path: null, creditsRemaining });
      }

    } else if (task.status === "FAILED" || task.status === "CANCELLED") {
      pendingLogoTasks.delete(taskId);
      req.log.info({ taskId, status: task.status }, "[logo] task failed — no credits charged");
      res.json({
        status: task.status === "CANCELLED" ? "cancelled" : "failed",
        error: (task as { failure?: string }).failure ?? "Logo generation failed.",
      });
    } else {
      const running = task as { progress?: number };
      res.json({ status: "processing", progress: running.progress ?? null });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to poll logo task";
    res.status(500).json({ error: msg });
  }
});

export default router;
