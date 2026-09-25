/**
 * stem-separation.ts — shared Demucs vocal/instrumental separation.
 *
 * Used by two pipelines:
 *  1. Lip-sync: isolate vocals before sending audio to Sync.so, then restore
 *     the full mix on the finished video.
 *  2. Artist voice lock: isolate vocals from a generated song so they can be
 *     swapped to the artist's locked ElevenLabs voice, then remixed.
 *  3. Voice from-song cloning: isolate vocals as IVC training input. This
 *     path runs inside a web request on a small container, so it uses a
 *     lighter/faster model (see FROM_SONG_DEMUCS_MODEL) — the vocals only
 *     need to be intelligible, and ElevenLabs runs its own noise removal.
 *
 * Demucs runs on CPU via a Python venv. In production (Docker) the venv lives
 * at /opt/demucs-venv and DEMUCS_PYTHON points at it. Set DEMUCS_MODEL to
 * override the model (default: mdx_extra_q, the quality/weight sweet spot).
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";

const DEMUCS_PYTHON = process.env["DEMUCS_PYTHON"] ?? "python3";
const DEMUCS_MODEL = process.env["DEMUCS_MODEL"] ?? "mdx_extra_q";
const DEMUCS_TIMEOUT_MS = Number(process.env["DEMUCS_TIMEOUT_MS"] ?? 600_000);
/** Ceiling for the fast ffmpeg/ffprobe pre-trim steps (decode-speed work). */
const TRIM_STEP_TIMEOUT_MS = 120_000;

export interface VocalStems {
  /** Isolated vocals (wav). */
  vocalsPath: string;
  /** Everything except vocals (wav) — the instrumental bed. */
  instrumentalPath: string;
  /** Scratch dir; caller must clean up with cleanupWorkdir(). */
  workdir: string;
}

export interface SeparateVocalStemsOptions {
  /**
   * Demucs model name for this run. Defaults to DEMUCS_MODEL
   * (mdx_extra_q). Callers on a tight CPU/RAM budget (e.g. the from-song
   * clone path inside a web request) should pass a lighter model.
   */
  model?: string;
  /**
   * When set (> 0), the input is first trimmed to its best
   * `trimSeconds`-second window via ffmpeg BEFORE Demucs runs, so Demucs
   * only ever processes a short slice. ElevenLabs IVC only needs ~30s of
   * clean vocals — isolating a full-length song is wasted work and can
   * time out on a small container (2026-09-25 incident: 10-min Demucs
   * timeout on a full song). Pipelines that need full-song stems
   * (lip-sync, voice-swap) must NOT set this.
   */
  trimSeconds?: number;
  /**
   * Window selection strategy for the pre-trim: "vocal" picks the window
   * with the most vocal activity (best for voice cloning), "loudest"
   * picks the highest-loudness window (legacy). Defaults to "vocal".
   */
  windowStrategy?: "vocal" | "loudest";
  /**
   * When true, the isolated vocal stem is loudness-normalized and
   * silence-trimmed for IVC training input. Recommended for the from-song
   * clone path; pipelines that remix the vocals (voice-swap) must NOT
   * set this (normalization would change the remix balance).
   */
  postProcessVocals?: boolean;
}

/**
 * Run a short-lived process, capturing stdout/stderr. Throws on non-zero
 * exit or timeout. `maxOutputChars` caps buffered output (the loudness
 * scan below needs the full stream; Demucs-style truncation would drop
 * the blocks the window search reads).
 */
function runProcess(
  bin: string,
  args: string[],
  timeoutMs: number,
  maxOutputChars = 200_000,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
      if (stdout.length > maxOutputChars) stdout = stdout.slice(-maxOutputChars);
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > maxOutputChars) stderr = stderr.slice(-maxOutputChars);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${bin} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Could not start ${bin}: ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${bin} exited with code ${code}: ${stderr}`.slice(0, 500)));
    });
  });
}

async function getAudioDurationSeconds(inputPath: string): Promise<number> {
  const { stdout } = await runProcess(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      inputPath,
    ],
    TRIM_STEP_TIMEOUT_MS,
  );
  const secs = Number(stdout.trim());
  if (!Number.isFinite(secs) || secs <= 0) throw new Error("Could not probe audio duration.");
  return secs;
}

/**
 * Find the loudest `windowSeconds`-long window of the input, returned as
 * seconds from the start, via a single decode-speed ffmpeg ebur128 pass
 * (seconds of CPU on a full song — not minutes like Demucs).
 *
 * Why the loudest window: song intros/outros are often quiet or
 * instrumental, and ElevenLabs IVC wants 30s+ of clean, present vocals,
 * which live in the loud sections (verses/choruses). Momentary loudness
 * (M) is averaged over a sliding window; pure silence reads `-inf` and is
 * floored at -70 LUFS so silent stretches drag a window's mean down
 * instead of being silently ignored (which would let one loud blip win).
 *
 * Falls back to 0 (start of file) when the scan fails or yields nothing
 * parseable — a wrong-but-short slice beats a timed-out full song.
 */
export async function findLoudestWindowStartSeconds(
  inputPath: string,
  windowSeconds: number,
): Promise<number> {
  try {
    const { stderr } = await runProcess(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostats",
        "-i",
        inputPath,
        "-map",
        "0:a",
        "-af",
        // NOTE: do NOT add framelog=quiet here — on ffmpeg 8+ it suppresses
        // the per-frame logs this parser reads, yielding zero blocks and a
        // silent fallback to window start 0 (2026-09-25 incident: from-song
        // clones were isolating the first 90s, not the loudest 90s).
        "ebur128=peak=true",
        "-f",
        "null",
        "-",
      ],
      TRIM_STEP_TIMEOUT_MS,
      4_000_000,
    );
    const blocks: Array<{ t: number; m: number }> = [];
    for (const line of stderr.split("\n")) {
      const m = /t:\s*([\d.]+)\s+M:\s*(-inf|[-+\d.eE]+)/.exec(line);
      if (!m) continue;
      const t = Number(m[1]);
      const loud = m[2] === "-inf" ? -70 : Number(m[2]);
      if (Number.isFinite(t) && Number.isFinite(loud)) blocks.push({ t, m: loud });
    }
    if (blocks.length === 0) return 0;
    blocks.sort((a, b) => a.t - b.t);
    let bestStart = 0;
    let bestMean = -Infinity;
    for (let i = 0; i < blocks.length; i++) {
      const start = blocks[i].t;
      const end = start + windowSeconds;
      let sum = 0;
      let n = 0;
      for (let j = i; j < blocks.length && blocks[j].t < end; j++) {
        sum += blocks[j].m;
        n++;
      }
      if (n > 0 && sum / n > bestMean) {
        bestMean = sum / n;
        bestStart = start;
      }
    }
    return bestStart;
  } catch {
    return 0;
  }
}

/**
 * Find the `windowSeconds`-long window with the most vocal activity,
 * returned as seconds from the start. Uses center-channel energy in the
 * vocal band (200Hz–4kHz): lead vocals are almost always center-panned,
 * while instrumental beds spread wider. For ElevenLabs IVC training, the
 * most-vocal window beats the merely-loudest — a loud instrumental drop
 * has high ebur128 loudness but zero cloneable vocals.
 *
 * Same decode-speed single ffmpeg pass as findLoudestWindowStartSeconds.
 * Falls back to 0 on scan failure.
 */
export async function findBestVocalWindowStartSeconds(
  inputPath: string,
  windowSeconds: number,
): Promise<number> {
  try {
    const { stderr } = await runProcess(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostats",
        "-i",
        inputPath,
        "-map",
        "0:a",
        "-af",
        // Mid (center) channel only, band-limited to the vocal range, then
        // ebur128 momentary loudness per frame. Do NOT add framelog=quiet
        // (see note in findLoudestWindowStartSeconds).
        "pan=mono|c0=0.5*c0+0.5*c1,highpass=f=200,lowpass=f=4000,ebur128=peak=true",
        "-f",
        "null",
        "-",
      ],
      TRIM_STEP_TIMEOUT_MS,
      4_000_000,
    );
    const blocks: Array<{ t: number; m: number }> = [];
    for (const line of stderr.split("\n")) {
      const m = /t:\s*([\d.]+)\s+.*M:\s*(-inf|[-+\d.eE]+)/.exec(line);
      if (!m) continue;
      const t = Number(m[1]);
      const loud = m[2] === "-inf" ? -70 : Number(m[2]);
      if (Number.isFinite(t) && Number.isFinite(loud)) blocks.push({ t, m: loud });
    }
    if (blocks.length === 0) return 0;
    blocks.sort((a, b) => a.t - b.t);
    let bestStart = 0;
    let bestMean = -Infinity;
    for (let i = 0; i < blocks.length; i++) {
      const start = blocks[i].t;
      const end = start + windowSeconds;
      let sum = 0;
      let n = 0;
      for (let j = i; j < blocks.length && blocks[j].t < end; j++) {
        sum += blocks[j].m;
        n++;
      }
      if (n > 0 && sum / n > bestMean) {
        bestMean = sum / n;
        bestStart = start;
      }
    }
    return bestStart;
  } catch {
    return 0;
  }
}

/**
 * Post-process an isolated vocal stem for IVC training input:
 *  1. Loudness-normalize to -16 LUFS (consistent level for ElevenLabs;
 *     raw Demucs output level varies wildly with the source mix).
 *  2. Lowpass at 12kHz to cut cymbal/percussion bleed — the light
 *     htdemucs model leaves significant high-frequency instrumental hash
 *     in the vocal stem (measured 9.5dB bleed ratio on the theme song;
 *     ElevenLabs rejects heavy-bleed inputs). Vocals carry almost no
 *     content above 12kHz, so this is safe for voice cloning.
 *  3. Trim leading/trailing silence (ElevenLabs rejects inputs that start
 *     with long silence; the bugged 0-90s window had a 20s quiet intro).
 *
 * Returns the path to the processed file (in the same workdir).
 */
export async function postProcessVocalStem(
  vocalsPath: string,
  workdir: string,
): Promise<string> {
  const outPath = join(workdir, "vocals-ivc.wav");
  await runProcess(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      vocalsPath,
      "-af",
      "loudnorm=I=-16:TP=-1.5:LRA=11,lowpass=f=12000,silenceremove=start_periods=1:start_duration=1:start_threshold=-50dB:stop_periods=1:stop_duration=1:stop_threshold=-50dB",
      "-c:a",
      "pcm_s16le",
      "-ar",
      "44100",
      "-ac",
      "1",
      outPath,
    ],
    TRIM_STEP_TIMEOUT_MS,
  );
  return outPath;
}

async function trimAudioToWindow(
  inputPath: string,
  outPath: string,
  startSeconds: number,
  durationSeconds: number,
): Promise<void> {
  await runProcess(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-ss",
      startSeconds.toFixed(2),
      "-t",
      durationSeconds.toFixed(2),
      "-i",
      inputPath,
      "-c:a",
      "pcm_s16le",
      "-ar",
      "44100",
      "-ac",
      "2",
      outPath,
    ],
    TRIM_STEP_TIMEOUT_MS,
  );
}

/**
 * Trim `inputPath` down to its best `windowSeconds`-second window so
 * Demucs only processes what IVC actually needs. The window strategy is
 * "vocal" (most vocal activity — default, best for voice cloning) or
 * "loudest" (highest ebur128 loudness — legacy behavior).
 * Returns the path Demucs should read: the trimmed wav, or `inputPath`
 * unchanged when the audio is already short enough (or the duration probe
 * fails — Demucs then sees the original file, i.e. the pre-trim behavior).
 */
export async function trimSongToBestWindow(
  inputPath: string,
  workdir: string,
  windowSeconds: number,
  strategy: "vocal" | "loudest" = "vocal",
): Promise<string> {
  let duration: number;
  try {
    duration = await getAudioDurationSeconds(inputPath);
  } catch {
    return inputPath;
  }
  if (duration <= windowSeconds) return inputPath;
  const start =
    strategy === "vocal"
      ? await findBestVocalWindowStartSeconds(inputPath, windowSeconds)
      : await findLoudestWindowStartSeconds(inputPath, windowSeconds);
  const clamped = Math.min(Math.max(0, start), Math.max(0, duration - windowSeconds));
  const outPath = join(workdir, "song-trim.wav");
  await trimAudioToWindow(inputPath, outPath, clamped, Math.min(windowSeconds, duration - clamped));
  return outPath;
}

/**
 * Backwards-compatible alias: trims to the loudest window.
 * Prefer trimSongToBestWindow for new callers.
 */
export const trimSongToLoudestWindow = (
  inputPath: string,
  workdir: string,
  windowSeconds: number,
): Promise<string> => trimSongToBestWindow(inputPath, workdir, windowSeconds, "loudest");

function runDemucs(songPath: string, outDir: string, model: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      DEMUCS_PYTHON,
      [
        "-m",
        "demucs",
        "--two-stems",
        "vocals",
        "-n",
        model,
        "-d",
        "cpu",
        "--out",
        outDir,
        songPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Demucs timed out after ${DEMUCS_TIMEOUT_MS}ms`));
    }, DEMUCS_TIMEOUT_MS);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Could not start Demucs (${DEMUCS_PYTHON}): ${err.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`Demucs exited with code ${code}: ${stderr}`.slice(0, 500)));
    });
  });
}

/**
 * Split a song buffer into vocals + instrumental wavs.
 * Throws on failure — callers decide whether to fall back to the original mix.
 */
export async function separateVocalStems(
  songBuffer: Buffer,
  opts?: SeparateVocalStemsOptions,
): Promise<VocalStems> {
  const model = opts?.model ?? DEMUCS_MODEL;
  const trimSeconds = opts?.trimSeconds;
  const windowStrategy = opts?.windowStrategy ?? "vocal";
  const workdir = await fs.mkdtemp(join(tmpdir(), "stems-"));
  try {
    const songPath = join(workdir, "song.mp3");
    await fs.writeFile(songPath, songBuffer);
    // Cheap pre-trim for callers on a tight CPU budget (from-song voice
    // cloning): Demucs only ever sees a short slice instead of a full song.
    const demucsInput =
      trimSeconds && trimSeconds > 0
        ? await trimSongToBestWindow(songPath, workdir, trimSeconds, windowStrategy)
        : songPath;
    const outDir = join(workdir, "demucs-out");
    await runDemucs(demucsInput, outDir, model);
    // Demucs layout: <outDir>/<model>/<input-basename>/{vocals.wav,no_vocals.wav}
    const stemDir = join(outDir, model, basename(demucsInput, extname(demucsInput)));
    let vocalsPath = join(stemDir, "vocals.wav");
    const instrumentalPath = join(stemDir, "no_vocals.wav");
    await fs.access(vocalsPath);
    await fs.access(instrumentalPath);
    // Normalize + silence-trim for IVC training input (from-song cloning).
    if (opts?.postProcessVocals) {
      vocalsPath = await postProcessVocalStem(vocalsPath, workdir);
    }
    return { vocalsPath, instrumentalPath, workdir };
  } catch (err) {
    await cleanupWorkdir(workdir);
    throw err;
  }
}

export async function cleanupWorkdir(workdir: string): Promise<void> {
  await fs.rm(workdir, { recursive: true, force: true });
}
