/* Custom jewelry line — shared frontend constants. */

export interface JewelryProduct {
  key: string;
  label: string;
  priceCents: number;
  blurb: string;
  sizes: string[];
  swatch: string; // css gradient for the product card
  sizeLabel: string;
}

export const JEWELRY_PRODUCTS: JewelryProduct[] = [
  {
    key: "logo-pendant",
    label: "Custom Logo Pendant",
    priceCents: 0, // premium line: final price confirmed with buyer before production
    blurb: "Your logo or mark, cast in solid gold with real diamond accents — the signature piece",
    sizes: ['18" chain', '20" chain', '22" chain', '24" chain'],
    swatch: "linear-gradient(135deg,#d4af37 30%,#f5d76e 50%,#8a6d1c 100%)",
    sizeLabel: "Chain length",
  },
  {
    key: "cuban-chain",
    label: "Cuban Link Chain",
    priceCents: 0, // premium line: final price confirmed with buyer before production
    blurb: "Heavy solid-gold Cuban link with engraved clasp and diamond accents — pure weight",
    sizes: ['18"', '20"', '22"', '24"', '26"'],
    swatch: "linear-gradient(135deg,#b8860b 20%,#f5d76e 45%,#b8860b 70%,#7a5c14 100%)",
    sizeLabel: "Length",
  },
  {
    key: "signet-ring",
    label: "Engraved Signet Ring",
    priceCents: 0, // premium line: final price confirmed with buyer before production
    blurb: "Your initials or emblem, deep-engraved in solid gold",
    sizes: ["6", "7", "8", "9", "10", "11", "12", "13"],
    swatch: "radial-gradient(circle at 35% 35%,#f5d76e,#b8860b 60%,#5e460e 100%)",
    sizeLabel: "Ring size",
  },
  {
    key: "id-bracelet",
    label: "Engraved ID Bracelet",
    priceCents: 0, // premium line: final price confirmed with buyer before production
    blurb: "Classic ID plate in solid gold, engraved with your name or brand",
    sizes: ['S (7")', 'M (8")', 'L (9")'],
    swatch: "linear-gradient(135deg,#8a6d1c,#d4af37 40%,#f5d76e 55%,#8a6d1c 100%)",
    sizeLabel: "Size",
  },
];

export interface JewelryFinish {
  key: string;
  label: string;
  swatch: string;
}

export const JEWELRY_FINISHES: JewelryFinish[] = [
  { key: "gold-10k", label: "10K Solid Gold", swatch: "linear-gradient(135deg,#c9a227,#e8c96a)" },
  { key: "gold-14k", label: "14K Solid Gold", swatch: "linear-gradient(135deg,#d4af37,#f5d76e)" },
  { key: "gold-18k", label: "18K Solid Gold", swatch: "linear-gradient(135deg,#e8c34a,#f7e08b)" },
];

export function jewelryProductByKey(key: string): JewelryProduct | undefined {
  return JEWELRY_PRODUCTS.find((p) => p.key === key);
}

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/* Premium line: prices are TBD from supplier quotes, so a zero priceCents
   renders as "Pricing soon" instead of a dollar amount anywhere. */
export function formatJewelryPrice(cents: number): string {
  return cents > 0 ? formatMoney(cents) : "Pricing soon";
}
