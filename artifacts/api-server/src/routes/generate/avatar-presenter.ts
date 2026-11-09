import { createHash } from "crypto";
import { Request, Response, Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { generationLimiter } from "../../lib/rate-limit";
import {
  chargeCredits,
  refundCredits,
  voidChargeIdempotencyKey,
  buildChargeIdempotencyKey,
  OutOfCreditsError,
  LedgerWriteError,
} from "../../lib/credits";
import {
  avatarProviderConfigured,
  avatarProviderName,
  AVATAR_PLACEHOLDER_CATALOG,
  AvatarNotConfiguredError,
  getAvatarVideoStatus,
  submitAvatarVideo,
} from "../../lib/avatar-client";
import { attachJobMapTtl } from "../../lib/job-map-sweeper";
import {
  loadAvatarJob,
  persistAvatarJob,
  sweepExpiredAvatarJobs,
  syncAvatarJob,
  type AvatarPresenterSubmitInput,
} from "../../lib/avatar-presenter-jobs";
import { refreshSupabaseStorageUrl, uploadMediaToSupabaseStorage } from "../../lib/objectStorage";
import { logger } from "../../lib/logger";

const router = Router();

/**
 * Avatar presenter price — Visual Bucs per generation.
 * RULED by the owner (Oct 24 2026): 1,200 VB, Hedra Character-3 engine.
 * RESERVE-AT-SUBMIT (stack1400 ruling #43 Part B): charged in full at
 * submit; refunded in full on any failure (see the charge rail below).
 */
export const AVATAR_PRESENTER_CREDIT_COST = 1200;

const httpUrl = z
  .string()
  .max(2048)
  .refine((v) => /^https?:\/\//i.test(v), { message: "must be an http(s) URL" });

const presenterSchema = z.object({
  avatarId: z.string().min(1).max(80),
  script: z.string().max(4000).default(""),
  voiceId: z.string().max(120).optional(),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]).optional(),
  imageUrl: httpUrl.optional(),
  audioUrl: httpUrl.optional(),
  prompt: z.string().max(1000).optional(),
  idempotencyKey: z.string().max(128).optional(),
});

type AvatarJobStatus = "queued" | "processing" | "done" | "failed";

export interface AvatarJob {
  id: string;
  userId: string;
  status: AvatarJobStatus;
  avatarId: string;
  script: string;
  outputUrl: string | null;
  error: string | null;
  creditsCharged: number;
  providerJobId: string | null;
  createdAt: number;
  /** Reserve-at-submit bookkeeping: the charge's idempotency key and
   *  the exactly-once refund claim. Optional so test-constructed jobs
   *  (which were never charged at submit) stay valid. */
  chargeKey?: string;
  creditsRefunded?: boolean;
  /** The submit inputs the worker runs with, persisted with the job
   *  (migration 0334) so a worker resumed after a restart re-runs
   *  the exact ask the member paid for. */
  submitInput?: AvatarPresenterSubmitInput | null;
}

const jobs = new Map<string, AvatarJob>();
attachJobMapTtl(jobs); // 2026-10-12 OOM fix: TTL eviction (lib/job-map-sweeper)

/* ── Durable job storage (migration 0334) ─────────────────────────
   The Map above is the working cache; avatar_presenter_jobs is
   the record. Every job is persisted at creation and mirrored on
   every mutation (lib/avatar-presenter-jobs — all fail-open: a
   storage failure degrades to the pre-0334 in-process behavior
   and can never error the rail or double-charge). A lookup that
   misses the Map rehydrates from the table, so a job survives a
   server restart; a rehydrated job that never finished has its
   worker resumed (see findAvatarJob). The durable TTL sweep runs
   on the sweeper's own cadence over the SAME 2h clock — rows
   expire by query, not by a process forgetting them. */
const AVATAR_JOB_TTL_MS = 2 * 60 * 60 * 1000; // == job-map-sweeper default TTL
const durableSweepTimer = setInterval(() => {
  void sweepExpiredAvatarJobs(AVATAR_JOB_TTL_MS);
}, 5 * 60 * 1000); // == job-map-sweeper sweep cadence
durableSweepTimer.unref?.();

/** Job ids with a worker running in THIS process — the guard that
 *  keeps a rehydrated job from ever running two workers at once. */
const runningJobs = new Set<string>();

/** Fire a job's worker unless one is already running for it here. */
function fireAvatarJobWorker(job: AvatarJob, input: AvatarPresenterSubmitInput): void {
  if (runningJobs.has(job.id)) return;
  runningJobs.add(job.id);
  void processAvatarJob(job, input)
    .catch(() => {
      /* processAvatarJob settles the job itself; nothing escapes. */
    })
    .finally(() => {
      runningJobs.delete(job.id);
    });
}

/**
 * A job pulled back from the durable store in a non-terminal state
 * has no worker in this process (it died with the old one) —
 * resume it on the persisted submit inputs. The provider submit
 * is idempotent under the per-job key, and the refund claim is
 * persisted, so the resumed worker settles the job exactly once.
 */
function resumeAvatarJobIfOrphaned(job: AvatarJob): void {
  if (job.status !== "queued" && job.status !== "processing") return;
  fireAvatarJobWorker(job, job.submitInput ?? {});
}

/**
 * The one job lookup both routes use: Map first, durable store on
 * a miss. A rehydrated job re-enters the Map (the TTL clock
 * restarts — it was just touched) and, if it never finished, has
 * its worker resumed before it is answered from.
 */
async function findAvatarJob(id: string): Promise<AvatarJob | undefined> {
  const cached = jobs.get(id);
  if (cached) return cached;
  const stored = await loadAvatarJob(id);
  if (!stored) return undefined;
  const job: AvatarJob = {
    id: stored.id,
    userId: stored.userId,
    status: stored.status,
    avatarId: stored.avatarId,
    script: stored.script,
    outputUrl: stored.outputUrl,
    error: stored.error,
    creditsCharged: stored.creditsCharged,
    providerJobId: stored.providerJobId,
    createdAt: stored.createdAt,
    chargeKey: stored.chargeKey,
    creditsRefunded: stored.creditsRefunded,
    submitInput: stored.submitInput ?? undefined,
  };
  jobs.set(job.id, job);
  resumeAvatarJobIfOrphaned(job);
  return job;
}

/** Test hook: clear the in-memory job store. */
export function __resetAvatarJobs(): void {
  jobs.clear();
}

/** Test hook: register a job directly (money-path tests drive processAvatarJob). */
export function __putAvatarJob(job: AvatarJob): void {
  jobs.set(job.id, job);
  void persistAvatarJob(job);
}

/* ── Charge rail ──────────────────────────────────────────────────────
   RESERVE-AT-SUBMIT, exactly once (stack1400 ruling #43 Part B):
   - POST reserves the full 1,200 VB via chargeCredits (which re-reads
     the balance fresh) BEFORE any provider call, under the per-job
     idempotency key `avatar-presenter:<jobId>` — an under-funded
     request is refused 402 and never reaches the provider, and a
     replayed submit charge can never double-charge.
   - The 503 provider-unconfigured gate stays BEFORE the charge: an
     unconfigured feature never charges, ever.
   - Success (provider done AND the video stored on our rails) keeps
     the reserve — no second charge ever lands.
   - Provider failure, no-output, storage/save failure, or timeout →
     refundAvatarJobCharge returns the exact reserved amount exactly
     once (the job's creditsRefunded flag is claimed synchronously
     before the refund awaits, so a replayed completion cannot
     double-refund) and voids the charge's idempotency key.
   - DURABLE JOBS (migration 0334): every job is also persisted to
     avatar_presenter_jobs and mirrored on each mutation, so a
     server restart between submit and completion no longer loses
     the job — a later lookup rehydrates it, resumes its worker if
     it never finished, and the refund path below works from the
     persisted refund claim exactly as it does in-process. */

/** Refund a job's reserve exactly once. No-op for never-charged jobs. */
async function refundAvatarJobCharge(job: AvatarJob): Promise<void> {
  const amount = job.creditsCharged ?? 0;
  if (amount <= 0 || job.creditsRefunded) return;
  job.creditsRefunded = true; // claim synchronously — exactly once
  void syncAvatarJob(job); // the claim is durable before the refund moves
  const key = job.chargeKey ?? `avatar-presenter:${job.id}`;
  try {
    await refundCredits(job.userId, amount, {
      action: "AI Avatar Presenter — Refund",
    });
    await voidChargeIdempotencyKey(key);
  } catch (refundErr) {
    logger.error(
      { jobId: job.id, userId: job.userId, err: refundErr },
      "[avatar-presenter] CRITICAL: refund failed after job failure — manual reconciliation required",
    );
  }
}

/** Balance gate for POST: returns the 402 payload, or null when funded. */
function avatarBalanceGate(balance: number): {
  error: string;
  message: string;
  creditsNeeded: number;
  creditsRemaining: number;
} | null {
  if (balance >= AVATAR_PRESENTER_CREDIT_COST) return null;
  return {
    error: "OUT_OF_CREDITS",
    message: `You need ${AVATAR_PRESENTER_CREDIT_COST} Visual Bucs for an AI avatar presenter.`,
    creditsNeeded: AVATAR_PRESENTER_CREDIT_COST,
    creditsRemaining: balance,
  };
}

function pollIntervalMs(): number {
  const n = Number(process.env["AVATAR_POLL_INTERVAL_MS"]);
  return Number.isFinite(n) && n >= 0 ? n : 5_000;
}

function pollTimeoutMs(): number {
  const n = Number(process.env["AVATAR_POLL_TIMEOUT_MS"]);
  return Number.isFinite(n) && n > 0 ? n : 15 * 60_000;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Download the finished provider video into the generated-clips rails. */
async function storeFinishedVideo(job: AvatarJob, providerVideoUrl: string): Promise<string> {
  const res = await fetch(providerVideoUrl, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) {
    throw new Error(`Could not download the finished avatar video (HTTP ${res.status}).`);
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error("The finished avatar video was empty.");
  }
  const ref = await uploadMediaToSupabaseStorage(
    `${job.userId}/avatar-presenter/${job.id}.mp4`,
    bytes,
    "video/mp4",
  );
  // Playable URL for immediate viewing; the storage ref is the fallback.
  const playable = await refreshSupabaseStorageUrl(ref).catch(() => null);
  return playable || ref;
}

/**
 * Background worker for one job: submit → poll → store. The charge was
 * already reserved at submit (POST); this worker never charges — it
 * keeps the reserve on success and refunds it exactly once on any
 * failure. Exported for tests; the route fires it without awaiting.
 */
export async function processAvatarJob(
  job: AvatarJob,
  input: AvatarPresenterSubmitInput,
): Promise<void> {
  try {
    job.status = "processing";
    void syncAvatarJob(job); // durable: the transition survives a restart
    const submitted = await submitAvatarVideo({
      avatarId: job.avatarId,
      script: job.script,
      voiceId: input.voiceId,
      aspectRatio: input.aspectRatio,
      userId: job.userId,
      imageUrl: input.imageUrl,
      audioUrl: input.audioUrl,
      prompt: input.prompt,
      idempotencyKey: `avatar-presenter:${job.id}`,
    });
    job.providerJobId = submitted.providerJobId;
    void syncAvatarJob(job); // durable: the provider job id survives a restart

    const deadline = Date.now() + pollTimeoutMs();
    for (;;) {
      const result = await getAvatarVideoStatus(submitted.providerJobId);
      if (result.status === "failed") {
        job.status = "failed";
        job.error = result.error || "Avatar generation failed at the provider.";
        await refundAvatarJobCharge(job);
        return;
      }
      if (result.status === "done" && result.videoUrl) {
        // Success = provider done AND stored on our rails: keep the
        // reserve reserved at submit. A store failure throws into the
        // catch below, which refunds.
        job.outputUrl = await storeFinishedVideo(job, result.videoUrl);
        job.status = "done";
        return;
      }
      if (result.status === "done") {
        // Provider claims done but delivered no video — no-output.
        job.status = "failed";
        job.error = "Avatar generation finished without a video — your Visual Bucs were refunded.";
        await refundAvatarJobCharge(job);
        return;
      }
      if (Date.now() > deadline) {
        job.status = "failed";
        job.error = "Avatar generation timed out at the provider — your Visual Bucs were refunded.";
        await refundAvatarJobCharge(job);
        return;
      }
      await sleep(pollIntervalMs());
    }
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : "Avatar generation failed";
    await refundAvatarJobCharge(job);
  } finally {
    // Durable: the terminal state (status, outputUrl / error, and —
    // via the refund claim sync — creditsRefunded) is the record a
    // post-restart lookup answers from.
    void syncAvatarJob(job);
  }
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
    pricePlaceholder: false,
  });
});

/**
 * POST /api/avatar-presenter
 *
 * Talking-head presenter generation (Hedra Character-3). GATED: returns
 * 503 AVATAR_PROVIDER_NOT_CONFIGURED when no provider key exists — the UI
 * shows a clear disabled message instead of charging or failing silently.
 * The 1,200 VB is RESERVED at submit (before any provider call) and
 * refunded in full if the job fails for any reason.
 */
router.post("/avatar-presenter", requireAuth, generationLimiter, async (req: Request, res: Response) => {
  if (!avatarProviderConfigured()) {
    const err = new AvatarNotConfiguredError();
    res.status(503).json({ error: err.code, message: err.message });
    return;
  }

  const parsed = presenterSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_BODY", message: "avatarId is required; image/audio URLs must be http(s)." });
    return;
  }
  if (!parsed.data.script.trim() && !parsed.data.audioUrl) {
    res.status(400).json({
      error: "INVALID_BODY",
      message: "Give the presenter a script to speak, or supply a driving audio file.",
    });
    return;
  }

  /* CA-KEY: the job id derives from the request's INTENT, never from
     a per-request random value. The old code minted a fresh randomUUID
     per POST, so every retry was a brand-new charge by construction.
     Now the server builds the charge key from the member + payload
     (a sane client key, when sent, is honored instead) and the job id
     is that key's hash — twin POSTs of the same ask land on the SAME
     job: one reserve, one provider submit. C-36 consequence, said out
     loud in the replay response: an identical ask returns the existing
     job instead of buying a second video while the job is retained. */
  const chargeIdempotencyKey = buildChargeIdempotencyKey(
    "avatar-presenter", req.userId!, parsed.data.idempotencyKey,
    {
      avatarId: parsed.data.avatarId,
      script: parsed.data.script,
      voiceId: parsed.data.voiceId ?? null,
      aspectRatio: parsed.data.aspectRatio ?? null,
      imageUrl: parsed.data.imageUrl ?? null,
      audioUrl: parsed.data.audioUrl ?? null,
      prompt: parsed.data.prompt ?? null,
    },
  );
  const jobId = createHash("sha256").update(chargeIdempotencyKey).digest("hex").slice(0, 32);
  const chargeKey = `avatar-presenter:${jobId}`;

  /* Durable twin check (0334): the Map first, the table on a miss —
     after a restart the twin lands on the persisted job exactly as
     it would have in-process (and a still-running one resumes). */
  const existingJob = await findAvatarJob(jobId);
  if (existingJob && existingJob.userId === req.userId) {
    res.status(202).json({
      jobId: existingJob.id,
      status: existingJob.status,
      creditsCharged: existingJob.creditsCharged,
      replayed: true,
      replayNote:
        "This presenter is already being made for this exact request — tweak the script or avatar for a fresh one.",
    });
    return;
  }

  try {
    await chargeCredits(req.userId!, AVATAR_PRESENTER_CREDIT_COST, {
      action: "AI Avatar Presenter",
    }, { idempotencyKey: chargeKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      const gate = avatarBalanceGate(req.userCredits ?? 0) ?? {
        error: "OUT_OF_CREDITS",
        message: `You need ${AVATAR_PRESENTER_CREDIT_COST} Visual Bucs for an AI avatar presenter.`,
        creditsNeeded: AVATAR_PRESENTER_CREDIT_COST,
        creditsRemaining: req.userCredits ?? 0,
      };
      res.status(402).json(gate);
      return;
    }
    if (err instanceof LedgerWriteError) {
      // chargeCredits rolled the deduction itself back — no standing
      // charge, no provider call.
      res.status(500).json({ error: "CHARGE_FAILED", message: "Charging failed — no Visual Bucs were taken and nothing was generated." });
      return;
    }
    throw err;
  }

  const submitInput: AvatarPresenterSubmitInput = {
    voiceId: parsed.data.voiceId,
    aspectRatio: parsed.data.aspectRatio,
    imageUrl: parsed.data.imageUrl,
    audioUrl: parsed.data.audioUrl,
    prompt: parsed.data.prompt,
  };
  const job: AvatarJob = {
    id: jobId,
    userId: req.userId!,
    status: "queued",
    avatarId: parsed.data.avatarId,
    script: parsed.data.script,
    outputUrl: null,
    error: null,
    creditsCharged: AVATAR_PRESENTER_CREDIT_COST,
    providerJobId: null,
    createdAt: Date.now(),
    chargeKey,
    creditsRefunded: false,
    submitInput,
  };
  jobs.set(job.id, job);
  /* Durable (0334): the row lands before the worker fires, so the
     job exists on the record from its first moment. Awaited — and
     fail-open: a storage failure logs and the job still runs
     in-process exactly as it did before this table existed. */
  await persistAvatarJob(job);

  fireAvatarJobWorker(job, submitInput);

  res.status(202).json({ jobId: job.id, status: job.status, creditsCharged: job.creditsCharged });
});

/**
 * GET /api/avatar-presenter/:jobId — poll a presenter job.
 */
router.get("/avatar-presenter/:jobId", requireAuth, async (req: Request, res: Response) => {
  const job = await findAvatarJob(String(req.params.jobId));
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
