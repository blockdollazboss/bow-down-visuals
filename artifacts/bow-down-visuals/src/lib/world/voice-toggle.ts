/**
 * voice-toggle.ts — the King's Hall voice control: MODES, not just
 * on/off (owner's order, 2026-10-16, extended the same night).
 *
 * The owner first ordered a way to turn proximity chat on and off;
 * hours later he sharpened it: voice needs modes, the way Discord
 * does it. Four modes, in the order the control speaks them:
 *
 *   Off       — total silence, exactly the original switch-off: the
 *               mic is RELEASED, you send no voice, you hear no
 *               voice (text is untouched), and the room is told so
 *               your name plate marks you "voice off".
 *   Proximity — voice by distance: walk up to someone to talk. This
 *               is what "voice on" always was.
 *   Lobby     — the whole hall in your ears at full volume, near or
 *               far. Receive-side only: nobody else can tell, and
 *               nobody else's client changes.
 *   Deafen    — Discord semantics: you hear NOBODY, and your own mic
 *               is muted while it lasts (track muted, NOT released —
 *               undeafening restores the exact mute you had). You
 *               STAY in voice; the room is told, and your name plate
 *               marks you "deafened" — a different mark from
 *               voice-off, because you haven't left, you just can't
 *               hear right now.
 *
 * Switching modes NEVER starts a mic: joining voice stays the
 * separate, explicit Join-voice act it has always been, in every
 * mode. (Deafen entered before joining applies the moment you join.)
 *
 * This module is the pure core — state machine + device memory —
 * so the page stays a thin shell and the machine is unit-tested.
 * The mode is a device preference (like the character pick): it
 * lives in localStorage, never in account data.
 */

import type { VoiceGainPolicy } from "./voice";

export type VoiceMode = "off" | "proximity" | "lobby" | "deafen";

/** The modes in the order the control (and the gamepad's cycle)
 *  speaks them. */
export const VOICE_MODES: readonly VoiceMode[] = ["off", "proximity", "lobby", "deafen"];

export function isVoiceMode(v: unknown): v is VoiceMode {
  return v === "off" || v === "proximity" || v === "lobby" || v === "deafen";
}

export interface VoiceToggleState {
  /** The current mode. "off" = no mic, no hearing; the rest are
   *  hearing policies over the mesh (see the gain policy in voice.ts). */
  mode: VoiceMode;
  /** In the voice mesh right now (impossible while mode is "off"). */
  inVoice: boolean;
  /** The mic mute to restore when deafen lifts — captured at the
   *  moment deafen was entered while in voice, so undeafening gives
   *  back EXACTLY the mute the member had, never a guess. */
  resumeMuted: boolean;
}

export type VoiceToggleAction =
  | { type: "set-mode"; mode: VoiceMode; micMuted?: boolean }
  | { type: "voice-joined" }
  | { type: "voice-left" };

export type VoiceToggleEffect =
  /** Stop the mic tracks + tear down the voice mesh (Off only). */
  | "release-mic"
  /** Tell the room this peer is voice-off (name plates mark it). */
  | "announce-off"
  /** Tell the room this peer hears voice again (voice-off cleared). */
  | "announce-on"
  /** Tell the room this peer is deafened (name plates mark it). */
  | "announce-deaf"
  /** Tell the room the deafen lifted (deafened mark cleared). */
  | "announce-undeaf"
  /** Mute the local mic track — deafened (the mesh stays UP). */
  | "deafen-mic"
  /** Restore the mic mute captured when deafen was entered. */
  | "restore-mic"
  /** Re-apply the receive gains under the new mode's policy. */
  | "apply-mode";

export function initialVoiceToggle(mode: VoiceMode): VoiceToggleState {
  return { mode, inVoice: false, resumeMuted: false };
}

/** The transition table. Pure: same state + action in, same next
 *  state + effect list out. Effects are the page's orders — the
 *  machine never touches a mic, a socket, or storage itself. */
export function reduceVoiceToggle(
  state: VoiceToggleState,
  action: VoiceToggleAction,
): { state: VoiceToggleState; effects: VoiceToggleEffect[] } {
  switch (action.type) {
    case "set-mode":
      return setMode(state, action.mode, action.micMuted);
    case "voice-joined": {
      // A join that lands while Off is a race, not a state: Off wins
      // and the join is ignored. Joining while deafened applies the
      // deafen to the fresh session — mic muted from the first frame.
      if (state.mode === "off" || state.inVoice) return { state, effects: [] };
      return {
        state: { ...state, inVoice: true },
        effects: state.mode === "deafen" ? ["deafen-mic"] : [],
      };
    }
    case "voice-left": {
      if (!state.inVoice) return { state, effects: [] };
      return { state: { ...state, inVoice: false }, effects: [] };
    }
  }
}

function setMode(
  state: VoiceToggleState,
  next: VoiceMode,
  micMuted: boolean | undefined,
): { state: VoiceToggleState; effects: VoiceToggleEffect[] } {
  if (next === state.mode) return { state, effects: [] };
  const effects: VoiceToggleEffect[] = [];
  const wasDeaf = state.mode === "deafen";

  if (next === "off") {
    /* Off is total, in the original order: the mic goes first, then
     * the announcements. A deafen still standing is cleared on the
     * way out (the room hears undeaf, then off) — voice-off is the
     * mark that outranks, and it's the only one a returning member
     * needs cleared explicitly. */
    if (state.inVoice) effects.push("release-mic");
    if (wasDeaf) effects.push("announce-undeaf");
    effects.push("announce-off");
    return { state: { mode: "off", inVoice: false, resumeMuted: false }, effects };
  }

  if (state.mode === "off") effects.push("announce-on");

  if (next === "deafen") {
    /* Capture the mute to restore — but only a live session has one;
     * deafening at the door (not in voice) starts the resume from
     * unmuted, the fresh-join default. */
    const resumeMuted = state.inVoice ? (micMuted ?? false) : false;
    effects.push("announce-deaf");
    if (state.inVoice) effects.push("deafen-mic", "apply-mode");
    return { state: { mode: "deafen", inVoice: state.inVoice, resumeMuted }, effects };
  }

  /* proximity <-> lobby, or deafen lifting into either. */
  if (wasDeaf) {
    effects.push("announce-undeaf");
    if (state.inVoice) effects.push("restore-mic", "apply-mode");
  } else if (state.inVoice) {
    effects.push("apply-mode");
  }
  return {
    state: { mode: next, inVoice: state.inVoice, resumeMuted: state.resumeMuted },
    effects,
  };
}

/** The presence flags the room carries, from the machine's side. */
export function voiceOffMarker(state: VoiceToggleState): boolean {
  return state.mode === "off";
}

export function voiceDeafMarker(state: VoiceToggleState): boolean {
  return state.mode === "deafen";
}

/** Joining voice is possible in every mode except Off (deafened
 *  members join deafened), and only with a free seat in the session
 *  (the mesh's own caps still apply downstream). */
export function canJoinVoice(state: VoiceToggleState): boolean {
  return state.mode !== "off" && !state.inVoice;
}

/** The receive-gain policy (voice.ts) this mode hears with. */
export function gainPolicyForMode(mode: VoiceMode): VoiceGainPolicy {
  switch (mode) {
    case "lobby":
      return "lobby";
    case "deafen":
    case "off":
      return "silent";
    default:
      return "proximity";
  }
}

/** The gamepad's A button steps the modes in their spoken order:
 *  Off → Proximity → Lobby → Deafen → Off. */
export function nextVoiceMode(mode: VoiceMode): VoiceMode {
  const i = VOICE_MODES.indexOf(mode);
  return VOICE_MODES[(i + 1) % VOICE_MODES.length] ?? "proximity";
}

/** The gamepad's LT steps the same ring BACKWARD (Stack-100 #2
 *  item 59): Deafen → Lobby → Proximity → Off → Deafen — the exact
 *  inverse of nextVoiceMode, so A and LT together walk the ring
 *  both ways and a step too far is one trigger-pull back. */
export function prevVoiceMode(mode: VoiceMode): VoiceMode {
  const i = VOICE_MODES.indexOf(mode);
  return VOICE_MODES[(i - 1 + VOICE_MODES.length) % VOICE_MODES.length] ?? "deafen";
}

/* ── Device memory ────────────────────────────────────────────────────
   The mode is remembered on this device: deafen once and the hall
   greets you deafened next visit (announced on entry, so the room's
   name plates are right from the first frame). The pre-modes switch
   stored only "off" under the old key — that memory migrates: off
   stays off, everything else becomes Proximity (what "on" meant). */

export const WORLD_VOICE_MODE_STORAGE_KEY = "bdv.worldVoiceMode";
/** The original on/off switch's key (pre-modes) — read for migration,
 *  kept truthful on writes so nothing older misreads the device. */
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

/** Default is PROXIMITY — the mode that is exactly the hall's
 *  original behaviour for a member who has never touched the
 *  control. */
export function loadVoiceMode(storage: StorageLike | null = defaultStorage()): VoiceMode {
  if (!storage) return "proximity";
  try {
    const raw = storage.getItem(WORLD_VOICE_MODE_STORAGE_KEY);
    if (isVoiceMode(raw)) return raw;
    // Migration from the on/off switch: only "off" was ever stored.
    return storage.getItem(WORLD_VOICE_STORAGE_KEY) === "off" ? "off" : "proximity";
  } catch {
    return "proximity";
  }
}

export function storeVoiceMode(mode: VoiceMode, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(WORLD_VOICE_MODE_STORAGE_KEY, mode);
    if (mode === "off") storage.setItem(WORLD_VOICE_STORAGE_KEY, "off");
    else storage.removeItem(WORLD_VOICE_STORAGE_KEY);
  } catch {
    /* private mode etc. — the mode still applies this visit */
  }
}
