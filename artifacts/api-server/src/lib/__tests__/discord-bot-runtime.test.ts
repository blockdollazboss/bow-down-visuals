/**
 * discord-bot-runtime.test.ts — the in-process Discord Companion Bot.
 *
 * Pins the boot gate (DISCORD_BOT_ENABLED=1 + token + shared secret ≥ 16,
 * otherwise FULLY inert — no client is even constructed) and the ported
 * behavior from artifacts/discord-bot: guild slash-command registration +
 * presence on ready, Go Live announcement + watch-party thread + the
 * site-API live-transition report on self_stream transitions for the
 * configured streamer only, the stream-end recap, and the /live + /socials
 * command replies. discord.js is fully faked and the site API is a stubbed
 * fetch — no real network anywhere in this file.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  clients: [] as Array<Record<string, any>>,
  loginImpl: null as null | ((token: string) => Promise<string>),
  restPuts: [] as Array<{ route: string; body: unknown }>,
}));

vi.mock("discord.js", () => {
  class FakeEmbedBuilder {
    data: Record<string, any> = {};
    setColor(c: unknown) { this.data.color = c; return this; }
    setTitle(t: unknown) { this.data.title = t; return this; }
    setDescription(d: unknown) { this.data.description = d; return this; }
    setTimestamp() { this.data.timestamp = true; return this; }
    setFooter(f: unknown) { this.data.footer = f; return this; }
    addFields(...fields: Array<Record<string, unknown>>) {
      this.data.fields = [...(this.data.fields ?? []), ...fields];
      return this;
    }
  }
  class FakeSlashCommandBuilder {
    name = "";
    description = "";
    setName(n: string) { this.name = n; return this; }
    setDescription(d: string) { this.description = d; return this; }
    toJSON() { return { name: this.name, description: this.description }; }
  }
  class FakeREST {
    setToken() { return this; }
    async put(route: string, opts?: { body?: unknown }) {
      h.restPuts.push({ route, body: opts?.body });
      return {};
    }
  }
  class FakeClient {
    options: Record<string, unknown>;
    user = { tag: "Thy Cheat Code#4957", setPresence: vi.fn() };
    channels = { fetch: vi.fn(async () => null) };
    loginCalls: string[] = [];
    destroyed = false;
    private onceHandlers = new Map<string, (...args: any[]) => unknown>();
    private onHandlers = new Map<string, Array<(...args: any[]) => unknown>>();
    constructor(options: Record<string, unknown>) {
      this.options = options;
      h.clients.push(this);
    }
    once(ev: string, fn: (...args: any[]) => unknown) { this.onceHandlers.set(ev, fn); return this; }
    on(ev: string, fn: (...args: any[]) => unknown) {
      const arr = this.onHandlers.get(ev) ?? [];
      arr.push(fn);
      this.onHandlers.set(ev, arr);
      return this;
    }
    async emitOnce(ev: string, ...args: any[]) { return this.onceHandlers.get(ev)?.(...args); }
    async emitOn(ev: string, ...args: any[]) {
      let out: unknown;
      for (const fn of this.onHandlers.get(ev) ?? []) out = await fn(...args);
      return out;
    }
    async login(token: string) {
      this.loginCalls.push(token);
      if (h.loginImpl) return h.loginImpl(token);
      return "ok";
    }
    async destroy() { this.destroyed = true; }
  }
  return {
    Client: FakeClient,
    GatewayIntentBits: { Guilds: 1, GuildVoiceStates: 128 },
    Events: {
      ClientReady: "ready",
      VoiceStateUpdate: "voiceStateUpdate",
      InteractionCreate: "interactionCreate",
    },
    REST: FakeREST,
    Routes: {
      applicationGuildCommands: (app: string, guild: string) =>
        `/applications/${app}/guilds/${guild}/commands`,
      applicationCommands: (app: string) => `/applications/${app}/commands`,
    },
    SlashCommandBuilder: FakeSlashCommandBuilder,
    EmbedBuilder: FakeEmbedBuilder,
    ActivityType: { Streaming: 1, Watching: 3 },
  };
});

import {
  discordBotGate,
  readDiscordBotConfig,
  startDiscordBotRuntime,
  stopDiscordBotRuntime,
  isDiscordBotRuntimeRunning,
  formatDuration,
  type DiscordBotConfig,
} from "../discord-bot-runtime";
import { createDiscordBotRuntime } from "../discord-bot-client";

const SECRET16 = "0123456789abcdef";
const FULL_ENV = {
  DISCORD_BOT_ENABLED: "1",
  DISCORD_BOT_TOKEN: "tok-123",
  DISCORD_BOT_SHARED_SECRET: SECRET16,
};

function baseConfig(overrides: Partial<DiscordBotConfig> = {}): DiscordBotConfig {
  return {
    token: "tok-123",
    clientId: "app-1",
    guildId: "guild-1",
    announceChannelId: "announce-1",
    sharedSecret: SECRET16,
    apiBaseUrl: "https://api.test",
    streamerId: "streamer-1",
    streamUrl: "",
    socialsRaw: "",
    ...overrides,
  };
}

function fakeFetch(responder: (url: string, init?: any) => unknown) {
  const calls: Array<{ url: string; init?: any }> = [];
  const impl = vi.fn(async (url: string, init?: any) => {
    calls.push({ url, init });
    return responder(url, init);
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

const okJson = (body: unknown) => ({
  ok: true,
  status: 200,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

beforeEach(() => {
  h.clients.length = 0;
  h.restPuts.length = 0;
  h.loginImpl = null;
});

afterEach(async () => {
  await stopDiscordBotRuntime();
});

/* ── Gate ─────────────────────────────────────────────────────────────── */

describe("discordBotGate", () => {
  it("inert when DISCORD_BOT_ENABLED is unset", () => {
    const gate = discordBotGate({ DISCORD_BOT_TOKEN: "t", DISCORD_BOT_SHARED_SECRET: SECRET16 });
    expect(gate.ok).toBe(false);
    if (!gate.ok) expect(gate.reason).toContain("DISCORD_BOT_ENABLED");
  });

  it("inert when DISCORD_BOT_ENABLED is not exactly '1'", () => {
    expect(discordBotGate({ ...FULL_ENV, DISCORD_BOT_ENABLED: "true" }).ok).toBe(false);
    expect(discordBotGate({ ...FULL_ENV, DISCORD_BOT_ENABLED: "0" }).ok).toBe(false);
  });

  it("inert when the token is missing or empty", () => {
    expect(discordBotGate({ DISCORD_BOT_ENABLED: "1", DISCORD_BOT_SHARED_SECRET: SECRET16 }).ok).toBe(false);
    expect(discordBotGate({ ...FULL_ENV, DISCORD_BOT_TOKEN: "" }).ok).toBe(false);
  });

  it("inert when the shared secret is under 16 chars (boundary)", () => {
    expect(discordBotGate({ ...FULL_ENV, DISCORD_BOT_SHARED_SECRET: "0123456789abcde" }).ok).toBe(false);
    expect(discordBotGate({ ...FULL_ENV, DISCORD_BOT_SHARED_SECRET: "" }).ok).toBe(false);
  });

  it("opens when enabled=1, token set, secret exactly 16 chars", () => {
    expect(discordBotGate(FULL_ENV)).toEqual({ ok: true });
  });
});

describe("startDiscordBotRuntime gating", () => {
  it("constructs NO client when any condition is missing", async () => {
    for (const env of [
      {},
      { DISCORD_BOT_ENABLED: "1" },
      { DISCORD_BOT_ENABLED: "1", DISCORD_BOT_TOKEN: "tok-123" },
      { DISCORD_BOT_ENABLED: "1", DISCORD_BOT_TOKEN: "tok-123", DISCORD_BOT_SHARED_SECRET: "short" },
      { DISCORD_BOT_TOKEN: "tok-123", DISCORD_BOT_SHARED_SECRET: SECRET16 },
    ]) {
      const res = await startDiscordBotRuntime(env);
      expect(res.started).toBe(false);
    }
    expect(h.clients.length).toBe(0);
    expect(isDiscordBotRuntimeRunning()).toBe(false);
  });

  it("start path: client built with Guilds+GuildVoiceStates only, login with the env token", async () => {
    const res = await startDiscordBotRuntime(FULL_ENV);
    expect(res).toEqual({ started: true });
    expect(h.clients.length).toBe(1);
    expect(h.clients[0].options).toEqual({ intents: [1, 128] });
    expect(h.clients[0].loginCalls).toEqual(["tok-123"]);
    expect(isDiscordBotRuntimeRunning()).toBe(true);
  });

  it("a second start is refused while one is running", async () => {
    await startDiscordBotRuntime(FULL_ENV);
    const res = await startDiscordBotRuntime(FULL_ENV);
    expect(res.started).toBe(false);
    expect(h.clients.length).toBe(1);
  });

  it("a failed Discord login never throws — the server carries on", async () => {
    h.loginImpl = async () => { throw new Error("invalid token"); };
    const res = await startDiscordBotRuntime(FULL_ENV);
    expect(res).toEqual({ started: false, reason: "Discord login failed" });
    expect(isDiscordBotRuntimeRunning()).toBe(false);
  });

  it("stop destroys the client", async () => {
    await startDiscordBotRuntime(FULL_ENV);
    await stopDiscordBotRuntime();
    expect(h.clients[0].destroyed).toBe(true);
    expect(isDiscordBotRuntimeRunning()).toBe(false);
  });
});

/* ── Config ───────────────────────────────────────────────────────────── */

describe("readDiscordBotConfig", () => {
  it("defaults API_BASE_URL to the site and strips a trailing slash", () => {
    expect(readDiscordBotConfig({}).apiBaseUrl).toBe("https://bowdownvisuals.com");
    expect(readDiscordBotConfig({ API_BASE_URL: "https://x.test/" }).apiBaseUrl).toBe("https://x.test");
  });
});

/* ── Behavior (createDiscordBotRuntime with a stubbed site API) ───────── */

describe("runtime behavior", () => {
  it("on ready: registers the 3 guild slash commands and sets Watching presence", async () => {
    const { impl } = fakeFetch(() => okJson({}));
    const rt = createDiscordBotRuntime(baseConfig(), { fetchImpl: impl });
    const client = h.clients[0];
    await client.emitOnce("ready", client);
    expect(h.restPuts.length).toBe(1);
    expect(h.restPuts[0].route).toBe("/applications/app-1/guilds/guild-1/commands");
    const names = (h.restPuts[0].body as Array<{ name: string }>).map((c) => c.name);
    expect(names).toEqual(["live", "next", "socials"]);
    expect(client.user.setPresence).toHaveBeenCalledWith({
      activities: [{ name: "/live for stream status", type: 3 }],
      status: "online",
    });
    await rt.stop();
  });

  function wireAnnounceChannel(client: Record<string, any>) {
    const thread = { id: "thread-1", send: vi.fn(async () => {}) };
    const message = { id: "msg-1", startThread: vi.fn(async () => thread) };
    const sends: Array<any> = [];
    const channel = {
      isTextBased: () => true,
      send: vi.fn(async (payload: any) => { sends.push(payload); return message; }),
    };
    client.channels.fetch = vi.fn(async () => channel);
    return { channel, message, thread, sends };
  }

  const member = { id: "streamer-1", user: { tag: "King#0001" } };
  const voiceChannel = { id: "vc-1", name: "The Stage" };

  it("go-live: gold announcement + watch-party thread + POST transition with the bot secret", async () => {
    const { impl, calls } = fakeFetch(() => okJson({ ok: true }));
    const rt = createDiscordBotRuntime(baseConfig(), { fetchImpl: impl });
    const client = h.clients[0];
    const { sends, thread } = wireAnnounceChannel(client);

    await client.emitOn("voiceStateUpdate",
      { streaming: false, member, channel: voiceChannel },
      { streaming: true, member, channel: voiceChannel });

    expect(sends.length).toBe(1);
    expect(sends[0].embeds[0].data.title).toBe("🦈 Thy Cheat Code is LIVE");
    expect(sends[0].embeds[0].data.color).toBe(0xd4af37);
    expect(thread.send).toHaveBeenCalled();

    const post = calls.find((c) => c.init?.method === "POST");
    expect(post?.url).toBe("https://api.test/api/discord-bot/live");
    expect(post?.init.headers["x-bot-secret"]).toBe(SECRET16);
    const body = JSON.parse(post?.init.body);
    expect(body).toMatchObject({
      is_live: true,
      channel_id: "vc-1",
      channel_name: "The Stage",
      streamer_discord_user_id: "streamer-1",
      streamer_discord_username: "King#0001",
      announcement_message_id: "msg-1",
      thread_id: "thread-1",
    });
    await rt.stop();
  });

  it("stream-end: recap embed + POST is_live=false", async () => {
    const { impl, calls } = fakeFetch(() => okJson({ ok: true }));
    const rt = createDiscordBotRuntime(baseConfig(), { fetchImpl: impl });
    const client = h.clients[0];
    const { sends } = wireAnnounceChannel(client);

    await client.emitOn("voiceStateUpdate",
      { streaming: false, member, channel: voiceChannel },
      { streaming: true, member, channel: voiceChannel });
    await client.emitOn("voiceStateUpdate",
      { streaming: true, member, channel: voiceChannel },
      { streaming: false, member, channel: voiceChannel });

    expect(sends.length).toBe(2);
    expect(sends[1].embeds[0].data.title).toBe("Stream ended — GG 🦈");
    const posts = calls.filter((c) => c.init?.method === "POST");
    expect(posts.length).toBe(2);
    expect(JSON.parse(posts[1].init.body)).toMatchObject({
      is_live: false,
      streamer_discord_user_id: "streamer-1",
    });
    await rt.stop();
  });

  it("ignores streaming transitions from anyone but the configured streamer", async () => {
    const { impl, calls } = fakeFetch(() => okJson({ ok: true }));
    const rt = createDiscordBotRuntime(baseConfig(), { fetchImpl: impl });
    const client = h.clients[0];
    wireAnnounceChannel(client);
    const other = { id: "fan-9", user: { tag: "Fan#0009" } };
    await client.emitOn("voiceStateUpdate",
      { streaming: false, member: other, channel: voiceChannel },
      { streaming: true, member: other, channel: voiceChannel });
    expect(calls.length).toBe(0);
    expect(client.channels.fetch).not.toHaveBeenCalled();
    await rt.stop();
  });

  it("no transition (streaming flag unchanged) is a no-op", async () => {
    const { impl, calls } = fakeFetch(() => okJson({ ok: true }));
    const rt = createDiscordBotRuntime(baseConfig(), { fetchImpl: impl });
    const client = h.clients[0];
    await client.emitOn("voiceStateUpdate",
      { streaming: true, member, channel: voiceChannel },
      { streaming: true, member, channel: voiceChannel });
    expect(calls.length).toBe(0);
    await rt.stop();
  });

  it("/live replies LIVE NOW from the site state, and the not-live line otherwise", async () => {
    const live = fakeFetch(() => okJson({
      is_live: true, configured: true,
      started_at: new Date(Date.now() - 3600_000).toISOString(),
      channel_name: "The Stage", stream_title: "Cooking up",
    }));
    const rt = createDiscordBotRuntime(baseConfig(), { fetchImpl: live.impl });
    const client = h.clients[0];
    const interaction = {
      isChatInputCommand: () => true, commandName: "live", replied: false,
      reply: vi.fn(async () => {}),
    };
    await client.emitOn("interactionCreate", interaction);
    expect(live.calls[0].url).toBe("https://api.test/api/discord-bot/live");
    const payload = interaction.reply.mock.calls[0][0] as any;
    expect(payload.embeds[0].data.title).toBe("🔴 LIVE NOW");
    expect(payload.embeds[0].data.description).toContain("The Stage");
    await rt.stop();

    const idle = fakeFetch(() => okJson({ is_live: false, configured: true }));
    const rt2 = createDiscordBotRuntime(baseConfig(), { fetchImpl: idle.impl });
    const client2 = h.clients[1];
    const interaction2 = {
      isChatInputCommand: () => true, commandName: "live", replied: false,
      reply: vi.fn(async () => {}),
    };
    await client2.emitOn("interactionCreate", interaction2);
    expect(interaction2.reply.mock.calls[0][0]).toContain("Not live right now");
    await rt2.stop();
  });

  it("/next deep-links the site schedule; /socials falls back to the site link", async () => {
    const { impl } = fakeFetch(() => okJson({}));
    const rt = createDiscordBotRuntime(baseConfig(), { fetchImpl: impl });
    const client = h.clients[0];
    const mk = (commandName: string) => ({
      isChatInputCommand: () => true, commandName, replied: false,
      reply: vi.fn(async () => {}),
    });
    const next = mk("next");
    await client.emitOn("interactionCreate", next);
    expect(next.reply.mock.calls[0][0]).toContain("https://bowdownvisuals.com/go-live");

    const socials = mk("socials");
    await client.emitOn("interactionCreate", socials);
    const payload = socials.reply.mock.calls[0][0] as any;
    expect(payload.embeds[0].data.fields).toEqual([
      { name: "Site", value: "https://bowdownvisuals.com" },
    ]);
    await rt.stop();
  });
});

describe("formatDuration", () => {
  it("matches the standalone formatting", () => {
    expect(formatDuration(0)).toBe("1m");
    expect(formatDuration(30 * 60000)).toBe("30m");
    expect(formatDuration(90 * 60000)).toBe("1h 30m");
    expect(formatDuration(120 * 60000)).toBe("2h 0m");
  });
});
