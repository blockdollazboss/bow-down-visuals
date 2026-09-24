/**
 * Server-side caption font catalog.
 *
 * Mirrors artifacts/bow-down-visuals/src/lib/fonts.ts. The Dockerfile
 * downloads these TTFs into the image and refreshes fontconfig, so
 * libass can resolve `Fontname` to the same face the web preview shows.
 */
export interface BundledFont {
  /** Canonical family name (CSS + ASS Fontname + fontconfig). */
  family: string;
  /** Directory under https://github.com/google/fonts/raw/main/ofl/ */
  dir: string;
  /** TTF filename in that directory. */
  file: string;
}

export const BUNDLED_CAPTION_FONTS: BundledFont[] = [
  { family: "Anton",            dir: "anton",           file: "Anton-Regular.ttf" },
  { family: "Alfa Slab One",    dir: "alfaslabone",     file: "AlfaSlabOne-Regular.ttf" },
  { family: "Archivo Black",    dir: "archivoblack",    file: "ArchivoBlack-Regular.ttf" },
  { family: "Barlow Condensed", dir: "barlowcondensed", file: "BarlowCondensed-Bold.ttf" },
  { family: "Bebas Neue",       dir: "bebasneue",       file: "BebasNeue-Regular.ttf" },
  { family: "Bungee",           dir: "bungee",          file: "Bungee-Regular.ttf" },
  { family: "Cinzel",           dir: "cinzel",          file: "Cinzel[wght].ttf" },
  { family: "Luckiest Guy",     dir: "luckiestguy",     file: "LuckiestGuy-Regular.ttf" },
  { family: "Permanent Marker", dir: "permanentmarker", file: "PermanentMarker-Regular.ttf" },
  { family: "Poppins",          dir: "poppins",         file: "Poppins-Bold.ttf" },
  { family: "Righteous",        dir: "righteous",       file: "Righteous-Regular.ttf" },
  { family: "Titan One",        dir: "titanone",        file: "TitanOne-Regular.ttf" },
];

/** Raw google/fonts URL for a bundled font file. */
export function captionFontUrl(f: BundledFont): string {
  return `https://github.com/google/fonts/raw/main/ofl/${f.dir}/${encodeURIComponent(f.file)}`;
}

/** True when the family is one of our bundled fonts (safe for ASS Fontname). */
export function isBundledCaptionFont(family: string | undefined | null): family is string {
  return !!family && BUNDLED_CAPTION_FONTS.some((f) => f.family === family);
}
