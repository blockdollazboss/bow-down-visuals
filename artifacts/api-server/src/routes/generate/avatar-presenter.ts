import { randomUUID } from "crypto";
import { Request, Response, Router } from "express";
import { z } from "zod";
import { requireAuth } from "../../middlewares/require-auth";
import { chargeCredits } from "../../lib/credits";
import {
  avatarProviderConfigured,
  avatarProviderName,
  AVATAR_PLACEHOLDER_CATALOG,
  AvatarNotConfiguredError,
  getAvatarVideoStatus,
  submitAvatarVideo,
} from "../../lib/avatar-client";
import { attachJobMapTtl } from "../../lib/job-map-sweeper";
import { refreshSupabaseStorageUrl, uploadMediaToSupabaseStorage } from "../../lib/objectStorage";
import { logger } from "../../lib/logger";

const router = Router();

/**
 * Avatar presenter price — Visual Bucs per generation.
 * RULED by the owner (Oct 24 2026): 1,200 VB, Hedra Character-3 engine.
 * Charged on SUCCESS only (see the charge rail below).
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
  providerJobId: string | null;
  createdAt: number;
}

const jobs = new Map<string, AvatarJob>();
attachJobMapTtl(jobs); // 2026-10-12 OOM fix: TTL eviction (lib/job-map-sweeper)

export function getAvatarJob(id: string): AvatarJob | undefined {
  return jobs.get(id);
}

/** Test hook: clear the in-memory job store. */
export function __clearAvatarJobs(): void {
  jobs.clear();
}

/** Test hook: register a job directly (money-path tests drive processAvatarJob). */
export function __putAvatarJob(job: AvatarJob): void {
  jobs.set(job.id, job);
}

/* ── Charge rail ──────────────────────────────────────────────────────
   Charge on SUCCESS, exactly once:
   - POST checks the balance up front (402) so an under-funded request
     never reaches the provider.
   - Nothing is charged while the provider works.
   - When the provider completes AND the video is stored on our rails,
     chargeCredits runs once with the per-job idempotency key
     `avatar-presenter:<jobId>` — a replayed completion can never
     double-charge.
   - Provider failure, storage failure, or timeout → the job fails and
     the user is NEVER charged (no upfront charge exists to refund). */

/** Balance gate for POST: returns the 402 payload, or null when funded. */
export function avatarBalanceGate(balance: number): {
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
 * Background worker for one job: submit → poll → store → charge once.
 * Exported for tests; the route fires it without awaiting.
 */
export async function processAvatarJob(
  job: AvatarJob,
  input: {
    voiceId?: string;
    aspectRatio?: "16:9" | "9:16" | "1:1";
    imageUrl?: string;
    audioUrl?: string;
    prompt?: string;
  },
): Promise<void> {
  try {
    job.status = "processing";
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

    const deadline = Date.now() + pollTimeoutMs();
    for (;;) {
      const result = await getAvatarVideoStatus(submitted.providerJobId);
      if (result.status === "failed") {
        job.status = "failed";
        job.error = result.error || "Avatar generation failed at the provider.";
        return; // never charged
      }
      if (result.status === "done" && result.videoUrl) {
        job.outputUrl = await storeFinishedVideo(job, result.videoUrl);
        // The one and only charge on this rail — success only, exactly once.
        await chargeCredits(job.userId, AVATAR_PRESENTER_CREDIT_COST, {
          action: "AI Avatar Presenter",
        }, { idempotencyKey: `avatar-presenter:${job.id}` });
        job.creditsCharged = AVATAR_PRESENTER_CREDIT_COST;
        job.status = "done";
        return;
      }
      if (Date.now() > deadline) {
        job.status = "failed";
        job.error = "Avatar generation timed out at the provider — you were not charged.";
        return; // never charged
      }
      await sleep(pollIntervalMs());
    }
  } catch (err) {
    job.status = "failed";
    job.error = err instanceof Error ? err.message : "Avatar generation failed";
    if (job.creditsCharged > 0) {
      // Defensive: the charge is the last step before "done", so reaching
      // the catch with a charge recorded means the ledger write itself is
      // in an unknown state — log loudly for reconciliation.
      logger.error(
        { jobId: job.id, userId: job.userId, err },
        "[avatar-presenter] job failed AFTER charge — needs ledger reconciliation",
      );
    }
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
 * The 1,200 VB charge lands only when the video is finished and stored.
 */
router.post("/avatar-presenter", requireAuth, async (req: Request, res: Response) => {
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

  // Balance gate BEFORE any provider call (charge itself lands on success).
  const gate = avatarBalanceGate(req.userCredits ?? 0);
  if (gate) {
    res.status(402).json(gate);
    return;
  }

  const job: AvatarJob = {
    id: randomUUID(),
    userId: req.userId!,
    status: "queued",
    avatarId: parsed.data.avatarId,
    script: parsed.data.script,
    outputUrl: null,
    error: null,
    creditsCharged: 0,
    providerJobId: null,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);

  void processAvatarJob(job, {
    voiceId: parsed.data.voiceId,
    aspectRatio: parsed.data.aspectRatio,
    imageUrl: parsed.data.imageUrl,
    audioUrl: parsed.data.audioUrl,
    prompt: parsed.data.prompt,
  });

  res.status(202).json({ jobId: job.id, status: job.status, creditsCharged: 0 });
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
