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
 * SSRF guard: only allow downloading stems from the project's own Supabase
 * storage host over HTTPS. Stems are always uploaded to that bucket, so any
 * other host is untrusted user input and must be rejected.
 */
export function isAllowedStemUrl(url: string): boolean {
  const base = process.env["SUPABASE_URL"];
  if (!base) return false;
  let allowedHost: string;
  try {
    allowedHost = new URL(base).host;
  } catch {
    return false;
  }
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  return u.protocol === "https:" && u.host === allowedHost;
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

/** Exposed for callers (e.g. a health check) that want to know before rendering. */
export async function isAutotuneAvailable(): Promise<boolean> {
  return (await findAutotalentPlugin()) !== null;
}

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

    /* Per-stem processing */
    const filterParts: string[] = [];
    const labels: string[] = [];
    stems.forEach((s, i) => {
      const vol = clampGain((s.volume ?? 100) / 100);
      const chain: string[] = [
        `[${i}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo`,
      ];
      const ts = Math.max(0, s.trimStart ?? 0);
      const te = Math.max(0, s.trimEnd ?? 0);
      const hasEnd = te > 0 && typeof s.durationSec === "number" && s.durationSec > ts + te;
      if (ts > 0 || hasEnd) {
        let atrim = `atrim=start=${ts.toFixed(3)}`;
        if (hasEnd) atrim += `:end=${(s.durationSec! - te).toFixed(3)}`;
        chain.push(atrim, "asetpts=PTS-STARTPTS");
      }
      /* Per-stem effect chain (autotune, EQ, reverb, delay, compression, saturation, etc.) */
      if (s.effects) {
        const { filters, autotuneSkipped: skipped } = buildStemEffectChain(s.effects, autotalentPath);
        chain.push(...filters);
        if (skipped) autotuneSkipped = true;
      }
      chain.push(`volume=${vol.toFixed(3)}`);
      /* Stereo pan after level so the balance is preserved. */
      const panFilter = buildPanFilter(s.pan ?? 0);
      if (panFilter) chain.push(panFilter);
      filterParts.push(`${chain.join(",")}[a${i}]`);
      labels.push(`[a${i}]`);
    });

    /* Master bus chain */
    const masterChain = masterSettings
      ? buildMasterBusChain(masterSettings)
      : `volume=${clampGain(masterVolume / 100).toFixed(3)},alimiter=limit=0.95`;

    let filter: string;
    if (labels.length === 1) {
      filter = `${filterParts[0]};${labels[0]}${masterChain}[out]`;
    } else {
      filter =
        filterParts.join(";") +
        ";" +
        `${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0[mix];` +
        `[mix]${masterChain}[out]`;
    }

    const out = join(work, `mix.${format}`);
    const codecArgs =
      format === "mp3" ? ["-c:a", "libmp3lame", "-q:a", "2"] : ["-c:a", "pcm_s16le"];
    const args = [
      "-y",
      ...inputs.flatMap((f) => ["-i", f]),
      "-filter_complex",
      filter,
      "-map",
      "[out]",
      ...(previewSeconds && previewSeconds > 0 ? ["-t", previewSeconds.toFixed(2)] : []),
      ...codecArgs,
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
