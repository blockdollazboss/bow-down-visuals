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
  profileFromStored,
  storedFormOf,
  DEEP_VOICE_PRESET,
  BRIGHT_VOICE_PRESET,
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

  it("a vault character with no set voice resolves to neutral", () => {
    expect(resolveCharacterVoiceProfile({ characterId: "vault-row-123", presenceKey: "someone" })).toBe(NEUTRAL_VOICE_PROFILE);
    expect(resolveCharacterVoiceProfile({ characterId: "vault-row-123", presenceKey: "someone", storedProfile: null })).toBe(NEUTRAL_VOICE_PROFILE);
  });

  it("a vault character WITH a set voice speaks in it (0142, G4)", () => {
    const stored = { pitchSemitones: -6, formantRatio: 0.85, formantGainDb: 2.5, eq: [{ type: "lowshelf" as const, freqHz: 200, gainDb: 2, q: 0.8 }] };
    const p = resolveCharacterVoiceProfile({
      characterId: "vault-row-123",
      presenceKey: "someone",
      storedProfile: stored,
      characterName: "Nova",
    });
    expect(p.id).toBe("vault:vault-row-123");
    expect(p.label).toBe("Nova");
    expect(p.pitchSemitones).toBe(-6);
    expect(p.formantRatio).toBe(0.85);
    expect(p.formantGainDb).toBe(2.5);
    expect(p.eq).toEqual(stored.eq);
    expect(isIdentityProfile(p)).toBe(false);
    /* and the shaper actually applies it */
    const params = shapingParamsFor(p, true);
    expect(params.bypass).toBe(false);
    expect(params.pitchSemitones).toBe(-6);
  });

  it("a stored profile never overrides a house guard's own voice", () => {
    const stored = { pitchSemitones: 5, formantRatio: 1.4, formantGainDb: 3, eq: [] };
    expect(
      resolveCharacterVoiceProfile({ characterId: HOUSE_GUARD_ID, presenceKey: "x", storedProfile: stored, characterName: "Nova" }),
    ).toBe(GUARD_MALE_VOICE_PROFILE);
  });

  it("the editor presets are the guards' proven numbers, stored-form", () => {
    expect(DEEP_VOICE_PRESET).toEqual(storedFormOf(GUARD_MALE_VOICE_PROFILE));
    expect(BRIGHT_VOICE_PRESET).toEqual(storedFormOf(GUARD_FEMALE_VOICE_PROFILE));
    const p = profileFromStored("abc", "  ", DEEP_VOICE_PRESET);
    expect(p.label).toBe("your character");
    expect(p.pitchSemitones).toBe(GUARD_MALE_VOICE_PROFILE.pitchSemitones);
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

/* ── Item 65 (Stack-100 #2) — voice labels are SINGLE-SOURCED ───────
   Facet C-V3 claimed a parallel `SHAPE_LABELS` array (pitch/rate
   labels duplicated beside the shape data). Verified STALE against
   the shipped tree: no such array exists here or anywhere in git
   history — every profile carries its own `label`, the stored form
   drops it, and the presets are DERIVED from the profiles via
   storedFormOf. These pins keep it that way: a future parallel
   label table fails here instead of drifting silently. */
describe("item 65 — labels live on the profiles, nowhere else", () => {
  it("every house profile carries its own non-empty label", () => {
    for (const p of [NEUTRAL_VOICE_PROFILE, GUARD_MALE_VOICE_PROFILE, GUARD_FEMALE_VOICE_PROFILE]) {
      expect(typeof p.label).toBe("string");
      expect(p.label.length).toBeGreaterThan(0);
      /* Resolution returns the profile itself — the label the hall
         speaks is the one on the data it describes. */
      expect(resolveCharacterVoiceProfile({ characterId: null, presenceKey: null })).toBe(NEUTRAL_VOICE_PROFILE);
    }
    expect(GUARD_MALE_VOICE_PROFILE.label).toContain("male palace guard");
    expect(GUARD_FEMALE_VOICE_PROFILE.label).toContain("female palace guard");
  });

  it("the stored (vault) form carries NO label — labels are never duplicated into a second shape", () => {
    for (const p of [GUARD_MALE_VOICE_PROFILE, GUARD_FEMALE_VOICE_PROFILE]) {
      const stored = storedFormOf(p);
      expect(Object.keys(stored).sort()).toEqual(["eq", "formantGainDb", "formantRatio", "pitchSemitones"]);
      expect(stored).not.toHaveProperty("label");
    }
    /* A vault character's label is derived at realization time from
       the character itself — profileFromStored is the single place
       a stored shape gains words. */
    const realized = profileFromStored("vault-1", "Nova", DEEP_VOICE_PRESET);
    expect(realized.label).toBe("Nova");
    expect(realized.pitchSemitones).toBe(GUARD_MALE_VOICE_PROFILE.pitchSemitones);
  });

  it("the module source has no parallel label array (no SHAPE_LABELS, no *_LABELS table)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./character-voice.ts", import.meta.url), "utf8");
    expect(src).not.toContain("SHAPE_LABELS");
    expect(src).not.toMatch(/_LABELS\s*[:=]/);
  });
});
