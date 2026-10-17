/**
 * voice-toggle.ts — the King's Hall proximity-voice switch.
 *
 * The owner's rule (2026-10-16): there must be a way to turn
 * proximity chat on and off, right in the hall. OFF is total — the
 * mic is released, you send no voice, you hear no voice (the text
 * log is untouched) — and the room is told, so your name plate can
 * mark you "voice off" and nobody talks to someone who can't hear.
 * ON restores exactly today's behaviour: voice is available, and
 * joining it is still the separate, explicit act it always was —
 * flipping the switch never starts a mic by itself.
 *
 * This module is the pure core — state machine + device memory —
 * so the page stays a thin shell and the machine is unit-tested.
 * The switch is a device preference (like the character pick):
 * it lives in localStorage, never in account data.
 */

export interface VoiceToggleState {
  /** The switch itself. false = voice off: no mic, no hearing. */
  enabled: boolean;
  /** In the voice mesh right now (only possible while enabled). */
  inVoice: boolean;
}

export type VoiceToggleAction =
  | { type: "switch-off" }
  | { type: "switch-on" }
  | { type: "voice-joined" }
  | { type: "voice-left" };

export type VoiceToggleEffect =
  /** Stop the mic tracks + tear down the voice mesh. */
  | "release-mic"
  /** Tell the room this peer is voice-off (name plates mark it). */
  | "announce-off"
  /** Tell the room this peer hears voice again. */
  | "announce-on";

export function initialVoiceToggle(enabled: boolean): VoiceToggleState {
  return { enabled, inVoice: false };
}

/** The transition table. Pure: same state + action in, same next
 *  state + effect list out. Effects are the page's orders — the
 *  machine never touches a mic, a socket, or storage itself. */
export function reduceVoiceToggle(
  state: VoiceToggleState,
  action: VoiceToggleAction,
): { state: VoiceToggleState; effects: VoiceToggleEffect[] } {
  switch (action.type) {
    case "switch-off": {
      if (!state.enabled) return { state, effects: [] };
      const effects: VoiceToggleEffect[] = state.inVoice
        ? ["release-mic", "announce-off"]
        : ["announce-off"];
      return { state: { enabled: false, inVoice: false }, effects };
    }
    case "switch-on": {
      if (state.enabled) return { state, effects: [] };
      // Back on means AVAILABLE, never auto-joined: joining voice
      // (and its mic prompt) stays the explicit act it is today.
      return { state: { enabled: true, inVoice: false }, effects: ["announce-on"] };
    }
    case "voice-joined": {
      // A join that lands while the switch is off is a race, not a
      // state: the switch wins and the join is ignored.
      if (!state.enabled || state.inVoice) return { state, effects: [] };
      return { state: { ...state, inVoice: true }, effects: [] };
    }
    case "voice-left": {
      if (!state.inVoice) return { state, effects: [] };
      return { state: { ...state, inVoice: false }, effects: [] };
    }
  }
}

/** The presence flag the room carries: voice-off people are marked. */
export function voiceOffMarker(state: VoiceToggleState): boolean {
  return !state.enabled;
}

/** Joining voice is possible only with the switch on and a free seat
 *  in the session (the mesh's own caps still apply downstream). */
export function canJoinVoice(state: VoiceToggleState): boolean {
  return state.enabled && !state.inVoice;
}

/* ── Device memory ────────────────────────────────────────────────────
   The switch is remembered on this device: flip it off once and the
   hall greets you voice-off next visit (announced on entry, so the
   room's name plates are right from the first frame). */

export const WORLD_VOICE_STORAGE_KEY = "bdv.worldVoiceEnabled";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

/** Default is ON — the switch exists to be flipped, and a member who
 *  has never touched it gets exactly today's hall. */
export function loadVoiceEnabled(storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(WORLD_VOICE_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function storeVoiceEnabled(enabled: boolean, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    if (enabled) storage.removeItem(WORLD_VOICE_STORAGE_KEY);
    else storage.setItem(WORLD_VOICE_STORAGE_KEY, "off");
  } catch {
    /* private mode etc. — the switch still applies this visit */
  }
}
