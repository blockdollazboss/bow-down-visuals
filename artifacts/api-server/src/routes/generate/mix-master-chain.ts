/**
 * Pure, dependency-free DSP-chain builders for AI Mix & Master.
 * No imports except the loudnorm JSON parser — safe to bundle/test anywhere.
 *
 * Two pipelines:
 *  - MASTER: single stereo mix → genre pre-chain → two-pass EBU R128 loudnorm.
 *  - MIX:    N stems → per-stem chains (gain staging, EQ, compression,
 *            small-room vocal space, genre panning) → amix bus →
 *            genre pre-chain → two-pass loudnorm.
 *
 * Every filter used here is verified against the production FFmpeg build
 * (aresample, aformat, highpass, lowshelf, highshelf, equalizer,
 * acompressor, aecho, volume, pan, extrastereo, amix, loudnorm).
 */

import { parseLoudnormJson, type LoudnormMeasurement } from "./mastering-chain";

export type MixMasterGenre =
  | "hip-hop"
  | "pop"
  | "rnb"
  | "edm"
  | "rock"
  | "lofi"
  | "afrobeat"
  | "gospel";

export type MixMasterIntensity = "subtle" | "balanced" | "aggressive";

export type MixMasterLoudness = "streaming" | "club" | "radio";

export type StemType =
  | "vocals"
  | "drums"
  | "bass"
  | "keys"
  | "guitar"
  | "strings"
  | "fx"
  | "beat"
  | "other";

export interface LoudnessTargetDef {
  key: MixMasterLoudness;
  label: string;
  blurb: string;
  targetLufs: number;
  targetTruePeak: number;
  targetLra: number;
}

export const LOUDNESS_TARGETS: Record<MixMasterLoudness, LoudnessTargetDef> = {
  streaming: {
    key: "streaming",
    label: "Streaming",
    blurb: "Spotify / Apple Music ready — clean and dynamic.",
    targetLufs: -14,
    targetTruePeak: -1.0,
    targetLra: 11,
  },
  club: {
    key: "club",
    label: "Club",
    blurb: "Loud and punchy for big sound systems.",
    targetLufs: -9,
    targetTruePeak: -1.0,
    targetLra: 7,
  },
  radio: {
    key: "radio",
    label: "Radio",
    blurb: "Broadcast-friendly presence and consistency.",
    targetLufs: -11,
    targetTruePeak: -1.0,
    targetLra: 9,
  },
};

export interface GenrePresetDef {
  key: MixMasterGenre;
  label: string;
  blurb: string;
  /** Subsonic cleanup highpass (Hz) applied on the master bus. */
  subsonicHz: number;
  /** Glue compressor settings. */
  glueThresholdDb: number;
  glueRatio: number;
  glueAttackMs: number;
  glueReleaseMs: number;
  glueMakeupDb: number;
  /** Sweetening EQ (gains in dB, scaled by intensity). */
  bassFreqHz: number;
  bassGainDb: number;
  presenceFreqHz: number;
  presenceGainDb: number;
  airFreqHz: number;
  airGainDb: number;
  /** Stereo width (extrastereo m; 1.0 = untouched). */
  stereoWidth: number;
  /** Lo-fi style top-end rolloff (Hz, 0 = off). */
  topRolloffHz: number;
  /** Vocal stem chain. */
  vocalHpHz: number;
  vocalPresenceDb: number;
  vocalCompThresholdDb: number;
  vocalCompRatio: number;
  /** Drum stem chain. */
  drumHpHz: number;
  drumCompThresholdDb: number;
  drumCompRatio: number;
  /** Per-stem gain staging (dB). */
  stemGainsDb: Record<StemType, number>;
  /** Per-stem pan position (0 = hard left, 0.5 = center, 1 = hard right). */
  stemPan: Record<StemType, number>;
}

const PAN_CENTER: Record<StemType, number> = {
  vocals: 0.5,
  drums: 0.5,
  bass: 0.5,
  keys: 0.5,
  guitar: 0.5,
  strings: 0.5,
  fx: 0.5,
  beat: 0.5,
  other: 0.5,
};

const GAINS_FLAT: Record<StemType, number> = {
  vocals: 0,
  drums: 0,
  bass: 0,
  keys: -2,
  guitar: -2,
  strings: -3,
  fx: -4,
  beat: -1,
  other: -2,
};

export const GENRE_PRESETS: Record<MixMasterGenre, GenrePresetDef> = {
  "hip-hop": {
    key: "hip-hop",
    label: "Hip-Hop",
    blurb: "Heavy low end, forward vocals, punchy drums.",
    subsonicHz: 30,
    glueThresholdDb: -16, glueRatio: 2.5, glueAttackMs: 15, glueReleaseMs: 180, glueMakeupDb: 2,
    bassFreqHz: 60, bassGainDb: 2.0,
    presenceFreqHz: 3000, presenceGainDb: 1.0,
    airFreqHz: 12000, airGainDb: 1.0,
    stereoWidth: 1.25, topRolloffHz: 0,
    vocalHpHz: 80, vocalPresenceDb: 1.5, vocalCompThresholdDb: -18, vocalCompRatio: 3,
    drumHpHz: 40, drumCompThresholdDb: -14, drumCompRatio: 4,
    stemGainsDb: { ...GAINS_FLAT, vocals: 1, drums: 0, bass: 1 },
    stemPan: { ...PAN_CENTER, keys: 0.62, guitar: 0.35, strings: 0.68, fx: 0.45 },
  },
  pop: {
    key: "pop",
    label: "Pop",
    blurb: "Polished, bright and wide — radio-ready sheen.",
    subsonicHz: 25,
    glueThresholdDb: -18, glueRatio: 2, glueAttackMs: 20, glueReleaseMs: 200, glueMakeupDb: 2,
    bassFreqHz: 70, bassGainDb: 1.0,
    presenceFreqHz: 3000, presenceGainDb: 1.5,
    airFreqHz: 12000, airGainDb: 1.5,
    stereoWidth: 1.3, topRolloffHz: 0,
    vocalHpHz: 80, vocalPresenceDb: 2, vocalCompThresholdDb: -18, vocalCompRatio: 3,
    drumHpHz: 40, drumCompThresholdDb: -16, drumCompRatio: 3,
    stemGainsDb: { ...GAINS_FLAT, vocals: 1.5 },
    stemPan: { ...PAN_CENTER, keys: 0.6, guitar: 0.4, strings: 0.65, fx: 0.5 },
  },
  rnb: {
    key: "rnb",
    label: "R&B",
    blurb: "Smooth, warm and silky — vocals sit like velvet.",
    subsonicHz: 25,
    glueThresholdDb: -20, glueRatio: 1.8, glueAttackMs: 30, glueReleaseMs: 250, glueMakeupDb: 1.5,
    bassFreqHz: 65, bassGainDb: 1.5,
    presenceFreqHz: 2500, presenceGainDb: 1.0,
    airFreqHz: 12000, airGainDb: 2.0,
    stereoWidth: 1.35, topRolloffHz: 0,
    vocalHpHz: 70, vocalPresenceDb: 1.5, vocalCompThresholdDb: -20, vocalCompRatio: 2.5,
    drumHpHz: 40, drumCompThresholdDb: -18, drumCompRatio: 2.5,
    stemGainsDb: { ...GAINS_FLAT, vocals: 2, bass: 1 },
    stemPan: { ...PAN_CENTER, keys: 0.62, strings: 0.7, guitar: 0.38 },
  },
  edm: {
    key: "edm",
    label: "EDM",
    blurb: "Maximum energy — huge drops, wide supersaws.",
    subsonicHz: 30,
    glueThresholdDb: -14, glueRatio: 3, glueAttackMs: 10, glueReleaseMs: 150, glueMakeupDb: 3,
    bassFreqHz: 55, bassGainDb: 2.5,
    presenceFreqHz: 4000, presenceGainDb: 1.0,
    airFreqHz: 14000, airGainDb: 1.5,
    stereoWidth: 1.4, topRolloffHz: 0,
    vocalHpHz: 90, vocalPresenceDb: 1.5, vocalCompThresholdDb: -16, vocalCompRatio: 3.5,
    drumHpHz: 45, drumCompThresholdDb: -12, drumCompRatio: 4.5,
    stemGainsDb: { ...GAINS_FLAT, drums: 1, bass: 1.5, vocals: 0 },
    stemPan: { ...PAN_CENTER, keys: 0.65, fx: 0.55, strings: 0.7 },
  },
  rock: {
    key: "rock",
    label: "Rock",
    blurb: "Gritty and wide — guitars left and right, drums up front.",
    subsonicHz: 30,
    glueThresholdDb: -16, glueRatio: 2.5, glueAttackMs: 15, glueReleaseMs: 180, glueMakeupDb: 2,
    bassFreqHz: 80, bassGainDb: 1.0,
    presenceFreqHz: 3000, presenceGainDb: 1.5,
    airFreqHz: 11000, airGainDb: 0.5,
    stereoWidth: 1.2, topRolloffHz: 0,
    vocalHpHz: 80, vocalPresenceDb: 1.5, vocalCompThresholdDb: -18, vocalCompRatio: 3,
    drumHpHz: 40, drumCompThresholdDb: -14, drumCompRatio: 4,
    stemGainsDb: { ...GAINS_FLAT, guitar: 0, drums: 0.5 },
    stemPan: { ...PAN_CENTER, guitar: 0.22, keys: 0.72, strings: 0.6 },
  },
  lofi: {
    key: "lofi",
    label: "Lo-Fi",
    blurb: "Dusty, warm and mellow — soft top end, gentle glue.",
    subsonicHz: 20,
    glueThresholdDb: -20, glueRatio: 1.5, glueAttackMs: 30, glueReleaseMs: 300, glueMakeupDb: 1,
    bassFreqHz: 80, bassGainDb: 1.0,
    presenceFreqHz: 2500, presenceGainDb: 0,
    airFreqHz: 12000, airGainDb: -1.0,
    stereoWidth: 1.0, topRolloffHz: 16000,
    vocalHpHz: 70, vocalPresenceDb: 0.5, vocalCompThresholdDb: -22, vocalCompRatio: 2,
    drumHpHz: 40, drumCompThresholdDb: -20, drumCompRatio: 2,
    stemGainsDb: { ...GAINS_FLAT },
    stemPan: { ...PAN_CENTER, keys: 0.58, guitar: 0.42 },
  },
  afrobeat: {
    key: "afrobeat",
    label: "Afrobeat",
    blurb: "Bouncy and percussive — log drums knock, shakers dance.",
    subsonicHz: 28,
    glueThresholdDb: -18, glueRatio: 2, glueAttackMs: 20, glueReleaseMs: 200, glueMakeupDb: 2,
    bassFreqHz: 60, bassGainDb: 2.0,
    presenceFreqHz: 3500, presenceGainDb: 1.5,
    airFreqHz: 12000, airGainDb: 1.5,
    stereoWidth: 1.35, topRolloffHz: 0,
    vocalHpHz: 80, vocalPresenceDb: 1.5, vocalCompThresholdDb: -18, vocalCompRatio: 3,
    drumHpHz: 40, drumCompThresholdDb: -14, drumCompRatio: 4,
    stemGainsDb: { ...GAINS_FLAT, drums: 1, bass: 1.5, vocals: 1 },
    stemPan: { ...PAN_CENTER, keys: 0.62, guitar: 0.36, fx: 0.58, strings: 0.66 },
  },
  gospel: {
    key: "gospel",
    label: "Gospel",
    blurb: "Big and uplifting — choir clarity, keys that soar.",
    subsonicHz: 25,
    glueThresholdDb: -18, glueRatio: 2, glueAttackMs: 20, glueReleaseMs: 220, glueMakeupDb: 2,
    bassFreqHz: 70, bassGainDb: 1.0,
    presenceFreqHz: 3000, presenceGainDb: 2.0,
    airFreqHz: 12000, airGainDb: 2.0,
    stereoWidth: 1.4, topRolloffHz: 0,
    vocalHpHz: 70, vocalPresenceDb: 2, vocalCompThresholdDb: -20, vocalCompRatio: 2.5,
    drumHpHz: 40, drumCompThresholdDb: -16, drumCompRatio: 3,
    stemGainsDb: { ...GAINS_FLAT, vocals: 2, keys: 0, strings: -1 },
    stemPan: { ...PAN_CENTER, keys: 0.6, strings: 0.68, guitar: 0.4 },
  },
};

/** Intensity scaling factor applied to EQ gains, makeup gain and (ratio − 1). */
export const INTENSITY_SCALE: Record<MixMasterIntensity, number> = {
  subtle: 0.65,
  balanced: 1.0,
  aggressive: 1.4,
};

export function resolveGenre(input: unknown): MixMasterGenre | null {
  return typeof input === "string" && input in GENRE_PRESETS ? (input as MixMasterGenre) : null;
}

export function resolveIntensity(input: unknown): MixMasterIntensity | null {
  return input === "subtle" || input === "balanced" || input === "aggressive" ? input : null;
}

export function resolveLoudness(input: unknown): MixMasterLoudness | null {
  return typeof input === "string" && input in LOUDNESS_TARGETS ? (input as MixMasterLoudness) : null;
}

/* ── Stem type auto-detection from filenames ─────────────────────────── */

const STEM_PATTERNS: Array<[StemType, RegExp]> = [
  ["vocals", /(voc|vox|vocal|acapella|a cappella|lead|hook|chorus|verse|adlib|ad-lib|bgv|choir(?![\w-]*strings))/i],
  ["drums", /(drum|perc|kick|snare|hat|clap|tom|cymbal|shaker|conga|bongo|djembe)/i],
  ["bass", /(bass|808|sub(?![\w-]*mix)|lowend|low[ -]?end)/i],
  ["keys", /(key|piano|synth|pad|arp|organ|rhodes|epiano|midi|pluck|bell)/i],
  ["guitar", /(guit|gtr|strum|acoustic|electric)/i],
  ["strings", /(string|violin|viola|cello|orchestra|ensemble)/i],
  ["fx", /(fx|sfx|riser|sweep|impact|transition|earcandy|ear candy|texture|ambien)/i],
  ["beat", /(beat|instrumental|backing|track|music|playback|karaoke)/i],
];

export function detectStemType(filename: string): StemType {
  const name = (filename || "").toLowerCase();
  for (const [type, re] of STEM_PATTERNS) {
    if (re.test(name)) return type;
  }
  return "other";
}

/* ── Chain builders ──────────────────────────────────────────────────── */

/**
 * Master-bus pre-chain: subsonic cleanup → glue compression → genre
 * sweetening EQ → (optional lo-fi rolloff) → stereo widening.
 * loudnorm always goes last (it applies the final gain + limiting).
 */
export function buildMasterPreChain(genreKey: MixMasterGenre, intensity: MixMasterIntensity): string {
  const g = GENRE_PRESETS[genreKey];
  const s = INTENSITY_SCALE[intensity];
  const gain = (db: number) => (db * s).toFixed(2);
  const ratio = (1 + (g.glueRatio - 1) * s).toFixed(2);
  const parts = [
    `highpass=f=${g.subsonicHz}`,
    `acompressor=threshold=${g.glueThresholdDb}dB:ratio=${ratio}:attack=${g.glueAttackMs}:release=${g.glueReleaseMs}:makeup=${(g.glueMakeupDb * s).toFixed(1)}dB`,
    `lowshelf=f=${g.bassFreqHz}:g=${gain(g.bassGainDb)}`,
    `equalizer=f=${g.presenceFreqHz}:t=h:w=${Math.round(g.presenceFreqHz / 2.5)}:g=${gain(g.presenceGainDb)}`,
    `highshelf=f=${g.airFreqHz}:g=${gain(g.airGainDb)}`,
  ];
  if (g.topRolloffHz > 0) parts.push(`lowpass=f=${g.topRolloffHz}`);
  parts.push(`extrastereo=m=${(1 + (g.stereoWidth - 1) * s).toFixed(2)}`);
  return parts.join(",");
}

/**
 * Per-stem chain (applied to a single decoded input):
 * resample → stereo normalize → high-pass (not on bass) → type EQ →
 * compression (vocals/drums) → small-room space (vocals) →
 * gain staging (+ user vocal level) → genre panning.
 */
export function buildStemChain(
  stemType: StemType,
  genreKey: MixMasterGenre,
  intensity: MixMasterIntensity,
  vocalLevelDb: number,
): string {
  const g = GENRE_PRESETS[genreKey];
  const s = INTENSITY_SCALE[intensity];
  const parts: string[] = ["aresample=48000", "aformat=channel_layouts=stereo"];

  // High-pass cleanup (never on bass — it lives down there).
  const hpHz =
    stemType === "bass" ? 0
    : stemType === "vocals" ? g.vocalHpHz
    : stemType === "drums" ? g.drumHpHz
    : stemType === "keys" ? 60
    : stemType === "guitar" ? 80
    : stemType === "strings" ? 50
    : stemType === "fx" ? 100
    : 40; // beat / other
  if (hpHz > 0) parts.push(`highpass=f=${hpHz}`);

  // Type-specific tone shaping.
  if (stemType === "vocals") {
    parts.push(`equalizer=f=3000:t=h:w=1200:g=${(g.vocalPresenceDb * s).toFixed(2)}`);
    parts.push(
      `acompressor=threshold=${g.vocalCompThresholdDb}dB:ratio=${(1 + (g.vocalCompRatio - 1) * s).toFixed(2)}:attack=10:release=150:makeup=${(1.5 * s).toFixed(1)}dB`,
    );
    // Small-room space (short slapback via aecho — the honest FFmpeg approximation of a room send).
    parts.push("aecho=0.8:0.6:18:0.22");
  } else if (stemType === "drums") {
    parts.push(
      `acompressor=threshold=${g.drumCompThresholdDb}dB:ratio=${(1 + (g.drumCompRatio - 1) * s).toFixed(2)}:attack=5:release=100:makeup=${(2 * s).toFixed(1)}dB`,
    );
    parts.push("equalizer=f=5000:t=h:w=2000:g=0.8");
  } else if (stemType === "bass") {
    parts.push(`lowshelf=f=70:g=${(1.5 * s).toFixed(2)}`);
  } else if (stemType === "keys" || stemType === "guitar" || stemType === "strings") {
    parts.push(`equalizer=f=3500:t=h:w=1500:g=${(0.8 * s).toFixed(2)}`);
  }

  // Gain staging: genre base + user vocal-level preference on vocal stems.
  const stageDb = g.stemGainsDb[stemType] + (stemType === "vocals" ? vocalLevelDb : 0);
  if (Math.abs(stageDb) > 0.05) parts.push(`volume=${stageDb.toFixed(1)}dB`);

  // Genre panning (constant-power-ish law).
  const p = g.stemPan[stemType];
  if (Math.abs(p - 0.5) > 0.01) {
    const gl = Math.cos((p * Math.PI) / 2).toFixed(3);
    const gr = Math.sin((p * Math.PI) / 2).toFixed(3);
    parts.push(`pan=stereo|c0=c0*${gl}|c1=c1*${gr}`);
  }

  return parts.join(",");
}

/** Second-pass loudnorm with measured values baked in (target may come from a reference track). */
export function buildLoudnormRender(
  targetLufs: number,
  targetTruePeak: number,
  targetLra: number,
  m: LoudnormMeasurement,
): string {
  return [
    "loudnorm=linear=true",
    `I=${targetLufs}`,
    `TP=${targetTruePeak}`,
    `LRA=${targetLra}`,
    `measured_I=${m.inputIntegrated}`,
    `measured_TP=${m.inputTruePeak}`,
    `measured_LRA=${m.inputLra}`,
    `measured_thresh=${m.inputThreshold}`,
    `offset=${m.targetOffset}`,
  ].join(":");
}

/**
 * Full filter_complex for the MIX pipeline:
 * per-stem chains → amix bus → master pre-chain → loudnorm tail.
 * The tail is either "loudnorm=print_format=json" (measure pass) or the
 * render pass from buildLoudnormRender.
 *
 * When splitOutputs > 1 the final stream is asplit into N labeled
 * outputs (FFmpeg forbids -map'ing one filter label twice in a command).
 * Returns the graph plus the output labels to -map.
 */
export function buildMixFilterComplex(
  stemTypes: StemType[],
  genreKey: MixMasterGenre,
  intensity: MixMasterIntensity,
  vocalLevelDb: number,
  masterPreChain: string,
  loudnormTail: string,
  splitOutputs = 1,
): { graph: string; outputs: string[] } {
  const segments: string[] = stemTypes.map(
    (t, i) => `[${i}:a]${buildStemChain(t, genreKey, intensity, vocalLevelDb)}[s${i}]`,
  );
  const mixInputs = stemTypes.map((_, i) => `[s${i}]`).join("");
  segments.push(
    `${mixInputs}amix=inputs=${stemTypes.length}:normalize=0:duration=longest[mix]`,
  );
  if (splitOutputs > 1) {
    const labels = Array.from({ length: splitOutputs }, (_, i) => `[o${i + 1}]`).join("");
    segments.push(`[mix]${masterPreChain},${loudnormTail}[preout]`);
    segments.push(`[preout]asplit=${splitOutputs}${labels}`);
    return {
      graph: segments.join(";"),
      outputs: Array.from({ length: splitOutputs }, (_, i) => `[o${i + 1}]`),
    };
  }
  segments.push(`[mix]${masterPreChain},${loudnormTail}[out]`);
  return { graph: segments.join(";"), outputs: ["[out]"] };
}

export { parseLoudnormJson };
export type { LoudnormMeasurement };
