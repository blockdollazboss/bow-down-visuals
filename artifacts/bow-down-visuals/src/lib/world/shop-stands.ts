/**
 * shop-stands.ts — the pure logic behind the palace's three Shop
 * Stands (NATIVE-PLAN §3.3): the Marketplace (Courtyard), the
 * Branding Shop (Atelier) and Crowns & Memberships (Royal Court).
 *
 * The stands' law: browsing, comparing and the cart happen fully
 * in-world; payment is the ONE sanctioned transfer (§3.9) — at the
 * money moment only, the stand POSTs its checkout endpoint and, when
 * the server hands back a hosted payment URL, opens it in a NEW TAB
 * (the palace tab stays exactly where it was). The cart button is
 * labelled for that moment, uniformly: CHECKOUT_TRANSFER_LABEL.
 *
 * Prices are never invented here: Marketplace prices come off the
 * storefront payload, Branding prices off BRANDING_PRODUCTS
 * (lib/branding-shop.ts — the same catalog the website shop sells
 * from), and Crown prices off the tier DTO the server computed
 * (the same DTO amounts the memberships page displays).
 *
 * Everything in this module is pure (no fetch, no React) so the
 * stands' money math and payload shaping are unit-tested; the
 * components in components/world/native/ShopStands.tsx stay thin
 * shells that fetch and render.
 */
import {
  addToCartLines,
  setCartLineQty,
  cartItemCount,
  cartTotalCents,
  type CartLine,
} from "@/lib/shops";
import {
  BRANDING_PRODUCTS,
  productByKey,
  type BrandStyle,
  type ColorKey,
  type ProductKey,
} from "@/lib/branding-shop";

/** The one marked door out (§3.9): the exact label on every stand's
 *  checkout action. It names where the walker is going — payment
 *  finishes on the website's hosted checkout, in a new tab. */
export const CHECKOUT_TRANSFER_LABEL = "Continue to checkout on the website";

/** Quote-only goods are never carted (the site's rule, kept): the
 *  stand shows this instead of an Add button, exactly as the page
 *  does for the premium die-cut rug. */
export const CONTACT_FOR_QUOTE_LABEL = "Contact for quote";

/* ─── Marketplace (GET /api/storefronts, /slug/:slug) ────────────── */

export interface HubShopDto {
  id: string;
  name: string;
  handle: string;
  tagline: string | null;
  product_count: number;
}

export interface PublicShopDto {
  id: string;
  name: string;
  handle: string;
  tagline: string | null;
  description: string | null;
}

export interface PublicProductDto {
  id: string;
  name: string;
  price_cents: number;
  description: string | null;
  image_url: string | null;
}

export interface DetailedCartLine extends CartLine {
  product: PublicProductDto;
}

/** Cart lines joined to their products (the shop page's own
 *  derivation): lines whose product vanished, or whose qty hit
 *  zero, drop out of the detailed cart. */
export function detailedMarketCart(
  cart: CartLine[],
  products: PublicProductDto[],
): DetailedCartLine[] {
  return cart
    .map((l) => ({ ...l, product: products.find((p) => p.id === l.productId)! }))
    .filter((l) => l.product && l.qty > 0);
}

export function marketCartTotalCents(lines: DetailedCartLine[]): number {
  return cartTotalCents(
    lines,
    new Map(lines.map((l) => [l.productId, l.product.price_cents])),
  );
}

export function marketCartCount(lines: DetailedCartLine[]): number {
  return cartItemCount(lines);
}

export { addToCartLines, setCartLineQty };

/** One recorded Marketplace sale, as POST /api/storefronts/checkout
 *  answers it (201). NOTE the honest shape: this endpoint records
 *  the sale and breaks out the fee — it returns NO hosted payment
 *  URL today (card processing is the server's Stripe Connect
 *  follow-up). The stand shows the receipt in-world; if a future
 *  response carries a URL, `hostedCheckoutUrl` picks it up and the
 *  stand opens it in a new tab like the other two stands. */
export interface MarketSaleReceipt {
  gross_cents: number;
  platform_fee_cents: number;
  seller_net_cents: number;
  platform_fee_pct?: number;
}

/** Sum the per-line sale receipts into the one receipt the stand
 *  shows (the shop page totals its lines exactly the same way). */
export function sumMarketReceipts(
  receipts: Array<Partial<MarketSaleReceipt>>,
): MarketSaleReceipt {
  return receipts.reduce<MarketSaleReceipt>(
    (acc, r) => ({
      gross_cents: acc.gross_cents + (r.gross_cents ?? 0),
      platform_fee_cents: acc.platform_fee_cents + (r.platform_fee_cents ?? 0),
      seller_net_cents: acc.seller_net_cents + (r.seller_net_cents ?? 0),
      platform_fee_pct: r.platform_fee_pct ?? acc.platform_fee_pct,
    }),
    { gross_cents: 0, platform_fee_cents: 0, seller_net_cents: 0 },
  );
}

/* ─── The hosted-checkout seam (all three stands) ────────────────── */

/** The hosted payment URL a checkout response carries, wherever
 *  that API puts it: Branding answers `checkoutUrl`, Memberships
 *  answers `url`. Anything else (a demo/mock completion, a free
 *  tier, a recorded Marketplace sale) carries none — null, and the
 *  stand stays in-world with its receipt/note instead of opening
 *  a tab to nowhere. */
export function hostedCheckoutUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { checkoutUrl?: unknown; url?: unknown };
  for (const v of [p.checkoutUrl, p.url]) {
    if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
  }
  return null;
}

/** A checkout that completed with no payment page at all: a free
 *  membership tier (`free: true`) or Branding's clearly-labelled
 *  demo mode (`mock`/`demo: true`, no STRIPE key on the server). */
export function checkoutCompletedInWorld(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as { free?: unknown; mock?: unknown; demo?: unknown };
  return p.free === true || p.mock === true || p.demo === true;
}

/* ─── Branding Shop (BRANDING_PRODUCTS + /api/branding-shop/*) ───── */

export interface BrandingCartLine {
  product: ProductKey;
  color: ColorKey;
  size: string;
  qty: number;
  /** The customer's uploaded logo (rugs) — sent as designUrl. */
  logoUrl?: string;
}

export function isQuoteOnly(key: ProductKey): boolean {
  return BRANDING_PRODUCTS.find((p) => p.key === key)?.quoteOnly === true;
}

/** Add one configured line to the branding cart (the page's own
 *  rule): quote-only goods are NEVER carted, and identical
 *  product+color+size lines merge with qty capped at 99. */
export function addBrandingCartLine(
  cart: BrandingCartLine[],
  line: BrandingCartLine,
): BrandingCartLine[] {
  if (isQuoteOnly(line.product)) return cart;
  const idx = cart.findIndex(
    (i) => i.product === line.product && i.color === line.color && i.size === line.size,
  );
  if (idx >= 0) {
    const next = [...cart];
    next[idx] = { ...next[idx]!, qty: Math.min(99, next[idx]!.qty + line.qty) };
    return next;
  }
  return [...cart, { ...line, qty: Math.min(99, Math.max(1, line.qty)) }];
}

/** Set a cart line's qty by index; zero (or less) removes the line. */
export function setBrandingCartQty(
  cart: BrandingCartLine[],
  idx: number,
  qty: number,
): BrandingCartLine[] {
  if (idx < 0 || idx >= cart.length) return cart;
  const next = [...cart];
  if (qty <= 0) next.splice(idx, 1);
  else next[idx] = { ...next[idx]!, qty: Math.min(99, qty) };
  return next;
}

export function brandingCartTotalCents(cart: BrandingCartLine[]): number {
  return cart.reduce((n, i) => n + productByKey(i.product).priceCents * i.qty, 0);
}

export interface BrandingShipping {
  name: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
}

/** The order-intake payload for POST /api/branding-shop/orders —
 *  the page's exact shape (the rug's logo rides as designUrl; the
 *  server recomputes every total from the catalog regardless). */
export function brandingOrderPayload(
  cart: BrandingCartLine[],
  shipping: BrandingShipping,
): Record<string, unknown> {
  return {
    items: cart.map((item) => ({
      product: item.product,
      color: item.color,
      size: item.size,
      qty: item.qty,
      ...(item.logoUrl ? { designUrl: item.logoUrl } : {}),
    })),
    name: shipping.name.trim(),
    email: shipping.email.trim(),
    address: shipping.address.trim(),
    city: shipping.city.trim(),
    state: shipping.state.trim(),
    zip: shipping.zip.trim(),
  };
}

export function brandingShippingComplete(s: BrandingShipping): boolean {
  return [s.name, s.email, s.address, s.city, s.state, s.zip].every(
    (v) => v.trim().length > 0,
  );
}

export interface BrandingOrderDto {
  id: string;
  items: Array<BrandingCartLine & { unitPriceCents: number }>;
  totalCents: number;
  status: string;
  provider: string;
  providerOrderId: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  paid: boolean;
  createdAt: string;
}

/** Order status wording for the stand's rows — the plain-language
 *  version of the page's status chips; unknown statuses pass
 *  through humanized rather than vanishing. */
export function brandingOrderStatusLabel(status: string): string {
  const known: Record<string, string> = {
    received: "Received",
    pending_fulfillment: "Sent to fulfillment",
    in_production: "In production",
    shipped: "Shipped",
    delivered: "Delivered",
    canceled: "Canceled",
    cancelled: "Canceled",
    failed: "Needs attention",
  };
  return known[status] ?? status.replace(/_/g, " ");
}

export interface BrandingDesignResult {
  logo: { url: string };
  mockups: Array<{ product: ProductKey; url: string }>;
  brief: { tagline: string; palette: string[] };
  creditsUsed?: number;
  creditsRemaining?: number;
}

export interface BrandingDesignForm {
  brandName: string;
  niche: string;
  style: BrandStyle;
  products: ProductKey[];
}

export function brandingDesignComplete(form: BrandingDesignForm): boolean {
  return (
    form.brandName.trim().length > 0 &&
    form.niche.trim().length > 0 &&
    form.products.length > 0
  );
}

/* ─── Crowns & Memberships (GET /api/memberships/public/:id) ────── */

export interface MembershipTierDto {
  id: string;
  creatorUserId: string;
  name: string;
  /** Dollar amounts as NUMBERS — the server's centsToDollars is
   *  `cents / 100`, and the memberships page formats them with
   *  its fmt$ (whole dollars show no cents). */
  priceDollars: number;
  priceCents: number;
  description: string;
  perks: string[];
  isActive: boolean;
  trialEnabled: boolean;
  annualDiscountPct: number;
  annualPriceCents: number;
  annualPriceDollars: number;
  createdAt: string;
}

/** The memberships page's own money format: whole dollars show
 *  no cents, anything else shows two. */
export function membershipDollars(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: n % 1 === 0 ? 0 : 2,
  });
}

export type BillingPeriod = "monthly" | "annual";

/** Only active tiers are crown cards — an inactive tier never
 *  renders for anyone (the profile block's rule, kept). */
export function activeMembershipTiers(
  tiers: MembershipTierDto[],
): MembershipTierDto[] {
  return tiers.filter((t) => t.isActive);
}

/** The price the walker sees for a period — read straight off the
 *  server DTO, the same strings/numbers checkout charges from. */
export function tierPriceLabel(
  tier: MembershipTierDto,
  period: BillingPeriod,
): string {
  if (tier.priceCents <= 0) return "Free";
  return period === "annual"
    ? `${membershipDollars(tier.annualPriceDollars)} / year`
    : `${membershipDollars(tier.priceDollars)} / month`;
}

/** The annual saving line, only when a real annual offer exists. */
export function tierAnnualSavingLabel(tier: MembershipTierDto): string | null {
  if (tier.priceCents <= 0 || tier.annualDiscountPct <= 0) return null;
  return `Save ${tier.annualDiscountPct}% vs monthly`;
}

/** A trial can be offered only when the tier enables one AND the
 *  tier is paid (the server refuses trials on free tiers too). */
export function tierOffersTrial(tier: MembershipTierDto): boolean {
  return tier.trialEnabled === true && tier.priceCents > 0;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The creator id a fan-club join needs, taken from whatever the
 *  walker pastes: a bare user id, or their full join link
 *  (/memberships?creator=<id> — the link creators share). Anything
 *  else is null — the stand asks again instead of guessing, and the
 *  server re-validates the shape regardless. */
export function parseCreatorUserId(input: string): string | null {
  const raw = input.trim();
  if (UUID_RE.test(raw)) return raw;
  const q = raw.match(/[?&]creator=([^&\s]+)/);
  if (q) {
    try {
      const v = decodeURIComponent(q[1]!);
      if (UUID_RE.test(v)) return v;
    } catch {
      return null;
    }
  }
  return null;
}

export interface MyMembershipDto {
  id: string;
  tierName: string | null;
  status: string;
  priceDollars: number;
  billingPeriod: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  isGift: boolean;
}
