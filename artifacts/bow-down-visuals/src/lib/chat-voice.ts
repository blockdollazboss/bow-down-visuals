/* chat-voice.ts — the voice-input transport seam for the Thy Cheat Code chat.
 *
 * Voice IN for the chat, transport only: capture one spoken utterance,
 * turn it into text, and hand that text to the chat's existing send path
 * (ThyCheatCodeChat's send() → POST /api/free-chat). This seam changes
 * nothing about how answers are generated and executes no actions — it
 * is a microphone, not a brain and not hands.
 *
 * Two transports behind ONE seam, decided once per session:
 *   1. BROWSER-FIRST (the default wherever it exists): the browser's
 *      built-in speech recognition (Web Speech API), also used by the
 *      editor's VoiceDirectedEditsSection. Recognition happens in the
 *      browser: NO server call, NO cost — the free path stays the
 *      default exactly as before.
 *   2. SERVER FALLBACK (Stack-4 wave-2 #9): where the Web Speech API is
 *      absent, the utterance is recorded with MediaRecorder and sent
 *      to POST /api/chat/voice/transcribe, which transcribes it through
 *      the shared Scribe seam (api-server lib/transcription.ts). Voice
 *      input no longer simply doesn't exist on those browsers.
 *
 * THE MONEY RULE for the fallback (mirrored in the server route):
 * CHAT_VOICE_TRANSCRIBE_CREDITS is 0. Free-chat is free, so its voice
 * fallback is free too — the server path fires ONLY where the browser
 * API is unsupported, and a chat utterance NEVER becomes a charged
 * transcription (the 100 VB song-file rail at /api/transcribe is a
 * different rail and is never touched here). The house absorbs the
 * tiny per-utterance provider cost.
 *
 * Honest states: every failure says so — mic permission `denied`,
 * neither transport available `unsupported`, a capture that fails
 * `recording-failed`, a server transcription that fails
 * `transcription-failed`, a signed-out member on the fallback
 * `unauthenticated`, and silence `no-speech`. Never a silent dead mic,
 * never invented text. The server path has no interim stream (the
 * transcript arrives whole), so it holds the `transcribing` state
 * while the server works — the wait is shown, not hidden.
 *
 * Voice OUT is deliberately NOT here: spoken replies live in
 * lib/chat-speak.ts (POST /api/chat/speak, the King's designed voice,
 * server-priced per the owner's Oct 20, 2026 ruling). This seam stays
 * input only.
 */

/** Capture lifecycle: idle → listening → transcribing → idle. */
export type ChatVoiceState = "idle" | "listening" | "transcribing";

/**
 * Honest failure kinds. `denied` = mic access refused (either
 * transport), `no-speech` = capture ended with nothing heard,
 * `failed` = the browser recognizer itself errored, `unsupported` =
 * NEITHER transport exists in this browser (no Web Speech API and no
 * audio recording), `recording-failed` = the server-path capture
 * itself failed, `transcription-failed` = the recording reached the
 * server but came back without a transcript, `unauthenticated` = the
 * server fallback needs a signed-in member and there is no session.
 */
export type ChatVoiceErrorKind =
  | "denied"
  | "no-speech"
  | "failed"
  | "unsupported"
  | "recording-failed"
  | "transcription-failed"
  | "unauthenticated";

export interface ChatVoiceHandlers {
  onState?: (state: ChatVoiceState) => void;
  /** The full text heard so far (final chunks + current interim).
   *  Browser transport only — the server transport delivers its
   *  transcript whole via onFinal. */
  onInterim?: (text: string) => void;
  /** The finished utterance, trimmed, exactly once per capture. */
  onFinal?: (text: string) => void;
  onError?: (kind: ChatVoiceErrorKind) => void;
}

export interface ChatVoiceSession {
  start: () => void;
  /** Stop capturing and settle with whatever was heard. */
  stop: () => void;
  /** Tear down silently (e.g. the chat drawer closed mid-capture). */
  dispose: () => void;
}

/* ─── The fallback's price + endpoint + cap, stated in code ─────────── */

/** The ONE network call this seam can ever make: the chat-voice
 *  fallback endpoint. Never /api/transcribe (the charged song rail). */
export const CHAT_VOICE_TRANSCRIBE_PATH = "/api/chat/voice/transcribe";

/** Visual Bucs charged for a chat-voice transcription: ZERO. See the
 *  money rule in the header — free-chat is free, so its voice
 *  fallback is free; the server route carries the same constant. */
export const CHAT_VOICE_TRANSCRIBE_CREDITS = 0;

/** Max length of one spoken chat message, in seconds. Chat utterances
 *  are short; the server session stops recording at this cap (and the
 *  server route enforces its own byte cap), so a song file can never
 *  ride the free chat rail. The server route mirrors this figure. */
export const CHAT_VOICE_MAX_UTTERANCE_SEC = 30;
export const CHAT_VOICE_MAX_DURATION_MS = CHAT_VOICE_MAX_UTTERANCE_SEC * 1000;

/* ─── Minimal structural typing for the Web Speech API ─────────────────
   Mirrors the shape VoiceDirectedEditsSection already types locally;
   kept structural so tests can inject a fake constructor. */

export interface ChatVoiceRecognitionResult {
  isFinal: boolean;
  [index: number]: { transcript: string } | undefined;
  length: number;
}

export interface ChatVoiceResultEvent {
  resultIndex: number;
  results: { [index: number]: ChatVoiceRecognitionResult; length: number };
}

export interface ChatVoiceErrorEvent {
  error: string;
}

export interface ChatVoiceRecognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: ChatVoiceResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: ChatVoiceErrorEvent) => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}

export type ChatVoiceRecognitionCtor = new () => ChatVoiceRecognition;

export function getChatVoiceRecognitionCtor(): ChatVoiceRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (
    (w["SpeechRecognition"] as ChatVoiceRecognitionCtor | undefined) ??
    (w["webkitSpeechRecognition"] as ChatVoiceRecognitionCtor | undefined) ??
    null
  );
}

/** True when the free browser recognizer exists — the default path. */
export function isBrowserChatVoiceSupported(): boolean {
  return getChatVoiceRecognitionCtor() !== null;
}

/* ─── Minimal structural typing for the recording fallback ───────────── */

export interface ChatVoiceMediaTrack {
  stop: () => void;
}

export interface ChatVoiceMediaStream {
  getTracks: () => ChatVoiceMediaTrack[];
}

export interface ChatVoiceRecorder {
  mimeType: string;
  state: string;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  start: (timesliceMs?: number) => void;
  stop: () => void;
}

export interface ChatVoiceRecorderCtor {
  new (
    stream: ChatVoiceMediaStream,
    options?: { mimeType?: string },
  ): ChatVoiceRecorder;
  isTypeSupported?: (mimeType: string) => boolean;
}

export type ChatVoiceGetUserMedia = (constraints: {
  audio: boolean;
}) => Promise<ChatVoiceMediaStream>;

/** Fetch-shaped caller for the fallback POST. The button injects the
 *  drawer's authed fetch (which attaches the member's session token);
 *  a null response means a wrapping layer cancelled before any request
 *  was made — treated as a transcription failure, never as text. */
export type ChatVoiceTranscribeFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response | null>;

export function getChatVoiceRecorderCtor(): ChatVoiceRecorderCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w["MediaRecorder"] as ChatVoiceRecorderCtor | undefined) ?? null;
}

function defaultGetUserMedia(): ChatVoiceGetUserMedia | null {
  if (typeof navigator === "undefined") return null;
  const md = (navigator as { mediaDevices?: { getUserMedia?: unknown } })
    .mediaDevices;
  if (!md || typeof md.getUserMedia !== "function") return null;
  const gum = md.getUserMedia as (
    c: { audio: boolean },
  ) => Promise<ChatVoiceMediaStream>;
  return (constraints) => gum.call(md, constraints);
}

/** True when the server fallback can run here: audio recording exists
 *  (MediaRecorder + getUserMedia). Deps are injectable for tests. */
export function isServerChatVoiceSupported(deps?: {
  recorderCtor?: ChatVoiceRecorderCtor | null;
  getUserMedia?: ChatVoiceGetUserMedia | null;
}): boolean {
  const ctor =
    deps?.recorderCtor !== undefined
      ? deps.recorderCtor
      : getChatVoiceRecorderCtor();
  const gum =
    deps?.getUserMedia !== undefined ? deps.getUserMedia : defaultGetUserMedia();
  return ctor !== null && gum !== null;
}

/** Which transport a session here would use: the free browser
 *  recognizer wherever it exists, the server fallback only where it
 *  doesn't, and null where neither exists (`unsupported`). */
export function getChatVoiceTransport(deps?: {
  ctor?: ChatVoiceRecognitionCtor | null;
  recorderCtor?: ChatVoiceRecorderCtor | null;
  getUserMedia?: ChatVoiceGetUserMedia | null;
}): "browser" | "server" | null {
  const browserCtor =
    deps?.ctor !== undefined ? deps.ctor : getChatVoiceRecognitionCtor();
  if (browserCtor) return "browser";
  if (isServerChatVoiceSupported(deps)) return "server";
  return null;
}

export function isChatVoiceSupported(): boolean {
  return getChatVoiceTransport() !== null;
}

/** Map a SpeechRecognition error string onto the honest failure kinds. */
export function mapChatVoiceError(error: string): ChatVoiceErrorKind {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "denied";
    case "no-speech":
      return "no-speech";
    default:
      return "failed";
  }
}

/** Map a getUserMedia rejection onto the honest failure kinds:
 *  a permission refusal is `denied`; anything else (no device, device
 *  busy, constraints) is a recording failure. */
export function mapChatVoiceCaptureError(err: unknown): ChatVoiceErrorKind {
  const name = (err as { name?: unknown } | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return "denied";
  return "recording-failed";
}

/** Map the fallback endpoint's HTTP status onto the honest kinds. */
export function mapChatVoiceTranscribeStatus(status: number): ChatVoiceErrorKind {
  if (status === 401 || status === 403) return "unauthenticated";
  return "transcription-failed";
}

/**
 * The one normalization the chat's send path applies to typed text
 * (send() trims before sending). Voice transcripts go through this so
 * a spoken message is byte-identical to the same words typed.
 */
export function prepareVoiceMessage(raw: string): string {
  return raw.trim();
}

export interface ChatVoiceNote {
  tone: "info" | "error";
  text: string;
}

/** User-facing copy for every state the mic can be in — one place, so
 *  the component renders words and the tests pin them. */
export const CHAT_VOICE_ERROR_COPY: Record<ChatVoiceErrorKind, string> = {
  denied:
    "The microphone is blocked. Allow mic access in your browser's site settings — or just type, typing works as always.",
  "no-speech": "I couldn't hear you — tap the mic and try again.",
  failed: "Voice input hit a snag — tap the mic to try again, or just type.",
  unsupported:
    "Voice input isn't supported in this browser — typing works as always.",
  "recording-failed":
    "Recording hit a snag — tap the mic to try again, or just type.",
  "transcription-failed":
    "I recorded you, but couldn't turn it into text — tap the mic to try again, or just type.",
  unauthenticated:
    "Sign in to use voice input in this browser — typing works as always.",
};

export function chatVoiceNote(
  state: ChatVoiceState,
  error: ChatVoiceErrorKind | null,
): ChatVoiceNote | null {
  if (error) return { tone: "error", text: CHAT_VOICE_ERROR_COPY[error] };
  if (state === "listening") return { tone: "info", text: "Listening… tap the mic to stop." };
  if (state === "transcribing") return { tone: "info", text: "Turning your words into text…" };
  return null;
}

/* ─── Session options ────────────────────────────────────────────────── */

export interface ChatVoiceServerOptions {
  /** Authed fetch for the fallback POST (the button's confirmedFetch
   *  with confirmation skipped — the call is free, per
   *  CHAT_VOICE_TRANSCRIBE_CREDITS). */
  fetchImpl?: ChatVoiceTranscribeFetch;
  /** Test seams. */
  getUserMedia?: ChatVoiceGetUserMedia | null;
  recorderCtor?: ChatVoiceRecorderCtor | null;
  maxDurationMs?: number;
}

export interface ChatVoiceSessionOptions {
  lang?: string;
  /** Test seam: inject a recognizer constructor (or null for unsupported). */
  ctor?: ChatVoiceRecognitionCtor | null;
  /** Force a transport (tests); default decides browser-first. */
  transport?: "browser" | "server";
  /** Server-fallback wiring (only read when the server transport runs). */
  server?: ChatVoiceServerOptions;
}

/* ─── The browser session (the original, free path) ──────────────────── */

function createBrowserChatVoiceSession(
  handlers: ChatVoiceHandlers,
  options: ChatVoiceSessionOptions,
): ChatVoiceSession {
  let recognition: ChatVoiceRecognition | null = null;
  let active = false;
  let disposed = false;
  let finalText = "";
  let errorKind: ChatVoiceErrorKind | null = null;

  function settle() {
    if (!active) return;
    active = false;
    recognition = null;
    if (disposed) return;
    handlers.onState?.("idle");
    if (errorKind) {
      const kind = errorKind;
      errorKind = null;
      handlers.onError?.(kind);
      return;
    }
    const text = prepareVoiceMessage(finalText);
    if (text) {
      handlers.onFinal?.(text);
    } else {
      /* Capture ended with nothing heard — say so, never invent text. */
      handlers.onError?.("no-speech");
    }
  }

  function start() {
    if (active || disposed) return;
    const Ctor =
      options.ctor !== undefined ? options.ctor : getChatVoiceRecognitionCtor();
    if (!Ctor) {
      handlers.onError?.("unsupported");
      return;
    }
    finalText = "";
    errorKind = null;
    const rec = new Ctor();
    recognition = rec;
    active = true;
    rec.lang = options.lang ?? "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const piece = result?.[0]?.transcript ?? "";
        if (result?.isFinal) finalText += piece;
        else interim += piece;
      }
      const heard = prepareVoiceMessage(finalText + interim);
      if (heard) handlers.onInterim?.(heard);
    };
    rec.onerror = (event) => {
      /* "aborted" is our own stop() landing — onend settles the capture. */
      if (event.error === "aborted") return;
      if (!errorKind) errorKind = mapChatVoiceError(event.error);
    };
    rec.onend = () => settle();
    handlers.onState?.("listening");
    try {
      rec.start();
    } catch {
      errorKind = "failed";
      settle();
    }
  }

  function stop() {
    if (!active || !recognition) return;
    handlers.onState?.("transcribing");
    try {
      recognition.stop();
    } catch {
      settle();
    }
  }

  function dispose() {
    disposed = true;
    if (recognition) {
      const rec = recognition;
      recognition = null;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        if (rec.abort) rec.abort();
        else rec.stop();
      } catch {
        /* already ended — nothing to tear down */
      }
    }
    active = false;
  }

  return { start, stop, dispose };
}

/* ─── The server session (the fallback path) ─────────────────────────── */

const CHAT_VOICE_MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

export function pickChatVoiceRecorderMime(
  ctor: ChatVoiceRecorderCtor,
): string | undefined {
  if (typeof ctor.isTypeSupported !== "function") return undefined;
  for (const candidate of CHAT_VOICE_MIME_CANDIDATES) {
    try {
      if (ctor.isTypeSupported(candidate)) return candidate;
    } catch {
      /* a throwing probe just moves to the next candidate */
    }
  }
  return undefined;
}

function chatVoiceFilename(mimeType: string): string {
  if (mimeType.includes("mp4")) return "chat-voice.m4a";
  if (mimeType.includes("ogg")) return "chat-voice.ogg";
  if (mimeType.includes("mpeg")) return "chat-voice.mp3";
  return "chat-voice.webm";
}

function createServerChatVoiceSession(
  handlers: ChatVoiceHandlers,
  options: ChatVoiceSessionOptions,
): ChatVoiceSession {
  const server = options.server ?? {};
  let stream: ChatVoiceMediaStream | null = null;
  let recorder: ChatVoiceRecorder | null = null;
  let chunks: Blob[] = [];
  let active = false;
  let stopping = false;
  let settled = false;
  let disposed = false;
  let recorderFailed = false;
  let capTimer: ReturnType<typeof setTimeout> | null = null;

  function stopTracks() {
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* already stopped */
        }
      }
      stream = null;
    }
  }

  function clearCap() {
    if (capTimer) {
      clearTimeout(capTimer);
      capTimer = null;
    }
  }

  /** Settle exactly once: back to idle, then the outcome. */
  function settle(kind: ChatVoiceErrorKind | null, text?: string) {
    if (settled || disposed) return;
    settled = true;
    active = false;
    stopping = false;
    clearCap();
    stopTracks();
    handlers.onState?.("idle");
    if (kind) {
      handlers.onError?.(kind);
      return;
    }
    const final = prepareVoiceMessage(text ?? "");
    if (final) handlers.onFinal?.(final);
    else handlers.onError?.("no-speech");
  }

  async function finishRecording() {
    const mime = recorder?.mimeType || "audio/webm";
    recorder = null;
    stopTracks();
    if (recorderFailed) {
      recorderFailed = false;
      settle("recording-failed");
      return;
    }
    const blob = new Blob(chunks, { type: mime });
    chunks = [];
    if (blob.size === 0) {
      settle("no-speech");
      return;
    }
    const fetchImpl: ChatVoiceTranscribeFetch =
      server.fetchImpl ?? ((input, init) => fetch(input, init));
    try {
      const form = new FormData();
      form.append("audio", blob, chatVoiceFilename(mime));
      const res = await fetchImpl(CHAT_VOICE_TRANSCRIBE_PATH, {
        method: "POST",
        body: form,
      });
      if (disposed) return;
      if (!res) {
        settle("transcription-failed");
        return;
      }
      const data = (await res.json().catch(() => null)) as {
        transcript?: unknown;
        error?: unknown;
      } | null;
      if (!res.ok) {
        /* The server's own no-speech verdict keeps its honest kind;
           everything else maps by status (401 → sign in, rest →
           transcription failed). */
        if (data?.error === "no_speech") settle("no-speech");
        else settle(mapChatVoiceTranscribeStatus(res.status));
        return;
      }
      const text = typeof data?.transcript === "string" ? data.transcript : "";
      settle(null, text);
    } catch {
      if (disposed) return;
      settle("transcription-failed");
    }
  }

  async function start() {
    if (active || disposed) return;
    settled = false;
    stopping = false;
    recorderFailed = false;
    const Ctor =
      server.recorderCtor !== undefined
        ? server.recorderCtor
        : getChatVoiceRecorderCtor();
    const gum =
      server.getUserMedia !== undefined
        ? server.getUserMedia
        : defaultGetUserMedia();
    if (!Ctor || !gum) {
      /* Neither transport exists in this browser — say so. */
      handlers.onError?.("unsupported");
      return;
    }
    active = true;
    let mediaStream: ChatVoiceMediaStream;
    try {
      mediaStream = await gum({ audio: true });
    } catch (err) {
      active = false;
      if (disposed) return;
      handlers.onError?.(mapChatVoiceCaptureError(err));
      return;
    }
    if (disposed) {
      for (const track of mediaStream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* already stopped */
        }
      }
      active = false;
      return;
    }
    stream = mediaStream;
    chunks = [];
    let rec: ChatVoiceRecorder;
    try {
      const mime = pickChatVoiceRecorderMime(Ctor);
      rec = new Ctor(mediaStream, mime ? { mimeType: mime } : undefined);
    } catch {
      active = false;
      stopTracks();
      handlers.onError?.("recording-failed");
      return;
    }
    recorder = rec;
    rec.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };
    rec.onerror = () => {
      /* A recorder error mid-capture settles as recording-failed —
         never a partial transcript dressed up as the user's words. */
      recorderFailed = true;
      try {
        rec.stop();
      } catch {
        settle("recording-failed");
      }
    };
    rec.onstop = () => {
      void finishRecording();
    };
    handlers.onState?.("listening");
    try {
      rec.start(250);
    } catch {
      recorder = null;
      active = false;
      stopTracks();
      handlers.onError?.("recording-failed");
      return;
    }
    /* The utterance cap: recording stops itself at the cap and the
       transcript settles like a manual stop — never an endless mic. */
    capTimer = setTimeout(() => {
      stop();
    }, server.maxDurationMs ?? CHAT_VOICE_MAX_DURATION_MS);
  }

  function stop() {
    if (!active || stopping || !recorder) return;
    stopping = true;
    clearCap();
    handlers.onState?.("transcribing");
    try {
      recorder.stop();
    } catch {
      void finishRecording();
    }
  }

  function dispose() {
    disposed = true;
    clearCap();
    if (recorder) {
      const rec = recorder;
      recorder = null;
      rec.ondataavailable = null;
      rec.onstop = null;
      rec.onerror = null;
      try {
        if (rec.state !== "inactive") rec.stop();
      } catch {
        /* already ended — nothing to tear down */
      }
    }
    stopTracks();
    active = false;
    stopping = false;
  }

  return { start, stop, dispose };
}

/* ─── The seam's factory: browser-first, server only where unsupported ─ */

export function createChatVoiceSession(
  handlers: ChatVoiceHandlers,
  options: ChatVoiceSessionOptions = {},
): ChatVoiceSession {
  const transport =
    options.transport ??
    getChatVoiceTransport({
      ctor: options.ctor,
      recorderCtor: options.server?.recorderCtor,
      getUserMedia: options.server?.getUserMedia,
    });
  if (transport === "browser") {
    return createBrowserChatVoiceSession(handlers, options);
  }
  /* "server" — and the null case (neither transport exists): the
     server session's start reports `unsupported` when it finds no
     recording path either, which is the truthful everywhere-verdict. */
  return createServerChatVoiceSession(handlers, options);
}
