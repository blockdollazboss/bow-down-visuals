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
import {
  chargeCredits,
  refundCredits,
  buildChargeIdempotencyKey,
  voidChargeIdempotencyKey,
  OutOfCreditsError,
} from "../lib/credits";
import {
  findStoredGenerationResult,
  storeGenerationResult,
} from "../lib/generation-stored-results";
import {
  uploadMediaToSupabaseStorage,
  refreshSupabaseStorageUrl,
} from "../lib/objectStorage";
import { saveGeneration } from "../lib/save-generation";
import { readSiteAsset } from "../lib/theme-kit-build";
import { WALLPAPER_PRESETS, presetByKey, type WallpaperPreset } from "../lib/wallpaper-presets";
import { stampImageWithDisclosure, stampVideoFileWithDisclosure } from "../lib/disclosure-metadata";
import { aiDisclosureMetadataText, PROVENANCE_PLATFORM } from "../lib/provenance";

const router = Router();
const execFileAsync = promisify(execFile);

const SCREENSAVER_RENDER_COST = Number(process.env["WALLPAPER_SCREENSAVER_CREDITS"]) || 300;
// Branded-by-default (owner law, Oct 22): branded renders are free; a clean
// (unbranded) render is the exception and is charged. This 400 is MAPPED
// from the site's clean-export rail (/api/export-final-video: branded
// exports free, clean export 400).
const CLEAN_RENDER_COST = Number(process.env["WALLPAPER_CLEAN_CREDITS"]) || 400;
// Pack of 10 clean wallpapers — the owner-ruled bundle price (Oct 27, 2026,
// ruled by delegation; price-accuracy audit #6, Nov 2, 2026: the ruled
// "pack of 10 = 500" was never built and the desk showed an 800 VB
// 3-piece clean set instead). One flat charge for exactly ten clean
// (unbranded) renders — never ten per-render charges. Branded renders
// stay free and single clean renders stay at CLEAN_RENDER_COST; this
// pack is the bulk deal between them.
const PACK_OF_10_COST = Number(process.env["WALLPAPER_PACK10_CREDITS"]) || 500;
export const PACK_OF_10_COUNT = 10;

/* Replay safety (CA-7): the three charged rails in this file (clean
   render, screensaver loop, pack of 10) key on a server-derived
   idempotency key over the parsed request intent, so a re-ask of the
   same render (double-tap, retry, timeout resend) is answered from
   the stored result instead of charging again and re-rendering.
   Branded single renders are FREE and stay completely untouched (no
   key, no store). Every refund path VOIDS its key, so a refunded
   render always runs fresh on retry. Fresh responses are
   byte-identical to before; stored lookups fail open. */
const CLEAN_RENDER_SCOPE = "wallpaper-clean-render";
const SCREENSAVER_SCOPE = "wallpaper-screensaver-loop";
const PACK_10_SCOPE = "wallpaper-pack-10";
const REPLAY_STORE_MAX = 500;
const storedWallpaperResults = new Map<string, Record<string, unknown>>();
const inFlightWallpapers = new Map<string, Promise<Record<string, unknown>>>();

function storeWallpaperInProcess(key: string, body: Record<string, unknown>): void {
  if (storedWallpaperResults.size >= REPLAY_STORE_MAX) {
    const first = storedWallpaperResults.keys().next().value;
    if (first !== undefined) storedWallpaperResults.delete(first);
  }
  storedWallpaperResults.set(key, body);
}

export function __resetWallpaperReplayCache(): void {
  storedWallpaperResults.clear();
  inFlightWallpapers.clear();
}

/** Shared replay pre-check for this file's charged rails: serves the
 *  stored body (+ `replayed: true`) and returns true when the request
 *  has been answered — durable store, in-process store, or a twin
 *  still in flight. A failed twin falls through to a fresh run. */
async function serveWallpaperReplayIfAny(
  scope: string,
  key: string,
  userId: string,
  res: { json: (b: unknown) => void },
): Promise<boolean> {
  const durable = await findStoredGenerationResult(scope, key, userId);
  if (durable) {
    res.json({ ...durable, replayed: true });
    return true;
  }
  const local = storedWallpaperResults.get(key);
  if (local) {
    res.json({ ...local, replayed: true });
    return true;
  }
  const pending = inFlightWallpapers.get(key);
  if (pending) {
    try {
      const twinBody = await pending;
      const stored = storedWallpaperResults.get(key) ?? twinBody;
      res.json({ ...stored, replayed: true });
      return true;
    } catch {
      /* The twin failed and refunded (voiding the key) — run fresh. */
    }
  }
  return false;
}

/** Register an in-flight run for same-key twins; returns the finishers. */
function beginWallpaperFlight(key: string): {
  flight: Promise<Record<string, unknown>>;
  resolve: (body: Record<string, unknown>) => void;
  reject: (err: unknown) => void;
  cleanup: () => void;
} {
  let resolve: (body: Record<string, unknown>) => void = () => {};
  let reject: (err: unknown) => void = () => {};
  const flight = new Promise<Record<string, unknown>>((res, rej) => { resolve = res; reject = rej; });
  flight.catch(() => {});
  inFlightWallpapers.set(key, flight);
  return {
    flight,
    resolve,
    reject,
    cleanup: () => { if (inFlightWallpapers.get(key) === flight) inFlightWallpapers.delete(key); },
  };
}

/** Store a fresh success (in-process + durable) and answer it — or
 *  the stored body, if a twin's store landed first. */
async function serveWallpaperSuccess(
  scope: string,
  key: string,
  userId: string,
  body: Record<string, unknown>,
  res: { json: (b: unknown) => void },
): Promise<void> {
  storeWallpaperInProcess(key, body);
  await storeGenerationResult(scope, key, userId, body);
  const stored = storedWallpaperResults.get(key);
  if (stored && stored !== body) {
    res.json({ ...stored, replayed: true });
    return;
  }
  res.json(body);
}

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

const packDownloadSchema = z.object({
  urls: z.array(httpUrlSchema).min(1).max(12),
  name: z.string().trim().max(120).optional(),
});

export const packOf10Schema = z.object({
  items: z
    .array(
      z.object({
        sourceUrl: httpUrlSchema,
        presetKey: z.string().trim().min(1),
      }),
    )
    .length(PACK_OF_10_COUNT),
  /** AI disclosure (lane F7): absent = ON; explicit false opts out. */
  aiDisclosure: z.boolean().optional(),
});

export { SCREENSAVER_RENDER_COST, CLEAN_RENDER_COST, PACK_OF_10_COST };

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
interface LogoDimensions {
  width: number;
  height: number;
}

const LOGO_MAX_CANVAS_HEIGHT_RATIO = 0.3;

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
async function probeLogoDimensions(filePath: string): Promise<LogoDimensions | null> {
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

/* ── Site-asset resolution (QC-200 fix queue #11) ─────────────────────
   The server must never fetch its OWN shipped assets over HTTP. The
   theme-pack device desk sends the pack grounds and the logo lockups
   as absolute URLs on the site's own origin; on the staging deploy
   that origin sits behind the password gate (lib/staging-gate.ts),
   which answers any cookie-less request 401 — and a server-side fetch
   carries no cookie — so every device-set and single-size render died
   at its first step ("Could not download source (401)") while the kit
   rail, which reads the same art from disk, worked on the same deploy.
   A URL whose path names a file in the shipped public tree resolves
   from disk instead; genuinely external URLs (storage buckets,
   creator art) still go over HTTP exactly as before. The hairpin
   fetch was pure overhead in production too — this removes it there
   as well. */

/** The site-relative path a URL names, or null when the URL is
 *  unparseable or its path could climb out of the asset roots once
 *  joined onto them (the path is caller-supplied, so traversal-shaped
 *  segments are refused outright rather than sanitized into place). */
export function siteAssetPathForUrl(url: string): string | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
  if (pathname.includes("\\") || pathname.includes("\0")) return null;
  const segments = pathname.split("/").filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  if (segments.some((s) => s === ".." || s === ".")) return null;
  return `/${segments.join("/")}`;
}

function siteAssetBytes(url: string): Buffer | null {
  const path = siteAssetPathForUrl(url);
  return path ? readSiteAsset(path) : null;
}

async function downloadToFile(url: string, dest: string): Promise<void> {
  const local = siteAssetBytes(url);
  if (local) {
    await writeFile(dest, local);
    return;
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Could not download source (${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error("Downloaded source was empty.");
  await writeFile(dest, buf);
}

async function downloadToBuffer(url: string): Promise<Buffer> {
  const local = siteAssetBytes(url);
  if (local) return local;
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
  /* Replay safety (CA-7): keyed only on the clean (charged) path —
     the free branded path is untouched. A re-ask of the same clean
     render is answered from the stored result. */
  let cleanKey: string | null = null;
  let cleanFlight: ReturnType<typeof beginWallpaperFlight> | null = null;
  if (!branded) {
    cleanKey = buildChargeIdempotencyKey(CLEAN_RENDER_SCOPE, req.userId!, undefined, {
      sourceUrl: parsed.data.sourceUrl,
      presetKey: parsed.data.presetKey,
      logoUrl: parsed.data.logoUrl ?? null,
      branded,
      brandName: parsed.data.brandName ?? null,
      aiDisclosure: parsed.data.aiDisclosure ?? null,
    });
    if (await serveWallpaperReplayIfAny(CLEAN_RENDER_SCOPE, cleanKey, req.userId!, res)) return;

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
      }, { idempotencyKey: cleanKey });
      chargedClean = true;
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
        return;
      }
      throw err;
    }
    cleanFlight = beginWallpaperFlight(cleanKey);
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

    const renderBody: Record<string, unknown> = { url, presetKey: preset.key, width: preset.width, height: preset.height, branded, creditCost, aiDisclosure: aiDisclosureState };
    if (cleanKey && cleanFlight) {
      await serveWallpaperSuccess(CLEAN_RENDER_SCOPE, cleanKey, req.userId!, renderBody, res);
      cleanFlight.resolve(renderBody);
      cleanFlight.cleanup();
    } else {
      res.json(renderBody);
    }
  } catch (err) {
    if (cleanFlight) {
      cleanFlight.reject(err);
      cleanFlight.cleanup();
    }
    const message = err instanceof Error ? err.message : "Wallpaper render failed.";
    req.log?.error?.({ err: message }, "[wallpapers] render failed");
    if (chargedClean) {
      await refundCredits(req.userId!, CLEAN_RENDER_COST, {
        action: "Wallpaper Clean Render — Refund",
      }).catch(() => {});
      if (cleanKey) await voidChargeIdempotencyKey(cleanKey);
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

  /* Replay safety (CA-7): key from the parsed intent; a re-ask is
     answered from the stored loop — no second charge, no second
     render. */
  const screensaverKey = buildChargeIdempotencyKey(SCREENSAVER_SCOPE, req.userId!, undefined, {
    videoUrl: parsed.data.videoUrl,
    presetKey: parsed.data.presetKey,
    seconds: parsed.data.seconds,
    logoUrl: parsed.data.logoUrl ?? null,
    branded: parsed.data.branded ?? null,
    brandName: parsed.data.brandName ?? null,
    aiDisclosure: parsed.data.aiDisclosure ?? null,
  });
  if (await serveWallpaperReplayIfAny(SCREENSAVER_SCOPE, screensaverKey, req.userId!, res)) return;

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
    }, { idempotencyKey: screensaverKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }
  void creditsAfter;
  const screensaverFlight = beginWallpaperFlight(screensaverKey);

  // Branded by default, same as the wallpaper render — but the charge
  // stays 300 flat regardless (this is a video render; no clean charge).
  // 300 is the owner-ruled living-wallpaper price (Oct 27, 2026,
  // ruled by delegation: "do the prices as you recommend").
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

    const screensaverBody: Record<string, unknown> = {
      url,
      presetKey: preset.key,
      width: preset.width,
      height: preset.height,
      seconds: parsed.data.seconds,
      creditCost: SCREENSAVER_RENDER_COST,
      branded,
      aiDisclosure: aiDisclosureState,
    };
    await serveWallpaperSuccess(SCREENSAVER_SCOPE, screensaverKey, req.userId!, screensaverBody, res);
    screensaverFlight.resolve(screensaverBody);
    screensaverFlight.cleanup();
  } catch (err) {
    screensaverFlight.reject(err);
    screensaverFlight.cleanup();
    const message = err instanceof Error ? err.message : "Screensaver render failed.";
    req.log?.error?.({ err: message }, "[wallpapers] screensaver failed");
    await refundCredits(req.userId!, SCREENSAVER_RENDER_COST, {
      action: "Screensaver Loop Render — Refund",
    }).catch(() => {});
    await voidChargeIdempotencyKey(screensaverKey);
    res.status(502).json({ error: message });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

/* Pack of 10 clean wallpapers — ONE flat 500 charge for exactly ten
   clean (unbranded) renders, all-or-nothing: every preset is validated
   before the charge, and any render failure refunds the full 500 and
   answers 502 with no partial pack delivered. Each finished render is
   recorded in generation history at its share of the pack price
   (500 / 10 = 50), so the ten history rows sum to the one charge. */
router.post("/wallpapers/pack-of-10", requireAuth, async (req, res) => {
  const parsed = packOf10Schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    validationError(res, parsed);
    return;
  }
  const presets: WallpaperPreset[] = [];
  for (const item of parsed.data.items) {
    const preset = presetByKey(item.presetKey);
    if (!preset) {
      res.status(400).json({ error: "Invalid request.", details: [{ field: "presetKey", message: "unknown preset" }] });
      return;
    }
    presets.push(preset);
  }

  /* Replay safety (CA-7): key from the parsed intent (the ten items);
     a re-ask is answered from the stored pack — no second charge, no
     re-render of any of the ten. */
  const packKey = buildChargeIdempotencyKey(PACK_10_SCOPE, req.userId!, undefined, {
    items: parsed.data.items,
    aiDisclosure: parsed.data.aiDisclosure ?? null,
  });
  if (await serveWallpaperReplayIfAny(PACK_10_SCOPE, packKey, req.userId!, res)) return;

  const currentCredits = req.userCredits ?? 0;
  if (currentCredits < PACK_OF_10_COST) {
    res.status(402).json({
      error: "out_of_credits",
      message: "Not enough Visual Bucs. Buy more Visual Bucs to keep creating.",
    });
    return;
  }
  try {
    await chargeCredits(req.userId!, PACK_OF_10_COST, {
      action: "Wallpaper Pack of 10",
    }, { idempotencyKey: packKey });
  } catch (err) {
    if (err instanceof OutOfCreditsError) {
      res.status(402).json({ error: "out_of_credits", message: "Not enough Visual Bucs." });
      return;
    }
    throw err;
  }
  const packFlight = beginWallpaperFlight(packKey);

  const workDir = await mkdtemp(join(tmpdir(), "wallpaper-pack10-"));
  try {
    const renders: Array<{ url: string; presetKey: string; width: number; height: number }> = [];
    for (let i = 0; i < parsed.data.items.length; i++) {
      const item = parsed.data.items[i]!;
      const preset = presets[i]!;
      const inputPath = join(workDir, `input-${i}`);
      const outputPath = join(workDir, `wallpaper-${i}.png`);
      await downloadToFile(item.sourceUrl, inputPath);
      // Clean by definition: no logo, no brand-name overlay — the same
      // ffmpeg builder the single clean render uses, minus branding.
      const args = buildWallpaperFfmpegArgs({ inputPath, outputPath, preset });
      await execFileAsync("ffmpeg", args, { timeout: 300_000 });

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
      void aiDisclosureState;
      const objectName = `wallpapers/${req.userId}/${randomUUID()}.png`;
      const storageRef = await uploadMediaToSupabaseStorage(objectName, buffer, "image/png");
      const url = await refreshSupabaseStorageUrl(storageRef);
      await saveGeneration({
        userId: req.userId!,
        type: "wallpaper",
        title: preset.label,
        fileUrl: url,
        creditsSpent: PACK_OF_10_COST / PACK_OF_10_COUNT,
      });
      renders.push({ url, presetKey: preset.key, width: preset.width, height: preset.height });
    }
    const packBody: Record<string, unknown> = { renders, count: renders.length, creditCost: PACK_OF_10_COST, branded: false };
    await serveWallpaperSuccess(PACK_10_SCOPE, packKey, req.userId!, packBody, res);
    packFlight.resolve(packBody);
    packFlight.cleanup();
  } catch (err) {
    packFlight.reject(err);
    packFlight.cleanup();
    const message = err instanceof Error ? err.message : "Wallpaper pack failed.";
    req.log?.error?.({ err: message }, "[wallpapers] pack of 10 failed");
    await refundCredits(req.userId!, PACK_OF_10_COST, {
      action: "Wallpaper Pack of 10 — Refund",
    }).catch(() => {});
    await voidChargeIdempotencyKey(packKey);
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
