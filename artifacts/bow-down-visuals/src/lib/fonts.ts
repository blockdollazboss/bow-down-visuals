/**
 * Caption font catalog — the "way better fonts" library.
 *
 * The same family names must exist in two places:
 *  1. Web preview: loaded via the Google Fonts <link> in index.html.
 *  2. Export burn-in: TTF files bundled in the Docker image
 *     (see Dockerfile + artifacts/api-server/src/lib/fonts.ts).
 *
 * `family` must match the font's canonical family name exactly so
 * fontconfig on the server resolves the same face the browser shows.
 */
export type FontVibe = "Street" | "Luxury" | "Modern" | "Playful";

export interface CaptionFont {
  /** Stable id stored in caption settings. */
  id: string;
  /** Canonical family name (CSS + fontconfig). */
  family: string;
  /** Short label for the picker. */
  label: string;
  vibe: FontVibe;
}

export const CAPTION_FONTS: CaptionFont[] = [
  { id: "anton",        family: "Anton",             label: "Anton",        vibe: "Street"  },
  { id: "bebas",        family: "Bebas Neue",        label: "Bebas Neue",   vibe: "Street"  },
  { id: "archivo",      family: "Archivo Black",     label: "Archivo",      vibe: "Street"  },
  { id: "alfa-slab",    family: "Alfa Slab One",     label: "Alfa Slab",    vibe: "Street"  },
  { id: "bungee",       family: "Bungee",             label: "Bungee",       vibe: "Street"  },
  { id: "luckiest",     family: "Luckiest Guy",      label: "Luckiest",     vibe: "Playful" },
  { id: "titan",        family: "Titan One",         label: "Titan One",    vibe: "Playful" },
  { id: "marker",       family: "Permanent Marker",  label: "Marker",       vibe: "Playful" },
  { id: "righteous",    family: "Righteous",         label: "Righteous",    vibe: "Modern"  },
  { id: "poppins",      family: "Poppins",           label: "Poppins",      vibe: "Modern"  },
  { id: "barlow",       family: "Barlow Condensed",  label: "Barlow",       vibe: "Modern"  },
  { id: "cinzel",       family: "Cinzel",            label: "Cinzel",       vibe: "Luxury"  },
];

/** Default font for new caption setups. Empty string = legacy preset fallback (Arial/Georgia). */
export const DEFAULT_CAPTION_FONT_ID = "anton";

export function getCaptionFont(id: string | undefined | null): CaptionFont | undefined {
  if (!id) return undefined;
  return CAPTION_FONTS.find((f) => f.id === id);
}

/** CSS font-family value for the preview, with sane fallbacks. */
export function captionFontFamily(id: string | undefined | null): string | undefined {
  const f = getCaptionFont(id);
  return f ? `"${f.family}", "Arial Black", sans-serif` : undefined;
}

export const FONT_VIBES: FontVibe[] = ["Street", "Modern", "Playful", "Luxury"];
