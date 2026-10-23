/**
 * world-voice-config — the server half of the voice ICE seam (item 100).
 *
 * The relay coordinates live only in env (WORLD_TURN_URLS /
 * WORLD_TURN_USERNAME / WORLD_TURN_CREDENTIAL). The builder is
 * all-or-nothing: anything less than a complete, valid set serves
 * an honest empty relay list — never a half-configured relay.
 */
import { describe, it, expect } from "vitest";
import { buildWorldVoiceConfig, voiceRelayConfigured } from "../world-voice-config";

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
