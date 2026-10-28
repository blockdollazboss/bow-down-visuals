import { Router } from "express";
import { attachJobMapTtl } from "../../lib/job-map-sweeper";
import { randomUUID } from "crypto";
import RunwayML from "@runwayml/sdk";
import { z } from "zod";
import { getOpenAI } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { refundCredits, getCreditBalance } from "../../lib/credits";
import {
  generationChargeIntentStore,
  recordGenerationChargeIntent,
  resolvePendingCharge,
  settleGenerationCharge,
  markGenerationIntentDelivered,
  markGenerationIntentFailed,
} from "../../lib/generation-charge-intents";
import { uploadPublicMediaToR2 } from "../../lib/objectStorage";
import {
  resolveLogoPlan,
  buildLogoPrompt,
  LOGO_PREMIUM_CREDIT_COST,
  LOGO_STANDARD_CREDIT_COST,
} from "./logo-pricing";

const router = Router();

/* Attribution policy (confirmed intentional, 2026-10-07): logos are brand
   assets — "Made with Bow Down Visuals" is deliberately NOT stamped on
   generated logos. A creator's logo must be clean for their own branding. */

const logoSchema = z.object({
  brandName: z.string().trim().min(1),
  style: z.enum(["luxury-gold", "gaming", "minimal", "mascot"]),
  tagline: z.string().optional(),
  model: z.enum(["premium", "standard"]).default("premium"),
});

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
/* OOM fix (2026-10-25): abandoned tasks were never deleted — bounded
 * by the house job-map TTL (2h), like the other pending-task maps. */
const pendingLogoTasks = attachJobMapTtl(new Map<string, { userId: string; credits: number }>());
/** Test hook — clears the in-memory task map. */
export function __clearPendingLogoTasks() {
  pendingLogoTasks.clear();
}

async function uploadLogoImage(userId: string, buffer: Buffer, ext: string): Promise<{ url: string; path: string }> {
  const filePath = `logos/${userId}/${randomUUID()}.${ext}`;
  // R2 migration: zero-egress public upload (Supabase fallback when R2 unset).
  const url = await uploadPublicMediaToR2(LOGO_BUCKET, filePath, buffer, ext === "png" ? "image/png" : "image/jpeg");
  return { url, path: filePath };
}

/* ─────────────────────────────────────────────────────────────────────────────
   POST /generate-logo
   1. Validate brandName + style. 2. Credit pre-check (402 when broke).
   3a. Premium (GPT Image 2.5, synchronous): generate → charge → upload → return URL.
   3b. Standard (Runway gen4_image, async): submit → track task → return taskId.
───────────────────────────────────────────────────────────────────────────── */
router.post("/generate-logo", requireAuth, async (req, res) => {
  const parsed = logoSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }
  const { brandName, style, tagline, model } = parsed.data;

  const plan = resolveLogoPlan({ model });
  const creditCost = plan.model === "premium" ? PREMIUM_CREDITS : STANDARD_CREDITS;
  const prompt = buildLogoPrompt(brandName, style, tagline);

  /* ── Credit pre-check — always enforced ── */
  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < creditCost) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Please Buy more Visual Bucs to continue.",
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
      /* Charge only after the image exists — failure above means no charge.
         Lane 4: the charge settles through a durable generation-charge
         intent (minted sync-<uuid>), so the outcomes the old try/catch
         distinguished survive intact — charged_unledgered means the
         deduction STANDS (only the ledger trace is missing) and counts
         as paid; charge_failed means nothing was taken, and stamping
         the intent delivered lets the retry sweeper settle it later
         instead of leaving a silent free logo. */
      let charged = false;
      const premiumTaskId = `sync-${randomUUID()}`;
      await recordGenerationChargeIntent(generationChargeIntentStore, {
        taskId: premiumTaskId,
        rail: "logo",
        userId: req.userId!,
        credits: creditCost,
        action: "Logo (Premium)",
      });
      const premiumOutcome = await settleGenerationCharge(generationChargeIntentStore, premiumTaskId, {
        userId: req.userId!,
        credits: creditCost,
        projectId: null,
        action: "Logo (Premium)",
        extra: null,
        intentStatus: "awaiting",
        source: "intent",
      });
      charged = premiumOutcome !== "charge_failed";
      if (charged) {
        const creditsAfter = await getCreditBalance(req.userId!).catch(() => undefined);
        req.log.info({ userId: req.userId, creditsAfter, deducted: creditCost, outcome: premiumOutcome }, "[logo] credits deducted (Premium)");
        try {
          const { url, path: storagePath } = await uploadLogoImage(req.userId!, Buffer.from(b64, "base64"), "png");
          await markGenerationIntentDelivered(generationChargeIntentStore, premiumTaskId);
          res.json({ status: "succeeded", url, path: storagePath, creditCost, model: "premium", creditsRemaining: creditsAfter });
          return;
        } catch (firstUploadErr) {
          void firstUploadErr; /* fall through to the shared delivery attempt below */
        }
      }
      {
        /* Image was generated; still return it so the user isn't left empty-handed.
           (When the charge failed, stamping the intent delivered below is
           what lets the sweeper settle it later.) */
        try {
          const { url, path: storagePath } = await uploadLogoImage(req.userId!, Buffer.from(b64, "base64"), "png");
          await markGenerationIntentDelivered(generationChargeIntentStore, premiumTaskId);
          res.json({ status: "succeeded", url, path: storagePath, creditCost, model: "premium" });
        } catch (uploadErr) {
          /* Both upload attempts failed. If the charge landed, give the
             money back — never answer "no credits charged" over a charge
             that stands (D5 sweep G5). */
          if (charged) {
            try {
              await refundCredits(req.userId!, creditCost, { action: "Logo (Premium) — Refund (delivery failed)" });
            } catch (refundErr) {
              req.log.error({ err: refundErr }, "[logo] CRITICAL: refund failed after delivery failure — manual reconciliation required");
            }
            req.log.error({ err: uploadErr }, "[logo] delivery failed after charge — credits refunded");
            res.status(500).json({ error: "Logo delivery failed — your Visual Bucs were refunded." });
            return;
          }
          req.log.error({ err: uploadErr }, "[logo] delivery failed — no credits charged");
          res.status(500).json({ error: "Logo delivery failed. No Visual Bucs were charged." });
          return;
        }
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
    /* Durable charge intent (Lane 4): survives the restarts the
       in-memory map cannot — the success poll settles from this row
       when the map entry is gone. */
    await recordGenerationChargeIntent(generationChargeIntentStore, {
      taskId: task.id,
      rail: "logo",
      userId: req.userId!,
      credits: creditCost,
      action: "Logo (Standard)",
    });
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
      /* ── Charge (only once) — resolved from the in-memory map OR the
         durable submit-time intent (Lane 4). A missing map entry used
         to mean a silent free delivery; now the intent row settles
         the charge, and when NEITHER exists the delivery is logged as
         unchargeable at error level. ── */
      const resolved = await resolvePendingCharge(
        generationChargeIntentStore,
        taskId,
        pending
          ? { userId: pending.userId, credits: pending.credits, action: "Logo (Standard)" }
          : null,
      );
      if (resolved && resolved.userId === req.userId) {
        const outcome = await settleGenerationCharge(generationChargeIntentStore, taskId, resolved);
        if (outcome !== "charge_failed") {
          creditsRemaining = await getCreditBalance(req.userId!).catch(() => undefined);
          req.log.info({ taskId, userId: req.userId, creditsAfter: creditsRemaining, deducted: resolved.credits, source: resolved.source }, "[logo] credits deducted (Standard)");
        }
        /* charge_failed: settle logged CRITICAL, intent stays awaiting;
           delivery is stamped below and the sweeper retries. */
        pendingLogoTasks.delete(taskId);
      } else if (resolved && resolved.userId !== req.userId) {
        req.log.warn({ taskId, submitter: resolved.userId, poller: req.userId }, "[logo] userId mismatch on poll — skipping charge");
      } else if (!resolved) {
        req.log.error({ taskId }, "[logo] SUCCEEDED with NO charge record (no memory entry, no intent row) — delivering uncharged; only possible for tasks submitted before migration 0297 or a failed intent record (logged CRITICAL at submit)");
      }

      /* Download from Runway and re-host in our bucket. */
      try {
        const dl = await fetch(runwayUrl, { signal: AbortSignal.timeout(120_000) });
        if (!dl.ok) throw new Error(`Download failed (${dl.status})`);
        const buf = Buffer.from(await dl.arrayBuffer());
        const { url, path: storagePath } = await uploadLogoImage(req.userId!, buf, "jpg");
        await markGenerationIntentDelivered(generationChargeIntentStore, taskId);
        res.json({ status: "succeeded", url, path: storagePath, creditsRemaining });
      } catch (uploadErr: unknown) {
        req.log.error({ err: uploadErr }, "[logo] bucket upload failed — returning raw Runway URL as fallback");
        await markGenerationIntentDelivered(generationChargeIntentStore, taskId);
        res.json({ status: "succeeded", url: runwayUrl, path: null, creditsRemaining });
      }

    } else if (task.status === "FAILED" || task.status === "CANCELLED") {
      pendingLogoTasks.delete(taskId);
      await markGenerationIntentFailed(generationChargeIntentStore, taskId);
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
