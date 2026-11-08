/**
 * photo-develop-presets.ts — the Photo editor's BUILT-IN develop looks
 * (Stack 100, item A12).
 *
 * Until now the editor's only presets were user-saved rows from
 * GET /api/photo-presets ("my presets" — user rows only), so a brand-new
 * creator opened the desk to "No presets saved yet" and zero starting
 * points, while every sibling surface shipped built-in starters. This
 * registry is the starter shelf: named one-tap looks expressed ONLY in
 * the editor's real develop parameters (lib/photo-canvas DevelopSettings
 * — exposure, brightness, contrast, temperature, hue, saturation,
 * lightness), each value inside the range clampDevelop enforces.
 *
 * A look is color/exposure ONLY: it never sets crop or rotateDeg — a
 * preset must never reframe or rotate the member's photo. Applying one
 * is the exact same operation as applying a user-saved preset (the full
 * develop set lands on the active photo layer, clamped), it is free
 * like every manual edit on this desk (editor-free law), and because it
 * lands in the layer's develop state it can be tweaked with the sliders
 * and then saved as the member's own preset through the existing save
 * flow — a built-in is a starting point, not a lock-in.
 */
import { clampDevelop, type DevelopSettings } from "./photo-canvas";

export interface PhotoDevelopPreset {
  id: string;
  name: string;
  /** One line: what the look does / when to reach for it. */
  blurb: string;
  /** Two-stop gradient evoking the look, drawn on the shelf chip. */
  swatch: readonly [string, string];
  /**
   * The full develop recipe one tap applies — complete DevelopSettings
   * (unspecified sliders sit at their neutral defaults), always stored
   * already clamped, with crop null and rotateDeg 0 by construction.
   */
  develop: DevelopSettings;
}

function look(
  id: string,
  name: string,
  blurb: string,
  swatch: readonly [string, string],
  settings: Partial<DevelopSettings>,
): PhotoDevelopPreset {
  return {
    id,
    name,
    blurb,
    swatch,
    // crop/rotateDeg are forced AFTER the settings spread: no look in
    // this registry may reframe or rotate the photo, whatever a future
    // edit puts in the settings literal.
    develop: clampDevelop({ ...settings, crop: null, rotateDeg: 0 }),
  };
}

export const PHOTO_DEVELOP_PRESETS: readonly PhotoDevelopPreset[] = [
  look(
    "royal-gold",
    "Royal Gold",
    "Warm gold light, rich color, a gentle glow — the house look.",
    ["#f6c453", "#8a5a12"],
    { exposure: 0.25, brightness: 6, contrast: 18, temperature: 28, saturation: 22, lightness: 4 },
  ),
  look(
    "black-gold-mono",
    "Black & Gold Mono",
    "Black-and-white with a warm gold tone — timeless and bold.",
    ["#e8d9a8", "#17130a"],
    { exposure: 0, brightness: -4, contrast: 30, temperature: 16, saturation: -100, lightness: -2 },
  ),
  look(
    "warm-film",
    "Warm Film",
    "Soft faded film — lifted shadows, gentle warmth, quiet color.",
    ["#e8b98a", "#5f4632"],
    { exposure: 0.15, brightness: 10, contrast: -12, temperature: 20, hue: -4, saturation: -18, lightness: 8 },
  ),
  look(
    "clean-bright",
    "Clean Bright",
    "Crisp and airy — bright whites, true color, nothing muddy.",
    ["#ffffff", "#bcd3e8"],
    { exposure: 0.4, brightness: 14, contrast: 8, temperature: -6, saturation: 6, lightness: 10 },
  ),
  look(
    "deep-contrast",
    "Deep Contrast",
    "Moody punch — deep shadows, strong contrast, rich color.",
    ["#7a86a0", "#0b0e18"],
    { exposure: -0.2, brightness: -8, contrast: 38, temperature: -4, saturation: 12, lightness: -6 },
  ),
  look(
    "velvet-dusk",
    "Velvet Dusk",
    "Low warm twilight — dim, golden, cinematic.",
    ["#d98a4a", "#2a1428"],
    { exposure: -0.35, brightness: -6, contrast: 14, temperature: 34, hue: -6, saturation: 8, lightness: -8 },
  ),
  /* ── Stack 200 upgrade wave (Lane U2): the two looks the shelf had
     no answer for. Every existing grade is warm or neutral-warm;
     teal-shadow is the first cool recipe (teal pushed into the
     shadows, skin-safe desaturation). And black-gold-mono's whole
     identity is its gold tone — silver-noir is the neutral mono:
     fully desaturated with the temperature dead at zero, blacks
     crushed harder. ── */
  look(
    "teal-shadow",
    "Teal Shadow",
    "Cool teal shadows, cinematic calm — the first cold grade on the shelf.",
    ["#7fd4c9", "#0d3038"],
    { exposure: -0.1, brightness: -2, contrast: 24, temperature: -38, hue: 8, saturation: -8, lightness: -4 },
  ),
  look(
    "silver-noir",
    "Silver Noir",
    "True silver black-and-white — crushed blacks, no gold tone at all.",
    ["#e8e8ec", "#101014"],
    { exposure: 0.05, brightness: -6, contrast: 42, temperature: 0, saturation: -100, lightness: -3 },
  ),
  /* ── Stack 300 upgrade wave: the three regions the shelf had no
     answer for. Saturation above +22 was wholly unoccupied (every
     entry neutral, muted or mono) — vivid-pop turns color UP. The
     low-contrast + lifted-lightness portrait region was empty and
     no entry was face-oriented — soft-portrait is. And teal-shadow
     is a MID cool grade; the far-cool, dark end of the
     temperature×exposure plane had no entry — blue-hour is it. ── */
  look(
    "vivid-pop",
    "Vivid Pop",
    "Color turned up hard — loud, bright, built to jump off a feed.",
    ["#ff5a3c", "#3c8aff"],
    { exposure: 0.15, brightness: 4, contrast: 22, temperature: 6, saturation: 48, lightness: 2 },
  ),
  look(
    "soft-portrait",
    "Soft Portrait",
    "Soft and face-first — gentle contrast, lifted light, skin stays true.",
    ["#f2c9a8", "#8a5f43"],
    { exposure: 0.2, brightness: 8, contrast: -24, temperature: 10, saturation: -4, lightness: 14 },
  ),
  look(
    "blue-hour",
    "Blue Hour",
    "Deep blue twilight — the cold dark after the sun is gone.",
    ["#7fb0e8", "#0a1626"],
    { exposure: -0.55, brightness: -4, contrast: 20, temperature: -62, hue: 6, saturation: -6, lightness: -6 },
  ),
];

export function photoDevelopPresetById(id: string): PhotoDevelopPreset | null {
  return PHOTO_DEVELOP_PRESETS.find((p) => p.id === id) ?? null;
}

/**
 * The develop a layer ends up with when a preset is applied — the same
 * clamp the editor's apply path runs, so this is exactly (and only) the
 * preset's parameter set.
 */
export function developFromPreset(preset: PhotoDevelopPreset): DevelopSettings {
  return clampDevelop(preset.develop);
}

/** True when a layer's current develop IS this preset's look, exactly. */
export function developMatchesPreset(
  develop: Partial<DevelopSettings> | null | undefined,
  preset: PhotoDevelopPreset,
): boolean {
  const a = clampDevelop(develop ?? undefined);
  const b = preset.develop;
  return (
    a.exposure === b.exposure && a.brightness === b.brightness &&
    a.contrast === b.contrast && a.temperature === b.temperature &&
    a.hue === b.hue && a.saturation === b.saturation &&
    a.lightness === b.lightness && a.rotateDeg === b.rotateDeg &&
    (a.crop === null) === (b.crop === null)
  );
}
