/* ─── Shop Design Starters — the storefront starter registry ──────────────
   Store / shop setup had NO design starters (Nov 2 org/design audit §2c):
   no starter templates, layouts, or storefront themes — the selling
   surface started naked while profile starters (9 templates + 7 themes
   in lib/artist-profiles.ts) proved the pattern one door away.

   THE HONEST LIMIT: the shop settings surface is much smaller than the
   profile system. A shop persists exactly TWO design settings through
   PATCH /api/shops/:id (routes/generate/shops.ts updateShopSchema):
     - banner_color — the storefront banner gradient's lead color
       (/shop/:handle renders `linear-gradient(135deg, banner_color, #000)`)
     - accent_color — prices, the cart badge, the add-to-cart gradient
       and the "Bow Down Visuals Shop" eyebrow on the live storefront
   There is NO shop layout, font, spacing, or theme-id setting, so no
   starter here invents one. Every starter is a curated banner+accent
   pairing (plus plain-language guidance on what it suits) that maps
   1:1 onto those two persisted fields — applying one writes exactly
   those fields through the existing PATCH rail, costs nothing (shop
   setup is free today and stays free), and visibly re-skins the live
   storefront.

   Banner colors stay DARK by design: the storefront banner is a
   dark-locked band with white ink (shop.tsx, data-dark-lock), so a
   light banner would bury the shop name. The tests pin a maximum
   banner luminance so no future starter breaks that.

   This module is the ONE registry for shop color starters: the
   storefront-builder wizard's branding step reads its presets from
   here too (it used to carry its own JSX-file copy of the first six). */

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
