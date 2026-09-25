/* ─── Customer Shops shared helpers ─────────────────────────────────────────
   Pure functions used by /my-shop (builder) and /shop/:handle (storefront).
   Kept free of React so they stay unit-testable. Keep in sync with the
   backend's handle rules in artifacts/api-server/src/routes/generate/shops.ts. */

export interface CartLine {
  productId: string;
  qty: number;
}

/** Format integer cents as a display price, e.g. 1999 → "$19.99". */
export function centsToDisplay(cents: number): string {
  const safe = Math.max(0, Math.round(cents));
  return `$${(safe / 100).toFixed(2)}`;
}

/** Parse a user-typed dollar amount ("19.99", "$19.99") into integer cents.
 *  Returns null when the input is not a sane price. */
export function dollarsToCents(input: string): number | null {
  if (/-/.test(input)) return null; // explicit negative — reject, don't flip to positive
  const cleaned = input.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) return null;
  return Math.round(n * 100);
}

/** localStorage key for a shop's cart — namespaced per handle. */
export function cartKey(handle: string): string {
  return `bdv-cart-${handle.toLowerCase()}`;
}

/** Client-side mirror of the backend handle rules (the server is the
 *  source of truth — this is just for instant form feedback). */
const HANDLE_RE = /^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$/;
const RESERVED = new Set([
  "api", "admin", "login", "signup", "dashboard", "settings",
  "shop", "shops", "my-shop", "pricing", "hooks", "coach",
  "checkout", "cart", "support", "help", "about", "contact",
]);

export function isValidHandle(raw: string): boolean {
  const handle = raw.trim().toLowerCase();
  return HANDLE_RE.test(handle) && !RESERVED.has(handle);
}

export function addToCartLines(cart: CartLine[], productId: string): CartLine[] {
  const line = cart.find((l) => l.productId === productId);
  if (line) return cart.map((l) => (l.productId === productId ? { ...l, qty: l.qty + 1 } : l));
  return [...cart, { productId, qty: 1 }];
}

export function setCartLineQty(cart: CartLine[], productId: string, qty: number): CartLine[] {
  if (qty <= 0) return cart.filter((l) => l.productId !== productId);
  return cart.map((l) => (l.productId === productId ? { ...l, qty } : l));
}

export function cartItemCount(cart: CartLine[]): number {
  return cart.reduce((sum, l) => sum + Math.max(0, l.qty), 0);
}

export function cartTotalCents(cart: CartLine[], prices: Map<string, number>): number {
  return cart.reduce((sum, l) => sum + (prices.get(l.productId) ?? 0) * Math.max(0, l.qty), 0);
}
