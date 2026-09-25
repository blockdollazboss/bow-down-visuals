/**
 * Pure, dependency-free DSP-chain builders for AI Mastering.
 * No imports — safe to bundle/test anywhere. The route module re-exports
 * these so existing import sites keep working.
 */

export type MasteringPreset = "streaming" | "club" | "radio" | "lofi";

export interface MasteringPresetDef {
  key: MasteringPreset;
  label: string;
  blurb: string;
  /** EBU R128 integrated loudness target (LUFS). */
  targetLufs: number;
  /** True-peak ceiling (dBTP). */
  targetTruePeak: number;
  /** Loudness range target (LU). */
  targetLra: number;
}

export const MASTERING_PRESETS: Record<MasteringPreset, MasteringPresetDef> = {
  streaming: {
    key: "streaming",
    label: "Streaming",
    blurb: "Spotify / Apple Music ready — clean, dynamic, -14 LUFS.",
    targetLufs: -14,
    targetTruePeak: -1.0,
    targetLra: 11,
  },
  club: {
    key: "club",
    label: "Club",
    blurb: "Loud and punchy for big systems — -9 LUFS.",
    targetLufs: -9,
    targetTruePeak: -1.0,
    targetLra: 7,
  },
  radio: {
    key: "radio",
    label: "Radio",
    blurb: "Broadcast-friendly vocal presence — -12 LUFS.",
    targetLufs: -12,
    targetTruePeak: -1.0,
    targetLra: 9,
  },
  lofi: {
    key: "lofi",
    label: "Lo-Fi",
    blurb: "Gentle, warm and dynamic — -14 LUFS with a soft top end.",
    targetLufs: -14,
    targetTruePeak: -1.5,
    targetLra: 12,
  },
};

export function resolveMasteringPreset(input: unknown): MasteringPreset | null {
  if (typeof input !== "string") return null;
  return (Object.keys(MASTERING_PRESETS) as MasteringPreset[]).includes(input as MasteringPreset)
    ? (input as MasteringPreset)
    : null;
}

/* ── Pure, testable DSP-chain builders ─────────────────────────────────── */

/**
 * The per-preset DSP chain that runs BEFORE loudness normalization:
 * subsonic cleanup → glue compression → sweetening EQ → stereo width.
 * loudnorm itself always goes last (it applies the final gain + limiting).
 */
export function buildPreChain(preset: MasteringPreset): string {
  switch (preset) {
    case "streaming":
      return [
        "highpass=f=20",
        "acompressor=threshold=-18dB:ratio=2:attack=20:release=200:makeup=2dB",
        "equalizer=f=8000:t=h:w=1:g=1",
        "extrastereo=m=1.15",
      ].join(",");
    case "club":
      return [
        "highpass=f=30",
        "acompressor=threshold=-14dB:ratio=3:attack=10:release=150:makeup=3dB",
        "equalizer=f=60:t=h:w=1:g=1.5",
        "equalizer=f=12000:t=h:w=1:g=1",
        "extrastereo=m=1.3",
      ].join(",");
    case "radio":
      return [
        "highpass=f=25",
        "acompressor=threshold=-16dB:ratio=2.5:attack=15:release=180:makeup=2.5dB",
        "equalizer=f=3000:t=h:w=1:g=1",
        "extrastereo=m=1.1",
      ].join(",");
    case "lofi":
      return [
        "highpass=f=20",
        "lowpass=f=16000",
        "acompressor=threshold=-20dB:ratio=1.5:attack=30:release=300:makeup=1dB",
      ].join(",");
  }
}

export interface LoudnormMeasurement {
  inputIntegrated: number; // LUFS
  inputTruePeak: number; // dBTP
  inputLra: number; // LU
  inputThreshold: number;
  targetOffset: number;
}

/**
 * Parse the JSON block loudnorm prints (to stderr) with print_format=json.
 * Returns null when the block is missing or malformed — the job then fails
 * honestly instead of mastering blind.
 */
export function parseLoudnormJson(stderr: string): LoudnormMeasurement | null {
  const start = stderr.indexOf("{");
  const end = stderr.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const obj = JSON.parse(stderr.slice(start, end + 1)) as Record<string, unknown>;
    // Real ffmpeg prints these values as JSON *strings* ("-19.40"), not numbers.
    const num = (v: unknown): number | null => {
      const n = typeof v === "string" ? Number(v) : v;
      return typeof n === "number" && Number.isFinite(n) ? n : null;
    };
    const inputIntegrated = num(obj["input_i"]);
    const inputTruePeak = num(obj["input_tp"]);
    const inputLra = num(obj["input_lra"]);
    const inputThreshold = num(obj["input_thresh"]);
    const targetOffset = num(obj["target_offset"]);
    if (
      inputIntegrated == null ||
      inputTruePeak == null ||
      inputLra == null ||
      inputThreshold == null ||
      targetOffset == null
    ) {
      return null;
    }
    return { inputIntegrated, inputTruePeak, inputLra, inputThreshold, targetOffset };
  } catch {
    return null;
  }
}

/** Second-pass loudnorm filter with the measured values baked in. */
export function buildLoudnormSecondPass(def: MasteringPresetDef, m: LoudnormMeasurement): string {
  return [
    "loudnorm=linear=true",
    `I=${def.targetLufs}`,
    `TP=${def.targetTruePeak}`,
    `LRA=${def.targetLra}`,
    `measured_I=${m.inputIntegrated}`,
    `measured_TP=${m.inputTruePeak}`,
    `measured_LRA=${m.inputLra}`,
    `measured_thresh=${m.inputThreshold}`,
    `offset=${m.targetOffset}`,
  ].join(":");
}

/** Full filter chain for the render pass. */
export function buildFullChain(preset: MasteringPreset, m: LoudnormMeasurement): string {
  return `${buildPreChain(preset)},${buildLoudnormSecondPass(MASTERING_PRESETS[preset], m)}`;
}
