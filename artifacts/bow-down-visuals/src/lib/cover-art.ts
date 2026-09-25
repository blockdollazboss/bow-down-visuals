/* ─── AI Cover Art Generator — shared frontend helpers ────────────────────
   Style presets, aspect ratios, and pricing tiers for /cover-art.
   Keep the keys in sync with the API (coverArtSchema in cover-art.ts). */

export interface CoverArtStyle {
  key: string;
  label: string;
  blurb: string;
  /** Tailwind-friendly swatch gradient for the preset picker. */
  swatch: string;
}

export const COVER_ART_STYLES: CoverArtStyle[] = [
  {
    key: "luxury-gold",
    label: "Luxury Gold",
    blurb: "Black & gold opulence",
    swatch: "from-black via-[#1a1207] to-[#d4af37]",
  },
  {
    key: "dark-moody",
    label: "Dark Moody",
    blurb: "Cinematic shadows",
    swatch: "from-black via-[#101418] to-[#3b4a5a]",
  },
  {
    key: "vibrant-pop",
    label: "Vibrant Pop",
    blurb: "Bold, high energy",
    swatch: "from-[#ff2d78] via-[#7b2ff7] to-[#00e5ff]",
  },
  {
    key: "retro",
    label: "Retro",
    blurb: "Vintage vinyl grain",
    swatch: "from-[#5a3b1e] via-[#a9713c] to-[#e8c97a]",
  },
  {
    key: "minimal",
    label: "Minimal",
    blurb: "Clean negative space",
    swatch: "from-[#f5f5f5] via-[#d9d9d9] to-[#8a8a8a]",
  },
];

export interface CoverArtRatio {
  key: string;
  label: string;
  blurb: string;
  /** Aspect-ratio CSS value for the preview box. */
  css: string;
}

export const COVER_ART_RATIOS: CoverArtRatio[] = [
  { key: "1:1", label: "Square 1:1", blurb: "Streaming platforms", css: "1 / 1" },
  { key: "16:9", label: "Wide 16:9", blurb: "YouTube banner", css: "16 / 9" },
  { key: "9:16", label: "Story 9:16", blurb: "Stories & Shorts", css: "9 / 16" },
];

export interface CoverArtTier {
  key: "standard" | "premium";
  label: string;
  credits: number;
  blurb: string;
}

export const COVER_ART_TIERS: CoverArtTier[] = [
  {
    key: "standard",
    label: "Standard",
    credits: 2,
    blurb: "Sharp, release-ready artwork",
  },
  {
    key: "premium",
    label: "Premium Detail",
    credits: 3,
    blurb: "Maximum detail & richness",
  },
];

export function getCoverArtStyle(key: string): CoverArtStyle {
  return COVER_ART_STYLES.find((s) => s.key === key) ?? COVER_ART_STYLES[0];
}

export function getCoverArtRatio(key: string): CoverArtRatio {
  return COVER_ART_RATIOS.find((r) => r.key === key) ?? COVER_ART_RATIOS[0];
}

export function getCoverArtTier(key: string): CoverArtTier {
  return COVER_ART_TIERS.find((t) => t.key === key) ?? COVER_ART_TIERS[0];
}

export interface CoverArtResult {
  url: string;
  path: string | null;
  artDirection?: { concept: string; typography: string; palette: string[] };
  typography?: string;
  creditsUsed?: number;
  creditsRemaining?: number;
}
