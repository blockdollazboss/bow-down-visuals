/* ─── Printful dropship integration layer ─────────────────────────────────
   Bow Down Visuals never touches inventory: Printful (print-on-demand)
   manufactures and ships every branding-shop order directly to the customer.

   MODES:
   - LIVE: PRINTFUL_API_KEY is set → real https://api.printful.com calls.
     Auth is HTTP Basic with the API key (base64("<key>:")).
   - MOCK (sandbox): no key → every call is simulated end-to-end with
     realistic IDs and time-based status progression, so the whole flow
     (catalog → design → order → fulfillment → tracking) works in dev and
     goes live the moment a key is added. Mock responses are ALWAYS
     labeled { mock: true } and the UI must surface "Demo fulfillment".

   HONESTY: statuses are only ever reported from the provider (real or
   mock-simulated). Nothing is fabricated in live mode.

   Docs: https://developers.printful.com/docs/                                */

export interface PrintfulOrderItem {
  /** Our catalog product key, e.g. "tshirt". */
  product: string;
  size: string;
  color: string;
  quantity: number;
  /** Public URL of the design/print file. */
  designUrl?: string;
}

export interface PrintfulRecipient {
  name: string;
  email: string;
  address1: string;
  city: string;
  stateCode: string;
  zip: string;
  countryCode: string;
}

export type FulfillmentStatus =
  | "pending"        // order received by provider, awaiting confirmation
  | "in_production"  // being manufactured
  | "shipped"        // handed to carrier
  | "delivered"      // carrier confirms delivery
  | "canceled"
  | "failed";

export interface FulfillmentOrder {
  providerOrderId: string;
  status: FulfillmentStatus;
  trackingNumber?: string;
  trackingUrl?: string;
  mock: boolean;
}

/** Map our catalog product keys → Printful sync variant IDs (live mode).
 *  One default variant per product for v1 — env-overridable per product so
 *  ops can point each at the right Printful sync variant without a deploy.
 *  Size-level variant mapping is a documented follow-up. */
function variantIdFor(product: string): number | null {
  const envKey = `PRINTFUL_VARIANT_${product.toUpperCase()}`;
  const raw = process.env[envKey];
  if (raw && /^\d+$/.test(raw.trim())) return Number(raw.trim());
  return null;
}

export function isPrintfulConfigured(): boolean {
  return !!process.env["PRINTFUL_API_KEY"]?.trim();
}

export function fulfillmentMode(): "printful" | "mock" {
  return isPrintfulConfigured() ? "printful" : "mock";
}

function authHeader(): string {
  const key = process.env["PRINTFUL_API_KEY"]!.trim();
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

/** Printful API failure. The message format is unchanged from the plain
 *  Error this layer used to throw; the numeric code rides along so
 *  callers can distinguish "not found" (404) from real failures — the
 *  external-id lookup below depends on exactly that distinction. */
export class PrintfulApiError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(`Printful API error ${code}: ${message}`);
    this.name = "PrintfulApiError";
    this.code = code;
  }
}

async function printfulFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.printful.com${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: init?.signal ?? AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    code?: number;
    result?: T;
    error?: { message?: string };
  };
  if (!res.ok || (body.code !== undefined && body.code >= 400)) {
    throw new PrintfulApiError(
      body.code ?? res.status,
      body.error?.message ?? res.statusText
    );
  }
  return body.result as T;
}

/* ─── Live mode ─────────────────────────────────────────────────────────── */

interface PrintfulApiOrder {
  id: number;
  /** Our order id, echoed back when the order was created with one. */
  external_id?: string;
  status: string;
  shipments?: Array<{ tracking_number?: string; tracking_url?: string }>;
}

function toFulfillmentOrder(result: PrintfulApiOrder): FulfillmentOrder {
  const shipment = result.shipments?.[0];
  return {
    providerOrderId: String(result.id),
    status: mapPrintfulStatus(result.status),
    trackingNumber: shipment?.tracking_number,
    trackingUrl: shipment?.tracking_url,
    mock: false,
  };
}

/* Removed 2026-10-10: listSyncProducts was dead (zero imports). */

/** Live: submit an order to Printful as a DRAFT (confirm: false) so ops can
 *  review in the Printful dashboard before money moves. Returns the provider
 *  order id. When externalId is given it is sent as the order's external_id —
 *  our own order id — which is what makes the order findable again via
 *  findPrintfulOrderByExternalId if this process dies before recording the
 *  provider id it gets back. */
export async function createPrintfulOrder(
  recipient: PrintfulRecipient,
  items: PrintfulOrderItem[],
  externalId?: string
): Promise<FulfillmentOrder> {
  const missing = items.filter((i) => variantIdFor(i.product) == null);
  if (missing.length > 0) {
    throw new Error(
      `Printful variant not mapped for: ${missing.map((i) => i.product).join(", ")}. ` +
        `Set ${missing.map((i) => `PRINTFUL_VARIANT_${i.product.toUpperCase()}`).join(", ")}.`
    );
  }
  const result = await printfulFetch<PrintfulApiOrder>("/orders", {
    method: "POST",
    body: JSON.stringify({
      ...(externalId ? { external_id: externalId } : {}),
      recipient: {
        name: recipient.name,
        email: recipient.email,
        address1: recipient.address1,
        city: recipient.city,
        state_code: recipient.stateCode,
        country_code: recipient.countryCode,
        zip: recipient.zip,
      },
      items: items.map((i) => ({
        sync_variant_id: variantIdFor(i.product)!,
        quantity: i.quantity,
        ...(i.designUrl ? { files: [{ url: i.designUrl }] } : {}),
      })),
      confirm: false,
    }),
  });
  return {
    providerOrderId: String(result.id),
    status: mapPrintfulStatus(result.status),
    mock: false,
  };
}

/** Live: find the order Printful holds under OUR external id, if any.
 *  Printful serves it at GET /orders/@<external_id>. Returns null ONLY on
 *  a 404 (no such order — safe to submit); every other failure throws, so
 *  a caller can never mistake "couldn't check" for "doesn't exist" and
 *  submit a duplicate blind. */
export async function findPrintfulOrderByExternalId(
  externalId: string
): Promise<FulfillmentOrder | null> {
  try {
    const result = await printfulFetch<PrintfulApiOrder>(
      `/orders/@${encodeURIComponent(externalId)}`
    );
    return toFulfillmentOrder(result);
  } catch (err) {
    if (err instanceof PrintfulApiError && err.code === 404) return null;
    throw err;
  }
}

/** Live: confirm a draft order (charges the Printful account, starts production). */
export async function confirmPrintfulOrder(providerOrderId: string): Promise<void> {
  await printfulFetch(`/orders/${encodeURIComponent(providerOrderId)}/confirm`, {
    method: "POST",
  });
}

/** Live: fetch the current status of a provider order. */
export async function getPrintfulOrder(providerOrderId: string): Promise<FulfillmentOrder> {
  const result = await printfulFetch<PrintfulApiOrder>(
    `/orders/${encodeURIComponent(providerOrderId)}`
  );
  return toFulfillmentOrder(result);
}

function mapPrintfulStatus(s: string): FulfillmentStatus {
  const v = s.toLowerCase();
  if (v === "draft" || v === "pending") return "pending";
  if (v === "failed") return "failed";
  if (v === "canceled") return "canceled";
  if (v === "fulfilled") return "shipped";
  if (v.includes("ship")) return "shipped";
  if (v.includes("deliver")) return "delivered";
  return "in_production";
}

/* ─── Mock (sandbox) mode ─────────────────────────────────────────────────
   Deterministic simulation so the entire flow works without a key.
   Status progresses with order age: pending (<2 min) → in_production
   (<15 min) → shipped (with fake tracking). Clearly labeled mock. */

const mockStore = new Map<
  string,
  { createdAt: number; status: FulfillmentStatus }
>();

function mockId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function mockCreateOrder(
  _recipient: PrintfulRecipient,
  _items: PrintfulOrderItem[]
): FulfillmentOrder {
  const id = mockId("mock_ord");
  mockStore.set(id, { createdAt: Date.now(), status: "pending" });
  return { providerOrderId: id, status: "pending", mock: true };
}

export function mockGetOrder(providerOrderId: string): FulfillmentOrder {
  const rec = mockStore.get(providerOrderId);
  if (!rec) {
    return { providerOrderId, status: "failed", mock: true };
  }
  const ageMin = (Date.now() - rec.createdAt) / 60_000;
  const status: FulfillmentStatus =
    ageMin < 2 ? "pending" : ageMin < 15 ? "in_production" : "shipped";
  rec.status = status;
  return {
    providerOrderId,
    status,
    ...(status === "shipped"
      ? {
          trackingNumber: `DEMO${providerOrderId.slice(-8).toUpperCase()}`,
          trackingUrl: undefined,
        }
      : {}),
    mock: true,
  };
}

/* ─── Unified entry points (mode-aware) ─────────────────────────────────── */

export async function submitOrder(
  recipient: PrintfulRecipient,
  items: PrintfulOrderItem[],
  externalId?: string
): Promise<FulfillmentOrder> {
  if (isPrintfulConfigured()) return createPrintfulOrder(recipient, items, externalId);
  return mockCreateOrder(recipient, items);
}

/** Look up the provider order already bound to our external id, if one
 *  exists. Mock mode makes NO provider call and reports none — the mock
 *  store only ever holds orders this process submitted and recorded, so
 *  there is never an unrecorded mock order to adopt. */
export async function findExistingOrder(
  externalId: string
): Promise<FulfillmentOrder | null> {
  if (!isPrintfulConfigured()) return null;
  return findPrintfulOrderByExternalId(externalId);
}

export async function refreshOrder(providerOrderId: string): Promise<FulfillmentOrder> {
  if (isPrintfulConfigured()) return getPrintfulOrder(providerOrderId);
  return mockGetOrder(providerOrderId);
}

/** Map a fulfillment status onto our order-table status vocabulary. */
export function toOrderStatus(s: FulfillmentStatus): string {
  switch (s) {
    case "pending":
      return "pending_fulfillment";
    case "in_production":
      return "in_production";
    case "shipped":
      return "shipped";
    case "delivered":
      return "delivered";
    case "canceled":
      return "canceled";
    case "failed":
      return "failed";
  }
}
