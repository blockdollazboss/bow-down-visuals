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

/* ── Config ─────────────────────────────────────────────────────────────── */

const TOKEN = process.env["DISCORD_BOT_TOKEN"] ?? "";
const CLIENT_ID = process.env["DISCORD_CLIENT_ID"] ?? "";
const SHARED_SECRET = process.env["DISCORD_BOT_SHARED_SECRET"] ?? "";
const API_BASE_URL = (process.env["API_BASE_URL"] ?? "https://bowdownvisuals.com").replace(/\/$/, "");
const GUILD_ID = process.env["DISCORD_GUILD_ID"] ?? "";
const FALLBACK_CHANNEL_ID = process.env["DISCORD_ANNOUNCE_CHANNEL_ID"] ?? "";
const FALLBACK_STREAMER_ID = process.env["STREAMER_DISCORD_USER_ID"] ?? "";
const STREAM_URL = process.env["STREAM_URL"] ?? "";
const SOCIALS_RAW = process.env["SOCIALS_LINKS"] ?? "";

const GOLD = 0xd4af37;

if (!TOKEN) {
  console.error("[bot] DISCORD_BOT_TOKEN is not set — exiting.");
  process.exit(1);
}
if (SHARED_SECRET.length < 16) {
  console.error("[bot] DISCORD_BOT_SHARED_SECRET must be at least 16 chars — exiting.");
  process.exit(1);
}

/* ── Slash commands ─────────────────────────────────────────────────────── */

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

async function registerCommands() {
  if (!CLIENT_ID) {
    console.warn("[bot] DISCORD_CLIENT_ID not set — skipping slash command registration.");
    return;
  }
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      console.log("[bot] Registered guild slash commands.");
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log("[bot] Registered global slash commands (can take up to 1h to propagate).");
    }
  } catch (err) {
    console.error("[bot] Slash command registration failed:", err);
  }
}

/* ── Site API helpers ───────────────────────────────────────────────────── */

interface LiveStateResponse {
  is_live: boolean;
  configured: boolean;
  started_at?: string | null;
  channel_name?: string | null;
  stream_title?: string | null;
}

async function getSiteLiveState(): Promise<LiveStateResponse | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/discord-bot/live`);
    if (!res.ok) return null;
    return (await res.json()) as LiveStateResponse;
  } catch {
    return null;
  }
}

interface LiveTransition {
  is_live: boolean;
  channel_id?: string;
  channel_name?: string;
  stream_title?: string;
  streamer_discord_user_id?: string;
  streamer_discord_username?: string;
  announcement_message_id?: string;
  thread_id?: string;
}

async function reportLiveTransition(body: LiveTransition): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/discord-bot/live`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-bot-secret": SHARED_SECRET },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error("[bot] Live transition report failed:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("[bot] Live transition report error:", err);
    return false;
  }
}

/* Bot config lives on the site (GET /discord-bot/config is admin-authed, so
   the bot uses env fallbacks for channel/guild and lets the site be the
   source of truth for the streamer identity once configured). */
async function resolveAnnounceChannel(client: Client): Promise<TextChannel | null> {
  const channelId = FALLBACK_CHANNEL_ID;
  if (!channelId) return null;
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel?.isTextBased() && "send" in channel) return channel as TextChannel;
    return null;
  } catch {
    return null;
  }
}

function formatDuration(ms: number): string {
  const totalMin = Math.max(1, Math.round(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function socialsEmbed(): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(GOLD)
    .setTitle("🦈 Thy Cheat Code — links")
    .setDescription("Bow Down Visuals — The Content Creation Cheat Code");
  const pairs = SOCIALS_RAW.split(",").map((s) => s.trim()).filter(Boolean);
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

/* ── Client ─────────────────────────────────────────────────────────────── */

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

// streamerId → stream start timestamp (in-memory; the site DB is the durable record)
const activeStreams = new Map<string, number>();

client.once(Events.ClientReady, async (c) => {
  console.log(`[bot] Logged in as ${c.user.tag}`);
  await registerCommands();
  // "Streaming" presence — bots may set a STREAMING activity with a URL.
  if (STREAM_URL) {
    c.user.setPresence({
      activities: [{ name: "Bow Down Visuals", type: ActivityType.Streaming, url: STREAM_URL }],
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
  const streamerId = FALLBACK_STREAMER_ID;
  // Only announce for the configured streamer (ignore everyone else).
  if (streamerId && member.id !== streamerId) return;

  const username = member.user.tag;
  const channel = newState.channel ?? oldState.channel;

  if (isStreaming && !wasStreaming) {
    // ── GOING LIVE ──
    activeStreams.set(member.id, Date.now());
    console.log(`[bot] ${username} went LIVE in #${channel?.name}`);

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
          console.warn("[bot] Thread creation failed (missing permission?):", threadErr);
        }
      } catch (err) {
        console.error("[bot] Announcement post failed:", err);
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
    console.log(`[bot] ${username} ended stream (${formatDuration(durationMs)})`);

    const announceChannel = await resolveAnnounceChannel(client);
    if (announceChannel) {
      try {
        const embed = new EmbedBuilder()
          .setColor(0x2b2d31)
          .setTitle("Stream ended — GG 🦈")
          .setDescription(
            `Thanks for hanging with **${username}**${durationMs ? ` — ${formatDuration(durationMs)} of pure cheat-code energy` : ""}.`,
          )
          .setTimestamp()
          .setFooter({ text: "Bow Down Visuals" });
        await announceChannel.send({ embeds: [embed] });
      } catch (err) {
        console.error("[bot] Recap post failed:", err);
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
    console.error("[bot] Interaction handler failed:", err);
    if (!interaction.replied) {
      await interaction.reply({ content: "Something glitched — try again in a sec. 🦈", ephemeral: true }).catch(() => {});
    }
  }
});

process.on("unhandledRejection", (err) => console.error("[bot] Unhandled rejection:", err));
process.on("SIGTERM", () => {
  console.log("[bot] SIGTERM — shutting down.");
  void client.destroy();
  process.exit(0);
});

await client.login(TOKEN);
