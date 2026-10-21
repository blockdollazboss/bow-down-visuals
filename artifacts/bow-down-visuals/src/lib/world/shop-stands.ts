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
  dollarsToCents,
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

/** One Marketplace order line/total, as POST /api/storefronts/checkout
 *  answers it (201) since the real card checkout (0144): the order is
 *  recorded PENDING first and the response carries the hosted payment
 *  URL (`url` / `checkoutUrl`, read via `hostedCheckoutUrl`) — the sale
 *  only exists once the payment confirms. A free cart answers
 *  `free: true` + status "paid" instead: no card was needed. */
export interface MarketSaleReceipt {
  gross_cents: number;
  platform_fee_cents: number;
  seller_net_cents: number;
  platform_fee_pct?: number;
}

/** One line of a confirmed Marketplace order — the reward moment's
 *  raw material: the acquired item, named from server truth. */
export interface MarketOrderLine {
  saleId: string;
  productId: string | null;
  productName: string | null;
  quantity: number;
  gross_cents: number;
  platform_fee_cents: number;
  seller_net_cents: number;
}

/** An order's truth, as POST /api/storefronts/checkout/verify and
 *  GET /api/storefronts/checkout/status report it. Only "paid" may
 *  ever render as paid — pending and expired stay labelled as what
 *  they are, and anything unrecognized reads as pending, never paid. */
export type MarketOrderStatus = "paid" | "pending_payment" | "expired";

export interface MarketOrder {
  status: MarketOrderStatus;
  paid: boolean;
  gross_cents: number;
  platform_fee_cents: number;
  seller_net_cents: number;
  lines: MarketOrderLine[];
}

export function marketOrderFromPayload(payload: unknown): MarketOrder | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const raw = (typeof p["status"] === "string" ? p["status"] : null) ??
    (p["paid"] === true ? "paid" : null);
  const status: MarketOrderStatus = raw === "paid" ? "paid" : raw === "expired" ? "expired" : "pending_payment";
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const linesRaw = Array.isArray(p["lines"]) ? (p["lines"] as Array<Record<string, unknown>>) : [];
  return {
    status,
    /* Paid is a server claim, not a shape guess: status AND flag agree. */
    paid: status === "paid" && p["paid"] === true,
    gross_cents: num(p["gross_cents"]),
    platform_fee_cents: num(p["platform_fee_cents"]),
    seller_net_cents: num(p["seller_net_cents"]),
    lines: linesRaw.map((l) => ({
      saleId: String(l["saleId"] ?? ""),
      productId: typeof l["productId"] === "string" ? l["productId"] : null,
      productName: typeof l["productName"] === "string" ? l["productName"] : null,
      quantity: num(l["quantity"]) || 1,
      gross_cents: num(l["gross_cents"]),
      platform_fee_cents: num(l["platform_fee_cents"]),
      seller_net_cents: num(l["seller_net_cents"]),
    })),
  };
}

/** The localStorage key holding a shop's unfinished checkout session
 *  at the stand, so returning/reopening refreshes ITS status from the
 *  server instead of forgetting the order (or pretending it paid). */
export function marketPendingKey(handle: string): string {
  return `bdv-market-pending-${handle}`;
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

/* ─── Stand management — the owner's side of the Marketplace ──────
   The same rails the website's My Shop page manages with, ridden
   from the stand itself (Stack-4 #7 — the parity follow-on Stack-3
   #25 named): GET /api/shops/mine proves ownership, and product
   create/edit/delete ride POST/PATCH/DELETE
   /api/shops/:id/products[/:productId] with the page's exact
   payloads. The public stand DTO never carries the owner's user_id
   (the storefront read strips it by design), so ownership is proven
   the only honest way available: the open shop's id appears in the
   caller's OWN /api/shops/mine list — a server read scoped to the
   caller. Unproven ownership (guest, non-owner, or the mine read
   itself failed) means NO management surface at all: the gate fails
   closed, and the buyer view is untouched either way. */

/** One of MY shops, as GET /api/shops/mine returns it — the owner-
 *  scoped read that proves a stand is the walker's own. Only the
 *  fields the stand uses are kept; the endpoint's fuller row is
 *  tolerated, never required. */
export interface MineShopDto {
  id: string;
  name: string;
  handle: string;
  tagline: string | null;
  description: string | null;
  product_count: number;
}

/** Parse the /api/shops/mine payload tolerantly: rows without a
 *  real id/name/handle are dropped, never repaired into existence.
 *  Tagline/description ride along when the row carries them (the
 *  settings form's prefill); a row without them still proves
 *  ownership — the settings fields just start from the public
 *  stand DTO instead. */
export function parseMineShops(payload: unknown): MineShopDto[] {
  if (!payload || typeof payload !== "object") return [];
  const rows = (payload as { shops?: unknown }).shops;
  if (!Array.isArray(rows)) return [];
  const out: MineShopDto[] = [];
  for (const r of rows as Array<Record<string, unknown>>) {
    if (!r || typeof r !== "object") continue;
    if (typeof r["id"] !== "string" || typeof r["name"] !== "string" || typeof r["handle"] !== "string") continue;
    out.push({
      id: r["id"],
      name: r["name"],
      handle: r["handle"],
      tagline: typeof r["tagline"] === "string" ? r["tagline"] : null,
      description: typeof r["description"] === "string" ? r["description"] : null,
      product_count: typeof r["product_count"] === "number" && Number.isFinite(r["product_count"]) ? r["product_count"] : 0,
    });
  }
  return out;
}

/** The ownership gate for stand management: true ONLY when the
 *  mine read actually landed AND the open shop is in it. A null
 *  mine (not loaded, or its load failed) is never ownership. */
export function isOwnStand(mine: MineShopDto[] | null, shopId: string | null | undefined): boolean {
  if (!mine || !shopId) return false;
  return mine.some((s) => s.id === shopId);
}

/* The stand AI helpers' prices, in Visual Bucs — read off the
   server's own constants (routes/generate/shops.ts:
   SHOP_AI_CREDIT_COST = 100, SHOP_IMAGE_STANDARD_CREDITS = 100,
   SHOP_IMAGE_PREMIUM_CREDITS = 200) and the shared credit-cost
   registry (lib/credit-costs.ts registers both description
   endpoints and the image endpoint at 100). The server constants
   are env-overridable; these mirror the shipped defaults exactly,
   and every run shows its price before it fires. */
export const SHOP_AI_DESCRIPTION_COST_VB = 100;
export const SHOP_AI_IMAGE_STANDARD_COST_VB = 100;
export const SHOP_AI_IMAGE_PREMIUM_COST_VB = 200;

/** The product form's state — the My Shop page's own fields, with
 *  the price kept as the typed dollars string until save time. */
export interface ProductFormState {
  name: string;
  price: string;
  description: string;
  imageUrl: string;
  styleHint: string;
}

export function emptyProductForm(): ProductFormState {
  return { name: "", price: "", description: "", imageUrl: "", styleHint: "" };
}

/** Prefill for an edit — the page's own derivation: the price
 *  shows as dollars with two decimals, the rest verbatim. */
export function productFormFromDto(p: PublicProductDto): ProductFormState {
  return {
    name: p.name,
    price: (p.price_cents / 100).toFixed(2),
    description: p.description ?? "",
    imageUrl: p.image_url ?? "",
    styleHint: "",
  };
}

/** The page's two save gates, in its order (name first, then a
 *  sane price), in the stand's plain words. Null = the form may
 *  ride. The AI helpers share the name gate: the page refuses to
 *  write or picture an unnamed product. */
export function productFormProblem(form: ProductFormState): string | null {
  if (!form.name.trim()) return "Give the product a name first.";
  if (dollarsToCents(form.price) === null) return "Enter a valid price — dollars and cents, like 19.99.";
  return null;
}

/** The product save body — POST and PATCH take the page's exact
 *  shape: trimmed name/description/image_url and price_cents
 *  parsed from the typed dollars. Null when a save gate fails. */
export function buildProductPayload(
  form: ProductFormState,
): { name: string; price_cents: number; description: string; image_url: string } | null {
  if (productFormProblem(form)) return null;
  return {
    name: form.name.trim(),
    price_cents: dollarsToCents(form.price)!,
    description: form.description.trim(),
    image_url: form.imageUrl.trim(),
  };
}

/** POST /api/shops/ai/product-description — the page's exact body
 *  (it always writes in the luxury tone). */
export function buildProductDescriptionPayload(form: ProductFormState): {
  productName: string;
  details: string;
  price: string;
  tone: "luxury";
} {
  return {
    productName: form.name.trim(),
    details: form.description.trim(),
    price: form.price.trim(),
    tone: "luxury",
  };
}

/** POST /api/shops/ai/product-image — the page's exact body. */
export function buildProductImagePayload(
  form: ProductFormState,
  tier: "standard" | "premium",
): { productName: string; styleHint: string; tier: "standard" | "premium" } {
  return { productName: form.name.trim(), styleHint: form.styleHint.trim(), tier };
}

/** The description the AI writer answered with — null when the
 *  payload doesn't honestly carry one (the caller reports failure
 *  instead of filling the form with a guess). */
export function parseAiDescription(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const d = (payload as { description?: unknown }).description;
  return typeof d === "string" && d.trim() ? d : null;
}

/** The image URL the AI image maker answered with — same rule. */
export function parseAiImageUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const u = (payload as { url?: unknown }).url;
  return typeof u === "string" && u.trim() ? u : null;
}

/** The page's out-of-credits test, verbatim: HTTP 402, or the
 *  payload's error flag — either one means the wallet, not the
 *  stand, said no. */
export function aiOutOfCredits(status: number, payload: unknown): boolean {
  if (status === 402) return true;
  if (!payload || typeof payload !== "object") return false;
  return (payload as { error?: unknown }).error === "out_of_credits";
}

/** The product row a save answers with ({ product }), narrowed to
 *  the stand's product DTO — null when the answer doesn't honestly
 *  carry one (the caller then reports failure and keeps the list
 *  it had, rather than inventing the row). */
export function savedProductDto(payload: unknown): PublicProductDto | null {
  if (!payload || typeof payload !== "object") return null;
  const p = (payload as { product?: unknown }).product;
  if (!p || typeof p !== "object") return null;
  const row = p as Record<string, unknown>;
  if (typeof row["id"] !== "string" || typeof row["name"] !== "string") return null;
  if (typeof row["price_cents"] !== "number" || !Number.isFinite(row["price_cents"])) return null;
  return {
    id: row["id"],
    name: row["name"],
    price_cents: row["price_cents"],
    description: typeof row["description"] === "string" ? row["description"] : null,
    image_url: typeof row["image_url"] === "string" ? row["image_url"] : null,
  };
}

/** Apply a confirmed save to the stand's list — the page's own
 *  semantics: an edit replaces its row (matched on the EDITED
 *  product's id), a create appends the server's row. The list only
 *  ever changes from a server-confirmed product, never from the
 *  form's local guess. */
export function applyProductSave(
  list: PublicProductDto[],
  saved: PublicProductDto,
  editingId: string | null,
): PublicProductDto[] {
  if (editingId) return list.map((x) => (x.id === editingId ? saved : x));
  return [...list, saved];
}

/** Remove a product from the stand's list — called ONLY after the
 *  server confirmed the delete. */
export function removeProduct(list: PublicProductDto[], id: string): PublicProductDto[] {
  return list.filter((x) => x.id !== id);
}

/* ─── Stand settings + sales — the rest of the owner's desk ───────
   Stack-4 wave-2 #6, the follow-on #7 named: shop settings and the
   sales ledger at the stand, on the SAME rails the website's My
   Shop page runs — PATCH/POST/DELETE /api/shops[/:id] for settings
   and GET /api/storefronts/:id/analytics for sales. No parallel
   API, no new numbers: the analytics rail is owner-scoped on the
   server (a non-owner's read is a 404), so the stand's numbers are
   the page's numbers by construction. Custom domains stay on the
   website — the stand points at the panel's standard transfer
   footer for those, and never pretends otherwise. Everything here
   renders ONLY behind the isOwnStand gate: guests and non-owners
   keep the buyer's stand, byte for byte. */

export const SHOP_NAME_MAX = 80;
export const SHOP_TAGLINE_MAX = 140;
export const SHOP_DESCRIPTION_MAX = 2000;

/** The shop-description writer's price — the same 100 VB server
 *  constant (SHOP_AI_CREDIT_COST) and registry entry the product
 *  helpers ride; shown before every run. */
export const SHOP_AI_SHOP_DESCRIPTION_COST_VB = 100;

/** The settings form's state — the My Shop page's own editable
 *  fields (name/tagline/description). The handle is the shop's
 *  address: shown, never edited here — the rail has no rename. */
export interface ShopSettingsFormState {
  name: string;
  tagline: string;
  description: string;
}

export function emptyShopSettingsForm(): ShopSettingsFormState {
  return { name: "", tagline: "", description: "" };
}

/** Prefill for the settings form — the page's own derivation: the
 *  name verbatim, tagline/description with null read as empty. */
export function shopSettingsFormFromShop(shop: { name: string; tagline: string | null; description: string | null }): ShopSettingsFormState {
  return {
    name: shop.name,
    tagline: shop.tagline ?? "",
    description: shop.description ?? "",
  };
}

/** The settings save gates, mirroring the rail's own schema
 *  (updateShopSchema) so a doomed save is refused in the form, in
 *  the stand's plain words. Null = the form may ride. */
export function shopSettingsProblem(form: ShopSettingsFormState): string | null {
  if (!form.name.trim()) return "Give your shop a name first.";
  if (form.name.trim().length > SHOP_NAME_MAX) return `The shop name tops out at ${SHOP_NAME_MAX} characters.`;
  if (form.tagline.trim().length > SHOP_TAGLINE_MAX) return `The tagline tops out at ${SHOP_TAGLINE_MAX} characters.`;
  if (form.description.trim().length > SHOP_DESCRIPTION_MAX) return `The description tops out at ${SHOP_DESCRIPTION_MAX} characters.`;
  return null;
}

/** The settings save body — PATCH /api/shops/:id takes the page's
 *  exact shape (trimmed name/tagline/description). Null when a
 *  save gate fails. */
export function buildShopSettingsPayload(
  form: ShopSettingsFormState,
): { name: string; tagline: string; description: string } | null {
  if (shopSettingsProblem(form)) return null;
  return {
    name: form.name.trim(),
    tagline: form.tagline.trim(),
    description: form.description.trim(),
  };
}

/** The shop row a settings save (or a create) answers with
 *  ({ shop }), narrowed to the stand's shop DTOs — null when the
 *  answer doesn't honestly carry one. The caller then reports
 *  failure and keeps the state it had, rather than inventing the
 *  row. */
export function savedShopDto(payload: unknown): { mine: MineShopDto; pub: PublicShopDto } | null {
  if (!payload || typeof payload !== "object") return null;
  const s = (payload as { shop?: unknown }).shop;
  if (!s || typeof s !== "object") return null;
  const row = s as Record<string, unknown>;
  if (typeof row["id"] !== "string" || typeof row["name"] !== "string" || typeof row["handle"] !== "string") return null;
  const tagline = typeof row["tagline"] === "string" ? row["tagline"] : null;
  const description = typeof row["description"] === "string" ? row["description"] : null;
  return {
    mine: {
      id: row["id"],
      name: row["name"],
      handle: row["handle"],
      tagline,
      description,
      product_count: typeof row["product_count"] === "number" && Number.isFinite(row["product_count"]) ? row["product_count"] : 0,
    },
    pub: { id: row["id"], name: row["name"], handle: row["handle"], tagline, description },
  };
}

/* ── Create a shop at the stand ────────────────────────────────────
   POST /api/shops is the page's create rail verbatim (Pro tier on
   the server — a free account's refusal is the rail's honest
   answer, surfaced as-is). The handle is the shop's future
   address: lowercased letters, numbers and single dashes, exactly
   the shape the server's normalizer accepts. */

export const SHOP_HANDLE_MIN = 3;
export const SHOP_HANDLE_MAX = 30;
export const SHOP_HANDLE_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ShopCreateFormState {
  name: string;
  handle: string;
  tagline: string;
}

export function emptyShopCreateForm(): ShopCreateFormState {
  return { name: "", handle: "", tagline: "" };
}

/** The create gates, in the page's order (name, then the handle
 *  it will live at), in the stand's plain words. Null = the form
 *  may ride; the server still has the last word (taken handles,
 *  tier). */
export function shopCreateProblem(form: ShopCreateFormState): string | null {
  if (!form.name.trim()) return "Give your shop a name first.";
  if (form.name.trim().length > SHOP_NAME_MAX) return `The shop name tops out at ${SHOP_NAME_MAX} characters.`;
  const handle = form.handle.trim().toLowerCase();
  if (handle.length < SHOP_HANDLE_MIN || handle.length > SHOP_HANDLE_MAX || !SHOP_HANDLE_RE.test(handle)) {
    return `The handle is ${SHOP_HANDLE_MIN}–${SHOP_HANDLE_MAX} characters — lowercase letters, numbers and single dashes — like gold-standard.`;
  }
  if (form.tagline.trim().length > SHOP_TAGLINE_MAX) return `The tagline tops out at ${SHOP_TAGLINE_MAX} characters.`;
  return null;
}

/** The create body — POST /api/shops takes the page's exact shape
 *  (trimmed name, the handle as typed, trimmed tagline). Null when
 *  a create gate fails. */
export function buildShopCreatePayload(
  form: ShopCreateFormState,
): { name: string; handle: string; tagline: string } | null {
  if (shopCreateProblem(form)) return null;
  return { name: form.name.trim(), handle: form.handle.trim(), tagline: form.tagline.trim() };
}

/** POST /api/shops/ai/shop-description — the page's exact body:
 *  the (possibly edited) name/tagline, the niche line, and the
 *  product names joined the page's way. */
export function buildShopDescriptionPayload(input: {
  shopName: string;
  tagline: string;
  niche: string;
  productNames: string[];
}): { shopName: string; tagline: string; niche: string; products: string } {
  return {
    shopName: input.shopName.trim(),
    tagline: input.tagline.trim(),
    niche: input.niche.trim(),
    products: input.productNames.join(", "),
  };
}

/* ── The sales view ────────────────────────────────────────────────
   GET /api/storefronts/:id/analytics, parsed tolerantly into the
   stand's shapes. A payload that doesn't honestly carry the
   totals is not a sales view at all (parse returns null and the
   stand says the ledger wouldn't open) — zeros are never invented
   for a failed read. Pending checkouts stay visibly apart from
   sales, exactly as the page keeps them: a pending order is not
   a sale until the payment confirms. */

export interface ShopSaleRow {
  id: string;
  product_name: string | null;
  amount_cents: number;
  seller_net_cents: number;
  buyer_email: string | null;
  created_at: string;
  payment_status: string | null;
  paid_at: string | null;
}

export interface ShopPendingSaleRow {
  id: string;
  product_name: string | null;
  amount_cents: number;
  seller_net_cents: number;
  created_at: string;
  payment_status: string | null;
}

export interface ShopAnalytics {
  totals: {
    views: number;
    sales: number;
    gross_cents: number;
    platform_fee_cents: number;
    seller_net_cents: number;
    pending_orders: number;
  };
  dailyViews: Array<{ day: string; views: number }>;
  sales: ShopSaleRow[];
  pendingSales: ShopPendingSaleRow[];
  platformFeePct: number;
}

function centsOrZero(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function countOrZero(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

export function parseShopAnalytics(payload: unknown): ShopAnalytics | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const t = p["totals"];
  if (!t || typeof t !== "object") return null;
  const totals = t as Record<string, unknown>;
  if (typeof totals["views"] !== "number" || typeof totals["sales"] !== "number") return null;
  if (typeof totals["gross_cents"] !== "number" || typeof totals["seller_net_cents"] !== "number") return null;

  const parseSale = (r: unknown): ShopSaleRow | null => {
    if (!r || typeof r !== "object") return null;
    const row = r as Record<string, unknown>;
    if (typeof row["id"] !== "string") return null;
    return {
      id: row["id"],
      product_name: strOrNull(row["product_name"]),
      amount_cents: centsOrZero(row["amount_cents"]),
      seller_net_cents: centsOrZero(row["seller_net_cents"]),
      buyer_email: strOrNull(row["buyer_email"]),
      created_at: typeof row["created_at"] === "string" ? row["created_at"] : "",
      payment_status: strOrNull(row["payment_status"]),
      paid_at: strOrNull(row["paid_at"]),
    };
  };
  const parsePending = (r: unknown): ShopPendingSaleRow | null => {
    if (!r || typeof r !== "object") return null;
    const row = r as Record<string, unknown>;
    if (typeof row["id"] !== "string") return null;
    return {
      id: row["id"],
      product_name: strOrNull(row["product_name"]),
      amount_cents: centsOrZero(row["amount_cents"]),
      seller_net_cents: centsOrZero(row["seller_net_cents"]),
      created_at: typeof row["created_at"] === "string" ? row["created_at"] : "",
      payment_status: strOrNull(row["payment_status"]),
    };
  };
  const rows = <T,>(v: unknown, parse: (r: unknown) => T | null): T[] =>
    Array.isArray(v) ? v.map(parse).filter((x): x is T => x !== null) : [];

  return {
    totals: {
      views: totals["views"],
      sales: totals["sales"],
      gross_cents: totals["gross_cents"],
      platform_fee_cents: centsOrZero(totals["platform_fee_cents"]),
      seller_net_cents: totals["seller_net_cents"],
      pending_orders: countOrZero(totals["pending_orders"]),
    },
    dailyViews: rows(p["dailyViews"], (r) => {
      if (!r || typeof r !== "object") return null;
      const row = r as Record<string, unknown>;
      const day = row["day"];
      const dayStr = typeof day === "string" ? day : day instanceof Date ? day.toISOString().slice(0, 10) : null;
      if (!dayStr || typeof row["views"] !== "number") return null;
      return { day: dayStr, views: row["views"] };
    }),
    sales: rows(p["sales"], parseSale),
    pendingSales: rows(p["pendingSales"], parsePending),
    platformFeePct: typeof p["platformFeePct"] === "number" && Number.isFinite(p["platformFeePct"]) ? p["platformFeePct"] : 5,
  };
}

/** What the sales view shows of the ledger: the page's own cap —
 *  the ten most recent sales, the ten most recent pending. */
export const SHOP_SALES_SHOWN = 10;
export function recentShopSales(a: ShopAnalytics): ShopSaleRow[] {
  return a.sales.slice(0, SHOP_SALES_SHOWN);
}
export function recentShopPending(a: ShopAnalytics): ShopPendingSaleRow[] {
  return a.pendingSales.slice(0, SHOP_SALES_SHOWN);
}

/** The tallest day in the views strip — the bar scale. Never
 *  below 1, so an all-zero month still renders honest flat bars. */
export function maxDailyViews(a: ShopAnalytics): number {
  return Math.max(1, ...a.dailyViews.map((d) => d.views));
}
