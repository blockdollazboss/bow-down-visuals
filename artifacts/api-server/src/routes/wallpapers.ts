import { Router } from "express";
import { z } from "zod";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, mkdtemp, rm } from "fs/promises";
import { existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";
import { ZipArchive } from "archiver";
import { requireAuth } from "../middlewares/require-auth";
import { chargeCredits, refundCredits, OutOfCreditsError } from "../lib/credits";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../lib/objectStorage";
import { saveGeneration } from "../lib/save-generation";
import { WALLPAPER_PRESETS, presetByKey, type WallpaperPreset } from "../lib/wallpaper-presets";
import { stampImageWithDisclosure, stampVideoFileWithDisclosure } from "../lib/disclosure-metadata";
import { aiDisclosureMetadataText, PROVENANCE_PLATFORM } from "../lib/provenance";

const router = Router();
const execFileAsync = promisify(execFile);

const SCREENSAVER_RENDER_COST = Number(process.env["WALLPAPER_SCREENSAVER_CREDITS"]) || 400;
// Branded-by-default (owner law, Oct 22): branded renders are free; a clean
// (unbranded) render is the exception and is charged. This 400 is MAPPED
// from the site's clean-export rail (/api/export-final-video: branded
// exports free, clean export 400).
const CLEAN_RENDER_COST = Number(process.env["WALLPAPER_CLEAN_CREDITS"]) || 400;

export const BRAND_FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
] as const;

/** Resolve the first brand font that actually exists on this box, or null.
 *  A missing font must never fail a render — the text overlay is skipped. */
export function resolveBrandFontFile(
  candidates: readonly string[] = BRAND_FONT_CANDIDATES,
  exists: (p: string) => boolean = (p) => existsSync(p),
): string | null {
  for (const c of candidates) {
    if (exists(c)) return c;
  }
  return null;
}

/** Escape text for an ffmpeg drawtext `text='…'` value: backslashes first,
 *  then colons, single quotes, %, and the other filter-syntax separators. */
export function escapeDrawtextText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\r?\n/g, " ");
}

export function buildDrawtextFilter(opts: {
  text: string;
  fontFile: string;
  preset: WallpaperPreset;
  bottomOffset: number;
}): string {
  const fontsize = Math.max(24, Math.round(opts.preset.width * 0.045));
  return (
    `drawtext=fontfile=${opts.fontFile}:text='${escapeDrawtextText(opts.text)}':` +
    `fontcolor=white:fontsize=${fontsize}:borderw=2:bordercolor=black:` +
    `shadowcolor=black@0.5:shadowx=2:shadowy=2:` +
    `x=(w-text_w)/2:y=h-text_h-${opts.bottomOffset}`
  );
}

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

const httpUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((v) => isHttpUrl(v), { message: "must be an http(s) URL" });

const brandNameSchema = z.string().trim().max(120);

export const renderSchema = z.object({
  sourceUrl: httpUrlSchema,
  presetKey: z.string().trim().min(1),
  logoUrl: z.union([httpUrlSchema, z.null()]).optional(),
  branded: z.boolean().optional().default(true),
  brandName: z.union([brandNameSchema, z.null()]).optional(),
  /** AI disclosure (lane F7): absent = ON; explicit false opts out. */
  aiDisclosure: z.boolean().optional(),
});

export const screensaverSchema = z.object({
  videoUrl: httpUrlSchema,
  presetKey: z.string().trim().min(1),
  seconds: z.number().int().min(10).max(120).optional().default(60),
  logoUrl: z.union([httpUrlSchema, z.null()]).optional(),
  branded: z.boolean().optional().default(true),
  brandName: z.union([brandNameSchema, z.null()]).optional(),
  /** AI disclosure (lane F7): absent = ON; explicit false opts out. */
  aiDisclosure: z.boolean().optional(),
});

export const packDownloadSchema = z.object({
  urls: z.array(httpUrlSchema).min(1).max(12),
  name: z.string().trim().max(120).optional(),
});

export { SCREENSAVER_RENDER_COST, CLEAN_RENDER_COST };

export function buildWallpaperScaleFilter(preset: WallpaperPreset): string {
  return `scale=${preset.width}:${preset.height}:force_original_aspect_ratio=increase,crop=${preset.width}:${preset.height}`;
}

/* ── Logo handling rule (owner correction, Oct 22 23:39 EDT) ──────────
   A creator's logo is composited ONLY as the complete, intact artwork —
   never cropped, never sliced into parts (no banner-only or icon-only
   cuts), never redrawn. Scale and placement only. The logo stream is
   scaled by WIDTH ONLY with height auto (aspect preserved); NO crop
   filter may ever touch it. The crop in buildWallpaperScaleFilter
   applies to the SOURCE canvas stream ([0:v]) only, never to [1:v].
   If a very tall logo would exceed ~30% of canvas height at that width,
   it is instead fit inside a bounding box with decrease-only scaling —
   the whole logo stays visible, letterboxed by transparency. */
export interface LogoDimensions {
  width: number;
  height: number;
}

export const LOGO_MAX_CANVAS_HEIGHT_RATIO = 0.3;

export function buildLogoScaleFilter(
  preset: WallpaperPreset,
  logoDimensions?: LogoDimensions | null,
): string {
  const logoWidth = Math.round(preset.width * 0.16);
  if (logoDimensions && logoDimensions.width > 0 && logoDimensions.height > 0) {
    const scaledHeight = logoWidth * (logoDimensions.height / logoDimensions.width);
    const maxHeight = Math.floor(preset.height * LOGO_MAX_CANVAS_HEIGHT_RATIO);
    if (scaledHeight > maxHeight) {
      return `scale=${logoWidth}:${maxHeight}:force_original_aspect_ratio=decrease`;
    }
  }
  return `scale=${logoWidth}:-1`;
}

/** Probe a downloaded logo's pixel size (ffprobe). Fail-open: any probe
 *  failure returns null and the builder uses the width-only path. */
export async function probeLogoDimensions(filePath: string): Promise<LogoDimensions | null> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height",
        "-of", "json",
        filePath,
      ],
      { timeout: 30_000 },
    );
    const parsed = JSON.parse(stdout) as { streams?: Array<{ width?: number; height?: number }> };
    const s = parsed.streams?.[0];
    if (s && typeof s.width === "number" && typeof s.height === "number" && s.width > 0 && s.height > 0) {
      return { width: s.width, height: s.height };
    }
    return null;
  } catch {
    return null;
  }
}

export function buildWallpaperFfmpegArgs(opts: {
  inputPath: string;
  logoPath?: string | null;
  outputPath: string;
  preset: WallpaperPreset;
  brandName?: string | null;
  fontFile?: string | null;
  logoDimensions?: LogoDimensions | null;
}): string[] {
  const { inputPath, logoPath, outputPath, preset } = opts;
  const brandName = opts.brandName?.trim() ? opts.brandName.trim() : null;
  const hasText = Boolean(brandName && opts.fontFile);
  const margin = Math.round(preset.height * 0.06);
  if (logoPath && hasText) {
    // Text below the logo: lift the logo to leave a band for the name,
    // then draw the name centered near the bottom (2% margin).
    const logoBottom = margin + Math.round(preset.height * 0.05);
    const textBottom = Math.round(preset.height * 0.02);
    const filterComplex =
      `[0:v]${buildWallpaperScaleFilter(preset)}[bg];` +
      `[1:v]${buildLogoScaleFilter(preset, opts.logoDimensions)}[logo];` +
      `[bg][logo]overlay=(W-w)/2:H-h-${logoBottom}[withlogo];` +
      `[withlogo]${buildDrawtextFilter({ text: brandName!, fontFile: opts.fontFile!, preset, bottomOffset: textBottom })}[vout]`;
    return ["-y", "-i", inputPath, "-i", logoPath, "-filter_complex", filterComplex, "-map", "[vout]", outputPath];
  }
  if (logoPath) {
    const filterComplex =
      `[0:v]${buildWallpaperScaleFilter(preset)}[bg];` +
      `[1:v]${buildLogoScaleFilter(preset, opts.logoDimensions)}[logo];` +
      `[bg][logo]overlay=(W-w)/2:H-h-${margin}`;
    return ["-y", "-i", inputPath, "-i", logoPath, "-filter_complex", filterComplex, outputPath];
  }
  if (hasText) {
    const vf = `${buildWallpaperScaleFilter(preset)},${buildDrawtextFilter({ text: brandName!, fontFile: opts.fontFile!, preset, bottomOffset: margin })}`;
    return ["-y", "-i", inputPath, "-vf", vf, outputPath];
  }
  return ["-y", "-i", inputPath, "-vf", buildWallpaperScaleFilter(preset), outputPath];
}

export function buildScreensaverFfmpegArgs(opts: {
  inputPath: string;
  outputPath: string;
  preset: WallpaperPreset;
  seconds: number;
  logoPath?: string | null;
  brandName?: string | null;
  fontFile?: string | null;
  logoDimensions?: LogoDimensions | null;
}): string[] {
  const { inputPath, outputPath, preset, seconds } = opts;
  const brandName = opts.brandName?.trim() ? opts.brandName.trim() : null;
  const hasText = Boolean(brandName && opts.fontFile);
  const margin = Math.round(preset.height * 0.06);
  const encode = ["-t", String(seconds), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an"];
  if (opts.logoPath && hasText) {
    const logoBottom = margin + Math.round(preset.height * 0.05);
    const textBottom = Math.round(preset.height * 0.02);
    const filterComplex =
      `[0:v]${buildWallpaperScaleFilter(preset)}[bg];` +
      `[1:v]${buildLogoScaleFilter(preset, opts.logoDimensions)}[logo];` +
      `[bg][logo]overlay=(W-w)/2:H-h-${logoBottom}[withlogo];` +
      `[withlogo]${buildDrawtextFilter({ text: brandName!, fontFile: opts.fontFile!, preset, bottomOffset: textBottom })}[vout]`;
    return ["-y", "-stream_loop", "-1", "-i", inputPath, "-i", opts.logoPath, "-filter_complex", filterComplex, "-map", "[vout]", ...encode, outputPath];
  }
  if (opts.logoPath) {
    const filterComplex =
      `[0:v]${buildWallpaperScaleFilter(preset)}[bg];` +
      `[1:v]${buildLogoScaleFilter(preset, opts.logoDimensions)}[logo];` +
      `[bg][logo]overlay=(W-w)/2:H-h-${margin}[vout]`;
    return ["-y", "-stream_loop", "-1", "-i", inputPath, "-i", opts.logoPath, "-filter_complex", filterComplex, "-map", "[vout]", ...encode, outputPath];
  }
  if (hasText) {
    const vf = `${buildWallpaperScaleFilter(preset)},${buildDrawtextFilter({ text: brandName!, fontFile: opts.fontFile!, preset, bottomOffset: margin })}`;
    return ["-y", "-stream_loop", "-1", "-i", inputPath, "-vf", vf, ...encode, outputPath];
  }
  return [
    "-y",
    "-stream_loop", "-1",
    "-i", inputPath,
    "-vf", buildWallpaperScaleFilter(preset),
    "-t", String(seconds),
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-an",
    outputPath,
  ];
}

export function sanitizePackName(name?: string | null): string {
  if (!name) return "wallpaper-pack";
  const cleaned = name
    .replace(/\.zip$/i, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return cleaned || "wallpaper-pack";
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Could not download source (${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("Downloaded source was empty.");
  await writeFile(dest, buf);
}

async function downloadToBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Could not download ${url} (${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error(`Downloaded file was empty: ${url}`);
  return buf;
}

function validationError(res: any, parsed: any) {
  res.status(400).json({
    error: "Invalid request.",
    details: (parsed.error.issues as Array<{ path: PropertyKey[]; message: string }>).map((i) => ({
      field: i.path.map(String).join("."),
      message: i.message,
    })),
  });
}

router.get("/wallpapers/presets", requireAuth, (_req, res) => {
  res.json({ presets: WALLPAPER_PRESETS });
});

router.post("/wallpapers/render", requireAuth, async (req, res) => {
  const parsed = renderSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    validationError(res, parsed);
    return;
  }
  const preset = presetByKey(parsed.data.presetKey);
  if (!preset) {
    res.status(400).json({ error: "Invalid request.", details: [{ field: "presetKey", message: "unknown preset" }] });
    return;
  }

  // Branded by default: only an explicit branded:false is the clean
  // exception, and clean is charged (see CLEAN_RENDER_COST above).
  const branded = parsed.data.branded ?? true;
  const creditCost = branded ? 0 : CLEAN_RENDER_COST;
  let chargedClean = false;
  if (!branded) {
    const currentCredits = req.userCredits ?? 0;
    if (currentCredits < CLEAN_RENDER_COST) {
      res.status(402).json({
        error: "out_of_credits",
        message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
      });
      return;
    }
    try {
      await chargeCredits(req.userId!, CLEAN_RENDER_COST, {
        action: "Wallpaper Clean Render",
      });
      chargedClean = true;
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
        return;
      }
      throw err;
    }
  }

  const workDir = await mkdtemp(join(tmpdir(), "wallpaper-"));
  const inputPath = join(workDir, "input");
  const logoPath = join(workDir, "logo");
  const outputPath = join(workDir, "wallpaper.png");

  try {
    await downloadToFile(parsed.data.sourceUrl, inputPath);
    let hasLogo = false;
    if (branded && parsed.data.logoUrl) {
      await downloadToFile(parsed.data.logoUrl, logoPath);
      hasLogo = true;
    }
    const brandName = branded ? (parsed.data.brandName?.trim() || null) : null;
    // Skip the text overlay silently when no candidate font exists.
    const fontFile = brandName ? resolveBrandFontFile() : null;
    // Logo rule: probe the intact artwork's size so a very tall logo
    // takes the bounding-box path; the artwork itself is never cropped.
    const logoDimensions = hasLogo ? await probeLogoDimensions(logoPath) : null;
    const args = buildWallpaperFfmpegArgs({
      inputPath,
      logoPath: hasLogo ? logoPath : null,
      outputPath,
      preset,
      brandName,
      fontFile,
      logoDimensions,
    });
    await execFileAsync("ffmpeg", args, { timeout: 300_000 });

    /* AI disclosure (lane F7): DEFAULT ON — an XMP packet carrying the
       disclosure is injected into the PNG unless the request explicitly
       opted out. Metadata-only; the pixels never change. */
    let buffer: Buffer = await readFile(outputPath);
    let aiDisclosureState: "embedded" | "off" | "stamp_failed" =
      parsed.data.aiDisclosure === false ? "off" : "embedded";
    if (parsed.data.aiDisclosure !== false) {
      const stamped = stampImageWithDisclosure(buffer, {
        text: aiDisclosureMetadataText({ createdWith: { tool: "Wallpaper Studio", model: null, platform: PROVENANCE_PLATFORM } }),
        tool: "Wallpaper Studio",
        title: preset.label,
      });
      if (stamped.applied) buffer = stamped.buffer;
      else aiDisclosureState = "stamp_failed";
    }
    const objectName = `wallpapers/${req.userId}/${randomUUID()}.png`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "image/png");
    const url = await refreshSupabaseStorageUrl(storageRef);

    await saveGeneration({
      userId: req.userId!,
      type: "wallpaper",
      title: preset.label,
      fileUrl: url,
      creditsSpent: branded ? 0 : CLEAN_RENDER_COST,
    });

    res.json({ url, presetKey: preset.key, width: preset.width, height: preset.height, branded, creditCost, aiDisclosure: aiDisclosureState });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Wallpaper render failed.";
    req.log?.error?.({ err: message }, "[wallpapers] render failed");
    if (chargedClean) {
      await refundCredits(req.userId!, CLEAN_RENDER_COST, {
        action: "Wallpaper Clean Render — Refund",
      }).catch(() => {});
    }
    res.status(502).json({ error: message });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

router.post("/wallpapers/screensaver-render", requireAuth, async (req, res) => {
  const parsed = screensaverSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    validationError(res, parsed);
    return;
  }
  const preset = presetByKey(parsed.data.presetKey);
  if (!preset) {
    res.status(400).json({ error: "Invalid request.", details: [{ field: "presetKey", message: "unknown preset" }] });
    return;
  }
  if (preset.kind !== "desktop") {
    res.status(400).json({ error: "Invalid request.", details: [{ field: "presetKey", message: "screensaver requires a desktop preset" }] });
    return;
  }

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < SCREENSAVER_RENDER_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }

  let creditsAfter: number;
  try {
    creditsAfter = await chargeCredits(req.userId!, SCREENSAVER_RENDER_COST, {
      action: "Screensaver Loop Render",
    });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }
  void creditsAfter;

  // Branded by default, same as the wallpaper render — but the charge
  // stays 400 flat regardless (this is a video render; no clean charge).
  const branded = parsed.data.branded ?? true;

  const workDir = await mkdtemp(join(tmpdir(), "screensaver-"));
  const inputPath = join(workDir, "input.mp4");
  const logoPath = join(workDir, "logo");
  const outputPath = join(workDir, "screensaver.mp4");

  try {
    await downloadToFile(parsed.data.videoUrl, inputPath);
    let hasLogo = false;
    if (branded && parsed.data.logoUrl) {
      await downloadToFile(parsed.data.logoUrl, logoPath);
      hasLogo = true;
    }
    const brandName = branded ? (parsed.data.brandName?.trim() || null) : null;
    const fontFile = brandName ? resolveBrandFontFile() : null;
    const logoDimensions = hasLogo ? await probeLogoDimensions(logoPath) : null;
    const args = buildScreensaverFfmpegArgs({
      inputPath,
      outputPath,
      preset,
      seconds: parsed.data.seconds,
      logoPath: hasLogo ? logoPath : null,
      brandName,
      fontFile,
      logoDimensions,
    });
    await execFileAsync("ffmpeg", args, { timeout: 600_000 });

    /* AI disclosure (lane F7): DEFAULT ON — stream-copy stamp of the
       disclosure into the loop's container metadata, same rule as the
       still render above. A failed stamp ships the unstamped loop and
       reports stamp_failed. */
    let finalPath = outputPath;
    let aiDisclosureState: "embedded" | "off" | "stamp_failed" =
      parsed.data.aiDisclosure === false ? "off" : "embedded";
    if (parsed.data.aiDisclosure !== false) {
      const stampedPath = join(workDir, "screensaver-disclosed.mp4");
      const stamped = await stampVideoFileWithDisclosure(outputPath, stampedPath, {
        text: aiDisclosureMetadataText({ createdWith: { tool: "Wallpaper Studio", model: null, platform: PROVENANCE_PLATFORM } }),
        tool: "Wallpaper Studio",
        title: preset.label,
      });
      if (stamped) finalPath = stampedPath;
      else aiDisclosureState = "stamp_failed";
    }
    const buffer = await readFile(finalPath);
    const objectName = `wallpapers/${req.userId}/${randomUUID()}.mp4`;
    const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "video/mp4");
    const url = await refreshSupabaseStorageUrl(storageRef);

    await saveGeneration({
      userId: req.userId!,
      type: "screensaver",
      title: preset.label,
      fileUrl: url,
      creditsSpent: SCREENSAVER_RENDER_COST,
    });

    res.json({
      url,
      presetKey: preset.key,
      width: preset.width,
      height: preset.height,
      seconds: parsed.data.seconds,
      creditCost: SCREENSAVER_RENDER_COST,
      branded,
      aiDisclosure: aiDisclosureState,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Screensaver render failed.";
    req.log?.error?.({ err: message }, "[wallpapers] screensaver failed");
    await refundCredits(req.userId!, SCREENSAVER_RENDER_COST, {
      action: "Screensaver Loop Render — Refund",
    }).catch(() => {});
    res.status(502).json({ error: message });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

router.post("/wallpapers/pack-download", requireAuth, async (req, res) => {
  const parsed = packDownloadSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    validationError(res, parsed);
    return;
  }

  // Download everything first — if any URL fails we answer 502 and
  // never send a partial zip.
  let buffers: Buffer[];
  try {
    buffers = await Promise.all(parsed.data.urls.map((u) => downloadToBuffer(u)));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not download pack files.";
    req.log?.error?.({ err: message }, "[wallpapers] pack download failed");
    res.status(502).json({ error: message });
    return;
  }

  const safeName = sanitizePackName(parsed.data.name);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}.zip"`);

  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on("error", (err) => {
    req.log?.error?.({ err: err.message }, "[wallpapers] pack zip failed");
    if (!res.headersSent) {
      res.status(502).json({ error: "Could not build the wallpaper pack." });
    } else {
      res.destroy(err);
    }
  });
  archive.pipe(res);
  buffers.forEach((buf, i) => {
    let base = `wallpaper-${i + 1}.png`;
    try {
      const raw = decodeURIComponent(new URL(parsed.data.urls[i]!).pathname.split("/").pop() || "");
      const safe = raw.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
      if (safe && safe.includes(".")) base = safe;
    } catch {
      // keep fallback name
    }
    const entryName = `${String(i + 1).padStart(2, "0")}-${base}`;
    archive.append(buf, { name: entryName });
  });
  await archive.finalize();
});

export default router;
