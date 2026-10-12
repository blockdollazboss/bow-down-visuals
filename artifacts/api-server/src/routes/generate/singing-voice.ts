import { randomUUID } from "crypto";
import { Request, Response, Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError, LedgerWriteError } from "../../lib/credits";
import {
  singingVoiceConfigured,
  SINGING_VOICE_PLACEHOLDER_CATALOG,
  SingingVoiceNotConfiguredError,
  submitSingingConversion,
} from "../../lib/singing-voice-client";
import { attachJobMapTtl } from "../../lib/job-map-sweeper";

const router = Router();

/**
 * PLACEHOLDER price — Visual Bucs. NOT final: the user must approve the
 * real price (and the provider + key) before this goes live.
 */
export const SINGING_VOICE_CREDIT_COST = 800; // PLACEHOLDER — needs user price approval

const conversionSchema = z.object({
  voiceId: z.string().min(1).max(80),
  sourceAudioUrl: z.string().url().max(2048),
  strength: z.number().min(0).max(100).optional(),
  keepInstrumental: z.boolean().optional(),
});

export type SingingJobStatus = "queued" | "processing" | "done" | "failed";

export interface SingingJob {
  id: string;
  userId: string;
  status: SingingJobStatus;
  voiceId: string;
  sourceAudioUrl: string;
  outputUrl: string | null;
  error: string | null;
  creditsCharged: number;
  createdAt: number;
}

const jobs = new Map<string, SingingJob>();
attachJobMapTtl(jobs); // 2026-10-12 OOM fix: TTL eviction (lib/job-map-sweeper)

export function getSingingJob(id: string): SingingJob | undefined {
  return jobs.get(id);
}

/** Test hook: clear the in-memory job store. */
export function __clearSingingJobs(): void {
  jobs.clear();
}

/* ── Routes ─────────────────────────────────────────────────────────── */

/**
 * GET /api/singing-voice/status
 * Public gate check for the UI: is a provider key configured?
 */
router.get("/singing-voice/status", requireAuth, async (_req: Request, res: Response) => {
  res.json({
    configured: singingVoiceConfigured(),
    creditCost: SINGING_VOICE_CREDIT_COST,
    pricePlaceholder: true,
  });
});

/**
 * GET /api/singing-voice/voices
 * Placeholder singing-voice catalog for the picker. providerVoiceId is null
 * until the catalog syncs from the real provider.
 */
router.get("/singing-voice/voices", requireAuth, async (_req: Request, res: Response) => {
  res.json({
    voices: SINGING_VOICE_PLACEHOLDER_CATALOG,
    configured: singingVoiceConfigured(),
  });
});

/**
 * POST /api/singing-voice
 *
 * Singing-voice conversion (Jammable-shaped). GATED: returns 503
 * SINGING_VOICE_NOT_CONFIGURED when no provider key exists — the UI shows
 * a clear disabled message instead of charging or failing silently.
 *
 * NOTE: the live provider conversion is not implemented yet (no key, no
 * approved pricing). When unconfigured, no job is created and no credits
 * are charged.
 */
router.post("/singing-voice", requireAuth, async (req: Request, res: Response) => {
  if (!singingVoiceConfigured()) {
    const err = new SingingVoiceNotConfiguredError();
    res.status(503).json({ error: err.code, message: err.message });
    return;
  }

  const parsed = conversionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_BODY", message: "voiceId and sourceAudioUrl are required." });
    return;
  }

  const balance = req.userCredits ?? 0;
  if (balance < SINGING_VOICE_CREDIT_COST) {
    res.status(402).json({
      error: "OUT_OF_CREDITS",
      message: `You need ${SINGING_VOICE_CREDIT_COST} Visual Bucs for singing-voice conversion.`,
      creditsNeeded: SINGING_VOICE_CREDIT_COST,
      creditsRemaining: balance,
    });
    return;
  }

  let creditsRemaining: number | undefined;
  try {
    creditsRemaining = await chargeCredits(req.userId!, SINGING_VOICE_CREDIT_COST, {
      action: "Singing-Voice Conversion",
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

  const job: SingingJob = {
    id: randomUUID(),
    userId: req.userId!,
    status: "queued",
    voiceId: parsed.data.voiceId,
    sourceAudioUrl: parsed.data.sourceAudioUrl,
    outputUrl: null,
    error: null,
    creditsCharged: SINGING_VOICE_CREDIT_COST,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);

  // Fire-and-forget: the provider conversion is stubbed until approved.
  void (async () => {
    try {
      job.status = "processing";
      const result = await submitSingingConversion({
        voiceId: job.voiceId,
        sourceAudioUrl: job.sourceAudioUrl,
        strength: parsed.data.strength,
        keepInstrumental: parsed.data.keepInstrumental,
        userId: job.userId,
      });
      job.status = result.status === "done" ? "done" : "processing";
      job.outputUrl = result.audioUrl ?? null;
    } catch (err) {
      job.status = "failed";
      job.error = err instanceof Error ? err.message : "Singing-voice conversion failed";
      try {
        await refundCredits(job.userId, job.creditsCharged, {
          action: "Singing-Voice Conversion — Refund (job failed)",
        });
      } catch {
        /* logged inside refundCredits */
      }
    }
  })();

  res.status(202).json({ jobId: job.id, status: job.status, creditsRemaining });
});

/**
 * GET /api/singing-voice/jobs/:jobId — poll a conversion job.
 */
router.get("/singing-voice/jobs/:jobId", requireAuth, async (req: Request, res: Response) => {
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
