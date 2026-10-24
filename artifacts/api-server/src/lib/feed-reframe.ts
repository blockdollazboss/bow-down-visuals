/**
 * Feed-format reframe: center-crop a generated clip to a target aspect
 * (1:1 square / 4:5 feed portrait) — the same Smart Reframe crop the
 * standalone /auto-reframe route performs, reused in-flow when a model
 * cannot emit the requested format natively (see clip-pricing.ts
 * resolveFormatDelivery). Part of clip delivery: no separate charge.
 */
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export const REFRAME_OUTPUT_SIZE: Record<"1:1" | "4:5", [number, number]> = {
  "1:1": [1080, 1080],
  "4:5": [1080, 1350],
};

const REFRAME_RATIO: Record<"1:1" | "4:5", number> = { "1:1": 1, "4:5": 4 / 5 };

/** Pure ffmpeg argument builder (unit-tested). Mirrors auto-reframe.ts. */
export function buildReframeArgs(inputPath: string, outputPath: string, aspect: "1:1" | "4:5"): string[] {
  const targetRatio = REFRAME_RATIO[aspect];
  const [outW, outH] = REFRAME_OUTPUT_SIZE[aspect];
  const cropFilter =
    `crop='if(gt(iw/ih,${targetRatio.toFixed(6)}),ih*${targetRatio.toFixed(6)},iw)':` +
    `'if(gt(iw/ih,${targetRatio.toFixed(6)}),ih,iw/${targetRatio.toFixed(6)})'`;
  return [
    "-y", "-i", inputPath,
    "-vf", `${cropFilter},scale=${outW}:${outH}:force_original_aspect_ratio=increase,crop=${outW}:${outH}`,
    "-c:v", "libx264", "-preset", "fast", "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    outputPath,
  ];
}

/** Reframes inputPath into outputPath at the target aspect. Throws on failure. */
export async function reframeVideoFile(inputPath: string, outputPath: string, aspect: "1:1" | "4:5"): Promise<void> {
  await execFileAsync("ffmpeg", buildReframeArgs(inputPath, outputPath, aspect), { timeout: 300_000 });
}
