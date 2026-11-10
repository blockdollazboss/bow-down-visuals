import {
  isR2Configured,
  r2AbortMultipartUpload,
  r2ListMultipartUploads,
} from "./r2-client";
import { logger } from "./logger";

/* ── Bucket-wide orphan multipart sweep (stack400 C-08 follow-on) ───────
   The in-process sweep in routes/r2-upload.ts aborts stale multipart
   sessions the CURRENT process started. Sessions orphaned by a restart,
   a crash, or another instance are invisible to it — the bucket's own
   listing (r2ListMultipartUploads) is the only place they exist. This
   sweep is that listing's consumer.

   Safety by construction:
   - Abort ONLY an upload whose Initiated timestamp PROVES it older
     than the house horizon (24h, the same horizon SESSION_MAX_AGE_MS
     and the recorded bucket rule in infra/r2/README.md use). Missing
     or unparseable age is never enough — the upload is skipped.
   - An upload the live tracker holds is never aborted here: in-window
     it is actively in flight; past-window the in-process sweep owns it
     (both sweeps ride the same multipart-init trigger).
   - Fail-open per upload: one bad abort is logged and counted, never
     stops the sweep. A failed listing — or R2 not configured at all —
     degrades to a logged no-op. This function never throws.

   Cadence: callers invoke it on the same lazy trigger as the
   in-process sweep (multipart init), but listing the bucket on every
   init would be wasteful, so runs are throttled to one per interval;
   `force` bypasses the throttle (tests, one-off operator runs). */

export const R2_BUCKET_SWEEP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const R2_BUCKET_SWEEP_MIN_INTERVAL_MS = 60 * 60 * 1000;

let lastSweepAt = 0;

export interface R2BucketSweepOptions {
  /** Epoch ms to judge ages against. Defaults to Date.now(). */
  now?: number;
  /** Age horizon override. Defaults to R2_BUCKET_SWEEP_MAX_AGE_MS. */
  maxAgeMs?: number;
  /** Bypass the once-per-interval throttle. */
  force?: boolean;
  /** The live tracker's view: uploadId -> startedAt (epoch ms), or
   *  null/undefined when the tracker does not hold the upload. */
  trackedStartedAt?: (uploadId: string) => number | null | undefined;
}

export interface R2BucketSweepSummary {
  ran: boolean;
  reason?: "not-configured" | "throttled" | "list-failed";
  listed: number;
  aborted: number;
  skippedYoung: number;
  skippedTracked: number;
  skippedUnknownAge: number;
  skippedMalformed: number;
  abortFailures: number;
}

function emptySummary(ran: boolean, reason?: R2BucketSweepSummary["reason"]): R2BucketSweepSummary {
  return {
    ran,
    reason,
    listed: 0,
    aborted: 0,
    skippedYoung: 0,
    skippedTracked: 0,
    skippedUnknownAge: 0,
    skippedMalformed: 0,
    abortFailures: 0,
  };
}

/** Coerce an Initiated value to epoch ms, or null when it cannot prove
 *  an age. The list primitive hands back Date | null; anything else a
 *  listing source produces is judged just as strictly. */
function initiatedMs(value: unknown): number | null {
  if (value == null) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value as string).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export async function sweepOrphanedMultipartUploads(
  opts: R2BucketSweepOptions = {},
): Promise<R2BucketSweepSummary> {
  const now = opts.now ?? Date.now();
  const maxAgeMs = opts.maxAgeMs ?? R2_BUCKET_SWEEP_MAX_AGE_MS;

  if (!isR2Configured()) {
    logger.info(
      { event: "r2_bucket_sweep_skipped", reason: "not_configured" },
      "r2 bucket sweep skipped: R2 not configured",
    );
    return emptySummary(false, "not-configured");
  }

  if (!opts.force && lastSweepAt > 0 && now - lastSweepAt < R2_BUCKET_SWEEP_MIN_INTERVAL_MS) {
    return emptySummary(false, "throttled");
  }
  lastSweepAt = now;

  let uploads: unknown;
  try {
    uploads = await r2ListMultipartUploads();
  } catch (err) {
    logger.error(
      { event: "r2_bucket_sweep_list_failed", err: err instanceof Error ? err.message : String(err) },
      "r2 bucket sweep: listing multipart uploads failed; sweep skipped",
    );
    return emptySummary(false, "list-failed");
  }
  if (!Array.isArray(uploads)) {
    logger.error(
      { event: "r2_bucket_sweep_list_failed", reason: "listing_not_array" },
      "r2 bucket sweep: listing did not return an array; sweep skipped",
    );
    return emptySummary(false, "list-failed");
  }

  const summary = emptySummary(true);
  summary.listed = uploads.length;

  for (const entry of uploads) {
    const e = entry as { key?: unknown; uploadId?: unknown; initiated?: unknown } | null;
    if (
      !e ||
      typeof e.key !== "string" ||
      e.key.length === 0 ||
      typeof e.uploadId !== "string" ||
      e.uploadId.length === 0
    ) {
      summary.skippedMalformed += 1;
      logger.warn(
        { event: "r2_bucket_sweep_skip", reason: "malformed_entry" },
        "r2 bucket sweep: skipped malformed listing entry",
      );
      continue;
    }
    const key = e.key;
    const uploadId = e.uploadId;

    const initiated = initiatedMs(e.initiated);
    if (initiated === null) {
      summary.skippedUnknownAge += 1;
      logger.info(
        { event: "r2_bucket_sweep_skip", reason: "unknown_age", key, uploadId },
        "r2 bucket sweep: skipped upload with unprovable age",
      );
      continue;
    }

    const ageMs = now - initiated;
    if (ageMs <= maxAgeMs) {
      summary.skippedYoung += 1;
      continue;
    }

    const trackedStart = opts.trackedStartedAt?.(uploadId);
    if (trackedStart != null) {
      summary.skippedTracked += 1;
      logger.info(
        {
          event: "r2_bucket_sweep_skip",
          reason: now - trackedStart <= maxAgeMs ? "tracked_in_flight" : "tracked_owned_by_process_sweep",
          key,
          uploadId,
          ageMs,
          trackedAgeMs: now - trackedStart,
        },
        "r2 bucket sweep: skipped upload held by the live tracker",
      );
      continue;
    }

    try {
      await r2AbortMultipartUpload(key, uploadId);
      summary.aborted += 1;
      logger.info(
        { event: "r2_bucket_sweep_aborted", key, uploadId, ageMs },
        "r2 bucket sweep: aborted orphaned multipart upload",
      );
    } catch (err) {
      summary.abortFailures += 1;
      logger.error(
        {
          event: "r2_bucket_sweep_abort_failed",
          key,
          uploadId,
          ageMs,
          err: err instanceof Error ? err.message : String(err),
        },
        "r2 bucket sweep: abort failed for orphaned multipart upload",
      );
    }
  }

  logger.info(
    {
      event: "r2_bucket_sweep_complete",
      listed: summary.listed,
      aborted: summary.aborted,
      skippedYoung: summary.skippedYoung,
      skippedTracked: summary.skippedTracked,
      skippedUnknownAge: summary.skippedUnknownAge,
      skippedMalformed: summary.skippedMalformed,
      abortFailures: summary.abortFailures,
      maxAgeMs,
    },
    "r2 bucket sweep complete",
  );
  return summary;
}
