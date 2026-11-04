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
/* ─── Layout templates ────────────────────────────────────────────────────
   Composition templates layered on styles + ratios: where the title sits,
   where the artist name goes, which zone the artwork keeps clean for them.
   Picking one sends its key as `layout` on the generate request; picking
   none ("Freeform" in the picker) sends nothing and the rail behaves
   exactly as it did before layouts existed. Structure only — layouts
   never change the price tiers above. */

export type CoverArtReleaseFormat = "single" | "ep" | "album";

export interface CoverArtLayout {
  key: string;
  label: string;
  blurb: string;
  /** Release shapes this composition is designed for. */
  formats: CoverArtReleaseFormat[];
  /** Vertical zone the song title occupies ("none" = no title at all). */
  titleZone: "top" | "center" | "bottom" | "corner" | "side" | "none";
  /** Title size relative to the frame. */
  titleScale: "hero" | "large" | "medium" | "small" | "none";
  /** Where the artist name sits, relative to the title when it has one. */
  artistZone: "above-title" | "below-title" | "top" | "bottom" | "none";
  /** Artist-name size relative to the frame. */
  artistScale: "medium" | "small" | "none";
  /** Horizontal alignment of the text block. */
  align: "left" | "center" | "right";
  /** Where the artwork's main subject lives, so text zones stay clear. */
  subjectZone: "full-bleed" | "behind-title" | "upper" | "lower" | "right";
  /** Corner kept clear for a small seal/badge, when the layout reserves one. */
  badgeZone: "bottom-right" | null;
}

export const COVER_ART_LAYOUTS: CoverArtLayout[] = [
  {
    key: "center-stage",
    label: "Center Stage",
    blurb: "Title front and center, artist right beneath",
    formats: ["single", "ep", "album"],
    titleZone: "center",
    titleScale: "hero",
    artistZone: "below-title",
    artistScale: "small",
    align: "center",
    subjectZone: "behind-title",
    badgeZone: null,
  },
  {
    key: "headline-top",
    label: "Headline Top",
    blurb: "Artist up top, title right under it — classic billing",
    formats: ["single", "album"],
    titleZone: "top",
    titleScale: "large",
    artistZone: "above-title",
    artistScale: "small",
    align: "center",
    subjectZone: "lower",
    badgeZone: null,
  },
  {
    key: "bottom-band",
    label: "Bottom Band",
    blurb: "Artwork breathes up top, title band along the bottom",
    formats: ["single", "ep"],
    titleZone: "bottom",
    titleScale: "large",
    artistZone: "below-title",
    artistScale: "small",
    align: "left",
    subjectZone: "upper",
    badgeZone: null,
  },
  {
    key: "split-frame",
    label: "Split Frame",
    blurb: "Subject on one side, words on the other",
    formats: ["ep", "album"],
    titleZone: "side",
    titleScale: "large",
    artistZone: "below-title",
    artistScale: "small",
    align: "left",
    subjectZone: "right",
    badgeZone: null,
  },
  {
    key: "corner-mark",
    label: "Corner Mark",
    blurb: "Small title block in the corner — art does the talking",
    formats: ["single", "ep", "album"],
    titleZone: "corner",
    titleScale: "small",
    artistZone: "below-title",
    artistScale: "small",
    align: "left",
    subjectZone: "full-bleed",
    badgeZone: null,
  },
  {
    key: "corner-seal",
    label: "Corner Seal",
    blurb: "Title up top, artist at the foot, corner kept clear for a seal",
    formats: ["single", "album"],
    titleZone: "top",
    titleScale: "medium",
    artistZone: "bottom",
    artistScale: "small",
    align: "center",
    subjectZone: "full-bleed",
    badgeZone: "bottom-right",
  },
  {
    key: "pure-art",
    label: "Pure Art",
    blurb: "No words at all — the artwork is the cover",
    formats: ["single", "ep", "album"],
    titleZone: "none",
    titleScale: "none",
    artistZone: "none",
    artistScale: "none",
    align: "center",
    subjectZone: "full-bleed",
    badgeZone: null,
  },
];

/** Unlike styles/ratios there is NO fallback layout — an unknown or empty
    key means freeform (no layout chosen), and the picker must say so. */
export function findCoverArtLayout(key: string): CoverArtLayout | undefined {
  if (!key) return undefined;
  return COVER_ART_LAYOUTS.find((l) => l.key === key);
}

export interface CoverArtLayoutDiagram {
  subject: { top: string; left: string; width: string; height: string };
  title: { top: string; left: string; width: string } | null;
  artist: { top: string; left: string; width: string } | null;
  badge: { bottom: string; right: string } | null;
}

const SUBJECT_RECTS: Record<CoverArtLayout["subjectZone"], CoverArtLayoutDiagram["subject"]> = {
  "full-bleed": { top: "0%", left: "0%", width: "100%", height: "100%" },
  "behind-title": { top: "0%", left: "0%", width: "100%", height: "100%" },
  upper: { top: "0%", left: "0%", width: "100%", height: "60%" },
  lower: { top: "36%", left: "0%", width: "100%", height: "64%" },
  right: { top: "0%", left: "48%", width: "52%", height: "100%" },
};

const TITLE_WIDTHS: Record<Exclude<CoverArtLayout["titleScale"], "none">, number> = {
  hero: 84,
  large: 70,
  medium: 54,
  small: 38,
};

const TITLE_TOPS: Record<Exclude<CoverArtLayout["titleZone"], "none" | "side" | "corner">, number> = {
  top: 8,
  center: 42,
  bottom: 74,
};

const ARTIST_WIDTHS: Record<Exclude<CoverArtLayout["artistScale"], "none">, number> = {
  medium: 44,
  small: 30,
};

function alignedLeft(widthPct: number, align: CoverArtLayout["align"]): number {
  if (align === "center") return (100 - widthPct) / 2;
  if (align === "right") return 100 - 6 - widthPct;
  return 6;
}

/** Percent-based schematic of a layout for the picker's mini diagram —
    derived from the same placement spec the rail honors, so the picture
    a member picks from is the composition they actually get. */
export function coverArtLayoutDiagram(layout: CoverArtLayout): CoverArtLayoutDiagram {
  const subject = SUBJECT_RECTS[layout.subjectZone];
  let title: CoverArtLayoutDiagram["title"] = null;
  if (layout.titleZone !== "none" && layout.titleScale !== "none") {
    let width = TITLE_WIDTHS[layout.titleScale];
    let top: number;
    let left: number;
    if (layout.titleZone === "side") {
      width = Math.min(width, 40);
      top = 10;
      left = 6;
    } else if (layout.titleZone === "corner") {
      width = Math.min(width, 38);
      top = 74;
      left = 6;
    } else {
      top = TITLE_TOPS[layout.titleZone];
      left = alignedLeft(width, layout.align);
    }
    title = { top: `${top}%`, left: `${left}%`, width: `${width}%` };
  }
  let artist: CoverArtLayoutDiagram["artist"] = null;
  if (layout.artistZone !== "none" && layout.artistScale !== "none") {
    const width = ARTIST_WIDTHS[layout.artistScale];
    let top: number;
    if (layout.artistZone === "below-title" && title) top = parseFloat(title.top) + 13;
    else if (layout.artistZone === "above-title" && title) top = Math.max(2, parseFloat(title.top) - 9);
    else if (layout.artistZone === "top") top = 3;
    else if (layout.artistZone === "bottom") top = 90;
    else top = 88;
    const left =
      layout.titleZone === "side" || layout.titleZone === "corner"
        ? 6
        : alignedLeft(width, layout.align);
    artist = { top: `${top}%`, left: `${left}%`, width: `${width}%` };
  }
  const badge =
    layout.badgeZone === "bottom-right" ? { bottom: "5%", right: "5%" } : null;
  return { subject, title, artist, badge };
}

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
