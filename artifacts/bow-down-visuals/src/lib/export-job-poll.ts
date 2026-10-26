/**
 * Poll a background export job (POST /api/export-final-video → 202 { jobId })
 * until it completes or fails.
 *
 * Exports now render in the background because a full video render takes
 * minutes — longer than the hosting proxy keeps an HTTP request open (the old
 * synchronous design died with a 502). Resolves with the export result payload
 * ({ url, ... }); rejects with an Error carrying .code / .exportStatus /
 * .stderrTail / .ffmpegExitCode so existing export error handling keeps working.
 */
export interface ExportJobPollResult {
  url: string;
  [key: string]: unknown;
}

import {
  MAX_CONSECUTIVE_POLL_FAILURES,
  PollFailureBudget,
  isTransientPollHttpStatus,
} from "./poll-tolerance";

/* Re-exported for existing importers; the canonical definition lives in
 * lib/poll-tolerance.ts, shared by every editor job poller. */
export { MAX_CONSECUTIVE_POLL_FAILURES };

class TransientPollError extends Error {}

export interface ExportJobFailure extends Error {
  code?: string;
  exportStatus?: unknown;
  stderrTail?: string[];
  ffmpegExitCode?: number | null;
}

/**
 * Machine-readable failure kinds the poller stamps on `.code` so the
 * export surface can pick honest copy per outcome (FinalVideoExport):
 *  - a server-reported terminal failure keeps the server's own code
 *    (or "export_failed" when it sent none) — the job is over and the
 *    rail has released any hold (see runExportJobInBackground);
 *  - "poll_lost_contact" — status checks themselves kept failing; the
 *    job's outcome is UNKNOWN (it may still finish server-side);
 *  - "poll_timeout" — the overall deadline passed with the job still
 *    reporting in-progress; outcome likewise unknown;
 *  - "unknown_status" — a 200 answer carried no recognisable status;
 *    the job can no longer be followed from here;
 *  - "http_<status>" — a non-transient HTTP answer (401/403/404…).
 */
export const EXPORT_POLL_LOST_CONTACT_CODE = "poll_lost_contact";
export const EXPORT_POLL_TIMEOUT_CODE = "poll_timeout";
export const EXPORT_POLL_UNKNOWN_STATUS_CODE = "unknown_status";

/**
 * How long one unbroken outage of status checks may last before the
 * poller gives up (orphan-wave export-poll-stop, Oct 26).
 *
 * The consecutive-failure budget alone could not stop the observed
 * stuck export: a flapping connection interleaved just enough
 * successful "still running" answers to reset the budget forever, so
 * the client sat in "Stitching" until the 45-minute render deadline.
 * An outage episode therefore has its own wall-clock window. It only
 * clears after TWO consecutive good polls — one lucky answer in the
 * middle of an outage does not prove the connection recovered.
 */
export const STATUS_CHECK_OUTAGE_WINDOW_MS = 90 * 1000;

/** Successes in a row required to declare a status-check outage over. */
export const POLL_RECOVERY_SUCCESSES = 2;

/** Statuses that mean "still working" — anything else in a 200 payload
 *  that is not done/failed is unrecognisable and terminal for the
 *  poller: polling a dead or moved job until the render deadline is
 *  exactly the stuck state this lane exists to remove. */
const IN_PROGRESS_STATUSES = new Set(["queued", "active", "running", "pending", "processing"]);

/**
 * Delay before the next poll after `consecutiveFailures` transient
 * status-check failures in a row: exponential backoff from the base
 * cadence (x2 per failure), capped at 8x the base and at 30s, so an
 * outage is not hammered at the healthy 3s cadence.
 */
export function pollFailureBackoffMs(pollMs: number, consecutiveFailures: number): number {
  const exp = Math.min(Math.max(consecutiveFailures, 1), 3);
  return Math.min(pollMs * 2 ** exp, 30 * 1000);
}

function lostContactError(): ExportJobFailure {
  return Object.assign(
    new Error(
      "Export status checks kept failing — we've stopped checking. " +
        "The export itself may still be rendering on the server.",
    ),
    { code: EXPORT_POLL_LOST_CONTACT_CODE },
  ) satisfies Partial<ExportJobFailure> as ExportJobFailure;
}

function timeoutError(): ExportJobFailure {
  return Object.assign(
    new Error(
      "The export is taking longer than expected — it may still be rendering on the server. " +
        "Please wait a bit before trying again.",
    ),
    { code: EXPORT_POLL_TIMEOUT_CODE },
  ) satisfies Partial<ExportJobFailure> as ExportJobFailure;
}

/**
 * Overall poll deadline for an export job (Stack-100 #3, Lane D item A-10).
 *
 * The old flat 20-minute cap fired while the server was still legally
 * rendering: the export rail budgets EACH phase-1 ffmpeg step at
 * max(10 min, 10x that clip's duration) (export-video.ts runFfmpeg) and the
 * two delivery passes at 8 minutes each, so a long video could finish — and
 * be saved server-side — long after the client had declared a timeout.
 *
 * The deadline therefore scales with the media being rendered, mirroring
 * the server's own 10x rule with headroom for the passes:
 *   max(45 min floor, 12x duration + 15 min)
 * The 45-minute floor covers the multi-step path for short/multi-scene
 * exports (several phase-1 steps at their 10-minute floors plus both
 * passes). An explicit `timeoutMs` from the caller still wins.
 */
export function exportPollDeadlineMs(durationSec?: number): number {
  const FLOOR_MS = 45 * 60 * 1000;
  if (typeof durationSec !== "number" || !Number.isFinite(durationSec) || durationSec <= 0) {
    return FLOOR_MS;
  }
  return Math.max(FLOOR_MS, 12 * durationSec * 1000 + 15 * 60 * 1000);
}

export async function pollExportJob(opts: {
  jobId: string;
  getAccessToken: () => Promise<string | null>;
  /**
   * Overall deadline. Default: derived from `durationSec` via
   * exportPollDeadlineMs (45-minute floor) — the server's legal render
   * time exceeds the old flat 20 minutes for long videos.
   */
  timeoutMs?: number;
  /** Media duration (seconds) the job will render, when the caller knows it. */
  durationSec?: number;
  /** Delay between polls; default 3s. */
  pollMs?: number;
  onProgress?: (stage: string, progress: number) => void;
}): Promise<ExportJobPollResult> {
  const { jobId, getAccessToken } = opts;
  const timeoutMs = opts.timeoutMs ?? exportPollDeadlineMs(opts.durationSec);
  const pollMs = opts.pollMs ?? 3000;
  const deadline = Date.now() + timeoutMs;

  /* Stall hardening (Stack-200 item 187): the job is DURABLE server-side,
     so a single transient poll failure — a network blip, a 30s per-poll
     abort during a deploy swap, a 5xx from the proxy — must not kill the
     client's view of a healthy render. Transient failures are tolerated
     up to a consecutive budget inside the same overall deadline; a
     non-transient HTTP error (4xx other than 429) still surfaces at
     once, and exhausting the budget surfaces the failure plainly. */
  const pollBudget = new PollFailureBudget();

  /* Orphan-wave export-poll-stop (Oct 26): the consecutive budget alone
     did not stop the live stuck export — flapping status checks kept
     resetting it with an occasional "running" answer, and the UI sat in
     "Stitching" for 5+ minutes (in the worst case, until the 45-minute
     deadline). Three bounds now apply together:
       1. the consecutive-failure budget above (pure outage);
       2. an outage-episode window: once checks start failing, the
          episode clock runs until POLL_RECOVERY_SUCCESSES good polls in
          a row prove recovery — past STATUS_CHECK_OUTAGE_WINDOW_MS the
          poller stops with poll_lost_contact;
       3. exponential backoff between retries during an outage.
     An unrecognisable status in a 200 answer is terminal at once: the
     job is dead, moved, or speaking a protocol we cannot follow. */
  let outageStartedAt: number | null = null;
  let successStreak = 0;
  let nextDelayMs = pollMs;

  for (;;) {
    await new Promise((r) => setTimeout(r, nextDelayMs));
    let job: {
      status: string;
      stage?: string;
      progress?: number;
      result?: ExportJobPollResult;
      error?: { message?: string; code?: string; exportStatus?: unknown; stderrTail?: string[]; ffmpegExitCode?: number | null };
    };
    try {
      const token = await getAccessToken();
      const res = await fetch(`/api/export-video-job/${encodeURIComponent(jobId)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(30 * 1000),
      });
      if (!res.ok) {
        if (isTransientPollHttpStatus(res.status)) {
          throw new TransientPollError(`Export status check failed (HTTP ${res.status})`);
        }
        throw Object.assign(new Error(`Export status check failed (HTTP ${res.status})`), {
          code: `http_${res.status}`,
        }) satisfies Partial<ExportJobFailure> as ExportJobFailure;
      }
      job = (await res.json()) as typeof job;
      pollBudget.noteSuccess();
      nextDelayMs = pollMs;
      successStreak += 1;
      if (successStreak >= POLL_RECOVERY_SUCCESSES) {
        outageStartedAt = null;
      }
    } catch (err) {
      if (err instanceof Error && !(err instanceof TransientPollError) && err.message.startsWith("Export status check failed")) {
        throw err;
      }
      if (outageStartedAt === null) outageStartedAt = Date.now();
      successStreak = 0;
      nextDelayMs = pollFailureBackoffMs(pollMs, pollBudget.failures + 1);
      if (!pollBudget.noteTransientFailure()) {
        throw lostContactError();
      }
      if (Date.now() - outageStartedAt > STATUS_CHECK_OUTAGE_WINDOW_MS) {
        throw lostContactError();
      }
      if (Date.now() > deadline) {
        throw timeoutError();
      }
      continue;
    }
    if (job.status !== "done" && job.status !== "failed" && !IN_PROGRESS_STATUSES.has(job.status)) {
      throw Object.assign(
        new Error(
          `Export status check returned an unexpected status (${JSON.stringify(job.status ?? null)}) — ` +
            "this export can no longer be followed from here, so we've stopped checking.",
        ),
        { code: EXPORT_POLL_UNKNOWN_STATUS_CODE },
      ) satisfies Partial<ExportJobFailure> as ExportJobFailure;
    }
    if (job.stage && opts.onProgress) {
      opts.onProgress(job.stage, typeof job.progress === "number" ? job.progress : 0);
    }
    if (job.status === "done") {
      if (!job.result?.url) throw new Error("Export finished but returned no download URL");
      return job.result;
    }
    if (job.status === "failed") {
      const e = job.error ?? {};
      throw Object.assign(new Error(e.message ?? "Export failed"), {
        code: e.code ?? "export_failed",
        exportStatus: e.exportStatus,
        stderrTail: e.stderrTail,
        ffmpegExitCode: e.ffmpegExitCode ?? null,
      } satisfies Partial<ExportJobFailure>);
    }
    if (Date.now() > deadline) {
      // Honest copy: there is no user-facing surface that lists export
      // jobs, so never point the user at one (Lane D item A-10).
      throw timeoutError();
    }
  }
}
