import type { Client } from "discord.js";
import { logger } from "./logger";

/* ── Discord Live Companion Bot — IN-PROCESS runtime ─────────────────────
   Ported faithfully from the standalone service in artifacts/discord-bot
   (which stays untouched as the fallback deployment). Owner ruling
   2026-10-27: "the bot should be running the discord for free, not you" —
   so the bot lives inside the already-paid api-server process and runs
   autonomously, instead of needing its own hosted service.

   Boot gating (ALL must hold, otherwise the runtime is fully inert — no
   client is constructed, no login is attempted, at most one log line):
     - DISCORD_BOT_ENABLED === "1"          (default OFF)
     - DISCORD_BOT_TOKEN non-empty
     - DISCORD_BOT_SHARED_SECRET length >= 16 (same floor as the bot-secret
       auth on routes/discord-bot.ts)

   A failed Discord login is caught and logged; it must never crash or
   block the api-server — the site keeps serving regardless.

   Behavior (identical to the standalone): Guilds + GuildVoiceStates
   intents only (no privileged intents); on VoiceStateUpdate self_stream
   transitions for the configured streamer (STREAMER_DISCORD_USER_ID, or
   any member when unset): going-live → gold announcement embed in the
   announce channel + watch-party thread on that message + POST the live
   transition to the site API; stream-end → recap embed + POST transition.
   Slash commands /live (reads GET {API_BASE_URL}/api/discord-bot/live),
   /next (deep link), /socials (embed from SOCIALS_LINKS env or the site
   fallback). Presence on ready.

   Lazy-load split (2026-10-28, stack300/discord-lazyload): this module
   is the LIGHT half — config, gate, boot entry — and imports discord.js
   as a TYPE ONLY (erased at compile time), so importing it at boot
   costs nothing. The heavy half, createDiscordBotRuntime + the real
   discord.js import, lives in ./discord-bot-client and is dynamically
   imported inside startDiscordBotRuntime ONLY after the gate passes.
   A gated-off boot never loads discord.js (427 files / ~1.83 MB of
   bundle and its heap floor on the 512 MB box — see the Oct 27 OOM
   diagnosis). */

/* ── Config ─────────────────────────────────────────────────────────────── */

export interface DiscordBotConfig {
  token: string;
  clientId: string;
  guildId: string;
  announceChannelId: string;
  sharedSecret: string;
  apiBaseUrl: string;
  streamerId: string;
  streamUrl: string;
  socialsRaw: string;
}

export function readDiscordBotConfig(
  env: Record<string, string | undefined> = process.env,
): DiscordBotConfig {
  return {
    token: env["DISCORD_BOT_TOKEN"] ?? "",
    clientId: env["DISCORD_CLIENT_ID"] ?? "",
    guildId: env["DISCORD_GUILD_ID"] ?? "",
    announceChannelId: env["DISCORD_ANNOUNCE_CHANNEL_ID"] ?? "",
    sharedSecret: env["DISCORD_BOT_SHARED_SECRET"] ?? "",
    apiBaseUrl: (env["API_BASE_URL"] ?? "https://bowdownvisuals.com").replace(/\/$/, ""),
    streamerId: env["STREAMER_DISCORD_USER_ID"] ?? "",
    streamUrl: env["STREAM_URL"] ?? "",
    socialsRaw: env["SOCIALS_LINKS"] ?? "",
  };
}

/* ── Gate ───────────────────────────────────────────────────────────────── */

export type DiscordBotGate = { ok: true } | { ok: false; reason: string };

export function discordBotGate(
  env: Record<string, string | undefined> = process.env,
): DiscordBotGate {
  if (env["DISCORD_BOT_ENABLED"] !== "1") {
    return { ok: false, reason: "DISCORD_BOT_ENABLED is not 1" };
  }
  if (!(env["DISCORD_BOT_TOKEN"] ?? "")) {
    return { ok: false, reason: "DISCORD_BOT_TOKEN is not set" };
  }
  if ((env["DISCORD_BOT_SHARED_SECRET"] ?? "").length < 16) {
    return { ok: false, reason: "DISCORD_BOT_SHARED_SECRET must be at least 16 chars" };
  }
  return { ok: true };
}

/* ── Site API helpers ───────────────────────────────────────────────────── */

export interface LiveStateResponse {
  is_live: boolean;
  configured: boolean;
  started_at?: string | null;
  channel_name?: string | null;
  stream_title?: string | null;
}

export interface LiveTransition {
  is_live: boolean;
  channel_id?: string;
  channel_name?: string;
  stream_title?: string;
  streamer_discord_user_id?: string;
  streamer_discord_username?: string;
  announcement_message_id?: string;
  thread_id?: string;
}

/* ── Runtime ────────────────────────────────────────────────────────────── */

export interface DiscordBotRuntime {
  client: Client;
  /** Login; resolves true on success. Never rejects — a failed login is
   *  logged and the api-server carries on without the bot. */
  start: () => Promise<boolean>;
  stop: () => Promise<void>;
}

export function formatDuration(ms: number): string {
  const totalMin = Math.max(1, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

/* ── Boot entry (called once from src/index.ts) ─────────────────────────── */

let runningRuntime: DiscordBotRuntime | null = null;
let sigtermHookRegistered = false;

export type DiscordBotStartResult =
  | { started: true }
  | { started: false; reason: string };

export async function startDiscordBotRuntime(
  env: Record<string, string | undefined> = process.env,
): Promise<DiscordBotStartResult> {
  if (runningRuntime) {
    return { started: false, reason: "already running" };
  }
  const gate = discordBotGate(env);
  if (!gate.ok) {
    // Fully inert: no client, no login attempt — one log line at most.
    logger.info(`[discord-bot] In-process bot disabled: ${gate.reason}`);
    return { started: false, reason: gate.reason };
  }
  // Gate passed — only NOW is the heavy half (and with it discord.js)
  // loaded. The gated-off path above never touches discord.js at all.
  const { createDiscordBotRuntime } = await import("./discord-bot-client");
  const runtime = createDiscordBotRuntime(readDiscordBotConfig(env));
  const ok = await runtime.start();
  if (!ok) {
    return { started: false, reason: "Discord login failed" };
  }
  runningRuntime = runtime;
  if (!sigtermHookRegistered) {
    sigtermHookRegistered = true;
    // Graceful destroy on shutdown — the api-server owns the process
    // lifecycle, so (unlike the standalone) we never process.exit here.
    process.once("SIGTERM", () => {
      void stopDiscordBotRuntime();
    });
  }
  return { started: true };
}

export async function stopDiscordBotRuntime(): Promise<void> {
  const runtime = runningRuntime;
  runningRuntime = null;
  if (runtime) await runtime.stop();
}

/** Test seam: is a runtime currently marked running? */
export function isDiscordBotRuntimeRunning(): boolean {
  return runningRuntime !== null;
}
