/* ─── Thy Library — font catalog ───
   Curated Google Fonts for creators. All free, no licensing issues.
   Loaded via index.html link tags; applied with one click in text tools. */

export type LibraryFontCategory =
  | "Bold Display"
  | "Elegant Serif"
  | "Clean Sans"
  | "Handwritten"
  | "Street & Urban";

export interface LibraryFont {
  /** Google Fonts family name. */
  family: string;
  /** URL-encoded family for the CSS API (spaces → +). */
  apiName: string;
  category: LibraryFontCategory;
  blurb: string;
  /** Weights to load. */
  weights: string;
}

export const LIBRARY_FONT_CATEGORIES: LibraryFontCategory[] = [
  "Bold Display",
  "Elegant Serif",
  "Clean Sans",
  "Handwritten",
  "Street & Urban",
];

export const LIBRARY_FONTS: LibraryFont[] = [
  /* ── Bold Display ── */
  { family: "Anton", apiName: "Anton", category: "Bold Display", blurb: "The thumbnail screamer. Maximum impact.", weights: "400" },
  { family: "Archivo Black", apiName: "Archivo+Black", category: "Bold Display", blurb: "Heavy grotesque. Built for headlines.", weights: "400" },
  { family: "Bebas Neue", apiName: "Bebas+Neue", category: "Bold Display", blurb: "Tall condensed classic.", weights: "400" },
  { family: "Alfa Slab One", apiName: "Alfa+Slab+One", category: "Bold Display", blurb: "Slab serif with authority.", weights: "400" },
  { family: "Titan One", apiName: "Titan+One", category: "Bold Display", blurb: "Chunky cartoon bounce.", weights: "400" },
  { family: "Bungee", apiName: "Bungee", category: "Bold Display", blurb: "Vertical urban signage.", weights: "400" },
  { family: "Righteous", apiName: "Righteous", category: "Bold Display", blurb: "Geometric retro-future.", weights: "400" },
  /* ── Elegant Serif ── */
  { family: "Playfair Display", apiName: "Playfair+Display", category: "Elegant Serif", blurb: "High-fashion editorial serif.", weights: "400;700;900" },
  { family: "Cinzel", apiName: "Cinzel", category: "Elegant Serif", blurb: "Roman imperial caps.", weights: "400;700;900" },
  { family: "Cormorant Garamond", apiName: "Cormorant+Garamond", category: "Elegant Serif", blurb: "Delicate luxury serif.", weights: "400;600;700" },
  { family: "Marcellus", apiName: "Marcellus", category: "Elegant Serif", blurb: "Flared Roman elegance.", weights: "400" },
  { family: "Bodoni Moda", apiName: "Bodoni+Moda", category: "Elegant Serif", blurb: "Didone drama. Vogue energy.", weights: "400;700;900" },
  /* ── Clean Sans ── */
  { family: "Inter", apiName: "Inter", category: "Clean Sans", blurb: "The interface standard.", weights: "400;600;800" },
  { family: "Poppins", apiName: "Poppins", category: "Clean Sans", blurb: "Geometric friendly bold.", weights: "400;700;800" },
  { family: "Montserrat", apiName: "Montserrat", category: "Clean Sans", blurb: "Urban geometric classic.", weights: "400;700;900" },
  { family: "Barlow Condensed", apiName: "Barlow+Condensed", category: "Clean Sans", blurb: "Condensed punch for sports.", weights: "600;700" },
  { family: "Oswald", apiName: "Oswald", category: "Clean Sans", blurb: "Tall condensed sans.", weights: "400;600;700" },
  { family: "Space Grotesk", apiName: "Space+Grotesk", category: "Clean Sans", blurb: "Techy modern grotesque.", weights: "400;600;700" },
  /* ── Handwritten ── */
  { family: "Permanent Marker", apiName: "Permanent+Marker", category: "Handwritten", blurb: "Bold marker scrawl.", weights: "400" },
  { family: "Caveat", apiName: "Caveat", category: "Handwritten", blurb: "Casual handwritten note.", weights: "400;700" },
  { family: "Shadows Into Light", apiName: "Shadows+Into+Light", category: "Handwritten", blurb: "Light handwritten charm.", weights: "400" },
  { family: "Gochi Hand", apiName: "Gochi+Hand", category: "Handwritten", blurb: "Playful hand lettering.", weights: "400" },
  { family: "Rock Salt", apiName: "Rock+Salt", category: "Handwritten", blurb: "Grungy hand scrawl.", weights: "400" },
  { family: "Satisfy", apiName: "Satisfy", category: "Handwritten", blurb: "Flowing script.", weights: "400" },
  /* ── Street & Urban ── */
  { family: "Luckiest Guy", apiName: "Luckiest+Guy", category: "Street & Urban", blurb: "Lucky cartoon heavyweight.", weights: "400" },
  { family: "Rubik Mono One", apiName: "Rubik+Mono+One", category: "Street & Urban", blurb: "Monospace block power.", weights: "400" },
  { family: "Monoton", apiName: "Monoton", category: "Street & Urban", blurb: "Neon tube display.", weights: "400" },
  { family: "Fascinate Inline", apiName: "Fascinate+Inline", category: "Street & Urban", blurb: "Deco inline display.", weights: "400" },
  { family: "Wallpoet", apiName: "Wallpoet", category: "Street & Urban", blurb: "Stenciled street type.", weights: "400" },
  { family: "Black Ops One", apiName: "Black+Ops+One", category: "Street & Urban", blurb: "Military stencil block.", weights: "400" },
  { family: "Creepster", apiName: "Creepster", category: "Street & Urban", blurb: "Horror dripping display.", weights: "400" },
];

export const LIBRARY_FONT_COUNT = LIBRARY_FONTS.length;

/** Build the Google Fonts CSS API URL for the full catalog. */
export function libraryFontsUrl(): string {
  const families = LIBRARY_FONTS.map((f) => `family=${f.apiName}:wght@${f.weights}`).join("&");
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}

export function getLibraryFontsByCategory(category: LibraryFontCategory): LibraryFont[] {
  return LIBRARY_FONTS.filter((f) => f.category === category);
}
