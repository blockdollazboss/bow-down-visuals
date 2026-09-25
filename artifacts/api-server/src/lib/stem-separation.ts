/**
 * stem-separation.ts — shared Demucs vocal/instrumental separation.
 *
 * Used by two pipelines:
 *  1. Lip-sync: isolate vocals before sending audio to Sync.so, then restore
 *     the full mix on the finished video.
 *  2. Artist voice lock: isolate vocals from a generated song so they can be
 *     swapped to the artist's locked ElevenLabs voice, then remixed.
 *
 * Demucs runs on CPU via a Python venv. In production (Docker) the venv lives
 * at /opt/demucs-venv and DEMUCS_PYTHON points at it. Set DEMUCS_MODEL to
 * override the model (default: mdx_extra_q, the quality/weight sweet spot).
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEMUCS_PYTHON = process.env["DEMUCS_PYTHON"] ?? "python3";
const DEMUCS_MODEL = process.env["DEMUCS_MODEL"] ?? "mdx_extra_q";
const DEMUCS_TIMEOUT_MS = Number(process.env["DEMUCS_TIMEOUT_MS"] ?? 600_000);

export interface VocalStems {
  /** Isolated vocals (wav). */
  vocalsPath: string;
  /** Everything except vocals (wav) — the instrumental bed. */
  instrumentalPath: string;
  /** Scratch dir; caller must clean up with cleanupWorkdir(). */
  workdir: string;
}

function runDemucs(songPath: string, outDir: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      DEMUCS_PYTHON,
      [
        "-m",
        "demucs",
        "--two-stems",
        "vocals",
        "-n",
        DEMUCS_MODEL,
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
export async function separateVocalStems(songBuffer: Buffer): Promise<VocalStems> {
  const workdir = await fs.mkdtemp(join(tmpdir(), "stems-"));
  try {
    const songPath = join(workdir, "song.mp3");
    await fs.writeFile(songPath, songBuffer);
    const outDir = join(workdir, "demucs-out");
    await runDemucs(songPath, outDir);
    // Demucs layout: <outDir>/<model>/<input-basename>/{vocals.wav,no_vocals.wav}
    const stemDir = join(outDir, DEMUCS_MODEL, "song");
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
