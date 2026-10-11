import { randomUUID } from "crypto";
import { Request, Response, Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";
import {
  avatarProviderConfigured,
  avatarProviderName,
  AVATAR_PLACEHOLDER_CATALOG,
  AvatarNotConfiguredError,
  submitAvatarVideo,
} from "../../lib/avatar-client";

const router = Router();

/**
 * PLACEHOLDER price — Visual Bucs. NOT final: the user must approve the
 * real price (and the HeyGen/Hedra provider + key) before this goes live.
 */
export const AVATAR_PRESENTER_CREDIT_COST = 1200; // PLACEHOLDER — needs user price approval

const presenterSchema = z.object({
  avatarId: z.string().min(1).max(80),
  script: z.string().min(1).max(4000),
  voiceId: z.string().max(120).optional(),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).optional(),
});

export type AvatarJobStatus = "queued" | "processing" | "done" | "failed";

export interface AvatarJob {
  id: string;
  userId: string;
  status: AvatarJobStatus;
  avatarId: string;
  script: string;
  outputUrl: string | null;
  error: string | null;
  creditsCharged: number;
  createdAt: number;
}

const jobs = new Map<string, AvatarJob>();

export function getAvatarJob(id: string): AvatarJob | undefined {
  return jobs.get(id);
}

/** Test hook: clear the in-memory job store. */
export function __clearAvatarJobs(): void {
  jobs.clear();
}

/* ── Routes ─────────────────────────────────────────────────────────── */

/**
 * GET /api/avatar-presenter/status
 * Public gate check for the UI: is a provider key configured?
 */
router.get("/avatar-presenter/status", requireAuth, async (_req: Request, res: Response) => {
  res.json({
    configured: avatarProviderConfigured(),
    provider: avatarProviderName(),
    catalog: AVATAR_PLACEHOLDER_CATALOG,
    creditCost: AVATAR_PRESENTER_CREDIT_COST,
    pricePlaceholder: true,
  });
});

/**
 * POST /api/avatar-presenter
 *
 * Talking-head presenter generation (HeyGen/Hedra-shaped). GATED: returns
 * 503 AVATAR_PROVIDER_NOT_CONFIGURED when no provider key exists — the UI
 * shows a clear disabled message instead of charging or failing silently.
 *
 * NOTE: the live provider submit is not implemented yet (no key, no approved
 * pricing). When unconfigured, no job is created and no credits are charged.
 */
router.post("/avatar-presenter", requireAuth, async (req: Request, res: Response) => {
  if (!avatarProviderConfigured()) {
    const err = new AvatarNotConfiguredError();
    res.status(503).json({ error: err.code, message: err.message });
    return;
  }

  const parsed = presenterSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_BODY", message: "avatarId and script are required." });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < AVATAR_PRESENTER_CREDIT_COST) {
    res.status(402).json({
      error: "OUT_OF_CREDITS",
      message: `You need ${AVATAR_PRESENTER_CREDIT_COST} Visual Bucs for an AI avatar presenter.`,
      creditsNeeded: AVATAR_PRESENTER_CREDIT_COST,
      creditsRemaining: balance,
    });
    return;
  }

  let creditsRemaining: number | undefined;
  try {
    creditsRemaining = await chargeCredits(req.userId!, AVATAR_PRESENTER_CREDIT_COST, {
      action: "AI Avatar Presenter",
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

  const job: AvatarJob = {
    id: randomUUID(),
    userId: req.userId!,
    status: "queued",
    avatarId: parsed.data.avatarId,
    script: parsed.data.script,
    outputUrl: null,
    error: null,
    creditsCharged: AVATAR_PRESENTER_CREDIT_COST,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);

  // Fire-and-forget: the provider submit is stubbed until approved.
  void (async () => {
    try {
      job.status = "processing";
      const result = await submitAvatarVideo({
        avatarId: job.avatarId,
        script: job.script,
        voiceId: parsed.data.voiceId,
        aspectRatio: parsed.data.aspectRatio,
        userId: job.userId,
      });
      job.status = result.status === "done" ? "done" : "processing";
      job.outputUrl = result.videoUrl ?? null;
    } catch (err) {
      job.status = "failed";
      job.error = err instanceof Error ? err.message : "Avatar generation failed";
      try {
        await refundCredits(job.userId, job.creditsCharged, {
          action: "AI Avatar Presenter — Refund (job failed)",
        });
      } catch {
        /* logged inside refundCredits */
      }
    }
  })();

  res.status(202).json({ jobId: job.id, status: job.status, creditsRemaining });
});

/**
 * GET /api/avatar-presenter/:jobId — poll a presenter job.
 */
router.get("/avatar-presenter/:jobId", requireAuth, async (req: Request, res: Response) => {
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
