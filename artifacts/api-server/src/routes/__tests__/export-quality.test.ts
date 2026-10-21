import { describe, it, expect } from "vitest";
import type { Router } from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

import exportVideoRouter, {
  resolveQualityDims,
  crfForQuality,
  normalizeQualityOptions,
  estimateExportQuality,
  proVideoCodecArgs,
  isProCodec,
  QUALITY_EXPORT_COST,
  EXPORT_CREDIT_COST,
} from "../generate/export-video";

const execFileAsync = promisify(execFile);

/* Recursively collect METHOD + path from an Express router's layer stack. */
function collectRoutes(router: Router, prefix = ""): Array<{ method: string; path: string }> {
  const out: Array<{ method: string; path: string }> = [];
  const stack = (router as unknown as { stack?: unknown[] }).stack ?? [];
  for (const layer of stack) {
    const l = layer as {
      route?: { path?: string; methods?: Record<string, boolean> };
      handle?: { stack?: unknown[] };
    };
    if (typeof l.route?.path === "string") {
      const methods = Object.keys(l.route.methods ?? {}).filter(
        (m) => m !== "_all" && l.route!.methods![m],
      );
      for (const m of methods) out.push({ method: m.toUpperCase(), path: prefix + l.route.path });
    } else if (Array.isArray(l.handle?.stack)) {
      out.push(...collectRoutes(l.handle as Router, prefix));
    }
  }
  return out;
}

describe("export quality controls (Feature Wave 6)", () => {
  it("charges the flat quality price", () => {
    expect(QUALITY_EXPORT_COST).toBe(150);
    expect(EXPORT_CREDIT_COST).toBe(400);
  });

  it("registers the new routes without forking the pipeline", () => {
    const routes = collectRoutes(exportVideoRouter as Router);
    const has = (method: string, path: string) =>
      routes.some((r) => r.method === method && r.path === path);
    expect(has("POST", "/export-quality")).toBe(true);
    expect(has("POST", "/export-quality/estimate")).toBe(true);
    // The original one-click route is untouched.
    expect(has("POST", "/export-final-video")).toBe(true);
    expect(has("GET", "/export-video-job/:jobId")).toBe(true);
  });

  it("resolves resolution dims per aspect ratio (even, x264-safe)", () => {
    expect(resolveQualityDims("9:16", "1080p")).toEqual([1080, 1920]);
    expect(resolveQualityDims("9:16", "720p")).toEqual([720, 1280]);
    expect(resolveQualityDims("9:16", "4k")).toEqual([2160, 3840]);
    expect(resolveQualityDims("16:9", "720p")).toEqual([1280, 720]);
    expect(resolveQualityDims("16:9", "4k")).toEqual([3840, 2160]);
    expect(resolveQualityDims("1:1", "4k")).toEqual([2160, 2160]);
    expect(resolveQualityDims("4:5", "720p")).toEqual([720, 900]);
    // Unknown aspect falls back to 9:16; unknown resolution to 1080p.
    expect(resolveQualityDims("bogus", "1080p")).toEqual([1080, 1920]);
    expect(resolveQualityDims("9:16", "bogus")).toEqual([1080, 1920]);
    for (const [w, h] of [
      resolveQualityDims("9:16", "720p"),
      resolveQualityDims("4:5", "720p"),
      resolveQualityDims("16:9", "4k"),
    ]) {
      expect(w % 2).toBe(0);
      expect(h % 2).toBe(0);
    }
  });

  it("maps the quality slider to CRF (80 -> 18, legacy default)", () => {
    expect(crfForQuality(80)).toBe(18);
    expect(crfForQuality(100)).toBe(16);
    expect(crfForQuality(0)).toBe(26);
    expect(crfForQuality(50)).toBe(21);
    // Clamped out-of-range input.
    expect(crfForQuality(-10)).toBe(26);
    expect(crfForQuality(500)).toBe(16);
  });

  it("normalizes quality options with legacy-matching defaults", () => {
    expect(normalizeQualityOptions(null)).toEqual({
      enabled: false, resolution: "1080p", quality: 80, fps: 30, container: "mp4", codec: "h264",
    });
    expect(normalizeQualityOptions(undefined)).toEqual({
      enabled: false, resolution: "1080p", quality: 80, fps: 30, container: "mp4", codec: "h264",
    });
    // Garbage is sanitized, never passed through to ffmpeg.
    expect(normalizeQualityOptions({
      enabled: true, resolution: "8k", quality: 999, fps: 120, container: "avi",
    } as never)).toEqual({
      enabled: true, resolution: "1080p", quality: 100, fps: 30, container: "mp4", codec: "h264",
    });
    expect(normalizeQualityOptions({
      enabled: true, resolution: "4k", quality: 90, fps: 60, container: "mov",
    } as never)).toEqual({
      enabled: true, resolution: "4k", quality: 90, fps: 60, container: "mov", codec: "h264",
    });
  });

  it("estimates size + render time in the documented format", () => {
    const est = estimateExportQuality({
      aspectRatio: "9:16", resolution: "1080p", quality: 80, fps: 30,
      container: "mp4", durationSec: 60, hasAudio: true,
    });
    expect(est.settings).toMatchObject({
      width: 1080, height: 1920, fps: 30, crf: 18, container: "mp4",
      resolution: "1080p", quality: 80,
    });
    // Long 1080p hits the VBV upload ceiling — the estimate must say so.
    expect(est.capped).toBe(true);
    expect(est.bytes).toBeLessThanOrEqual(48 * 1024 * 1024);
    expect(est.sizeLabel).toMatch(/^≈ \d+ MB$/);
    expect(est.renderLabel).toMatch(/render$/);
    expect(est.renderSec).toBeGreaterThan(60);
  });

  it("estimates smaller files for 720p and draft quality", () => {
    const hi = estimateExportQuality({
      aspectRatio: "9:16", resolution: "1080p", quality: 100, fps: 30,
      durationSec: 30, hasAudio: true,
    });
    const lo = estimateExportQuality({
      aspectRatio: "9:16", resolution: "720p", quality: 0, fps: 30,
      durationSec: 30, hasAudio: true,
    });
    expect(lo.bytes).toBeLessThan(hi.bytes);
    expect(lo.settings.crf).toBe(26);
    expect(hi.settings.crf).toBe(16);
  });

  it("estimates 60fps as slower/larger than 24fps", () => {
    const slow = estimateExportQuality({
      aspectRatio: "16:9", resolution: "1080p", quality: 80, fps: 60,
      durationSec: 30, hasAudio: false,
    });
    const cine = estimateExportQuality({
      aspectRatio: "16:9", resolution: "1080p", quality: 80, fps: 24,
      durationSec: 30, hasAudio: false,
    });
    expect(slow.bytes).toBeGreaterThan(cine.bytes);
    expect(slow.renderSec).toBeGreaterThan(cine.renderSec);
  });
});

describe("pro finishing codecs (Pro Finishing Door)", () => {
  it("normalizes pro codecs and forces the MOV container", () => {
    expect(normalizeQualityOptions({
      enabled: true, resolution: "1080p", quality: 80, fps: 30, container: "mp4", codec: "prores",
    } as never)).toEqual({
      enabled: true, resolution: "1080p", quality: 80, fps: 30, container: "mov", codec: "prores",
    });
    expect(normalizeQualityOptions({
      enabled: true, resolution: "1080p", quality: 80, fps: 30, container: "mp4", codec: "dnxhr",
    } as never).container).toBe("mov");
    // An unknown codec never reaches ffmpeg — it sanitizes to h264.
    expect(normalizeQualityOptions({ codec: "vp9" } as never).codec).toBe("h264");
    expect(isProCodec("prores")).toBe(true);
    expect(isProCodec("dnxhr")).toBe(true);
    expect(isProCodec("h264")).toBe(false);
  });

  it("builds the encoder args for the render (prores_ks pattern reused)", () => {
    // ProRes 422 HQ via the same prores_ks encoder the background-removal
    // rail uses (profile 4444 there for alpha; 3 = 422 HQ here).
    expect(proVideoCodecArgs("prores")).toEqual([
      "-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le",
    ]);
    expect(proVideoCodecArgs("dnxhr")).toEqual([
      "-c:v", "dnxhd", "-profile:v", "dnxhr_hq", "-pix_fmt", "yuv422p",
    ]);
    // h264 keeps the caller's x264 block — no pro args.
    expect(proVideoCodecArgs("h264")).toEqual([]);
    expect(proVideoCodecArgs(undefined)).toEqual([]);
  });

  it("estimates pro renders at the codec's real fixed rate, uncapped", () => {
    const est = estimateExportQuality({
      aspectRatio: "16:9", resolution: "1080p", quality: 80, fps: 30,
      container: "mp4", codec: "prores", durationSec: 60, hasAudio: true,
    });
    expect(est.settings.codec).toBe("prores");
    expect(est.settings.container).toBe("mov");
    expect(est.settings.crf).toBe(0); // CRF does not exist for ProRes
    expect(est.capped).toBe(false); // R2 delivery has no per-file ceiling
    // 220 Mbps video + 192 kbps audio for 60s ≈ 1.65 GB.
    expect(est.bytes).toBeGreaterThan(1.5 * 1024 * 1024 * 1024);
    expect(est.bytes).toBeLessThan(1.8 * 1024 * 1024 * 1024);

    const dnx = estimateExportQuality({
      aspectRatio: "16:9", resolution: "1080p", quality: 80, fps: 30,
      codec: "dnxhr", durationSec: 60, hasAudio: false,
    });
    expect(dnx.settings.codec).toBe("dnxhr");
    // DNxHR HQ (175 Mbps) is lighter than ProRes 422 HQ (220 Mbps).
    expect(dnx.bytes).toBeLessThan(est.bytes);
  });

  it("encodes real ProRes and DNxHR files with those args (ffmpeg)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pro-codec-test-"));
    try {
      const srcPath = join(dir, "src.mp4");
      await execFileAsync("ffmpeg", [
        "-y", "-f", "lavfi", "-i", "testsrc=duration=0.5:size=320x568:rate=30",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", srcPath,
      ], { timeout: 60_000 });

      const probeCodec = async (file: string): Promise<string> => {
        const { stdout } = await execFileAsync("ffprobe", [
          "-v", "quiet", "-print_format", "json", "-show_streams", file,
        ], { timeout: 30_000 });
        const info = JSON.parse(stdout) as { streams?: Array<{ codec_name?: string }> };
        return info.streams?.[0]?.codec_name ?? "";
      };

      const proresPath = join(dir, "out-prores.mov");
      await execFileAsync("ffmpeg", [
        "-y", "-i", srcPath, ...proVideoCodecArgs("prores"), proresPath,
      ], { timeout: 120_000 });
      expect(await probeCodec(proresPath)).toBe("prores");

      const dnxPath = join(dir, "out-dnxhr.mov");
      await execFileAsync("ffmpeg", [
        "-y", "-i", srcPath, ...proVideoCodecArgs("dnxhr"), dnxPath,
      ], { timeout: 120_000 });
      expect(await probeCodec(dnxPath)).toBe("dnxhd");
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }, 180_000);
});
