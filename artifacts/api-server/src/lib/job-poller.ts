import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { publishDueScheduledPosts } from "./scheduler-jobs";
import { drainEmailQueue } from "./email-campaign-sender";
import {
  claimJobForSubmit,
  claimLipSyncChargeRefund,
  completeLipSyncJob,
  deferSubmitJob,
  failLipSyncJob,
  getJobsDueForPoll,
  LIP_SYNC_JOB_CHARGE_CREDITS,
  markHistoryRecorded,
  markJobSubmitted,
  mergeLipSyncJobResultMeta,
  peekQueuedJobs,
  recordJobPoll,
  recoverInterruptedLipSyncJobs,
  requeueSubmitJob,
  type LipSyncJob,
} from "./lip-sync-jobs";
import { refundCredits } from "./credits";
import {
  createJobNotification,
  notifyTerminalExportJobs,
} from "./job-notifications";
import { notifyUserEvent, type UserEventInput } from "./push-events";

/* ── Lip-sync outcome fan-out (fan-out truth, stack1100 Y3) ────────────
   A lip-sync job's terminal outcome used to be recorded ONLY as a
   job_notifications row — a queue whose sole consumer is the owner's
   chat relay — so the member who paid for the job never got a bell or
   a device ping when it finished or failed, while export jobs (the
   sibling paid-work rail) land both through the door. The outcome now
   rides the door on the same exactly-once gate: createJobNotification
   returns true only for the call whose row actually landed, and only
   that call fires the event (money category — paid work, like exports). */
type LipSyncEventNotifier = (input: UserEventInput) => Promise<unknown>;
let _lipSyncEventNotifier: LipSyncEventNotifier = notifyUserEvent;
/** Test seam — never used outside tests. */
export function __setLipSyncEventNotifier(fn: LipSyncEventNotifier | null): void {
  _lipSyncEventNotifier = fn ?? notifyUserEvent;
}

export async function recordLipSyncOutcome(
  job: LipSyncJob,
  status: "completed" | "failed",
  title: string,
  message: string,
  videoUrl?: string,
): Promise<void> {
  const landed = await createJobNotification({
    jobType: "lip_sync",
    jobId: job.id,
    userId: job.userId,
    projectId: job.projectId,
    status,
    title,
    message,
    videoUrl,
  });
  if (!landed) return;
  try {
    await _lipSyncEventNotifier({
      userId: job.userId,
      category: "money",
      kind: status === "completed" ? "lip_sync_done" : "lip_sync_failed",
      title,
      body: message,
      link: job.projectId ? `/video-editor?project=${job.projectId}` : "/my-projects?tab=history",
    });
  } catch (err) {
    logger.warn({ err, jobId: job.id }, "[job-poller] lip-sync outcome event failed (non-fatal)");
  }
}
import { notifyDueBookingReminders } from "./booking-reminders";
import {
  MAX_SUBMIT_DEFERRALS,
  PROVIDER_LIMIT_SEC,
  SYNC_LABS_MODEL,
  buildResolutionMeta,
  classifySubmitError,
  getLipSyncApiKey,
  getLipSyncProviderName,
  isLipSyncProviderConfigured,
  normalizeLipSyncProvider,
  normalizeProviderStatus,
  probeVideoDimensions,
  submitDeferralBackoffMs,
  syncLabsStatus,
  syncLabsSubmit,
  trimAndUploadAudioSegment,
  trimAndUploadVideoSegment,
  type LipSyncProviderId,
} from "./sync-labs";
import {
  classifyWaveSpeedSubmitError,
  getLatentSyncModel,
  getWaveSpeedApiKey,
  isWaveSpeedBalanceError,
  normalizeWaveSpeedStatus,
  waveSpeedStatus,
  waveSpeedSubmit,
  WaveSpeedError,
} from "./wavespeed";
import { recordLipSyncHistory } from "./payment-record";
import { runViralSpikeWatch } from "./viral-spike-watch";
import { runGroupDigestSweep } from "./group-digest";
import { mirrorExternalMediaUrl } from "./mirrorMedia";

/**
 * Server-owned background poller for lip-sync (and export) jobs.
 *
 * This is what lets the user close the tab: every TICK_MS the poller
 * - claims `queued` lip-sync jobs and submits them to the provider each
 *   job was created for (LatentSync via WaveSpeed by default; Sync.so
 *   only for explicitly selected premium jobs — see
 *   resolveJobProvider),
 *   (trim + submit run in fire-and-forget workers, ≤ MAX_SUBMIT_WORKERS),
 * - polls that provider for `polling` jobs whose backoff window elapsed,
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
  /** Dimensions of the exact clip that will be submitted (probed, best-effort). */
  inputWidth?: number | null;
  inputHeight?: number | null;
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
  /* Probe the dimensions of the exact clip being submitted, so a
     provider that returns a smaller frame (LatentSync does) is caught
     by the completion path's comparison — never silently. */
  const inputDims = await probeVideoDimensions(providerClipUrl);
  return {
    segmentUrl,
    providerClipUrl,
    durationSec,
    inputWidth: inputDims?.width ?? null,
    inputHeight: inputDims?.height ?? null,
  };
};

/* ── Provider resolution ────────────────────────────────────────────────
   A job runs on the provider recorded in its params at creation (itself
   the effective switch value at that moment) — a job is never silently
   rerouted to the other provider because a key appeared or vanished.
   A job WITHOUT a stored provider falls back to the current switch
   value — and to NOTHING else. The historical terminal fallback to
   "sync" is removed (owner's ruling, 2026-10-26: sync-3 is
   premium-only, never the default): when neither the job nor the
   switch names a route, the job simply stays queued until a route is
   explicitly selected or the default route's key is configured —
   exactly how an unconfigured route's jobs already wait. */
function resolveJobProvider(job: LipSyncJob): LipSyncProviderId | null {
  return normalizeLipSyncProvider(job.params.provider) ?? getLipSyncProviderName();
}

function providerApiKey(provider: LipSyncProviderId | null): string | null {
  if (provider === "latentsync") return getWaveSpeedApiKey();
  if (provider === "sync") return getLipSyncApiKey();
  return null;
}

function providerDisplayName(provider: LipSyncProviderId): string {
  return provider === "latentsync" ? "WaveSpeed" : "Sync.so";
}

const PEEK_BATCH = 10;

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

/**
 * Refund a terminally failed job's up-front charge — exactly once.
 *
 * Every job row exists only because chargeCredits took
 * LIP_SYNC_JOB_CHARGE_CREDITS before enqueueing (routes/lip-sync.ts);
 * the money rule is that a failed generation refunds in full. The
 * refund goes through refundCredits under the charge's own action
 * name, so the rail restores the exact pools the charge drew from —
 * temporary portion back to the live bonus pool (or into permanent
 * when the pool has since expired, per the Z1 rule), a team-pool
 * charge back to the team pool. claimLipSyncChargeRefund is the
 * atomic gate: whichever failure path flips it first refunds, and
 * every replay is a no-op. Never throws — a refund failure is logged
 * loudly and must not break the worker that reported the failure.
 */
async function refundFailedLipSyncCharge(job: LipSyncJob): Promise<void> {
  if (!job.userId) return;
  try {
    const won = await claimLipSyncChargeRefund(job.id);
    if (!won) return;
    await refundCredits(job.userId, LIP_SYNC_JOB_CHARGE_CREDITS, {
      action: "Lip Sync — Refund (generation failed)",
    });
    logger.info({ jobId: job.id, userId: job.userId }, "[job-poller] lip-sync failure refunded");
  } catch (err) {
    logger.error(
      { err, jobId: job.id, userId: job.userId },
      "[job-poller] CRITICAL: lip-sync failure refund failed — charge stands unrefunded",
    );
  }
}

export function startJobPoller(): void {
  if (timer) return;
  // Re-queue submits orphaned by a previous process; resume polling the rest.
  recoverInterruptedLipSyncJobs(MAX_SUBMIT_ATTEMPTS)
    .then(async (newlyFailed) => {
      /* Jobs recovery gave up on are terminal failures like any other:
         their up-front charges refund through the same gate. */
      for (const job of newlyFailed) {
        await refundFailedLipSyncCharge(job);
      }
    })
    .catch((err) => logger.error({ err }, "[job-poller] lip-sync recovery failed"));
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
    /* Email List: drain queued campaigns + due welcome-sequence steps
       through the Resend sender (DB-backed, restart-safe). */
    await drainEmailQueue().catch((err) =>
      logger.error({ err }, "[job-poller] email sender phase failed"),
    );
    /* Paid bookings: buyer reminders for confirmed appointments inside
       the 24h lead window (DB-backed, restart-safe, exactly-once). */
    await notifyDueBookingReminders().catch((err) =>
      logger.error({ err }, "[job-poller] booking reminder phase failed"),
    );
    /* Viral Spike Watch: baseline-relative spike detection over
       play_events, alerting through the notifications bell rail.
       Internally throttled (SPIKE_WATCH_INTERVAL_MS, default 1h) and
       never throws — this catch is belt-and-braces like every phase. */
    await runViralSpikeWatch().catch((err) =>
      logger.error({ err }, "[job-poller] viral spike watch phase failed"),
    );
    /* Per-group activity digest: per-member, per-group aggregation over
       group posts/forum/joins since each member's last digest, delivered
       on the notifications bell rail (+ opt-in email). Internally
       throttled (GROUP_DIGEST_INTERVAL_MS, default 1h), fail-closed on
       unreadable prefs, and never throws — this catch is belt-and-braces. */
    await runGroupDigestSweep().catch((err) =>
      logger.error({ err }, "[job-poller] group digest phase failed"),
    );
  } finally {
    tickInFlight = false;
  }
}

/* ── Submit phase ─────────────────────────────────────────────────────── */

async function submitDueJobs(): Promise<void> {
  /* Peek first, claim second: a job is only claimed once its OWN
     provider's key is confirmed configured, so jobs for an unconfigured
     route stay queued and untouched (the pre-switch behavior for Sync.so
     was "no key → nothing is claimed"; that now holds per provider). */
  const candidates = await peekQueuedJobs(PEEK_BATCH);
  let workers = 0;
  for (const candidate of candidates) {
    if (workers >= MAX_SUBMIT_WORKERS) break;
    const provider = resolveJobProvider(candidate);
    if (!provider || !isLipSyncProviderConfigured(provider)) continue;
    const apiKey = providerApiKey(provider);
    if (!apiKey) continue;
    const job = await claimJobForSubmit(candidate.id);
    if (!job) continue; // another worker/process won the atomic claim
    workers++;
    if (submitInFlight.has(job.id)) continue;
    submitInFlight.add(job.id);
    void runSubmitWorker(job, apiKey, provider).finally(() => {
      submitInFlight.delete(job.id);
    });
  }
}

/** Trim media and submit one job to its provider. Never throws — failures are persisted. */
async function runSubmitWorker(
  job: LipSyncJob,
  apiKey: string,
  providerArg?: LipSyncProviderId,
): Promise<void> {
  const provider = providerArg ?? resolveJobProvider(job);
  if (!provider) {
    /* No route selected for this job and none in effect: it must not be
       submitted anywhere (premium never serves by fallback). The submit
       phase never claims such a job (its peek gate skips unconfigured
       routes); this guard covers direct calls only. */
    logger.warn(
      { jobId: job.id },
      "[job-poller] lip-sync submit skipped: no provider resolved for job",
    );
    return;
  }
  const fail = async (message: string, code: string) => {
    await failLipSyncJob(job.id, { message, code });
    await refundFailedLipSyncCharge(job);
    await recordLipSyncOutcome(job, "failed", "Lip sync failed", truncate(message, 500));
  };

  try {
    const { segmentUrl, providerClipUrl, durationSec, inputWidth, inputHeight } =
      await prepareSubmitMedia(job.params);

    if (durationSec > PROVIDER_LIMIT_SEC) {
      await fail(
        provider === "sync"
          ? `Audio segment is ${durationSec.toFixed(1)}s — exceeds the Sync.so plan limit of ${PROVIDER_LIMIT_SEC}s. Trim the scene or upgrade the plan.`
          : `Audio segment is ${durationSec.toFixed(1)}s — exceeds the ${PROVIDER_LIMIT_SEC}s limit of the current lip-sync route. Trim the scene.`,
        "segment_too_long",
      );
      return;
    }

    let providerJobId: string;
    if (provider === "latentsync") {
      /* LatentSync has no strength/temperature dial — the A-09 strength
         control is recorded in the job params but, exactly like sync-3,
         this model exposes no such option to send. */
      providerJobId = await waveSpeedSubmit(providerClipUrl, segmentUrl, apiKey);
    } else {
      providerJobId = await syncLabsSubmit(providerClipUrl, segmentUrl, apiKey, job.params.strength);
    }
    await markJobSubmitted(job.id, providerJobId, 60_000);
    /* Record what was sent (provider, model, probed input dimensions)
       so the completion path can state — on the job record itself —
       whether the returned video is smaller than what was submitted. */
    await mergeLipSyncJobResultMeta(job.id, {
      provider,
      model: provider === "latentsync" ? getLatentSyncModel() : SYNC_LABS_MODEL,
      inputWidth: inputWidth ?? null,
      inputHeight: inputHeight ?? null,
    }).catch((err) =>
      logger.warn({ err, jobId: job.id }, "[job-poller] result_meta write failed (non-fatal)"),
    );
    logger.info(
      { jobId: job.id, provider, providerJobId },
      "[job-poller] lip-sync submitted",
    );
  } catch (err) {
    if (provider === "latentsync") {
      await handleWaveSpeedSubmitError(job, err, fail);
      return;
    }
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
        await refundFailedLipSyncCharge(job);
        await recordLipSyncOutcome(job, "failed", "Lip sync failed", truncate(
          "Sync.so stayed at its plan concurrency limit for about a day, so this job was never submitted. Try again later or upgrade the Sync.so plan.",
          500,
        ));
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
      // requeueSubmitJob already marked it failed; refund + notify once.
      await refundFailedLipSyncCharge(job);
      await recordLipSyncOutcome(job, "failed", "Lip sync failed", truncate(message, 500));
      logger.error({ jobId: job.id, attempts, err: message }, "[job-poller] submit failed permanently");
    } else {
      logger.warn({ jobId: job.id, attempts, err: message }, "[job-poller] submit failed; re-queued");
    }
  }
}

/**
 * WaveSpeed submit failures, by kind (see lib/wavespeed.ts):
 * - balance: fail closed at once with a clear provider-unavailable
 *   state — no backoff loop pretending to wait, no resubmit;
 * - transient (provider answered 429/5xx — no task was issued): defer
 *   with the same long backoff machinery as Sync.so; a later resubmit is
 *   safe precisely because the provider answered and issued nothing;
 * - transport (no response at all): the submit may have created a
 *   billed task — NEVER resubmit blind. The job fails with
 *   submit_outcome_unknown; the user's charge idempotency key means a
 *   fresh attempt from the editor never double-charges;
 * - permanent: fail fast.
 */
async function handleWaveSpeedSubmitError(
  job: LipSyncJob,
  err: unknown,
  fail: (message: string, code: string) => Promise<void>,
): Promise<void> {
  const message = err instanceof Error ? err.message : "Lip-sync submit failed";
  const kind = classifyWaveSpeedSubmitError(err);

  if (kind === "balance") {
    await fail(
      "Lip sync is temporarily unavailable — the provider account is out of funds, so this job was not submitted. Please try again later.",
      "provider_balance",
    );
    logger.error({ jobId: job.id, err: message }, "[job-poller] WaveSpeed balance exhausted; submit failed closed");
    return;
  }

  if (kind === "transient") {
    const backoffMs = submitDeferralBackoffMs(job.submitDeferrals);
    const deferred = await deferSubmitJob(job.id, backoffMs, MAX_SUBMIT_DEFERRALS, {
      message:
        "WaveSpeed stayed busy for ~24 hours and the job was not submitted. Try again later.",
      code: "provider_busy_timeout",
    }).catch(() => null);
    if (!deferred) {
      logger.error({ jobId: job.id, err: message }, "[job-poller] deferred submit target vanished; dropping");
      return;
    }
    if (deferred.failed) {
      await refundFailedLipSyncCharge(job);
      await recordLipSyncOutcome(job, "failed", "Lip sync failed", truncate(
        "WaveSpeed stayed busy for about a day, so this job was never submitted. Try again later.",
        500,
      ));
      logger.error(
        { jobId: job.id, deferrals: deferred.deferrals },
        "[job-poller] WaveSpeed submit deferred past the limit; marked failed",
      );
    } else {
      logger.warn(
        { jobId: job.id, deferrals: deferred.deferrals, backoffMs, err: message },
        "[job-poller] WaveSpeed busy; submit deferred with backoff",
      );
    }
    return;
  }

  if (kind === "transport") {
    await fail(
      "The lip-sync provider did not answer, so this submit's outcome is unknown. It was not retried — retrying could bill the same generation twice. Please start a new lip sync.",
      "submit_outcome_unknown",
    );
    logger.error({ jobId: job.id, err: message }, "[job-poller] WaveSpeed submit outcome unknown; not resubmitted");
    return;
  }

  await fail(message, "provider_rejected");
  logger.error({ jobId: job.id, err: message }, "[job-poller] submit permanently rejected by WaveSpeed");
}

/* ── Poll phase ───────────────────────────────────────────────────────── */

async function pollDueJobs(): Promise<void> {
  const jobs = await getJobsDueForPoll(POLL_BATCH);
  for (const job of jobs) {
    const provider = resolveJobProvider(job);
    if (!provider) continue; // no route in effect for this job — polling resumes once one is selected
    const apiKey = providerApiKey(provider);
    if (!apiKey) continue; // polling resumes once that job's route is configured
    try {
      await pollOneJob(job, apiKey, provider);
    } catch (err) {
      logger.error(
        { err, jobId: job.id },
        "[job-poller] pollOneJob threw; continuing with next job",
      );
    }
  }
}

async function pollOneJob(
  job: LipSyncJob,
  apiKey: string,
  providerArg?: LipSyncProviderId,
): Promise<void> {
  const provider = providerArg ?? resolveJobProvider(job);
  if (!provider) {
    /* No route in effect for this job: polling resumes once one is
       selected/configured (pollDueJobs already skips it — no key can
       resolve for a null provider). */
    return;
  }
  const display = providerDisplayName(provider);
  const fail = async (message: string, code: string) => {
    await failLipSyncJob(job.id, { message, code });
    await refundFailedLipSyncCharge(job);
    await recordLipSyncOutcome(job, "failed", "Lip sync failed", truncate(message, 500));
  };

  let remote: { status: string; outputUrl?: string; error?: string };
  try {
    if (provider === "latentsync") {
      const ws = await waveSpeedStatus(job.providerJobId!, apiKey);
      remote = {
        status: normalizeWaveSpeedStatus(ws),
        outputUrl: ws.outputUrl,
        error: ws.error,
      };
    } else {
      const sl = await syncLabsStatus(job.providerJobId!, apiKey);
      remote = {
        status: normalizeProviderStatus(sl),
        outputUrl: sl.outputUrl,
        error: sl.error,
      };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Provider poll failed";
    if (provider === "latentsync") {
      if (isWaveSpeedBalanceError(err)) {
        /* Out of funds mid-flight: fail closed with the clear state
           instead of burning the poll-error budget on a dead account. */
        await fail(
          "Lip sync is temporarily unavailable — the provider account is out of funds, so this job could not be checked to completion.",
          "provider_balance",
        );
        return;
      }
      if (
        err instanceof WaveSpeedError &&
        (err.status === 429 || (err.status !== null && err.status >= 500))
      ) {
        /* Provider answered and is just busy — not a transport failure. */
        await recordJobPoll(job.id, { ok: true, nextPollInMs: pollBackoffMs(job.polls) });
        logger.warn({ jobId: job.id, err: message }, "[job-poller] WaveSpeed busy on status check; backing off");
        return;
      }
      const errors = job.consecutivePollErrors + 1;
      if (errors >= MAX_POLL_ERRORS) {
        await fail(
          `WaveSpeed could not be reached after ${errors} attempts. Last error: ${message}`,
          "provider_unreachable",
        );
      } else {
        await recordJobPoll(job.id, { ok: false, error: message, nextPollInMs: pollBackoffMs(job.polls) });
        logger.warn({ jobId: job.id, errors, err: message }, "[job-poller] WaveSpeed poll transport failure");
      }
      return;
    }
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

  const status = remote.status;

  if (status === "completed") {
    if (!remote.outputUrl) {
      await fail(`${display} reported completion but returned no video URL.`, "provider_no_output");
      return;
    }
    /* Mirror-on-save (2026-10-13 law): the provider's output URL is a CDN
       link that can vanish — re-host it into permanent storage ONCE, here,
       so every store below (lip_sync_jobs.result_url, generation_history,
       job_notifications.video_url) persists the permanent ref. */
    const storedVideoUrl =
      (job.userId
        ? await mirrorExternalMediaUrl(remote.outputUrl, { kind: "video", ownerKey: job.userId })
        : null) ?? remote.outputUrl;
    /* Resolution honesty: compare the provider's output dimensions
       against the input dimensions recorded at submit. LatentSync is
       known to downscale (672x1344 → 432x880 in the clean test) — the
       fact lands on the job record and in the completion note, never
       silently. A failed probe records nulls (unknown), not a guess. */
    const outputDims = await probeVideoDimensions(remote.outputUrl);
    const metaIn = job.resultMeta;
    const inputDims =
      metaIn &&
      typeof metaIn["inputWidth"] === "number" &&
      typeof metaIn["inputHeight"] === "number"
        ? {
            width: metaIn["inputWidth"] as number,
            height: metaIn["inputHeight"] as number,
          }
        : null;
    const resMeta = buildResolutionMeta(inputDims, outputDims);
    await completeLipSyncJob(job.id, storedVideoUrl, { ...resMeta, provider });
    /* Attach the finished video to the originating project — exactly once
       via the history_recorded gate, so a recovered job never double-attaches. */
    const first = await markHistoryRecorded(job.id).catch(() => false);
    if (first && job.userId) {
      await recordLipSyncHistory({
        userId: job.userId,
        projectId: job.projectId,
        sceneId: job.sceneId,
        videoUrl: storedVideoUrl,
        creditsUsed: 0,
      }).catch((err) => logger.warn({ err, jobId: job.id }, "[job-poller] recordLipSyncHistory failed (non-fatal)"));
    }
    const durationSec = job.params.sceneEndSec - job.params.sceneStartSec;
    const resolutionNote =
      resMeta.resolutionReduced === true
        ? ` Note: the finished video is ${resMeta.outputWidth}×${resMeta.outputHeight} — smaller than the ${resMeta.inputWidth}×${resMeta.inputHeight} clip that was sent.`
        : "";
    await recordLipSyncOutcome(
      job,
      "completed",
      "Lip sync ready",
      `Your lip-synced scene is ready${durationSec > 0 ? ` (${durationSec.toFixed(1)}s)` : ""}.${resolutionNote}`,
      storedVideoUrl,
    );
    logger.info({ jobId: job.id }, "[job-poller] lip-sync completed");
    return;
  }

  if (status === "failed") {
    /* Provider-reported FAILED is terminal for that generation — no silent
       re-submits (each one would spend the user's provider budget). */
    await fail(
      `${display} reported the generation failed: ${remote.error ?? "unknown error"}`,
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
