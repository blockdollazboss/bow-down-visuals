import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type AudioExportType = "full-mp3" | "full-wav" | "instrumental-mp3" | "acapella-mp3";
export type AudioExportKind = "full" | "instrumental" | "acapella";

export interface ExportStemInput {
  id: string;
  name: string;
  type: string;
  url: string;
  /** 0–100. */
  volume: number;
  muted: boolean;
  /** Seconds trimmed off the start. */
  trimStart: number;
  /** Seconds trimmed off the end. */
  trimEnd: number;
  /** Total track length in seconds, when known (needed to honor trimEnd). */
  durationSec?: number;
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
  if (kind === "full") return unmuted;
  if (kind === "instrumental") {
    return unmuted.filter((s) => INSTRUMENTAL_ROLES.has(classifyStemRole(s.type, s.name)));
  }
  return unmuted.filter((s) => VOCAL_ROLES.has(classifyStemRole(s.type, s.name)));
}

/** Max size we will download per stem to bound memory/DoS exposure. */
const MAX_STEM_BYTES = 200 * 1024 * 1024;
/** Hard ceiling on a single FFmpeg render. */
const FFMPEG_TIMEOUT_MS = 180_000;

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
}

/**
 * Download the given stems, mix them with FFmpeg honoring per-stem volume +
 * trim and the master volume, and return the rendered audio as a buffer.
 */
export async function runMixExport(opts: {
  stems: ExportStemInput[];
  masterVolume: number;
  format: "mp3" | "wav";
}): Promise<MixResult> {
  const { stems, masterVolume, format } = opts;
  const work = await mkdtemp(join(tmpdir(), "bdv-export-"));
  try {
    const inputs: string[] = [];
    for (let i = 0; i < stems.length; i++) {
      const dest = join(work, `in${i}`);
      await downloadStem(stems[i]!.url, dest);
      inputs.push(dest);
    }

    const master = clampGain(masterVolume / 100);
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
      chain.push(`volume=${vol.toFixed(3)}`);
      filterParts.push(`${chain.join(",")}[a${i}]`);
      labels.push(`[a${i}]`);
    });

    let filter: string;
    if (labels.length === 1) {
      filter = `${filterParts[0]};${labels[0]}volume=${master.toFixed(3)},alimiter=limit=0.95[out]`;
    } else {
      filter =
        filterParts.join(";") +
        ";" +
        `${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0[mix];` +
        `[mix]volume=${master.toFixed(3)},alimiter=limit=0.95[out]`;
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
      ...codecArgs,
      out,
    ];

    await runFfmpeg(args);
    const buffer = await readFile(out);
    return {
      buffer,
      ext: format,
      contentType: format === "mp3" ? "audio/mpeg" : "audio/wav",
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
      else if (timedOut) reject(new AudioExportError("export_failed", "Audio export timed out.", 500));
      else reject(new AudioExportError("export_failed", "Audio export failed.", 500, stderr));
    });
  });
}
