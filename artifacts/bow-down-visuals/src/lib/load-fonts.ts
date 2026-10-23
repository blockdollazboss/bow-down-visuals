/**
 * Stack-28 #50 (A5-P4) — on-demand Google Fonts.
 *
 * Only the UI fonts (Inter + Playfair Display) stay in index.html as a
 * global, render-blocking stylesheet. The 31 caption/library families
 * that used to sit in two more global <link> stylesheets now load ONLY
 * when a surface that renders them mounts:
 *   - caption families  → CaptionsSection / video-editor (caption previews)
 *   - library families  → the Library page's Fonts tab surface
 * The URLs below are byte-identical to the old index.html links, and
 * `display=swap` is preserved, so once a surface loads its families the
 * rendering is exactly as before (font-display behavior pinned by test).
 */

export const CAPTION_FONTS_CSS_URL =
  "https://fonts.googleapis.com/css2?family=Anton&family=Alfa+Slab+One&family=Archivo+Black&family=Barlow+Condensed:wght@700&family=Bebas+Neue&family=Bungee&family=Cinzel:wght@700&family=Luckiest+Guy&family=Permanent+Marker&family=Poppins:wght@700&family=Righteous&family=Titan+One&display=swap";

export const LIBRARY_FONTS_CSS_URL =
  "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=Marcellus&family=Bodoni+Moda:wght@400;700;900&family=Montserrat:wght@400;700;900&family=Oswald:wght@400;600;700&family=Space+Grotesk:wght@400;600;700&family=Caveat:wght@400;700&family=Shadows+Into+Light&family=Gochi+Hand&family=Rock+Salt&family=Satisfy&family=Rubik+Mono+One&family=Monoton&family=Fascinate+Inline&family=Wallpoet&family=Black+Ops+One&family=Creepster&display=swap";

export const UI_FONTS_CSS_URL =
  "https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Playfair+Display:ital,wght@0,400..800;1,400..700&display=swap";

/** Inject a font stylesheet once (idempotent per element id). */
export function ensureFontStylesheet(id: string, href: string): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(id)) return;
  const link = document.createElement("link");
  link.id = id;
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

export function ensureCaptionFonts(): void {
  ensureFontStylesheet("bdv-caption-fonts", CAPTION_FONTS_CSS_URL);
}

export function ensureLibraryFonts(): void {
  ensureFontStylesheet("bdv-library-fonts", LIBRARY_FONTS_CSS_URL);
}
