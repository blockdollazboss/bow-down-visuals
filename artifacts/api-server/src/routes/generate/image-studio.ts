import { Router } from "express";
import { randomUUID } from "crypto";
import RunwayML from "@runwayml/sdk";
import OpenAI from "openai";
import { chatCompletion, getOpenAI, OPENAI_IMAGE_MODEL } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { recordCreditUsage } from "../../lib/payment-record";
import { getSupabaseAdmin } from "../../lib/supabase-admin";
import {
  resolveImageStudioPlan,
  ratioToOpenAISize,
  GPT_IMAGE_2_CREDIT_COST,
  GEN4_IMAGE_CREDIT_COST,
  GEN4_IMAGE_TURBO_CREDIT_COST,
} from "./image-studio-pricing";

const router = Router();

const GPT_CREDITS = Number(process.env["IMAGE_STUDIO_GPT_CREDITS"]) || GPT_IMAGE_2_CREDIT_COST;
const PRO_CREDITS = Number(process.env["ARTIST_IMAGE_CREDITS"]) || GEN4_IMAGE_CREDIT_COST;
const TURBO_CREDITS = Number(process.env["ARTIST_IMAGE_TURBO_CREDITS"]) || GEN4_IMAGE_TURBO_CREDIT_COST;

/** Same public bucket artist images use; studio generations live under {userId}/studio/. */
const STUDIO_BUCKET = "artist-references";

/**
 * Tracks submitted Runway tasks so credits are only charged on SUCCEEDED.
 * Key: Runway taskId  Value: { userId, credits }
 */
const pendingStudioTasks = new Map<string, { userId: string; credits: number }>();

/** Turn a rough idea into a best-in-class image prompt using the newest text model. */
async function optimizeIdea(idea: string, identityDescription?: string): Promise<string> {
  const completion = await chatCompletion({
    messages: [
      {
        role: "system",
        content:
          "You are a world-class prompt engineer for state-of-the-art AI image models (OpenAI GPT Image 2). " +
          "Write ONE single vivid paragraph image prompt from the user's idea. It MUST specify: subject, composition and framing, " +
          "lighting, color palette, photorealism/detail level, and mood. For any text in the image, put the exact words in quotes. " +
          "Be concrete and visual — no vague adjectives without visual meaning. " +
          (identityDescription
            ? `The person in the image: ${identityDescription}. Preserve their exact identity, face, skin tone, hair, tattoos, and styling. `
            : "") +
          'Return ONLY valid JSON: {"prompt": "..."}. No markdown, no commentary.',
      },
      { role: "user", content: `Image idea:\n"""${idea.trim()}"""` },
    ],
    response_format: { type: "json_object" },
    max_tokens: 600,
    temperature: 0.8,
  });
  const raw = completion.choices[0]?.message?.content?.trim() ?? "{}";
  try {
    const parsed = JSON.parse(raw) as { prompt?: string };
    if (parsed.prompt?.trim()) return parsed.prompt.trim();
  } catch { /* fall through */ }
  return idea.trim();
}

async function deductCredits(req: Express.Request & { userId?: string; userSupabase?: any }, credits: number, action: string) {
  const { data: freshProfile } = await (req as any).userSupabase!
    .from("profiles")
    .select("credits")
    .eq("id", (req as any).userId!)
    .single();
  const freshCredits: number = (freshProfile as { credits?: number } | null)?.credits ?? 0;
  const creditsAfter = Math.max(0, freshCredits - credits);
  const { error: deductErr } = await getSupabaseAdmin()
    .from("profiles")
    .update({ credits: creditsAfter })
    .eq("id", (req as any).userId!);
  if (deductErr) {
    (req as any).log.error({ err: deductErr }, "[image-studio] credit deduction FAILED");
    return;
  }
  (req as any).log.info({ userId: (req as any).userId, creditsAfter, deducted: credits }, "[image-studio] credits deducted");
  recordCreditUsage({
    userId: (req as any).userId!,
    action,
    creditsUsed: credits,
    projectId: null,
  }).catch((e) => (req as any).log.warn({ err: e }, "[image-studio] credit_usage save failed (non-fatal)"));
}

async function uploadStudioImage(buffer: Buffer, userId: string, ext: string): Promise<{ url: string; path: string }> {
  const filePath = `${userId}/studio/${randomUUID()}.${ext}`;
  const { error: upErr } = await getSupabaseAdmin().storage
    .from(STUDIO_BUCKET)
    .upload(filePath, buffer, { contentType: ext === "png" ? "image/png" : "image/jpeg", upsert: false });
  if (upErr) throw upErr;
  const { data: { publicUrl } } = getSupabaseAdmin().storage.from(STUDIO_BUCKET).getPublicUrl(filePath);
  return { url: publicUrl, path: filePath };
}

/**
 * POST /api/image-studio/generate
 * The best image generator for content creators: GPT Image 2 (newest OpenAI),
 * Runway Gen4 Image, or Gen4 Turbo. Accepts a finished prompt OR a rough idea
 * (idea is auto-optimized into a best-in-class prompt first).
 * - gpt-image-2: synchronous → { status: "succeeded", url, prompt }
 * - Runway models: async task → { taskId, creditCost, model } (poll GET below)
 */
router.post("/image-studio/generate", requireAuth, async (req, res) => {
  const { prompt, idea, model, ratio, referenceImageUrl, identityDescription } = req.body as {
    prompt?: string;
    idea?: string;
    model?: string;
    ratio?: string;
    referenceImageUrl?: string | null;
    identityDescription?: string | null;
  };

  const plan = resolveImageStudioPlan({
    model,
    ratio,
    gptCredits: GPT_CREDITS,
    proCredits: PRO_CREDITS,
    turboCredits: TURBO_CREDITS,
  });

  let finalPrompt = prompt?.trim() ?? "";
  if (!finalPrompt && idea?.trim()) {
    try {
      finalPrompt = await optimizeIdea(idea, identityDescription ?? undefined);
    } catch (err) {
      req.log.warn({ err }, "[image-studio] idea optimization failed — using raw idea");
      finalPrompt = idea.trim();
    }
  }
  if (!finalPrompt) {
    res.status(400).json({ error: "prompt or idea is required" });
    return;
  }

  /* ── Credit pre-check — always enforced ── */
  const currentCredits = (req as any).userCredits ?? 0;
  if (currentCredits < plan.creditCost) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough credits. Please buy more credits to continue.",
    });
    return;
  }

  /* ── Identity lock: face reference for Runway, identity text for GPT ── */
  const refUrl = referenceImageUrl?.trim();
  const useRefImage = !!refUrl && /^https:\/\//i.test(refUrl);
  const IDENTITY_DIRECTIVE =
    "Use @artistface as the exact face, identity, and likeness reference for the person in this image. " +
    "Preserve their facial features, skin tone, and identity precisely.";
  const identityText = identityDescription?.trim()
    ? `The person in this image: ${identityDescription.trim()}. Keep their exact identity, face, skin tone, hair, tattoos, and styling. `
    : "";

  try {
    if (plan.sync) {
      /* ── GPT Image 2 (newest) — synchronous ── */
      const imageResp = await getOpenAI().images.generate({
        model: OPENAI_IMAGE_MODEL,
        prompt: `${identityText}${finalPrompt}`.slice(0, 4000),
        size: ratioToOpenAISize(plan.ratio),
        n: 1,
      });
      const b64 = imageResp.data?.[0]?.b64_json;
      if (!b64) throw new Error("GPT Image 2 returned no image data");
      const { url, path } = await uploadStudioImage(Buffer.from(b64, "base64"), (req as any).userId!, "png");
      await deductCredits(req as any, plan.creditCost, "Image Studio (GPT Image 2)");
      res.json({ status: "succeeded", url, path, prompt: finalPrompt, model: plan.model, ratio: plan.ratio });
      return;
    }

    /* ── Runway Gen4 / Turbo — async task ── */
    const apiKey = process.env["RUNWAYML_API_SECRET"];
    if (!apiKey) {
      res.status(500).json({ error: "Runway API key is not configured on the server" });
      return;
    }
    if (plan.model === "gen4_image_turbo" && !useRefImage) {
      res.status(400).json({
        error: "The Turbo model needs your artist photo as a face reference. Upload a photo first, or use GPT Image 2 or Gen4 Image.",
      });
      return;
    }
    const runwayPrompt = useRefImage
      ? `${IDENTITY_DIRECTIVE} ${identityText}${finalPrompt}`.slice(0, 1000)
      : `${identityText}${finalPrompt}`.slice(0, 1000);

    const client = new RunwayML({ apiKey });
    const referenceImages = useRefImage ? [{ uri: refUrl!, tag: "artistface" }] : undefined;
    const task = plan.model === "gen4_image_turbo"
      ? await client.textToImage.create({
          model: "gen4_image_turbo",
          promptText: runwayPrompt,
          ratio: plan.ratio,
          referenceImages: referenceImages!,
          contentModeration: { publicFigureThreshold: "low" },
        })
      : await client.textToImage.create({
          model: "gen4_image",
          promptText: runwayPrompt,
          ratio: plan.ratio,
          ...(referenceImages ? { referenceImages } : {}),
          contentModeration: { publicFigureThreshold: "low" },
        });

    pendingStudioTasks.set(task.id, { userId: (req as any).userId!, credits: plan.creditCost });
    req.log.info({ taskId: task.id, userId: (req as any).userId, model: plan.model }, "[image-studio] Runway task submitted");
    res.json({ taskId: task.id, creditCost: plan.creditCost, model: plan.model, ratio: plan.ratio, prompt: finalPrompt });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Image generation failed";
    req.log.error({ err: msg }, "[image-studio] generation failed — no credits charged");
    if (err instanceof OpenAI.APIError && (err.code === "content_policy_violation" || err.status === 400)) {
      res.status(400).json({ error: "The image was flagged by the AI provider's content policy — try rewording it." });
      return;
    }
    res.status(500).json({ error: msg });
  }
});

/**
 * GET /api/image-studio/:taskId
 * Poll a Runway studio task. SUCCEEDED → charge credits → upload → return URL.
 */
router.get("/image-studio/:taskId", requireAuth, async (req, res) => {
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
      const pending = pendingStudioTasks.get(taskId);
      if (!runwayUrl) {
        pendingStudioTasks.delete(taskId);
        res.json({ status: "succeeded", url: null });
        return;
      }
      if (pending && pending.userId === (req as any).userId) {
        await deductCredits(req as any, pending.credits ?? GEN4_IMAGE_CREDIT_COST, "Image Studio (Runway)");
        pendingStudioTasks.delete(taskId);
      }
      try {
        const dl = await fetch(runwayUrl, { signal: AbortSignal.timeout(120_000) });
        if (!dl.ok) throw new Error(`Download failed (${dl.status})`);
        const buffer = Buffer.from(await dl.arrayBuffer());
        const { url, path } = await uploadStudioImage(buffer, (req as any).userId!, "jpg");
        res.json({ status: "succeeded", url, path });
      } catch (uploadErr) {
        req.log.error({ err: uploadErr }, "[image-studio] bucket upload failed — returning raw Runway URL");
        res.json({ status: "succeeded", url: runwayUrl, path: null });
      }
    } else if (task.status === "FAILED" || task.status === "CANCELLED") {
      pendingStudioTasks.delete(taskId);
      const failureCode = ((task as { failureCode?: string }).failureCode ?? "").toUpperCase();
      const errMsg = /MODERATION|SAFETY|CONTENT/.test(failureCode)
        ? "Runway rejected this image (content moderation). Try a different description."
        : ((task as { failure?: string }).failure ?? "Runway image generation failed.");
      res.json({ status: task.status === "CANCELLED" ? "cancelled" : "failed", error: errMsg });
    } else {
      res.json({ status: "processing", progress: (task as { progress?: number }).progress ?? null });
    }
  } catch (err: unknown) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to poll image task" });
  }
});

export default router;
