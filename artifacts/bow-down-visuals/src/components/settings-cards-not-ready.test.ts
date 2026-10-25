/**
 * settings-cards-not-ready.test.ts — Stack-200 lane 2, board items 4–7.
 *
 * The four Settings cards (Connected Accounts, Social Proof, Discord,
 * API keys) showed broken error cards on the Oct 24/25 live walks.
 * The server now answers an honest 503 *_not_ready when a card's
 * backing table isn't on the database yet (migration 0241); each
 * card must render that as a plain "isn't switched on yet" note —
 * a SEPARATE state from its real load-error state, which stays for
 * genuine failures. These source pins keep the four branches from
 * collapsing back into the error state.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (name: string) => readFileSync(join(__dirname, name), "utf8");

describe("ConnectedAccounts — 503 is the plain not-ready state, not the red error", () => {
  const src = read("ConnectedAccounts.tsx");
  it("tracks a separate unavailable state set by a 503", () => {
    expect(src).toContain("const [unavailable, setUnavailable] = useState(false);");
    expect(src).toContain("res.status === 503");
    expect(src).toContain("setUnavailable(true);");
  });
  it("renders the plain note before the load-error branch", () => {
    const note = src.indexOf("Social posting isn't switched on for this site yet");
    const err = src.indexOf("Couldn't load your connected accounts");
    expect(note).toBeGreaterThan(-1);
    expect(err).toBeGreaterThan(note);
  });
});

describe("SocialProofSettings — 503 renders the localized notReady line", () => {
  const src = read("SocialProofSettings.tsx");
  it("tracks unavailable separately from loadError", () => {
    expect(src).toContain("const [unavailable, setUnavailable] = useState(false);");
    expect(src).toContain("res.status === 503");
  });
  it("renders social-proof.notReady before the loadError branch", () => {
    const note = src.indexOf('t("social-proof.notReady")');
    const err = src.indexOf('t("social-proof.loadError")');
    expect(note).toBeGreaterThan(-1);
    expect(err).toBeGreaterThan(note);
  });
  it("the notReady key exists in every locale", async () => {
    const { readdirSync } = await import("node:fs");
    const localesDir = join(__dirname, "..", "locales");
    for (const file of readdirSync(localesDir).filter((f) => f.endsWith(".json"))) {
      const locale = JSON.parse(readFileSync(join(localesDir, file), "utf8"));
      expect(locale["social-proof"]?.notReady, file).toBeTruthy();
    }
  });
});

describe("DiscordWebhookSettings — 503 is the plain not-ready state", () => {
  const src = read("DiscordWebhookSettings.tsx");
  it("tracks unavailable and sets it on a 503 status load", () => {
    expect(src).toContain("const [unavailable, setUnavailable] = useState(false);");
    expect(src).toContain("res.status === 503");
    expect(src).toContain("setUnavailable(true);");
  });
  it("renders the plain note before the Couldn't-load error card", () => {
    const note = src.indexOf("Discord announcements aren't switched on for this site yet");
    const err = src.indexOf("Couldn't load your Discord settings.");
    expect(note).toBeGreaterThan(-1);
    expect(err).toBeGreaterThan(note);
  });
});

describe("DeveloperApiSettings — 503 is the plain not-ready state", () => {
  const src = read("DeveloperApiSettings.tsx");
  it("tracks unavailable and sets it on a 503 key load", () => {
    expect(src).toContain("const [unavailable, setUnavailable] = useState(false);");
    expect(src).toContain("res.status === 503");
    expect(src).toContain("setUnavailable(true);");
  });
  it("renders the plain note before the Couldn't-load error line", () => {
    const note = src.indexOf("API keys aren't switched on for this site yet");
    const err = src.indexOf("Couldn't load your API keys.");
    expect(note).toBeGreaterThan(-1);
    expect(err).toBeGreaterThan(note);
  });
});
