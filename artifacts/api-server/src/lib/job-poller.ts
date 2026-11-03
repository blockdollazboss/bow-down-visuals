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
  getFailedUnrefundedLipSyncJobs,
  getJobsDueForPoll,
  getLipSyncJob,
  LIP_SYNC_JOB_CHARGE_CREDITS,
  lipSyncChargeForJob,
  markHistoryRecorded,
  markJobSubmitted,
  mergeLipSyncJobResultMeta,
  peekQueuedJobs,
  recordJobPoll,
  recoverInterruptedLipSyncJobs,
  releaseLipSyncChargeRefundClaim,
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
  buildResolutionMeta,
  getLipSyncProviderName,
  isLipSyncProviderConfigured,
  isRemovedLipSyncProvider,
  normalizeLipSyncProvider,
  probeVideoDimensions,
  submitDeferralBackoffMs,
  trimAndUploadAudioSegment,
  trimAndUploadVideoSegment,
  type LipSyncProviderId,
} from "./lip-sync-core";
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
 * - claims `queued` lip-sync jobs and submits them to the one live
 *   provider (LatentSync via WaveSpeed — see resolveJobProvider),
 *   (trim + submit run in fire-and-forget workers, ≤ MAX_SUBMIT_WORKERS),
 * - polls that provider for `polling` jobs whose backoff window elapsed,
 * - records provider completions, attaches the finished video to the
 *   originating project (exactly once), and raises exactly-once
 *   notifications,
 * - backfills "it's ready" notifications for terminal export jobs.
 *
 * Lip-sync generations can run for many minutes, so polls back off
 * from 60s to a 5-minute cap — gentle on the provider, and no tab,
 * console script, or pasted snippet is ever required for a job to
 * finish. A provider-reported FAILED is terminal (no silent
 * re-submits that would spend provider budget); repeated poll
 * *transport* failures (5 in a row) also fail the job with the last
 * error surfaced. Transient submit rejections defer with a
 * 5→10→20→40-minute backoff instead of burning the submit attempts —
 * slots free up, the job waits, nobody babysits.
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
type PrepareSubmitMedia = (params: LipSyncJob["params"]) => Promise<{
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
   A job runs on the provider recorded in its params at creation. The
   only live route is LatentSync (stack1400: the former premium direct
   route was removed when the owner deleted that provider account).

   - A QUEUED job whose stored provider names the removed route has
     not been submitted anywhere yet, so it falls back to the current
     live route — never to the removed one.
   - A POLLING job whose stored provider names the removed route
     carries a provider job id issued by a closed account: it can
     never be polled again, so pollOneJob fails it honestly (with the
     usual exactly-once refund) instead of querying the live route
     with a foreign id or, worse, the closed account.
   - A job WITHOUT a stored provider falls back to the current switch
     value — and to NOTHING else. When neither the job nor the switch
     names the live route, the job simply stays queued until the live
     route is configured. */
function resolveJobProvider(job: LipSyncJob): LipSyncProviderId | null {
  return normalizeLipSyncProvider(job.params.provider) ?? getLipSyncProviderName();
}

function providerApiKey(provider: LipSyncProviderId | null): string | null {
  if (provider === "latentsync") return getWaveSpeedApiKey();
  return null;
}

function providerDisplayName(_provider: LipSyncProviderId): string {
  return "Lip Sync";
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
 * Every job row exists only because chargeCredits took the job's
 * duration-tiered charge (lipSyncChargeForJob — 300 VB, or 600 VB for
 * a 50–60s clip under the stack1400 tier) before enqueueing
 * (routes/lip-sync.ts); the money rule is that a failed generation
 * refunds in full — the job's OWN amount, never a flat constant. The
 * refund goes through refundCredits under the charge's own action
 * name, so the rail restores the exact pools the charge drew from —
 * temporary portion back to the live bonus pool (or into permanent
 * when the pool has since expired, per the Z1 rule), a team-pool
 * charge back to the team pool. claimLipSyncChargeRefund is the
 * atomic gate: whichever failure path flips it first refunds, and
 * every replay is a no-op.
 *
 * The flip is a claim, not a completion record (the export rail's
 * claim/re-arm discipline): if refundCredits throws after the flip,
 * the claim is RELEASED before this returns — charge_refunded goes
 * back to false, so the durable record never claims a refund that
 * didn't land, and the poller's refund sweep (retryFailedLipSyncRefunds)
 * can claim the job again and land the refund exactly once. Never
 * throws — a refund failure is logged loudly and must not break the
 * worker that reported the failure.
 *
 * Returns true ONLY when this call actually landed the refund (won
 * the gate AND refundCredits completed) — the failure tells below key
 * their refund sentence off this, never off the failure alone: a path
 * that lost the gate, or whose refund write failed, must not tell the
 * member money came back when it didn't. The gate and the tell agree
 * by construction: the gate reads true only for a job some caller's
 * refundCredits completed under its claim (a claim is released on
 * any throw), which is exactly the set of jobs whose tell may carry
 * the refund sentence. The one window no code here can close is a
 * process dying INSIDE the refundCredits call itself — its claim
 * can't be released by a dead process and the restore's state is
 * unknowable without risking a double refund, so that claim stands
 * and the CRITICAL log below is the operator's reconciliation
 * signal (findable: failed jobs with charge_refunded = true and no
 * matching refund ledger row).
 */
async function refundFailedLipSyncCharge(job: LipSyncJob): Promise<boolean> {
  if (!job.userId) return false;
  let won = false;
  try {
    won = await claimLipSyncChargeRefund(job.id);
    if (!won) return false;
    await refundCredits(job.userId, lipSyncChargeForJob(job), {
      action: "Lip Sync — Refund (generation failed)",
    });
    logger.info({ jobId: job.id, userId: job.userId }, "[job-poller] lip-sync failure refunded");
    return true;
  } catch (err) {
    if (won) {
      /* The refund did not land — release the claim so the gate
         stops claiming it and the refund sweep can retry. A failed
         release is logged just as loudly: the row is then in the
         documented reconciliation state above. */
      await releaseLipSyncChargeRefundClaim(job.id).catch((releaseErr) =>
        logger.error(
          { err: releaseErr, jobId: job.id, userId: job.userId },
          "[job-poller] CRITICAL: lip-sync refund claim release failed — gate may claim an unlanded refund",
        ),
      );
    }
    logger.error(
      { err, jobId: job.id, userId: job.userId },
      "[job-poller] CRITICAL: lip-sync failure refund failed — charge stands unrefunded",
    );
    return false;
  }
}

/* How long after a failure the refund sweep keeps retrying an
   unlanded refund. The sweep is a RETRY mechanism for this build's
   own failure paths — a refund write that threw, or a process that
   died between the failure write and the refund — not a backfill:
   failed rows older than this window predate the refund path and
   paying them is a separate decision, so the sweep never reaches
   them. Two hours is far beyond a poller restart or a credit-rail
   blip, and far inside the 7-day terminal-row retention. */
const LIP_SYNC_REFUND_RETRY_WINDOW_MS = 2 * 60 * 60 * 1000;
const LIP_SYNC_REFUND_RETRY_BATCH = 25;

/**
 * Refund sweep: retry the failure refunds that never landed. Runs on
 * every poller tick (restart-safe, like the export notification
 * backfill). Candidates are failed jobs still wearing
 * charge_refunded = false whose last update is inside the retry
 * window; each goes through the same atomic claim as the live
 * failure paths, so a sweep racing a poller worker — or a second
 * poller — can never refund twice. A job another worker currently
 * holds the claim on (gate already true) is not a candidate at all.
 * The sweep deliberately sends no second tell: the failure was
 * already reported when it happened (without a refund claim, which
 * was the truth at the time); this pass only makes the money right.
 */
async function retryFailedLipSyncRefunds(): Promise<void> {
  const jobs = await getFailedUnrefundedLipSyncJobs(LIP_SYNC_REFUND_RETRY_BATCH);
  const cutoff = Date.now() - LIP_SYNC_REFUND_RETRY_WINDOW_MS;
  for (const job of jobs) {
    if (job.updatedAt < cutoff) continue;
    await refundFailedLipSyncCharge(job);
  }
}

/**
 * The member-facing failure message for a terminally failed job.
 * When the refund actually fired for THIS job, the message says so
 * plainly and names the amount from the job's own charge record —
 * lipSyncChargeForJob(job) at the call sites, the exact figure the
 * refund rail just restored (never a typed-in number, so the words
 * can't drift from the money). The two-argument form defaults to the
 * base charge (LIP_SYNC_JOB_CHARGE_CREDITS) for pre-tier jobs, which
 * is the amount those jobs actually paid. When no refund fired — the
 * gate was already claimed by an earlier path, or the refund write
 * failed — the base message stands alone: a failure never wears a
 * refund it didn't get.
 */
export function lipSyncFailureNotice(
  baseMessage: string,
  refunded: boolean,
  refundedCredits: number = LIP_SYNC_JOB_CHARGE_CREDITS,
): string {
  return refunded
    ? `${baseMessage} Your ${refundedCredits} Visual Bucs were refunded.`
    : baseMessage;
}

/**
 * Boot recovery's terminal failures are failures like any other:
 * their up-front charges refund through the same gate AND the member
 * gets the same failure tell (recovery failures used to refund
 * silently — no notification row ever recorded the outcome). The
 * tell carries the refund verdict off THIS pass's refund result and
 * is composed through the same helper as every live failure path;
 * recordLipSyncOutcome's exactly-once row gate means a replayed
 * recovery pass can never tell twice. The message is read back off
 * the durable row recovery just wrote, so the words are the job's
 * own recorded error.
 */
async function refundRecoveredFailures(newlyFailed: LipSyncJob[]): Promise<void> {
  for (const job of newlyFailed) {
    const refunded = await refundFailedLipSyncCharge(job);
    const fresh = await getLipSyncJob(job.id).catch(() => undefined);
    const message =
      fresh?.error?.message ??
      job.error?.message ??
      "This lip-sync job was interrupted by a server restart and could not be recovered.";
    await recordLipSyncOutcome(job, "failed", "Lip sync failed", lipSyncFailureNotice(truncate(message, 500), refunded, lipSyncChargeForJob(job)));
  }
}

export function startJobPoller(): void {
  if (timer) return;
  // Re-queue submits orphaned by a previous process; resume polling the rest.
  recoverInterruptedLipSyncJobs(MAX_SUBMIT_ATTEMPTS)
    .then(refundRecoveredFailures)
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
    /* Lip-sync failure refunds: retry the ones that never landed (a
       refund write that threw, a process that died mid-failure) —
       DB-backed, restart-safe, exactly-once through the same claim
       gate as the live failure paths. */
    await retryFailedLipSyncRefunds().catch((err) =>
      logger.error({ err }, "[job-poller] lip-sync refund retry phase failed"),
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
  /* Peek first, claim second: a job is only claimed once the live
     route's key is confirmed configured, so jobs for an unconfigured
     route stay queued and untouched. */
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
    const refunded = await refundFailedLipSyncCharge(job);
    await recordLipSyncOutcome(job, "failed", "Lip sync failed", lipSyncFailureNotice(truncate(message, 500), refunded, lipSyncChargeForJob(job)));
  };

  try {
    const { segmentUrl, providerClipUrl, durationSec, inputWidth, inputHeight } =
      await prepareSubmitMedia(job.params);

    if (durationSec > PROVIDER_LIMIT_SEC) {
      await fail(
        `Audio segment is ${durationSec.toFixed(1)}s — exceeds the ${PROVIDER_LIMIT_SEC}s limit of the current lip-sync route. Trim the scene.`,
        "segment_too_long",
      );
      return;
    }

    /* LatentSync has no strength/temperature dial — the A-09 strength
       control is recorded in the job params, and this model exposes no
       such option to send. */
    const providerJobId = await waveSpeedSubmit(providerClipUrl, segmentUrl, apiKey);
    await markJobSubmitted(job.id, providerJobId, 60_000);
    /* Record what was sent (provider, model, probed input dimensions)
       so the completion path can state — on the job record itself —
       whether the returned video is smaller than what was submitted. */
    await mergeLipSyncJobResultMeta(job.id, {
      provider,
      model: getLatentSyncModel(),
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
    await handleWaveSpeedSubmitError(job, err, fail);
    return;
  }
}

/**
 * WaveSpeed submit failures, by kind (see lib/wavespeed.ts):
 * - balance: fail closed at once with a clear provider-unavailable
 *   state — no backoff loop pretending to wait, no resubmit;
 * - transient (provider answered 429/5xx — no task was issued): defer
 *   with the long backoff machinery; a later resubmit is
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
        "The lip-sync provider stayed busy for ~24 hours and the job was not submitted. Try again later.",
      code: "provider_busy_timeout",
    }).catch(() => null);
    if (!deferred) {
      logger.error({ jobId: job.id, err: message }, "[job-poller] deferred submit target vanished; dropping");
      return;
    }
    if (deferred.failed) {
      const refunded = await refundFailedLipSyncCharge(job);
      await recordLipSyncOutcome(job, "failed", "Lip sync failed", lipSyncFailureNotice(truncate(
        "The lip-sync provider stayed busy for about a day, so this job was never submitted. Try again later.",
        500,
      ), refunded, lipSyncChargeForJob(job)));
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
  const fail = async (message: string, code: string) => {
    await failLipSyncJob(job.id, { message, code });
    const refunded = await refundFailedLipSyncCharge(job);
    await recordLipSyncOutcome(job, "failed", "Lip sync failed", lipSyncFailureNotice(truncate(message, 500), refunded));
  };

  /* A polling job stamped with the removed route carries a provider
     job id from a closed account (stack1400). It can never complete:
     fail it honestly (the fail path refunds exactly once) instead of
     polling the live route with a foreign id. */
  if (isRemovedLipSyncProvider(job.params.provider)) {
    await fail(
      "This lip-sync job was submitted on a provider route that is no longer available, so it cannot be finished. Please start a new lip sync.",
      "provider_route_removed",
    );
    return;
  }

  const provider = providerArg ?? resolveJobProvider(job);
  if (!provider) {
    /* No route in effect for this job: polling resumes once one is
       selected/configured (pollDueJobs already skips it — no key can
       resolve for a null provider). */
    return;
  }
  const display = providerDisplayName(provider);

  let remote: { status: string; outputUrl?: string; error?: string };
  try {
    const ws = await waveSpeedStatus(job.providerJobId!, apiKey);
    remote = {
      status: normalizeWaveSpeedStatus(ws),
      outputUrl: ws.outputUrl,
      error: ws.error,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Provider poll failed";
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
      logger.warn({ jobId: job.id, err: message }, "[job-poller] provider busy on status check; backing off");
      return;
    }
    const errors = job.consecutivePollErrors + 1;
    if (errors >= MAX_POLL_ERRORS) {
      await fail(
        `The lip-sync provider could not be reached after ${errors} attempts. Last error: ${message}`,
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
  retryFailedLipSyncRefunds,
  refundRecoveredFailures,
  __setPrepareSubmitMedia: (fn: PrepareSubmitMedia) => {
    prepareSubmitMedia = fn;
  },
};
