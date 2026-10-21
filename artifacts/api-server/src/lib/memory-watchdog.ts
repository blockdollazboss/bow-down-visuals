/**
 * memory-watchdog.ts — periodic process memory logging + heap snapshot.
 * (2026-10-12, OOM fix; heap-ratio + snapshot added 2026-10-15.)
 *
 * Before this, the api-server had zero memory observability — no
 * process.memoryUsage() call existed anywhere, so every Render OOM
 * kill arrived with no in-process evidence (oom-investigation.md).
 * The watchdog logs RSS / heap / external buffers every 60s through
 * the pino logger and escalates to warn above 80% of the container
 * budget so the next OOM has a paper trail.
 *
 * Heap-ratio escalation (2026-10-15): the 2026-10-14 staging OOMs died
 * at the V8 heap cap while the diary only showed rates, never the
 * retainer. The tick now also logs heapUsed against the authoritative
 * V8 limit (v8.getHeapStatistics().heap_size_limit — the
 * --max-old-space-size actually in force, no env guessing):
 * warn at heapRatio >= 0.75, error at >= 0.90. On the first tick at
 * >= 0.85 it captures exactly ONE heap snapshot per process lifetime,
 * streamed to disk (never buffered in memory — building the snapshot
 * as a string would hasten the OOM it exists to diagnose) and then
 * streamed up to object storage under diagnostics/, so the capture
 * survives the container. If the upload fails, the local path is
 * logged as an EPHEMERAL fallback (Render's disk dies with the
 * container) — it is never presented as durable.
 */
import { getHeapSnapshot, getHeapStatistics } from "node:v8";
import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { logger } from "./logger";

const CONTAINER_BUDGET_MB = Number(process.env["CONTAINER_MEMORY_MB"] ?? 512);
const WARN_RATIO = 0.8;
const LOG_INTERVAL_MS = 60_000;

const HEAP_WARN_RATIO = 0.75;
const HEAP_SNAPSHOT_RATIO = 0.85;
const HEAP_ERROR_RATIO = 0.9;
/** A capture triggered at >= 0.85 is abandoned if the heap has already
 * fallen back below this by the time the stream opens — a transient
 * spike is not a climb, and the one-shot capture stays available. */
const SNAPSHOT_ABANDON_BELOW_RATIO = 0.8;

const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

export interface MemoryWatchdogFields {
  rssMb: number;
  heapUsedMb: number;
  heapTotalMb: number;
  externalMb: number;
  arrayBuffersMb: number;
  budgetMb: number;
  heapLimitMb: number;
  heapRatio: number;
}

export function sampleMemoryFields(): MemoryWatchdogFields {
  const m = process.memoryUsage();
  const heapLimitBytes = getHeapStatistics().heap_size_limit;
  return {
    rssMb: mb(m.rss),
    heapUsedMb: mb(m.heapUsed),
    heapTotalMb: mb(m.heapTotal),
    externalMb: mb(m.external),
    arrayBuffersMb: mb(m.arrayBuffers ?? 0),
    budgetMb: CONTAINER_BUDGET_MB,
    heapLimitMb: mb(heapLimitBytes),
    heapRatio:
      heapLimitBytes > 0
        ? Math.round((m.heapUsed / heapLimitBytes) * 1000) / 1000
        : 0,
  };
}

let snapshotCaptured = false;
let inflightSnapshot: Promise<void> | null = null;

/** Test hook: the in-flight snapshot capture, if one was triggered. */
export function getInflightSnapshotCapture(): Promise<void> | null {
  return inflightSnapshot;
}

async function captureHeapSnapshot(): Promise<void> {
  // Re-sample before opening the stream: if the heap already fell
  // back, this was a transient spike — keep the one shot for a real
  // climb instead of burning it.
  const now = sampleMemoryFields();
  if (now.heapRatio < SNAPSHOT_ABANDON_BELOW_RATIO) {
    snapshotCaptured = false;
    logger.info(
      now,
      "memory watchdog: heap fell back before snapshot opened — capture skipped (transient spike)",
    );
    return;
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `heap-${process.pid}-${stamp}.heapsnapshot`;
  const dir = process.env["HEAP_SNAPSHOT_DIR"] ?? tmpdir();
  const filePath = join(dir, fileName);

  // Stream the snapshot to disk — never materialise it in memory.
  await pipeline(getHeapSnapshot(), createWriteStream(filePath));

  try {
    // Dynamic import: the watchdog starts before the rest of the
    // server graph; object storage is only needed on this rare path.
    const { uploadFileStreamToSupabaseStorage, SUPABASE_CLIPS_BUCKET } =
      await import("./objectStorage");
    const objectName = `diagnostics/${fileName}`;
    const ref = await uploadFileStreamToSupabaseStorage(
      SUPABASE_CLIPS_BUCKET,
      objectName,
      filePath,
      "application/octet-stream",
    );
    logger.error(
      { ...now, snapshotRef: ref },
      "memory watchdog: heap snapshot captured to storage — retrieve it to name the retainer",
    );
    await unlink(filePath).catch(() => {});
  } catch (uploadErr) {
    logger.error(
      {
        ...now,
        snapshotPath: filePath,
        err:
          uploadErr instanceof Error ? uploadErr.message : String(uploadErr),
      },
      "memory watchdog: heap snapshot saved LOCALLY ONLY (ephemeral — dies with the container); storage upload failed",
    );
  }
}

/**
 * One watchdog tick: log the sample, escalate on RSS or heap ratio,
 * and trigger the one-shot snapshot on approach to the heap limit.
 * Exported for the unit test; the interval below is the only
 * production caller.
 */
export function runMemoryWatchdogTick(): void {
  const fields = sampleMemoryFields();
  const rssOver = fields.rssMb > CONTAINER_BUDGET_MB * WARN_RATIO;

  if (fields.heapRatio >= HEAP_ERROR_RATIO) {
    logger.error(
      fields,
      "memory watchdog: heap at >= 90% of the V8 limit — OOM imminent",
    );
  } else if (fields.heapRatio >= HEAP_WARN_RATIO) {
    logger.warn(fields, "memory watchdog: heap above 75% of the V8 limit");
  } else if (rssOver) {
    logger.warn(fields, "memory watchdog: RSS above 80% of container budget");
  } else {
    logger.info(fields, "memory watchdog");
  }

  if (fields.heapRatio >= HEAP_SNAPSHOT_RATIO && !snapshotCaptured) {
    snapshotCaptured = true;
    inflightSnapshot = captureHeapSnapshot().catch((err) => {
      // A failed capture must never take the server down with it.
      logger.error(
        {
          ...fields,
          err: err instanceof Error ? err.message : String(err),
        },
        "memory watchdog: heap snapshot capture failed",
      );
    });
  }
}

let started = false;

export function startMemoryWatchdog(): void {
  if (started) return;
  started = true;
  const timer = setInterval(runMemoryWatchdogTick, LOG_INTERVAL_MS);
  timer.unref?.();
}
