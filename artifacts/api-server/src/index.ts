import app from "./app";
import { logger } from "./lib/logger";
import { recoverInterruptedExportJobs } from "./routes/generate/export-video";
import { startJobPoller } from "./lib/job-poller";

const rawPort = process.env["PORT"] ?? "8080";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Re-queue export jobs orphaned by a previous process (deploy/restart/crash).
  // Runs after listen so the server is already serving polls for recovered jobs.
  recoverInterruptedExportJobs().catch((recoveryErr) =>
    logger.error({ recoveryErr }, "Export job recovery failed"),
  );

  // Server-owned background poller: drives lip-sync jobs through Sync.so's
  // long runs and raises exactly-once completion notifications — no tab needed.
  startJobPoller();
});
