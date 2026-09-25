import { z } from "zod";

/* ─── Sample Pack Generator pricing + catalog ──────────────────────────────
   Producers generate custom sample packs: drum one-shots, melodic loops,
   bass loops, FX — downloadable WAVs. 5 credits per 10-sample pack.
   Honest split: drums + FX are ffmpeg-synthesized (labeled "Synthesized"),
   melodies + basslines are ElevenLabs Music (labeled "AI-generated").
   Nothing is ever faked — every file is really rendered. */

export const SAMPLE_PACK_SIZES = [10, 25, 50] as const;
export type SamplePackSize = (typeof SAMPLE_PACK_SIZES)[number];

export const SAMPLE_PACK_10_CREDITS = 5;
export const SAMPLE_PACK_25_CREDITS = 12;
export const SAMPLE_PACK_50_CREDITS = 20;

export function creditCostForPackSize(size: number): number {
  if (size === 10) return Number(process.env["SAMPLE_PACK_10_CREDITS"]) || SAMPLE_PACK_10_CREDITS;
  if (size === 25) return Number(process.env["SAMPLE_PACK_25_CREDITS"]) || SAMPLE_PACK_25_CREDITS;
  if (size === 50) return Number(process.env["SAMPLE_PACK_50_CREDITS"]) || SAMPLE_PACK_50_CREDITS;
  throw new Error(`Unsupported pack size: ${size}`);
}

export function isSamplePackSize(n: unknown): n is SamplePackSize {
  return n === 10 || n === 25 || n === 50;
}

/* ─── Sample types ──────────────────────────────────────────────────────── */

export const SAMPLE_TYPE_KEYS = [
  "kick",
  "snare",
  "clap",
  "hihat",
  "openhat",
  "perc",
  "melody",
  "bass",
  "riser",
  "impact",
  "downlifter",
] as const;
export type SampleTypeKey = (typeof SAMPLE_TYPE_KEYS)[number];

/** How the sample is produced — shown honestly in the UI. */
export type SampleOrigin = "synthesized" | "ai-generated";

export interface SampleTypeInfo {
  key: SampleTypeKey;
  label: string;
  origin: SampleOrigin;
  blurb: string;
}

export const SAMPLE_TYPES: Record<SampleTypeKey, SampleTypeInfo> = {
  kick:      { key: "kick",      label: "Kick",       origin: "synthesized",  blurb: "Punchy synthesized kick drum one-shot" },
  snare:     { key: "snare",     label: "Snare",      origin: "synthesized",  blurb: "Crisp synthesized snare hit" },
  clap:      { key: "clap",      label: "Clap",       origin: "synthesized",  blurb: "Layered synthesized hand clap" },
  hihat:     { key: "hihat",     label: "Closed Hat", origin: "synthesized",  blurb: "Tight synthesized closed hi-hat" },
  openhat:   { key: "openhat",   label: "Open Hat",   origin: "synthesized",  blurb: "Sizzling synthesized open hi-hat" },
  perc:      { key: "perc",      label: "Percussion", origin: "synthesized",  blurb: "Synthesized percussive tick/shaker" },
  melody:    { key: "melody",    label: "Melody Loop", origin: "ai-generated", blurb: "AI-composed melodic loop in your key" },
  bass:      { key: "bass",      label: "Bass Loop",  origin: "ai-generated", blurb: "AI-composed bassline loop in your key" },
  riser:     { key: "riser",     label: "Riser",      origin: "synthesized",  blurb: "Synthesized tension-building riser" },
  impact:    { key: "impact",    label: "Impact",     origin: "synthesized",  blurb: "Deep synthesized cinematic impact" },
  downlifter:{ key: "downlifter",label: "Downlifter", origin: "synthesized",  blurb: "Synthesized falling transition sweep" },
};

export function isSampleTypeKey(k: unknown): k is SampleTypeKey {
  return typeof k === "string" && (SAMPLE_TYPE_KEYS as readonly string[]).includes(k);
}

/* ─── Genres & keys ─────────────────────────────────────────────────────── */

export const SAMPLE_GENRES = [
  "trap",
  "hip-hop",
  "drill",
  "rnb",
  "afrobeats",
  "house",
  "techno",
  "drum-and-bass",
  "lofi",
  "pop",
] as const;
export type SampleGenre = (typeof SAMPLE_GENRES)[number];

export function isSampleGenre(g: unknown): g is SampleGenre {
  return typeof g === "string" && (SAMPLE_GENRES as readonly string[]).includes(g);
}

export const MUSICAL_KEYS = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
] as const;

export function isMusicalKey(k: unknown): k is string {
  return typeof k === "string" && (MUSICAL_KEYS as readonly string[]).includes(k);
}

/* ─── Request validation ────────────────────────────────────────────────── */

export const generatePackSchema = z.object({
  genre: z.string().refine(isSampleGenre, "Unknown genre"),
  bpm: z.number().int().min(60).max(180),
  musicalKey: z.string().refine(isMusicalKey, "Unknown key"),
  packSize: z.number().int().refine(isSamplePackSize, "Pack size must be 10, 25, or 50"),
  /* Optional subset of sample types. Defaults to a balanced mix. */
  types: z.array(z.string().refine(isSampleTypeKey, "Unknown sample type")).min(1).max(11).optional(),
});

export type GeneratePackInput = z.infer<typeof generatePackSchema>;

/* ─── Pack composition ────────────────────────────────────────────────────
   Distribute packSize samples across the requested types. Melodies and bass
   get fewer slots (they're longer AI generations); drums get the bulk. */

const TYPE_WEIGHTS: Record<SampleTypeKey, number> = {
  kick: 2, snare: 2, clap: 1, hihat: 2, openhat: 1, perc: 2,
  melody: 3, bass: 2,
  riser: 1, impact: 1, downlifter: 1,
};

export function planPackComposition(
  packSize: SamplePackSize,
  requestedTypes?: SampleTypeKey[],
): Array<{ type: SampleTypeKey; count: number }> {
  const types = requestedTypes && requestedTypes.length > 0
    ? requestedTypes
    : (Object.keys(SAMPLE_TYPES) as SampleTypeKey[]);

  const weights = types.map((t) => TYPE_WEIGHTS[t]);
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  // Largest-remainder distribution so counts always sum to packSize.
  const raw = weights.map((w) => (w / totalWeight) * packSize);
  const floors = raw.map(Math.floor);
  let remainder = packSize - floors.reduce((a, b) => a + b, 0);
  const fractions = raw.map((r, i) => ({ i, frac: r - floors[i] }));
  fractions.sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < remainder; k++) {
    floors[fractions[k % fractions.length].i] += 1;
  }
  // Guarantee every requested type gets at least one sample.
  types.forEach((_, i) => {
    if (floors[i] === 0) {
      // Steal from the largest bucket.
      let maxIdx = 0;
      for (let j = 1; j < floors.length; j++) if (floors[j] > floors[maxIdx]) maxIdx = j;
      if (floors[maxIdx] > 1) {
        floors[maxIdx] -= 1;
        floors[i] += 1;
      }
    }
  });

  return types.map((type, i) => ({ type, count: floors[i] }));
}

/* ─── ffmpeg synthesis recipes ────────────────────────────────────────────
   Each returns { args, durationSec, fileName }. All render 44.1kHz mono WAV.
   These are real synthesized sounds — the UI labels them "Synthesized". */

export interface SynthRecipe {
  args: string[];
  durationSec: number;
}

function wavOut(path: string): string[] {
  return ["-ar", "44100", "-ac", "1", "-c:a", "pcm_s16le", path];
}

/** Build the ffmpeg args that synthesize one sample. Pure function — tested. */
export function buildSynthArgs(
  type: Exclude<SampleTypeKey, "melody" | "bass">,
  outPath: string,
  variant: number,
): SynthRecipe {
  // variant seeds slight pitch/timbre differences so packs don't sound identical.
  const v = variant % 4;
  const detune = [0, 4, -3, 7][v];

  switch (type) {
    case "kick": {
      // Pitch-dropping sine 160→45Hz + click transient, 0.35s.
      const f0 = 160 + detune * 2;
      const dur = 0.35;
      return {
        durationSec: dur,
        args: [
          "-f", "lavfi",
          "-i", `aevalsrc='sin(2*PI*(${f0}-115*t/${dur})*t)*exp(-9*t)':d=${dur}:s=44100`,
          "-f", "lavfi",
          "-i", `aevalsrc='sin(2*PI*1800*t)*exp(-160*t)':d=0.02:s=44100`,
          "-filter_complex", "[0][1]amix=inputs=2:normalize=0,alimiter=limit=0.95",
          ...wavOut(outPath),
        ],
      };
    }
    case "snare": {
      // Noise burst + 190Hz body, 0.22s. afade gives a clean exp decay
      // (volume='exp(...)' expressions fail at filter init with NaN).
      const dur = 0.22;
      return {
        durationSec: dur,
        args: [
          "-f", "lavfi",
          "-i", `anoisesrc=d=${dur}:c=white:r=44100`,
          "-f", "lavfi",
          "-i", `sine=frequency=${190 + detune}:duration=${dur}`,
          "-filter_complex",
          `[0]highpass=f=1200,afade=t=out:st=0:d=${dur}:curve=exp[n];[1]volume=0.7,afade=t=out:st=0:d=0.15:curve=exp[b];[n][b]amix=inputs=2:normalize=0,alimiter=limit=0.95`,
          ...wavOut(outPath),
        ],
      };
    }
    case "clap": {
      // Three staggered noise bursts + tail, 0.3s.
      const dur = 0.3;
      return {
        durationSec: dur,
        args: [
          "-f", "lavfi",
          "-i", "anoisesrc=d=0.05:c=white:r=44100",
          "-f", "lavfi",
          "-i", "anoisesrc=d=0.05:c=white:r=44100",
          "-f", "lavfi",
          "-i", `anoisesrc=d=${dur}:c=white:r=44100`,
          "-filter_complex",
          `[1]adelay=45|45[d1];[2]adelay=95|95[d2];[0][d1][d2]amix=inputs=3:normalize=0,highpass=f=900,afade=t=out:st=0:d=${dur}:curve=exp,alimiter=limit=0.95`,
          ...wavOut(outPath),
        ],
      };
    }
    case "hihat": {
      // Short highpassed noise tick, 0.06s.
      const dur = 0.06;
      return {
        durationSec: dur,
        args: [
          "-f", "lavfi",
          "-i", `anoisesrc=d=${dur}:c=white:r=44100`,
          "-af", `highpass=f=${7500 + detune * 120},afade=t=out:st=0:d=${dur}:curve=exp,alimiter=limit=0.9`,
          ...wavOut(outPath),
        ],
      };
    }
    case "openhat": {
      // Longer sizzling noise, 0.35s.
      const dur = 0.35;
      return {
        durationSec: dur,
        args: [
          "-f", "lavfi",
          "-i", `anoisesrc=d=${dur}:c=white:r=44100`,
          "-af", `highpass=f=${7000 + detune * 120},afade=t=out:st=0:d=${dur}:curve=exp,alimiter=limit=0.9`,
          ...wavOut(outPath),
        ],
      };
    }
    case "perc": {
      // Short resonant blip, 0.12s — pitch varies by variant.
      const dur = 0.12;
      const freq = [880, 1174, 659, 1567][v];
      return {
        durationSec: dur,
        args: [
          "-f", "lavfi",
          "-i", `sine=frequency=${freq}:duration=${dur}`,
          "-af", `afade=t=out:st=0:d=${dur}:curve=exp,alimiter=limit=0.9`,
          ...wavOut(outPath),
        ],
      };
    }
    case "riser": {
      // 3s riser: swelling noise + rising sine sweep (200→2000Hz).
      // lowpass can't sweep its frequency, so the sweep carries the rise.
      const dur = 3;
      const f1 = 200 + detune * 10;
      const f2 = 2000 + detune * 40;
      return {
        durationSec: dur,
        args: [
          "-f", "lavfi",
          "-i", `anoisesrc=d=${dur}:c=white:r=44100`,
          "-f", "lavfi",
          "-i", `aevalsrc='0.4*sin(2*PI*(${f1}+${f2 - f1}*t/${dur})*t)':d=${dur}:s=44100`,
          "-filter_complex",
          `[0]lowpass=f=8000,afade=t=in:st=0:d=${dur - 0.2}:curve=tri[n];[1]afade=t=in:st=0:d=${dur - 0.2}:curve=tri[s];[n][s]amix=inputs=2:normalize=0,alimiter=limit=0.95`,
          ...wavOut(outPath),
        ],
      };
    }
    case "impact": {
      // 1.2s deep boom: 70→28Hz sine + filtered noise crash tail.
      const dur = 1.2;
      return {
        durationSec: dur,
        args: [
          "-f", "lavfi",
          "-i", `aevalsrc='sin(2*PI*(70-42*t/${dur})*t)*exp(-4.5*t)':d=${dur}:s=44100`,
          "-f", "lavfi",
          "-i", `anoisesrc=d=${dur}:c=white:r=44100`,
          "-filter_complex",
          `[1]volume=0.5,lowpass=f=900,afade=t=out:st=0:d=${dur}:curve=exp[n];[0][n]amix=inputs=2:normalize=0,alimiter=limit=0.98`,
          ...wavOut(outPath),
        ],
      };
    }
    case "downlifter": {
      // 2s downlifter: decaying noise + falling sine sweep (1800→150Hz).
      const dur = 2;
      const f1 = 1800 + detune * 40;
      const f2 = 150;
      return {
        durationSec: dur,
        args: [
          "-f", "lavfi",
          "-i", `anoisesrc=d=${dur}:c=white:r=44100`,
          "-f", "lavfi",
          "-i", `aevalsrc='0.4*sin(2*PI*(${f1}-${f1 - f2}*t/${dur})*t)':d=${dur}:s=44100`,
          "-filter_complex",
          `[0]lowpass=f=8000,afade=t=out:st=0:d=${dur}:curve=exp[n];[1]afade=t=out:st=0:d=${dur}:curve=exp[s];[n][s]amix=inputs=2:normalize=0,alimiter=limit=0.95`,
          ...wavOut(outPath),
        ],
      };
    }
  }
}

/** ElevenLabs Music prompt for an AI melody or bass loop. Pure — tested. */
export function buildLoopPrompt(
  kind: "melody" | "bass",
  genre: SampleGenre,
  bpm: number,
  musicalKey: string,
): string {
  const kindDesc = kind === "melody"
    ? "catchy melodic loop, lead synth and plucks"
    : "deep rolling bassline loop, sub and mid bass";
  return (
    `${genre} ${kindDesc}, ${bpm} BPM, key of ${musicalKey}, ` +
    `exactly 4 bars, seamless loop, no drums, no vocals, no FX, ` +
    `clean studio production, ends on the root note for easy looping`
  ).slice(0, 1000);
}

/** 4 bars in milliseconds at a given BPM — used for the AI loop length. */
export function fourBarsMs(bpm: number): number {
  return Math.round((240 / bpm) * 4 * 1000);
}

/** Human sample file name: "trap-kick-01.wav". Pure — tested. */
export function sampleFileName(
  genre: SampleGenre,
  type: SampleTypeKey,
  index: number,
): string {
  const n = String(index + 1).padStart(2, "0");
  return `${genre}-${type}-${n}.wav`;
}
