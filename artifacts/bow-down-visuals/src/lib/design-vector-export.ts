/**
 * design-vector-export.ts — honest vector (SVG) export for the design
 * surfaces the Photo desk's exporter (lib/photo-design-export.ts) does
 * not cover: the Branding Kit, Logo Studio and Thumbnail Studio.
 *
 * HONESTY RULES (same law as the Photo desk):
 *  - An SVG is built ONLY from data that is truly vector-expressible:
 *    text (brand name, taglines, labels) and shapes (palette swatches).
 *    The brand sheet below serializes the kit's own stored values —
 *    nothing is traced, guessed or redrawn.
 *  - A generated logo / thumbnail is ONE raster picture. It is NEVER
 *    embedded in an SVG (no image element, no data-URL, no "PNG in an
 *    SVG wrapper") and never described as a vector. Surfaces whose
 *    design is raster-only get an honest refusal plus the raster
 *    options that DO exist (the full-resolution PNG download).
 *  - If a brand kit holds nothing vector-expressible, there is no SVG:
 *    the result says why instead of handing over an empty shell.
 *
 * PRICE: exports on these desks are free and client-side, exactly like
 * the Photo desk's design exports (editor-free law — see
 * photo-design-export.ts). No charge rail exists for design-file
 * downloads and none is invented here; the branded-FREE / clean-400 VB
 * rail governs video renders (routes/generate/export-video.ts), not
 * brand sheets.
 */
import type { BrandKit } from "./brand-kit";

/* ── small helpers (mirrors photo-design-export.ts) ─────────────────── */

const fmt = (n: number): string => {
  const v = Math.round(n * 100) / 100;
  return Object.is(v, -0) ? "0" : String(v);
};

function escText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escAttr(s: string): string {
  return escText(s).replace(/"/g, "&quot;");
}
/** XML comments may not contain "--"; make arbitrary text safe. */
function commentSafe(s: string): string {
  return s.replace(/--+/g, "—").replace(/-+$/, "");
}

const HEX6 = /^#[0-9a-fA-F]{6}$/;
/** Only a real #RRGGBB value may become a fill — anything else is not
 *  a color the sheet can honestly paint. */
function safeHex(raw: string): string | null {
  const s = raw.trim();
  return HEX6.test(s) ? s : null;
}

/* ── shared result vocabulary ───────────────────────────────────────── */

export interface RasterExportOption {
  format: "png";
  label: string;
  note: string;
}

export interface ExcludedRasterPart {
  name: string;
  /** Stated plainly: it is a picture, and pictures are not vectors. */
  reason: string;
}

const LOGO_RASTER_REASON =
  "logo image (raster) — a generated picture has no vector shapes to export, and it is never embedded in an SVG as a picture";

/* ── Brand sheet SVG (Branding Kit surface) ─────────────────────────── */

export interface BrandSheetSvgResult {
  /** The SVG document, or null when the kit holds no visible
   *  vector-expressible content — never an empty or raster-faked file. */
  svg: string | null;
  /** Why svg is null (null when an SVG was produced). */
  reason: string | null;
  /** Human labels of what the sheet carries, in sheet order. */
  included: string[];
  /** Count of true vector elements serialized (rects + texts). */
  vectorElementCount: number;
  /** Raster parts deliberately left out, named (the kit's logo). */
  excludedRaster: ExcludedRasterPart[];
  /** The raster exports that DO exist for the excluded parts. */
  rasterOptions: RasterExportOption[];
}

const SHEET_WIDTH = 1200;
const SHEET_MARGIN = 64;

/**
 * Serialize the creator's brand kit as a true-vector brand sheet:
 * brand name + tagline as editable text, one rect swatch per palette
 * color with its name/role/hex as text, and each font pairing named
 * with a sample set in that font. The kit's logo image is raster: it
 * is excluded and named, never embedded.
 */
export function buildBrandSheetSvg(kit: BrandKit): BrandSheetSvgResult {
  const excludedRaster: ExcludedRasterPart[] = [];
  const rasterOptions: RasterExportOption[] = [];
  if (kit.logoUrl) {
    excludedRaster.push({ name: "Your logo", reason: LOGO_RASTER_REASON });
    rasterOptions.push({
      format: "png",
      label: "Download logo (PNG)",
      note: "The logo itself is a picture — the PNG in your kit is its full-resolution raster export.",
    });
  }

  const brandName = kit.brandName.trim();
  const tagline = (kit.selectedTagline ?? kit.taglines[0] ?? "").trim();
  const colors = kit.colors
    .map((c) => ({ ...c, hex: safeHex(c.hex) }))
    .filter((c) => c.hex !== null && c.name.trim().length > 0) as Array<{
    hex: string;
    name: string;
    role: string;
  }>;
  const invalidColorCount = kit.colors.length - colors.length;
  const fonts = kit.fonts.filter((f) => f.heading.trim() || f.body.trim());
  const headingFont = fonts[0]?.heading.trim() || "Cinzel";
  const bodyFont = fonts[0]?.body.trim() || "Manrope";

  const included: string[] = [];
  if (brandName) included.push("brand name");
  if (tagline) included.push("tagline");
  if (colors.length) included.push(`palette (${colors.length} color${colors.length === 1 ? "" : "s"})`);
  if (fonts.length) included.push(`font pairings (${fonts.length})`);

  if (included.length === 0) {
    return {
      svg: null,
      reason:
        "This brand kit has nothing an SVG can honestly carry yet — no brand name, tagline, palette color or font pairing. Generate or fill in the kit first; the sheet builds itself from those words and colors. (A logo picture alone is raster — it exports as the PNG in your kit, never as a fake vector.)",
      included,
      vectorElementCount: 0,
      excludedRaster,
      rasterOptions,
    };
  }

  const background =
    safeHex(kit.colors.find((c) => c.role === "background")?.hex ?? "") ?? "#0B0B0B";
  const primary = safeHex(kit.colors.find((c) => c.role === "primary")?.hex ?? "") ?? "#C9A84C";
  const darkGround = background.toUpperCase() === "#0B0B0B" || background.toUpperCase() === "#000000";
  const onBackground = darkGround ? "#F5EFE0" : "#141414";
  const muted = darkGround ? "#A79E8A" : "#5A5344";

  const body: string[] = [];
  let elements = 0;
  let y = 0;
  const text = (x: number, ty: number, content: string, attrs: string): void => {
    body.push(`  <text x="${fmt(x)}" y="${fmt(ty)}" ${attrs} xml:space="preserve">${escText(content)}</text>`);
    elements += 1;
  };

  /* background (height patched in once the layout is known) */
  body.push(
    `  <rect data-part="background" x="0" y="0" width="${SHEET_WIDTH}" height="__HEIGHT__" fill="${escAttr(background)}"/>`,
  );
  elements += 1;
  y = SHEET_MARGIN;

  /* header — brand name + tagline as true text */
  if (brandName) {
    text(SHEET_MARGIN, y + 58, brandName, `font-family="${escAttr(headingFont)}, serif" font-size="64" font-weight="700" fill="${escAttr(primary)}"`);
    y += 84;
  }
  if (tagline) {
    text(SHEET_MARGIN, y + 30, tagline, `font-family="${escAttr(bodyFont)}, sans-serif" font-size="30" fill="${escAttr(onBackground)}"`);
    y += 52;
  }
  y += 28;

  /* palette — one true swatch rect per color */
  if (colors.length) {
    text(SHEET_MARGIN, y + 20, "PALETTE", `font-family="${escAttr(bodyFont)}, sans-serif" font-size="20" font-weight="700" letter-spacing="4" fill="${escAttr(muted)}"`);
    y += 40;
    const gap = 24;
    const swatchW = Math.min(300, (SHEET_WIDTH - SHEET_MARGIN * 2 - gap * (colors.length - 1)) / colors.length);
    colors.forEach((c, i) => {
      const x = SHEET_MARGIN + i * (swatchW + gap);
      body.push(
        `  <rect data-part="swatch" data-color-role="${escAttr(c.role)}" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(swatchW)}" height="120" rx="12" fill="${escAttr(c.hex)}"/>`,
      );
      elements += 1;
      text(x, y + 152, c.name, `font-family="${escAttr(bodyFont)}, sans-serif" font-size="22" font-weight="700" fill="${escAttr(onBackground)}"`);
      text(x, y + 180, `${c.role} · ${c.hex.toUpperCase()}`, `font-family="${escAttr(bodyFont)}, sans-serif" font-size="18" fill="${escAttr(muted)}"`);
    });
    y += 204;
  }

  /* font pairings — named, with samples set in the fonts themselves */
  if (fonts.length) {
    text(SHEET_MARGIN, y + 20, "FONTS", `font-family="${escAttr(bodyFont)}, sans-serif" font-size="20" font-weight="700" letter-spacing="4" fill="${escAttr(muted)}"`);
    y += 44;
    for (const f of fonts) {
      if (f.heading.trim()) {
        text(SHEET_MARGIN, y + 40, "Aa — Headings", `font-family="${escAttr(f.heading.trim())}, serif" font-size="40" font-weight="700" fill="${escAttr(onBackground)}"`);
        text(SHEET_MARGIN, y + 68, f.heading.trim(), `font-family="${escAttr(bodyFont)}, sans-serif" font-size="18" fill="${escAttr(muted)}"`);
        y += 84;
      }
      if (f.body.trim()) {
        text(SHEET_MARGIN, y + 30, "Aa — Body text for everyday words.", `font-family="${escAttr(f.body.trim())}, sans-serif" font-size="26" fill="${escAttr(onBackground)}"`);
        text(SHEET_MARGIN, y + 58, f.body.trim(), `font-family="${escAttr(bodyFont)}, sans-serif" font-size="18" fill="${escAttr(muted)}"`);
        y += 74;
      }
      if (f.usage.trim()) {
        text(SHEET_MARGIN, y + 22, f.usage.trim(), `font-family="${escAttr(bodyFont)}, sans-serif" font-size="18" font-style="italic" fill="${escAttr(muted)}"`);
        y += 34;
      }
      y += 10;
    }
  }

  const height = y + SHEET_MARGIN - 10;
  const excludedNote = excludedRaster.length
    ? ` The kit's logo is NOT in this file: ${LOGO_RASTER_REASON}. It exports as the PNG stored in the kit.`
    : " Every part of this sheet is a true vector (text and shapes).";
  const invalidNote = invalidColorCount > 0
    ? ` ${invalidColorCount} palette ${invalidColorCount === 1 ? "entry was" : "entries were"} left out because the hex value is not a valid #RRGGBB color.`
    : "";
  const desc = `True-vector brand sheet from Bow Down Visuals, generated from the brand kit's own words, colors and fonts.${excludedNote}${invalidNote}`;
  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!-- ${commentSafe(desc)} -->`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET_WIDTH}" height="${fmt(height)}" viewBox="0 0 ${SHEET_WIDTH} ${fmt(height)}" role="img">`,
    `  <desc>${escText(desc)}</desc>`,
    ...body.map((line) => line.replace("__HEIGHT__", fmt(height))),
    `</svg>`,
    ``,
  ].join("\n");

  return { svg, reason: null, included, vectorElementCount: elements, excludedRaster, rasterOptions };
}

/* ── Raster-only surfaces (Logo Studio, generated thumbnails) ───────── */

export interface RasterOnlyAssessment {
  /** Always false — that is the honest answer for a generated picture. */
  vectorAvailable: false;
  /** Why there is no SVG, stated plainly. */
  reason: string;
  /** The exports that DO exist for this design. */
  rasterOptions: RasterExportOption[];
}

/**
 * The export answer for a design that exists only as a generated
 * picture (an AI logo, an AI thumbnail). There are no vector shapes or
 * editable text inside a picture, so SVG is refused — honestly, with
 * the raster option named — instead of wrapping the picture in an SVG
 * shell and calling it a vector.
 */
export function assessRasterOnlyDesign(input: {
  /** What the picture is, for the message: "logo" | "thumbnail" | … */
  kindLabel: string;
}): RasterOnlyAssessment {
  return {
    vectorAvailable: false,
    reason: `This ${input.kindLabel} was generated as a single picture (pixels) — it has no vector shapes or editable text inside it, so there is nothing true to put in an SVG. Wrapping the picture in an SVG file would not make it a vector; it would be the same picture in a costume. For real vectors, build the design from text and shapes (the Photo desk's Editor tab, or your brand sheet from the Branding Kit).`,
    rasterOptions: [
      {
        format: "png",
        label: `Download ${input.kindLabel} (PNG)`,
        note: "The full-resolution picture, exactly as generated — the honest export for a raster design.",
      },
    ],
  };
}
