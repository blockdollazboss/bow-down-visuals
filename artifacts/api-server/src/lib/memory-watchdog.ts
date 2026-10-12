/**
 * memory-watchdog.ts — periodic process memory logging.
 * (2026-10-12, OOM fix.)
 *
 * Before this, the api-server had zero memory observability — no
 * process.memoryUsage() call existed anywhere, so every Render OOM
 * kill arrived with no in-process evidence (oom-investigation.md).
 * The watchdog logs RSS / heap / external buffers every 60s through
 * the pino logger and escalates to warn above 80% of the container
 * budget so the next OOM has a paper trail.
 */
import { logger } from "./logger";

const CONTAINER_BUDGET_MB = Number(process.env["CONTAINER_MEMORY_MB"] ?? 512);
const WARN_RATIO = 0.8;
const LOG_INTERVAL_MS = 60_000;

const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;

let started = false;

export function startMemoryWatchdog(): void {
  if (started) return;
  started = true;
  const timer = setInterval(() => {
    const m = process.memoryUsage();
    const rssMb = mb(m.rss);
    const fields = {
      rssMb,
      heapUsedMb: mb(m.heapUsed),
      heapTotalMb: mb(m.heapTotal),
      externalMb: mb(m.external),
      arrayBuffersMb: mb(m.arrayBuffers ?? 0),
      budgetMb: CONTAINER_BUDGET_MB,
    };
    if (rssMb > CONTAINER_BUDGET_MB * WARN_RATIO) {
      logger.warn(fields, "memory watchdog: RSS above 80% of container budget");
    } else {
      logger.info(fields, "memory watchdog");
    }
  }, LOG_INTERVAL_MS);
  timer.unref?.();
}
