import { randomUUID } from "crypto";
import { Request, Response, Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import {
  chargeCredits,
  refundCredits,
  OutOfCreditsError,
  LedgerWriteError,
  buildChargeIdempotencyKey,
  voidChargeIdempotencyKey,
} from "../../lib/credits";
import {
  findStoredGenerationResult,
  storeGenerationResult,
} from "../../lib/generation-stored-results";

/* CA-5 (EXPOSED-REPLAY): server-derived key for the conversion charge. */
const REPLAY_NOTE =
  "This conversion is already on its way for this request — this is the same job, not a new charge.";
import {
  singingVoiceConfigured,
  SINGING_VOICE_PLACEHOLDER_CATALOG,
  SingingVoiceNotConfiguredError,
  submitSingingConversion,
} from "../../lib/singing-voice-client";
import { attachJobMapTtl } from "../../lib/job-map-sweeper";

const router = Router();

/**
 * Price — Visual Bucs. RATIFIED as-is by owner ruling 2026-11-07
 * (the provider + key gate still applies before this goes live).
 */
const SINGING_VOICE_CREDIT_COST = 800; // RATIFIED — owner ruling 2026-11-07

const conversionSchema = z.object({
  voiceId: z.string().min(1).max(80),
  sourceAudioUrl: z.string().url().max(2048),
  strength: z.number().min(0).max(100).optional(),
  keepInstrumental: z.boolean().optional(),
});

type SingingJobStatus = "queued" | "processing" | "done" | "failed";

interface SingingJob {
  id: string;
  userId: string;
  status: SingingJobStatus;
  voiceId: string;
  sourceAudioUrl: string;
  outputUrl: string | null;
  error: string | null;
  creditsCharged: number;
  createdAt: number;
  /* CA-5: the charge's idempotency key + the exact 202 body answered at
     creation. The body is stored durably ONLY when the conversion
     completes — a failed conversion refunds + voids and must never
     leave a stored body behind for its key. */
  chargeKey?: string;
  chargeBody?: Record<string, unknown>;
}

const jobs = new Map<string, SingingJob>();
attachJobMapTtl(jobs); // 2026-10-12 OOM fix: TTL eviction (lib/job-map-sweeper)


/** Test hook: clear the in-memory job store. */

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

  /* CA-5: durable replay pre-check BEFORE funding — an identical re-ask
     returns the job already started instead of minting (and charging for)
     a second conversion. */
  const idempotencyKey = buildChargeIdempotencyKey("singing-voice", req.userId!, null, {
    voiceId: parsed.data.voiceId,
    sourceAudioUrl: parsed.data.sourceAudioUrl,
    strength: parsed.data.strength ?? null,
    keepInstrumental: parsed.data.keepInstrumental ?? null,
  });
  const durable = await findStoredGenerationResult("singing-voice", idempotencyKey, req.userId!);
  if (durable && typeof durable["jobId"] === "string") {
    res.json({ ...durable, replayed: true, replayNote: REPLAY_NOTE });
    return;
  }
  /* CA-5: a conversion for this exact request is already running (or
     finished in this process) — rejoin it instead of charging for a
     second one. Failed jobs are skipped: they refunded + voided, so a
     re-ask falls through and charges fresh. */
  const existingJob = [...jobs.values()].find(
    (j) => j.chargeKey === idempotencyKey && j.userId === req.userId! && j.status !== "failed",
  );
  if (existingJob?.chargeBody) {
    res.json({ ...existingJob.chargeBody, replayed: true, replayNote: REPLAY_NOTE });
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
    }, { idempotencyKey });
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

  const body = { jobId: "", status: "queued", creditsRemaining };
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
    chargeKey: idempotencyKey,
    chargeBody: body,
  };
  body.jobId = job.id;
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
      /* CA-5: persist the creation body ONLY now that the conversion
         actually landed — a replay from here on rejoins this job free.
         A failed conversion stores nothing, so its refunded + voided
         key re-asks fresh. */
      if (job.status === "done" && job.chargeKey && job.chargeBody) {
        await storeGenerationResult("singing-voice", job.chargeKey, job.userId, { ...job.chargeBody });
      }
    } catch (err) {
      job.status = "failed";
      job.error = err instanceof Error ? err.message : "Singing-voice conversion failed";
      /* CA-5: a landed refund also VOIDS the charge's idempotency key. */
      let refunded = true;
      try {
        await refundCredits(job.userId, job.creditsCharged, {
          action: "Singing-Voice Conversion — Refund (job failed)",
        });
      } catch {
        refunded = false;
        /* logged inside refundCredits */
      }
      if (refunded) {
        await voidChargeIdempotencyKey(idempotencyKey).catch(() => false);
      }
    }
  })();

  /* The body is stored durably by the conversion closure when the job
     lands — not here — so a failed conversion never leaves a stored
     body behind for its refunded + voided key. The body's status field
     keeps the creation value "queued" (byte-identical to the pre-CA-5
     answer); the closure has usually already flipped job.status to
     "processing" by the time this line runs. */
  res.status(202).json(body);
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
