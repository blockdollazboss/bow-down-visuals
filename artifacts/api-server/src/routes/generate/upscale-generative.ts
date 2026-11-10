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
import { findStoredGenerationResult } from "../../lib/generation-stored-results";
import { deterministicJobId, storeCompletedJobResult } from "./ca6-replay-guard";
import {
  generativeUpscaleConfigured,
  GenerativeUpscaleNotConfiguredError,
  submitGenerativeUpscale,
  type GenerativeUpscaleTarget,
} from "../../lib/generative-upscale-client";
import { attachJobMapTtl } from "../../lib/job-map-sweeper";
import { DurableJobStore } from "../../lib/durable-job-store";

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

type GenerativeUpscaleJobStatus = "queued" | "processing" | "done" | "failed";

interface GenerativeUpscaleJob {
  id: string;
  userId: string;
  status: GenerativeUpscaleJobStatus;
  target: GenerativeUpscaleTarget;
  sourceVideoUrl: string;
  outputUrl: string | null;
  error: string | null;
  creditsCharged: number;
  createdAt: number;
  /* CA-6: the charge's idempotency key + the create-time balance, so
     the async runner can void on refund and the create body can be
     stored/replayed verbatim. */
  idempotencyKey?: string;
  creditsRemaining?: number;
  /** The creativity setting, carried on the job (0335) so a worker
   *  resumed after a restart submits the exact ask. */
  creativity?: number;
  /** Durable jobs (0335): the exactly-once refund claim — claimed in
   *  the persisted row before any refund moves. */
  creditsRefunded?: boolean;
}

const jobs = new Map<string, GenerativeUpscaleJob>();
attachJobMapTtl(jobs); // 2026-10-12 OOM fix: TTL eviction (lib/job-map-sweeper)

/* ── Durable job storage (migration 0335) ─────────────────────────
   The Map above is the working cache; generation_jobs is the
   record. Jobs persist at creation, mirror on settle, and a lookup
   that misses the Map rehydrates from the table — a job survives
   a server restart. This worker needs only the job record (the
   source video URL and settings ride on it), so a rehydrated
   in-flight job simply resumes. Fail-open throughout
   (lib/generation-jobs). */
const jobStore = new DurableJobStore<GenerativeUpscaleJob>(jobs, {
  rail: "upscale-generative",
  statusOf: (j) => j.status,
  isTerminalStatus: (s) => s === "done" || s === "failed",
  setFailed: (j, error) => {
    j.status = "failed";
    j.error = error;
  },
  amountOf: (j) => j.creditsCharged,
  chargeKeyOf: (j) => j.idempotencyKey ?? null,
  refundAction: "Generative AI Upscale — Refund (job failed)",
  settleError: "Generative upscale was interrupted by a server restart — your Visual Bucs were refunded.",
  resume: async (job) => {
    void runGenerativeUpscaleJob(job);
    return true;
  },
});

/**
 * The provider worker: submit → settle. The charge was already
 * reserved at submit (POST); this worker never charges — it keeps
 * the reserve on success and refunds it exactly once on failure.
 * Extracted from the POST closure (0335) so a worker resumed after
 * a restart runs the identical code.
 */
async function runGenerativeUpscaleJob(job: GenerativeUpscaleJob): Promise<void> {
  try {
    job.status = "processing";
    const result = await submitGenerativeUpscale({
      sourceVideoUrl: job.sourceVideoUrl,
      target: job.target,
      creativity: job.creativity,
      userId: job.userId,
    });
    job.status = result.status === "done" ? "done" : "processing";
    job.outputUrl = result.videoUrl ?? null;
    /* CA-6: the job landed — persist the create body durably so a
       replayed create after a restart is served from the store,
       never re-charged or re-submitted. Fail-open. */
    if (job.idempotencyKey) {
      await storeCompletedJobResult("upscale-generative", job.idempotencyKey, job.userId, {
        jobId: job.id,
        status: "queued",
        creditsRemaining: job.creditsRemaining,
      });
    }
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : "Generative upscale failed";
    /* Durable (0335): claim the refund BEFORE it moves — a job whose
       refund already landed never refunds twice. */
    const claimed = await jobStore.claimRefund(job);
    if (claimed) {
      let refunded = true;
      try {
        await refundCredits(job.userId, job.creditsCharged, {
          action: "Generative AI Upscale — Refund (job failed)",
        });
      } catch {
        refunded = false;
        /* logged inside refundCredits */
      }
      /* CA-6: a landed refund voids the key, so the retry re-charges. */
      if (refunded && job.idempotencyKey) {
        await voidChargeIdempotencyKey(job.idempotencyKey).catch(() => false);
        await storeCompletedJobResult("upscale-generative", job.idempotencyKey, job.userId, null);
      }
    }
  } finally {
    void jobStore.sync(job); // durable: the settled state is the post-restart record
  }
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
 * NOTE: the live provider submit is not implemented yet (no provider
 * key configured). The price is NOT the blocker — 1,500 VB is official
 * (ruling A-05 above). When unconfigured, no job is created and no
 * credits are charged.
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

  /* CA-6 replay protection (charge audit B6, Pattern B): the intent
     is the source video + target/creativity ask. The job id is
     DETERMINISTIC from the server-derived charge key, so a replayed
     create finds the existing job instead of minting (and charging
     for) a second one; a durable stored result covers the
     after-restart case once the job has succeeded. A failed job's
     refund voids the key (in the runner below), so a genuine retry
     falls through and re-charges. Fresh responses are byte-identical. */
  const idempotencyKey = buildChargeIdempotencyKey("upscale-generative", req.userId!, null, {
    sourceVideoUrl: parsed.data.sourceVideoUrl,
    target,
    creativity: parsed.data.creativity ?? null,
  });
  const jobId = deterministicJobId(idempotencyKey);
  const existing = await jobStore.find(jobId); // Map first, durable store on a miss (0335)
  if (existing && existing.userId === req.userId! && existing.status !== "failed") {
    res.status(202).json({
      jobId: existing.id,
      status: existing.status,
      creditsRemaining: existing.creditsRemaining,
      replayed: true,
    });
    return;
  }
  const storedCreate = await findStoredGenerationResult("upscale-generative", idempotencyKey, req.userId!);
  if (storedCreate) {
    res.status(202).json({ ...storedCreate, replayed: true });
    return;
  }

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

  /* A concurrent twin may have created the job while this charge was
     in flight — the ledger deduped the charge, so answer with the
     twin's job instead of starting a second provider run. */
  const twin = await jobStore.find(jobId); // Map first, durable store on a miss (0335)
  if (twin && twin.userId === req.userId! && twin.status !== "failed") {
    res.status(202).json({
      jobId: twin.id,
      status: twin.status,
      creditsRemaining: twin.creditsRemaining,
      replayed: true,
    });
    return;
  }

  const job: GenerativeUpscaleJob = {
    id: jobId,
    userId: req.userId!,
    status: "queued",
    target,
    sourceVideoUrl: parsed.data.sourceVideoUrl,
    outputUrl: null,
    error: null,
    creditsCharged: GENERATIVE_UPSCALE_CREDIT_COST,
    createdAt: Date.now(),
    idempotencyKey,
    creditsRemaining,
    creativity: parsed.data.creativity,
    creditsRefunded: false,
  };
  jobs.set(job.id, job);
  await jobStore.persist(job); // durable (0335): the row lands before the worker fires

  // Fire-and-forget: the provider submit is stubbed until a provider is wired.
  void runGenerativeUpscaleJob(job);

  res.status(202).json({ jobId: job.id, status: job.status, creditsRemaining });
});

/**
 * GET /api/ai-upscale/:jobId — poll a generative upscale job.
 *
 * NOTE: this route must be registered before any conflicting
 * /api/upscale/:jobId pattern treats "generative" as a job id.
 */
router.get("/ai-upscale/:jobId", requireAuth, async (req: Request, res: Response) => {
  const job = await jobStore.find(String(req.params.jobId)); // Map first, durable store on a miss (0335)
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
