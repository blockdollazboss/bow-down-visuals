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

  for (;;) {
    await new Promise((r) => setTimeout(r, pollMs));
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
        throw new Error(`Export status check failed (HTTP ${res.status})`);
      }
      job = (await res.json()) as typeof job;
      pollBudget.noteSuccess();
    } catch (err) {
      if (err instanceof Error && !(err instanceof TransientPollError) && err.message.startsWith("Export status check failed")) {
        throw err;
      }
      if (!pollBudget.noteTransientFailure()) {
        throw new Error(
          "Export status checks kept failing — the export itself may still be rendering on the server. " +
            "Please wait a bit before trying again.",
        );
      }
      if (Date.now() > deadline) {
        throw new Error(
          "The export is taking longer than expected — it may still be rendering on the server. " +
            "Please wait a bit before trying again.",
        );
      }
      continue;
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
        code: e.code,
        exportStatus: e.exportStatus,
        stderrTail: e.stderrTail,
        ffmpegExitCode: e.ffmpegExitCode ?? null,
      } satisfies Partial<ExportJobFailure>);
    }
    if (Date.now() > deadline) {
      // Honest copy: there is no user-facing surface that lists export
      // jobs, so never point the user at one (Lane D item A-10).
      throw new Error(
        "The export is taking longer than expected — it may still be rendering on the server. " +
          "Please wait a bit before trying again.",
      );
    }
  }
}
