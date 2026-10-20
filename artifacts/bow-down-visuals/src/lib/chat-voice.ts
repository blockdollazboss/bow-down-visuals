/* chat-voice.ts — the voice-input transport seam for the Thy Cheat Code chat.
 *
 * Voice IN for the chat, transport only: capture one spoken utterance,
 * turn it into text, and hand that text to the chat's existing send path
 * (ThyCheatCodeChat's send() → POST /api/free-chat). This seam changes
 * nothing about how answers are generated and executes no actions — it
 * is a microphone, not a brain and not hands.
 *
 * Which transcription path, and why (verify-first, Oct 20):
 * The codebase has two transcription families —
 *   1. The browser's built-in speech recognition (Web Speech API),
 *      already used for voice input by VoiceInputButton (in this very
 *      chat surface) and by the editor's VoiceDirectedEditsSection.
 *      Recognition happens in the browser: NO server transcription call
 *      is made, so there is no per-call cost — none exists in code for
 *      this path and none is needed.
 *   2. The server transcription routes (POST /api/transcribe and
 *      /api/transcribe-url), built for song-length files and charged at
 *      100 Visual Bucs per call (routes/transcribe.ts). Wrong shape and
 *      wrong price for a short chat utterance.
 * This seam rides family 1, exactly like the existing precedents.
 *
 * INTEGRATION NOTE (Stack-4 #9): #9 migrates the server transcription
 * paths onto one shared, env-overridable seam. If a server-backed
 * recognizer is ever wanted for chat voice, implement THIS interface
 * (createChatVoiceSession's handlers contract) on top of #9's seam and
 * swap the factory — the chat surface and its tests don't change.
 *
 * Voice OUT is deliberately NOT here: the only text-to-speech rails in
 * the codebase are charged generation tools (POST /api/voiceover/
 * generate = 200 Visual Bucs, lib/credit-costs.ts), and there is no
 * browser speech-synthesis precedent anywhere in the frontend. Spoken
 * replies would newly cost credits per reply, so they are not wired —
 * that is an owner pricing decision, not a transport detail.
 */

/** Capture lifecycle: idle → listening → transcribing → idle. */
export type ChatVoiceState = "idle" | "listening" | "transcribing";

/**
 * Honest failure kinds. `denied` = the browser refused mic access
 * (permission), `no-speech` = capture ended with nothing heard,
 * `failed` = the recognizer itself errored, `unsupported` = this
 * browser has no speech recognition at all.
 */
export type ChatVoiceErrorKind = "denied" | "no-speech" | "failed" | "unsupported";

export interface ChatVoiceHandlers {
  onState?: (state: ChatVoiceState) => void;
  /** The full text heard so far (final chunks + current interim). */
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

export function isChatVoiceSupported(): boolean {
  return getChatVoiceRecognitionCtor() !== null;
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
  unsupported: "Voice input isn't supported in this browser — typing works as always.",
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

/* ─── The session ────────────────────────────────────────────────────── */

export interface ChatVoiceSessionOptions {
  lang?: string;
  /** Test seam: inject a recognizer constructor (or null for unsupported). */
  ctor?: ChatVoiceRecognitionCtor | null;
}

export function createChatVoiceSession(
  handlers: ChatVoiceHandlers,
  options: ChatVoiceSessionOptions = {},
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
