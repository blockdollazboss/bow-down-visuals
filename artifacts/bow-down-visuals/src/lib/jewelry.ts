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
    priceCents: 8900,
    blurb: "Your logo or mark, cast in metal — the signature piece",
    sizes: ['18" chain', '20" chain', '22" chain', '24" chain'],
    swatch: "linear-gradient(135deg,#d4af37 30%,#f5d76e 50%,#8a6d1c 100%)",
    sizeLabel: "Chain length",
  },
  {
    key: "cuban-chain",
    label: "Cuban Link Chain",
    priceCents: 12900,
    blurb: "Heavy Cuban link with engraved clasp — pure weight",
    sizes: ['18"', '20"', '22"', '24"', '26"'],
    swatch: "linear-gradient(135deg,#b8860b 20%,#f5d76e 45%,#b8860b 70%,#7a5c14 100%)",
    sizeLabel: "Length",
  },
  {
    key: "signet-ring",
    label: "Engraved Signet Ring",
    priceCents: 7900,
    blurb: "Your initials or emblem, deep-engraved",
    sizes: ["6", "7", "8", "9", "10", "11", "12", "13"],
    swatch: "radial-gradient(circle at 35% 35%,#f5d76e,#b8860b 60%,#5e460e 100%)",
    sizeLabel: "Ring size",
  },
  {
    key: "id-bracelet",
    label: "Engraved ID Bracelet",
    priceCents: 6900,
    blurb: "Classic ID plate, engraved with your name or brand",
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
  { key: "gold", label: "18K Gold Plated", swatch: "linear-gradient(135deg,#d4af37,#f5d76e)" },
  { key: "silver", label: "Sterling Silver", swatch: "linear-gradient(135deg,#c0c0c0,#f0f0f0)" },
  { key: "black", label: "Black Rhodium", swatch: "linear-gradient(135deg,#1a1a1a,#3a3a3a)" },
];

export function jewelryProductByKey(key: string): JewelryProduct | undefined {
  return JEWELRY_PRODUCTS.find((p) => p.key === key);
}

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
