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
   * When set (> 0), the input is first trimmed to its loudest
   * `trimSeconds`-second window via ffmpeg BEFORE Demucs runs, so Demucs
   * only ever processes a short slice. ElevenLabs IVC only needs ~30s of
   * clean vocals — isolating a full-length song is wasted work and can
   * time out on a small container (2026-09-25 incident: 10-min Demucs
   * timeout on a full song). Pipelines that need full-song stems
   * (lip-sync, voice-swap) must NOT set this.
   */
  trimSeconds?: number;
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
        "ebur128=peak=true:framelog=quiet",
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
 * Trim `inputPath` down to its loudest `windowSeconds`-second window so
 * Demucs only processes what IVC actually needs. Returns the path Demucs
 * should read: the trimmed wav, or `inputPath` unchanged when the audio
 * is already short enough (or the duration probe fails — Demucs then sees
 * the original file, i.e. the pre-trim behavior).
 */
export async function trimSongToLoudestWindow(
  inputPath: string,
  workdir: string,
  windowSeconds: number,
): Promise<string> {
  let duration: number;
  try {
    duration = await getAudioDurationSeconds(inputPath);
  } catch {
    return inputPath;
  }
  if (duration <= windowSeconds) return inputPath;
  const start = await findLoudestWindowStartSeconds(inputPath, windowSeconds);
  const clamped = Math.min(Math.max(0, start), Math.max(0, duration - windowSeconds));
  const outPath = join(workdir, "song-trim.wav");
  await trimAudioToWindow(inputPath, outPath, clamped, Math.min(windowSeconds, duration - clamped));
  return outPath;
}

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
  const workdir = await fs.mkdtemp(join(tmpdir(), "stems-"));
  try {
    const songPath = join(workdir, "song.mp3");
    await fs.writeFile(songPath, songBuffer);
    // Cheap pre-trim for callers on a tight CPU budget (from-song voice
    // cloning): Demucs only ever sees a short slice instead of a full song.
    const demucsInput =
      trimSeconds && trimSeconds > 0
        ? await trimSongToLoudestWindow(songPath, workdir, trimSeconds)
        : songPath;
    const outDir = join(workdir, "demucs-out");
    await runDemucs(demucsInput, outDir, model);
    // Demucs layout: <outDir>/<model>/<input-basename>/{vocals.wav,no_vocals.wav}
    const stemDir = join(outDir, model, basename(demucsInput, extname(demucsInput)));
    const vocalsPath = join(stemDir, "vocals.wav");
    const instrumentalPath = join(stemDir, "no_vocals.wav");
    await fs.access(vocalsPath);
    await fs.access(instrumentalPath);
    return { vocalsPath, instrumentalPath, workdir };
  } catch (err) {
    await cleanupWorkdir(workdir);
    throw err;
  }
}

export async function cleanupWorkdir(workdir: string): Promise<void> {
  await fs.rm(workdir, { recursive: true, force: true });
}
