/**
 * The World — proximity-voice switch tests (lib/world/voice-toggle).
 *
 * The pure machine behind the hall's Voice on/off switch:
 * - OFF is total and ordered: release the mic first, then announce
 *   (the room drops the peer from the mesh; the flag marks plates)
 * - ON restores availability only — it NEVER joins voice or starts
 *   a mic by itself (joining stays the explicit act it is today)
 * - a join landing while the switch is off loses to the switch
 * - the marker the room carries is just "not enabled"
 * - device memory defaults ON (today's hall) and round-trips OFF
 */
import { describe, it, expect } from "vitest";
import {
  initialVoiceToggle,
  reduceVoiceToggle,
  voiceOffMarker,
  canJoinVoice,
  loadVoiceEnabled,
  storeVoiceEnabled,
  WORLD_VOICE_STORAGE_KEY,
} from "./voice-toggle";

describe("the switch", () => {
  it("starts enabled-or-not from the remembered preference, never in voice", () => {
    expect(initialVoiceToggle(true)).toEqual({ enabled: true, inVoice: false });
    expect(initialVoiceToggle(false)).toEqual({ enabled: false, inVoice: false });
  });

  it("switching off while in voice releases the mic AND announces, in that order", () => {
    const on = reduceVoiceToggle(initialVoiceToggle(true), { type: "voice-joined" }).state;
    const { state, effects } = reduceVoiceToggle(on, { type: "switch-off" });
    expect(state).toEqual({ enabled: false, inVoice: false });
    expect(effects).toEqual(["release-mic", "announce-off"]);
  });

  it("switching off while idle only announces", () => {
    const { state, effects } = reduceVoiceToggle(initialVoiceToggle(true), { type: "switch-off" });
    expect(state).toEqual({ enabled: false, inVoice: false });
    expect(effects).toEqual(["announce-off"]);
  });

  it("switching off twice is a no-op the second time", () => {
    const off = reduceVoiceToggle(initialVoiceToggle(true), { type: "switch-off" }).state;
    const again = reduceVoiceToggle(off, { type: "switch-off" });
    expect(again.state).toBe(off);
    expect(again.effects).toEqual([]);
  });

  it("switching back on announces availability — and does NOT join voice", () => {
    const off = reduceVoiceToggle(initialVoiceToggle(true), { type: "switch-off" }).state;
    const { state, effects } = reduceVoiceToggle(off, { type: "switch-on" });
    expect(state).toEqual({ enabled: true, inVoice: false });
    expect(effects).toEqual(["announce-on"]);
    expect(canJoinVoice(state)).toBe(true);
  });

  it("a join that lands while off is ignored — the switch wins the race", () => {
    const off = initialVoiceToggle(false);
    const { state, effects } = reduceVoiceToggle(off, { type: "voice-joined" });
    expect(state).toEqual({ enabled: false, inVoice: false });
    expect(effects).toEqual([]);
    expect(canJoinVoice(off)).toBe(false);
  });

  it("join/leave track the session while on; leaving while idle is a no-op", () => {
    const joined = reduceVoiceToggle(initialVoiceToggle(true), { type: "voice-joined" });
    expect(joined.state.inVoice).toBe(true);
    expect(canJoinVoice(joined.state)).toBe(false);
    const left = reduceVoiceToggle(joined.state, { type: "voice-left" });
    expect(left.state).toEqual({ enabled: true, inVoice: false });
    const leftAgain = reduceVoiceToggle(left.state, { type: "voice-left" });
    expect(leftAgain.effects).toEqual([]);
  });

  it("the presence marker is exactly 'not enabled'", () => {
    expect(voiceOffMarker(initialVoiceToggle(true))).toBe(false);
    expect(voiceOffMarker(initialVoiceToggle(false))).toBe(true);
    const inVoice = reduceVoiceToggle(initialVoiceToggle(true), { type: "voice-joined" }).state;
    expect(voiceOffMarker(inVoice)).toBe(false);
  });
});

describe("device memory", () => {
  function fakeStorage() {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      map,
    };
  }

  it("defaults ON with nothing stored — and with no storage at all", () => {
    expect(loadVoiceEnabled(fakeStorage())).toBe(true);
    expect(loadVoiceEnabled(null)).toBe(true);
  });

  it("round-trips: off is remembered, on clears back to the default", () => {
    const storage = fakeStorage();
    storeVoiceEnabled(false, storage);
    expect(storage.map.get(WORLD_VOICE_STORAGE_KEY)).toBe("off");
    expect(loadVoiceEnabled(storage)).toBe(false);
    storeVoiceEnabled(true, storage);
    expect(storage.map.has(WORLD_VOICE_STORAGE_KEY)).toBe(false);
    expect(loadVoiceEnabled(storage)).toBe(true);
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
    expect(loadVoiceEnabled(broken)).toBe(true);
    expect(() => storeVoiceEnabled(false, broken)).not.toThrow();
  });
});
