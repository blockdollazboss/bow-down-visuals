/**
 * world-voice-config — the server half of the voice ICE seam (item 100).
 *
 * The relay coordinates live only in env (WORLD_TURN_URLS /
 * WORLD_TURN_USERNAME / WORLD_TURN_CREDENTIAL). The builder is
 * all-or-nothing: anything less than a complete, valid set serves
 * an honest empty relay list — never a half-configured relay.
 */
import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import {
  buildWorldVoiceConfig,
  voiceRelayConfigured,
  signTurnCredentials,
  TURN_CREDENTIAL_TTL_SECONDS,
} from "../world-voice-config";

const FULL = {
  WORLD_TURN_URLS: "turn:relay.example.com:3478",
  WORLD_TURN_USERNAME: "hall",
  WORLD_TURN_CREDENTIAL: "sekret",
};

describe("buildWorldVoiceConfig", () => {
  it("no env → no relay, honestly empty", () => {
    expect(buildWorldVoiceConfig({})).toEqual({ turnServers: [] });
    expect(voiceRelayConfigured({})).toBe(false);
  });

  it("a complete env serves exactly one relay entry", () => {
    expect(buildWorldVoiceConfig(FULL)).toEqual({
      turnServers: [
        { urls: "turn:relay.example.com:3478", username: "hall", credential: "sekret" },
      ],
    });
    expect(voiceRelayConfigured(FULL)).toBe(true);
  });

  it("comma-separated URLs (incl. turns:) ride as one entry's list", () => {
    const cfg = buildWorldVoiceConfig({
      ...FULL,
      WORLD_TURN_URLS: " turn:a.example.com:3478 , turns:a.example.com:5349 ",
    });
    expect(cfg.turnServers[0]!.urls).toEqual([
      "turn:a.example.com:3478",
      "turns:a.example.com:5349",
    ]);
  });

  it("half a config serves NOTHING — urls without credentials, or credentials without urls", () => {
    expect(buildWorldVoiceConfig({ WORLD_TURN_URLS: FULL.WORLD_TURN_URLS })).toEqual({
      turnServers: [],
    });
    expect(
      buildWorldVoiceConfig({
        WORLD_TURN_USERNAME: "hall",
        WORLD_TURN_CREDENTIAL: "sekret",
      }),
    ).toEqual({ turnServers: [] });
    expect(
      buildWorldVoiceConfig({ ...FULL, WORLD_TURN_CREDENTIAL: "" }),
    ).toEqual({ turnServers: [] });
  });

  it("non-TURN urls are filtered out; if none survive, no relay", () => {
    expect(
      buildWorldVoiceConfig({ ...FULL, WORLD_TURN_URLS: "stun:stun.example.com, https://x" }),
    ).toEqual({ turnServers: [] });
    const mixed = buildWorldVoiceConfig({
      ...FULL,
      WORLD_TURN_URLS: "stun:stun.example.com, turn:relay.example.com:3478",
    });
    expect(mixed.turnServers[0]!.urls).toBe("turn:relay.example.com:3478");
  });

  it("duplicate urls collapse", () => {
    const cfg = buildWorldVoiceConfig({
      ...FULL,
      WORLD_TURN_URLS: "turn:r.example.com,turn:r.example.com",
    });
    expect(cfg.turnServers[0]!.urls).toBe("turn:r.example.com");
  });
});

/* Stack-100 #2 item 100 — ephemeral (coturn REST) credentials.
   When WORLD_TURN_SECRET is set, the rail signs short-lived
   per-session credentials instead of serving one static shared
   credential; when unset, behaviour is exactly the static seam
   pinned above. No env is set anywhere by these tests — the env
   is passed in, as the builder has always taken it. */
describe("buildWorldVoiceConfig — ephemeral mode (WORLD_TURN_SECRET set)", () => {
  const SECRET_ENV = {
    WORLD_TURN_URLS: "turn:relay.example.com:3478",
    WORLD_TURN_SECRET: "coturn-shared-secret",
  };
  const NOW = 1_762_000_000_000; // fixed clock — deterministic pins

  it("serves a signed per-session pair: username carries expiry + member, credential is base64 HMAC-SHA1(secret, username)", () => {
    const cfg = buildWorldVoiceConfig(SECRET_ENV, { userId: "user-42", nowMs: NOW });
    expect(cfg.turnServers).toHaveLength(1);
    const entry = cfg.turnServers[0]!;
    expect(entry.urls).toBe("turn:relay.example.com:3478");
    const expectedUsername = `${Math.floor(NOW / 1000) + TURN_CREDENTIAL_TTL_SECONDS}:user-42`;
    expect(entry.username).toBe(expectedUsername);
    expect(entry.credential).toBe(
      createHmac("sha1", "coturn-shared-secret").update(expectedUsername).digest("base64"),
    );
    /* The expiry is in the future and within the TTL window. */
    const expiry = Number(entry.username.split(":")[0]);
    expect(expiry - Math.floor(NOW / 1000)).toBe(TURN_CREDENTIAL_TTL_SECONDS);
  });

  it("different members and different moments sign different credentials (no shared static pair)", () => {
    const a = buildWorldVoiceConfig(SECRET_ENV, { userId: "user-a", nowMs: NOW });
    const b = buildWorldVoiceConfig(SECRET_ENV, { userId: "user-b", nowMs: NOW });
    const later = buildWorldVoiceConfig(SECRET_ENV, { userId: "user-a", nowMs: NOW + 60_000 });
    expect(a.turnServers[0]!.username).not.toBe(b.turnServers[0]!.username);
    expect(a.turnServers[0]!.credential).not.toBe(b.turnServers[0]!.credential);
    expect(a.turnServers[0]!.username).not.toBe(later.turnServers[0]!.username);
  });

  it("ephemeral mode needs no static halves, and wins when both are configured", () => {
    const both = buildWorldVoiceConfig(
      { ...SECRET_ENV, WORLD_TURN_USERNAME: "hall", WORLD_TURN_CREDENTIAL: "sekret" },
      { userId: "user-42", nowMs: NOW },
    );
    expect(both.turnServers[0]!.username).toContain(":user-42");
    expect(both.turnServers[0]!.credential).not.toBe("sekret");
    expect(voiceRelayConfigured(SECRET_ENV)).toBe(true);
  });

  it("secret without valid URLs still serves nothing (fail-closed)", () => {
    expect(buildWorldVoiceConfig({ WORLD_TURN_SECRET: "s" })).toEqual({ turnServers: [] });
    expect(
      buildWorldVoiceConfig({ WORLD_TURN_SECRET: "s", WORLD_TURN_URLS: "stun:only.example.com" }),
    ).toEqual({ turnServers: [] });
  });

  it("signTurnCredentials falls back to a generic session label without a member id", () => {
    const { username } = signTurnCredentials("k", null, NOW);
    expect(username).toBe(`${Math.floor(NOW / 1000) + TURN_CREDENTIAL_TTL_SECONDS}:world-voice`);
  });

  it("UNSET secret = exactly the static behaviour (byte-identical DTO)", () => {
    expect(buildWorldVoiceConfig(FULL, { userId: "user-42", nowMs: NOW })).toEqual({
      turnServers: [
        { urls: "turn:relay.example.com:3478", username: "hall", credential: "sekret" },
      ],
    });
    expect(buildWorldVoiceConfig({}, { userId: "user-42" })).toEqual({ turnServers: [] });
  });
});
