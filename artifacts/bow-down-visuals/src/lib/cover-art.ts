/* ─── AI Cover Art Generator — frontend mirror of the cover-art registry ──
   The registry of record lives on the API (routes/generate/cover-art.ts):
   it validates the style/ratio keys, resolves the image sizes, and charges
   the tier prices. This file is the FE mirror — it carries the same lists
   plus presentation-only fields the rail has no use for (swatch gradients,
   preview css). The shared fields (key, label, blurb, order, tier prices)
   are pinned identical to the rail by cover-art-registry-parity.test.ts —
   never edit one side without the other; the pin fails. */

interface CoverArtStyle {
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
    blurb: "Black & gold opulence — the Bow Down signature",
    swatch: "from-black via-[#1a1207] to-[#d4af37]",
  },
  {
    key: "dark-moody",
    label: "Dark Moody",
    blurb: "Cinematic shadows, mysterious and intense",
    swatch: "from-black via-[#101418] to-[#3b4a5a]",
  },
  {
    key: "vibrant-pop",
    label: "Vibrant Pop",
    blurb: "Bold color, high energy, made to stop thumbs",
    swatch: "from-[#ff2d78] via-[#7b2ff7] to-[#00e5ff]",
  },
  {
    key: "retro",
    label: "Retro",
    blurb: "Vintage grain — 70s/80s vinyl energy",
    swatch: "from-[#5a3b1e] via-[#a9713c] to-[#e8c97a]",
  },
  {
    key: "minimal",
    label: "Minimal",
    blurb: "Clean, confident — negative space does the talking",
    swatch: "from-[#f5f5f5] via-[#d9d9d9] to-[#8a8a8a]",
  },
];

interface CoverArtRatio {
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

interface CoverArtTier {
  key: "standard" | "premium";
  label: string;
  credits: number;
  blurb: string;
}

export const COVER_ART_TIERS: CoverArtTier[] = [
  {
    key: "standard",
    label: "Standard",
    credits: 200,
    blurb: "Sharp, release-ready artwork",
  },
  {
    key: "premium",
    label: "Premium Detail",
    credits: 300,
    blurb: "Maximum detail & richness",
  },
];

/* ─── One-tap vibe presets ────────────────────────────────────────────────
   The quick-pick chips on the Cover Art page and the in-World desk.
   Every `style` here MUST be a registry key above — the rail rejects
   anything else, and cover-art-registry-parity.test.ts pins membership.
   (A fourth chip, "Cinematic", used to point at a style key the rail
   never had — tapping it set an unchargeable, ungeneratable style and
   the request failed. It is gone; Dark Moody is the cinematic style.) */
export const COVER_ART_PRESETS: ReadonlyArray<{ label: string; style: string; mood: string }> = [
  { label: "💎 Luxury Gold", style: "luxury-gold", mood: "luxurious and premium" },
  { label: "🌙 Dark Moody", style: "dark-moody", mood: "dark and atmospheric" },
  { label: "🎨 Vibrant Pop", style: "vibrant-pop", mood: "bold and energetic" },
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
