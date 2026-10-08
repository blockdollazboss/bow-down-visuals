/**
 * storefront-api.ts — typed client for the Sell Everything storefront API.
 *
 * Conventions: authed helpers take the token from useAuth().getAccessToken().
 * Public helpers need no token. All money is REAL dollars via Stripe — never
 * Visual Bucs. Keep the two economies separate in every label.
 */

export type StoreProductKind = "download" | "merch" | "digital" | "service" | "ticket";

export interface RelatedLink { label: string; url: string; }

export interface ServiceDetails {
  duration_min?: number;
  location?: string;
  booking_calendar_link?: string;
  notes?: string;
}

export interface ProductLinks {
  creatorUrl: string;
  creatorName: string;
  productUrl: string;
  eventUrl: string | null;
  eventTitle: string | null;
}

export interface StoreProductDTO {
  id: string;
  profileId: string;
  kind: StoreProductKind;
  title: string;
  description: string;
  priceCents: number;
  price: string;
  compareAtCents: number | null;
  inventory: number;
  soldOut: boolean;
  unlimited: boolean;
  mediaUrls: string[];
  serviceDetails: ServiceDetails | null;
  eventId: string | null;
  relatedLinks: RelatedLink[];
  isActive: boolean;
  createdAt: string;
  links: ProductLinks;
}

export interface FeeSplit {
  priceCents: number; price: string;
  platformFeeCents: number; platformFee: string; platformFeePct: number;
  creatorCents: number; creatorAmount: string;
}

export interface StoreOrderDTO {
  id: string;
  productId: string | null;
  productTitle: string;
  productKind: string;
  quantity: number;
  grossCents: number; gross: string;
  platformFeeCents: number; platformFee: string; platformFeePct: number;
  netCents: number; net: string;
  discountCode: string | null;
  status: string;
  fulfillmentNote: string | null;
  createdAt: string;
  links: { productUrl: string | null; creatorUrl: string | null };
}

export interface DiscountCodeDTO {
  id: string;
  code: string;
  percentOff: number;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  isActive: boolean;
  createdAt?: string;
  appliesTo?: string;
}

export interface ChecklistItem {
  id: string; title: string; detail: string; cta: string; href: string;
  priority: number; done: boolean;
}

export interface MoneyChecklist {
  earnings: {
    orderCount: number;
    grossCents: number; feeCents: number; netCents: number;
    gross: string; fee: string; net: string;
    platformFeePct: number;
    pendingPayoutNote: string;
  };
  checklist: ChecklistItem[];
  nextMove: ChecklistItem | null;
  links: { storeUrl: string; dashboardUrl: string; ordersUrl: string; trackerNote: string };
}

export interface CreateProductInput {
  kind: StoreProductKind;
  title: string;
  description?: string;
  priceCents: number;
  compareAtCents?: number | null;
  inventory?: number;
  mediaUrls?: string[];
  serviceDetails?: ServiceDetails | null;
  eventId?: string | null;
  relatedLinks?: RelatedLink[];
  isActive?: boolean;
}

const BASE = "/api/storefront";

async function req<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = data as { error?: string; message?: string };
    throw new Error(err.message ?? err.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

const get = <T,>(path: string, token: string | null = null) => req<T>(path, token);
const post = <T,>(path: string, body: unknown, token: string | null) =>
  req<T>(path, token, { method: "POST", body: JSON.stringify(body ?? {}) });
const patch = <T,>(path: string, body: unknown, token: string | null) =>
  req<T>(path, token, { method: "PATCH", body: JSON.stringify(body ?? {}) });
const del = <T,>(path: string, token: string | null) => req<T>(path, token, { method: "DELETE" });

/* ── Public ─────────────────────────────────────────────────────────── */
export const listProducts = (slug: string) =>
  get<{ profile: { id: string; slug: string; displayName: string }; products: StoreProductDTO[]; feeNote: string }>(
    `/products?slug=${encodeURIComponent(slug)}`
  );

export const getProduct = (id: string) =>
  get<{ product: StoreProductDTO; feeSplit: FeeSplit; note: string }>(`/product/${id}`);

export const validateDiscount = (profileId: string, code: string) =>
  get<{ valid: boolean; code?: string; percentOff?: number; reason?: string }>(
    `/discounts/validate?profileId=${encodeURIComponent(profileId)}&code=${encodeURIComponent(code)}`
  );

/* ── Buyer ──────────────────────────────────────────────────────────── */
export const checkoutProduct = (
  token: string,
  input: { productId: string; quantity?: number; discountCode?: string }
) =>
  post<{
    url: string; sessionId: string;
    totals: { unitCents: number; quantity: number; lineTotal: number; lineTotalDisplay: string; percentOff: number; discountCode: string | null; platformFeeCents: number; creatorCents: number };
  }>("/checkout", input, token);

export const verifyPurchase = (token: string, sessionId: string) =>
  post<{
    success: boolean; duplicate: boolean;
    order: {
      id: string; productKind: string; quantity: number;
      amountCents: number; amount: string;
      platformFeeCents: number; platformFee: string; platformFeePct: number;
      creatorAmountCents: number; creatorAmount: string;
      discountCode: string | null; fulfillmentNote: string | null;
    };
    delivery: { url: string; expiresAt: string; maxUses: number } | null;
    links: { productUrl: string | null; creatorUrl: string | null; eventUrl: string | null; orderHistoryUrl: string };
    note: string;
  }>("/verify", { sessionId }, token);

export const myPurchases = (token: string) =>
  get<{ purchases: (StoreOrderDTO & { artistName: string; artistSlug: string })[] }>("/orders/purchases", token);

/* ── Seller ─────────────────────────────────────────────────────────── */
export const createProduct = (token: string, input: CreateProductInput) =>
  post<{ product: StoreProductDTO }>("/products", input, token);

export const updateProduct = (token: string, id: string, input: Partial<CreateProductInput>) =>
  patch<{ product: StoreProductDTO }>(`/products/${id}`, input, token);

export const deactivateProduct = (token: string, id: string) =>
  del<{ ok: boolean }>(`/products/${id}`, token);

export const listDiscounts = (token: string) =>
  get<{ codes: DiscountCodeDTO[] }>("/discounts", token);

export const createDiscount = (
  token: string,
  input: { code: string; percentOff: number; maxUses?: number; expiresAt?: string | null }
) => post<{ code: DiscountCodeDTO }>("/discounts", input, token);

export const updateDiscount = (
  token: string, id: string, input: { isActive?: boolean; expiresAt?: string | null; maxUses?: number }
) => patch<{ ok: boolean }>(`/discounts/${id}`, input, token);

export const deleteDiscount = (token: string, id: string) => del<{ ok: boolean }>(`/discounts/${id}`, token);

export const mySales = (token: string) =>
  get<{
    orders: StoreOrderDTO[];
    totals: { grossCents: number; feeCents: number; netCents: number; gross: string; fee: string; net: string; platformFeePct: number };
    note: string;
  }>("/orders/sales", token);

export const logSaleToTracker = (token: string, orderId: string) =>
  post<{ entry: { id: string; amountCents: number; amount: string; date: string }; moneyTrackerUrl: string }>(
    `/orders/${orderId}/log-to-tracker`, {}, token
  );

export const confirmServiceBooking = (token: string, orderId: string, confirmed: boolean, note?: string) =>
  post<{ ok: boolean; note: string }>(`/orders/${orderId}/service-confirm`, { confirmed, note }, token);

export const moneyChecklist = (token: string) =>
  get<MoneyChecklist>("/money-checklist", token);

export const emailPromoteHook = (token: string, productId?: string) =>
  get<{
    lists: { id: string; name: string; subscribers: number }[];
    prefill: {
      subject: string; body: string; draftEndpoint: string; method: string;
      payloadShape: Record<string, string>;
    } | null;
  }>(`/promote/email${productId ? `?productId=${encodeURIComponent(productId)}` : ""}`, token);

/* ── Money formatting (real dollars; never Visual Bucs) ─────────────── */
export const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
export const dollarsToCents = (dollars: string | number) =>
  Math.round(Number(dollars) * 100);

export const KIND_LABELS: Record<StoreProductKind, string> = {
  download: "Download",
  merch: "Merch",
  digital: "Digital",
  service: "Service",
  ticket: "Ticket",
};

export const KIND_EMOJI: Record<StoreProductKind, string> = {
  download: "⬇️",
  merch: "👕",
  digital: "💾",
  service: "📅",
  ticket: "🎟️",
};
