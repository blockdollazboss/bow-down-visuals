/**
 * admin-discord-bench — stack100 wave 3, manifest item 21 [B8].
 *
 * The Discord Bot bench is the AdminDesk's 17th bench: the
 * /discord-bot setup page's admin side native in the palace, on
 * the page's own rails (GET/POST /api/discord-bot/config,
 * GET /api/discord-bot/install-url, GET /api/discord-bot/live),
 * behind the desk's one server gate — no new permission path.
 *
 * These pins hold the bench's contract:
 * - it is registered in the desk (the 17th mount) and rides the
 *   admin-desk seam for every path, parse and body;
 * - status renders from the config rail's PRESENCE booleans only:
 *   the seam's env parser reads exactly the three *_set flags, so
 *   no secret value can exist anywhere in the desk's data path —
 *   proven behaviorally below by feeding the parser an answer
 *   smuggling secret-looking values and showing none survive;
 * - the honesty is the fixed website desk's (fix queue #8): an
 *   unset key is amber "not set up", the wiring form is locked as
 *   one fieldset while the bot is unconfigured, and the install
 *   action stays off while the client ID is unset — guards in the
 *   handlers, not just disabled buttons.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DISCORD_BOT_CONFIG_PATH,
  DISCORD_BOT_INSTALL_URL_PATH,
  DISCORD_BOT_LIVE_PATH,
  buildDiscordBotConfigBody,
  discordBotConfigured,
  discordBotDraftFrom,
  discordBotUnconfigured,
  discordInstallBlocked,
  parseDiscordBotConfig,
  parseDiscordBotLive,
  parseDiscordInstallUrl,
  type DiscordBotRead,
} from "./admin-desk";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const desk = read("../../components/world/native/AdminDesk.tsx");
const ops = read("../../components/world/native/AdminOpsDesk.tsx");
const seam = read("./admin-desk.ts");

const fullAnswer = {
  config: {
    id: "cfg1",
    user_id: "u1",
    guild_id: "111",
    announce_channel_id: "222",
    announce_role_id: null,
    mention_everyone: true,
    streamer_discord_user_id: "333",
    streamer_discord_username: "boss#1",
    enabled: false,
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
  },
  env: {
    client_id_set: true,
    bot_token_set: true,
    shared_secret_set: true,
    guild_id_env: "999",
    announce_channel_env: "888",
  },
};

describe("registration — the 17th bench", () => {
  it("the desk mounts DiscordBench as its seventeenth bench", () => {
    expect(desk).toContain("<DiscordBench isLight={isLight} />");
    const mounts = desk.match(/<\w+Bench isLight=\{isLight\} \/>/g) ?? [];
    expect(mounts).toHaveLength(17);
    expect(desk).toContain("DiscordBench,");
    expect(desk).toContain('from "@/components/world/native/AdminOpsDesk"');
  });

  it("the bench lives in the ops file and opens a Discord Bot section", () => {
    expect(ops).toContain("export function DiscordBench");
    expect(ops).toContain('title="Discord Bot"');
  });
});

describe("the seam paths are the rails' own", () => {
  it("config, install-url and live paths are exact", () => {
    expect(DISCORD_BOT_CONFIG_PATH).toBe("/api/discord-bot/config");
    expect(DISCORD_BOT_INSTALL_URL_PATH).toBe("/api/discord-bot/install-url");
    expect(DISCORD_BOT_LIVE_PATH).toBe("/api/discord-bot/live");
  });
});

describe("parseDiscordBotConfig — strict where it matters", () => {
  it("maps the wiring row to camelCase and reads the presence booleans", () => {
    const parsed = parseDiscordBotConfig(fullAnswer);
    expect(parsed?.env).toEqual({ clientIdSet: true, botTokenSet: true, sharedSecretSet: true });
    expect(parsed?.wiring).toEqual({
      guildId: "111",
      announceChannelId: "222",
      announceRoleId: "",
      mentionEveryone: true,
      streamerDiscordUserId: "333",
      streamerDiscordUsername: "boss#1",
      enabled: false,
    });
  });

  it("a missing wiring row is an honest null, not a failed read", () => {
    const parsed = parseDiscordBotConfig({ config: null, env: fullAnswer.env });
    expect(parsed?.wiring).toBeNull();
    expect(parsed?.env.clientIdSet).toBe(true);
  });

  it("a broken env block fails the whole read — set vs unset is never guessed", () => {
    expect(parseDiscordBotConfig({ config: null })).toBeNull();
    expect(parseDiscordBotConfig({ config: null, env: { client_id_set: true } })).toBeNull();
    expect(
      parseDiscordBotConfig({
        config: null,
        env: { client_id_set: "yes", bot_token_set: true, shared_secret_set: true },
      }),
    ).toBeNull();
    expect(parseDiscordBotConfig(null)).toBeNull();
    expect(parseDiscordBotConfig({ config: "wired", env: fullAnswer.env })).toBeNull();
  });
});

describe("presence only — no secret value can exist in the desk's data path", () => {
  it("values smuggled into the answer do not survive the parse", () => {
    const smuggled = {
      config: { ...fullAnswer.config, bot_token: "tok_SMGUGGLED_1", shared_secret: "shh_SMGUGGLED_2" },
      env: {
        ...fullAnswer.env,
        bot_token: "tok_SMGUGGLED_3",
        shared_secret: "shh_SMGUGGLED_4",
        client_id: "cid_SMGUGGLED_5",
      },
    };
    const parsed = parseDiscordBotConfig(smuggled);
    expect(parsed).not.toBeNull();
    const flat = JSON.stringify(parsed);
    expect(flat).not.toContain("SMGUGGLED");
    expect(Object.keys(parsed!.env).sort()).toEqual(["botTokenSet", "clientIdSet", "sharedSecretSet"]);
    expect(Object.keys(parsed!).sort()).toEqual(["env", "wiring"]);
  });

  it("the bench component reads only the three parsed presence flags off env", () => {
    const flags = [...ops.matchAll(/read\.env\.(\w+)/g)].map((m) => m[1]);
    expect(flags.length).toBeGreaterThan(0);
    expect(new Set(flags)).toEqual(new Set(["clientIdSet", "botTokenSet", "sharedSecretSet"]));
  });

  it("the raw wire env keys live only in the seam parser, never in the component", () => {
    for (const raw of ["client_id_set", "bot_token_set", "shared_secret_set"]) {
      expect(ops, raw).not.toContain(raw);
      expect(seam, raw).toContain(raw);
    }
    /* The env block's ID values are never read by the desk at all —
       not by the component, not even by the seam parser. */
    for (const raw of ["guild_id_env", "announce_channel_env"]) {
      expect(ops, raw).not.toContain(raw);
      expect(seam, raw).not.toContain(raw);
    }
  });

  it("the component hand-types no /api path — every call rides a seam constant", () => {
    expect(ops).toContain("DISCORD_BOT_CONFIG_PATH");
    expect(ops).toContain("DISCORD_BOT_INSTALL_URL_PATH");
    expect(ops).toContain("DISCORD_BOT_LIVE_PATH");
    expect(ops).not.toContain('"/api/');
    expect(ops).not.toContain("`/api/");
  });
});

describe("the honesty rules — the website desk's, verbatim in spirit", () => {
  const readWith = (env: DiscordBotRead["env"]): DiscordBotRead => ({ wiring: null, env });

  it("configured only when all three core keys are set", () => {
    expect(discordBotConfigured(readWith({ clientIdSet: true, botTokenSet: true, sharedSecretSet: true }))).toBe(true);
    for (const env of [
      { clientIdSet: false, botTokenSet: true, sharedSecretSet: true },
      { clientIdSet: true, botTokenSet: false, sharedSecretSet: true },
      { clientIdSet: true, botTokenSet: true, sharedSecretSet: false },
      { clientIdSet: false, botTokenSet: false, sharedSecretSet: false },
    ]) {
      expect(discordBotConfigured(readWith(env))).toBe(false);
      expect(discordBotUnconfigured(readWith(env))).toBe(true);
    }
  });

  it("the install link is blocked exactly while the client ID is unset", () => {
    expect(discordInstallBlocked(readWith({ clientIdSet: false, botTokenSet: true, sharedSecretSet: true }))).toBe(true);
    expect(discordInstallBlocked(readWith({ clientIdSet: true, botTokenSet: false, sharedSecretSet: false }))).toBe(false);
  });

  it("the bench locks the wiring as one fieldset and guards both handlers", () => {
    expect(ops).toContain("<fieldset disabled={unconfigured}");
    expect(ops).toContain("discordBotUnconfigured(read)");
    expect(ops).toContain("discordInstallBlocked(read)");
    expect(ops).toContain("if (installBlocked) return;");
    expect(ops).toContain("if (!draft || unconfigured) return;");
    expect(ops).toContain("disabled={installBlocked || act.busy !== null}");
    expect(ops).toContain("disabled={act.busy !== null || unconfigured}");
  });

  it("an unset key reads amber 'not set up', framed as a setup step — never broken", () => {
    expect(ops).toContain('"not set up"');
    expect(ops).toContain("border-amber-400/40 bg-amber-400/10 text-amber-500");
    expect(ops).toContain("nothing is broken");
    expect(ops).toContain('data-testid="world-discord-setup-note"');
  });
});

describe("the save body + draft — the page's exact shapes", () => {
  it("the body is exactly the six schema fields, snake_case, IDs trimmed", () => {
    const body = buildDiscordBotConfigBody({
      guildId: " 111 ",
      announceChannelId: "222",
      announceRoleId: "",
      mentionEveryone: false,
      streamerDiscordUserId: " 333",
      enabled: true,
    });
    expect(body).toEqual({
      guild_id: "111",
      announce_channel_id: "222",
      announce_role_id: "",
      mention_everyone: false,
      streamer_discord_user_id: "333",
      enabled: true,
    });
    expect(Object.keys(body)).toHaveLength(6);
    expect(body).not.toHaveProperty("streamer_discord_username");
  });

  it("the draft seeds from the saved row, or the page's blanks (announcements on)", () => {
    const parsed = parseDiscordBotConfig(fullAnswer)!;
    expect(discordBotDraftFrom(parsed)).toEqual({
      guildId: "111",
      announceChannelId: "222",
      announceRoleId: "",
      mentionEveryone: true,
      streamerDiscordUserId: "333",
      enabled: false,
    });
    expect(discordBotDraftFrom({ wiring: null, env: parsed.env })).toEqual({
      guildId: "",
      announceChannelId: "",
      announceRoleId: "",
      mentionEveryone: false,
      streamerDiscordUserId: "",
      enabled: true,
    });
  });
});

describe("install-url + live parsers", () => {
  it("the install answer is a bare URL string or a failed read", () => {
    expect(parseDiscordInstallUrl({ install_url: "https://discord.com/oauth2/authorize?x=1" })).toBe(
      "https://discord.com/oauth2/authorize?x=1",
    );
    expect(parseDiscordInstallUrl({})).toBeNull();
    expect(parseDiscordInstallUrl(null)).toBeNull();
  });

  it("live state parses strictly on the is_live boolean", () => {
    expect(
      parseDiscordBotLive({
        is_live: true,
        configured: true,
        started_at: "2026-11-04T00:00:00.000Z",
        ended_at: null,
        channel_name: "stage",
        stream_title: "Live!",
      }),
    ).toEqual({
      isLive: true,
      configured: true,
      startedAt: "2026-11-04T00:00:00.000Z",
      endedAt: null,
      channelName: "stage",
      streamTitle: "Live!",
    });
    expect(parseDiscordBotLive({ is_live: false, configured: false })).toMatchObject({
      isLive: false,
      configured: false,
    });
    expect(parseDiscordBotLive({ configured: true })).toBeNull();
    expect(parseDiscordBotLive(null)).toBeNull();
  });
});

describe("the gate is the desk's own — no new permission path", () => {
  it("the bench flips to the shared denied state on a mid-session 403", () => {
    expect(ops).toContain("act.denied ? (");
    expect(ops).toContain("<BenchDenied isLight={isLight} />");
  });

  it("the bench loads through the shared bench hooks, like every other bench", () => {
    expect(ops).toContain("parseDiscordBotConfig(await a.get(DISCORD_BOT_CONFIG_PATH))");
    expect(ops).toContain("parseDiscordBotLive(await a.get(DISCORD_BOT_LIVE_PATH))");
  });
});
