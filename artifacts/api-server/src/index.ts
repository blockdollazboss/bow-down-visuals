import app from "./app";
import { logger } from "./lib/logger";
import { LiveWsGateway } from "./lib/live-ws";
import { registerLiveChatWs } from "./routes/live-chat";
import { registerLiveCaptionsWs } from "./routes/live-captions";
import { registerLiveBackstageWs } from "./routes/live-guests";
import { registerLiveControlWs } from "./routes/live-control";
import { registerWorldWs, startWorldEventScheduler, startKingMomentScheduler, startCourtSeasonScheduler, startCrownsScheduler, startCoverFridaysScheduler } from "./routes/world";
import { startOperatorDuties } from "./lib/operator-duties";
import { registerWorldContestAnnouncer } from "./lib/world-contests";
import { registerPartyWs } from "./routes/party";
import { registerVideoCallWs } from "./routes/video-calls";
import { registerStageWs } from "./routes/trust";
import { ensureCheatCodeTables } from "./lib/ensure-cheat-code-tables";
import { recoverInterruptedExportJobs } from "./routes/generate/export-video";
import { recoverInterruptedVaultJobsBoot } from "./lib/vault-runner";
import { recoverInterruptedLipSyncRuns } from "./routes/lip-sync";
import { recoverInterruptedMultiRatioJobs } from "./routes/generate/export-multi-ratio";
import { resumeActiveDeliveries } from "./routes/generate/distribution";
import { startPublishAttemptSweeper } from "./lib/social-sweeper";
import { startClipChargeSweeper } from "./lib/clip-charge-obligations";
import { startGenerationChargeSweeper } from "./lib/generation-charge-intents";
import { startPresaveReleaseSweeper } from "./lib/presave-release-notify";
import { startViralSpikeSweeper } from "./lib/viral-spike-service";
import { startProductDropSweeper } from "./lib/product-drop-notify";
import { startEmailAutomationSweeper } from "./lib/email-automations";
import { startJobPoller } from "./lib/job-poller";
import { startMemoryWatchdog, setMemoryCriticalHandler } from "./lib/memory-watchdog";
import { startRtmpIngestServer } from "./lib/rtmp-ingest";
import { startDiscordBotRuntime } from "./lib/discord-bot-runtime";

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

  // 2026-10-25 OOM fix: when the watchdog crosses its critical line
  // (sustained heap/RSS at the container's edge), restart in a
  // controlled way BEFORE the OOM kill lands mid-request: stop
  // accepting connections, give in-flight work a bounded drain,
  // then exit for the platform to restart the process. Orphaned
  // jobs are re-driven by the boot-recovery passes below — the same
  // machinery that already survives every deploy and crash.
  setMemoryCriticalHandler(() => {
    logger.error(
      "memory watchdog: controlled restart — closing the HTTP server, then exiting",
    );
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref?.();
    server.close(() => process.exit(1));
  });

  // RTMP ingest listener (Go Live stream keys): a raw-TCP door on its
  // own port (LIVE_RTMP_PORT, default 1935) beside the single HTTP
  // port. Inert unless LIVE_RTMP_INGEST=on (opt-in per deployment —
  // the host has to actually route the port). Publishes land on the
  // own-server live engine via the hooks routes/live-streams wired.
  startRtmpIngestServer();

  // Discord Live Companion Bot, in-process (owner ruling 2026-10-27:
  // the bot runs the Discord autonomously, for free, inside this
  // already-paid service). Fully inert unless DISCORD_BOT_ENABLED=1
  // with DISCORD_BOT_TOKEN set and DISCORD_BOT_SHARED_SECRET >= 16
  // chars; a failed Discord login is caught inside and never blocks
  // or crashes the server.
  startDiscordBotRuntime().catch((discordBotErr) =>
    logger.error({ discordBotErr }, "Discord bot runtime start failed"),
  );

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

  // #162 The Vault: re-drive archive packaging jobs orphaned by a
  // previous process, exactly like export renders above.
  recoverInterruptedVaultJobsBoot().catch((recoveryErr) =>
    logger.error({ recoveryErr }, "Vault job recovery failed"),
  );

  // A-08 (Stack-100 #3): re-drive lip-sync run-all orchestrations a
  // previous process left 'running', and settle multi-ratio jobs it
  // left queued/active (refunding every ratio that never completed).
  recoverInterruptedLipSyncRuns().catch((recoveryErr) =>
    logger.error({ recoveryErr }, "Lip-sync run recovery failed"),
  );
  recoverInterruptedMultiRatioJobs().catch((recoveryErr) =>
    logger.error({ recoveryErr }, "Multi-ratio job recovery failed"),
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

  // Settle durable generation-charge intents orphaned by a previous
  // process (Stack400 Lane 4): generations that were DELIVERED but
  // never charged (restart between submit and success poll, or a
  // poll-time charge failure) get charged exactly once via the
  // 'gen-charge:<task_id>' idempotency key. Runs once shortly after
  // boot, then on GEN_CHARGE_SWEEP_INTERVAL_MS.
  startGenerationChargeSweeper();

  // Release-day presave notifications (wave 3 #15): a packaged
  // release's release_date arriving is the release moment (there is
  // no "released" status flip) — fans who pre-saved get their one
  // promised email, claimed through the delivery ledger so nobody is
  // ever emailed twice. Runs once shortly after boot, then on
  // PRESAVE_NOTIFY_SWEEP_INTERVAL_MS.
  startPresaveReleaseSweeper();
  // Viral-spike response kit (orphan wave): hourly timestamped samples
  // of real view counters (showcase_items.views / profile_videos
  // .view_count) for opted-in creators — the snapshot history is what
  // makes spike velocity honest instead of invented. Opt-out (Settings)
  // stops all sampling for an account; the sweeper fails closed (logs +
  // skips) until the provisional 9999 migration is renumbered/applied.
  startViralSpikeSweeper();
  // Timed product drops (Stack-100 #3 #25): a scheduled drop's moment
  // arriving flips it live (status-guarded, winner-only) and emails the
  // capture list exactly once through the claim ledger. Public reads
  // gate on drop_at directly, so the product is never buyable early
  // even between sweeps. Inert (empty sweeps) until the product_drops
  // migration lands.
  startProductDropSweeper();
  // Email automations (migration 0198): evaluate enabled automations
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
registerLiveCaptionsWs(wsGateway);
registerLiveBackstageWs(wsGateway);
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
/* The Crowns (N8): at each year's turn the year's published
   categories freeze into the awards record and the court is
   heralded — once per year, by the year row's primary key.
   Winners wear their crowns on their profiles for the year. */
startCrownsScheduler(worldPalace);
/* Cover Fridays (N19): the weekly house cover ritual — the
   week's challenge ensured from the published theme rotation,
   and the King crowns the best cover by Monday, the winner
   featured as the crown. Exactly once per week, by the
   challenge's status flip. */
startCoverFridaysScheduler(worldPalace);
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
registerVideoCallWs(wsGateway);
registerStageWs(wsGateway);
wsGateway.attach(server);
