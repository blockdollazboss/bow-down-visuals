/**
 * Server-side caption font catalog.
 *
 * Mirrors artifacts/bow-down-visuals/src/lib/fonts.ts. The Dockerfile
 * downloads these TTFs into the image and refreshes fontconfig, so
 * libass can resolve `Fontname` to the same face the web preview shows.
 */
export interface BundledFont {
  /** Short id used by the frontend settings (e.g. "anton"). */
  id: string;
  /** Canonical family name (CSS + ASS Fontname + fontconfig). */
  family: string;
  /** Directory under https://github.com/google/fonts/raw/main/ofl/ */
  dir: string;
  /** TTF filename in that directory. */
  file: string;
}

export const BUNDLED_CAPTION_FONTS: BundledFont[] = [
  { id: "anton",            family: "Anton",            dir: "anton",           file: "Anton-Regular.ttf" },
  { id: "alfa-slab-one",    family: "Alfa Slab One",    dir: "alfaslabone",     file: "AlfaSlabOne-Regular.ttf" },
  { id: "archivo-black",    family: "Archivo Black",    dir: "archivoblack",    file: "ArchivoBlack-Regular.ttf" },
  { id: "barlow-condensed", family: "Barlow Condensed", dir: "barlowcondensed", file: "BarlowCondensed-Bold.ttf" },
  { id: "bebas-neue",       family: "Bebas Neue",       dir: "bebasneue",       file: "BebasNeue-Regular.ttf" },
  { id: "bungee",           family: "Bungee",           dir: "bungee",          file: "Bungee-Regular.ttf" },
  { id: "cinzel",           family: "Cinzel",           dir: "cinzel",          file: "Cinzel[wght].ttf" },
  { id: "luckiest-guy",     family: "Luckiest Guy",     dir: "luckiestguy",     file: "LuckiestGuy-Regular.ttf" },
  { id: "permanent-marker", family: "Permanent Marker", dir: "permanentmarker", file: "PermanentMarker-Regular.ttf" },
  { id: "poppins",          family: "Poppins",          dir: "poppins",         file: "Poppins-Bold.ttf" },
  { id: "righteous",        family: "Righteous",        dir: "righteous",       file: "Righteous-Regular.ttf" },
  { id: "titan-one",        family: "Titan One",        dir: "titanone",        file: "TitanOne-Regular.ttf" },
];

/** Raw google/fonts URL for a bundled font file. */
export function captionFontUrl(f: BundledFont): string {
  return `https://github.com/google/fonts/raw/main/ofl/${f.dir}/${encodeURIComponent(f.file)}`;
}

/** True when the family is one of our bundled fonts (safe for ASS Fontname). */
export function isBundledCaptionFont(family: string | undefined | null): family is string {
  return !!family && BUNDLED_CAPTION_FONTS.some((f) => f.family === family);
}

/**
 * Resolve what the frontend sends (`fontFamily` setting) to a canonical
 * bundled family name. Accepts either the short id ("anton") or the family
 * name ("Anton"). Returns null when it doesn't match a bundled font.
 */
export function resolveCaptionFontFamily(idOrFamily: string | undefined | null): string | null {
  if (!idOrFamily) return null;
  const found = BUNDLED_CAPTION_FONTS.find((f) => f.id === idOrFamily || f.family === idOrFamily);
  return found ? found.family : null;
}
