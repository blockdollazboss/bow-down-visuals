/**
 * The World — voice ICE config seam tests (lib/world/voice-ice, item 100).
 *
 * - no config / garbage config → exactly today's STUN-only list
 * - a well-formed TURN entry is ADDED after STUN, never replacing it
 * - malformed TURN entries fail closed: bad scheme, half a credential
 *   pair, non-string parts — dropped, never half-used
 * - the fetch helper fails open to STUN-only on any endpoint problem
 *   and sends the member's token the way the World page always does
 */
import { describe, it, expect } from "vitest";
import {
  buildIceServers,
  sanitizeTurnServer,
  hasTurnRelay,
  fetchVoiceIceServers,
  DEFAULT_STUN_URL,
  MAX_TURN_SERVERS,
} from "./voice-ice";

const STUN_ONLY = [{ urls: DEFAULT_STUN_URL }];

describe("buildIceServers — the STUN default is sacred", () => {
  it("no config, null config, and garbage config all give STUN-only", () => {
    expect(buildIceServers()).toEqual(STUN_ONLY);
    expect(buildIceServers(null)).toEqual(STUN_ONLY);
    expect(buildIceServers({})).toEqual(STUN_ONLY);
    expect(buildIceServers({ turnServers: "nope" as never })).toEqual(STUN_ONLY);
    expect(buildIceServers({ turnServers: [null, 42, "turn:ok-but-bare"] })).toEqual(STUN_ONLY);
  });

  it("a well-formed TURN server is added AFTER the STUN default", () => {
    const servers = buildIceServers({
      turnServers: [
        { urls: "turn:relay.example.com:3478", username: "u", credential: "p" },
      ],
    });
    expect(servers).toEqual([
      { urls: DEFAULT_STUN_URL },
      { urls: "turn:relay.example.com:3478", username: "u", credential: "p" },
    ]);
    expect(hasTurnRelay(servers)).toBe(true);
    expect(hasTurnRelay(STUN_ONLY)).toBe(false);
  });

  it("multiple TURN urls on one entry survive as a list; turns: is honoured", () => {
    const servers = buildIceServers({
      turnServers: [
        {
          urls: ["turn:a.example.com:3478", "turns:a.example.com:5349"],
          username: "u",
          credential: "p",
        },
      ],
    });
    expect(servers[1]).toEqual({
      urls: ["turn:a.example.com:3478", "turns:a.example.com:5349"],
      username: "u",
      credential: "p",
    });
  });

  it("caps the relay count so a config typo can't sprawl", () => {
    const many = Array.from({ length: MAX_TURN_SERVERS + 3 }, (_, i) => ({
      urls: `turn:r${i}.example.com:3478`,
      username: "u",
      credential: "p",
    }));
    expect(buildIceServers({ turnServers: many })).toHaveLength(1 + MAX_TURN_SERVERS);
  });
});

describe("sanitizeTurnServer — fail closed, all-or-nothing", () => {
  it("drops non-TURN schemes (a stun: or https: URL is not a relay)", () => {
    expect(sanitizeTurnServer({ urls: "stun:stun.example.com", username: "u", credential: "p" })).toBeNull();
    expect(sanitizeTurnServer({ urls: "https://example.com", username: "u", credential: "p" })).toBeNull();
  });

  it("drops a half credential pair either way round", () => {
    expect(sanitizeTurnServer({ urls: "turn:r.example.com", username: "u" })).toBeNull();
    expect(sanitizeTurnServer({ urls: "turn:r.example.com", credential: "p" })).toBeNull();
    expect(sanitizeTurnServer({ urls: "turn:r.example.com", username: "  ", credential: "p" })).toBeNull();
  });

  it("keeps a credential-free TURN entry (open relay on a private net is a real shape)", () => {
    expect(sanitizeTurnServer({ urls: "turn:10.0.0.5:3478" })).toEqual({ urls: "turn:10.0.0.5:3478" });
  });

  it("dedupes and trims urls; non-string url parts are ignored", () => {
    expect(
      sanitizeTurnServer({ urls: [" turn:r.example.com ", "turn:r.example.com", 7, null] }),
    ).toEqual({ urls: "turn:r.example.com" });
  });
});

describe("fetchVoiceIceServers — fail open to today's behaviour", () => {
  const okJson = (body: unknown) => async () => ({ ok: true, json: async () => body });

  it("returns the endpoint's TURN config, STUN first", async () => {
    const servers = await fetchVoiceIceServers(
      okJson({ turnServers: [{ urls: "turn:r.example.com", username: "u", credential: "p" }] }),
      "token-1",
    );
    expect(servers[0]).toEqual({ urls: DEFAULT_STUN_URL });
    expect(hasTurnRelay(servers)).toBe(true);
  });

  it("sends the Authorization header and the sanctioned path", async () => {
    let seenUrl = "";
    let seenInit: unknown;
    await fetchVoiceIceServers(async (url, init) => {
      seenUrl = url;
      seenInit = init;
      return { ok: true, json: async () => ({ turnServers: [] }) };
    }, "token-9");
    expect(seenUrl).toBe("/api/world/voice-config");
    expect(seenInit).toEqual({ headers: { Authorization: "Bearer token-9" } });
  });

  it("a non-ok response, a throwing fetch, and junk JSON all give STUN-only", async () => {
    expect(
      await fetchVoiceIceServers(async () => ({ ok: false, json: async () => ({}) }), null),
    ).toEqual(STUN_ONLY);
    expect(
      await fetchVoiceIceServers(async () => {
        throw new Error("offline");
      }, null),
    ).toEqual(STUN_ONLY);
    expect(await fetchVoiceIceServers(okJson("garbage"), null)).toEqual(STUN_ONLY);
    expect(await fetchVoiceIceServers(okJson({ turnServers: [{ urls: "https://x" }] }), null)).toEqual(
      STUN_ONLY,
    );
  });
});
