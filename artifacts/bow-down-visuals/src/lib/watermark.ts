/* ─── Default BDV watermark logo (theme-aware) ──────────────────────────────
   When the user hasn't uploaded a custom watermark, the export burns in the
   BDV logo. The logo automatically matches the current theme:
   - Light theme → dark-bronze logo on transparent (readable on light videos)
   - Dark theme  → gold logo on transparent (readable on dark videos)
   Custom uploads always win — this is only the fallback. */

import { mediaUrl } from "./media-cdn";

export function getDefaultWatermarkUrl(isLight: boolean): string {
  // Display consumers are plain <img> overlays/previews; the export
  // burn-in itself is server-side ffmpeg reading the local files
  // (WATERMARK_FILE_* below), so this URL only feeds display.
  return mediaUrl(isLight ? "bdv-watermark-light.png" : "bdv-watermark.webp");
}

/** Server-side filenames (relative to artifacts/bow-down-visuals/public/). */
export const WATERMARK_FILE_LIGHT = "bdv-watermark-light.png";
export const WATERMARK_FILE_DARK = "bdv-watermark.webp";
