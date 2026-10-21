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
  getChatVoiceTransport,
  isServerChatVoiceSupported,
  mapChatVoiceError,
  prepareVoiceMessage,
  chatVoiceNote,
  CHAT_VOICE_ERROR_COPY,
  CHAT_VOICE_MAX_UTTERANCE_SEC,
  CHAT_VOICE_TRANSCRIBE_CREDITS,
  CHAT_VOICE_TRANSCRIBE_PATH,
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
    for (const kind of [
      "denied",
      "no-speech",
      "failed",
      "unsupported",
      "recording-failed",
      "transcription-failed",
      "unauthenticated",
    ] as const) {
      expect(CHAT_VOICE_ERROR_COPY[kind].length).toBeGreaterThan(10);
      expect(chatVoiceNote("idle", kind)).toEqual({
        tone: "error",
        text: CHAT_VOICE_ERROR_COPY[kind],
      });
    }
    expect(CHAT_VOICE_ERROR_COPY.denied).toContain("typing works as always");
    expect(CHAT_VOICE_ERROR_COPY["transcription-failed"]).toContain(
      "couldn't turn it into text",
    );
    expect(chatVoiceNote("listening", null)?.tone).toBe("info");
    expect(chatVoiceNote("transcribing", null)?.tone).toBe("info");
    expect(chatVoiceNote("idle", null)).toBeNull();
  });
});

/* ─── The server fallback transport (wave-2 #9) ────────────────────────
   Driven by a fake MediaRecorder + fake getUserMedia + fake fetch —
   the same injection discipline as the browser path's fake recognizer. */

class FakeTrack {
  stopped = false;
  stop() {
    this.stopped = true;
  }
}

class FakeStream {
  track = new FakeTrack();
  getTracks() {
    return [this.track];
  }
}

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static supported = new Set(["audio/webm;codecs=opus", "audio/webm"]);
  static isTypeSupported = (m: string) => FakeRecorder.supported.has(m);
  mimeType: string;
  state = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  constructor(
    public stream: unknown,
    options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? "audio/webm";
    FakeRecorder.instances.push(this);
  }
  start() {
    this.state = "recording";
    /* Emit one chunk immediately, like a real recorder's timeslice. */
    this.ondataavailable?.({ data: new Blob(["fake-audio"], { type: this.mimeType }) });
  }
  stop() {
    this.state = "inactive";
    this.onstop?.();
  }
  emitError() {
    this.onerror?.(new Error("recorder exploded"));
  }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeServerSession(
  fetchImpl: (
    input: string,
    init?: RequestInit,
  ) => Promise<Response | null> = async () =>
    jsonResponse(200, { transcript: "  how much does a song cost  " }),
  extra: { maxDurationMs?: number } = {},
) {
  FakeRecorder.instances = [];
  const stream = new FakeStream();
  const handlers = {
    onState: vi.fn<(s: ChatVoiceState) => void>(),
    onInterim: vi.fn<(t: string) => void>(),
    onFinal: vi.fn<(t: string) => void>(),
    onError: vi.fn<(k: string) => void>(),
  };
  const fetchSpy = vi.fn(fetchImpl);
  const session = createChatVoiceSession(handlers, {
    ctor: null,
    server: {
      recorderCtor: FakeRecorder as never,
      getUserMedia: async () => stream as never,
      fetchImpl: fetchSpy as never,
      ...extra,
    },
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { handlers, session, fetchSpy, stream, flush, rec: () => FakeRecorder.instances[0]! };
}

describe("chat voice seam — transport decision (browser-first)", () => {
  it("the browser recognizer wins wherever it exists — the server path never fires", () => {
    expect(
      getChatVoiceTransport({
        ctor: FakeRecognition,
        recorderCtor: FakeRecorder as never,
        getUserMedia: async () => new FakeStream() as never,
      }),
    ).toBe("browser");
  });

  it("the server fallback is chosen only where the browser API is absent", () => {
    expect(
      getChatVoiceTransport({
        ctor: null,
        recorderCtor: FakeRecorder as never,
        getUserMedia: async () => new FakeStream() as never,
      }),
    ).toBe("server");
    expect(isServerChatVoiceSupported({ recorderCtor: null, getUserMedia: null })).toBe(false);
  });

  it("neither transport → null (the honest unsupported-everywhere verdict)", () => {
    expect(
      getChatVoiceTransport({ ctor: null, recorderCtor: null, getUserMedia: null }),
    ).toBeNull();
  });

  it("the fallback is FREE and capped, stated as constants", () => {
    expect(CHAT_VOICE_TRANSCRIBE_CREDITS).toBe(0);
    expect(CHAT_VOICE_MAX_UTTERANCE_SEC).toBe(30);
    expect(CHAT_VOICE_TRANSCRIBE_PATH).toBe("/api/chat/voice/transcribe");
  });
});

describe("chat voice seam — server fallback happy path", () => {
  it("records, posts once to the free fallback endpoint, and delivers the trimmed transcript", async () => {
    const { handlers, session, fetchSpy, rec, flush } = makeServerSession();
    session.start();
    await flush();
    expect(rec().state).toBe("recording");
    expect(handlers.onState).toHaveBeenCalledWith("listening");
    session.stop();
    expect(handlers.onState).toHaveBeenCalledWith("transcribing");
    await flush();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [path, init] = fetchSpy.mock.calls[0]!;
    expect(path).toBe(CHAT_VOICE_TRANSCRIBE_PATH);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    expect(handlers.onFinal).toHaveBeenCalledTimes(1);
    expect(handlers.onFinal).toHaveBeenCalledWith("how much does a song cost");
    expect(handlers.onError).not.toHaveBeenCalled();
    const states = handlers.onState.mock.calls.map((c) => c[0]);
    expect(states).toEqual(["listening", "transcribing", "idle"]);
  });

  it("the utterance cap stops the recording on its own and still transcribes", async () => {
    const { handlers, session, flush } = makeServerSession(undefined, {
      maxDurationMs: 20,
    });
    session.start();
    await flush();
    await new Promise((r) => setTimeout(r, 40));
    await flush();
    expect(handlers.onFinal).toHaveBeenCalledWith("how much does a song cost");
  });

  it("dispose mid-recording tears down silently — no fetch, no late callbacks", async () => {
    const { handlers, session, fetchSpy, stream, flush } = makeServerSession();
    session.start();
    await flush();
    session.dispose();
    await flush();
    expect(stream.track.stopped).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(handlers.onFinal).not.toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
  });
});

describe("chat voice seam — server fallback honest failures", () => {
  it("mic permission refused on the fallback settles as denied", async () => {
    const handlers = { onError: vi.fn<(k: string) => void>(), onFinal: vi.fn() };
    const denied = new Error("nope");
    denied.name = "NotAllowedError";
    const session = createChatVoiceSession(handlers, {
      ctor: null,
      server: {
        recorderCtor: FakeRecorder as never,
        getUserMedia: async () => {
          throw denied;
        },
        fetchImpl: async () => null,
      },
    });
    session.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(handlers.onError).toHaveBeenCalledWith("denied");
    expect(handlers.onFinal).not.toHaveBeenCalled();
  });

  it("a non-permission capture failure settles as recording-failed", async () => {
    const handlers = { onError: vi.fn<(k: string) => void>(), onFinal: vi.fn() };
    const session = createChatVoiceSession(handlers, {
      ctor: null,
      server: {
        recorderCtor: FakeRecorder as never,
        getUserMedia: async () => {
          throw new Error("device busy");
        },
        fetchImpl: async () => null,
      },
    });
    session.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(handlers.onError).toHaveBeenCalledWith("recording-failed");
  });

  it("a recorder error mid-capture settles as recording-failed, never a transcript", async () => {
    const { handlers, session, fetchSpy, rec, flush } = makeServerSession();
    session.start();
    await flush();
    rec().emitError();
    await flush();
    expect(handlers.onError).toHaveBeenCalledWith("recording-failed");
    expect(handlers.onFinal).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a 502 from the fallback settles as transcription-failed", async () => {
    const { handlers, session, flush } = makeServerSession(async () =>
      jsonResponse(502, { error: "transcription_failed" }),
    );
    session.start();
    await flush();
    session.stop();
    await flush();
    expect(handlers.onError).toHaveBeenCalledWith("transcription-failed");
    expect(handlers.onFinal).not.toHaveBeenCalled();
  });

  it("a 401 from the fallback settles as unauthenticated — sign-in is the honest fix", async () => {
    const { handlers, session, flush } = makeServerSession(async () =>
      jsonResponse(401, { error: "unauthorized" }),
    );
    session.start();
    await flush();
    session.stop();
    await flush();
    expect(handlers.onError).toHaveBeenCalledWith("unauthenticated");
  });

  it("the server's no_speech verdict keeps its kind; an empty 200 transcript is no-speech too", async () => {
    const noSpeech = makeServerSession(async () =>
      jsonResponse(422, { error: "no_speech" }),
    );
    noSpeech.session.start();
    await noSpeech.flush();
    noSpeech.session.stop();
    await noSpeech.flush();
    expect(noSpeech.handlers.onError).toHaveBeenCalledWith("no-speech");

    const empty = makeServerSession(async () =>
      jsonResponse(200, { transcript: "   " }),
    );
    empty.session.start();
    await empty.flush();
    empty.session.stop();
    await empty.flush();
    expect(empty.handlers.onError).toHaveBeenCalledWith("no-speech");
    expect(empty.handlers.onFinal).not.toHaveBeenCalled();
  });

  it("a thrown fetch settles as transcription-failed — never silent", async () => {
    const { handlers, session, flush } = makeServerSession(async () => {
      throw new Error("network down");
    });
    session.start();
    await flush();
    session.stop();
    await flush();
    expect(handlers.onError).toHaveBeenCalledWith("transcription-failed");
  });

  it("no recording path anywhere settles as unsupported and never throws", async () => {
    const handlers = { onError: vi.fn<(k: string) => void>(), onFinal: vi.fn() };
    const session = createChatVoiceSession(handlers, {
      ctor: null,
      server: { recorderCtor: null, getUserMedia: null },
    });
    expect(() => session.start()).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(handlers.onError).toHaveBeenCalledWith("unsupported");
    expect(handlers.onFinal).not.toHaveBeenCalled();
  });
});
