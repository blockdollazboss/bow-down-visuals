/**
 * discord-bot-desk-honesty.test.ts — QC-200 fix queue #8.
 *
 * The Discord Live Companion desk (pages/discord-bot.tsx, also the
 * go-live "discord" tab) reads its Server Status from
 * GET /api/discord-bot/config, which reports which DISCORD_* keys the
 * api-server process can see. On a service where those keys are not set
 * yet, the desk used to render red "MISSING" badges — a setup state
 * dressed as a failure — while the Install button stayed live even
 * though the server refuses to build an install URL without
 * DISCORD_CLIENT_ID, and the wiring form stayed live even though saved
 * wiring can announce nothing until the bot is connected.
 *
 * These assertions pin the honest behavior:
 * - unset keys read as a setup state ("not set up", no destructive badge);
 * - Install is disabled while the client ID is known to be unset, with
 *   the plain reason shown and the handler itself guarded;
 * - the whole wiring form is locked while any core key is unset, with
 *   the plain reason shown;
 * - the en catalog carries the setup-state copy, framed as "not broken".
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("../pages/discord-bot.tsx", import.meta.url), "utf8");
const en = JSON.parse(readFileSync(new URL("../locales/en.json", import.meta.url), "utf8")) as {
  "discord-bot": Record<string, string>;
};
const bot = en["discord-bot"];

describe("discord-bot desk — unconfigured reads as setup, never as broken", () => {
  it("the status badge no longer uses the destructive variant for an unset key", () => {
    expect(pageSource).not.toContain('ok ? "default" : "destructive"');
    expect(pageSource).toContain('t("discord-bot.notSetUp")');
  });

  it("the setup-state note renders while the bot is unconfigured", () => {
    expect(pageSource).toContain('t("discord-bot.setupStateNote")');
    expect(bot.setupStateNote).toContain("nothing is broken");
  });

  it("unconfigured = env loaded and any core key unset (client, token, shared secret)", () => {
    expect(pageSource).toContain(
      "!(env?.client_id_set && env?.bot_token_set && env?.shared_secret_set)",
    );
  });
});

describe("discord-bot desk — controls that cannot work stay off, with the reason", () => {
  it("Install is disabled while DISCORD_CLIENT_ID is known to be unset, and the handler is guarded", () => {
    expect(pageSource).toContain("const installBlocked = envLoaded && !env?.client_id_set;");
    expect(pageSource).toContain("disabled={installBlocked}");
    expect(pageSource).toContain("if (installBlocked) return;");
    expect(pageSource).toContain('t("discord-bot.installNeedsClientId")');
    expect(bot.installNeedsClientId).toContain("DISCORD_CLIENT_ID");
  });

  it("the wiring form is locked as one fieldset while the bot is unconfigured", () => {
    expect(pageSource).toContain("<fieldset disabled={botUnconfigured}");
    expect(pageSource).toContain("disabled={saving || botUnconfigured}");
    expect(pageSource).toContain("if (botUnconfigured) return;");
    expect(pageSource).toContain('t("discord-bot.wiringLockedNote")');
    expect(bot.wiringLockedNote.length).toBeGreaterThan(0);
  });

  it("the badge copy for an unset key exists in the catalog", () => {
    expect(bot.notSetUp).toBe("not set up");
  });
});
