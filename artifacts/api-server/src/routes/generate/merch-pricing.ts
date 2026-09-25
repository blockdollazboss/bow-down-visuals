/**
 * Pure pricing/product/style/margin logic for the Merch Designer.
 * Kept dependency-free so it can be unit-tested without the server.
 */

/** Site credits charged per AI design batch (2 mockups). Env-overridable at the route. */
export const MERCH_DESIGN_CREDIT_COST = 3;

/** Future platform commission on merch sales (percent). Recorded as intent;
 *  checkout is honestly "coming soon" — no payments are processed yet. */
export const MERCH_COMMISSION_PCT = 15;

/** How many mockups one design batch generates. */
export const MERCH_BATCH_SIZE = 2;

/* ─── Products ──────────────────────────────────────────────────────────
   baseCostCents = print-on-demand base cost snapshot (USD cents).
   These are estimates shown to the creator so they can price with margin. */

export type MerchProductKey = "t-shirt" | "hoodie" | "cap" | "poster";

export const MERCH_PRODUCTS: Record<
  MerchProductKey,
  { label: string; blurb: string; baseCostCents: number }
> = {
  "t-shirt": { label: "T-Shirt", blurb: "Classic crew tee", baseCostCents: 1200 },
  hoodie: { label: "Hoodie", blurb: "Heavyweight pullover", baseCostCents: 2800 },
  cap: { label: "Cap", blurb: "Snapback / dad hat", baseCostCents: 1500 },
  poster: { label: "Poster", blurb: '18"×24" matte print', baseCostCents: 800 },
};

export const MERCH_PRODUCT_KEYS = Object.keys(MERCH_PRODUCTS) as MerchProductKey[];

export function isMerchProductKey(s: unknown): s is MerchProductKey {
  return typeof s === "string" && (MERCH_PRODUCT_KEYS as string[]).includes(s);
}

/* ─── Styles ──────────────────────────────────────────────────────────── */

export type MerchStyleKey = "streetwear" | "minimal" | "vintage" | "luxury-gold";

export const MERCH_STYLES: Record<MerchStyleKey, { label: string; blurb: string; directive: string }> = {
  streetwear: {
    label: "Streetwear",
    blurb: "Bold graphics, urban energy",
    directive:
      "bold streetwear graphic design, oversized statement print, urban hip-hop aesthetic, " +
      "heavy typography mixed with striking illustration, high contrast, edgy and confident",
  },
  minimal: {
    label: "Minimal",
    blurb: "Clean, subtle, timeless",
    directive:
      "minimalist merch design, small refined chest print or subtle centered mark, " +
      "clean lines, generous negative space, understated premium streetwear feel",
  },
  vintage: {
    label: "Vintage",
    blurb: "Retro, worn-in, classic",
    directive:
      "vintage retro merch design, distressed worn-in print texture, classic 90s " +
      "band-tee aesthetic, warm faded colors, nostalgic and authentic",
  },
  "luxury-gold": {
    label: "Luxury Gold",
    blurb: "Black & gold, premium finish",
    directive:
      "luxury merch design, deep black garment with rich metallic gold print, " +
      "elegant serif typography, gold-foil look, premium high-end fashion house finish",
  },
};

export const MERCH_STYLE_KEYS = Object.keys(MERCH_STYLES) as MerchStyleKey[];

export function isMerchStyleKey(s: unknown): s is MerchStyleKey {
  return typeof s === "string" && (MERCH_STYLE_KEYS as string[]).includes(s);
}

/**
 * Builds the image-generation prompt for one mockup in a batch.
 * The variant index nudges the model to produce visibly different options
 * (different composition / angle) so the batch feels like real choices.
 */
export function buildMerchPrompt(
  product: MerchProductKey,
  style: MerchStyleKey,
  description: string,
  variant: number,
): string {
  const desc = description.trim().slice(0, 300) || "original graphic artwork";
  const styleDirective = MERCH_STYLES[style].directive;
  const productLabel = MERCH_PRODUCTS[product].label;
  const angles = [
    "straight-on product photo, design centered and fully visible",
    "slight three-quarter angle product photo, design clearly visible",
  ];
  const angle = angles[variant % angles.length];
  return [
    `E-commerce product mockup photo of a ${productLabel} featuring ${desc}.`,
    styleDirective + ".",
    `${angle}, studio lighting, clean neutral background,`,
    "the design printed crisply on the product, no watermark, no extra text,",
    "no people wearing it, product only, photorealistic mockup.",
  ].join(" ");
}

export interface MerchMargin {
  /** Creator profit in cents after base cost and platform commission. */
  profitCents: number;
  /** Profit as a percent of retail price (0-100). */
  marginPct: number;
  /** Platform commission in cents (future — shown for transparency). */
  commissionCents: number;
}

/**
 * Creator margin math. priceCents is the retail price the creator sets.
 * commissionPct defaults to the future platform cut so creators see the
 * real net before payments go live.
 */
export function calculateMerchMargin(
  priceCents: number,
  baseCostCents: number,
  commissionPct: number = MERCH_COMMISSION_PCT,
): MerchMargin {
  const commissionCents = Math.round((priceCents * commissionPct) / 100);
  const profitCents = priceCents - baseCostCents - commissionCents;
  const marginPct = priceCents > 0 ? Math.round((profitCents / priceCents) * 100) : 0;
  return { profitCents, marginPct, commissionCents };
}

/** Suggested retail = base cost with a healthy ~60% margin after commission. */
export function suggestRetailPrice(baseCostCents: number, commissionPct: number = MERCH_COMMISSION_PCT): number {
  const target = baseCostCents / (1 - commissionPct / 100 - 0.6);
  return Math.max(baseCostCents + 500, Math.round(target / 100) * 100);
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}
