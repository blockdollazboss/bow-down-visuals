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

export interface ExportJobFailure extends Error {
  code?: string;
  exportStatus?: unknown;
  stderrTail?: string[];
  ffmpegExitCode?: number | null;
}

export async function pollExportJob(opts: {
  jobId: string;
  getAccessToken: () => Promise<string | null>;
  /** Overall deadline; default 20 minutes. */
  timeoutMs?: number;
  /** Delay between polls; default 3s. */
  pollMs?: number;
  onProgress?: (stage: string, progress: number) => void;
}): Promise<ExportJobPollResult> {
  const { jobId, getAccessToken } = opts;
  const timeoutMs = opts.timeoutMs ?? 20 * 60 * 1000;
  const pollMs = opts.pollMs ?? 3000;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    await new Promise((r) => setTimeout(r, pollMs));
    const token = await getAccessToken();
    const res = await fetch(`/api/export-video-job/${encodeURIComponent(jobId)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(30 * 1000),
    });
    if (!res.ok) {
      throw new Error(`Export status check failed (HTTP ${res.status})`);
    }
    const job = (await res.json()) as {
      status: string;
      stage?: string;
      progress?: number;
      result?: ExportJobPollResult;
      error?: { message?: string; code?: string; exportStatus?: unknown; stderrTail?: string[]; ffmpegExitCode?: number | null };
    };
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
      throw new Error(
        "The export is taking longer than expected — it may still be rendering on the server. " +
          "Please wait a bit and check the Exports history.",
      );
    }
  }
}
