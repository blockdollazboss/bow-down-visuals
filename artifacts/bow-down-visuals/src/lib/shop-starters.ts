/* ─── Shop Design Starters — the storefront starter registry ──────────────
   Store / shop setup had NO design starters (Nov 2 org/design audit §2c):
   no starter templates, layouts, or storefront themes — the selling
   surface started naked while profile starters (9 templates + 7 themes
   in lib/artist-profiles.ts) proved the pattern one door away.

   THE HONEST LIMIT (wave #3): the shop settings surface was much
   smaller than the profile system. A shop persisted exactly TWO
   design settings through PATCH /api/shops/:id
   (routes/generate/shops.ts updateShopSchema):
     - banner_color — the storefront banner gradient's lead color
       (/shop/:handle renders `linear-gradient(135deg, banner_color, #000)`)
     - accent_color — prices, the cart badge, the add-to-cart gradient
       and the "Bow Down Visuals Shop" eyebrow on the live storefront
   There was NO shop layout or font setting, so no wave-#3 starter
   invented one. Every color starter below is a curated banner+accent
   pairing (plus plain-language guidance on what it suits) that maps
   1:1 onto those two persisted fields — applying one writes exactly
   those fields through the existing PATCH rail, costs nothing (shop
   setup is free today and stays free), and visibly re-skins the live
   storefront.

   UPDATE (migration 0320, store-starters lane): layout and font are
   persisted settings now — shops.layout_style + shops.font_style,
   written through the same PATCH rail. The LOOK starters at the
   bottom of this module are their registry: curated layout+font
   pairings (lib/shop-design.ts carries the layout/font vocabulary).
   The two starter families stay separate axes on purpose — a color
   starter never touches layout/font, a look starter never touches
   colors — so a seller can mix them freely.

   Banner colors stay DARK by design: the storefront banner is a
   dark-locked band with white ink (shop.tsx, data-dark-lock), so a
   light banner would bury the shop name. The tests pin a maximum
   banner luminance so no future starter breaks that.

   This module is the ONE registry for shop starters — color
   starters here, look starters at the bottom: the storefront-builder
   wizard's branding step reads its color presets from here too (it
   used to carry its own JSX-file copy of the first six). */

import {
  normalizeShopFontId,
  normalizeShopLayoutId,
  type ShopFontId,
  type ShopLayoutId,
} from "./shop-design";

export interface ShopStarterSettings {
  /** Persisted shop column: shops.banner_color (hex #rrggbb). */
  banner_color: string;
  /** Persisted shop column: shops.accent_color (hex #rrggbb). */
  accent_color: string;
}

export interface ShopDesignStarter {
  id: string;
  name: string;
  blurb: string;
  /** Who the pairing is tuned for — shown on the starter card. */
  bestFor: string;
  settings: ShopStarterSettings;
}

/** The server's hex rule (generate/shops.ts HEX_COLOR) — every starter
 *  color must satisfy it or the PATCH rail refuses the save. */
export const SHOP_HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export const SHOP_DESIGN_STARTERS: ShopDesignStarter[] = [
  {
    id: "gold-noir",
    name: "Gold Noir",
    blurb: "The house look. Black banner, classic gold — the platform default pairing.",
    bestFor: "Any shop — the safe, premium starting point.",
    settings: { banner_color: "#0a0a0a", accent_color: "#d4af37" },
  },
  {
    id: "royal-purple",
    name: "Royal Purple",
    blurb: "Deep violet banner with a bright royal accent — regal and unmistakable.",
    bestFor: "Beauty, fashion, and luxury goods.",
    settings: { banner_color: "#150a24", accent_color: "#a855f7" },
  },
  {
    id: "crimson",
    name: "Crimson Stage",
    blurb: "Near-black red banner, stage-light red accent. Pure headline energy.",
    bestFor: "Music drops, tickets, and limited releases.",
    settings: { banner_color: "#1c0a0a", accent_color: "#ef4444" },
  },
  {
    id: "ocean",
    name: "Ocean Deep",
    blurb: "Midnight-blue banner with a clear sky accent — calm, clean, trustworthy.",
    bestFor: "Digital products, courses, and services.",
    settings: { banner_color: "#08131c", accent_color: "#38bdf8" },
  },
  {
    id: "emerald",
    name: "Emerald Vault",
    blurb: "Dark green banner, jewel-green accent — money-green without the cliché.",
    bestFor: "Fitness, wellness, and fresh brands.",
    settings: { banner_color: "#071410", accent_color: "#34d399" },
  },
  {
    id: "rose",
    name: "Rose After Dark",
    blurb: "Plum-black banner with a soft rose accent — warm, intimate, boutique.",
    bestFor: "Boutique, handmade, and gift shops.",
    settings: { banner_color: "#190b12", accent_color: "#fb7185" },
  },
  {
    id: "sunset",
    name: "Sunset Drop",
    blurb: "Burnt-ember banner with a hot orange accent — built to stop the scroll.",
    bestFor: "Streetwear, sneakers, and drop-day launches.",
    settings: { banner_color: "#180a02", accent_color: "#fb923c" },
  },
  {
    id: "chrome",
    name: "Chrome Silver",
    blurb: "Graphite banner, polished silver accent — minimal, modern, all product.",
    bestFor: "Tech, gear, and minimal catalogs.",
    settings: { banner_color: "#0c0c0e", accent_color: "#d6d3d1" },
  },
  {
    id: "porcelain-light",
    name: "Porcelain Light",
    blurb: "The shelf's light look: porcelain ivory with gold trim over a warm ceramic glaze — the banner band itself stays deep, as every starter's does, so the white shop name rides it readable.",
    bestFor: "Skincare, home goods, stationery, and bright boutique brands.",
    settings: { banner_color: "#3a2e22", accent_color: "#efe3c2" },
  },
];

export function shopStarterById(id: string): ShopDesignStarter | undefined {
  return SHOP_DESIGN_STARTERS.find((s) => s.id === id);
}

/** The exact PATCH /api/shops/:id body a starter applies — ONLY the two
 *  persisted design fields, nothing else. The shop rail COALESCE-keeps
 *  every other field, so applying a starter can never clobber the
 *  shop's name, tagline, or description. */
export function shopStarterPatch(starter: ShopDesignStarter): ShopStarterSettings {
  return {
    banner_color: starter.settings.banner_color,
    accent_color: starter.settings.accent_color,
  };
}

/** True when a shop's current colors are exactly this starter's — the
 *  starter shelf marks that card "Applied" instead of offering a
 *  no-op re-apply. Case-insensitive: the color inputs hand back
 *  lowercase, stored rows may not be. */
export function isStarterApplied(
  shop: { banner_color: string; accent_color: string },
  starter: ShopDesignStarter,
): boolean {
  return (
    shop.banner_color.toLowerCase() === starter.settings.banner_color.toLowerCase() &&
    shop.accent_color.toLowerCase() === starter.settings.accent_color.toLowerCase()
  );
}

/* ─── Look starters — layout + font pairings (migration 0320) ─────────────
   The second starter family: each look sets shops.layout_style +
   shops.font_style through the same PATCH rail, in the same My Shop
   shelf, free like everything in shop setup. The pairing names are
   our vocabulary for a layout (lib/shop-design SHOP_LAYOUT_SPECS) in
   a font voice (SHOP_FONT_SPECS) — no layout or font outside that
   vocabulary can be named here, because the rail refuses it. */

export interface ShopLookSettings {
  /** Persisted shop column: shops.layout_style (migration 0320). */
  layout_style: ShopLayoutId;
  /** Persisted shop column: shops.font_style (migration 0320). */
  font_style: ShopFontId;
}

export interface ShopLookStarter {
  id: string;
  name: string;
  blurb: string;
  /** Who the pairing is tuned for — shown on the starter card. */
  bestFor: string;
  settings: ShopLookSettings;
}

export const SHOP_LOOK_STARTERS: ShopLookStarter[] = [
  {
    id: "house-classic",
    name: "House Classic",
    blurb: "The storefront exactly as it has always looked — Showcase layout, House type.",
    bestFor: "Any shop — the untouched starting point.",
    settings: { layout_style: "showcase", font_style: "house" },
  },
  {
    id: "royal-showcase",
    name: "Royal Showcase",
    blurb: "The classic layout with ceremonial serif headlines — the throne-room voice over the standard shelf.",
    bestFor: "Flagship drops and luxury goods.",
    settings: { layout_style: "showcase", font_style: "royal" },
  },
  {
    id: "gallery-wall",
    name: "Gallery Wall",
    blurb: "Four across with shorter art — a packed wall buyers can scan fast.",
    bestFor: "Big catalogs, merch runs, and sample packs.",
    settings: { layout_style: "gallery", font_style: "house" },
  },
  {
    id: "royal-gallery",
    name: "Royal Gallery",
    blurb: "The dense wall, dressed royal: serif titles over a four-across grid.",
    bestFor: "Art prints, photography, and visual work.",
    settings: { layout_style: "gallery", font_style: "royal" },
  },
  {
    id: "editorial-list",
    name: "The Editorial",
    blurb: "One product per line with its story showing, set in a warm serif read.",
    bestFor: "Books, courses, and services that sell on the story.",
    settings: { layout_style: "list", font_style: "classic" },
  },
  {
    id: "royal-list",
    name: "The Royal List",
    blurb: "Full-width rows with ceremonial serif headlines — a short catalog that reads like a program.",
    bestFor: "Limited runs, commissions, and short menus.",
    settings: { layout_style: "list", font_style: "royal" },
  },
];

export function shopLookStarterById(id: string): ShopLookStarter | undefined {
  return SHOP_LOOK_STARTERS.find((s) => s.id === id);
}

/** The exact PATCH /api/shops/:id body a look starter applies — ONLY
 *  the two persisted design fields, nothing else. The rail
 *  COALESCE/resolve-keeps every other field (colors included), so
 *  applying a look can never restyle a shop's colors or copy. */
export function shopLookPatch(starter: ShopLookStarter): ShopLookSettings {
  return {
    layout_style: starter.settings.layout_style,
    font_style: starter.settings.font_style,
  };
}

/** True when a shop's current design is exactly this look's — the
 *  shelf marks that card "Applied". Both sides normalize first, so a
 *  shop whose settings are absent (an old payload) reads as the
 *  defaults and matches the House Classic look. */
export function isLookStarterApplied(
  shop: { layout_style?: string | null; font_style?: string | null },
  starter: ShopLookStarter,
): boolean {
  return (
    normalizeShopLayoutId(shop.layout_style) === starter.settings.layout_style &&
    normalizeShopFontId(shop.font_style) === starter.settings.font_style
  );
}
