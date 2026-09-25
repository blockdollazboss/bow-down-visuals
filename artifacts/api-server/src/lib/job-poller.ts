import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { publishDueScheduledPosts } from "./scheduler-jobs";
import {
  claimQueuedJobs,
  completeLipSyncJob,
  deferSubmitJob,
  failLipSyncJob,
  getJobsDueForPoll,
  markHistoryRecorded,
  markJobSubmitted,
  recordJobPoll,
  recoverInterruptedLipSyncJobs,
  requeueSubmitJob,
  type LipSyncJob,
} from "./lip-sync-jobs";
import {
  createJobNotification,
  notifyTerminalExportJobs,
} from "./job-notifications";
import {
  MAX_SUBMIT_DEFERRALS,
  PROVIDER_LIMIT_SEC,
  classifySubmitError,
  getLipSyncApiKey,
  normalizeProviderStatus,
  submitDeferralBackoffMs,
  syncLabsStatus,
  syncLabsSubmit,
  trimAndUploadAudioSegment,
  trimAndUploadVideoSegment,
} from "./sync-labs";
import { recordLipSyncHistory } from "./payment-record";

/**
 * Server-owned background poller for lip-sync (and export) jobs.
 *
 * This is what lets the user close the tab: every TICK_MS the poller
 * - claims `queued` lip-sync jobs and submits them to Sync.so
 *   (trim + submit run in fire-and-forget workers, ≤ MAX_SUBMIT_WORKERS),
 * - polls Sync.so for `polling` jobs whose backoff window elapsed,
 * - records provider completions, attaches the finished video to the
 *   originating project (exactly once), and raises exactly-once
 *   notifications,
 * - backfills "it's ready" notifications for terminal export jobs.
 *
 * Sync.so generations run 25–40+ minutes, so polls back off from 60s to a
 * 5-minute cap — gentle on the provider, and no tab, console script, or
 * pasted snippet is ever required for a job to finish. A provider-reported
 * FAILED is terminal (no silent re-submits that would spend the user's
 * Sync.so budget); repeated poll *transport* failures (5 in a row) also
 * fail the job with the last error surfaced. Transient submit rejections
 * (HTTP 429 / plan-concurrency limit) defer with a 5→10→20→40-minute
 * backoff instead of burning the submit attempts — slots free up, the job
 * waits, nobody babysits.
 *
 * Started once from index.ts after the server begins listening.
 */

const TICK_MS = Math.max(10_000, Number(process.env["JOB_POLLER_INTERVAL_MS"] ?? "30000"));
const MAX_SUBMIT_WORKERS = 2;
const MAX_SUBMIT_ATTEMPTS = 3;
const MAX_POLL_ERRORS = 5;
const POLL_BATCH = 10;

/* Test seam: __setPrepareSubmitMedia (via __testHooks) lets the $0
   verification suite stub out FFmpeg/Supabase media prep. Never used in
   production. */
export type PrepareSubmitMedia = (params: LipSyncJob["params"]) => Promise<{
  segmentUrl: string;
  providerClipUrl: string;
  durationSec: number;
}>;
let prepareSubmitMedia: PrepareSubmitMedia = async (params) => {
  const { segmentUrl, durationSec } = await trimAndUploadAudioSegment(
    params.audioUrl,
    params.sceneStartSec,
    params.sceneEndSec,
  );
  /* Trim the video to the audio window so the provider gets a short
     video + short audio pair. Falls back to the full clip if the trim
     fails — never break a job over an optimization. */
  let providerClipUrl = params.clipUrl;
  try {
    providerClipUrl = await trimAndUploadVideoSegment(params.clipUrl, durationSec);
  } catch (vidErr) {
    logger.warn(
      { err: vidErr instanceof Error ? vidErr.message : String(vidErr) },
      "[job-poller] video trim failed, falling back to full clip",
    );
  }
  return { segmentUrl, providerClipUrl, durationSec };
};

/** Poll backoff: 60s → 120s → 240s → 300s cap. */
function pollBackoffMs(polls: number): number {
  return Math.min(60_000 * 2 ** Math.min(Math.max(polls, 0), 3), 300_000);
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

let timer: NodeJS.Timeout | null = null;
let tickInFlight = false;
const submitInFlight = new Set<string>();

export function startJobPoller(): void {
  if (timer) return;
  // Re-queue submits orphaned by a previous process; resume polling the rest.
  recoverInterruptedLipSyncJobs(MAX_SUBMIT_ATTEMPTS).catch((err) =>
    logger.error({ err }, "[job-poller] lip-sync recovery failed"),
  );
  void runPollerTick();
  timer = setInterval(() => {
    void runPollerTick();
  }, TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
  logger.info({ tickMs: TICK_MS }, "[job-poller] started");
}

/** Wake the poller for an immediate pass (e.g. right after a job is queued). */
export function requestPollerTick(): void {
  void runPollerTick();
}

/** One full pass: submits, provider polls, export notification backfill. */
export async function runPollerTick(): Promise<void> {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    await submitDueJobs().catch((err) => logger.error({ err }, "[job-poller] submit phase failed"));
    await pollDueJobs().catch((err) => logger.error({ err }, "[job-poller] poll phase failed"));
    await notifyTerminalExportJobs().catch((err) =>
      logger.error({ err }, "[job-poller] export notification backfill failed"),
    );
    /* Content Scheduler: fire due scheduled social posts (DB-backed, restart-safe). */
    await publishDueScheduledPosts().catch((err) =>
      logger.error({ err }, "[job-poller] scheduler phase failed"),
    );
  } finally {
    tickInFlight = false;
  }
}

/* ── Submit phase ─────────────────────────────────────────────────────── */

async function submitDueJobs(): Promise<void> {
  const apiKey = getLipSyncApiKey();
  if (!apiKey) return; // jobs stay queued; they submit once a key is configured
  const jobs = await claimQueuedJobs(MAX_SUBMIT_WORKERS);
  for (const job of jobs) {
    if (submitInFlight.has(job.id)) continue;
    submitInFlight.add(job.id);
    void runSubmitWorker(job, apiKey).finally(() => {
      submitInFlight.delete(job.id);
    });
  }
}

/** Trim media and submit one job to Sync.so. Never throws — failures are persisted. */
async function runSubmitWorker(job: LipSyncJob, apiKey: string): Promise<void> {
  const fail = async (message: string, code: string) => {
    await failLipSyncJob(job.id, { message, code });
    await createJobNotification({
      jobType: "lip_sync",
      jobId: job.id,
      userId: job.userId,
      projectId: job.projectId,
      status: "failed",
      title: "Lip sync failed",
      message: truncate(message, 500),
    });
  };

  try {
    const { segmentUrl, providerClipUrl, durationSec } = await prepareSubmitMedia(job.params);

    if (durationSec > PROVIDER_LIMIT_SEC) {
      await fail(
        `Audio segment is ${durationSec.toFixed(1)}s — exceeds the Sync.so plan limit of ${PROVIDER_LIMIT_SEC}s. Trim the scene or upgrade the plan.`,
        "segment_too_long",
      );
      return;
    }

    const syncId = await syncLabsSubmit(providerClipUrl, segmentUrl, apiKey);
    await markJobSubmitted(job.id, syncId, 60_000);
    logger.info({ jobId: job.id, syncId }, "[job-poller] lip-sync submitted to Sync.so");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lip-sync submit failed";
    const kind = classifySubmitError(err);

    if (kind === "transient") {
      /* Sync.so plan-concurrency limit (or a 5xx): provider slots free up
         over 25–40 minutes. Wait with a long backoff instead of burning all
         submit attempts in ~2 minutes. Transient waits don't touch the
         attempts budget — deferSubmitJob neutralizes the claim's +1. */
      const backoffMs = submitDeferralBackoffMs(job.submitDeferrals);
      const deferred = await deferSubmitJob(job.id, backoffMs, MAX_SUBMIT_DEFERRALS).catch(() => null);
      if (!deferred) {
        logger.error({ jobId: job.id, err: message }, "[job-poller] deferred submit target vanished; dropping");
        return;
      }
      if (deferred.failed) {
        await createJobNotification({
          jobType: "lip_sync",
          jobId: job.id,
          userId: job.userId,
          projectId: job.projectId,
          status: "failed",
          title: "Lip sync failed",
          message: truncate(
            "Sync.so stayed at its plan concurrency limit for about a day, so this job was never submitted. Try again later or upgrade the Sync.so plan.",
            500,
          ),
        });
        logger.error(
          { jobId: job.id, deferrals: deferred.deferrals },
          "[job-poller] submit deferred past the limit; marked failed",
        );
      } else {
        logger.warn(
          { jobId: job.id, deferrals: deferred.deferrals, backoffMs, err: message },
          "[job-poller] provider busy; submit deferred with backoff",
        );
      }
      return;
    }

    if (kind === "permanent") {
      /* 4xx (validation, auth, bad input): deterministic — retrying is
         pointless and every retry re-trims media. Fail fast, notify once. */
      await fail(message, "provider_rejected");
      logger.error({ jobId: job.id, err: message }, "[job-poller] submit permanently rejected by provider");
      return;
    }

    /* Transport failures (timeouts, DNS, resets): the request may never have
       reached Sync.so — re-queue against the normal attempts budget. */
    const attempts = await requeueSubmitJob(job.id, MAX_SUBMIT_ATTEMPTS).catch(() => MAX_SUBMIT_ATTEMPTS);
    if (attempts >= MAX_SUBMIT_ATTEMPTS) {
      // requeueSubmitJob already marked it failed; notify once.
      await createJobNotification({
        jobType: "lip_sync",
        jobId: job.id,
        userId: job.userId,
        projectId: job.projectId,
        status: "failed",
        title: "Lip sync failed",
        message: truncate(message, 500),
      });
      logger.error({ jobId: job.id, attempts, err: message }, "[job-poller] submit failed permanently");
    } else {
      logger.warn({ jobId: job.id, attempts, err: message }, "[job-poller] submit failed; re-queued");
    }
  }
}

/* ── Poll phase ───────────────────────────────────────────────────────── */

async function pollDueJobs(): Promise<void> {
  const apiKey = getLipSyncApiKey();
  if (!apiKey) return; // polling resumes once a key is configured
  const jobs = await getJobsDueForPoll(POLL_BATCH);
  for (const job of jobs) {
    try {
      await pollOneJob(job, apiKey);
    } catch (err) {
      logger.error(
        { err, jobId: job.id },
        "[job-poller] pollOneJob threw; continuing with next job",
      );
    }
  }
}

async function pollOneJob(job: LipSyncJob, apiKey: string): Promise<void> {
  const fail = async (message: string, code: string) => {
    await failLipSyncJob(job.id, { message, code });
    await createJobNotification({
      jobType: "lip_sync",
      jobId: job.id,
      userId: job.userId,
      projectId: job.projectId,
      status: "failed",
      title: "Lip sync failed",
      message: truncate(message, 500),
    });
  };

  let remote;
  try {
    remote = await syncLabsStatus(job.providerJobId!, apiKey);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Provider poll failed";
    if (classifySubmitError(err) === "transient") {
      /* A 429/5xx on the status check means we REACHED Sync.so and it's just
         busy — not a transport failure. Don't count it toward the
         consecutive-error budget; check again on the normal backoff. */
      await recordJobPoll(job.id, { ok: true, nextPollInMs: pollBackoffMs(job.polls) });
      logger.warn({ jobId: job.id, err: message }, "[job-poller] provider busy on status check; backing off");
      return;
    }
    const errors = job.consecutivePollErrors + 1;
    if (errors >= MAX_POLL_ERRORS) {
      await fail(
        `Sync.so could not be reached after ${errors} attempts. Last error: ${message}`,
        "provider_unreachable",
      );
    } else {
      await recordJobPoll(job.id, { ok: false, error: message, nextPollInMs: pollBackoffMs(job.polls) });
      logger.warn({ jobId: job.id, errors, err: message }, "[job-poller] provider poll transport failure");
    }
    return;
  }

  const status = normalizeProviderStatus(remote);

  if (status === "completed") {
    if (!remote.outputUrl) {
      await fail("Sync.so reported completion but returned no video URL.", "provider_no_output");
      return;
    }
    await completeLipSyncJob(job.id, remote.outputUrl);
    /* Attach the finished video to the originating project — exactly once
       via the history_recorded gate, so a recovered job never double-attaches. */
    const first = await markHistoryRecorded(job.id).catch(() => false);
    if (first && job.userId) {
      await recordLipSyncHistory({
        userId: job.userId,
        projectId: job.projectId,
        sceneId: job.sceneId,
        videoUrl: remote.outputUrl,
        creditsUsed: 0,
      }).catch((err) => logger.warn({ err, jobId: job.id }, "[job-poller] recordLipSyncHistory failed (non-fatal)"));
    }
    const durationSec = job.params.sceneEndSec - job.params.sceneStartSec;
    await createJobNotification({
      jobType: "lip_sync",
      jobId: job.id,
      userId: job.userId,
      projectId: job.projectId,
      status: "completed",
      title: "Lip sync ready",
      message: `Your lip-synced scene is ready${durationSec > 0 ? ` (${durationSec.toFixed(1)}s)` : ""}.`,
      videoUrl: remote.outputUrl,
    });
    logger.info({ jobId: job.id }, "[job-poller] lip-sync completed");
    return;
  }

  if (status === "failed") {
    /* Provider-reported FAILED is terminal for that generation — no silent
       re-submits (each one would spend the user's Sync.so budget). */
    await fail(
      `Sync.so reported the generation failed: ${remote.error ?? "unknown error"}`,
      "provider_failed",
    );
    return;
  }

  // pending | processing | anything else — keep waiting with backoff.
  await recordJobPoll(job.id, { ok: true, nextPollInMs: pollBackoffMs(job.polls) });
}

/* ── Test hooks (not used in production) ─────────────────────────────── */
export const __testHooks = {
  pollOneJob,
  runSubmitWorker,
  pollBackoffMs,
  __setPrepareSubmitMedia: (fn: PrepareSubmitMedia) => {
    prepareSubmitMedia = fn;
  },
};
