import { Router } from "express";
import { attachJobMapTtl } from "../../lib/job-map-sweeper";
import { createWriteStream, unlinkSync, existsSync, readFileSync } from "fs";
import { pipeline } from "stream/promises";
import { randomUUID } from "crypto";
import path from "path";
import os from "os";
import RunwayML from "@runwayml/sdk";
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
} from "../../lib/generation-charge-intents";
import { uploadPublicMediaToR2 } from "../../lib/objectStorage";
import { z } from "zod";
import {
  buildIntroOutroPrompt,
  resolveIntroOutroCost,
  resolveIntroOutroRequest,
  INTRO_OUTRO_DURATION_SEC,
  INTRO_OUTRO_RATIO,
  INTRO_OUTRO_CREDITS_PER_SEC_FALLBACK,
} from "./intro-outro-pricing";

const router = Router();

/* Site credits per second of Seedance video. Env-overridable; mirrors the
   main video rate so intro pricing never drifts from scene pricing. */
const CREDITS_PER_SEC = Number(process.env["SEEDANCE_CREDITS_PER_SEC"]) || INTRO_OUTRO_CREDITS_PER_SEC_FALLBACK;
const CREDIT_COST = resolveIntroOutroCost(CREDITS_PER_SEC);

/** Supabase Storage bucket for generated brand videos. */
const INTRO_OUTRO_BUCKET = "generated-clips";

/**
 * Tracks submitted Seedance intro/outro tasks. Reserve-at-submit
 * (stack1400 ruling #43): credits are CHARGED at submit, before the
 * provider call; the success poll confirms the reserve, a failure
 * poll refunds it in full.
 * Key: Runway taskId  Value: { userId, credits, chargeKey }
 */
/* OOM fix (2026-10-25): abandoned tasks were never deleted — bounded
 * by the house job-map TTL (2h), like the other pending-task maps. */
const pendingIntroTasks = attachJobMapTtl(new Map<string, { userId: string; credits: number; chargeKey: string }>());
/** Test hook — clears the in-memory task map. */
/** Test hook — read the pending map size. */

const introOutroSchema = z.object({
  channelName: z.string().trim().min(1),
  type: z.enum(["intro", "outro"]),
  tagline: z.string().optional(),
  referenceImageUrl: z.string().nullable().optional(),
});

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Download failed (${res.status}): ${url.slice(0, 80)}`);
  const ws = createWriteStream(dest);
  await pipeline(res.body as Parameters<typeof pipeline>[0], ws);
}

function cleanup(f: string) {
  try { if (existsSync(f)) unlinkSync(f); } catch { /* best-effort */ }
}

/* ─────────────────────────────────────────────────────────────────────────────
   POST /generate-intro-outro
   1. Validate channelName + type. 2. Credit pre-check (402 when broke).
   3. RESERVE the charge (ruling #43). 4. Submit 5s Seedance 2.5 job to
   Runway. 5. Track task — the success poll confirms, failure refunds.
───────────────────────────────────────────────────────────────────────────── */
router.post("/generate-intro-outro", requireAuth, generationLimiter, async (req, res) => {
  const parsed = introOutroSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: "Invalid request.",
      details: parsed.error.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
    });
    return;
  }

  const resolved = resolveIntroOutroRequest(parsed.data);
  if (!resolved.ok) {
    res.status(resolved.status).json({ error: resolved.error });
    return;
  }

  /* ── Credit pre-check — always enforced ── */
  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < CREDIT_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Please Buy more Visual Bucs to continue.",
    });
    return;
  }

  const apiKey = process.env["RUNWAYML_API_SECRET"];
  if (!apiKey) {
    res.status(500).json({ error: "Runway API key is not configured on the server" });
    return;
  }

  const prompt = buildIntroOutroPrompt(resolved.channelName, resolved.type, resolved.tagline);
  const client = new RunwayML({ apiKey });

  /* ── RESERVE at submit (ruling #43): charge BEFORE the provider
     call, through chargeCredits (fresh balance read). The Runway task
     id doesn't exist yet, so the charge keys to a submit-minted job
     id; the intent row (recorded once the task id lands) carries the
     key in extra.chargeKey. A refused charge refuses the submit —
     the provider is never called. ── */
  const jobId = `job-${randomUUID()}`;
  const chargeKey = generationChargeKey(jobId);
  const reserve = await chargeGenerationReserve({
    userId: req.userId!,
    credits: CREDIT_COST,
    action: "Intro/Outro Video",
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
    req.log.error({ err: reserve.err }, "[intro-outro] reserve charge failed at submit — submission refused");
    res.status(500).json({ error: "Could not reserve your Visual Bucs. Please try again." });
    return;
  }

  req.log.info(
    { userId: req.userId, type: resolved.type, durationSec: INTRO_OUTRO_DURATION_SEC },
    "[intro-outro] Runway Seedance generation started",
  );

  try {
    const task = resolved.refImage
      ? await client.imageToVideo.create({
          model: "seedance2_5",
          promptImage: resolved.refImage,
          promptText: prompt.slice(0, 4000),
          duration: INTRO_OUTRO_DURATION_SEC,
          ratio: INTRO_OUTRO_RATIO,
          audio: false,
        })
      : await client.textToVideo.create({
          model: "seedance2_5",
          promptText: prompt.slice(0, 4000),
          duration: INTRO_OUTRO_DURATION_SEC,
          ratio: INTRO_OUTRO_RATIO,
          audio: false,
        });

    pendingIntroTasks.set(task.id, { userId: req.userId!, credits: CREDIT_COST, chargeKey });
    /* Durable reserve record (0317): survives the restarts the
       in-memory map cannot — the success poll confirms from this row
       when the map entry is gone, a failure poll refunds from it. */
    await recordGenerationReserve(generationChargeIntentStore, {
      taskId: task.id,
      rail: "intro-outro",
      userId: req.userId!,
      credits: CREDIT_COST,
      action: "Intro/Outro Video",
      chargeKey,
    });
    req.log.info({ taskId: task.id, userId: req.userId }, "[intro-outro] task submitted — credits reserved at submit");
    res.json({ taskId: task.id, creditCost: CREDIT_COST, type: resolved.type, durationSec: INTRO_OUTRO_DURATION_SEC, status: "processing" });
  } catch (err: unknown) {
    /* Provider submission failed AFTER the reserve landed — refund
       the reserve in full in-request (no task id exists, so no poll
       will ever come for it). A failed refund is logged CRITICAL
       with the job id; the charge's ledger row under the charge key
       is the reconciliation trail. */
    const refundOutcome = await refundOrFailGenerationIntent(generationChargeIntentStore, jobId, {
      userId: req.userId!,
      credits: CREDIT_COST,
      projectId: null,
      action: "Intro/Outro Video",
      extra: null,
      intentStatus: null,
      source: "memory",
      reserved: true,
      chargeKey,
    }, "submission failed");
    if (refundOutcome === "refund_failed") {
      req.log.error({ taskId: jobId, userId: req.userId }, "[intro-outro] CRITICAL: submission-failure refund failed — reserve stands under the job id for manual reconciliation");
    }
    const msg = err instanceof Error ? err.message : "Runway API returned an error";
    req.log.error({ err: msg }, "[intro-outro] submission failed — reserve refunded");
    res.status(500).json({ error: msg });
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   GET /generate-intro-outro/:taskId
   Poll Runway task status.
   - SUCCEEDED → confirm reserve → upload to generated-clips → return URL
   - FAILED/CANCELLED → refund the reserve in full → return error
   - Still running → return { status: "processing" }
───────────────────────────────────────────────────────────────────────────── */
router.get("/generate-intro-outro/:taskId", requireAuth, async (req, res) => {
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
      const pending0 = pendingIntroTasks.get(taskId);
      const resolved0 = await resolvePendingCharge(
        generationChargeIntentStore,
        taskId,
        pending0
          ? { userId: pending0.userId, credits: pending0.credits, action: "Intro/Outro Video", reserved: true, chargeKey: pending0.chargeKey }
          : null,
      );
      if (!((task.output as string[] | undefined)?.[0])) {
        /* SUCCEEDED but no output — a no-output failure: the reserve
           is refunded in full, exactly once. */
        pendingIntroTasks.delete(taskId);
        if (resolved0) {
          await refundOrFailGenerationIntent(generationChargeIntentStore, taskId, resolved0, "no output");
        } else {
          await markGenerationIntentFailed(generationChargeIntentStore, taskId);
        }
        req.log.warn({ taskId }, "[intro-outro] SUCCEEDED but no output URL — reserve refunded");
        res.json({ status: "succeeded", url: null });
        return;
      }
      const runwayUrl = (task.output as string[])[0]!;

      const pending = pendingIntroTasks.get(taskId);
      let creditsRemaining: number | undefined;

      /* ── Confirm the reserve (only once) — resolved from the
         in-memory map OR the durable reserve row (0317). Confirming
         moves NO money: the charge landed at submit. Legacy
         pre-0317 rows still settle here via settleGenerationCharge.
         When NEITHER record exists the delivery is logged as
         unchargeable at error level. ── */
      const resolved = resolved0;
      let chargeOutcome: "confirmed" | "charged" | "charged_unledgered" | "already" | "charge_failed" | "refunded" | "skipped" = "skipped";
      if (resolved && resolved.userId === req.userId) {
        if (resolved.reserved) {
          const c = await confirmGenerationReserve(generationChargeIntentStore, taskId, resolved);
          chargeOutcome = c === "not_reserved" ? "skipped" : c;
          if (c === "refunded") {
            req.log.error({ taskId }, "[intro-outro] SUCCEEDED poll found the reserve already refunded — delivering; the member was not charged");
          }
        } else {
          chargeOutcome = await settleGenerationCharge(generationChargeIntentStore, taskId, resolved);
        }
        if (chargeOutcome !== "charge_failed" && chargeOutcome !== "skipped") {
          creditsRemaining = await getCreditBalance(req.userId!).catch(() => undefined);
          req.log.info({ taskId, userId: req.userId, creditsAfter: creditsRemaining, deducted: resolved.credits, source: resolved.source }, "[intro-outro] credits confirmed (reserved at submit)");
        }
        /* legacy charge_failed: settle logged CRITICAL, intent stays
           awaiting; delivery is stamped below and the sweeper retries. */
        pendingIntroTasks.delete(taskId);
      } else if (resolved && resolved.userId !== req.userId) {
        req.log.warn({ taskId, submitter: resolved.userId, poller: req.userId }, "[intro-outro] userId mismatch on poll — skipping confirm");
      } else if (!resolved) {
        req.log.error({ taskId }, "[intro-outro] SUCCEEDED with NO charge record (no memory entry, no intent row) — delivering uncharged; only possible for tasks submitted before migration 0298 or a failed intent record (logged CRITICAL at submit)");
      }

      /* ── Upload to Supabase Storage ── */
      const tmpFile = path.join(os.tmpdir(), `intro-outro-${randomUUID()}.mp4`);
      try {
        await downloadToFile(runwayUrl, tmpFile);
        const objectName = `intros-outros/${randomUUID()}.mp4`;
        // R2 migration: zero-egress public upload (Supabase fallback when R2 unset).
        const publicUrl = await uploadPublicMediaToR2(INTRO_OUTRO_BUCKET, objectName, readFileSync(tmpFile), "video/mp4");
        await markGenerationIntentDelivered(generationChargeIntentStore, taskId);
        res.json({ status: "succeeded", url: publicUrl, path: objectName, creditsRemaining });
      } catch (uploadErr: unknown) {
        /* Upload failed after a confirmed reserve — the member still
           gets the raw provider URL as fallback (the pre-existing
           delivery contract), so NO refund is owed here; the earlier
           design refunded only because its charge had just landed.
           'refunded' in the response now reports the reserve state:
           true only when the reserve was already refunded (the
           no-charge case above), never a new refund on this path. */
        if (resolved && resolved.userId === req.userId && chargeOutcome !== "charge_failed" && chargeOutcome !== "skipped") {
          await markGenerationIntentDelivered(generationChargeIntentStore, taskId);
        }
        req.log.error({ err: uploadErr }, "[intro-outro] bucket upload failed — returning raw Runway URL as fallback");
        res.json({ status: "succeeded", url: runwayUrl, path: null, creditsRemaining, refunded: chargeOutcome === "refunded" });
      } finally {
        cleanup(tmpFile);
      }

    } else if (task.status === "FAILED" || task.status === "CANCELLED") {
      /* Provider failure — refund the reserve in full, exactly once
         (legacy rows: no money was ever held, bookkeeping only). */
      const pendingF = pendingIntroTasks.get(taskId);
      const resolvedF = await resolvePendingCharge(
        generationChargeIntentStore,
        taskId,
        pendingF
          ? { userId: pendingF.userId, credits: pendingF.credits, action: "Intro/Outro Video", reserved: true, chargeKey: pendingF.chargeKey }
          : null,
      );
      pendingIntroTasks.delete(taskId);
      if (resolvedF) {
        await refundOrFailGenerationIntent(generationChargeIntentStore, taskId, resolvedF, task.status === "CANCELLED" ? "provider cancelled" : "provider failed");
      } else {
        await markGenerationIntentFailed(generationChargeIntentStore, taskId);
      }
      req.log.info({ taskId, status: task.status }, "[intro-outro] task failed — reserve refunded");
      res.json({
        status: task.status === "CANCELLED" ? "cancelled" : "failed",
        error: (task as { failure?: string }).failure ?? "Intro/outro generation failed.",
      });
    } else {
      const running = task as { progress?: number };
      res.json({ status: "processing", progress: running.progress ?? null });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to poll intro/outro task";
    res.status(500).json({ error: msg });
  }
});

export default router;
