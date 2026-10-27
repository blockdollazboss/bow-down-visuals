import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActivityType,
  type VoiceState,
  type TextChannel,
} from "discord.js";
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
   fallback). Presence on ready. */

const GOLD = 0xd4af37;
const RECAP_COLOR = 0x2b2d31;

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

type FetchImpl = typeof fetch;

/* ── Runtime ────────────────────────────────────────────────────────────── */

export interface DiscordBotRuntime {
  client: Client;
  /** Login; resolves true on success. Never rejects — a failed login is
   *  logged and the api-server carries on without the bot. */
  start: () => Promise<boolean>;
  stop: () => Promise<void>;
}

export function createDiscordBotRuntime(
  config: DiscordBotConfig,
  opts: { fetchImpl?: FetchImpl } = {},
): DiscordBotRuntime {
  const fetchImpl: FetchImpl = opts.fetchImpl ?? fetch;

  async function getSiteLiveState(): Promise<LiveStateResponse | null> {
    try {
      const res = await fetchImpl(`${config.apiBaseUrl}/api/discord-bot/live`);
      if (!res.ok) return null;
      return (await res.json()) as LiveStateResponse;
    } catch {
      return null;
    }
  }

  async function reportLiveTransition(body: LiveTransition): Promise<boolean> {
    try {
      const res = await fetchImpl(`${config.apiBaseUrl}/api/discord-bot/live`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-bot-secret": config.sharedSecret },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        logger.error(
          { status: res.status, body: await res.text() },
          "[discord-bot] Live transition report failed",
        );
        return false;
      }
      return true;
    } catch (err) {
      logger.error({ err }, "[discord-bot] Live transition report error");
      return false;
    }
  }

  async function registerCommands(): Promise<void> {
    if (!config.clientId) {
      logger.warn("[discord-bot] DISCORD_CLIENT_ID not set — skipping slash command registration.");
      return;
    }
    const commands = [
      new SlashCommandBuilder()
        .setName("live")
        .setDescription("Check whether Thy Cheat Code is live right now"),
      new SlashCommandBuilder()
        .setName("next")
        .setDescription("See the next scheduled stream"),
      new SlashCommandBuilder()
        .setName("socials")
        .setDescription("Get Thy Cheat Code's links"),
    ].map((c) => c.toJSON());
    const rest = new REST({ version: "10" }).setToken(config.token);
    try {
      if (config.guildId) {
        await rest.put(Routes.applicationGuildCommands(config.clientId, config.guildId), {
          body: commands,
        });
        logger.info("[discord-bot] Registered guild slash commands.");
      } else {
        await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
        logger.info("[discord-bot] Registered global slash commands (can take up to 1h to propagate).");
      }
    } catch (err) {
      logger.error({ err }, "[discord-bot] Slash command registration failed");
    }
  }

  /* Bot config lives on the site (GET /discord-bot/config is admin-authed, so
     the bot uses env fallbacks for channel/guild and lets the site be the
     source of truth for the streamer identity once configured). */
  async function resolveAnnounceChannel(botClient: Client): Promise<TextChannel | null> {
    const channelId = config.announceChannelId;
    if (!channelId) return null;
    try {
      const channel = await botClient.channels.fetch(channelId);
      if (channel?.isTextBased() && "send" in channel) return channel as TextChannel;
      return null;
    } catch {
      return null;
    }
  }

  function socialsEmbed(): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setColor(GOLD)
      .setTitle("🦈 Thy Cheat Code — links")
      .setDescription("Bow Down Visuals — The Content Creation Cheat Code");
    const pairs = config.socialsRaw.split(",").map((s) => s.trim()).filter(Boolean);
    if (pairs.length === 0) {
      embed.addFields({ name: "Site", value: "https://bowdownvisuals.com" });
    } else {
      for (const pair of pairs.slice(0, 10)) {
        const [label, url] = pair.split("|").map((s) => s.trim());
        if (label && url) embed.addFields({ name: label, value: url, inline: true });
      }
    }
    return embed;
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });

  // streamerId → stream start timestamp (in-memory; the site DB is the durable record)
  const activeStreams = new Map<string, number>();

  client.once(Events.ClientReady, async (c) => {
    logger.info(`[discord-bot] Logged in as ${c.user.tag}`);
    await registerCommands();
    // "Streaming" presence — bots may set a STREAMING activity with a URL.
    if (config.streamUrl) {
      c.user.setPresence({
        activities: [{ name: "Bow Down Visuals", type: ActivityType.Streaming, url: config.streamUrl }],
        status: "online",
      });
    } else {
      c.user.setPresence({
        activities: [{ name: "/live for stream status", type: ActivityType.Watching }],
        status: "online",
      });
    }
  });

  /* Go-live detection: VOICE_STATE_UPDATE fires with self_stream=true the
     instant the user clicks Go Live. No privileged intents required. */
  client.on(Events.VoiceStateUpdate, async (oldState: VoiceState, newState: VoiceState) => {
    const wasStreaming = oldState.streaming ?? false;
    const isStreaming = newState.streaming ?? false;
    if (wasStreaming === isStreaming) return;

    const member = newState.member ?? oldState.member;
    if (!member) return;
    const streamerId = config.streamerId;
    // Only announce for the configured streamer (ignore everyone else).
    if (streamerId && member.id !== streamerId) return;

    const username = member.user.tag;
    const channel = newState.channel ?? oldState.channel;

    if (isStreaming && !wasStreaming) {
      // ── GOING LIVE ──
      activeStreams.set(member.id, Date.now());
      logger.info(`[discord-bot] ${username} went LIVE in #${channel?.name}`);

      const announceChannel = await resolveAnnounceChannel(client);
      let messageId: string | undefined;
      let threadId: string | undefined;

      if (announceChannel) {
        try {
          const embed = new EmbedBuilder()
            .setColor(GOLD)
            .setTitle("🦈 Thy Cheat Code is LIVE")
            .setDescription(
              `**${username}** just hit Go Live in **${channel?.name ?? "a voice channel"}** — pull up!`,
            )
            .setTimestamp()
            .setFooter({ text: "Bow Down Visuals • The Content Creation Cheat Code" });
          const msg = await announceChannel.send({ embeds: [embed] });
          messageId = msg.id;
          // Watch-party thread so chat doesn't flood the announce channel.
          try {
            const thread = await msg.startThread({
              name: `🔴 watch party — ${new Date().toLocaleDateString()}`,
              autoArchiveDuration: 1440,
            });
            threadId = thread.id;
            await thread.send("Drop your song requests and clip timestamps here 👇");
          } catch (threadErr) {
            logger.warn({ err: threadErr }, "[discord-bot] Thread creation failed (missing permission?)");
          }
        } catch (err) {
          logger.error({ err }, "[discord-bot] Announcement post failed");
        }
      }

      await reportLiveTransition({
        is_live: true,
        channel_id: channel?.id,
        channel_name: channel?.name ?? undefined,
        streamer_discord_user_id: member.id,
        streamer_discord_username: username,
        announcement_message_id: messageId,
        thread_id: threadId,
      });
    } else if (!isStreaming && wasStreaming) {
      // ── STREAM ENDED ──
      const startedAt = activeStreams.get(member.id);
      activeStreams.delete(member.id);
      const durationMs = startedAt ? Date.now() - startedAt : 0;
      logger.info(`[discord-bot] ${username} ended stream (${formatDuration(durationMs)})`);

      const announceChannel = await resolveAnnounceChannel(client);
      if (announceChannel) {
        try {
          const embed = new EmbedBuilder()
            .setColor(RECAP_COLOR)
            .setTitle("Stream ended — GG 🦈")
            .setDescription(
              `Thanks for hanging with **${username}**${durationMs ? ` — ${formatDuration(durationMs)} of pure cheat-code energy` : ""}.`,
            )
            .setTimestamp()
            .setFooter({ text: "Bow Down Visuals" });
          await announceChannel.send({ embeds: [embed] });
        } catch (err) {
          logger.error({ err }, "[discord-bot] Recap post failed");
        }
      }

      await reportLiveTransition({
        is_live: false,
        streamer_discord_user_id: member.id,
        streamer_discord_username: username,
      });
    }
  });

  /* Slash command handlers. */
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    try {
      if (interaction.commandName === "live") {
        const state = await getSiteLiveState();
        if (state?.is_live) {
          const started = state.started_at ? new Date(state.started_at) : null;
          await interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(GOLD)
                .setTitle("🔴 LIVE NOW")
                .setDescription(
                  `Thy Cheat Code is live${state.channel_name ? ` in **${state.channel_name}**` : ""}` +
                    `${started ? ` — started <t:${Math.floor(started.getTime() / 1000)}:R>` : ""}` +
                    `${state.stream_title ? `\n\n*${state.stream_title}*` : ""}`,
                ),
            ],
          });
        } else {
          await interaction.reply("Not live right now — but the grind never stops. Check `/next` for the schedule. 🦈");
        }
      } else if (interaction.commandName === "next") {
        // Scheduled streams live on the site; deep-link there for now.
        await interaction.reply(
          "Upcoming streams are posted on the site's Go Live page: https://bowdownvisuals.com/go-live 📅",
        );
      } else if (interaction.commandName === "socials") {
        await interaction.reply({ embeds: [socialsEmbed()] });
      }
    } catch (err) {
      logger.error({ err }, "[discord-bot] Interaction handler failed");
      if (!interaction.replied) {
        await interaction.reply({ content: "Something glitched — try again in a sec. 🦈", ephemeral: true }).catch(() => {});
      }
    }
  });

  return {
    client,
    async start(): Promise<boolean> {
      try {
        await client.login(config.token);
        return true;
      } catch (err) {
        logger.error({ err }, "[discord-bot] Discord login failed — bot disabled, server unaffected");
        return false;
      }
    },
    async stop(): Promise<void> {
      try {
        await client.destroy();
      } catch (err) {
        logger.warn({ err }, "[discord-bot] Error while destroying Discord client");
      }
    },
  };
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
