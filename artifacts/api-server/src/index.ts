import app from "./app";
import { logger } from "./lib/logger";
import { LiveWsGateway } from "./lib/live-ws";
import { registerLiveChatWs } from "./routes/live-chat";
import { registerLiveControlWs } from "./routes/live-control";
import { registerWorldWs, startWorldEventScheduler, startKingMomentScheduler, startCourtSeasonScheduler } from "./routes/world";
import { startOperatorDuties } from "./lib/operator-duties";
import { registerWorldContestAnnouncer } from "./lib/world-contests";
import { registerPartyWs } from "./routes/party";
import { registerStageWs } from "./routes/trust";
import { ensureCheatCodeTables } from "./lib/ensure-cheat-code-tables";
import { recoverInterruptedExportJobs } from "./routes/generate/export-video";
import { resumeActiveDeliveries } from "./routes/generate/distribution";
import { startPublishAttemptSweeper } from "./lib/social-sweeper";
import { startClipChargeSweeper } from "./lib/clip-charge-obligations";
import { startEmailAutomationSweeper } from "./lib/email-automations";
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

  // Resolve durable clip-charge obligations orphaned by a previous
  // process (payments D3): a charged Runway/Veo clip whose save never
  // landed gets refunded exactly once; a landed clip's bookkeeping is
  // completed instead. Runs once shortly after boot, then on
  // CLIP_CHARGE_SWEEP_INTERVAL_MS.
  startClipChargeSweeper();

  // Email automations (migration 0197): evaluate enabled automations
  // (post-purchase / abandoned checkout / membership winback) and send
  // through the tracked campaign rail. DB-claimed per trigger, so a
  // restart or a second instance can never double-email a fan.
  startEmailAutomationSweeper();

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
const worldPalace = registerWorldWs(wsGateway);
/* The palace calendar (World Events, 0145): due stage shows,
   listening parties and drop spectacles are driven into their
   rooms by this tick — cheap, one indexed select per interval. */
startWorldEventScheduler(worldPalace);
/* The King's daily moment (Ring 3): fires once a day at the
   palace day-turn, heralded palace-wide, with the hall's claim
   window riding the weekly quest pool. */
startKingMomentScheduler(worldPalace);
/* Court seasons (Ring 4): at each season's turn the standings
   freeze into the marks wall's record and the court is heralded —
   once per season, by the settlement row's primary key. */
startCourtSeasonScheduler(worldPalace);
/* The operator's automatic duties (Phase 2, Lane G): host reminders
   before booked events + the trouble-flag watch, on one tick; the
   winner heralds hang off the contest decision and the court
   settling above. Peace-keeping only — a duty never punishes. */
startOperatorDuties(worldPalace);
/* World Contests (2.24): when a host names the winners, the palace
   hears it — the contests route speaks through this hook (the
   Winners' Circle rows are the durable record; this is the moment). */
registerWorldContestAnnouncer((announcement) => worldPalace.announce(announcement));
registerPartyWs(wsGateway);
registerStageWs(wsGateway);
wsGateway.attach(server);
