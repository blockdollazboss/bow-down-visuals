/**
 * character-voice-profile.ts — the stored shape of a Creative Vault
 * character's World voice (migration 0142, character audit G4).
 *
 * A profile is the numbers the hall's send-side shaper applies when the
 * owner talks AS the character (see the web client's
 * lib/world/character-voice.ts for the shaping itself): pitch in
 * semitones, a formant ratio, a formant gain, and the profile's own EQ
 * bands. It lives on artist_vaults.voice_profile as JSONB; null means
 * "no set voice" — the character sounds like its speaker (neutral).
 *
 * Everything that reads or writes the column goes through
 * sanitizeCharacterVoiceProfile: stored values are clamped to the
 * intelligible bounds the house profiles use, malformed shapes become
 * null (neutral), and no caller ever trusts raw JSONB.
 */

export interface CharacterVoiceEqBandStored {
  type: string;
  freqHz: number;
  gainDb: number;
  q: number;
}

export interface CharacterVoiceProfileStored {
  pitchSemitones: number;
  formantRatio: number;
  formantGainDb: number;
  eq: CharacterVoiceEqBandStored[];
}

const EQ_TYPES = new Set([
  "lowshelf",
  "highshelf",
  "peaking",
  "lowpass",
  "highpass",
  "bandpass",
  "notch",
  "allpass",
]);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finite(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize an unknown value into a stored profile, or null when it
 * isn't one. Numbers are clamped to the shaper's safe bounds:
 * pitch ±12 semitones, formant ratio 0.5–2, formant gain 0–6 dB,
 * at most 4 EQ bands (40 Hz–12 kHz, ±12 dB, Q 0.3–4).
 */
export function sanitizeCharacterVoiceProfile(raw: unknown): CharacterVoiceProfileStored | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const pitch = finite(r["pitchSemitones"]);
  const formantRatio = finite(r["formantRatio"]);
  const formantGainDb = finite(r["formantGainDb"]);
  if (pitch === null || formantRatio === null || formantGainDb === null) return null;

  const eqRaw = Array.isArray(r["eq"]) ? r["eq"] : [];
  const eq: CharacterVoiceEqBandStored[] = [];
  for (const band of eqRaw) {
    if (eq.length >= 4) break;
    if (!band || typeof band !== "object" || Array.isArray(band)) continue;
    const b = band as Record<string, unknown>;
    const type = typeof b["type"] === "string" && EQ_TYPES.has(b["type"]) ? b["type"] : "peaking";
    const freqHz = finite(b["freqHz"]);
    const gainDb = finite(b["gainDb"]);
    const q = finite(b["q"]);
    if (freqHz === null || gainDb === null) continue;
    eq.push({
      type,
      freqHz: clamp(freqHz, 40, 12000),
      gainDb: clamp(gainDb, -12, 12),
      q: clamp(q ?? 1, 0.3, 4),
    });
  }

  return {
    pitchSemitones: clamp(pitch, -12, 12),
    formantRatio: clamp(formantRatio, 0.5, 2),
    formantGainDb: clamp(formantGainDb, 0, 6),
    eq,
  };
}
