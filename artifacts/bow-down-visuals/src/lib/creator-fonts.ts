/**
 * Creator font library — the canonical catalog (Stack-200 fonts lane).
 *
 * Every family here is open-license ONLY (SIL OFL 1.1 or Apache-2.0),
 * verified per-family against the google/fonts repo tree by
 * scripts/fetch-creator-fonts.py (a family under ofl/ is OFL, under
 * apache/ is Apache-2.0; unverifiable families were dropped — none were).
 * Files are SELF-HOSTED woff2 (latin) in public/fonts/creator/, loaded
 * on demand from /fonts/creator-fonts.css via ensureCreatorFonts().
 * The house set (Cinzel + Manrope) sits at the top and is also the
 * site-wide pairing (see index.css @theme tokens).
 */
export type CreatorFontCategory =
  | "House" | "Royal Serifs" | "Strong Sans" | "Condensed Poster"
  | "Bold Display" | "Handwritten" | "Scripts" | "Pixel";

export type CreatorFontLicense = "OFL-1.1" | "Apache-2.0";

export interface CreatorFont {
  /** Stable id (repo slug). */
  id: string;
  /** Canonical family name (CSS font-family). */
  family: string;
  category: CreatorFontCategory;
  blurb: string;
  /** Verified open license — see header. */
  license: CreatorFontLicense;
  /** House set members pin to the top of every picker. */
  house?: boolean;
  /** CSS fallback stack after the family. */
  fallback: string;
  /** Self-hosted woff2 file names under /fonts/creator/. */
  files: string[];
}

export const CREATOR_FONT_CATEGORIES: CreatorFontCategory[] = [
  "House", "Royal Serifs", "Strong Sans", "Condensed Poster",
  "Bold Display", "Handwritten", "Scripts", "Pixel",
];

export const CREATOR_FONTS: CreatorFont[] = [
  { id: "cinzel", family: "Cinzel", category: "House", blurb: "The house display voice. Roman imperial caps.", license: "OFL-1.1", house: true, fallback: "Georgia, serif", files: ["cinzel-400.woff2", "cinzel-700.woff2", "cinzel-900.woff2"] },
  { id: "manrope", family: "Manrope", category: "House", blurb: "The house body voice. Clean, warm, readable.", license: "OFL-1.1", house: true, fallback: "system-ui, sans-serif", files: ["manrope-400.woff2", "manrope-600.woff2", "manrope-800.woff2"] },
  { id: "playfairdisplay", family: "Playfair Display", category: "Royal Serifs", blurb: "High-fashion editorial serif.", license: "OFL-1.1", fallback: "Georgia, serif", files: ["playfairdisplay-400.woff2", "playfairdisplay-700.woff2", "playfairdisplay-900.woff2"] },
  { id: "cormorantgaramond", family: "Cormorant Garamond", category: "Royal Serifs", blurb: "Delicate luxury serif.", license: "OFL-1.1", fallback: "Georgia, serif", files: ["cormorantgaramond-400.woff2", "cormorantgaramond-600.woff2", "cormorantgaramond-700.woff2"] },
  { id: "marcellus", family: "Marcellus", category: "Royal Serifs", blurb: "Flared Roman elegance.", license: "OFL-1.1", fallback: "Georgia, serif", files: ["marcellus-400.woff2"] },
  { id: "bodonimoda", family: "Bodoni Moda", category: "Royal Serifs", blurb: "Didone drama. Vogue energy.", license: "OFL-1.1", fallback: "Georgia, serif", files: ["bodonimoda-400.woff2", "bodonimoda-700.woff2", "bodonimoda-900.woff2"] },
  { id: "cinzeldecorative", family: "Cinzel Decorative", category: "Royal Serifs", blurb: "Ornamental royal caps.", license: "OFL-1.1", fallback: "Georgia, serif", files: ["cinzeldecorative-400.woff2", "cinzeldecorative-700.woff2", "cinzeldecorative-900.woff2"] },
  { id: "fraunces", family: "Fraunces", category: "Royal Serifs", blurb: "Soft, wonky old-style serif with swagger.", license: "OFL-1.1", fallback: "Georgia, serif", files: ["fraunces-400.woff2", "fraunces-700.woff2", "fraunces-900.woff2"] },
  { id: "librebaskerville", family: "Libre Baskerville", category: "Royal Serifs", blurb: "Bookish, trustworthy serif.", license: "OFL-1.1", fallback: "Georgia, serif", files: ["librebaskerville-400.woff2", "librebaskerville-700.woff2"] },
  { id: "ebgaramond", family: "EB Garamond", category: "Royal Serifs", blurb: "Classic literary Garamond.", license: "OFL-1.1", fallback: "Georgia, serif", files: ["ebgaramond-400.woff2", "ebgaramond-600.woff2", "ebgaramond-700.woff2"] },
  { id: "lora", family: "Lora", category: "Royal Serifs", blurb: "Contemporary calligraphic serif.", license: "OFL-1.1", fallback: "Georgia, serif", files: ["lora-400.woff2", "lora-600.woff2", "lora-700.woff2"] },
  { id: "dmserifdisplay", family: "DM Serif Display", category: "Royal Serifs", blurb: "Bold editorial display serif.", license: "OFL-1.1", fallback: "Georgia, serif", files: ["dmserifdisplay-400.woff2"] },
  { id: "abrilfatface", family: "Abril Fatface", category: "Royal Serifs", blurb: "Poster-weight Didone headline.", license: "OFL-1.1", fallback: "Georgia, serif", files: ["abrilfatface-400.woff2"] },
  { id: "inter", family: "Inter", category: "Strong Sans", blurb: "The interface standard.", license: "OFL-1.1", fallback: "system-ui, sans-serif", files: ["inter-400.woff2", "inter-600.woff2", "inter-800.woff2"] },
  { id: "montserrat", family: "Montserrat", category: "Strong Sans", blurb: "Urban geometric classic.", license: "OFL-1.1", fallback: "system-ui, sans-serif", files: ["montserrat-400.woff2", "montserrat-700.woff2", "montserrat-900.woff2"] },
  { id: "poppins", family: "Poppins", category: "Strong Sans", blurb: "Geometric friendly bold.", license: "OFL-1.1", fallback: "system-ui, sans-serif", files: ["poppins-400.woff2", "poppins-700.woff2", "poppins-800.woff2"] },
  { id: "spacegrotesk", family: "Space Grotesk", category: "Strong Sans", blurb: "Techy modern grotesque.", license: "OFL-1.1", fallback: "system-ui, sans-serif", files: ["spacegrotesk-400.woff2", "spacegrotesk-600.woff2", "spacegrotesk-700.woff2"] },
  { id: "dmsans", family: "DM Sans", category: "Strong Sans", blurb: "Low-contrast workhorse sans.", license: "OFL-1.1", fallback: "system-ui, sans-serif", files: ["dmsans-400.woff2", "dmsans-700.woff2"] },
  { id: "worksans", family: "Work Sans", category: "Strong Sans", blurb: "Versatile grotesque for UI and titles.", license: "OFL-1.1", fallback: "system-ui, sans-serif", files: ["worksans-400.woff2", "worksans-600.woff2", "worksans-800.woff2"] },
  { id: "outfit", family: "Outfit", category: "Strong Sans", blurb: "Clean geometric with soft corners.", license: "OFL-1.1", fallback: "system-ui, sans-serif", files: ["outfit-400.woff2", "outfit-700.woff2", "outfit-900.woff2"] },
  { id: "sora", family: "Sora", category: "Strong Sans", blurb: "Futuristic grotesque, tech-launch energy.", license: "OFL-1.1", fallback: "system-ui, sans-serif", files: ["sora-400.woff2", "sora-700.woff2"] },
  { id: "plusjakartasans", family: "Plus Jakarta Sans", category: "Strong Sans", blurb: "Friendly modern sans from Jakarta.", license: "OFL-1.1", fallback: "system-ui, sans-serif", files: ["plusjakartasans-400.woff2", "plusjakartasans-700.woff2", "plusjakartasans-800.woff2"] },
  { id: "bebasneue", family: "Bebas Neue", category: "Condensed Poster", blurb: "Tall condensed classic.", license: "OFL-1.1", fallback: "Arial Narrow, sans-serif", files: ["bebasneue-400.woff2"] },
  { id: "oswald", family: "Oswald", category: "Condensed Poster", blurb: "Tall condensed sans.", license: "OFL-1.1", fallback: "Arial Narrow, sans-serif", files: ["oswald-400.woff2", "oswald-600.woff2", "oswald-700.woff2"] },
  { id: "barlowcondensed", family: "Barlow Condensed", category: "Condensed Poster", blurb: "Condensed punch for sports.", license: "OFL-1.1", fallback: "Arial Narrow, sans-serif", files: ["barlowcondensed-600.woff2", "barlowcondensed-700.woff2"] },
  { id: "fjallaone", family: "Fjalla One", category: "Condensed Poster", blurb: "Sturdy condensed poster sans.", license: "OFL-1.1", fallback: "Arial Narrow, sans-serif", files: ["fjallaone-400.woff2"] },
  { id: "archivonarrow", family: "Archivo Narrow", category: "Condensed Poster", blurb: "Narrow grotesque for tight headlines.", license: "OFL-1.1", fallback: "Arial Narrow, sans-serif", files: ["archivonarrow-400.woff2", "archivonarrow-700.woff2"] },
  { id: "staatliches", family: "Staatliches", category: "Condensed Poster", blurb: "German poster condensed, all muscle.", license: "OFL-1.1", fallback: "Arial Narrow, sans-serif", files: ["staatliches-400.woff2"] },
  { id: "anton", family: "Anton", category: "Bold Display", blurb: "The thumbnail screamer. Maximum impact.", license: "OFL-1.1", fallback: "Arial Black, sans-serif", files: ["anton-400.woff2"] },
  { id: "archivoblack", family: "Archivo Black", category: "Bold Display", blurb: "Heavy grotesque. Built for headlines.", license: "OFL-1.1", fallback: "Arial Black, sans-serif", files: ["archivoblack-400.woff2"] },
  { id: "alfaslabone", family: "Alfa Slab One", category: "Bold Display", blurb: "Slab serif with authority.", license: "OFL-1.1", fallback: "Arial Black, sans-serif", files: ["alfaslabone-400.woff2"] },
  { id: "titanone", family: "Titan One", category: "Bold Display", blurb: "Chunky cartoon bounce.", license: "OFL-1.1", fallback: "Arial Black, sans-serif", files: ["titanone-400.woff2"] },
  { id: "bungee", family: "Bungee", category: "Bold Display", blurb: "Vertical urban signage.", license: "OFL-1.1", fallback: "Arial Black, sans-serif", files: ["bungee-400.woff2"] },
  { id: "righteous", family: "Righteous", category: "Bold Display", blurb: "Geometric retro-future.", license: "OFL-1.1", fallback: "Arial Black, sans-serif", files: ["righteous-400.woff2"] },
  { id: "luckiestguy", family: "Luckiest Guy", category: "Bold Display", blurb: "Lucky cartoon heavyweight.", license: "Apache-2.0", fallback: "Arial Black, sans-serif", files: ["luckiestguy-400.woff2"] },
  { id: "rubikmonoone", family: "Rubik Mono One", category: "Bold Display", blurb: "Monospace block power.", license: "OFL-1.1", fallback: "Arial Black, sans-serif", files: ["rubikmonoone-400.woff2"] },
  { id: "monoton", family: "Monoton", category: "Bold Display", blurb: "Neon tube display.", license: "OFL-1.1", fallback: "Arial Black, sans-serif", files: ["monoton-400.woff2"] },
  { id: "fascinateinline", family: "Fascinate Inline", category: "Bold Display", blurb: "Deco inline display.", license: "OFL-1.1", fallback: "Arial Black, sans-serif", files: ["fascinateinline-400.woff2"] },
  { id: "wallpoet", family: "Wallpoet", category: "Bold Display", blurb: "Stenciled street type.", license: "OFL-1.1", fallback: "Arial Black, sans-serif", files: ["wallpoet-400.woff2"] },
  { id: "blackopsone", family: "Black Ops One", category: "Bold Display", blurb: "Military stencil block.", license: "OFL-1.1", fallback: "Arial Black, sans-serif", files: ["blackopsone-400.woff2"] },
  { id: "creepster", family: "Creepster", category: "Bold Display", blurb: "Horror dripping display.", license: "OFL-1.1", fallback: "Arial Black, sans-serif", files: ["creepster-400.woff2"] },
  { id: "bowlbyone", family: "Bowlby One", category: "Bold Display", blurb: "Fat rounded poster block.", license: "OFL-1.1", fallback: "Arial Black, sans-serif", files: ["bowlbyone-400.woff2"] },
  { id: "russoone", family: "Russo One", category: "Bold Display", blurb: "Squared techno display.", license: "OFL-1.1", fallback: "Arial Black, sans-serif", files: ["russoone-400.woff2"] },
  { id: "permanentmarker", family: "Permanent Marker", category: "Handwritten", blurb: "Bold marker scrawl.", license: "Apache-2.0", fallback: "cursive", files: ["permanentmarker-400.woff2"] },
  { id: "caveat", family: "Caveat", category: "Handwritten", blurb: "Casual handwritten note.", license: "OFL-1.1", fallback: "cursive", files: ["caveat-400.woff2", "caveat-700.woff2"] },
  { id: "shadowsintolight", family: "Shadows Into Light", category: "Handwritten", blurb: "Light handwritten charm.", license: "OFL-1.1", fallback: "cursive", files: ["shadowsintolight-400.woff2"] },
  { id: "gochihand", family: "Gochi Hand", category: "Handwritten", blurb: "Playful hand lettering.", license: "OFL-1.1", fallback: "cursive", files: ["gochihand-400.woff2"] },
  { id: "rocksalt", family: "Rock Salt", category: "Handwritten", blurb: "Grungy hand scrawl.", license: "Apache-2.0", fallback: "cursive", files: ["rocksalt-400.woff2"] },
  { id: "kalam", family: "Kalam", category: "Handwritten", blurb: "Warm brushy handwriting.", license: "OFL-1.1", fallback: "cursive", files: ["kalam-400.woff2", "kalam-700.woff2"] },
  { id: "patrickhand", family: "Patrick Hand", category: "Handwritten", blurb: "Neat notebook handwriting.", license: "OFL-1.1", fallback: "cursive", files: ["patrickhand-400.woff2"] },
  { id: "architectsdaughter", family: "Architects Daughter", category: "Handwritten", blurb: "Sketchbook hand lettering.", license: "OFL-1.1", fallback: "cursive", files: ["architectsdaughter-400.woff2"] },
  { id: "satisfy", family: "Satisfy", category: "Scripts", blurb: "Flowing casual script.", license: "Apache-2.0", fallback: "cursive", files: ["satisfy-400.woff2"] },
  { id: "greatvibes", family: "Great Vibes", category: "Scripts", blurb: "Formal calligraphy script.", license: "OFL-1.1", fallback: "cursive", files: ["greatvibes-400.woff2"] },
  { id: "dancingscript", family: "Dancing Script", category: "Scripts", blurb: "Bouncy lively script.", license: "OFL-1.1", fallback: "cursive", files: ["dancingscript-400.woff2", "dancingscript-700.woff2"] },
  { id: "pacifico", family: "Pacifico", category: "Scripts", blurb: "Retro surf script.", license: "OFL-1.1", fallback: "cursive", files: ["pacifico-400.woff2"] },
  { id: "lobster", family: "Lobster", category: "Scripts", blurb: "Bold retro script sign-painting.", license: "OFL-1.1", fallback: "cursive", files: ["lobster-400.woff2"] },
  { id: "allura", family: "Allura", category: "Scripts", blurb: "Elegant wedding script.", license: "OFL-1.1", fallback: "cursive", files: ["allura-400.woff2"] },
  { id: "sacramento", family: "Sacramento", category: "Scripts", blurb: "Thin monoline script.", license: "OFL-1.1", fallback: "cursive", files: ["sacramento-400.woff2"] },
  { id: "alexbrush", family: "Alex Brush", category: "Scripts", blurb: "Graceful formal brush script.", license: "OFL-1.1", fallback: "cursive", files: ["alexbrush-400.woff2"] },
  { id: "pressstart2p", family: "Press Start 2P", category: "Pixel", blurb: "The original 8-bit arcade voice.", license: "OFL-1.1", fallback: "monospace", files: ["pressstart2p-400.woff2"] },
  { id: "silkscreen", family: "Silkscreen", category: "Pixel", blurb: "Crisp pixel type, small sizes shine.", license: "OFL-1.1", fallback: "monospace", files: ["silkscreen-400.woff2", "silkscreen-700.woff2"] },
  { id: "vt323", family: "VT323", category: "Pixel", blurb: "CRT terminal green-screen type.", license: "OFL-1.1", fallback: "monospace", files: ["vt323-400.woff2"] },
  { id: "dotgothic16", family: "DotGothic16", category: "Pixel", blurb: "Japanese dot-matrix gothic.", license: "OFL-1.1", fallback: "monospace", files: ["dotgothic16-400.woff2"] },
  { id: "pixelifysans", family: "Pixelify Sans", category: "Pixel", blurb: "Friendly pixel sans, readable at size.", license: "OFL-1.1", fallback: "monospace", files: ["pixelifysans-400.woff2", "pixelifysans-700.woff2"] },
];

export const CREATOR_FONT_COUNT = CREATOR_FONTS.length;
export const HOUSE_FONTS: CreatorFont[] = CREATOR_FONTS.filter((f) => f.house);

export function getCreatorFont(idOrFamily: string | undefined | null): CreatorFont | undefined {
  if (!idOrFamily) return undefined;
  return CREATOR_FONTS.find((f) => f.id === idOrFamily || f.family === idOrFamily);
}

/** CSS font-family value with the catalog fallback stack. */
export function creatorFontFamily(idOrFamily: string | undefined | null): string | undefined {
  const f = getCreatorFont(idOrFamily);
  return f ? `"${f.family}", ${f.fallback}` : undefined;
}

export function creatorFontsByCategory(category: CreatorFontCategory): CreatorFont[] {
  return CREATOR_FONTS.filter((f) => f.category === category);
}
