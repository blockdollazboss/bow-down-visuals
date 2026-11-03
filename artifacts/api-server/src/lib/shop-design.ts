/* Shop layout + font settings (migration 0320, store-starters lane).
 *
 * A shop's design used to be exactly two persisted settings —
 * banner_color and accent_color — while its layout was hardcoded in
 * the storefront page and its typography was whatever the site shell
 * inherited. Migration 0320 gives layout and font the same home the
 * colors have: plain columns on the shops row, written through the
 * same PATCH /api/shops/:id rail, read back on the same owner and
 * public payloads.
 *
 * The vocabulary is small and closed (mirrored FE-side in
 * artifacts/bow-down-visuals/src/lib/shop-design.ts — the pins in the
 * shop-look starter tests keep the two lists identical):
 *   layout_style: 'showcase' | 'gallery' | 'list'
 *   font_style:   'house' | 'royal' | 'classic'
 * The defaults ARE the pre-0320 rendering — 'showcase' is the banner
 * band + three-across card grid the storefront has always rendered,
 * 'house' is the inherited Manrope-everywhere look — so a shop that
 * never touches these settings renders exactly as it did before the
 * columns existed.
 *
 * Read honesty: every surface presents the SANITIZED pair — a stored
 * value outside the vocabulary (written out-of-band, or pre-dating a
 * rename) presents as the default, never as a bent value the
 * storefront would have to guess at. Writes are stricter: the PATCH
 * rail validates with a zod enum and refuses anything outside the
 * vocabulary before any mutation.
 */

export const SHOP_LAYOUT_STYLES = ["showcase", "gallery", "list"] as const;
export const SHOP_FONT_STYLES = ["house", "royal", "classic"] as const;

export type ShopLayoutStyle = (typeof SHOP_LAYOUT_STYLES)[number];
export type ShopFontStyle = (typeof SHOP_FONT_STYLES)[number];

export const DEFAULT_SHOP_LAYOUT_STYLE: ShopLayoutStyle = "showcase";
export const DEFAULT_SHOP_FONT_STYLE: ShopFontStyle = "house";

export interface ShopDesign {
  layout_style: ShopLayoutStyle;
  font_style: ShopFontStyle;
}

/** The design a shop with no (or not-yet-migrated) settings renders:
 *  today's exact look. */
export const DEFAULT_SHOP_DESIGN: ShopDesign = {
  layout_style: DEFAULT_SHOP_LAYOUT_STYLE,
  font_style: DEFAULT_SHOP_FONT_STYLE,
};

export function sanitizeShopLayoutStyle(raw: unknown): ShopLayoutStyle {
  return (SHOP_LAYOUT_STYLES as readonly string[]).includes(raw as string)
    ? (raw as ShopLayoutStyle)
    : DEFAULT_SHOP_LAYOUT_STYLE;
}

export function sanitizeShopFontStyle(raw: unknown): ShopFontStyle {
  return (SHOP_FONT_STYLES as readonly string[]).includes(raw as string)
    ? (raw as ShopFontStyle)
    : DEFAULT_SHOP_FONT_STYLE;
}

/** The presented design pair for any shop-shaped row — owner and
 *  public payloads alike. Absent keys (pre-migration selects) and bent
 *  stored values both present as the defaults. */
export function sanitizeShopDesign(row: {
  layout_style?: unknown;
  font_style?: unknown;
} | null | undefined): ShopDesign {
  return {
    layout_style: sanitizeShopLayoutStyle(row?.layout_style),
    font_style: sanitizeShopFontStyle(row?.font_style),
  };
}
