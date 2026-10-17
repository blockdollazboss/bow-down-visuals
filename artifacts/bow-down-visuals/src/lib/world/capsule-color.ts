/**
 * capsule-color.ts — the fallback capsule's house colors.
 *
 * Presence hands every member a tint (the server palette in
 * world-room.ts mixes house gold with jewel tones — jade, sapphire,
 * amethyst, coral…). As a small identity accent that's fine, but as
 * the fallback FIGURE's whole body it breaks the house read: the
 * coral tint under the light hall's warm sun rendered as bare
 * skin-tone peach (owner's in-hall screenshot, 2026-10-16), and the
 * pale-gold tint washed the same way.
 *
 * The fallback figure is the house figure — gold body, dark head,
 * gold visor — so its body color is anchored here: whatever tint
 * arrives, the hue is pulled into the gold band, saturation kept
 * rich enough to read as metal-and-cloth gold, and lightness kept
 * in the mid range so neither hall look (sunlit palace / midnight
 * throne room) can wash it pale or sink it dark. Members still
 * differ — in shade, within the gold family. Portrait figures and
 * the default guard figure never pass through here; this is the
 * capsule fallback only.
 */

export const HOUSE_GOLD_HEX = "#d4af37";

/** The gold hue band (degrees) the capsule body always lives in. */
export const CAPSULE_HUE_MIN = 38;
export const CAPSULE_HUE_MAX = 54;
/** Saturation floor/ceiling: below the floor gold reads as skin or
 *  sand under the palace lights; above the ceiling it turns neon. */
export const CAPSULE_SAT_MIN = 0.52;
export const CAPSULE_SAT_MAX = 0.78;
/** Lightness band: pale tints wash to peach-white in the sunlit
 *  look, deep tints sink to brown-black in the throne room. */
export const CAPSULE_LIGHT_MIN = 0.4;
export const CAPSULE_LIGHT_MAX = 0.56;

export interface Hsl {
  /** Degrees, 0–360. */
  h: number;
  /** 0–1. */
  s: number;
  /** 0–1. */
  l: number;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  if (typeof hex !== "string") return null;
  const m = /^#(?:([0-9a-f]{3})|([0-9a-f]{6}))$/i.exec(hex.trim());
  if (!m) return null;
  const raw = m[1] ? m[1].split("").map((c) => c + c).join("") : m[2]!;
  return {
    r: parseInt(raw.slice(0, 2), 16) / 255,
    g: parseInt(raw.slice(2, 4), 16) / 255,
    b: parseInt(raw.slice(4, 6), 16) / 255,
  };
}

/** Hex → HSL, or null when the input isn't a hex color. */
export function hexToHsl(hex: string): Hsl | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const { r, g, b } = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

function hslToHex({ h, s, l }: Hsl): string {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let rgb: [number, number, number];
  if (hue < 60) rgb = [c, x, 0];
  else if (hue < 120) rgb = [x, c, 0];
  else if (hue < 180) rgb = [0, c, x];
  else if (hue < 240) rgb = [0, x, c];
  else if (hue < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const part = (v: number) =>
    Math.round(clamp(v + m, 0, 1) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${part(rgb[0])}${part(rgb[1])}${part(rgb[2])}`;
}

/** The capsule body's color for a member's presence tint: the tint
 *  anchored into the house gold family (see the header). A tint
 *  that isn't a color at all falls back to house gold itself. */
export function capsuleBodyHex(tintHex: string): string {
  const hsl = hexToHsl(tintHex);
  if (!hsl) return HOUSE_GOLD_HEX;
  return hslToHex({
    h: clamp(hsl.h, CAPSULE_HUE_MIN, CAPSULE_HUE_MAX),
    s: clamp(hsl.s, CAPSULE_SAT_MIN, CAPSULE_SAT_MAX),
    l: clamp(hsl.l, CAPSULE_LIGHT_MIN, CAPSULE_LIGHT_MAX),
  });
}
