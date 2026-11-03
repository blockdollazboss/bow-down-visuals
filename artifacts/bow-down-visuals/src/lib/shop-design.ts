/* ─── Shop layout + font design — the storefront's design vocabulary ────
   Migration 0320 gave shops the two design settings the color
   starters never had a column for: layout_style and font_style,
   persisted on the shops row and written through the same
   PATCH /api/shops/:id rail as banner_color / accent_color
   (api-server lib/shop-design.ts carries the server's copy of this
   vocabulary; the shop-look starter tests pin the two lists equal).

   THE DEFAULTS ARE TODAY'S STOREFRONT:
     - layout 'showcase' — the banner band + three-across card grid
       shop.tsx has always rendered. Its spec below carries the
       page's exact current class strings, and the page keeps its
       literal card/body/title markup for it, so an untouched shop
       renders byte-for-byte as before.
     - font 'house' — no overrides at all: the storefront inherits
       the site shell's type (Manrope), exactly as it does today.
   Any value outside the vocabulary (an old payload, a bent stored
   row) normalizes to the default — a storefront never guesses. */

export const SHOP_LAYOUT_IDS = ["showcase", "gallery", "list"] as const;
export type ShopLayoutId = (typeof SHOP_LAYOUT_IDS)[number];

export const SHOP_FONT_IDS = ["house", "royal", "classic"] as const;
export type ShopFontId = (typeof SHOP_FONT_IDS)[number];

export const DEFAULT_SHOP_LAYOUT_ID: ShopLayoutId = "showcase";
export const DEFAULT_SHOP_FONT_ID: ShopFontId = "house";

export function normalizeShopLayoutId(raw: unknown): ShopLayoutId {
  return (SHOP_LAYOUT_IDS as readonly string[]).includes(raw as string)
    ? (raw as ShopLayoutId)
    : DEFAULT_SHOP_LAYOUT_ID;
}

export function normalizeShopFontId(raw: unknown): ShopFontId {
  return (SHOP_FONT_IDS as readonly string[]).includes(raw as string)
    ? (raw as ShopFontId)
    : DEFAULT_SHOP_FONT_ID;
}

export interface ShopLayoutSpec {
  id: ShopLayoutId;
  name: string;
  blurb: string;
  /** Product-section container (width + padding) on the storefront. */
  contentClass: string;
  /** The container wrapping the product cards. */
  gridClass: string;
  /** Product photo sizing inside a card. */
  imageClass: string;
  /** The no-photo placeholder block, sized to match the photo. */
  placeholderClass: string;
}

export const SHOP_LAYOUT_SPECS: ShopLayoutSpec[] = [
  {
    id: "showcase",
    name: "Showcase",
    blurb: "The classic storefront: banner up top, products three across with big art.",
    /* These four strings are the storefront's pre-0320 classes,
       verbatim — the default spec must never drift from them. */
    contentClass: "max-w-6xl mx-auto px-5 md:px-8 py-10 md:py-14",
    gridClass: "grid gap-5 sm:grid-cols-2 lg:grid-cols-3",
    imageClass: "h-56 w-full shrink-0 object-cover group-hover:scale-[1.02] transition",
    placeholderClass:
      "h-56 w-full shrink-0 bg-gradient-to-br from-white/[0.06] to-transparent flex items-center justify-center",
  },
  {
    id: "gallery",
    name: "Gallery",
    blurb: "A dense gallery wall: four across, shorter art, more of the catalog in every glance.",
    contentClass: "max-w-7xl mx-auto px-5 md:px-8 py-10 md:py-14",
    gridClass: "grid gap-4 sm:grid-cols-2 lg:grid-cols-4",
    imageClass: "h-44 w-full shrink-0 object-cover group-hover:scale-[1.02] transition",
    placeholderClass:
      "h-44 w-full shrink-0 bg-gradient-to-br from-white/[0.06] to-transparent flex items-center justify-center",
  },
  {
    id: "list",
    name: "List",
    blurb: "One product per line, full width, with its story under the title — built for short, considered catalogs.",
    contentClass: "max-w-4xl mx-auto px-5 md:px-8 py-10 md:py-14",
    gridClass: "grid gap-5 grid-cols-1",
    imageClass: "h-64 w-full shrink-0 object-cover group-hover:scale-[1.02] transition",
    placeholderClass:
      "h-64 w-full shrink-0 bg-gradient-to-br from-white/[0.06] to-transparent flex items-center justify-center",
  },
];

export function shopLayoutSpec(id: ShopLayoutId): ShopLayoutSpec {
  return SHOP_LAYOUT_SPECS.find((s) => s.id === id) ?? SHOP_LAYOUT_SPECS[0]!;
}

export interface ShopFontSpec {
  id: ShopFontId;
  name: string;
  blurb: string;
  /** Extra class for display text (the shop name, product titles).
   *  'font-display' resolves to the site's Cinzel display face (the
   *  --font-display theme variable). Empty = inherit, today's look. */
  displayClass: string;
  /** Body font-family for the whole storefront when the pairing
   *  changes the reading voice; absent = inherit the site shell. */
  bodyFontFamily?: string;
}

export const SHOP_FONT_SPECS: ShopFontSpec[] = [
  {
    id: "house",
    name: "House",
    blurb: "Manrope throughout — the clean, modern platform voice.",
    displayClass: "",
  },
  {
    id: "royal",
    name: "Royal",
    blurb: "Cinzel headlines over a Manrope read — the throne-room voice.",
    displayClass: "font-display",
  },
  {
    id: "classic",
    name: "Classic",
    blurb: "Cinzel headlines with a Georgia serif read — bookish and warm.",
    displayClass: "font-display",
    bodyFontFamily: "Georgia, 'Times New Roman', serif",
  },
];

export function shopFontSpec(id: ShopFontId): ShopFontSpec {
  return SHOP_FONT_SPECS.find((s) => s.id === id) ?? SHOP_FONT_SPECS[0]!;
}
