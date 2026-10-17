/**
 * Character voice tests (lib/world/character-voice) — the pure core:
 * - the profile table is sane (the guards pull in opposite
 *   directions, every value inside the intelligibility bounds)
 * - the shaping math: semitone ratios, formant bands scaled and
 *   clamped, identity detection
 * - resolution follows the character you stand as — guard picks,
 *   the dealt guard for no pick, neutral for vault characters
 *   (the vault stores no shaping profile — see the module header)
 * - the switch's device memory: default ON, only "off" is stored,
 *   broken storage never flips the default
 * - shaping params: off or identity always bypasses; a real
 *   profile yields its exact pitch and bands
 */
import { describe, it, expect } from "vitest";
import {
  NEUTRAL_VOICE_PROFILE,
  GUARD_MALE_VOICE_PROFILE,
  GUARD_FEMALE_VOICE_PROFILE,
  FORMANT_BASE_FREQS_HZ,
  semitoneRatio,
  formantBandsFor,
  profileBandsFor,
  isIdentityProfile,
  resolveCharacterVoiceProfile,
  shapingParamsFor,
  loadCharacterVoiceEnabled,
  storeCharacterVoiceEnabled,
  WORLD_CHARACTER_VOICE_STORAGE_KEY,
  type CharacterVoiceProfile,
} from "./character-voice";
import { HOUSE_GUARD_ID, HOUSE_GUARD_FEMALE_ID, guardVariantForKey } from "./figure";

function memStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    map: m,
  };
}

describe("the profile table", () => {
  it("the guards shape in opposite directions, inside the bounds", () => {
    expect(GUARD_MALE_VOICE_PROFILE.pitchSemitones).toBeLessThan(0);
    expect(GUARD_FEMALE_VOICE_PROFILE.pitchSemitones).toBeGreaterThan(0);
    expect(GUARD_MALE_VOICE_PROFILE.formantRatio).toBeLessThan(1);
    expect(GUARD_FEMALE_VOICE_PROFILE.formantRatio).toBeGreaterThan(1);
    for (const p of [GUARD_MALE_VOICE_PROFILE, GUARD_FEMALE_VOICE_PROFILE]) {
      expect(Math.abs(p.pitchSemitones)).toBeLessThanOrEqual(6);
      for (const band of p.eq) expect(Math.abs(band.gainDb)).toBeLessThanOrEqual(6);
    }
  });

  it("the neutral profile is a true identity", () => {
    expect(NEUTRAL_VOICE_PROFILE.pitchSemitones).toBe(0);
    expect(NEUTRAL_VOICE_PROFILE.formantRatio).toBe(1);
    expect(NEUTRAL_VOICE_PROFILE.formantGainDb).toBe(0);
    expect(NEUTRAL_VOICE_PROFILE.eq).toEqual([]);
    expect(isIdentityProfile(NEUTRAL_VOICE_PROFILE)).toBe(true);
    expect(isIdentityProfile(GUARD_MALE_VOICE_PROFILE)).toBe(false);
    expect(isIdentityProfile(GUARD_FEMALE_VOICE_PROFILE)).toBe(false);
  });
});

describe("shaping math", () => {
  it("semitone ratios are exact powers of two", () => {
    expect(semitoneRatio(0)).toBe(1);
    expect(semitoneRatio(12)).toBe(2);
    expect(semitoneRatio(-12)).toBe(0.5);
    expect(semitoneRatio(-4)).toBeCloseTo(0.7937, 4);
    expect(semitoneRatio(3)).toBeCloseTo(1.1892, 4);
  });

  it("formant bands scale with the profile's ratio and carry its gain", () => {
    const male = formantBandsFor(GUARD_MALE_VOICE_PROFILE);
    expect(male.map((b) => b.freqHz)).toEqual(FORMANT_BASE_FREQS_HZ.map((f) => f * 0.9));
    expect(male.every((b) => b.type === "peaking" && b.gainDb === 2)).toBe(true);
    const female = formantBandsFor(GUARD_FEMALE_VOICE_PROFILE);
    expect(female.map((b) => b.freqHz)).toEqual(FORMANT_BASE_FREQS_HZ.map((f) => f * 1.1));
    expect(female.every((b) => b.gainDb === 1.5)).toBe(true);
  });

  it("a zero-gain profile realizes no formant bands", () => {
    expect(formantBandsFor(NEUTRAL_VOICE_PROFILE)).toEqual([]);
    const custom: CharacterVoiceProfile = { ...GUARD_MALE_VOICE_PROFILE, formantGainDb: 0 };
    expect(formantBandsFor(custom)).toEqual([]);
  });

  it("formant centres clamp to the audible band under wild ratios", () => {
    const huge: CharacterVoiceProfile = { ...GUARD_MALE_VOICE_PROFILE, formantRatio: 100 };
    expect(formantBandsFor(huge).every((b) => b.freqHz <= 12000)).toBe(true);
    const tiny: CharacterVoiceProfile = { ...GUARD_MALE_VOICE_PROFILE, formantRatio: 0.001 };
    expect(formantBandsFor(tiny).every((b) => b.freqHz >= 40)).toBe(true);
  });

  it("profile bands are formant bands first, then the profile EQ", () => {
    const bands = profileBandsFor(GUARD_MALE_VOICE_PROFILE);
    expect(bands).toHaveLength(FORMANT_BASE_FREQS_HZ.length + GUARD_MALE_VOICE_PROFILE.eq.length);
    expect(bands.slice(-GUARD_MALE_VOICE_PROFILE.eq.length)).toEqual(GUARD_MALE_VOICE_PROFILE.eq);
    expect(profileBandsFor(NEUTRAL_VOICE_PROFILE)).toEqual([]);
  });
});

describe("resolution — the character you stand as", () => {
  it("a guard pick speaks with that guard's voice", () => {
    expect(resolveCharacterVoiceProfile({ characterId: HOUSE_GUARD_ID, presenceKey: "anyone" })).toBe(GUARD_MALE_VOICE_PROFILE);
    expect(resolveCharacterVoiceProfile({ characterId: HOUSE_GUARD_FEMALE_ID, presenceKey: "anyone" })).toBe(GUARD_FEMALE_VOICE_PROFILE);
  });

  it("a vault character resolves to neutral — the vault stores no shaping profile", () => {
    expect(resolveCharacterVoiceProfile({ characterId: "vault-row-123", presenceKey: "someone" })).toBe(NEUTRAL_VOICE_PROFILE);
  });

  it("no pick speaks as the guard the hall deals you", () => {
    for (const key of ["king", "nova", "testcreator", "a", "zz", "front-row"]) {
      const expected = guardVariantForKey(key) === "female" ? GUARD_FEMALE_VOICE_PROFILE : GUARD_MALE_VOICE_PROFILE;
      expect(resolveCharacterVoiceProfile({ characterId: null, presenceKey: key })).toBe(expected);
    }
  });

  it("nothing to resolve from is neutral, never a guess", () => {
    expect(resolveCharacterVoiceProfile({ characterId: null, presenceKey: null })).toBe(NEUTRAL_VOICE_PROFILE);
    expect(resolveCharacterVoiceProfile({ characterId: undefined, presenceKey: undefined })).toBe(NEUTRAL_VOICE_PROFILE);
    expect(resolveCharacterVoiceProfile({ characterId: "", presenceKey: "" })).toBe(NEUTRAL_VOICE_PROFILE);
  });
});

describe("shaping params", () => {
  it("switch off always bypasses, whatever the profile", () => {
    expect(shapingParamsFor(GUARD_MALE_VOICE_PROFILE, false)).toEqual({ bypass: true, pitchSemitones: 0, bands: [] });
    expect(shapingParamsFor(NEUTRAL_VOICE_PROFILE, false).bypass).toBe(true);
  });

  it("an identity profile bypasses even with the switch on", () => {
    expect(shapingParamsFor(NEUTRAL_VOICE_PROFILE, true)).toEqual({ bypass: true, pitchSemitones: 0, bands: [] });
  });

  it("a guard profile yields its exact pitch and bands", () => {
    const params = shapingParamsFor(GUARD_FEMALE_VOICE_PROFILE, true);
    expect(params.bypass).toBe(false);
    expect(params.pitchSemitones).toBe(3);
    expect(params.bands).toEqual(profileBandsFor(GUARD_FEMALE_VOICE_PROFILE));
  });
});

describe("device memory", () => {
  it("defaults ON with nothing stored — and with no storage at all", () => {
    expect(loadCharacterVoiceEnabled(memStorage())).toBe(true);
    expect(loadCharacterVoiceEnabled(null)).toBe(true);
  });

  it("round-trips: off is stored, on clears back to the default", () => {
    const storage = memStorage();
    storeCharacterVoiceEnabled(false, storage);
    expect(storage.map.get(WORLD_CHARACTER_VOICE_STORAGE_KEY)).toBe("off");
    expect(loadCharacterVoiceEnabled(storage)).toBe(false);
    storeCharacterVoiceEnabled(true, storage);
    expect(storage.map.has(WORLD_CHARACTER_VOICE_STORAGE_KEY)).toBe(false);
    expect(loadCharacterVoiceEnabled(storage)).toBe(true);
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
    expect(loadCharacterVoiceEnabled(broken)).toBe(true);
    expect(() => storeCharacterVoiceEnabled(false, broken)).not.toThrow();
  });
});
