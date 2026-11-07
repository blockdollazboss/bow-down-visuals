/* ─── Customer Shops shared helpers ─────────────────────────────────────────
   Pure functions used by /my-shop (builder) and /shop/:handle (storefront).
   Kept free of React so they stay unit-testable. Keep in sync with the
   backend's handle rules in artifacts/api-server/src/routes/generate/shops.ts. */

export interface CartLine {
  productId: string;
  qty: number;
}

/** Platform fee on shop / storefront / digital-store sales, in basis
 *  points (MIRROR — must match the server's STOREFRONT_PLATFORM_FEE_BPS
 *  in artifacts/api-server/src/routes/generate/shops.ts; routes/store.ts
 *  reuses the same knob). Flat 5% on every tier — owner ruling
 *  2026-10-18, reaffirmed 2026-10-23. The server env-overrides its knob;
 *  displays here state the ruled default the rails charge out of the
 *  box, and surfaces that receive the server's own platformFeePct
 *  render that value instead. */
export const STOREFRONT_PLATFORM_FEE_BPS = 500;

/** The same fee as a whole percent (5). */
export const STOREFRONT_PLATFORM_FEE_PCT = STOREFRONT_PLATFORM_FEE_BPS / 100;

/** Platform fee in cents for a gross amount, the rail's own rounding
 *  (round half up on the gross). */
export function storefrontFeeCents(grossCents: number): number {
  const gross = Math.max(0, Math.round(grossCents));
  return Math.round((gross * STOREFRONT_PLATFORM_FEE_BPS) / 10_000);
}

/** Format integer cents as a display price, e.g. 1999 → "$19.99".
 *  With a locale (Stack 200 Lane E1, item E-3) the amount formats
 *  through Intl's USD currency formatter for that locale — grouping
 *  and symbol placement follow the reader's language. Without one
 *  the legacy literal format rides byte-identical, as the pins
 *  hold it; callers in a localized surface pass i18n.language. */
export function centsToDisplay(cents: number, locale?: string): string {
  const safe = Math.max(0, Math.round(cents));
  if (locale) {
    return new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(safe / 100);
  }
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

/** The server's refusal, word for word (generate/shops.ts handleError):
 *  the create form used to submit 2-char, trailing-hyphen, and reserved
 *  handles blind and let the server be the first to state the rule. */
export function shopHandleError(raw: string): string | null {
  const handle = raw.trim().toLowerCase();
  if (!HANDLE_RE.test(handle)) {
    return "Handle must be 3–30 characters: lowercase letters, numbers, and hyphens only (no leading/trailing hyphen).";
  }
  if (RESERVED.has(handle)) {
    return "That handle is reserved — pick another one.";
  }
  return null;
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
