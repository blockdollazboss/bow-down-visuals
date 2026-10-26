/* ─── Make-an-offer client (Wave 4 #43) ────────────────────────────────
   Thin fetchers over /api/product-offers plus the pure negotiation law
   the panels validate against before they ever call the server (the
   server re-validates everything — this mirror only keeps the UI
   honest and instant). An ACCEPTED offer's agreed price is charged by
   the EXISTING checkouts: the product pages hand the offer id to
   POST /storefront/checkout (storefront products) or
   POST /storefronts/checkout (shop products), never a price. */

export type ProductOfferItemKind = "store_product" | "shop_product";
export type ProductOfferStatus =
  | "pending" | "countered" | "accepted" | "declined" | "withdrawn" | "expired" | "consumed";
export type OfferActor = "buyer" | "seller";
export type OfferAction = "accept" | "decline" | "counter" | "withdraw";

export interface ProductOffer {
  id: string;
  buyer_user_id: string;
  seller_user_id: string;
  item_kind: ProductOfferItemKind;
  item_id: string;
  profile_id: string | null;
  shop_id: string | null;
  list_price_cents: number;
  offer_amount_cents: number;
  counter_amount_cents: number | null;
  agreed_amount_cents: number | null;
  status: ProductOfferStatus;
  message: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
  /* List-endpoint enrichments. */
  title?: string;
  currentListPriceCents?: number | null;
  available?: boolean;
  link?: string;
  currentPriceCents?: number;
}

export function offerMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Parse a dollars-typed string ("42", "42.5", "$42.50") to cents, or
 *  null when it isn't a clean money amount. */
export function parseOfferDollars(raw: string): number | null {
  const cleaned = raw.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const cents = Math.round(parseFloat(cleaned) * 100);
  return Number.isFinite(cents) ? cents : null;
}

/* ── Pure negotiation law (mirrors the server — instant feedback) ──── */

export function validateOfferAmount(
  amountCents: number | null,
  listPriceCents: number,
): { ok: true; amountCents: number } | { ok: false; reason: string } {
  if (amountCents == null || !Number.isInteger(amountCents)) {
    return { ok: false, reason: "Name a price for your offer." };
  }
  if (amountCents <= 0) return { ok: false, reason: "An offer has to be more than $0 — a free product is claimed, not negotiated." };
  if (amountCents >= listPriceCents) {
    return { ok: false, reason: "That's the list price (or more) — just buy it at checkout. An offer is a price below list." };
  }
  return { ok: true, amountCents };
}

/** A counter narrows: above the countering side's own last price and
 *  below the other side's standing price. */
export function validateCounterAmount(
  amountCents: number | null,
  floorCents: number,
  ceilingCents: number,
): { ok: true; amountCents: number } | { ok: false; reason: string } {
  if (amountCents == null || !Number.isInteger(amountCents)) {
    return { ok: false, reason: "Name a price for your counter." };
  }
  if (amountCents <= floorCents) {
    return { ok: false, reason: `A counter has to move toward the other side — above ${offerMoney(floorCents)}.` };
  }
  if (amountCents >= ceilingCents) {
    return { ok: false, reason: `A counter has to stay below ${offerMoney(ceilingCents)}.` };
  }
  return { ok: true, amountCents };
}

/** Who may do what, from which status (mirrors the server table). */
export function offerActionAllowed(
  status: ProductOfferStatus,
  actor: OfferActor,
  action: OfferAction,
): boolean {
  if (status === "pending") {
    if (actor === "seller") return action === "accept" || action === "decline" || action === "counter";
    return action === "withdraw";
  }
  if (status === "countered") {
    if (actor === "buyer") return action === "accept" || action === "decline" || action === "counter" || action === "withdraw";
    return false;
  }
  if (status === "accepted") {
    return actor === "buyer" && action === "withdraw";
  }
  return false;
}

/** The price currently on the table. */
export function currentOfferPriceCents(offer: Pick<ProductOffer, "status" | "offer_amount_cents" | "counter_amount_cents" | "agreed_amount_cents">): number {
  if ((offer.status === "accepted" || offer.status === "consumed") && offer.agreed_amount_cents != null) {
    return offer.agreed_amount_cents;
  }
  if (offer.status === "countered" && offer.counter_amount_cents != null) return offer.counter_amount_cents;
  return offer.offer_amount_cents;
}

export function offerStatusLabel(status: ProductOfferStatus, actor: OfferActor): string {
  switch (status) {
    case "pending": return actor === "buyer" ? "Waiting for the seller" : "Waiting for you";
    case "countered": return actor === "buyer" ? "The seller countered" : "Waiting for the buyer";
    case "accepted": return "Accepted — ready to check out";
    case "declined": return "Declined";
    case "withdrawn": return "Withdrawn";
    case "expired": return "Expired";
    case "consumed": return "Bought at the agreed price";
  }
}

export function isOpenOffer(offer: Pick<ProductOffer, "status">): boolean {
  return offer.status === "pending" || offer.status === "countered" || offer.status === "accepted";
}

/* ── Fetchers ────────────────────────────────────────────────────────── */

type GetAccessToken = () => Promise<string | null>;

async function authInit(getAccessToken: GetAccessToken, init: RequestInit = {}): Promise<RequestInit> {
  const token = await getAccessToken();
  return {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  };
}

async function offerFetch<T>(getAccessToken: GetAccessToken, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, await authInit(getAccessToken, init));
  const data = (await res.json().catch(() => ({}))) as T & { message?: string; error?: string };
  if (!res.ok) throw new Error(data.message || data.error || "Something went wrong with that offer.");
  return data;
}

export async function fetchOfferForItem(
  getAccessToken: GetAccessToken,
  itemKind: ProductOfferItemKind,
  itemId: string,
): Promise<ProductOffer | null> {
  const data = await offerFetch<{ offer: ProductOffer | null }>(
    getAccessToken,
    `/api/product-offers/for-item?itemKind=${encodeURIComponent(itemKind)}&itemId=${encodeURIComponent(itemId)}`,
  );
  return data.offer;
}

export async function fetchMyOffers(getAccessToken: GetAccessToken): Promise<ProductOffer[]> {
  const data = await offerFetch<{ offers: ProductOffer[] }>(getAccessToken, "/api/product-offers/mine");
  return data.offers ?? [];
}

export async function fetchReceivedOffers(getAccessToken: GetAccessToken): Promise<ProductOffer[]> {
  const data = await offerFetch<{ offers: ProductOffer[] }>(getAccessToken, "/api/product-offers/received");
  return data.offers ?? [];
}

export async function createOffer(
  getAccessToken: GetAccessToken,
  input: { itemKind: ProductOfferItemKind; itemId: string; amountCents: number; message?: string },
): Promise<ProductOffer> {
  const data = await offerFetch<{ offer: ProductOffer }>(getAccessToken, "/api/product-offers", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.offer;
}

export async function actOnOffer(
  getAccessToken: GetAccessToken,
  offerId: string,
  action: OfferAction,
  amountCents?: number,
): Promise<ProductOffer> {
  const data = await offerFetch<{ offer: ProductOffer }>(getAccessToken, `/api/product-offers/${offerId}/act`, {
    method: "POST",
    body: JSON.stringify({ action, ...(amountCents != null ? { amountCents } : {}) }),
  });
  return data.offer;
}
