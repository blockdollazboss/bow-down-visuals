import { randomUUID } from "crypto";
import { Request, Response, Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";
import {
  generativeUpscaleConfigured,
  GenerativeUpscaleNotConfiguredError,
  submitGenerativeUpscale,
  type GenerativeUpscaleTarget,
} from "../../lib/generative-upscale-client";
import { attachJobMapTtl } from "../../lib/job-map-sweeper";

const router = Router();

/**
 * Official price — 1,500 Visual Bucs (owner-approved 2026-10-24, Stack-100
 * #3 ruling A-05: the long-standing 1,500 VB charge is the real price).
 *
 * This is a SEPARATE product from the classic ffmpeg upscaler
 * (POST /api/upscale, 300 VB). Generative AI upscaling reconstructs detail
 * with a model, so it is priced as a premium tier — the two must never be
 * merged or priced the same.
 */
export const GENERATIVE_UPSCALE_CREDIT_COST = 1500;

const generativeUpscaleSchema = z.object({
  sourceVideoUrl: z.string().url().max(2048),
  target: z.enum(["1080p", "4k"]).optional(),
  creativity: z.number().min(0).max(100).optional(),
});

export type GenerativeUpscaleJobStatus = "queued" | "processing" | "done" | "failed";

export interface GenerativeUpscaleJob {
  id: string;
  userId: string;
  status: GenerativeUpscaleJobStatus;
  target: GenerativeUpscaleTarget;
  sourceVideoUrl: string;
  outputUrl: string | null;
  error: string | null;
  creditsCharged: number;
  createdAt: number;
}

const jobs = new Map<string, GenerativeUpscaleJob>();
attachJobMapTtl(jobs); // 2026-10-12 OOM fix: TTL eviction (lib/job-map-sweeper)

export function getGenerativeUpscaleJob(id: string): GenerativeUpscaleJob | undefined {
  return jobs.get(id);
}

/** Test hook: clear the in-memory job store. */
export function __clearGenerativeUpscaleJobs(): void {
  jobs.clear();
}

/* ── Routes ─────────────────────────────────────────────────────────── */

/**
 * GET /api/ai-upscale/status
 * Public gate check for the UI: is a provider key configured?
 */
router.get("/ai-upscale/status", requireAuth, async (_req: Request, res: Response) => {
  res.json({
    configured: generativeUpscaleConfigured(),
    creditCost: GENERATIVE_UPSCALE_CREDIT_COST,
    pricePlaceholder: true,
    classicCost: 300, // the ffmpeg upscaler stays cheaper — always
  });
});

/**
 * POST /api/ai-upscale
 *
 * Premium GENERATIVE video upscale (Topaz-shaped): the model reconstructs
 * plausible detail — different product from POST /api/upscale (ffmpeg
 * Lanczos resampling, 300 VB). GATED: returns 503
 * GENERATIVE_UPSCALE_NOT_CONFIGURED when no provider key exists — the UI
 * shows a clear disabled message instead of charging or failing silently.
 *
 * NOTE: the live provider submit is not implemented yet (no key, no
 * approved pricing). When unconfigured, no job is created and no credits
 * are charged.
 */
router.post("/ai-upscale", requireAuth, async (req: Request, res: Response) => {
  if (!generativeUpscaleConfigured()) {
    const err = new GenerativeUpscaleNotConfiguredError();
    res.status(503).json({ error: err.code, message: err.message });
    return;
  }

  const parsed = generativeUpscaleSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_BODY", message: "sourceVideoUrl is required." });
    return;
  }
  const target: GenerativeUpscaleTarget = parsed.data.target ?? "1080p";

  const balance = req.userCredits ?? 0;
  if (balance < GENERATIVE_UPSCALE_CREDIT_COST) {
    res.status(402).json({
      error: "OUT_OF_CREDITS",
      message: `You need ${GENERATIVE_UPSCALE_CREDIT_COST} Visual Bucs for generative AI upscaling.`,
      creditsNeeded: GENERATIVE_UPSCALE_CREDIT_COST,
      creditsRemaining: balance,
    });
    return;
  }

  let creditsRemaining: number | undefined;
  try {
    creditsRemaining = await chargeCredits(req.userId!, GENERATIVE_UPSCALE_CREDIT_COST, {
      action: "Generative AI Upscale",
    });
  } catch (e) {
    if (e instanceof OutOfCreditsError) {
      res.status(402).json({ error: "OUT_OF_CREDITS", message: e.message });
      return;
    }
    if (e instanceof LedgerWriteError) {
      res.status(500).json({ error: "LEDGER_ERROR", message: e.message });
      return;
    }
    throw e;
  }

  const job: GenerativeUpscaleJob = {
    id: randomUUID(),
    userId: req.userId!,
    status: "queued",
    target,
    sourceVideoUrl: parsed.data.sourceVideoUrl,
    outputUrl: null,
    error: null,
    creditsCharged: GENERATIVE_UPSCALE_CREDIT_COST,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);

  // Fire-and-forget: the provider submit is stubbed until approved.
  void (async () => {
    try {
      job.status = "processing";
      const result = await submitGenerativeUpscale({
        sourceVideoUrl: job.sourceVideoUrl,
        target: job.target,
        creativity: parsed.data.creativity,
        userId: job.userId,
      });
      job.status = result.status === "done" ? "done" : "processing";
      job.outputUrl = result.videoUrl ?? null;
    } catch (err) {
      job.status = "failed";
      job.error = err instanceof Error ? err.message : "Generative upscale failed";
      try {
        await refundCredits(job.userId, job.creditsCharged, {
          action: "Generative AI Upscale — Refund (job failed)",
        });
      } catch {
        /* logged inside refundCredits */
      }
    }
  })();

  res.status(202).json({ jobId: job.id, status: job.status, creditsRemaining });
});

/**
 * GET /api/ai-upscale/:jobId — poll a generative upscale job.
 *
 * NOTE: this route must be registered before any conflicting
 * /api/upscale/:jobId pattern treats "generative" as a job id.
 */
router.get("/ai-upscale/:jobId", requireAuth, async (req: Request, res: Response) => {
  const job = jobs.get(String(req.params.jobId));
  if (!job || job.userId !== req.userId) {
    res.status(404).json({ error: "JOB_NOT_FOUND", message: "Job not found." });
    return;
  }
  res.json({
    jobId: job.id,
    status: job.status,
    outputUrl: job.outputUrl,
    error: job.error,
    creditsCharged: job.creditsCharged,
  });
});

export default router;
