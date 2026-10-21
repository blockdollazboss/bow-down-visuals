/**
 * sanitizeCharacterVoiceProfile (0142, G4): the vault's stored World
 * voice profile is raw JSONB — nothing downstream may trust it. These
 * pin the contract: valid profiles pass through with numbers clamped
 * to the shaper's safe bounds; malformed shapes become null (neutral).
 */
import { describe, it, expect } from "vitest";
import { sanitizeCharacterVoiceProfile } from "../character-voice-profile";

describe("sanitizeCharacterVoiceProfile", () => {
  it("passes a well-formed profile through", () => {
    const p = sanitizeCharacterVoiceProfile({
      pitchSemitones: -4,
      formantRatio: 0.9,
      formantGainDb: 2,
      eq: [{ type: "lowshelf", freqHz: 160, gainDb: 3, q: 0.7 }],
    });
    expect(p).toEqual({
      pitchSemitones: -4,
      formantRatio: 0.9,
      formantGainDb: 2,
      eq: [{ type: "lowshelf", freqHz: 160, gainDb: 3, q: 0.7 }],
    });
  });

  it("null / non-objects / missing core numbers are null (neutral)", () => {
    expect(sanitizeCharacterVoiceProfile(null)).toBeNull();
    expect(sanitizeCharacterVoiceProfile(undefined)).toBeNull();
    expect(sanitizeCharacterVoiceProfile("deep")).toBeNull();
    expect(sanitizeCharacterVoiceProfile([1, 2])).toBeNull();
    expect(sanitizeCharacterVoiceProfile({ pitchSemitones: -4 })).toBeNull();
    expect(
      sanitizeCharacterVoiceProfile({ pitchSemitones: "abc", formantRatio: 1, formantGainDb: 1 }),
    ).toBeNull();
  });

  it("clamps out-of-range numbers to the safe bounds", () => {
    const p = sanitizeCharacterVoiceProfile({
      pitchSemitones: -99,
      formantRatio: 9,
      formantGainDb: 42,
      eq: [{ type: "peaking", freqHz: 99999, gainDb: -50, q: 99 }],
    });
    expect(p).toEqual({
      pitchSemitones: -12,
      formantRatio: 2,
      formantGainDb: 6,
      eq: [{ type: "peaking", freqHz: 12000, gainDb: -12, q: 4 }],
    });
  });

  it("caps EQ at 4 bands, drops malformed bands, defaults unknown types to peaking", () => {
    const band = { type: "lowshelf", freqHz: 100, gainDb: 1, q: 1 };
    const p = sanitizeCharacterVoiceProfile({
      pitchSemitones: 0,
      formantRatio: 1,
      formantGainDb: 0,
      eq: [band, { nope: true }, { type: "laser", freqHz: 800, gainDb: 1, q: 1 }, band, band, band],
    });
    expect(p?.eq).toHaveLength(4);
    expect(p?.eq[1]).toEqual({ type: "peaking", freqHz: 800, gainDb: 1, q: 1 });
  });

  it("a missing eq is an empty band list, not a failure", () => {
    expect(
      sanitizeCharacterVoiceProfile({ pitchSemitones: 3, formantRatio: 1.1, formantGainDb: 1.5 }),
    ).toEqual({ pitchSemitones: 3, formantRatio: 1.1, formantGainDb: 1.5, eq: [] });
  });
});
