import { Router } from "express";
import { attachJobMapTtl } from "../../lib/job-map-sweeper";
import { randomUUID } from "crypto";
import RunwayML from "@runwayml/sdk";
import { z } from "zod";
import { getOpenAI } from "../../lib/ai-clients";
import { requireAuth } from "../../middlewares/require-auth";
import { generationLimiter } from "../../lib/rate-limit";
import { getCreditBalance } from "../../lib/credits";
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
 * Tracks submitted Runway logo tasks. Reserve-at-submit (stack1400
 * ruling #43): credits are CHARGED at submit, before the provider
 * call; the success poll confirms the reserve, a failure poll
 * refunds it in full.
 * Key: Runway taskId  Value: { userId, credits, chargeKey }
 */
/* OOM fix (2026-10-25): abandoned tasks were never deleted — bounded
 * by the house job-map TTL (2h), like the other pending-task maps. */
const pendingLogoTasks = attachJobMapTtl(new Map<string, { userId: string; credits: number; chargeKey: string }>());

/** The reserve resolution for a sync (in-request) logo charge whose
 *  task id was minted locally: the durable row when its record
 *  landed, otherwise the in-memory reserve itself. */
function syncReserveResolution(userId: string, credits: number, action: string, chargeKey: string, rowFound: boolean): ResolvedPendingCharge {
  return {
    userId,
    credits,
    projectId: null,
    action,
    extra: null,
    intentStatus: rowFound ? "reserved" : null,
    source: rowFound ? "intent" : "memory",
    reserved: true,
    chargeKey,
  };
}
/** Test hook — clears the in-memory task map. */

async function uploadLogoImage(userId: string, buffer: Buffer, ext: string): Promise<{ url: string; path: string }> {
  const filePath = `logos/${userId}/${randomUUID()}.${ext}`;
  // R2 migration: zero-egress public upload (Supabase fallback when R2 unset).
  const url = await uploadPublicMediaToR2(LOGO_BUCKET, filePath, buffer, ext === "png" ? "image/png" : "image/jpeg");
  return { url, path: filePath };
}

/* ─────────────────────────────────────────────────────────────────────────────
   POST /generate-logo
   1. Validate brandName + style. 2. Credit pre-check (402 when broke).
   3a. Premium (GPT Image 2.5, synchronous): RESERVE → generate → upload → confirm → return URL (any failure refunds the reserve).
   3b. Standard (Runway gen4_image, async): RESERVE → submit → track task → return taskId.
───────────────────────────────────────────────────────────────────────────── */
router.post("/generate-logo", requireAuth, generationLimiter, async (req, res) => {
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
    /* RESERVE at submit (ruling #43): the charge lands BEFORE the
       provider call, keyed to the minted sync task id. A refused
       charge refuses the request — the provider is never called. */
    const premiumTaskId = `sync-${randomUUID()}`;
    const chargeKey = generationChargeKey(premiumTaskId);
    const reserve = await chargeGenerationReserve({
      userId: req.userId!,
      credits: creditCost,
      action: "Logo (Premium)",
      chargeKey,
    });
    if (!reserve.ok) {
      if (reserve.reason === "insufficient") {
        res.status(402).json({
          error: "out_of_credits",
          message: "Not enough Visual Bucs. Please Buy more Visual Bucs to continue.",
        });
        return;
      }
      if (reserve.reason === "disabled") {
        res.status(403).json({ error: "credits_disabled", message: "Credit spending is not enabled for this account." });
        return;
      }
      req.log.error({ err: reserve.err }, "[logo] reserve charge failed at submit — request refused (Premium)");
      res.status(500).json({ error: "Could not reserve your Visual Bucs. Please try again." });
      return;
    }
    await recordGenerationReserve(generationChargeIntentStore, {
      taskId: premiumTaskId,
      rail: "logo",
      userId: req.userId!,
      credits: creditCost,
      action: "Logo (Premium)",
      chargeKey,
    });
    const premiumResolved = syncReserveResolution(
      req.userId!, creditCost, "Logo (Premium)", chargeKey,
      (await generationChargeIntentStore.getIntent(premiumTaskId).catch(() => null)) !== null,
    );
    const refundPremiumReserve = async (reason: string) => {
      const out = await refundGenerationReserve(generationChargeIntentStore, premiumTaskId, premiumResolved, reason);
      if (out === "refund_failed") {
        req.log.error({ taskId: premiumTaskId }, "[logo] CRITICAL: premium reserve refund failed — reserve stays reserved for the sweeper");
      }
      return out;
    };
    try {
      req.log.info({ userId: req.userId, style }, "[logo] GPT Image 2.5 generation started");
      let b64: string | undefined;
      try {
        const imageResp = await getOpenAI().images.generate({
          model: IMAGE_MODEL,
          prompt: prompt.slice(0, 4000),
          size: "1024x1024",
          quality: "high",
          n: 1,
        });
        b64 = imageResp.data?.[0]?.b64_json;
      } catch (genErr: unknown) {
        /* Provider failure after the reserve — refund in full. */
        await refundPremiumReserve("provider failed");
        throw genErr;
      }
      if (!b64) {
        /* No output — refund in full. */
        await refundPremiumReserve("no output");
        res.status(500).json({ error: "Image generation returned no image data." });
        return;
      }
      const creditsAfter = reserve.balance;
      req.log.info({ userId: req.userId, creditsAfter, deducted: creditCost }, "[logo] credits reserved at submit (Premium)");
      try {
        const { url, path: storagePath } = await uploadLogoImage(req.userId!, Buffer.from(b64, "base64"), "png");
        await confirmGenerationReserve(generationChargeIntentStore, premiumTaskId, premiumResolved);
        await markGenerationIntentDelivered(generationChargeIntentStore, premiumTaskId);
        res.json({ status: "succeeded", url, path: storagePath, creditCost, model: "premium", creditsRemaining: creditsAfter });
        return;
      } catch (firstUploadErr) {
        void firstUploadErr; /* fall through to the shared delivery attempt below */
      }
      {
        /* Image was generated; still return it so the user isn't left empty-handed. */
        try {
          const { url, path: storagePath } = await uploadLogoImage(req.userId!, Buffer.from(b64, "base64"), "png");
          await confirmGenerationReserve(generationChargeIntentStore, premiumTaskId, premiumResolved);
          await markGenerationIntentDelivered(generationChargeIntentStore, premiumTaskId);
          res.json({ status: "succeeded", url, path: storagePath, creditCost, model: "premium" });
        } catch (uploadErr) {
          /* Both upload attempts failed — the save failure refunds
             the reserve in full, exactly once. */
          const out = await refundPremiumReserve("delivery failed");
          if (out === "refund_failed") {
            req.log.error({ err: uploadErr }, "[logo] CRITICAL: delivery failed AND the reserve refund failed — manual reconciliation required");
          }
          req.log.error({ err: uploadErr }, "[logo] delivery failed after reserve — credits refunded");
          res.status(500).json({ error: "Logo delivery failed — your Visual Bucs were refunded." });
          return;
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Logo generation failed";
      req.log.error({ err: msg }, "[logo] generation failed — reserve refunded");
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

  /* RESERVE at submit (ruling #43): charge BEFORE the provider call
     under a submit-minted job id (the Runway task id doesn't exist
     yet); the intent row recorded below carries the key. A refused
     charge refuses the submit — the provider is never called. */
  const jobId = `job-${randomUUID()}`;
  const chargeKey = generationChargeKey(jobId);
  const reserve = await chargeGenerationReserve({
    userId: req.userId!,
    credits: creditCost,
    action: "Logo (Standard)",
    chargeKey,
  });
  if (!reserve.ok) {
    if (reserve.reason === "insufficient") {
      res.status(402).json({
        error: "out_of_credits",
        message: "Not enough Visual Bucs. Please Buy more Visual Bucs to continue.",
      });
      return;
    }
    if (reserve.reason === "disabled") {
      res.status(403).json({ error: "credits_disabled", message: "Credit spending is not enabled for this account." });
      return;
    }
    req.log.error({ err: reserve.err }, "[logo] reserve charge failed at submit — submission refused (Standard)");
    res.status(500).json({ error: "Could not reserve your Visual Bucs. Please try again." });
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
    pendingLogoTasks.set(task.id, { userId: req.userId!, credits: creditCost, chargeKey });
    /* Durable reserve record (0317): survives the restarts the
       in-memory map cannot — the success poll confirms from this row
       when the map entry is gone, a failure poll refunds from it. */
    await recordGenerationReserve(generationChargeIntentStore, {
      taskId: task.id,
      rail: "logo",
      userId: req.userId!,
      credits: creditCost,
      action: "Logo (Standard)",
      chargeKey,
    });
    req.log.info({ taskId: task.id, userId: req.userId }, "[logo] task submitted — credits reserved at submit");
    res.json({ taskId: task.id, creditCost, model: "standard", status: "processing" });
  } catch (err: unknown) {
    /* Provider submission failed AFTER the reserve — refund in full
       in-request; no poll will ever come for a task that never was. */
    const refundOutcome = await refundOrFailGenerationIntent(generationChargeIntentStore, jobId, {
      userId: req.userId!,
      credits: creditCost,
      projectId: null,
      action: "Logo (Standard)",
      extra: null,
      intentStatus: null,
      source: "memory",
      reserved: true,
      chargeKey,
    }, "submission failed");
    if (refundOutcome === "refund_failed") {
      req.log.error({ taskId: jobId, userId: req.userId }, "[logo] CRITICAL: submission-failure refund failed — reserve stands under the job id for manual reconciliation");
    }
    const msg = err instanceof Error ? err.message : "Runway API returned an error";
    req.log.error({ err: msg }, "[logo] submission failed — reserve refunded");
    res.status(500).json({ error: msg });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /generate-logo/:taskId
   Poll a Runway standard-tier logo task.
   - SUCCEEDED → confirm reserve → upload → return public URL
   - FAILED/CANCELLED → refund the reserve in full → return error
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
      const pending0 = pendingLogoTasks.get(taskId);
      const resolved0 = await resolvePendingCharge(
        generationChargeIntentStore,
        taskId,
        pending0
          ? { userId: pending0.userId, credits: pending0.credits, action: "Logo (Standard)", reserved: true, chargeKey: pending0.chargeKey }
          : null,
      );
      const runwayUrl = (task.output as string[] | undefined)?.[0] ?? null;
      if (!runwayUrl) {
        /* SUCCEEDED but no output — refund the reserve in full. */
        pendingLogoTasks.delete(taskId);
        if (resolved0) {
          await refundOrFailGenerationIntent(generationChargeIntentStore, taskId, resolved0, "no output");
        } else {
          await markGenerationIntentFailed(generationChargeIntentStore, taskId);
        }
        res.json({ status: "succeeded", url: null });
        return;
      }

      const pending = pendingLogoTasks.get(taskId);
      let creditsRemaining: number | undefined;
      /* ── Confirm the reserve (only once) — resolved from the
         in-memory map OR the durable reserve row (0317). Confirming
         moves NO money. Legacy pre-0317 rows still settle here. ── */
      const resolved = resolved0;
      if (resolved && resolved.userId === req.userId) {
        let outcome: string;
        if (resolved.reserved) {
          const c = await confirmGenerationReserve(generationChargeIntentStore, taskId, resolved);
          outcome = c === "not_reserved" ? "skipped" : c;
          if (c === "refunded") {
            req.log.error({ taskId }, "[logo] SUCCEEDED poll found the reserve already refunded — delivering; the member was not charged");
          }
        } else {
          outcome = await settleGenerationCharge(generationChargeIntentStore, taskId, resolved);
        }
        if (outcome !== "charge_failed" && outcome !== "skipped") {
          creditsRemaining = await getCreditBalance(req.userId!).catch(() => undefined);
          req.log.info({ taskId, userId: req.userId, creditsAfter: creditsRemaining, deducted: resolved.credits, source: resolved.source }, "[logo] credits confirmed (reserved at submit) (Standard)");
        }
        /* legacy charge_failed: settle logged CRITICAL, intent stays
           awaiting; delivery is stamped below and the sweeper retries. */
        pendingLogoTasks.delete(taskId);
      } else if (resolved && resolved.userId !== req.userId) {
        req.log.warn({ taskId, submitter: resolved.userId, poller: req.userId }, "[logo] userId mismatch on poll — skipping confirm");
      } else if (!resolved) {
        req.log.error({ taskId }, "[logo] SUCCEEDED with NO charge record (no memory entry, no intent row) — delivering uncharged; only possible for tasks submitted before migration 0298 or a failed intent record (logged CRITICAL at submit)");
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
      /* Provider failure — refund the reserve in full, exactly once
         (legacy rows: no money was ever held, bookkeeping only). */
      const pendingF = pendingLogoTasks.get(taskId);
      const resolvedF = await resolvePendingCharge(
        generationChargeIntentStore,
        taskId,
        pendingF
          ? { userId: pendingF.userId, credits: pendingF.credits, action: "Logo (Standard)", reserved: true, chargeKey: pendingF.chargeKey }
          : null,
      );
      pendingLogoTasks.delete(taskId);
      if (resolvedF) {
        await refundOrFailGenerationIntent(generationChargeIntentStore, taskId, resolvedF, task.status === "CANCELLED" ? "provider cancelled" : "provider failed");
      } else {
        await markGenerationIntentFailed(generationChargeIntentStore, taskId);
      }
      req.log.info({ taskId, status: task.status }, "[logo] task failed — reserve refunded");
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
