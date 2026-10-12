/* ─── Default BDV watermark logo (theme-aware) ──────────────────────────────
   When the user hasn't uploaded a custom watermark, the export burns in the
   BDV logo. The logo automatically matches the current theme:
   - Light theme → dark-bronze logo on transparent (readable on light videos)
   - Dark theme  → gold logo on transparent (readable on dark videos)
   Custom uploads always win — this is only the fallback. */

export function getDefaultWatermarkUrl(isLight: boolean): string {
  const base = import.meta.env.BASE_URL;
  return isLight ? `${base}bdv-watermark-light.png` : `${base}bdv-watermark.webp`;
}

/** Server-side filenames (relative to artifacts/bow-down-visuals/public/). */
export const WATERMARK_FILE_LIGHT = "bdv-watermark-light.png";
export const WATERMARK_FILE_DARK = "bdv-watermark.webp";
