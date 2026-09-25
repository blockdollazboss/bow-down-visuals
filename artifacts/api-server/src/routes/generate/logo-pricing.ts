/**
 * Pure pricing/plan/style resolution for the Logo Maker.
 * Kept dependency-free so it can be unit-tested without the server.
 */

/** The two logo quality tiers. Premium = GPT Image 2.5 (best, synchronous). Standard = Runway Gen4 (async). */
export type LogoModel = "premium" | "standard";

export const LOGO_PREMIUM_CREDIT_COST = 2;
export const LOGO_STANDARD_CREDIT_COST = 1;

export interface LogoPlan {
  model: LogoModel;
  /** Site credits charged on success. */
  creditCost: number;
}

export function resolveLogoPlan(opts: { model?: string }): LogoPlan {
  const model: LogoModel = opts.model === "standard" ? "standard" : "premium";
  return {
    model,
    creditCost: model === "standard" ? LOGO_STANDARD_CREDIT_COST : LOGO_PREMIUM_CREDIT_COST,
  };
}

/* ─── Style presets ───────────────────────────────────────────────────────
   Each style injects a visual directive into the image prompt so the
   generator stays on-brief. The brand name is always rendered as
   typography in the logo. */

export type LogoStyleKey = "luxury-gold" | "gaming" | "minimal" | "mascot";

export const LOGO_STYLES: Record<LogoStyleKey, { label: string; blurb: string; directive: string }> = {
  "luxury-gold": {
    label: "Luxury Gold",
    blurb: "Black & gold, premium finish",
    directive:
      "luxury brand identity, deep black background with rich metallic gold accents, " +
      "elegant serif typography, subtle gold foil texture, premium high-end finish, " +
      "cinematic lighting, sophisticated and expensive feel",
  },
  gaming: {
    label: "Gaming",
    blurb: "Bold, aggressive, esports energy",
    directive:
      "bold esports gaming logo, aggressive angular shapes, neon accent lighting, " +
      "dynamic sharp typography, high contrast, energetic and powerful, " +
      "dark background with electric highlights",
  },
  minimal: {
    label: "Minimal",
    blurb: "Clean, modern, timeless",
    directive:
      "minimalist modern logo design, clean geometric shapes, generous negative space, " +
      "simple sans-serif typography, monochrome with one accent color, " +
      "timeless professional brand mark",
  },
  mascot: {
    label: "Mascot",
    blurb: "Character-driven, memorable",
    directive:
      "bold mascot logo design, memorable character illustration integrated with " +
      "strong typography, vibrant colors on dark background, streetwear brand energy, " +
      "clean vector-style illustration, instantly recognizable",
  },
};

export const LOGO_STYLE_KEYS = Object.keys(LOGO_STYLES) as LogoStyleKey[];

export function isLogoStyleKey(s: unknown): s is LogoStyleKey {
  return typeof s === "string" && (LOGO_STYLE_KEYS as string[]).includes(s);
}

/**
 * Builds the full image-generation prompt for a logo.
 * The brand name is always the typographic hero; the style directive sets
 * the visual world around it.
 */
export function buildLogoPrompt(brandName: string, style: LogoStyleKey, tagline?: string): string {
  const name = brandName.trim().slice(0, 60);
  const tag = tagline?.trim().slice(0, 80);
  const styleDirective = LOGO_STYLES[style].directive;
  const parts = [
    `Professional logo design for the brand "${name}".`,
    styleDirective + ".",
    `The brand name "${name}" rendered as crisp, legible typography — the centerpiece of the logo.`,
  ];
  if (tag) parts.push(`Tagline "${tag}" in smaller supporting type beneath the name.`);
  parts.push(
    "Centered composition, logo fills the frame, no photo background, no watermark, " +
      "no extra text, vector-quality clean edges.",
  );
  return parts.join(" ");
}
