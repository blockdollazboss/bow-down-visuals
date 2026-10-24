/* ─── Wallpapers, Screensavers & Themes — shared client library ─────────
   Exact device sizes, palette extraction, and palette → profile-theme
   building for the Wallpapers desk (Create panel + Branding Kit tab).

   The preset dimensions are a contract: the server render rail
   (POST /api/wallpapers/render, routes/wallpapers.ts) renders exactly
   these pixels, and both suites pin the literals. Copy with care. */

import { presetById, type ThemeConfig, type ThemePreset } from "@/lib/artist-profiles";

export type WallpaperKind = "phone" | "tablet" | "desktop";

export interface WallpaperPreset {
  key: string;
  kind: WallpaperKind;
  label: string;
  width: number;
  height: number;
}

export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  { key: "phone-iphone-promax", kind: "phone", label: "iPhone Pro Max", width: 1320, height: 2868 },
  { key: "phone-iphone-pro", kind: "phone", label: "iPhone Pro", width: 1206, height: 2622 },
  { key: "phone-iphone", kind: "phone", label: "iPhone", width: 1179, height: 2556 },
  { key: "phone-android-flagship", kind: "phone", label: "Android Flagship", width: 1440, height: 3120 },
  { key: "phone-android", kind: "phone", label: "Android", width: 1080, height: 2400 },
  { key: "tablet-ipad-pro", kind: "tablet", label: "iPad Pro", width: 2048, height: 2732 },
  { key: "tablet-ipad", kind: "tablet", label: "iPad", width: 1640, height: 2360 },
  { key: "tablet-ipad-mini", kind: "tablet", label: "iPad mini", width: 1488, height: 2266 },
  { key: "desktop-fhd", kind: "desktop", label: "Desktop Full HD", width: 1920, height: 1080 },
  { key: "laptop-macbook-14", kind: "desktop", label: "MacBook Pro 14\"", width: 3024, height: 1964 },
  { key: "laptop-16-10", kind: "desktop", label: "Laptop 16:10", width: 2880, height: 1800 },
  { key: "desktop-qhd", kind: "desktop", label: "Desktop QHD", width: 2560, height: 1440 },
  { key: "desktop-4k", kind: "desktop", label: "Desktop 4K", width: 3840, height: 2160 },
  { key: "desktop-5k", kind: "desktop", label: "Desktop 5K", width: 5120, height: 2880 },
  { key: "desktop-ultrawide", kind: "desktop", label: "Ultrawide", width: 3440, height: 1440 },
];

export function wallpaperPresetByKey(key: string): WallpaperPreset {
  return WALLPAPER_PRESETS.find((p) => p.key === key) ?? WALLPAPER_PRESETS[0]!;
}

export function wallpaperPresetsByKind(kind: WallpaperKind): WallpaperPreset[] {
  return WALLPAPER_PRESETS.filter((p) => p.kind === kind);
}

/* The matched theme pack: one phone wallpaper, one lock screen, one
   desktop wallpaper. The lock screen is the SAME pixels as the phone
   wallpaper (same preset) — its composition note is that the art is
   framed calm at the top so the clock stays readable; it is never a
   second, different render. */
export const THEME_PACK_PRESET_KEYS = {
  phone: "phone-iphone",
  lockScreen: "phone-iphone",
  desktop: "desktop-fhd",
} as const;

/* ─── Hex helpers (pure) ─────────────────────────────────────────────── */

export function normalizeHex(v: string): string | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(v.trim());
  return m ? `#${m[1]!.toLowerCase()}` : null;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const n = normalizeHex(hex);
  if (!n) return null;
  return {
    r: parseInt(n.slice(1, 3), 16),
    g: parseInt(n.slice(3, 5), 16),
    b: parseInt(n.slice(5, 7), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** WCAG relative luminance of a #rrggbb color (0 = black, 1 = white).
 *  Invalid input reads as 0. */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(rgb.r) + 0.7152 * f(rgb.g) + 0.0722 * f(rgb.b);
}

interface Hsl { h: number; s: number; l: number }

function hexToHsl(hex: string): Hsl | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const r = rgb.r / 255, g = rgb.g / 255, b = rgb.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

/** Mix `hex` toward `target` by `amount` (0 = hex, 1 = target). */
function mixHex(hex: string, target: string, amount: number): string {
  const a = hexToRgb(hex), b = hexToRgb(target);
  if (!a || !b) return normalizeHex(hex) ?? "#000000";
  return rgbToHex(
    a.r + (b.r - a.r) * amount,
    a.g + (b.g - a.g) * amount,
    a.b + (b.b - a.b) * amount,
  );
}

/* ─── Palette extraction (browser, best-effort) ──────────────────────── */

/**
 * Extract up to 5 dominant colors from an image URL.
 *
 * Loads the image with crossOrigin="anonymous", draws it small onto a
 * canvas, and runs a simple frequency-bucket quantizer (16-step channel
 * buckets, averaged back out), skipping buckets that sit too close to a
 * color already picked. ANY failure — CORS taint, load error, no canvas
 * (SSR/tests) — resolves [] instead of throwing: a palette is a nicety,
 * never a reason to break the desk.
 */
export async function extractPalette(imageUrl: string): Promise<string[]> {
  try {
    if (!imageUrl || typeof document === "undefined" || typeof Image === "undefined") return [];
    const img = new Image();
    img.crossOrigin = "anonymous";
    const loaded = new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
    });
    img.src = imageUrl;
    if (!(await loaded)) return [];
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return [];
    const scale = Math.min(1, 64 / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) return [];
    ctx.drawImage(img, 0, 0, cw, ch);
    /* Throws on a CORS-tainted canvas — caught below, resolves []. */
    const data = ctx.getImageData(0, 0, cw, ch).data;

    interface Bucket { count: number; r: number; g: number; b: number }
    const buckets = new Map<string, Bucket>();
    for (let i = 0; i + 3 < data.length; i += 4) {
      const alpha = data[i + 3]!;
      if (alpha < 200) continue; // skip (near-)transparent pixels
      const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
      const key = `${r >> 4},${g >> 4},${b >> 4}`;
      const bucket = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
      bucket.count += 1;
      bucket.r += r; bucket.g += g; bucket.b += b;
      buckets.set(key, bucket);
    }
    const ranked = [...buckets.values()]
      .sort((a, b) => b.count - a.count)
      .map((b) => rgbToHex(b.r / b.count, b.g / b.count, b.b / b.count));

    const picked: string[] = [];
    for (const hex of ranked) {
      if (picked.length >= 5) break;
      const rgb = hexToRgb(hex)!;
      const nearDupe = picked.some((p) => {
        const q = hexToRgb(p)!;
        const dr = rgb.r - q.r, dg = rgb.g - q.g, db = rgb.b - q.b;
        return Math.sqrt(dr * dr + dg * dg + db * db) < 36;
      });
      if (!nearDupe) picked.push(hex);
    }
    return picked;
  } catch {
    return [];
  }
}

/* ─── Palette → profile ThemeConfig (pure, deterministic) ──────────── */

/**
 * Build a complete profile ThemeConfig from a palette.
 *
 * - background: the darkest palette color
 * - surface / cardBg: layered variants of that background (the Royal
 *   Gold pattern — panels sit a step above the ground)
 * - primary: the most saturated, gold-leaning palette color
 *   (falls back to the preset primary when the palette is all greys)
 * - accent: the lightest warm color (else the lightest color)
 * - text: cream on a dark background, deep brown-black on a light one
 * - mutedText / border: derived mixes, always valid #rrggbb
 * - fonts / banner / spacing / cornerRadius: from the fallback preset
 *   (Royal Gold by default)
 *
 * An empty (or entirely invalid) palette returns the fallback preset's
 * colors verbatim, with themeId "custom".
 */
export function buildThemeConfigFromPalette(
  palette: string[],
  fallback: ThemePreset = presetById("royal-gold"),
): ThemeConfig {
  const shell = {
    fonts: { ...fallback.fonts },
    banner: { ...fallback.banner },
    spacing: fallback.spacing,
    cornerRadius: fallback.cornerRadius,
  };
  const colors = (Array.isArray(palette) ? palette : [])
    .map((c) => (typeof c === "string" ? normalizeHex(c) : null))
    .filter((c): c is string => c !== null);
  const unique = [...new Set(colors)];
  if (unique.length === 0) {
    return { themeId: "custom", colors: { ...fallback.colors }, ...shell };
  }

  const byLuminance = [...unique].sort((a, b) => relativeLuminance(a) - relativeLuminance(b));
  const background = byLuminance[0]!;
  const isDark = relativeLuminance(background) < 0.35;

  /* Panels: a step away from the ground so cards read as layers. On a
     dark ground that is a lightened variant; on a light ground, a
     darkened variant. */
  const surface = isDark ? mixHex(background, "#ffffff", 0.07) : mixHex(background, "#000000", 0.05);
  const cardBg = isDark ? mixHex(background, "#ffffff", 0.12) : mixHex(background, "#000000", 0.09);

  /* Primary: chroma (max−min channel spread — how much color a swatch
     actually carries, so a deep gold beats a pale wash of the same hue)
     first, with a bonus for gold-range hues. */
  let primary = fallback.colors.primary;
  let bestScore = 0.12; // a palette color must carry real color to win
  for (const hex of unique) {
    const hsl = hexToHsl(hex);
    const rgb = hexToRgb(hex);
    if (!hsl || !rgb) continue;
    const chroma = (Math.max(rgb.r, rgb.g, rgb.b) - Math.min(rgb.r, rgb.g, rgb.b)) / 255;
    const goldBonus = hsl.h >= 32 && hsl.h <= 58 ? 0.15 : 0;
    const score = chroma + goldBonus;
    if (score > bestScore) {
      bestScore = score;
      primary = hex;
    }
  }

  /* Accent: the lightest warm color; else the lightest color overall.
     Never the same swatch as primary when another candidate exists. */
  const warm = unique.filter((hex) => {
    const hsl = hexToHsl(hex);
    return hsl !== null && ((hsl.h >= 15 && hsl.h <= 70) || hsl.h >= 340);
  });
  const accentPool = (warm.length > 0 ? warm : unique)
    .filter((hex) => hex !== primary);
  const accent = (accentPool.length > 0 ? accentPool : unique)
    .reduce((lightest, hex) => (relativeLuminance(hex) > relativeLuminance(lightest) ? hex : lightest),
      (accentPool.length > 0 ? accentPool : unique)[0]!);

  const text = isDark ? "#f7ecd2" : "#241a08";
  const mutedText = mixHex(text, background, 0.42);
  const border = mixHex(primary, background, 0.55);

  return {
    themeId: "custom",
    colors: { background, surface, primary, accent, text, mutedText, cardBg, border },
    ...shell,
  };
}
