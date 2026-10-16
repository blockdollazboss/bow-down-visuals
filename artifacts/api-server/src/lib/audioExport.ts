import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, readdir, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type AudioExportType = "full-mp3" | "full-wav" | "instrumental-mp3" | "acapella-mp3";
export type AudioExportKind = "full" | "instrumental" | "acapella";

/** Per-stem processing chain, mirrors the frontend StemEffects model. */
export interface ExportStemEffects {
  /** EQ tone preset, see STEM_EQ_PRESETS: Off | Warm | Bright | Radio | Telephone | Boomy Cut | Air Boost. */
  eq: string;
  /** off | light | modern | heavy — real pitch correction via the Autotalent LADSPA plugin (see buildAutotuneFilter). */
  autotune: string;
  /** none | light | medium | heavy */
  reverb: string;
  /** none | light | medium | heavy */
  delay: string;
  /** off | low | medium | high */
  compression: string;
  /** off | low | medium | high */
  saturation: string;
  deEsser: boolean;
  noiseReduction: boolean;
}

export interface ExportStemInput {
  id: string;
  name: string;
  type: string;
  url: string;
  /** 0–100. */
  volume: number;
  muted: boolean;
  /** Mixer solo flag — when any stem is soloed, only soloed stems are rendered. */
  solo?: boolean;
  /** -100 (hard left) … 100 (hard right). 0 = centered. */
  pan?: number;
  /** Seconds trimmed off the start. */
  trimStart: number;
  /** Seconds trimmed off the end. */
  trimEnd: number;
  /** Total track length in seconds, when known (needed to honor trimEnd). */
  durationSec?: number;
  /** Per-stem effect chain (EQ, reverb, delay, compression, saturation, de-ess, denoise). */
  effects?: ExportStemEffects;
  /** Timeline placement, seconds (Stack 6 arrangement). Rendered via adelay
   *  AFTER trim/FX/automation so automation timestamps stay clip-local. */
  startTime?: number;
  /** Short per-segment fades, seconds (comp joins use 0.015). */
  fadeInSec?: number;
  fadeOutSec?: number;
  /** Parametric FX chain (Stack 6). When present and non-empty it REPLACES
   *  the legacy preset `effects` chain; step order is the render order. */
  fxChain?: ExportFxStep[];
  /** Breakpoint automation (Stack 6), times in ARRANGEMENT timeline
   *  seconds; the render shifts them clip-local by startTime. */
  automation?: ExportAutomation;
  /** In-arrangement sidechain ducking (Stack 6): this stem ducks against
   *  the mix of the named source stems, house-simple terms. */
  duck?: { sourceStemIds: string[]; amount: number; sensitivity: number };
}

/* ── Stack 6: parametric FX + automation shapes (mirror of the frontend
 *    lib/arrangement.ts model). ─────────────────────────────────────── */
export interface ExportFxBand {
  freq: number;
  gain: number;
  q: number;
}

export interface ExportFxStep {
  type: "eq" | "compressor" | "saturation" | "reverb" | "delay";
  enabled: boolean;
  bands?: ExportFxBand[];
  thresholdDb?: number;
  ratio?: number;
  attackMs?: number;
  releaseMs?: number;
  drive?: number;
  mix?: number;
  timeMs?: number;
  feedback?: number;
}

export interface ExportAutomationPoint {
  /** Arrangement timeline seconds. */
  time: number;
  value: number;
}

export interface ExportAutomation {
  /** Gain breakpoints, value 0–150 (%). */
  volume?: ExportAutomationPoint[];
  /** Pan breakpoints, value −100…100. */
  pan?: ExportAutomationPoint[];
  /** Wet-mix breakpoints (0–100 %) for the first enabled reverb step. */
  reverbMix?: ExportAutomationPoint[];
}

export class AudioExportError extends Error {
  code: string;
  status: number;
  stderr?: string;
  constructor(code: string, message: string, status: number, stderr?: string) {
    super(message);
    this.name = "AudioExportError";
    this.code = code;
    this.status = status;
    this.stderr = stderr;
  }
}

type StemRole = "lead" | "backing" | "adlib" | "beat" | "bass" | "drums" | "hats" | "melody" | "other";

/** Mirror of the frontend classifyStem heuristic (editor-settings.ts). */
export function classifyStemRole(type: string, name: string): StemRole {
  const t = `${type} ${name}`.toLowerCase();
  if (/ad[- ]?lib/.test(t)) return "adlib";
  if (/back|harmon|bgv/.test(t)) return "backing";
  if (/lead|vocal|vox|verse|hook|rap/.test(t)) return "lead";
  if (/808|bass|sub/.test(t)) return "bass";
  if (/hi[- ]?hat|hat/.test(t)) return "hats";
  if (/drum|perc|kick|snare/.test(t)) return "drums";
  if (/beat|instrument|full song/.test(t)) return "beat";
  if (/melod|synth|key|piano|guitar|string|pad/.test(t)) return "melody";
  return "other";
}

const INSTRUMENTAL_ROLES = new Set<StemRole>(["beat", "bass", "drums", "hats", "melody"]);
const VOCAL_ROLES = new Set<StemRole>(["lead", "backing", "adlib"]);

/** Pick the stems that belong in a given export, always excluding muted tracks. */
export function selectStemsForExport(stems: ExportStemInput[], kind: AudioExportKind): ExportStemInput[] {
  const unmuted = stems.filter((s) => !s.muted);
  if (kind === "full") {
    /* Honor solo on a full mix: if anything is soloed, only soloed stems play. */
    const soloed = unmuted.filter((s) => s.solo);
    return soloed.length > 0 ? soloed : unmuted;
  }
  if (kind === "instrumental") {
    return unmuted.filter((s) => INSTRUMENTAL_ROLES.has(classifyStemRole(s.type, s.name)));
  }
  return unmuted.filter((s) => VOCAL_ROLES.has(classifyStemRole(s.type, s.name)));
}

/** Max size we will download per stem to bound memory/DoS exposure. */
const MAX_STEM_BYTES = 200 * 1024 * 1024;
/**
 * Hard ceiling on a single FFmpeg render. The render now runs as a background
 * job (see routes/music-export.ts) rather than inline in the HTTP request, so
 * this only needs to protect against a truly runaway process — it is no
 * longer coupled to any proxy/HTTP request timeout. A full-length song with
 * many stems and heavy per-stem effect chains (autotune, reverb, etc.) can
 * legitimately take several minutes to render.
 */
const FFMPEG_TIMEOUT_MS = 10 * 60_000;

/**
 * SSRF guard: only allow downloading stems from the project's own storage
 * hosts over HTTPS — Supabase Storage (generated stems) and the R2 public
 * host (user uploads moved there; see lib/r2-client.ts). Any other host is
 * untrusted user input and must be rejected. Without the R2 host here,
 * stems a user uploads in the editor/arrangement could never export.
 */
export function isAllowedStemUrl(url: string): boolean {
  const bases = [process.env["SUPABASE_URL"], process.env["R2_PUBLIC_URL"]];
  const allowedHosts = new Set<string>();
  for (const base of bases) {
    if (!base) continue;
    try {
      allowedHosts.add(new URL(base).host);
    } catch {
      /* ignore malformed env */
    }
  }
  if (allowedHosts.size === 0) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === "https:" && allowedHosts.has(u.host);
}

let ffmpegAvailable: boolean | null = null;

export async function isFfmpegAvailable(): Promise<boolean> {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  ffmpegAvailable = await new Promise<boolean>((resolve) => {
    try {
      const proc = spawn("ffmpeg", ["-version"]);
      proc.on("error", () => resolve(false));
      proc.on("close", (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
  return ffmpegAvailable;
}

function clampGain(v: number): number {
  if (!Number.isFinite(v)) return 1;
  return Math.max(0, Math.min(4, v));
}

/**
 * Real pitch correction for `autotune` uses the Autotalent LADSPA plugin
 * (installed as a Nix system dependency). Stock FFmpeg has no built-in
 * pitch-quantization filter, but it does support loading LADSPA plugins via
 * the `ladspa` audio filter, so we drive Autotalent through that.
 *
 * The plugin ships at a hashed Nix store path, so we resolve it at runtime
 * (once, then cache) instead of hardcoding a path that can change between
 * environments/builds.
 */
let autotalentPluginPath: string | null | undefined;

async function findAutotalentPlugin(): Promise<string | null> {
  if (autotalentPluginPath !== undefined) return autotalentPluginPath;

  const candidates: string[] = [];
  const envPath = process.env["LADSPA_PATH"];
  if (envPath) {
    for (const dir of envPath.split(":")) {
      if (dir) candidates.push(join(dir, "autotalent.so"));
    }
  }
  try {
    const entries = await readdir("/nix/store");
    for (const entry of entries) {
      if (/^[a-z0-9]+-autotalent-[\d.]+$/.test(entry)) {
        candidates.push(join("/nix/store", entry, "lib", "ladspa", "autotalent.so"));
      }
    }
  } catch {
    /* /nix/store not present (non-Nix environment) — fall through with whatever we have. */
  }

  for (const candidate of candidates) {
    try {
      await access(candidate);
      autotalentPluginPath = candidate;
      return candidate;
    } catch {
      /* try next candidate */
    }
  }
  autotalentPluginPath = null;
  return null;
}

/* Removed 2026-10-10: isAutotuneAvailable was dead (zero imports). */

const AUTOTUNE_LEVELS: Record<string, { strength: number; smoothness: number } | undefined> = {
  /* Light touch — corrects obvious pitch drift but keeps natural inflection. */
  light: { strength: 0.35, smoothness: 0.45 },
  /* Noticeable, characteristic "modern" pop/rap tightness. */
  modern: { strength: 0.7, smoothness: 0.15 },
  /* Instant, robotic snap-to-pitch (the classic hard-tune sound). */
  heavy: { strength: 1.0, smoothness: 0 },
};

/**
 * Build the FFmpeg `ladspa` filter invocation that drives Autotalent.
 * We don't know the song's key, so all 12 semitones are enabled (chromatic
 * correction to the nearest note) rather than a diatonic scale.
 */
function buildAutotuneFilter(level: string, pluginPath: string): string | null {
  const cfg = AUTOTUNE_LEVELS[level];
  if (!cfg) return null;
  const controls = [
    440, 0, 0, /* c0 concert A, c1 fixed pitch, c2 pull-to-fixed-pitch */
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, /* c3-c14: A Bb B C Db D Eb E F Gb G Ab — all enabled (chromatic) */
    cfg.strength, cfg.smoothness, /* c15 correction strength, c16 correction smoothness */
    0, 0, /* c17 pitch shift, c18 output scale rotate */
    0, 5, 0, 0, 0, /* c19-c23 LFO (disabled) */
    0, 0, /* c24 formant correction, c25 formant warp */
    1, /* c26 mix (fully wet) */
  ].join("|");
  return `ladspa=file=${pluginPath}:plugin=autotalent:controls=${controls}`;
}

async function downloadStem(url: string, dest: string): Promise<void> {
  if (!isAllowedStemUrl(url)) {
    throw new AudioExportError("invalid_stem_url", "A stem file came from an untrusted source.", 400);
  }
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new AudioExportError("stem_download_failed", "A stem file could not be downloaded.", 502);
  }
  if (!res.ok || !res.body) {
    throw new AudioExportError("stem_download_failed", "A stem file could not be downloaded.", 502);
  }
  const declared = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_STEM_BYTES) {
    throw new AudioExportError("stem_download_failed", "A stem file is too large to export.", 502);
  }
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_STEM_BYTES) {
      await reader.cancel().catch(() => {});
      throw new AudioExportError("stem_download_failed", "A stem file is too large to export.", 502);
    }
    chunks.push(Buffer.from(value));
  }
  await writeFile(dest, Buffer.concat(chunks));
}

export interface MixResult {
  buffer: Buffer;
  contentType: string;
  ext: "mp3" | "wav";
  /** Non-fatal issues encountered while rendering, e.g. autotune unavailable. */
  warnings: string[];
}

/** Full master-bus settings sent from the client. */
export interface MasterBusSettings {
  /** 0–100 overall output gain. */
  volume: number;
  /** 0–100 bus compression amount (0 = bypass). */
  compression: number;
  /** 0–100 stereo width (50 = unchanged, 0 = mono, 100 = max wide). */
  stereoWidth: number;
  /** 0–100 low-end boost (0 = none). */
  bassBoost: number;
  /** EQ colour: "dark" | "balanced" | "bright" */
  eqTone: string;
  /** Integrated loudness target: "demo" | "streaming" | "loud" */
  loudnessTarget: string;
  /** Hard limiter on the master bus. */
  limiter: boolean;
  /** 1.5 s fade-in applied to the rendered output. */
  fadeIn: boolean;
  /** 1.5 s fade-out applied to the rendered output (reverse trick — no duration needed). */
  fadeOut: boolean;
}

/**
 * Build a comma-separated FFmpeg audio filter chain for the master bus.
 * Input comes from either the single stem label or the amix output [mix].
 */
function buildMasterBusChain(s: MasterBusSettings): string {
  const parts: string[] = [];

  /* Master volume */
  const vol = clampGain(s.volume / 100);
  parts.push(`volume=${vol.toFixed(3)}`);

  /* Bus compression (skip at 0) */
  if (s.compression > 0) {
    const ratio  = (1 + (s.compression / 100) * 9).toFixed(1);  // 1.0–10.0
    const thresh = (0.5 - (s.compression / 100) * 0.3).toFixed(2); // 0.50–0.20
    parts.push(`acompressor=threshold=${thresh}:ratio=${ratio}:attack=5:release=100:knee=3`);
  }

  /* EQ tone */
  if (s.eqTone === "dark") {
    parts.push("equalizer=f=120:t=o:w=1:g=3", "equalizer=f=8000:t=o:w=1:g=-2");
  } else if (s.eqTone === "bright") {
    parts.push("equalizer=f=8000:t=o:w=1:g=3", "equalizer=f=120:t=o:w=1:g=-2");
  }

  /* Bass boost */
  if (s.bassBoost > 0) {
    const gain = ((s.bassBoost / 100) * 10).toFixed(1); // 0–10 dB
    parts.push(`bass=g=${gain}`);
  }

  /* Stereo width — skip at 50 (factor 1.00 = unchanged) */
  if (s.stereoWidth !== 50) {
    const m = (s.stereoWidth / 50).toFixed(2); // 0.00–2.00, 1.00 = neutral
    parts.push(`extrastereo=m=${m}`);
  }

  /* Loudness normalisation */
  const lufs = s.loudnessTarget === "demo" ? -14 : s.loudnessTarget === "loud" ? -6 : -9;
  parts.push(`loudnorm=I=${lufs}:TP=-1:LRA=11`);

  /* Hard limiter */
  if (s.limiter !== false) {
    parts.push("alimiter=limit=0.95:attack=5:release=50");
  }

  /* Fade in */
  if (s.fadeIn) {
    parts.push("afade=t=in:st=0:d=1.5");
  }

  /* Fade out — reverse → fade-in → re-reverse works without knowing duration */
  if (s.fadeOut) {
    parts.push("areverse", "afade=t=in:st=0:d=1.5", "areverse");
  }

  return parts.join(",");
}

/**
 * Build the FFmpeg filters for a single stem's effect chain (autotune, EQ,
 * reverb, delay, compression, saturation, de-ess, denoise). Runs on a
 * stereo/48k stream.
 *
 * Returns `autotuneSkipped: true` when the caller asked for pitch correction
 * but the Autotalent plugin could not be located, so the render can proceed
 * (no crash) while the API surfaces a clear warning to the client.
 */
function buildStemEffectChain(
  fx: ExportStemEffects,
  autotalentPath: string | null,
): { filters: string[]; autotuneSkipped: boolean } {
  const parts: string[] = [];
  let autotuneSkipped = false;

  /* Noise reduction first so later stages don't amplify hiss. */
  if (fx.noiseReduction) parts.push("afftdn=nf=-25");

  /* Pitch correction — run before EQ/compression/reverb so pitch detection
     sees a clean, uncoloured signal. */
  if (fx.autotune && fx.autotune !== "off") {
    if (autotalentPath) {
      const autotuneFilter = buildAutotuneFilter(fx.autotune, autotalentPath);
      if (autotuneFilter) parts.push(autotuneFilter);
    } else {
      autotuneSkipped = true;
    }
  }

  /* EQ tone preset */
  switch (fx.eq) {
    case "Warm":
      parts.push("equalizer=f=120:t=o:w=1:g=3", "equalizer=f=8000:t=o:w=1:g=-2");
      break;
    case "Bright":
      parts.push("equalizer=f=8000:t=o:w=1:g=3", "equalizer=f=120:t=o:w=1:g=-2");
      break;
    case "Radio":
      parts.push("highpass=f=150", "lowpass=f=6000", "equalizer=f=2500:t=o:w=1.5:g=4");
      break;
    case "Telephone":
      parts.push("highpass=f=400", "lowpass=f=3000");
      break;
    case "Boomy Cut":
      parts.push("highpass=f=60", "equalizer=f=250:t=o:w=1:g=-4");
      break;
    case "Air Boost":
      parts.push("treble=g=4:f=10000");
      break;
    /* "Off" / unknown → no EQ */
  }

  /* De-esser */
  if (fx.deEsser) parts.push("deesser=i=0.5");

  /* Compression */
  if (fx.compression === "low") {
    parts.push("acompressor=threshold=0.3:ratio=2:attack=10:release=150:knee=3");
  } else if (fx.compression === "medium") {
    parts.push("acompressor=threshold=0.2:ratio=4:attack=5:release=120:knee=3");
  } else if (fx.compression === "high") {
    parts.push("acompressor=threshold=0.125:ratio=6:attack=3:release=100:knee=3");
  }

  /* Saturation — gentle drive into a soft clipper (loudnorm on the master
     bus rebalances the extra gain so this stays a colour, not a level bump). */
  if (fx.saturation === "low") {
    parts.push("volume=1.3", "asoftclip=type=tanh");
  } else if (fx.saturation === "medium") {
    parts.push("volume=1.8", "asoftclip=type=tanh");
  } else if (fx.saturation === "high") {
    parts.push("volume=2.5", "asoftclip=type=tanh");
  }

  /* Reverb (short room) */
  if (fx.reverb === "light") {
    parts.push("aecho=0.8:0.7:40:0.2");
  } else if (fx.reverb === "medium") {
    parts.push("aecho=0.8:0.8:60:0.35");
  } else if (fx.reverb === "heavy") {
    parts.push("aecho=0.8:0.9:90:0.5");
  }

  /* Delay (slap / echo, longer taps) */
  if (fx.delay === "light") {
    parts.push("aecho=0.8:0.5:120:0.2");
  } else if (fx.delay === "medium") {
    parts.push("aecho=0.8:0.6:250:0.3");
  } else if (fx.delay === "heavy") {
    parts.push("aecho=0.8:0.7:400:0.4");
  }

  return { filters: parts, autotuneSkipped };
}

/** Stereo balance filter for a -100..100 pan value (0 = centered). */
function buildPanFilter(pan: number): string | null {
  if (!Number.isFinite(pan) || pan === 0) return null;
  const p = Math.max(-100, Math.min(100, pan));
  const lg = (p <= 0 ? 1 : 1 - p / 100).toFixed(3);
  const rg = (p >= 0 ? 1 : 1 + p / 100).toFixed(3);
  return `pan=stereo|c0=${lg}*c0|c1=${rg}*c1`;
}

/* ── Stack 6: automation → FFmpeg expressions ──────────────────────────
 * A breakpoint lane becomes a piecewise-linear `volume='…':eval=frame`
 * expression. Points are pre-mapped to the filter's value space by the
 * caller (gain for volume, per-channel gains for pan) and pre-shifted to
 * clip-local time. The expression holds the first value before the first
 * breakpoint and the last value after the last — the same semantics as the
 * frontend automationValueAt, so preview and render agree. */

export function fmtNum(v: number): string {
  const n = Math.round(v * 10000) / 10000;
  return Object.is(n, -0) ? "0" : String(n);
}

/** Piecewise-linear ffmpeg expression over `t` for mapped points. */
export function buildAutomationExpression(points: ExportAutomationPoint[]): string {
  const pts = [...points]
    .filter((p) => Number.isFinite(p.time) && Number.isFinite(p.value))
    .sort((a, b) => a.time - b.time)
    .filter((p, i, arr) => i === 0 || p.time > arr[i - 1]!.time);
  if (pts.length === 0) return "1";
  if (pts.length === 1) return fmtNum(pts[0]!.value);
  let expr = fmtNum(pts[pts.length - 1]!.value);
  for (let i = pts.length - 2; i >= 0; i--) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const lerp = `${fmtNum(a.value)}+(${fmtNum(b.value)}-(${fmtNum(a.value)}))*(t-${fmtNum(a.time)})/${fmtNum(b.time - a.time)}`;
    expr = `if(lt(t,${fmtNum(b.time)}),${lerp},${expr})`;
  }
  return `if(lt(t,${fmtNum(pts[0]!.time)}),${fmtNum(pts[0]!.value)},${expr})`;
}

/** Shift timeline breakpoints to clip-local time for a clip at startTime. */
export function shiftPoints(
  points: ExportAutomationPoint[] | undefined,
  startTime: number,
): ExportAutomationPoint[] {
  if (!points) return [];
  return points.map((p) => ({ time: p.time - startTime, value: p.value }));
}

/** Volume lane (%) → gain expression filter fragment. */
export function buildVolumeAutomationFilter(
  points: ExportAutomationPoint[] | undefined,
  startTime: number,
): string | null {
  const shifted = shiftPoints(points, startTime);
  if (shifted.length === 0) return null;
  const mapped = shifted.map((p) => ({
    time: p.time,
    value: Math.max(0, Math.min(150, p.value)) / 100,
  }));
  return `volume='${buildAutomationExpression(mapped)}':eval=frame`;
}

/* ── Stack 6: parametric FX chain → FFmpeg graph ─────────────────────────
 * Steps render IN ARRAY ORDER (the user's chain order). Most steps are
 * plain comma-chain fragments; a reverb step needs a wet/dry split (labels)
 * so its mix — including reverb-mix automation — is a real wet-branch gain.
 * The builder therefore works on labelled graph parts: fragments collect
 * in `pending` and flush to a fresh label whenever a labelled step (or the
 * pan-automation channelsplit) needs one. */

export interface StemGraphResult {
  parts: string[];
  outLabel: string;
  autotuneSkipped: boolean;
}

const clampFx = (v: number | undefined, lo: number, hi: number, dflt: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt;

export function buildParametricFxGraph(opts: {
  inputLabel: string;
  chain: ExportFxStep[];
  automation?: ExportAutomation;
  startTime: number;
  labelPrefix: string;
}): { parts: string[]; outLabel: string } {
  const parts: string[] = [];
  let pending: string[] = [];
  let cur = opts.inputLabel;
  let n = 0;
  const freshLabel = () => `${opts.labelPrefix}f${n++}`;
  const flush = (): string => {
    if (pending.length === 0) return cur;
    const next = freshLabel();
    parts.push(`[${cur}]${pending.join(",")}[${next}]`);
    pending = [];
    cur = next;
    return cur;
  };

  let reverbAutomated = false;
  for (const step of opts.chain) {
    if (!step || step.enabled === false) continue;
    switch (step.type) {
      case "eq": {
        for (const band of step.bands ?? []) {
          const gain = clampFx(band.gain, -24, 24, 0);
          if (Math.abs(gain) < 0.01) continue;
          const freq = clampFx(band.freq, 20, 20000, 1000);
          const q = clampFx(band.q, 0.3, 12, 1);
          pending.push(`equalizer=f=${fmtNum(freq)}:t=q:w=${fmtNum(q)}:g=${fmtNum(gain)}`);
        }
        break;
      }
      case "compressor": {
        const threshold = Math.pow(10, clampFx(step.thresholdDb, -60, 0, -18) / 20);
        const ratio = clampFx(step.ratio, 1, 20, 3);
        const attack = clampFx(step.attackMs, 0.1, 500, 10);
        const release = clampFx(step.releaseMs, 10, 1000, 150);
        pending.push(
          `acompressor=threshold=${fmtNum(threshold)}:ratio=${fmtNum(ratio)}:attack=${fmtNum(attack)}:release=${fmtNum(release)}:knee=3`,
        );
        break;
      }
      case "saturation": {
        const drive = clampFx(step.drive, 1, 3, 1.5);
        pending.push(`volume=${fmtNum(drive)}`, "asoftclip=type=tanh");
        break;
      }
      case "delay": {
        const timeMs = Math.round(clampFx(step.timeMs, 10, 2000, 250));
        const feedback = clampFx(step.feedback, 0, 80, 30);
        const mix = clampFx(step.mix, 0, 100, 20);
        const decay = Math.min(0.85, 0.25 + feedback / 100);
        const wet = Math.min(0.6, (mix / 100) * 0.7);
        pending.push(`aecho=0.8:${fmtNum(decay)}:${timeMs}:${fmtNum(wet)}`);
        break;
      }
      case "reverb": {
        /* Wet/dry split so the mix is a true wet-branch gain — the one FX
         * parameter automation can drive truthfully in both engines. */
        const from = flush();
        const dry = `${opts.labelPrefix}dry${n}`;
        const wetIn = `${opts.labelPrefix}wet${n}`;
        const wetOut = `${opts.labelPrefix}wetg${n}`;
        const out = freshLabel();
        parts.push(`[${from}]asplit=2[${dry}][${wetIn}]`);
        let wetGain: string;
        const autoPts = !reverbAutomated ? opts.automation?.reverbMix : undefined;
        if (autoPts && autoPts.length > 0) {
          reverbAutomated = true;
          const mapped = shiftPoints(autoPts, opts.startTime).map((p) => ({
            time: p.time,
            value: clampFx(p.value, 0, 100, 25) / 100,
          }));
          wetGain = `volume='${buildAutomationExpression(mapped)}':eval=frame`;
        } else {
          wetGain = `volume=${fmtNum(clampFx(step.mix, 0, 100, 25) / 100)}`;
        }
        parts.push(`[${wetIn}]aecho=0.8:0.9:60:0.4,${wetGain}[${wetOut}]`);
        parts.push(`[${dry}][${wetOut}]amix=inputs=2:duration=first:normalize=0[${out}]`);
        cur = out;
        break;
      }
    }
  }
  flush();
  return { parts, outLabel: cur };
}

/**
 * Pan automation needs per-channel gains — a channelsplit, one automated
 * volume per channel, then a merge. Pan value p maps to channel gains
 * exactly like the static buildPanFilter (linear-in-pan at breakpoints;
 * the per-channel gains are then lerped, which the preview mirrors by
 * automating the panner's own value — mid-segment curves may differ by a
 * hair, endpoints and breakpoints are exact).
 */
export function buildPanAutomationGraph(opts: {
  inputLabel: string;
  points: ExportAutomationPoint[];
  startTime: number;
  labelPrefix: string;
}): { parts: string[]; outLabel: string } {
  const shifted = shiftPoints(opts.points, opts.startTime);
  const toGains = (pan: number) => {
    const p = Math.max(-100, Math.min(100, pan));
    return { l: p <= 0 ? 1 : 1 - p / 100, r: p >= 0 ? 1 : 1 + p / 100 };
  };
  const left = shifted.map((p) => ({ time: p.time, value: toGains(p.value).l }));
  const right = shifted.map((p) => ({ time: p.time, value: toGains(p.value).r }));
  const L = `${opts.labelPrefix}panL`;
  const R = `${opts.labelPrefix}panR`;
  const Lg = `${opts.labelPrefix}panLg`;
  const Rg = `${opts.labelPrefix}panRg`;
  const out = `${opts.labelPrefix}panOut`;
  return {
    parts: [
      `[${opts.inputLabel}]channelsplit=channel_layout=stereo[${L}][${R}]`,
      `[${L}]volume='${buildAutomationExpression(left)}':eval=frame[${Lg}]`,
      `[${R}]volume='${buildAutomationExpression(right)}':eval=frame[${Rg}]`,
      `[${Lg}][${Rg}]join=inputs=2:channel_layout=stereo[${out}]`,
    ],
    outLabel: out,
  };
}

/* ── Stack 6: in-arrangement ducking ─────────────────────────────────────
 * Same house-simple mapping as routes/generate/ducking-filter.ts (which
 * serves the standalone /duck-audio mix and the video export pre-pass):
 *   threshold  = 0.08 − sensitivity × 0.0007
 *   ratio      = 2 + amount × 0.18
 *   musicLevel = 1 − amount × 0.004
 * attack/release keep the proven 200ms / 500ms. */
export function arrangementDuckingParams(amount: number, sensitivity: number): {
  threshold: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  musicLevel: number;
} {
  const a = clampFx(amount, 0, 100, 60);
  const s = clampFx(sensitivity, 0, 100, 50);
  return {
    threshold: Math.round((0.08 - s * 0.0007) * 10000) / 10000,
    ratio: Math.round((2 + a * 0.18) * 100) / 100,
    attackMs: 200,
    releaseMs: 500,
    musicLevel: Math.round((1 - a * 0.004) * 1000) / 1000,
  };
}

/**
 * Download the given stems, mix them with FFmpeg honoring per-stem volume, pan,
 * trim and effects plus the master bus settings, and return the rendered audio
 * as a buffer.
 */
export async function runMixExport(opts: {
  stems: ExportStemInput[];
  masterVolume: number;
  format: "mp3" | "wav";
  masterSettings?: MasterBusSettings;
  /**
   * When set, truncates the rendered output to this many seconds. Used for
   * the "true render" preview clip so it renders near-instantly instead of
   * processing the whole song. `-t` is applied on the output, so FFmpeg
   * stops encoding (and reading input) once it hits this duration.
   */
  previewSeconds?: number;
}): Promise<MixResult> {
  const { stems, masterVolume, format, masterSettings, previewSeconds } = opts;
  const work = await mkdtemp(join(tmpdir(), "bdv-export-"));
  try {
    const inputs: string[] = [];
    for (let i = 0; i < stems.length; i++) {
      const dest = join(work, `in${i}`);
      await downloadStem(stems[i]!.url, dest);
      inputs.push(dest);
    }

    const wantsAutotune = stems.some((s) => s.effects?.autotune && s.effects.autotune !== "off");
    const autotalentPath = wantsAutotune ? await findAutotalentPlugin() : null;
    let autotuneSkipped = false;

    /* Per-stem processing. Each stem becomes a labelled sub-graph:
     * source → trim → fades → FX (parametric chain when present, else the
     * legacy preset chain) → fader volume → volume automation → pan
     * (static, or the pan-automation channelsplit when a lane exists) →
     * adelay placement. Automation runs BEFORE adelay on clip-local
     * timestamps (asetpts reset), so lanes stay truthful at any offset. */
    const filterParts: string[] = [];
    const labels: string[] = [];
    stems.forEach((s, i) => {
      const vol = clampGain((s.volume ?? 100) / 100);
      const startTime = Math.max(0, s.startTime ?? 0);
      const head: string[] = [
        `[${i}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo`,
      ];
      const ts = Math.max(0, s.trimStart ?? 0);
      const te = Math.max(0, s.trimEnd ?? 0);
      const hasEnd = te > 0 && typeof s.durationSec === "number" && s.durationSec > ts + te;
      if (ts > 0 || hasEnd) {
        let atrim = `atrim=start=${ts.toFixed(3)}`;
        if (hasEnd) atrim += `:end=${(s.durationSec! - te).toFixed(3)}`;
        head.push(atrim, "asetpts=PTS-STARTPTS");
      }
      /* Per-segment fades (comp joins). Fade-out uses the reverse trick so
       * it never needs the post-trim duration. */
      const fadeIn = Math.max(0, s.fadeInSec ?? 0);
      const fadeOut = Math.max(0, s.fadeOutSec ?? 0);
      if (fadeIn > 0) head.push(`afade=t=in:st=0:d=${fadeIn.toFixed(3)}`);
      if (fadeOut > 0) head.push("areverse", `afade=t=in:st=0:d=${fadeOut.toFixed(3)}`, "areverse");
      let cur = `s${i}p0`;
      filterParts.push(`${head.join(",")}[${cur}]`);

      const hasParametric = Array.isArray(s.fxChain) && s.fxChain.length > 0;
      if (hasParametric) {
        const g = buildParametricFxGraph({
          inputLabel: cur,
          chain: s.fxChain!,
          automation: s.automation,
          startTime,
          labelPrefix: `s${i}`,
        });
        filterParts.push(...g.parts);
        cur = g.outLabel;
      } else if (s.effects) {
        const { filters, autotuneSkipped: skipped } = buildStemEffectChain(s.effects, autotalentPath);
        if (skipped) autotuneSkipped = true;
        if (filters.length > 0) {
          const next = `s${i}p1`;
          filterParts.push(`[${cur}]${filters.join(",")}[${next}]`);
          cur = next;
        }
      }

      /* Fader + automation + pan. A pan lane REPLACES the static pan (the
       * lane's value is the pan); the volume lane multiplies the fader. */
      const tail: string[] = [`volume=${vol.toFixed(3)}`];
      const volAuto = buildVolumeAutomationFilter(s.automation?.volume, startTime);
      if (volAuto) tail.push(volAuto);
      const panAutoPts = s.automation?.pan?.length ? s.automation.pan : undefined;
      if (!panAutoPts) {
        const panFilter = buildPanFilter(s.pan ?? 0);
        if (panFilter) tail.push(panFilter);
      }
      const tailLabel = `s${i}p2`;
      filterParts.push(`[${cur}]${tail.join(",")}[${tailLabel}]`);
      cur = tailLabel;
      if (panAutoPts) {
        const g = buildPanAutomationGraph({
          inputLabel: cur,
          points: panAutoPts,
          startTime,
          labelPrefix: `s${i}`,
        });
        filterParts.push(...g.parts);
        cur = g.outLabel;
      }

      /* Timeline placement LAST so clip-local automation stays truthful. */
      if (startTime > 0) {
        const ms = Math.round(startTime * 1000);
        const placed = `a${i}`;
        filterParts.push(`[${cur}]adelay=${ms}|${ms}[${placed}]`);
        cur = placed;
      }
      labels.push(cur);
    });

    /* ── In-arrangement ducking (Stack 6 #6) ─────────────────────────────
     * Source stems are split: one copy stays in the mix, one feeds the
     * sidechain. Each target stem is levelled (musicLevel) then run
     * through sidechaincompress against its group's feed. */
    const finalLabels = [...labels];
    const duckTargets = stems
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.duck && s.duck.sourceStemIds.length > 0);
    if (duckTargets.length > 0) {
      const indexById = new Map(stems.map((s, i) => [s.id, i]));
      /* group key → { sources: Set<stemIndex>, targets: stemIndex[] } */
      const groups = new Map<string, { sources: Set<number>; targets: number[] }>();
      for (const { s, i } of duckTargets) {
        const srcIdx = s.duck!.sourceStemIds
          .map((id) => indexById.get(id))
          .filter((v): v is number => typeof v === "number" && v !== i);
        if (srcIdx.length === 0) continue;
        const key = [...srcIdx].sort((a, b) => a - b).join(",");
        const g = groups.get(key) ?? { sources: new Set<number>(), targets: [] };
        srcIdx.forEach((v) => g.sources.add(v));
        g.targets.push(i);
        groups.set(key, g);
      }
      /* Split every source stem: main copy + one feed copy per group. */
      const groupsArr = [...groups.entries()];
      const splitCount = new Map<number, number>();
      groupsArr.forEach(([, g]) => {
        g.sources.forEach((si) => splitCount.set(si, (splitCount.get(si) ?? 0) + 1));
      });
      const feedCopies = new Map<string, string>(); // `${groupIdx}:${stemIdx}` → label
      for (const [si, count] of splitCount.entries()) {
        const outs = [`${labels[si]}M`, ...Array.from({ length: count }, (_, k) => `${labels[si]}S${k}`)];
        filterParts.push(
          `[${labels[si]}]asplit=${outs.length}${outs.map((o) => `[${o}]`).join("")}`,
        );
        finalLabels[si] = outs[0]!;
        let k = 0;
        groupsArr.forEach(([key, g], gi) => {
          if (g.sources.has(si)) {
            feedCopies.set(`${gi}:${si}`, outs[1 + k]!);
            k++;
          }
          void key;
        });
      }
      groupsArr.forEach(([, g], gi) => {
        const srcLabels = [...g.sources].map((si) => feedCopies.get(`${gi}:${si}`)!).filter(Boolean);
        if (srcLabels.length === 0) return;
        let feed: string;
        if (srcLabels.length === 1) {
          feed = srcLabels[0]!;
        } else {
          feed = `duckFeed${gi}`;
          filterParts.push(
            `${srcLabels.map((l) => `[${l}]`).join("")}amix=inputs=${srcLabels.length}:duration=longest:normalize=0[${feed}]`,
          );
        }
        /* Pad the feed: sidechaincompress stops when its sidechain input
         * ends, and the source (e.g. a vocal) is often shorter than a
         * delayed target stem — apad makes the feed outlive every target
         * while the audible mix stays bounded by the real stems. */
        const paddedFeed = `duckFeedPad${gi}`;
        filterParts.push(`[${feed}]apad[${paddedFeed}]`);
        feed = paddedFeed;
        /* One feed copy per target. */
        const targetFeeds = g.targets.map((_, ti) => `duckSc${gi}x${ti}`);
        if (g.targets.length === 1) {
          targetFeeds[0] = feed;
        } else {
          filterParts.push(
            `[${feed}]asplit=${g.targets.length}${targetFeeds.map((l) => `[${l}]`).join("")}`,
          );
        }
        g.targets.forEach((ti, k) => {
          const params = arrangementDuckingParams(
            stems[ti]!.duck!.amount,
            stems[ti]!.duck!.sensitivity,
          );
          const leveled = `duckLvl${gi}x${k}`;
          const ducked = `duckOut${gi}x${k}`;
          filterParts.push(`[${finalLabels[ti]}]volume=${fmtNum(params.musicLevel)}[${leveled}]`);
          filterParts.push(
            `[${leveled}][${targetFeeds[k]}]sidechaincompress=threshold=${fmtNum(params.threshold)}:ratio=${fmtNum(params.ratio)}:attack=${params.attackMs}:release=${params.releaseMs}[${ducked}]`,
          );
          finalLabels[ti] = ducked;
        });
      });
    }
    const mixLabels = finalLabels.map((l) => `[${l}]`);

    /* Master bus chain */
    const masterChain = masterSettings
      ? buildMasterBusChain(masterSettings)
      : `volume=${clampGain(masterVolume / 100).toFixed(3)},alimiter=limit=0.95`;

    let filter: string;
    if (mixLabels.length === 1) {
      filter = filterParts.join(";") + ";" + `${mixLabels[0]}${masterChain}[out]`;
    } else {
      filter =
        filterParts.join(";") +
        ";" +
        `${mixLabels.join("")}amix=inputs=${mixLabels.length}:duration=longest:normalize=0[mix];` +
        `[mix]${masterChain}[out]`;
    }

    const out = join(work, `mix.${format}`);
    const codecArgs =
      format === "mp3" ? ["-c:a", "libmp3lame", "-q:a", "2"] : ["-c:a", "pcm_s16le"];
    /* Virality: passive attribution metadata on every mix export — invisible
       ID3 tags (publisher + site) that ride with the file anywhere it's
       posted. Honest, no brand clash, no audible change. */
    const attributionArgs = [
      "-metadata", "publisher=Bow Down Visuals",
      "-metadata", "website=https://bowdownvisuals.com",
      "-metadata", "comment=Created with Bow Down Visuals — bowdownvisuals.com",
    ];
    const args = [
      "-y",
      ...inputs.flatMap((f) => ["-i", f]),
      "-filter_complex",
      filter,
      "-map",
      "[out]",
      ...(previewSeconds && previewSeconds > 0 ? ["-t", previewSeconds.toFixed(2)] : []),
      ...codecArgs,
      ...attributionArgs,
      out,
    ];

    await runFfmpeg(args);
    const buffer = await readFile(out);
    return {
      buffer,
      ext: format,
      contentType: format === "mp3" ? "audio/mpeg" : "audio/wav",
      warnings: autotuneSkipped
        ? ["Vocal tuning was requested but is unavailable on this server right now, so the mix was rendered without it."]
        : [],
    };
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args);
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGKILL");
    }, FFMPEG_TIMEOUT_MS);
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
    });
    proc.on("error", () => {
      clearTimeout(timer);
      reject(new AudioExportError("export_failed", "Audio export failed.", 500));
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else if (timedOut) {
        reject(
          new AudioExportError(
            "export_timeout",
            `The render is taking longer than ${Math.round(FFMPEG_TIMEOUT_MS / 60_000)} minutes and was stopped. ` +
              "Try exporting fewer stems, turning off heavy per-stem effects (reverb/delay/autotune), or a shorter section of the song.",
            500,
          ),
        );
      } else reject(new AudioExportError("export_failed", "Audio export failed.", 500, stderr));
    });
  });
}
