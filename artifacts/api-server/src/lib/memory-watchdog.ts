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
 * warn at heapRatio >= 0.75, error at >= 0.90. On a sustained climb
 * it captures exactly ONE heap snapshot per process lifetime,
 * streamed to disk (never buffered in memory — building the snapshot
 * as a string would hasten the OOM it exists to diagnose) and then
 * streamed up to object storage under diagnostics/, so the capture
 * survives the container. If the upload fails, the local path is
 * logged as an EPHEMERAL fallback (Render's disk dies with the
 * container) — it is never presented as durable.
 *
 * Snapshot restraint + teeth (2026-10-25, oom-diagnosis-2026-10-25):
 * on 2026-10-25 production OOM-died nine times on a slow heap climb
 * (the never-evict store family, fixed the same day). The old
 * trigger fired the one-shot snapshot at heapRatio 0.85 — exactly
 * the heapUsed (343 MB) the watchdog showed minutes before the
 * 20:56 kill. Serializing a heap that large allocates heavily, so
 * the snapshot plausibly administered the coup de grâce: "85% and
 * climbing" became "dead now", every cycle. The snapshot therefore
 * now requires a SUSTAINED climb (2 consecutive ticks at >= 0.92)
 * and is skipped entirely once the critical line is crossed or the
 * container has no RSS headroom left — at that point saving the
 * process outranks naming the retainer.
 *
 * And the watchdog finally acts: at the critical line (heapRatio
 * >= 0.96, or RSS >= 98% of the container budget) sustained for 2
 * consecutive ticks, it fires the registered critical handler —
 * index.ts wires that to a controlled restart (stop accepting
 * connections, bounded drain, exit) so the platform restarts the
 * process BEFORE the container verdict kills it mid-request. An
 * uncontrolled kill loses whatever the process was holding; a
 * controlled exit hands in-flight work to the boot-recovery
 * machinery this server already runs after every restart. With no
 * handler registered the default action is a plain process.exit(1)
 * after the fatal log line.
 */
import { getHeapSnapshot, getHeapStatistics } from "node:v8";
import { createWriteStream, readdirSync, readFileSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { logger } from "./logger";

const CONTAINER_BUDGET_MB = Number(process.env["CONTAINER_MEMORY_MB"] ?? 512);
const WARN_RATIO = 0.8;
const LOG_INTERVAL_MS = 60_000;

const HEAP_WARN_RATIO = 0.75;
const HEAP_ERROR_RATIO = 0.9;
/** Snapshot trigger — raised from 0.85 to 0.92 and gated on a
 * sustained climb (SNAPSHOT_CONFIRM_TICKS consecutive ticks): at
 * 0.85 the capture itself was a kill risk (see the header note). */
const HEAP_SNAPSHOT_RATIO = 0.92;
const SNAPSHOT_CONFIRM_TICKS = 2;
/** A capture is abandoned if the heap has already fallen back below
 * this by the time the stream opens — a transient spike is not a
 * climb, and the one-shot capture stays available. */
const SNAPSHOT_ABANDON_BELOW_RATIO = 0.88;
/** No snapshot when RSS is already this close to the container
 * budget — there is no headroom left to serialize into. */
const SNAPSHOT_RSS_HEADROOM_RATIO = 0.95;
/** The critical line: at/above it (sustained for
 * CRITICAL_CONFIRM_TICKS consecutive ticks) the watchdog stops
 * diagnosing and acts — controlled restart via the registered
 * handler — before the container's OOM verdict lands. */
const HEAP_CRITICAL_RATIO = 0.96;
const RSS_CRITICAL_RATIO = 0.98;
const CRITICAL_CONFIRM_TICKS = 2;

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

/* ── Child-process tree sampling (2026-10-29, stack800 lane 9) ──────────
 * The export-restart hunt proved the watchdog's structural blindness:
 * it samples only this Node process (process.memoryUsage), while the
 * container's OOM verdict falls on Node + children together — the
 * ffmpeg child that actually burst the 512 MB container (262 MB peak
 * against Node's calm ~280 MB) was invisible in every watchdog line,
 * so the gauges read calm through the kill. The tick now also samples
 * the child process TREE (descendants of this process, via /proc) and
 * carries the totals on the same log lines: how many children, their
 * combined RSS, and the single largest child by name — the "true peak
 * shape" the next OOM investigation needs.
 *
 * SAMPLING ONLY, by design: the child figures never feed the snapshot
 * trigger or the critical line. The restart policy stays exactly the
 * one the 2026-10-25 diagnosis tuned (Node heap ratio / Node RSS) —
 * widening the watchdog's eyes must not silently widen its teeth. */
export interface ProcTableRow {
  pid: number;
  ppid: number;
  rssMb: number;
  comm: string;
}

export interface ChildTreeSample {
  childCount: number;
  childRssMb: number;
  childTopName: string | null;
  childTopRssMb: number;
}

/** Pure aggregation: every descendant of rootPid (children,
 * grandchildren, …), never the root itself and never unrelated
 * processes that merely share the table. Exported for the unit test. */
export function aggregateChildTree(
  rows: ProcTableRow[],
  rootPid: number,
): ChildTreeSample {
  const byParent = new Map<number, ProcTableRow[]>();
  for (const row of rows) {
    const siblings = byParent.get(row.ppid);
    if (siblings) siblings.push(row);
    else byParent.set(row.ppid, [row]);
  }
  let childCount = 0;
  let totalRss = 0;
  let top: ProcTableRow | null = null;
  const queue = [...(byParent.get(rootPid) ?? [])];
  /* Seeded with the root: a corrupt table whose ppid chain cycles
   * back to the root must neither loop nor count the root as its own
   * child. */
  const seen = new Set<number>([rootPid]);
  while (queue.length > 0) {
    const row = queue.shift()!;
    if (seen.has(row.pid)) continue; // a corrupt table must not loop us
    seen.add(row.pid);
    childCount++;
    totalRss += row.rssMb;
    if (!top || row.rssMb > top.rssMb) top = row;
    queue.push(...(byParent.get(row.pid) ?? []));
  }
  return {
    childCount,
    childRssMb: Math.round(totalRss * 10) / 10,
    childTopName: top ? top.comm : null,
    childTopRssMb: top ? Math.round(top.rssMb * 10) / 10 : 0,
  };
}

/** Read the Linux process table from /proc: comm + ppid from stat
 * (comm is parenthesised and may itself contain spaces/parens — slice
 * between the first "(" and the last ")"), RSS from status VmRSS.
 * Returns [] wherever /proc does not exist (non-Linux dev machines)
 * and skips processes that vanish mid-scan. NEVER throws — a sampling
 * failure must not be able to break the tick that carries it. */
export function readProcTable(): ProcTableRow[] {
  try {
    const rows: ProcTableRow[] = [];
    for (const name of readdirSync("/proc")) {
      if (!/^\d+$/.test(name)) continue;
      const pid = Number(name);
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
        const open = stat.indexOf("(");
        const close = stat.lastIndexOf(")");
        if (open < 0 || close < 0) continue;
        const comm = stat.slice(open + 1, close);
        const rest = stat.slice(close + 2).split(" ");
        const ppid = Number(rest[1]); // fields: state(3) ppid(4) …
        if (!Number.isFinite(ppid)) continue;
        const status = readFileSync(`/proc/${pid}/status`, "utf8");
        const rssMatch = /^VmRSS:\s+(\d+)\s*kB/m.exec(status);
        const rssMb = rssMatch ? Number(rssMatch[1]) / 1024 : 0;
        rows.push({ pid, ppid, rssMb, comm });
      } catch {
        /* the process exited between listing and reading — skip it */
      }
    }
    return rows;
  } catch {
    return [];
  }
}

/** One child-tree sample for the watchdog tick. */
export function sampleChildTree(rootPid: number = process.pid): ChildTreeSample {
  return aggregateChildTree(readProcTable(), rootPid);
}

let snapshotCaptured = false;
let inflightSnapshot: Promise<void> | null = null;
/** Consecutive ticks at/above the snapshot ratio — the sustained-
 * climb gate in front of the one-shot capture. */
let snapshotHighTicks = 0;
/** Consecutive ticks at/above the critical line. */
let criticalTicks = 0;
/** The critical action fires exactly once per process lifetime. */
let criticalFired = false;

/** Test hook: the in-flight snapshot capture, if one was triggered. */
export function getInflightSnapshotCapture(): Promise<void> | null {
  return inflightSnapshot;
}

let memoryCriticalHandler: (() => void) | null = null;

/**
 * Register the controlled-restart action for the critical line.
 * index.ts wires this to its HTTP server (close + bounded drain +
 * exit). Registered once at boot; pass null to restore the default
 * (log + process.exit(1)).
 */
export function setMemoryCriticalHandler(fn: (() => void) | null): void {
  memoryCriticalHandler = fn;
}

function fireCriticalAction(fields: MemoryWatchdogFields): void {
  criticalFired = true;
  logger.error(
    fields,
    "memory watchdog: CRITICAL — at the container's edge for 2 consecutive ticks; controlled restart before the OOM kill",
  );
  if (memoryCriticalHandler) {
    try {
      memoryCriticalHandler();
      return;
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        "memory watchdog: critical handler threw — exiting directly",
      );
    }
  }
  process.exit(1);
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
 * act at the critical line, and trigger the one-shot snapshot on a
 * sustained climb below it. Exported for the unit test; the
 * interval below is the only production caller.
 */
export function runMemoryWatchdogTick(): void {
  const fields = sampleMemoryFields();
  /* Child-tree sample rides the periodic log lines only — the
   * escalation and critical decisions below keep reading `fields`
   * (this process alone), exactly as the restart policy was tuned. */
  const logFields = { ...fields, ...sampleChildTree() };
  const rssOver = fields.rssMb > CONTAINER_BUDGET_MB * WARN_RATIO;

  if (fields.heapRatio >= HEAP_ERROR_RATIO) {
    logger.error(
      logFields,
      "memory watchdog: heap at >= 90% of the V8 limit — OOM imminent",
    );
  } else if (fields.heapRatio >= HEAP_WARN_RATIO) {
    logger.warn(logFields, "memory watchdog: heap above 75% of the V8 limit");
  } else if (rssOver) {
    logger.warn(logFields, "memory watchdog: RSS above 80% of container budget");
  } else {
    logger.info(logFields, "memory watchdog");
  }

  /* Critical line first: once the process is at the edge, saving
   * it outranks diagnosing it — no snapshot competes with the
   * restart for the last of the memory. */
  const atCritical =
    fields.heapRatio >= HEAP_CRITICAL_RATIO ||
    fields.rssMb >= CONTAINER_BUDGET_MB * RSS_CRITICAL_RATIO;
  criticalTicks = atCritical ? criticalTicks + 1 : 0;
  if (criticalTicks >= CRITICAL_CONFIRM_TICKS && !criticalFired) {
    fireCriticalAction(fields);
    return;
  }
  if (atCritical) return;

  /* Snapshot: only on a sustained climb (>= 0.92 twice running),
   * only with RSS headroom to serialize into, and still one-shot. */
  snapshotHighTicks =
    fields.heapRatio >= HEAP_SNAPSHOT_RATIO ? snapshotHighTicks + 1 : 0;
  if (
    snapshotHighTicks >= SNAPSHOT_CONFIRM_TICKS &&
    !snapshotCaptured &&
    fields.rssMb < CONTAINER_BUDGET_MB * SNAPSHOT_RSS_HEADROOM_RATIO
  ) {
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
