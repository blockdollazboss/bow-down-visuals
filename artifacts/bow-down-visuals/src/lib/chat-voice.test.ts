/**
 * chat-voice.test.ts — the Thy Cheat Code chat voice-input seam.
 *
 * Contract pinned here:
 *  (a) a spoken utterance settles exactly once with the trimmed final
 *      transcript — the same normalization the typed send path applies;
 *  (b) interim results stream the full heard-so-far text;
 *  (c) a capture that hears nothing ends as "no-speech" — never a fake
 *      or empty transcript delivered as if it were the user's words;
 *  (d) recognizer errors map to honest kinds (permission refusal is
 *      "denied", silence is "no-speech", anything else is "failed");
 *  (e) no recognizer in the browser → "unsupported", nothing throws;
 *  (f) stop() moves through the "transcribing" state before settling,
 *      and a second settle (double onend) never double-fires.
 *
 * The session is driven by an injected fake recognizer constructor —
 * the same structural shape VoiceDirectedEditsSection types for the
 * real Web Speech API — so no DOM or microphone is needed.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createChatVoiceSession,
  mapChatVoiceError,
  prepareVoiceMessage,
  chatVoiceNote,
  CHAT_VOICE_ERROR_COPY,
  type ChatVoiceErrorEvent,
  type ChatVoiceRecognition,
  type ChatVoiceResultEvent,
  type ChatVoiceState,
} from "./chat-voice";

class FakeRecognition implements ChatVoiceRecognition {
  static instances: FakeRecognition[] = [];
  lang = "";
  interimResults = false;
  continuous = false;
  onresult: ((event: ChatVoiceResultEvent) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: ChatVoiceErrorEvent) => void) | null = null;
  started = false;
  stopped = false;
  aborted = false;

  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
  abort() {
    this.aborted = true;
  }

  emitResult(pieces: Array<{ transcript: string; isFinal: boolean }>, resultIndex = 0) {
    const results: ChatVoiceResultEvent["results"] = { length: pieces.length };
    pieces.forEach((p, i) => {
      results[i] = {
        isFinal: p.isFinal,
        length: 1,
        0: { transcript: p.transcript },
      };
    });
    this.onresult?.({ resultIndex, results });
  }
  emitError(error: string) {
    this.onerror?.({ error });
  }
  emitEnd() {
    this.onend?.();
  }
}

function makeSession() {
  FakeRecognition.instances = [];
  const handlers = {
    onState: vi.fn<(s: ChatVoiceState) => void>(),
    onInterim: vi.fn<(t: string) => void>(),
    onFinal: vi.fn<(t: string) => void>(),
    onError: vi.fn<(k: string) => void>(),
  };
  const session = createChatVoiceSession(handlers, { ctor: FakeRecognition });
  const rec = () => FakeRecognition.instances[0]!;
  return { handlers, session, rec };
}

describe("chat voice seam — happy path", () => {
  it("delivers the final transcript trimmed, exactly once", () => {
    const { handlers, session, rec } = makeSession();
    session.start();
    expect(rec().started).toBe(true);
    expect(rec().interimResults).toBe(true);
    expect(rec().continuous).toBe(false);
    rec().emitResult([{ transcript: "  how much does a song cost  ", isFinal: true }]);
    rec().emitEnd();
    expect(handlers.onFinal).toHaveBeenCalledTimes(1);
    expect(handlers.onFinal).toHaveBeenCalledWith("how much does a song cost");
    expect(handlers.onError).not.toHaveBeenCalled();
    /* A second onend (some browsers double-fire) never re-settles. */
    rec().emitEnd();
    expect(handlers.onFinal).toHaveBeenCalledTimes(1);
  });

  it("streams interim text as the full heard-so-far, then settles on the final", () => {
    const { handlers, session, rec } = makeSession();
    session.start();
    rec().emitResult([{ transcript: "how much", isFinal: false }]);
    expect(handlers.onInterim).toHaveBeenCalledWith("how much");
    rec().emitResult([{ transcript: "how much does a song cost", isFinal: true }]);
    rec().emitEnd();
    expect(handlers.onFinal).toHaveBeenCalledWith("how much does a song cost");
  });

  it("stop() passes through the transcribing state before settling", () => {
    const { handlers, session, rec } = makeSession();
    session.start();
    rec().emitResult([{ transcript: "hello king", isFinal: true }]);
    session.stop();
    expect(rec().stopped).toBe(true);
    const states = handlers.onState.mock.calls.map((c) => c[0]);
    expect(states).toEqual(["listening", "transcribing"]);
    rec().emitEnd();
    expect(handlers.onFinal).toHaveBeenCalledWith("hello king");
    const allStates = handlers.onState.mock.calls.map((c) => c[0]);
    expect(allStates).toEqual(["listening", "transcribing", "idle"]);
  });
});

describe("chat voice seam — honest failures", () => {
  it("silence ends as no-speech, never as an empty final transcript", () => {
    const { handlers, session, rec } = makeSession();
    session.start();
    rec().emitEnd();
    expect(handlers.onFinal).not.toHaveBeenCalled();
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect(handlers.onError).toHaveBeenCalledWith("no-speech");
  });

  it("a whitespace-only final is still no-speech, never sent as words", () => {
    const { handlers, session, rec } = makeSession();
    session.start();
    rec().emitResult([{ transcript: "   ", isFinal: true }]);
    rec().emitEnd();
    expect(handlers.onFinal).not.toHaveBeenCalled();
    expect(handlers.onError).toHaveBeenCalledWith("no-speech");
  });

  it("permission refusal settles as denied", () => {
    const { handlers, session, rec } = makeSession();
    session.start();
    rec().emitError("not-allowed");
    rec().emitEnd();
    expect(handlers.onFinal).not.toHaveBeenCalled();
    expect(handlers.onError).toHaveBeenCalledWith("denied");
  });

  it("a recognizer no-speech error settles as no-speech", () => {
    const { handlers, session, rec } = makeSession();
    session.start();
    rec().emitError("no-speech");
    rec().emitEnd();
    expect(handlers.onError).toHaveBeenCalledWith("no-speech");
  });

  it("dispose mid-capture tears down silently — no late callbacks", () => {
    const { handlers, session, rec } = makeSession();
    session.start();
    session.dispose();
    expect(rec().aborted).toBe(true);
    rec().emitEnd();
    expect(handlers.onFinal).not.toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it("no recognizer in the browser reports unsupported and never throws", () => {
    const handlers = { onError: vi.fn<(k: string) => void>(), onFinal: vi.fn() };
    const session = createChatVoiceSession(handlers, { ctor: null });
    expect(() => session.start()).not.toThrow();
    expect(handlers.onError).toHaveBeenCalledWith("unsupported");
    expect(handlers.onFinal).not.toHaveBeenCalled();
  });
});

describe("chat voice seam — pure helpers", () => {
  it("mapChatVoiceError maps the browser's error strings to honest kinds", () => {
    expect(mapChatVoiceError("not-allowed")).toBe("denied");
    expect(mapChatVoiceError("service-not-allowed")).toBe("denied");
    expect(mapChatVoiceError("no-speech")).toBe("no-speech");
    expect(mapChatVoiceError("network")).toBe("failed");
    expect(mapChatVoiceError("audio-capture")).toBe("failed");
    expect(mapChatVoiceError("something-else")).toBe("failed");
  });

  it("prepareVoiceMessage is exactly the send path's trim", () => {
    expect(prepareVoiceMessage("  make me a song  ")).toBe("make me a song");
    expect(prepareVoiceMessage("   ")).toBe("");
  });

  it("every error kind has plain-words copy, and notes follow state", () => {
    for (const kind of ["denied", "no-speech", "failed", "unsupported"] as const) {
      expect(CHAT_VOICE_ERROR_COPY[kind].length).toBeGreaterThan(10);
      expect(chatVoiceNote("idle", kind)).toEqual({
        tone: "error",
        text: CHAT_VOICE_ERROR_COPY[kind],
      });
    }
    expect(CHAT_VOICE_ERROR_COPY.denied).toContain("typing works as always");
    expect(chatVoiceNote("listening", null)?.tone).toBe("info");
    expect(chatVoiceNote("transcribing", null)?.tone).toBe("info");
    expect(chatVoiceNote("idle", null)).toBeNull();
  });
});
