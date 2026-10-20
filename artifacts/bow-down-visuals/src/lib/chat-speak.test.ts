/**
 * chat-speak.test.ts — the Thy Cheat Code chat voice-OUT seam.
 *
 * Contract pinned here:
 *  (a) the status payload is parsed defensively — readiness and the
 *      price are exactly what the server said, never fabricated from
 *      a malformed body;
 *  (b) the control view follows the server's word: loading →
 *      casting (voice not cast yet) → ready, with a status failure
 *      landing on "unavailable", and a "ready" with no truthful
 *      price is NOT sellable;
 *  (c) the voice-out preference persists per user under the drawer's
 *      bdv-chat-* key family and defaults OFF;
 *  (d) a speak request posts { text, idempotencyKey } to the speak
 *      rail; a cancelled spend confirmation returns null (no request,
 *      no charge); failures throw the SERVER's own message;
 *  (e) playback is single-voice: starting a new spoken reply stops
 *      the one still playing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAT_SPEAK_PATH,
  CHAT_SPEAK_PREF_KEY,
  CHAT_SPEAK_STATUS_PATH,
  chatSpeakView,
  fetchChatSpeakStatus,
  loadChatSpeakEnabled,
  newChatSpeakKey,
  parseChatSpeakStatus,
  playChatSpeakAudio,
  requestChatSpeak,
  saveChatSpeakEnabled,
  stopChatSpeakAudio,
  type ChatSpeakFetch,
} from "./chat-speak";

/* Minimal localStorage stand-in for the node test environment. */
class FakeStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

function fakeResponse(ok: boolean, body: unknown): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response;
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new FakeStorage());
});

afterEach(() => {
  stopChatSpeakAudio();
  vi.unstubAllGlobals();
});

describe("parseChatSpeakStatus", () => {
  it("passes through the server's readiness and price verbatim", () => {
    expect(parseChatSpeakStatus({ ready: true, creditCost: 100 })).toEqual({
      ready: true,
      creditCost: 100,
    });
    expect(parseChatSpeakStatus({ ready: false, creditCost: 100 })).toEqual({
      ready: false,
      creditCost: 100,
    });
    /* a server-side price change is honored, never overridden */
    expect(parseChatSpeakStatus({ ready: true, creditCost: 250 })).toEqual({
      ready: true,
      creditCost: 250,
    });
  });

  it("never fabricates readiness or a price from a malformed body", () => {
    expect(parseChatSpeakStatus(null)).toEqual({ ready: false, creditCost: 0 });
    expect(parseChatSpeakStatus({})).toEqual({ ready: false, creditCost: 0 });
    expect(parseChatSpeakStatus({ ready: "yes", creditCost: "100" })).toEqual({
      ready: false,
      creditCost: 0,
    });
    expect(parseChatSpeakStatus({ ready: true, creditCost: -5 })).toEqual({
      ready: true,
      creditCost: 0,
    });
  });
});

describe("chatSpeakView", () => {
  it("follows the server's word through every state", () => {
    expect(chatSpeakView(null, false)).toBe("loading");
    expect(chatSpeakView(null, true)).toBe("unavailable");
    expect(chatSpeakView({ ready: false, creditCost: 100 }, false)).toBe("casting");
    expect(chatSpeakView({ ready: true, creditCost: 100 }, false)).toBe("ready");
    expect(chatSpeakView({ ready: true, creditCost: 100 }, true)).toBe("unavailable");
  });

  it("a ready voice with no truthful price is not sellable", () => {
    expect(chatSpeakView({ ready: true, creditCost: 0 }, false)).toBe("unavailable");
  });
});

describe("the voice-out preference", () => {
  it("defaults OFF and persists under the drawer's key family", () => {
    expect(CHAT_SPEAK_PREF_KEY).toBe("bdv-chat-voice-out");
    expect(loadChatSpeakEnabled()).toBe(false);
    saveChatSpeakEnabled(true);
    expect(loadChatSpeakEnabled()).toBe(true);
    saveChatSpeakEnabled(false);
    expect(loadChatSpeakEnabled()).toBe(false);
  });
});

describe("fetchChatSpeakStatus", () => {
  it("reads the status rail and parses it", async () => {
    const seen: string[] = [];
    const fetchImpl: ChatSpeakFetch = async (input) => {
      seen.push(input);
      return fakeResponse(true, { ready: true, creditCost: 100 });
    };
    const status = await fetchChatSpeakStatus(fetchImpl);
    expect(seen).toEqual([CHAT_SPEAK_STATUS_PATH]);
    expect(status).toEqual({ ready: true, creditCost: 100 });
  });

  it("throws on a failed status read so the UI can say so honestly", async () => {
    const fetchImpl: ChatSpeakFetch = async () => fakeResponse(false, {});
    await expect(fetchChatSpeakStatus(fetchImpl)).rejects.toThrow();
  });
});

describe("requestChatSpeak", () => {
  it("posts the reply text and the idempotency key to the speak rail", async () => {
    let seenUrl = "";
    let seenBody: unknown = null;
    const fetchImpl: ChatSpeakFetch = async (input, init) => {
      seenUrl = input;
      seenBody = JSON.parse(String(init?.body ?? "{}"));
      return fakeResponse(true, {
        audioPlayUrl: "https://play.example/reply.mp3",
        creditsUsed: 100,
        creditsRemaining: 900,
      });
    };
    const result = await requestChatSpeak(
      fetchImpl,
      "Welcome to the palace.",
      "speak-key-1234",
    );
    expect(seenUrl).toBe(CHAT_SPEAK_PATH);
    expect(seenBody).toEqual({
      text: "Welcome to the palace.",
      idempotencyKey: "speak-key-1234",
    });
    expect(result).toEqual({
      audioPlayUrl: "https://play.example/reply.mp3",
      creditsUsed: 100,
      creditsRemaining: 900,
    });
  });

  it("a cancelled spend confirmation returns null — no charge, no error", async () => {
    const fetchImpl: ChatSpeakFetch = async () => null;
    await expect(
      requestChatSpeak(fetchImpl, "Hi.", "speak-key-cancel"),
    ).resolves.toBeNull();
  });

  it("failures throw the server's own message", async () => {
    const fetchImpl: ChatSpeakFetch = async () =>
      fakeResponse(false, {
        error: "voice_not_ready",
        message: "Thy Cheat Code's voice is still being cast — spoken replies aren't ready yet. Nothing was charged.",
      });
    await expect(
      requestChatSpeak(fetchImpl, "Hi.", "speak-key-nr"),
    ).rejects.toThrow("still being cast");
  });

  it("a failure with only an error code throws that code, not an invention", async () => {
    const fetchImpl: ChatSpeakFetch = async () =>
      fakeResponse(false, { error: "out_of_credits" });
    await expect(
      requestChatSpeak(fetchImpl, "Hi.", "speak-key-ooc"),
    ).rejects.toThrow("out_of_credits");
  });

  it("an ok response with no playable URL is a failure, not a success", async () => {
    const fetchImpl: ChatSpeakFetch = async () => fakeResponse(true, {});
    await expect(
      requestChatSpeak(fetchImpl, "Hi.", "speak-key-nourl"),
    ).rejects.toThrow();
  });
});

describe("newChatSpeakKey", () => {
  it("mints distinct keys long enough to count as client keys", () => {
    const a = newChatSpeakKey();
    const b = newChatSpeakKey();
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(a).not.toBe(b);
  });
});

describe("playChatSpeakAudio", () => {
  it("plays through the injected factory and stops the previous voice", () => {
    const elements: { url: string; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> }[] = [];
    const factory = (url: string) => {
      const el = {
        url,
        play: vi.fn(async () => {}),
        pause: vi.fn(),
      };
      elements.push(el);
      return el as unknown as HTMLAudioElement;
    };
    playChatSpeakAudio("https://play.example/one.mp3", factory);
    expect(elements[0]!.play).toHaveBeenCalledTimes(1);
    playChatSpeakAudio("https://play.example/two.mp3", factory);
    /* the King never talks over himself */
    expect(elements[0]!.pause).toHaveBeenCalledTimes(1);
    expect(elements[1]!.play).toHaveBeenCalledTimes(1);
  });
});
