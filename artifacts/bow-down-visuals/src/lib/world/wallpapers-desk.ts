/**
 * wallpapers-desk — the Wallpapers Desk's pure logic seam
 * (stack1500 world parity wave #3, census item 34).
 *
 * THE FEATURE (website): the Wallpapers desk (components/wallpapers /
 * WallpapersDesk.tsx, reached from /wallpapers and the profile theme
 * surface) makes the art a member's devices wear: generate a piece of
 * art, render it to the EXACT pixel size of a phone / tablet /
 * desktop, branded with the member's own logo and name or clean, a
 * pack of ten clean wallpapers for one flat price, and a LIVING
 * wallpaper — a short looping video rendered as a screensaver.
 *
 * THE RAILS (all real, routes/wallpapers.ts + the shared generate
 * rails, every one requireAuth):
 *   POST /api/generate-artist-image { promptText, model:
 *     "nano-banana-2.1", ratio } → { status, url } or { taskId };
 *     GET /api/generate-artist-image/:taskId polls the task.
 *   POST /api/wallpapers/render { sourceUrl, presetKey, logoUrl?,
 *     branded (default true), brandName?, aiDisclosure? } →
 *     { url, presetKey, width, height, branded, creditCost,
 *       aiDisclosure }.
 *   POST /api/wallpapers/pack-of-10 { items: exactly 10 ×
 *     { sourceUrl, presetKey }, aiDisclosure? } → { renders: [...] }
 *     — ONE flat charge, all-or-nothing server-side.
 *   POST /api/generate-runway-clip { promptText, ratio: "1280:720",
 *     model: "gen4.5" } → { taskId }; GET /:taskId polls.
 *   POST /api/wallpapers/screensaver-render { videoUrl, presetKey,
 *     seconds (10–120, default 60), logoUrl?, branded, brandName?,
 *     aiDisclosure? } → { url, presetKey, width, height, seconds,
 *       creditCost, branded, aiDisclosure }.
 *   POST /api/wallpapers/pack-download { urls (1–12), name? } — the
 *     free .zip of finished renders.
 *   GET /api/wallpapers/presets — the size list (the desk reads the
 *     same list from the website's own lib/wallpapers.ts mirror,
 *     exactly like the 2D desk does).
 *
 * PRICES — every number READ from lib/wallpapers-prices.ts, which
 * derives each one from the credit-cost registry (this seam adds no
 * number of its own, and imports the price module rather than
 * re-deriving, so the confirmation the member sees is pinned to the
 * charging rail by the prices module's own tests):
 *   art generation (nano-banana-2.1) ..... 100 (registry
 *     /api/generate-artist-image, model-scoped — the prices module
 *     reads the ARTIST_IMAGE_MODELS table's nano row)
 *   branded render ....................... FREE (the route charges
 *     only the clean path; the 2D desk rides skipConfirm)
 *   clean render ......................... 400 (registry
 *     /api/export-final-video — the shared clean-export price)
 *   pack of 10 clean .................... 500 flat (registry
 *     /api/wallpapers/pack-of-10; NEVER 10 × the single price)
 *   screensaver source clip .............. 400 (registry
 *     /api/generate-runway-clip)
 *   screensaver render ................... 300 (registry
 *     /api/wallpapers/screensaver-render)
 *   pack download ........................ FREE
 *
 * LOGO LAW at this desk: the brand stamp is the member's OWN logo,
 * sent whole as logoUrl (the rail stamps it as-is); nothing is
 * cropped, redrawn, or baked into generated art here. Generated art
 * itself carries NO logo — the stamp is applied by the render rail
 * only, and only on the branded path.
 *
 * DELIBERATE NON-DUPLICATION (named, not skipped): the 2D desk's
 * theme-pack step (apply a palette to your profile / list a pack in
 * your shop) is profile-theming and shop work — the World's
 * My Profile desk and the shop desks own those surfaces; this desk
 * covers the wallpaper MAKING itself, in full.
 *
 * CONFIRMATION DISCIPLINE (the desk law): priced runs ride
 * confirmedFetch with the prices module's constants as
 * overrideCost/overrideFeature (the clip generation rides the
 * registry through confirmedFetch with no override, like the 2D
 * desk); the branded render rides skipConfirm because it is FREE.
 * A decline runs nothing.
 *
 * DRIFT DISCIPLINE: response guards accept a success only on the
 * rail's exact success shape; anything else returns null and the
 * component shows the rail's own error words or the desk fallback —
 * never an invented render.
 */
import { getCreditCost } from "../credit-costs";
import { WALLPAPER_PRESETS, type WallpaperPreset } from "../wallpapers";
import {
  WALLPAPER_CLEAN_RENDER_COST,
  WALLPAPER_GENERATE_COST,
  WALLPAPER_PACK_OF_10_COST,
  WALLPAPER_PACK_OF_10_COUNT,
  WALLPAPER_SCREENSAVER_RENDER_COST,
  WALLPAPER_SCREENSAVER_VIDEO_COST,
} from "../wallpapers-prices";

export { WALLPAPER_PRESETS, type WallpaperPreset };
export {
  WALLPAPER_CLEAN_RENDER_COST,
  WALLPAPER_GENERATE_COST,
  WALLPAPER_PACK_OF_10_COST,
  WALLPAPER_PACK_OF_10_COUNT,
  WALLPAPER_SCREENSAVER_RENDER_COST,
  WALLPAPER_SCREENSAVER_VIDEO_COST,
};

function registryCost(path: string): number {
  const cost = getCreditCost(path)?.cost;
  if (typeof cost !== "number") {
    throw new Error(`wallpapers-desk: no credit-cost registry entry for ${path}`);
  }
  return cost;
}

/** The station id in lib/world/stations.ts. */
export const WALLPAPERS_DESK_STATION_ID = "wallpapers-desk";

/** The website path this desk mirrors — the quiet transfer footer's
    href (station.websitePath) and receipt copy. */
export const WALLPAPERS_WEBSITE_PATH = "/wallpapers";

/* ── Paths ─────────────────────────────────────────────────────────── */

export const WALLPAPER_ART_PATH = "/api/generate-artist-image";
export const WALLPAPER_RENDER_PATH = "/api/wallpapers/render";
export const WALLPAPER_PACK10_PATH = "/api/wallpapers/pack-of-10";
export const WALLPAPER_CLIP_PATH = "/api/generate-runway-clip";
export const WALLPAPER_SCREENSAVER_PATH = "/api/wallpapers/screensaver-render";
export const WALLPAPER_PACK_DOWNLOAD_PATH = "/api/wallpapers/pack-download";

/* ── Prices (read, never hardcoded) ────────────────────────────────── */

/** Clean render — cross-checked against the registry row the prices
    module derives from; throws at module load if they ever split. */
export const WALLPAPERS_CLEAN_COST = WALLPAPER_CLEAN_RENDER_COST;
export const WALLPAPERS_PACK10_COST = WALLPAPER_PACK_OF_10_COST;
export const WALLPAPERS_SCREENSAVER_COST = WALLPAPER_SCREENSAVER_RENDER_COST;

/** The screensaver rail's own registry row (the run's confirmation
    target), cross-checked with the prices module. */
export const WALLPAPERS_SCREENSAVER_REGISTRY_COST = registryCost(WALLPAPER_SCREENSAVER_PATH);
/** The pack-of-10 rail's own registry row, cross-checked likewise. */
export const WALLPAPERS_PACK10_REGISTRY_COST = registryCost(WALLPAPER_PACK10_PATH);
/** The clip rail's registry row (confirmedFetch's own quote). */
export const WALLPAPERS_CLIP_REGISTRY_COST = registryCost(WALLPAPER_CLIP_PATH);

/** The model the wallpaper flow generates art with (the 2D desk's
    pick — the fast image model whose registry row prices at 100). */
export const WALLPAPER_ART_MODEL = "nano-banana-2.1";

/** The clip model (the 2D desk's pick on the runway rail). */
export const WALLPAPER_CLIP_MODEL = "gen4.5";

/* ── Presets ───────────────────────────────────────────────────────── */

export function wallpaperPresetByKeyIn(
  presets: readonly WallpaperPreset[],
  key: string,
): WallpaperPreset {
  return presets.find((p) => p.key === key) ?? presets[0]!;
}

/** The aspect ratio the art rail wants for a preset (the 2D desk's
    rule: portrait sizes generate portrait art). */
export function wallpaperArtRatio(preset: WallpaperPreset): string {
  return preset.height >= preset.width ? "1080:1920" : "1920:1080";
}

/* ── Payload builders (the rails' exact bodies) ────────────────────── */

export function buildArtRequest(prompt: string, preset: WallpaperPreset) {
  return {
    promptText: prompt.trim(),
    model: WALLPAPER_ART_MODEL,
    ratio: wallpaperArtRatio(preset),
  };
}

export interface WallpaperBrandInputs {
  branded: boolean;
  /** The member's own logo, whole (brand kit). Null when unset. */
  logoUrl: string | null;
  brandName: string | null;
  aiDisclosure: boolean;
}

/** The branded path's stamp fields — the rail applies the logo ONLY
    on branded renders; a clean render must carry neither field. */
function brandFields(brand: WallpaperBrandInputs): Record<string, unknown> {
  if (!brand.branded) return {};
  return {
    ...(brand.logoUrl ? { logoUrl: brand.logoUrl } : {}),
    ...(brand.brandName ? { brandName: brand.brandName } : {}),
  };
}

export function buildRenderRequest(
  sourceUrl: string,
  presetKey: string,
  brand: WallpaperBrandInputs,
) {
  return {
    sourceUrl,
    presetKey,
    branded: brand.branded,
    aiDisclosure: brand.aiDisclosure,
    ...brandFields(brand),
  };
}

/** The pack body — exactly WALLPAPER_PACK_OF_10_COUNT items, every
    piece at the ONE device size the member picked (the 2D desk's
    rule). Returns null rather than a short pack: the rail rejects
    any other count, so the desk never sends one. */
export function buildPack10Request(
  sourceUrls: readonly string[],
  presetKey: string,
  aiDisclosure: boolean,
) {
  if (sourceUrls.length !== WALLPAPER_PACK_OF_10_COUNT) return null;
  return {
    items: sourceUrls.map((sourceUrl) => ({ sourceUrl, presetKey })),
    aiDisclosure,
  };
}

export function buildClipRequest(prompt: string) {
  return { promptText: prompt.trim(), ratio: "1280:720", model: WALLPAPER_CLIP_MODEL };
}

export const WALLPAPER_SCREENSAVER_SECONDS = { min: 10, max: 120, fallback: 60 } as const;

export function clampScreensaverSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return WALLPAPER_SCREENSAVER_SECONDS.fallback;
  return Math.min(
    WALLPAPER_SCREENSAVER_SECONDS.max,
    Math.max(WALLPAPER_SCREENSAVER_SECONDS.min, Math.round(seconds)),
  );
}

export function buildScreensaverRequest(
  videoUrl: string,
  presetKey: string,
  seconds: number,
  brand: WallpaperBrandInputs,
) {
  return {
    videoUrl,
    presetKey,
    seconds: clampScreensaverSeconds(seconds),
    branded: brand.branded,
    aiDisclosure: brand.aiDisclosure,
    ...brandFields(brand),
  };
}

export function buildPackDownloadRequest(urls: readonly string[], name?: string) {
  const clean = urls.filter((u) => typeof u === "string" && u.trim().length > 0).slice(0, 12);
  if (clean.length === 0) return null;
  return { urls: clean, ...(name && name.trim() ? { name: name.trim() } : {}) };
}

/* ── Pack selection (exactly ten, the 2D desk's toggle rule) ──────── */

export function togglePackSelection(selected: readonly string[], url: string): string[] {
  if (selected.includes(url)) return selected.filter((u) => u !== url);
  if (selected.length >= WALLPAPER_PACK_OF_10_COUNT) return [...selected];
  return [...selected, url];
}

export function packReady(selected: readonly string[]): boolean {
  return selected.length === WALLPAPER_PACK_OF_10_COUNT;
}

/* ── Response guards ───────────────────────────────────────────────── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export interface WallpaperRender {
  url: string;
  presetKey: string;
  width: number;
  height: number;
}

export function renderOfResponse(data: unknown, preset: WallpaperPreset): WallpaperRender | null {
  if (!isRecord(data)) return null;
  const url = str(data["url"]);
  if (!url) return null;
  return {
    url,
    presetKey: str(data["presetKey"]) ?? preset.key,
    width: num(data["width"]) ?? preset.width,
    height: num(data["height"]) ?? preset.height,
  };
}

export function packOfResponse(data: unknown): WallpaperRender[] | null {
  if (!isRecord(data) || !Array.isArray(data["renders"])) return null;
  const out: WallpaperRender[] = [];
  for (const row of data["renders"]) {
    if (!isRecord(row)) return null;
    const url = str(row["url"]);
    const presetKey = str(row["presetKey"]);
    const width = num(row["width"]);
    const height = num(row["height"]);
    if (!url || !presetKey || width === null || height === null) return null;
    out.push({ url, presetKey, width, height });
  }
  return out.length === WALLPAPER_PACK_OF_10_COUNT ? out : null;
}

export interface ScreensaverRender extends WallpaperRender {
  seconds: number;
  creditCost: number;
}

export function screensaverOfResponse(
  data: unknown,
  preset: WallpaperPreset,
): ScreensaverRender | null {
  const base = renderOfResponse(data, preset);
  if (!base || !isRecord(data)) return null;
  return {
    ...base,
    seconds: num(data["seconds"]) ?? 0,
    creditCost: num(data["creditCost"]) ?? WALLPAPERS_SCREENSAVER_COST,
  };
}

export type GenerationPoll =
  | { kind: "pending" }
  | { kind: "done"; url: string }
  | { kind: "failed" };

/** One poll answer from either generation rail (same status words). */
export function generationPollOf(data: unknown): GenerationPoll {
  if (!isRecord(data)) return { kind: "pending" };
  const status = data["status"];
  const url = str(data["url"]);
  if (status === "succeeded" && url) return { kind: "done", url };
  if (status === "failed" || status === "cancelled") return { kind: "failed" };
  return { kind: "pending" };
}

/** The submit answer: an immediate success url, or a task to poll. */
export function generationSubmitOf(
  data: unknown,
): { kind: "done"; url: string } | { kind: "task"; taskId: string } | null {
  if (!isRecord(data)) return null;
  const url = str(data["url"]);
  if (data["status"] === "succeeded" && url) return { kind: "done", url };
  const taskId = str(data["taskId"]);
  if (taskId) return { kind: "task", taskId };
  return null;
}

/** Session renders, newest first, capped — the pack-download list. */
export const WALLPAPERS_SESSION_LIMIT = 24;

export function prependRenders(
  history: readonly WallpaperRender[],
  fresh: readonly WallpaperRender[],
): WallpaperRender[] {
  return [...fresh, ...history].slice(0, WALLPAPERS_SESSION_LIMIT);
}
