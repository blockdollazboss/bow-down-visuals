import { execFile, spawn } from "child_process";
import { promisify } from "util";
import {
  access,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { logger } from "./logger";
import type { DetectionSample } from "./reframe-tracking";

/* ─── Subject detector for auto-reframe v2 ───
   Finds the person in a video so the reframe crop can follow them.

   Engine: Robust Video Matting (RVM, MobileNetV3) running on the
   ONNX Runtime Web WASM build — both ALREADY vendored in this repo
   for the browser background engines (public/engines/onnxruntime +
   public/engines/rvm, used by the stream-kit/photo matting code).
   No new dependency, no external API, no per-call provider cost:
   the vendored files are loaded from disk and inference runs in a
   short-lived Node child process, so a WASM fault or a memory spike
   can never take the API server down with it.

   The matte is a PERSON segmentation (not a face box): per sampled
   frame we keep the bounding box of the alpha≥0.5 region plus its
   frame coverage. Frames are sampled in order and the RVM recurrent
   state is carried across them, which is the model's intended use.

   Failure honesty: ANY problem — assets missing, probe failure,
   worker crash/timeout — resolves to null, and the caller falls
   back to the centre crop and labels it. This function never
   throws and never fabricates samples. */

const execFileAsync = promisify(execFile);

export interface SubjectDetectionResult {
  samples: DetectionSample[];
  width: number;
  height: number;
  durationSec: number;
  engine: "rvm-onnx";
}

const MAX_SAMPLES = 90;
const MAX_FPS = 6;
const MIN_FPS = 0.2;
const FEED_MAX_WIDTH = 384;
const WORKER_TIMEOUT_MS =
  Number(process.env["REFRAME_DETECTOR_TIMEOUT_MS"]) || 150_000;
const WORKER_THREADS = Math.max(
  1,
  Math.min(2, Number(process.env["REFRAME_DETECTOR_THREADS"]) || 1),
);

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Locate the vendored engines directory (contains onnxruntime/ and
 *  rvm/). Candidates cover the repo checkout (dev/tests run from
 *  artifacts/api-server), the production image layout (cwd=/app),
 *  and an explicit override. */
export async function resolveEnginesDir(): Promise<string | null> {
  const candidates: string[] = [];
  const override = process.env["REFRAME_ENGINES_DIR"];
  if (override) candidates.push(override);
  candidates.push(
    join(process.cwd(), "artifacts/bow-down-visuals/public/engines"),
    join(process.cwd(), "../bow-down-visuals/public/engines"),
    join(process.cwd(), "../../artifacts/bow-down-visuals/public/engines"),
  );
  for (const dir of candidates) {
    if (
      (await exists(join(dir, "onnxruntime/ort.all.min.js"))) &&
      (await exists(join(dir, "rvm/rvm_mobilenetv3_fp32.onnx")))
    ) {
      return dir;
    }
  }
  return null;
}

interface ProbeInfo {
  width: number;
  height: number;
  durationSec: number;
}

async function probeVideo(inputPath: string): Promise<ProbeInfo | null> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-show_entries", "format=duration",
        "-of", "json",
        inputPath,
      ],
      { timeout: 60_000 },
    );
    const parsed = JSON.parse(String(stdout)) as {
      streams?: Array<{ width?: number; height?: number }>;
      format?: { duration?: string };
    };
    const stream = parsed.streams?.[0];
    const width = stream?.width ?? 0;
    const height = stream?.height ?? 0;
    const durationSec = parseFloat(parsed.format?.duration ?? "0");
    if (!width || !height) return null;
    return {
      width,
      height,
      durationSec: isFinite(durationSec) && durationSec > 0 ? durationSec : 0,
    };
  } catch {
    return null;
  }
}

/* The worker script, materialized next to the ORT wrapper in a
   per-process cache dir. Written without template literals so it
   can live inside this template literal safely.
   Protocol: one JSON job on stdin → one JSON line on stdout:
   { frames: [{ coverage, box|null }] } or { error }. */
const WORKER_SOURCE = `
import { readFile } from "fs/promises";
import { pathToFileURL } from "url";

async function main() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const job = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const ort = (await import(pathToFileURL(job.ortWrapperPath).href)).default;
  if (!ort) throw new Error("ort global missing from wrapper");
  ort.env.logLevel = "warning";
  ort.env.wasm.wasmPaths = pathToFileURL(job.ortDir + "/").href;
  ort.env.wasm.numThreads = job.threads || 1;
  const model = await readFile(job.modelPath);
  const session = await ort.InferenceSession.create(model, {
    executionProviders: ["wasm"],
  });
  const raw = await readFile(job.framesPath);
  const W = job.frameW;
  const H = job.frameH;
  const plane = W * H;
  const frameBytes = plane * 3;
  const count = Math.min(job.frameCount, Math.floor(raw.length / frameBytes));
  const ratio = Math.min(0.6, Math.max(0.3, 480 / Math.max(W, H)));
  const ratioTensor = new ort.Tensor("float32", new Float32Array([ratio]), [1]);
  const zero = function () {
    return new ort.Tensor("float32", new Float32Array(1), [1, 1, 1, 1]);
  };
  let states = [zero(), zero(), zero(), zero()];
  const buf = new Float32Array(3 * plane);
  const frames = [];
  for (let f = 0; f < count; f++) {
    const off = f * frameBytes;
    for (let i = 0, j = off; i < plane; i++, j += 3) {
      buf[i] = raw[j] / 255;
      buf[plane + i] = raw[j + 1] / 255;
      buf[2 * plane + i] = raw[j + 2] / 255;
    }
    const out = await session.run({
      src: new ort.Tensor("float32", buf, [1, 3, H, W]),
      r1i: states[0],
      r2i: states[1],
      r3i: states[2],
      r4i: states[3],
      downsample_ratio: ratioTensor,
    });
    states = [out.r1o, out.r2o, out.r3o, out.r4o];
    const a = out.pha.data;
    let minX = W, maxX = -1, minY = H, maxY = -1, over = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (a[y * W + x] >= 0.5) {
          over++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (over > 0) {
      frames.push({
        coverage: over / plane,
        box: {
          x: minX / W,
          y: minY / H,
          w: (maxX - minX + 1) / W,
          h: (maxY - minY + 1) / H,
        },
      });
    } else {
      frames.push({ coverage: 0, box: null });
    }
  }
  process.stdout.write(JSON.stringify({ frames: frames }) + "\\n");
}

main().catch(function (e) {
  process.stdout.write(
    JSON.stringify({ error: String(e && e.message ? e.message : e) }) + "\\n",
  );
});
`;

/* Materialize (once per cache dir) the ORT wrapper module — the
   vendored UMD bundle plus an ESM export shim — and the worker
   script. Returns null when the vendored bundle can't be read. */
async function materializeRuntime(enginesDir: string): Promise<{
  workerPath: string;
  ortWrapperPath: string;
} | null> {
  const cacheDir = join(tmpdir(), "bdv-reframe-ort-v1");
  const workerPath = join(cacheDir, "rvm-worker.mjs");
  const ortWrapperPath = join(cacheDir, "ort-wrapper.mjs");
  try {
    if (!(await exists(workerPath))) {
      const tmp = join(cacheDir, `worker-${process.pid}.tmp`);
      const { mkdir } = await import("fs/promises");
      await mkdir(cacheDir, { recursive: true });
      await writeFile(tmp, WORKER_SOURCE, "utf8");
      await rename(tmp, workerPath).catch(async () => {
        // Lost a race with a sibling job — fine if the file landed.
        if (!(await exists(workerPath))) throw new Error("worker write failed");
      });
    }
    if (!(await exists(ortWrapperPath))) {
      const bundle = await readFile(
        join(enginesDir, "onnxruntime/ort.all.min.js"),
        "utf8",
      );
      const tmp = join(cacheDir, `ort-${process.pid}.tmp`);
      const { mkdir } = await import("fs/promises");
      await mkdir(cacheDir, { recursive: true });
      await writeFile(tmp, bundle + "\n;export default ort;\n", "utf8");
      await rename(tmp, ortWrapperPath).catch(async () => {
        if (!(await exists(ortWrapperPath))) throw new Error("ort write failed");
      });
    }
    return { workerPath, ortWrapperPath };
  } catch (err) {
    logger.warn({ err }, "[subject-detector] runtime materialization failed");
    return null;
  }
}

interface WorkerFrame {
  coverage: number;
  box: { x: number; y: number; w: number; h: number } | null;
}

function runWorker(
  workerPath: string,
  job: Record<string, unknown>,
): Promise<WorkerFrame[] | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: WorkerFrame[] | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const child = spawn(process.execPath, [workerPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderrTail = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      logger.warn("[subject-detector] worker timed out");
      done(null);
    }, WORKER_TIMEOUT_MS);
    timer.unref?.();
    child.stdout.on("data", (c: Buffer) => {
      stdout += c.toString();
    });
    child.stderr.on("data", (c: Buffer) => {
      stderrTail = (stderrTail + c.toString()).slice(-2000);
    });
    child.on("error", () => {
      clearTimeout(timer);
      done(null);
    });
    child.on("close", () => {
      clearTimeout(timer);
      const line = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .pop();
      if (!line) {
        logger.warn({ stderrTail }, "[subject-detector] worker produced no result");
        done(null);
        return;
      }
      try {
        const parsed = JSON.parse(line) as {
          frames?: WorkerFrame[];
          error?: string;
        };
        if (parsed.error || !Array.isArray(parsed.frames)) {
          logger.warn(
            { workerError: parsed.error ?? "no frames" },
            "[subject-detector] worker reported failure",
          );
          done(null);
          return;
        }
        done(parsed.frames);
      } catch {
        logger.warn("[subject-detector] worker output unparseable");
        done(null);
      }
    });
    child.stdin.end(JSON.stringify(job));
  });
}

/** Sample the video and detect the person matte per sample.
 *  Returns null when the engine is unavailable for any reason. */
export async function detectSubjectsInVideo(
  inputPath: string,
): Promise<SubjectDetectionResult | null> {
  const workDir = await mkdtemp(join(tmpdir(), "reframe-detect-"));
  try {
    const enginesDir = await resolveEnginesDir();
    if (!enginesDir) {
      logger.warn("[subject-detector] vendored engines not found");
      return null;
    }
    const probe = await probeVideo(inputPath);
    if (!probe) return null;
    const durationSec =
      probe.durationSec > 0 ? probe.durationSec : MAX_SAMPLES / 2;

    const fps = Math.min(
      MAX_FPS,
      Math.max(MIN_FPS, MAX_SAMPLES / durationSec),
    );
    const feedW = Math.max(
      2,
      Math.floor(Math.min(probe.width, FEED_MAX_WIDTH) / 2) * 2,
    );
    const feedH = Math.max(
      2,
      Math.floor(((probe.height * feedW) / probe.width) / 2) * 2,
    );

    const framesPath = join(workDir, "frames.rgb");
    await execFileAsync(
      "ffmpeg",
      [
        "-y", "-v", "error",
        "-i", inputPath,
        "-vf", `fps=${fps.toFixed(4)},scale=${feedW}:${feedH}`,
        "-f", "rawvideo", "-pix_fmt", "rgb24",
        framesPath,
      ],
      { timeout: 120_000 },
    );
    const raw = await readFile(framesPath);
    const frameBytes = feedW * feedH * 3;
    const frameCount = Math.floor(raw.length / frameBytes);
    if (frameCount === 0) return null;

    const runtime = await materializeRuntime(enginesDir);
    if (!runtime) return null;

    const frames = await runWorker(runtime.workerPath, {
      ortWrapperPath: runtime.ortWrapperPath,
      ortDir: join(enginesDir, "onnxruntime"),
      modelPath: join(enginesDir, "rvm/rvm_mobilenetv3_fp32.onnx"),
      framesPath,
      frameW: feedW,
      frameH: feedH,
      frameCount,
      threads: WORKER_THREADS,
    });
    if (!frames) return null;

    const samples: DetectionSample[] = frames.map((f, i) => ({
      t: (i + 0.5) / fps,
      box: f.box,
      coverage: f.coverage,
    }));
    return {
      samples,
      width: probe.width,
      height: probe.height,
      durationSec: probe.durationSec,
      engine: "rvm-onnx",
    };
  } catch (err) {
    logger.warn({ err }, "[subject-detector] detection failed");
    return null;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
