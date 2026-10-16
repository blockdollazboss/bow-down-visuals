import app from "./app";
import { logger } from "./lib/logger";
import { LiveWsGateway } from "./lib/live-ws";
import { registerLiveChatWs } from "./routes/live-chat";
import { registerLiveControlWs } from "./routes/live-control";
import { registerWorldWs } from "./routes/world";
import { registerStageWs } from "./routes/trust";
import { ensureCheatCodeTables } from "./lib/ensure-cheat-code-tables";
import { recoverInterruptedExportJobs } from "./routes/generate/export-video";
import { resumeActiveDeliveries } from "./routes/generate/distribution";
import { startPublishAttemptSweeper } from "./lib/social-sweeper";
import { startJobPoller } from "./lib/job-poller";
import { startMemoryWatchdog } from "./lib/memory-watchdog";

const rawPort = process.env["PORT"] ?? "8080";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // 2026-10-12 OOM fix: log process memory every 60s (was zero observability).
  startMemoryWatchdog();

  // Guarantee the Cheat Code Jackpot tables exist (idempotent). This is a
  // safety net in case the pre-boot `drizzle-kit push` ever fails silently.
  ensureCheatCodeTables().catch((ddlErr) =>
    logger.error({ ddlErr }, "Cheat Code table ensure failed"),
  );

  // Re-queue export jobs orphaned by a previous process (deploy/restart/crash).
  // Runs after listen so the server is already serving polls for recovered jobs.
  recoverInterruptedExportJobs().catch((recoveryErr) =>
    logger.error({ recoveryErr }, "Export job recovery failed"),
  );

  // Sweep Instagram publish attempts orphaned by a previous process
  // (deploy/restart/crash): fails them and refunds the deducted credits.
  // Runs once shortly after boot, then on SOCIAL_SWEEP_INTERVAL_MS.
  startPublishAttemptSweeper();

  // Server-owned background poller: drives lip-sync jobs through Sync.so's
  // long runs and raises exactly-once completion notifications — no tab needed.
  startJobPoller();

  // Re-register in-flight music-distribution deliveries orphaned by a
  // previous process (deploy/restart/crash) so per-platform statuses keep
  // advancing. Mock-mode jobs are re-submitted to restart their clock.
  resumeActiveDeliveries().catch((recoveryErr) =>
    logger.error({ recoveryErr }, "Distribution delivery recovery failed"),
  );
});

/* Live WebSockets on the same server/origin: stream chat delivery
   and the stream-controller relay register here. Session-token
   authed — see lib/live-ws.ts. */
const wsGateway = new LiveWsGateway();
registerLiveChatWs(wsGateway);
registerLiveControlWs(wsGateway);
registerWorldWs(wsGateway);
registerStageWs(wsGateway);
wsGateway.attach(server);
