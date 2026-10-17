/**
 * The World — voice mode tests (lib/world/voice-toggle).
 *
 * The pure machine behind the hall's voice control:
 * - four modes: Off (total, as the switch always was), Proximity
 *   (voice by distance), Lobby (the whole hall), Deafen (hear
 *   nobody, mic muted, still IN voice — Discord semantics)
 * - Off is ordered: release the mic first, then announce; a standing
 *   deafen is cleared on the way into Off
 * - no mode switch ever joins voice or starts a mic by itself —
 *   joining stays the explicit act; joining WHILE deafened applies
 *   the deafen (mic muted from the first frame)
 * - deafen captures the mic mute at entry and undeafening restores
 *   exactly that mute; proximity <-> lobby is gains only
 * - device memory: the mode round-trips; the pre-modes switch's
 *   "off" migrates to Off and its "on" to Proximity
 */
import { describe, it, expect } from "vitest";
import {
  initialVoiceToggle,
  reduceVoiceToggle,
  voiceOffMarker,
  voiceDeafMarker,
  canJoinVoice,
  gainPolicyForMode,
  nextVoiceMode,
  loadVoiceMode,
  storeVoiceMode,
  WORLD_VOICE_MODE_STORAGE_KEY,
  WORLD_VOICE_STORAGE_KEY,
  type VoiceToggleState,
} from "./voice-toggle";

function inMode(mode: VoiceToggleState["mode"], opts: { inVoice?: boolean; micMuted?: boolean } = {}): VoiceToggleState {
  let s = initialVoiceToggle("proximity");
  if (opts.inVoice) s = reduceVoiceToggle(s, { type: "voice-joined" }).state;
  if (mode !== "proximity") {
    s = reduceVoiceToggle(s, { type: "set-mode", mode, micMuted: opts.micMuted }).state;
    if (opts.inVoice && !s.inVoice) s = reduceVoiceToggle(s, { type: "voice-joined" }).state;
  }
  return s;
}

describe("the modes", () => {
  it("starts in the remembered mode, never in voice", () => {
    expect(initialVoiceToggle("lobby")).toEqual({ mode: "lobby", inVoice: false, resumeMuted: false });
    expect(initialVoiceToggle("off")).toEqual({ mode: "off", inVoice: false, resumeMuted: false });
  });

  it("setting the mode you're already in is a no-op", () => {
    const s = initialVoiceToggle("proximity");
    const again = reduceVoiceToggle(s, { type: "set-mode", mode: "proximity" });
    expect(again.state).toBe(s);
    expect(again.effects).toEqual([]);
  });

  it("Off while in voice releases the mic AND announces, in that order", () => {
    const on = inMode("proximity", { inVoice: true });
    const { state, effects } = reduceVoiceToggle(on, { type: "set-mode", mode: "off" });
    expect(state).toEqual({ mode: "off", inVoice: false, resumeMuted: false });
    expect(effects).toEqual(["release-mic", "announce-off"]);
  });

  it("Off while idle only announces", () => {
    const { state, effects } = reduceVoiceToggle(initialVoiceToggle("lobby"), { type: "set-mode", mode: "off" });
    expect(state.mode).toBe("off");
    expect(effects).toEqual(["announce-off"]);
  });

  it("leaving Off announces availability — and does NOT join voice", () => {
    const off = initialVoiceToggle("off");
    const { state, effects } = reduceVoiceToggle(off, { type: "set-mode", mode: "proximity" });
    expect(state).toEqual({ mode: "proximity", inVoice: false, resumeMuted: false });
    expect(effects).toEqual(["announce-on"]);
    expect(canJoinVoice(state)).toBe(true);
  });

  it("a join that lands while Off is ignored — Off wins the race", () => {
    const off = initialVoiceToggle("off");
    const { state, effects } = reduceVoiceToggle(off, { type: "voice-joined" });
    expect(state.inVoice).toBe(false);
    expect(effects).toEqual([]);
    expect(canJoinVoice(off)).toBe(false);
  });

  it("join/leave track the session in hearing modes; leaving while idle is a no-op", () => {
    const joined = reduceVoiceToggle(initialVoiceToggle("lobby"), { type: "voice-joined" });
    expect(joined.state.inVoice).toBe(true);
    expect(canJoinVoice(joined.state)).toBe(false);
    const left = reduceVoiceToggle(joined.state, { type: "voice-left" });
    expect(left.state).toEqual({ mode: "lobby", inVoice: false, resumeMuted: false });
    const leftAgain = reduceVoiceToggle(left.state, { type: "voice-left" });
    expect(leftAgain.effects).toEqual([]);
  });

  it("proximity <-> lobby while in voice is gains only — no announcements, no mic effects", () => {
    const prox = inMode("proximity", { inVoice: true });
    const toLobby = reduceVoiceToggle(prox, { type: "set-mode", mode: "lobby" });
    expect(toLobby.effects).toEqual(["apply-mode"]);
    expect(toLobby.state.inVoice).toBe(true);
    const back = reduceVoiceToggle(toLobby.state, { type: "set-mode", mode: "proximity" });
    expect(back.effects).toEqual(["apply-mode"]);
  });

  it("proximity <-> lobby while idle changes nothing but the mode", () => {
    const { state, effects } = reduceVoiceToggle(initialVoiceToggle("proximity"), { type: "set-mode", mode: "lobby" });
    expect(state.mode).toBe("lobby");
    expect(effects).toEqual([]);
  });
});

describe("deafen", () => {
  it("deafening in voice announces, mutes the mic and zeroes the gains — the mesh stays up", () => {
    const on = inMode("proximity", { inVoice: true });
    const { state, effects } = reduceVoiceToggle(on, { type: "set-mode", mode: "deafen", micMuted: false });
    expect(state).toEqual({ mode: "deafen", inVoice: true, resumeMuted: false });
    expect(effects).toEqual(["announce-deaf", "deafen-mic", "apply-mode"]);
  });

  it("captures the mute held at entry — undeafening restores EXACTLY it", () => {
    // Member had manually muted, then deafens: the restore is "muted".
    const mutedFirst = inMode("proximity", { inVoice: true });
    const deaf = reduceVoiceToggle(mutedFirst, { type: "set-mode", mode: "deafen", micMuted: true });
    expect(deaf.state.resumeMuted).toBe(true);
    const un = reduceVoiceToggle(deaf.state, { type: "set-mode", mode: "lobby" });
    expect(un.effects).toEqual(["announce-undeaf", "restore-mic", "apply-mode"]);
    expect(un.state.mode).toBe("lobby");
    expect(un.state.inVoice).toBe(true);

    // Member was live, then deafens: the restore is "live".
    const liveFirst = inMode("lobby", { inVoice: true });
    const deaf2 = reduceVoiceToggle(liveFirst, { type: "set-mode", mode: "deafen", micMuted: false });
    expect(deaf2.state.resumeMuted).toBe(false);
    const un2 = reduceVoiceToggle(deaf2.state, { type: "set-mode", mode: "proximity" });
    expect(un2.effects).toEqual(["announce-undeaf", "restore-mic", "apply-mode"]);
  });

  it("deafening at the door (not in voice) announces only; the resume starts unmuted", () => {
    const { state, effects } = reduceVoiceToggle(initialVoiceToggle("proximity"), {
      type: "set-mode",
      mode: "deafen",
      micMuted: true, // no live session — a stale mute must not be captured
    });
    expect(state).toEqual({ mode: "deafen", inVoice: false, resumeMuted: false });
    expect(effects).toEqual(["announce-deaf"]);
  });

  it("joining voice while deafened applies the deafen to the fresh session", () => {
    const deaf = initialVoiceToggle("deafen");
    const { state, effects } = reduceVoiceToggle(deaf, { type: "voice-joined" });
    expect(state.inVoice).toBe(true);
    expect(effects).toEqual(["deafen-mic"]);
    expect(canJoinVoice(deaf)).toBe(true); // deafened members may join — deafened
  });

  it("undeafening while idle announces only — no mic to restore, no gains to apply", () => {
    const deaf = initialVoiceToggle("deafen");
    const { state, effects } = reduceVoiceToggle(deaf, { type: "set-mode", mode: "proximity" });
    expect(state.mode).toBe("proximity");
    expect(effects).toEqual(["announce-undeaf"]);
  });

  it("deafen -> Off releases the mic and clears BOTH marks, undeaf before off", () => {
    const deaf = inMode("deafen", { inVoice: true });
    const { state, effects } = reduceVoiceToggle(deaf, { type: "set-mode", mode: "off" });
    expect(state).toEqual({ mode: "off", inVoice: false, resumeMuted: false });
    expect(effects).toEqual(["release-mic", "announce-undeaf", "announce-off"]);
  });

  it("leaving voice while deafened keeps the mode (and the plate mark)", () => {
    const deaf = inMode("deafen", { inVoice: true });
    const { state, effects } = reduceVoiceToggle(deaf, { type: "voice-left" });
    expect(state.mode).toBe("deafen");
    expect(state.inVoice).toBe(false);
    expect(effects).toEqual([]);
  });

  it("the markers are exactly their modes", () => {
    expect(voiceOffMarker(initialVoiceToggle("off"))).toBe(true);
    expect(voiceOffMarker(initialVoiceToggle("deafen"))).toBe(false);
    expect(voiceDeafMarker(initialVoiceToggle("deafen"))).toBe(true);
    expect(voiceDeafMarker(initialVoiceToggle("off"))).toBe(false);
    expect(voiceDeafMarker(initialVoiceToggle("proximity"))).toBe(false);
  });
});

describe("policies + the gamepad cycle", () => {
  it("each mode maps to its gain policy", () => {
    expect(gainPolicyForMode("proximity")).toBe("proximity");
    expect(gainPolicyForMode("lobby")).toBe("lobby");
    expect(gainPolicyForMode("deafen")).toBe("silent");
    expect(gainPolicyForMode("off")).toBe("silent");
  });

  it("A steps Off → Proximity → Lobby → Deafen → Off", () => {
    expect(nextVoiceMode("off")).toBe("proximity");
    expect(nextVoiceMode("proximity")).toBe("lobby");
    expect(nextVoiceMode("lobby")).toBe("deafen");
    expect(nextVoiceMode("deafen")).toBe("off");
  });
});

describe("device memory", () => {
  function fakeStorage(seed: Record<string, string> = {}) {
    const map = new Map<string, string>(Object.entries(seed));
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      map,
    };
  }

  it("defaults to Proximity with nothing stored — and with no storage at all", () => {
    expect(loadVoiceMode(fakeStorage())).toBe("proximity");
    expect(loadVoiceMode(null)).toBe("proximity");
  });

  it("round-trips every mode", () => {
    const storage = fakeStorage();
    for (const mode of ["off", "proximity", "lobby", "deafen"] as const) {
      storeVoiceMode(mode, storage);
      expect(storage.map.get(WORLD_VOICE_MODE_STORAGE_KEY)).toBe(mode);
      expect(loadVoiceMode(storage)).toBe(mode);
    }
  });

  it("keeps the legacy key truthful: off writes it, any hearing mode clears it", () => {
    const storage = fakeStorage();
    storeVoiceMode("off", storage);
    expect(storage.map.get(WORLD_VOICE_STORAGE_KEY)).toBe("off");
    storeVoiceMode("lobby", storage);
    expect(storage.map.has(WORLD_VOICE_STORAGE_KEY)).toBe(false);
  });

  it("MIGRATION: a stored switch-off becomes Off; a stored (or absent) on becomes Proximity", () => {
    expect(loadVoiceMode(fakeStorage({ [WORLD_VOICE_STORAGE_KEY]: "off" }))).toBe("off");
    expect(loadVoiceMode(fakeStorage({}))).toBe("proximity");
  });

  it("MIGRATION: the new key wins over the legacy one when both exist", () => {
    const storage = fakeStorage({
      [WORLD_VOICE_MODE_STORAGE_KEY]: "deafen",
      [WORLD_VOICE_STORAGE_KEY]: "off",
    });
    expect(loadVoiceMode(storage)).toBe("deafen");
  });

  it("a garbage stored mode falls back to the migration, never crashes", () => {
    expect(loadVoiceMode(fakeStorage({ [WORLD_VOICE_MODE_STORAGE_KEY]: "loud" }))).toBe("proximity");
    expect(
      loadVoiceMode(fakeStorage({ [WORLD_VOICE_MODE_STORAGE_KEY]: "loud", [WORLD_VOICE_STORAGE_KEY]: "off" })),
    ).toBe("off");
  });

  it("a broken storage never throws and never flips the default", () => {
    const broken = {
      getItem: () => {
        throw new Error("private mode");
      },
      setItem: () => {
        throw new Error("private mode");
      },
      removeItem: () => {
        throw new Error("private mode");
      },
    };
    expect(loadVoiceMode(broken)).toBe("proximity");
    expect(() => storeVoiceMode("deafen", broken)).not.toThrow();
  });
});
