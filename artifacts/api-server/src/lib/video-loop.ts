import { spawn } from "child_process";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Seamless video loop — the automatic version of the hand-built FFmpeg recipe.
 *
 * A 360° turnaround (or any clip) played with <video loop> visibly jumps
 * when the last frame cuts back to the first. This pipeline removes the
 * jump deterministically:
 *
 *   1. Probe the source (frame count N, fps, audio presence).
 *   2. Extract frame 0 losslessly (PNG).
 *   3. Extract the last K frames (K = min(4, N-1)) and blend each one
 *      toward frame 0 with increasing weight — the motion eases into the
 *      start pose instead of snapping to it.
 *   4. Re-encode: untouched head straight from the source, blended tail
 *      from PNGs, and the very last frame as a pixel-exact copy of frame 0,
 *      so the loop point is mathematically seamless (modulo encoder noise).
 *   5. Mux the source audio back (durations match, so no drift).
 *
 * What it does NOT do: fix content drift inside the source (e.g. a
 * character whose colors change mid-turn). That needs regeneration —
 * the loop only fixes the seam.
 */

export class VideoLoopError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoLoopError";
  }
}

const CMD_TIMEOUT_MS = 5 * 60 * 1000;
/** Inputs longer than this are rejected — disk/time blow up past it. */
const MAX_INPUT_SEC = 30;

function runCmd(cmd: string, args: string[], timeoutMs = CMD_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);
    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
    });
    proc.on("error", (e) => {
      clearTimeout(timer);
      reject(new VideoLoopError(`${cmd} failed to start: ${e.message}`));
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new VideoLoopError(`${cmd} exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

interface Probe {
  frames: number;
  fps: number;
  durationSec: number;
  hasAudio: boolean;
}

async function probe(srcPath: string): Promise<Probe> {
  const out = await runCmd("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=nb_frames,avg_frame_rate,width,height,duration",
    "-show_entries", "format=duration",
    "-of", "json",
    srcPath,
  ]);
  const j = JSON.parse(out) as {
    streams?: Array<{ nb_frames?: string; avg_frame_rate?: string; duration?: string }>;
    format?: { duration?: string };
  };
  const s = j.streams?.[0];
  if (!s) throw new VideoLoopError("No video stream found.");
  const fpsParts = (s.avg_frame_rate ?? "0/1").split("/");
  const fps = parseFloat(fpsParts[0] ?? "0") / parseFloat(fpsParts[1] ?? "1");
  const durationSec = parseFloat(s.duration ?? j.format?.duration ?? "0");
  if (!fps || fps <= 0 || !durationSec || durationSec <= 0) {
    throw new VideoLoopError("Could not read video fps/duration.");
  }
  if (durationSec > MAX_INPUT_SEC) {
    throw new VideoLoopError(`Video is too long to loop (${durationSec.toFixed(1)}s — max ${MAX_INPUT_SEC}s).`);
  }
  let frames = parseInt(s.nb_frames ?? "", 10);
  if (!Number.isFinite(frames) || frames <= 0) frames = Math.round(durationSec * fps);
  if (frames < 3) throw new VideoLoopError("Video is too short to loop.");

  let hasAudio = false;
  try {
    const aout = await runCmd("ffprobe", [
      "-v", "error", "-select_streams", "a:0",
      "-show_entries", "stream=index", "-of", "csv=p=0", srcPath,
    ]);
    hasAudio = aout.trim().length > 0;
  } catch {
    hasAudio = false;
  }
  return { frames, fps, durationSec, hasAudio };
}

/**
 * Build a seamless loop from srcPath. Returns the output mp4 path inside workDir.
 * The caller owns workDir cleanup.
 */
export async function makeSeamlessLoop(srcPath: string, workDir: string): Promise<{ outPath: string; frames: number; fps: number }> {
  const { frames: n, fps, hasAudio } = await probe(srcPath);
  const k = Math.min(4, n - 1);          // blended tail frames
  const headCount = n - k - 1;           // untouched head frames
  const fpsStr = String(fps);

  const f0 = join(workDir, "f0.png");
  await runCmd("ffmpeg", ["-y", "-v", "error", "-i", srcPath, "-vf", "select='eq(n,0)'", "-vframes", "1", f0]);

  // Blend the last k frames toward frame 0 with increasing weight.
  const tailPngs: string[] = [];
  for (let j = 0; j < k; j++) {
    const srcIdx = n - k - 1 + j;
    const w = (j + 1) / (k + 1);
    const tailSrc = join(workDir, `tail_src_${j}.png`);
    const tailOut = join(workDir, `tail_${String(j).padStart(2, "0")}.png`);
    await runCmd("ffmpeg", ["-y", "-v", "error", "-i", srcPath, "-vf", `select='eq(n,${srcIdx})'`, "-vframes", "1", tailSrc]);
    await runCmd("ffmpeg", [
      "-y", "-v", "error",
      "-i", tailSrc, "-i", f0,
      "-filter_complex", `[0][1]blend=all_mode=normal:all_opacity=${w.toFixed(3)}`,
      "-frames:v", "1", tailOut,
    ]);
    tailPngs.push(tailOut);
  }
  // Final frame: pixel-exact copy of frame 0 (pre-encode) — the loop point.
  const finalPng = join(workDir, `tail_${String(k).padStart(2, "0")}.png`);
  await runCmd("ffmpeg", ["-y", "-v", "error", "-i", f0, "-frames:v", "1", finalPng]);
  tailPngs.push(finalPng);

  const tailMp4 = join(workDir, "tail.mp4");
  await runCmd("ffmpeg", [
    "-y", "-v", "error",
    "-framerate", fpsStr, "-i", join(workDir, "tail_%02d.png"),
    "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p",
    tailMp4,
  ]);

  let bodyMp4: string;
  if (headCount > 0) {
    const headMp4 = join(workDir, "head.mp4");
    await runCmd("ffmpeg", [
      "-y", "-v", "error", "-i", srcPath,
      "-vf", `select='lt(n,${headCount})',setpts=N/FRAME_RATE/TB`,
      "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p",
      headMp4,
    ]);
    bodyMp4 = join(workDir, "body.mp4");
    await runCmd("ffmpeg", [
      "-y", "-v", "error",
      "-i", headMp4, "-i", tailMp4,
      "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]",
      "-map", "[v]", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p",
      bodyMp4,
    ]);
  } else {
    bodyMp4 = tailMp4;
  }

  const outPath = join(workDir, "loop.mp4");
  const muxArgs = ["-y", "-v", "error", "-i", bodyMp4];
  if (hasAudio) muxArgs.push("-i", srcPath);
  muxArgs.push("-map", "0:v:0");
  if (hasAudio) muxArgs.push("-map", "1:a:0?", "-c:a", "aac", "-b:a", "128k");
  muxArgs.push("-c:v", "copy", "-movflags", "+faststart", "-shortest", outPath);
  await runCmd("ffmpeg", muxArgs);

  return { outPath, frames: n, fps };
}

/** Convenience: download a video URL and loop it, managing its own temp dir. */
export async function loopVideoFromUrl(videoUrl: string): Promise<{ outPath: string; workDir: string; frames: number; fps: number }> {
  const workDir = await mkdtemp(join(tmpdir(), "loop-"));
  try {
    const dl = await fetch(videoUrl);
    if (!dl.ok) throw new VideoLoopError(`Could not download source video (HTTP ${dl.status}).`);
    const buf = Buffer.from(await dl.arrayBuffer());
    if (buf.length === 0) throw new VideoLoopError("Downloaded video is empty.");
    const srcPath = join(workDir, "src.mp4");
    await writeFile(srcPath, buf);
    const r = await makeSeamlessLoop(srcPath, workDir);
    return { outPath: r.outPath, workDir, frames: r.frames, fps: r.fps };
  } catch (e) {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}
