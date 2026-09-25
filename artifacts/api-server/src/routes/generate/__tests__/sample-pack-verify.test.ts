/**
 * One-off verification: actually run every synth recipe through ffmpeg.
 * Not part of the committed suite (spawns real ffmpeg processes).
 */
import { describe, expect, it } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import {
  buildSynthArgs,
  SAMPLE_TYPE_KEYS,
} from "../sample-pack-pricing";

const execFileAsync = promisify(execFile);
const synthTypes = SAMPLE_TYPE_KEYS.filter((t) => t !== "melody" && t !== "bass");

describe("synth recipes render real audio", () => {
  for (const type of synthTypes) {
    it(`${type} renders a valid WAV`, async () => {
      const out = join(tmpdir(), `verify-${type}-${randomUUID()}.wav`);
      const { args, durationSec } = buildSynthArgs(type as never, out, 1);
      await execFileAsync("ffmpeg", ["-y", "-v", "error", ...args], { timeout: 30_000 });
      const stat = await fs.stat(out);
      expect(stat.size).toBeGreaterThan(1000);
      // Verify it's a real WAV with audio content (not silence).
      const { stdout } = await execFileAsync("ffprobe", [
        "-v", "error", "-show_entries", "stream=codec_name,sample_rate,channels",
        "-of", "csv=p=0", out,
      ]);
      expect(stdout).toContain("pcm_s16le");
      expect(stdout).toContain("44100");
      // Check mean volume is above silence (volumedetect logs to stderr).
      const vd = await execFileAsync("ffmpeg", [
        "-hide_banner", "-i", out, "-af", "volumedetect", "-f", "null", "-",
      ]).catch((e: unknown) => e as { stderr?: string; stdout?: string });
      const volOut = (vd as { stderr?: string }).stderr ?? "";
      const meanMatch = volOut.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
      expect(meanMatch).not.toBeNull();
      expect(parseFloat(meanMatch![1])).toBeGreaterThan(-60);
      await fs.unlink(out).catch(() => {});
      expect(durationSec).toBeGreaterThan(0);
    }, 45000);
  }
});
