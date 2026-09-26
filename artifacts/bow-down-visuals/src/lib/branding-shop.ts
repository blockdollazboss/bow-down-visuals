/* Branding shop catalog — keep in sync with the backend route's PRODUCTS.
   Pure data + helpers, safe to import in tests. */

<<<<<<< HEAD
export type ProductKey = "tshirt" | "hoodie" | "mug" | "cap" | "poster";
=======
export type ProductKey = "tshirt" | "hoodie" | "mug" | "snapback" | "poster" | "phonecase" | "tote";
>>>>>>> feature/branding-shop
export type BrandStyle = "luxury-gold" | "streetwear" | "minimal" | "bold";
export type ColorKey = "black" | "gold" | "white";

export interface CatalogProduct {
  key: ProductKey;
  label: string;
  priceCents: number;
  sizes: string[];
  blurb: string;
}

export const BRANDING_PRODUCTS: CatalogProduct[] = [
  { key: "tshirt", label: "Classic Tee", priceCents: 2499, sizes: ["S", "M", "L", "XL", "2XL"], blurb: "Heavyweight cotton, your logo front and center" },
  { key: "hoodie", label: "Luxury Hoodie", priceCents: 4999, sizes: ["S", "M", "L", "XL", "2XL"], blurb: "Premium fleece with embroidered-style branding" },
  { key: "mug", label: "Gold-Rim Mug", priceCents: 1699, sizes: ["11oz"], blurb: "Ceramic mug, gold rim, wraparound logo" },
<<<<<<< HEAD
  { key: "cap", label: "Snapback Cap", priceCents: 2799, sizes: ["One size"], blurb: "Structured snapback with 3D-puff style logo" },
  { key: "poster", label: "Art Poster", priceCents: 1999, sizes: ['12x18"', '18x24"'], blurb: "Gallery-grade print of your brand artwork" },
=======
  { key: "snapback", label: "Snapback Cap", priceCents: 2799, sizes: ["One size"], blurb: "Structured snapback with 3D-puff style logo" },
  { key: "poster", label: "Art Poster", priceCents: 1999, sizes: ['12x18"', '18x24"'], blurb: "Gallery-grade print of your brand artwork" },
  { key: "phonecase", label: "Phone Case", priceCents: 2299, sizes: ["iPhone", "Samsung"], blurb: "Tough protective case with your brand mark" },
  { key: "tote", label: "Canvas Tote", priceCents: 1899, sizes: ["One size"], blurb: "Heavy canvas tote, everyday brand billboard" },
>>>>>>> feature/branding-shop
];

export const BRANDING_COLORS: Array<{ key: ColorKey; label: string }> = [
  { key: "black", label: "Black" },
  { key: "gold", label: "Gold" },
  { key: "white", label: "White" },
];

export const BRANDING_STYLES: Array<{ key: BrandStyle; label: string; blurb: string }> = [
  { key: "luxury-gold", label: "Luxury Gold", blurb: "Black & gold, fashion-house energy" },
  { key: "streetwear", label: "Streetwear", blurb: "Bold type, urban edge" },
  { key: "minimal", label: "Minimal", blurb: "Clean, restrained, one mark" },
  { key: "bold", label: "Bold", blurb: "Loud, maximal, unmissable" },
];

export const BRANDING_DESIGN_COST = 2;
export const MAX_DESIGN_PRODUCTS = 3;

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function productByKey(key: ProductKey): CatalogProduct {
  const p = BRANDING_PRODUCTS.find((x) => x.key === key);
  if (!p) throw new Error(`Unknown branding product: ${key}`);
  return p;
}

export function cartTotal(
  items: Array<{ product: ProductKey; qty: number }>
): number {
  return items.reduce((n, i) => n + productByKey(i.product).priceCents * i.qty, 0);
}
