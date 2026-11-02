/* ─── Drop Day Kit — banner renders (#169 remainder) ─────────────────
   The kit's banner set stops being specs-only: at assembly, every
   KitBanner renders into a real image — the release's OWN artwork
   cover-fitted to the banner's exact size, a dark scrim + gold rule
   along the foot, and the banner's own headline/subline burned in
   verbatim (ffmpeg drawtext, the promo-cards lesson: burned text is
   always spelled right — and here the text is the release's own
   title/artist/date from assembleKit, never invented copy).

   Deliberately NOT the promo-cards pipeline: no AI background, no
   generated art, no charge. This is a deterministic composite of
   what the creator already owns, produced by the same free assembly
   that builds the rest of the kit.

   Honesty rules:
   - a banner that fails anywhere (artwork unreachable, compose
     failed, upload failed) keeps imageRef null — the kit falls back
     to that banner's Create link and no surface ever presents a
     render that does not exist;
   - the stored payload carries the stable storage REF, never a
     URL; read paths mint fresh URLs from it (the promo-card DTO
     pattern);
   - the teaser is NOT rendered here: it is a 15-second video, and
     video creation stays in Create on its own rails.

   The deps seam mirrors the house pattern (DropDayKitStore,
   recordPromoCardPack): the orchestrator is pinned by tests with
   fakes; only defaultKitBannerRenderDeps touches fs/ffmpeg/network. */

import { execFile } from "child_process";
import { existsSync } from "fs";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import {
  isStorageRef,
  refreshSupabaseStorageUrl,
  uploadMediaToSupabaseStorage,
} from "./objectStorage";
import type { DropDayKitPayload, KitBanner, KitRelease } from "./drop-day-kit";

const execFileAsync = promisify(execFile);

/** House gold — the same accent promo cards burn (0xE8B64C). */
export const KIT_BANNER_ACCENT = "0xE8B64C";

export interface KitBannerLayout {
  /** Height of the dark foot scrim the text sits on. */
  scrimHeight: number;
  headlineSize: number;
  /** Distance from the canvas bottom to the headline's top edge. */
  headlineFromBottom: number;
  headlineMaxChars: number;
  sublineSize: number;
  sublineFromBottom: number;
  sublineMaxChars: number;
}

const BANNER_LAYOUTS: Record<KitBanner["size"], KitBannerLayout> = {
  /* 1584×396 — a short wide strip: one compact text band. */
  profile: { scrimHeight: 168, headlineSize: 62, headlineFromBottom: 146, headlineMaxChars: 36, sublineSize: 38, sublineFromBottom: 58, sublineMaxChars: 56 },
  /* 1920×1080 — full-bleed art, generous foot. */
  wide: { scrimHeight: 300, headlineSize: 92, headlineFromBottom: 262, headlineMaxChars: 40, sublineSize: 50, sublineFromBottom: 128, sublineMaxChars: 64 },
  /* 1080×1080 — square post. */
  post: { scrimHeight: 300, headlineSize: 74, headlineFromBottom: 258, headlineMaxChars: 30, sublineSize: 44, sublineFromBottom: 140, sublineMaxChars: 52 },
  /* 1080×1920 — tall story: text rides above the phone-UI foot. */
  story: { scrimHeight: 430, headlineSize: 82, headlineFromBottom: 372, headlineMaxChars: 32, sublineSize: 48, sublineFromBottom: 232, sublineMaxChars: 56 },
};

export function kitBannerLayout(banner: Pick<KitBanner, "size">): KitBannerLayout {
  return BANNER_LAYOUTS[banner.size];
}

/** Escape text for ffmpeg drawtext (mirrors promo-cards' helper). */
export function escapeKitDrawtext(t: string): string {
  return t
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/:/g, "\\:")
    .replace(/%/g, "%%");
}

/** Fit a string to a max char count without breaking words (mirrors
 *  promo-cards' clampText — a banner never wraps, so an over-long
 *  title ellipsizes instead of running off the canvas). */
export function clampKitBannerText(t: string, max: number): string {
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

/** The burn face: the promo-cards default (DejaVu Sans Bold) where
 *  it exists, else a bundled caption face (Dockerfile installs
 *  docker/fonts to /usr/share/fonts/bdv). Resolution failure is not
 *  possible — the last candidate is returned regardless and ffmpeg
 *  failing on it leaves the banner unrendered, honestly. */
export function kitBannerFontFile(): string {
  const candidates = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/bdv/Poppins-Bold.ttf",
    join(dirname(fileURLToPath(import.meta.url)), "../../../../docker/fonts/Poppins-Bold.ttf"),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return candidates[0]!;
}

/** The full -vf chain for one banner: artwork cover-fit to the exact
 *  spec size, foot scrim, gold rule, headline + subline centered on
 *  the scrim. Pure — pinned by tests. */
export function buildKitBannerFilter(
  banner: KitBanner,
  fontFile: string = kitBannerFontFile(),
): string {
  const layout = kitBannerLayout(banner);
  const { width: w, height: h } = banner;
  const scrimY = h - layout.scrimHeight;
  const headline = escapeKitDrawtext(clampKitBannerText(banner.headline, layout.headlineMaxChars));
  const subline = escapeKitDrawtext(clampKitBannerText(banner.subline, layout.sublineMaxChars));
  const dt = (text: string, size: number, fromBottom: number, color: string) =>
    `drawtext=fontfile='${fontFile}':text='${text}':fontsize=${size}:fontcolor=${color}:x=(w-text_w)/2:y=${h - fromBottom}`;
  return [
    `scale=${w}:${h}:force_original_aspect_ratio=increase`,
    `crop=${w}:${h}`,
    `drawbox=x=0:y=${scrimY}:w=${w}:h=${layout.scrimHeight}:color=black@0.55:t=fill`,
    `drawbox=x=0:y=${scrimY}:w=${w}:h=4:color=${KIT_BANNER_ACCENT}:t=fill`,
    dt(headline, layout.headlineSize, layout.headlineFromBottom, "white"),
    dt(subline, layout.sublineSize, layout.sublineFromBottom, "white@0.85"),
  ].join(",");
}

/** Where a kit banner render lives in storage — deterministic per
 *  kit, so a re-assembly replaces the same objects. */
export function kitBannerObjectName(release: Pick<KitRelease, "id" | "userId">, size: KitBanner["size"]): string {
  return `drop-day-kits/${release.userId}/${release.id}/banner-${size}.jpg`;
}

export interface KitBannerRenderDeps {
  /** Fetch the release artwork to a local file; false = unreachable
   *  (never fatal — the banners stay specs). Stored refs are
   *  resolved to fresh URLs by the default implementation. */
  downloadArtwork(url: string, destPath: string): Promise<boolean>;
  /** Compose one banner PNG/JPEG from the local artwork file. */
  composeBanner(args: { artworkPath: string; outputPath: string; banner: KitBanner }): Promise<void>;
  /** Upload a composed banner; returns the stable storage ref. */
  uploadBanner(objectName: string, buffer: Buffer): Promise<string>;
  readFileBuffer(path: string): Promise<Buffer>;
  makeWorkDir(): Promise<string>;
  removeDir(path: string): Promise<void>;
}

/** Render every banner in an assembled kit. Returns a NEW payload —
 *  the input is never mutated. A banner whose render fails at any
 *  step comes back with imageRef still null; if the artwork itself
 *  cannot be fetched, the kit comes back exactly as assembled. */
export async function renderKitBanners(
  release: KitRelease,
  kit: DropDayKitPayload,
  deps: KitBannerRenderDeps,
): Promise<DropDayKitPayload> {
  if (kit.banners.length === 0) return kit;
  const workDir = await deps.makeWorkDir();
  try {
    const artworkPath = join(workDir, "artwork");
    let fetched = false;
    try {
      fetched = await deps.downloadArtwork(kit.banners[0]!.artworkUrl, artworkPath);
    } catch {
      fetched = false;
    }
    if (!fetched) return kit;

    const banners: KitBanner[] = [];
    for (const banner of kit.banners) {
      try {
        const outputPath = join(workDir, `banner-${banner.size}.jpg`);
        await deps.composeBanner({ artworkPath, outputPath, banner });
        const buffer = await deps.readFileBuffer(outputPath);
        if (buffer.length === 0) {
          banners.push(banner);
          continue;
        }
        const ref = await deps.uploadBanner(kitBannerObjectName(release, banner.size), buffer);
        banners.push({ ...banner, imageRef: ref });
      } catch {
        banners.push(banner);
      }
    }
    return { ...kit, banners };
  } finally {
    await deps.removeDir(workDir).catch(() => {});
  }
}

/** The production deps: fs + ffmpeg + the house storage rail. */
export function defaultKitBannerRenderDeps(): KitBannerRenderDeps {
  return {
    async downloadArtwork(url, destPath) {
      try {
        const fetchUrl = isStorageRef(url) ? await refreshSupabaseStorageUrl(url) : url;
        const res = await fetch(fetchUrl, { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) return false;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 1024 || buf.length > 25 * 1024 * 1024) return false;
        await writeFile(destPath, buf);
        return true;
      } catch {
        return false;
      }
    },
    async composeBanner({ artworkPath, outputPath, banner }) {
      await execFileAsync(
        "ffmpeg",
        [
          "-y", "-i", artworkPath,
          "-vf", buildKitBannerFilter(banner),
          "-frames:v", "1", "-q:v", "4",
          outputPath,
        ],
        { timeout: 120_000 },
      );
    },
    async uploadBanner(objectName, buffer) {
      return uploadMediaToSupabaseStorage(objectName, buffer, "image/jpeg");
    },
    readFileBuffer: (path) => readFile(path),
    makeWorkDir: () => mkdtemp(join(tmpdir(), "drop-day-kit-")),
    removeDir: (path) => rm(path, { recursive: true, force: true }),
  };
}
