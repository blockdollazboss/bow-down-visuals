/* chat-speak.ts — the voice-OUT seam for the Thy Cheat Code chat:
 * spoken replies, in his own voice.
 *
 * The mirror of lib/chat-voice.ts (voice in). Voice in rides the
 * browser's recognizer and is free; voice out is a server rail —
 * POST /api/chat/speak synthesizes the reply with ElevenLabs in the
 * King's designed voice and CHARGES per spoken reply (owner ruling
 * Oct 20, 2026: "spoken replies cost a small Visual Bucs price
 * each"). Two honesty rules run through everything here:
 *
 *  1. The price is NEVER hardcoded in the client. The drawer reads
 *     { ready, creditCost } from GET /api/chat/speak/status and shows
 *     exactly what the server says; the spend confirmation carries
 *     that server figure too.
 *  2. Until the King's voice is cast (the server env
 *     THY_CHEAT_CODE_VOICE_ID is unset), the server reports
 *     ready:false and refuses to charge — the client mirrors that
 *     state in words ("still being cast") instead of selling a
 *     button that cannot work.
 *
 * Playback is coordinated through one module-level element: the King
 * never talks over himself — starting a new spoken reply stops the
 * one still playing.
 */
import type { ChatVoiceNote } from "@/lib/chat-voice";

export const CHAT_SPEAK_PATH = "/api/chat/speak";
export const CHAT_SPEAK_STATUS_PATH = "/api/chat/speak/status";

/** localStorage key for the per-user "hear his replies" preference —
 *  same bdv-chat-* family the drawer already persists with. */
export const CHAT_SPEAK_PREF_KEY = "bdv-chat-voice-out";

/* ─── Status ─────────────────────────────────────────────────────────── */

export interface ChatSpeakStatus {
  /** The King's voice is cast and the voice service is configured. */
  ready: boolean;
  /** Visual Bucs per spoken reply, as the server prices it. */
  creditCost: number;
}

/** Parse the status payload defensively — a malformed body must never
 *  become a fabricated price or a false "ready". */
export function parseChatSpeakStatus(data: unknown): ChatSpeakStatus {
  const d = data as { ready?: unknown; creditCost?: unknown } | null;
  const cost =
    typeof d?.creditCost === "number" &&
    Number.isFinite(d.creditCost) &&
    d.creditCost > 0
      ? d.creditCost
      : 0;
  return { ready: d?.ready === true, creditCost: cost };
}

/** What a per-reply speak control should look like right now. */
export type ChatSpeakView = "loading" | "ready" | "casting" | "unavailable";

export function chatSpeakView(
  status: ChatSpeakStatus | null,
  loadFailed: boolean,
): ChatSpeakView {
  if (loadFailed) return "unavailable";
  if (status === null) return "loading";
  if (!status.ready) return "casting";
  /* The server says ready but named no truthful price — we cannot
     sell a spoken reply at an invented figure, so it stays unusable. */
  if (status.creditCost <= 0) return "unavailable";
  return "ready";
}

export const CHAT_SPEAK_CASTING_COPY =
  "Thy Cheat Code's voice is still being cast — once his voice is ready you'll be able to hear his replies out loud. Nothing is charged until then.";
export const CHAT_SPEAK_UNAVAILABLE_COPY =
  "Couldn't check whether his voice is ready — check your connection and reopen the chat. Nothing was charged.";

/* ─── The per-user toggle preference ─────────────────────────────────── */

export function loadChatSpeakEnabled(): boolean {
  try {
    return localStorage.getItem(CHAT_SPEAK_PREF_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveChatSpeakEnabled(on: boolean): void {
  try {
    localStorage.setItem(CHAT_SPEAK_PREF_KEY, on ? "1" : "0");
  } catch {
    /* private mode — the toggle just won't persist */
  }
}

/* ─── Requests ───────────────────────────────────────────────────────── */

/** Fetch-shaped caller: the plain fetch for the public status read, or
 *  the drawer's confirmedFetch for the charged speak (which attaches
 *  auth and returns null when the user cancels the spend popup). */
export type ChatSpeakFetch = (
  input: string,
  init?: RequestInit,
) => Promise<Response | null>;

export async function fetchChatSpeakStatus(
  fetchImpl: ChatSpeakFetch = (input, init) => fetch(input, init),
): Promise<ChatSpeakStatus> {
  const res = await fetchImpl(CHAT_SPEAK_STATUS_PATH);
  if (!res || !res.ok) {
    throw new Error("chat speak status unavailable");
  }
  return parseChatSpeakStatus(await res.json().catch(() => null));
}

/** One client key per speak intent. The server builds its charge
 *  idempotency key from it, so retries of the same tap can't
 *  double-charge; the key must be ≥ 8 chars to count as a client key. */
export function newChatSpeakKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `speak-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 12)}`;
}

export interface ChatSpeakResult {
  audioPlayUrl: string;
  creditsUsed: number;
  creditsRemaining: number;
}

/** The server's own words for a failure — its message when it sent
 *  one, else its error code, never a client-invented explanation. */
function serverSpeakError(data: Record<string, unknown>): string {
  if (typeof data["message"] === "string" && data["message"]) return data["message"];
  if (typeof data["error"] === "string" && data["error"]) return data["error"];
  return "Thy Cheat Code couldn't speak that reply — please try again.";
}

/**
 * Ask the server to speak one reply. Returns null ONLY when the fetch
 * layer reports a cancelled spend confirmation (no request was made,
 * nothing charged — the caller just goes back to idle). Throws an
 * Error carrying the server's own message on any failure.
 */
export async function requestChatSpeak(
  fetchImpl: ChatSpeakFetch,
  text: string,
  idempotencyKey: string,
): Promise<ChatSpeakResult | null> {
  const res = await fetchImpl(CHAT_SPEAK_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, idempotencyKey }),
  });
  if (res === null) return null;
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(serverSpeakError(data));
  }
  if (typeof data["audioPlayUrl"] !== "string" || !data["audioPlayUrl"]) {
    throw new Error("Thy Cheat Code couldn't speak that reply — please try again.");
  }
  return {
    audioPlayUrl: data["audioPlayUrl"],
    creditsUsed:
      typeof data["creditsUsed"] === "number" ? data["creditsUsed"] : 0,
    creditsRemaining:
      typeof data["creditsRemaining"] === "number"
        ? data["creditsRemaining"]
        : 0,
  };
}

/* ─── Playback ───────────────────────────────────────────────────────── */

/* One voice at a time: starting a new spoken reply stops whichever
   reply is still playing. */
let currentAudio: HTMLAudioElement | null = null;

export function playChatSpeakAudio(
  url: string,
  createAudio: (url: string) => HTMLAudioElement = (u) => new Audio(u),
): HTMLAudioElement {
  stopChatSpeakAudio();
  const el = createAudio(url);
  currentAudio = el;
  void el.play().catch(() => {
    /* Autoplay refusal: the element stays current; the component's
       error/ended handlers settle its state honestly. */
  });
  return el;
}

export function stopChatSpeakAudio(): void {
  if (currentAudio) {
    try {
      currentAudio.pause();
    } catch {
      /* already stopped */
    }
    currentAudio = null;
  }
}

/** Status-line note for a speak failure — the drawer's one status
 *  line renders voice-in and voice-out notes alike. */
export function chatSpeakErrorNote(message: string): ChatVoiceNote {
  return { tone: "error", text: message };
}
