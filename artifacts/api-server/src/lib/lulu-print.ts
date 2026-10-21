/* Thy Books — Lulu Print API integration (LIVE).
 *
 * Print-on-demand for Thy Books: quote → order → track.
 * Sandbox when LULU_USE_SANDBOX=true, production otherwise.
 *
 * Auth: OAuth2 client-credentials via Keycloak, token cached until expiry.
 * NEVER place a real order without explicit user approval per order.
 */

/* ── Config ── */

export const LULU_SANDBOX_BASE = "https://api.sandbox.lulu.com";
export const LULU_PROD_BASE = "https://api.lulu.com";

export function isLuluSandbox(): boolean {
  return (process.env["LULU_USE_SANDBOX"] ?? "true").toLowerCase() !== "false";
}

export function luluBase(): string {
  return isLuluSandbox() ? LULU_SANDBOX_BASE : LULU_PROD_BASE;
}

export function isLuluConfigured(): boolean {
  return Boolean(process.env["LULU_CLIENT_KEY"] && process.env["LULU_CLIENT_SECRET"]);
}

export function assertLuluConfigured(): void {
  if (!isLuluConfigured()) {
    throw new Error(
      "Lulu Print API is not configured. Set LULU_CLIENT_KEY and LULU_CLIENT_SECRET on Render first."
    );
  }
}

/* Standard 6x9 paperback SKUs (matches our interior PDF trim size). */
export const LULU_SKU_6X9_BW_PAPERBACK = "0600X0900BWSTDPB060UW444MXX";
export const LULU_SKU_6X9_COLOR_PAPERBACK = "0600X0900FCSTDPB080CW444GXX";

/* ── Auth (token cache) ── */

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

export async function getLuluAccessToken(): Promise<string> {
  assertLuluConfigured();
  const now = Date.now();
  if (cachedToken && now < tokenExpiresAt - 30_000) return cachedToken;

  const key = process.env["LULU_CLIENT_KEY"]!;
  const secret = process.env["LULU_CLIENT_SECRET"]!;
  const tokenUrl = `${luluBase()}/auth/realms/glasstree/protocol/openid-connect/token`;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: key,
    client_secret: secret,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Lulu auth failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  if (!data.access_token) throw new Error("Lulu auth returned no access_token");
  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in ?? 300) * 1000;
  return cachedToken;
}

/* For tests — force a fresh token next call. */
export function clearLuluTokenCache(): void {
  cachedToken = null;
  tokenExpiresAt = 0;
}

/* ── Authenticated fetch helper ── */

export interface LuluApiError extends Error {
  status: number;
  body: string;
}

async function luluFetch(path: string, init: RequestInit = {}): Promise<any> {
  const token = await getLuluAccessToken();
  const res = await fetch(`${luluBase()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = new Error(
      `Lulu API ${init.method ?? "GET"} ${path} failed (${res.status}): ${typeof data === "string" ? data.slice(0, 300) : JSON.stringify(data)?.slice(0, 300)}`
    ) as LuluApiError;
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return data;
}

/* ── Types ── */

export interface CoverDimensions {
  width: number; // inches, full spread
  height: number; // inches
  spineWidth: number; // inches
  bleed: number;
  wrapWidth?: number;
  [key: string]: unknown;
}

export interface PrintQuoteLineItem {
  pod_package_id: string;
  page_count: number;
  quantity: number;
}

export interface ShippingAddressInput {
  name: string;
  street1: string;
  street2?: string;
  city: string;
  state_code?: string;
  country_code: string; // ISO 2-letter
  postcode: string;
  phone_number: string;
}

export interface ShippingOption {
  id: string;
  label?: string;
  cost_excl_tax?: string;
  currency?: string;
  delivery_time?: string;
  [key: string]: unknown;
}

/* ── Cover dimensions ── */

export async function getCoverDimensions(
  podPackageId: string,
  pageCount: number
): Promise<CoverDimensions> {
  return luluFetch("/cover-dimensions/", {
    method: "POST",
    body: JSON.stringify({ pod_package_id: podPackageId, page_count: pageCount }),
  });
}

/* ── Cost calculation ── */

export async function getPrintQuote(
  lineItems: PrintQuoteLineItem[]
): Promise<any> {
  return luluFetch("/print-job-cost-calculations/", {
    method: "POST",
    body: JSON.stringify({
      line_items: lineItems.map((li) => ({
        pod_package_id: li.pod_package_id,
        page_count: li.page_count,
        quantity: li.quantity,
      })),
    }),
  });
}

/* ── Shipping options ──
 * Current API: GET /print-shipping-options/ with query params.
 * Falls back to legacy POST /shipping-options/ if the new one 404s. */

export async function getShippingOptions(params: {
  countryCode: string;
  stateCode?: string;
  postcode?: string;
}): Promise<ShippingOption[]> {
  const qs = new URLSearchParams({ country_code: params.countryCode });
  if (params.stateCode) qs.set("state_code", params.stateCode);
  if (params.postcode) qs.set("postcode", params.postcode);
  try {
    const data = await luluFetch(`/print-shipping-options/?${qs.toString()}`, { method: "GET" });
    return Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
  } catch (err) {
    if ((err as LuluApiError).status === 404) {
      const data = await luluFetch("/shipping-options/", {
        method: "POST",
        body: JSON.stringify({
          country_code: params.countryCode,
          state_code: params.stateCode,
          postcode: params.postcode,
        }),
      });
      return Array.isArray(data?.results) ? data.results : Array.isArray(data) ? data : [];
    }
    throw err;
  }
}

/* ── File validation ── */

export async function validateInterior(sourceUrl: string): Promise<any> {
  return luluFetch("/validate-interior/", {
    method: "POST",
    body: JSON.stringify({ source_url: sourceUrl }),
  });
}

export async function validateCover(sourceUrl: string, pageCount: number): Promise<any> {
  return luluFetch("/validate-cover/", {
    method: "POST",
    body: JSON.stringify({ source_url: sourceUrl, page_count: pageCount }),
  });
}

/* ── Print jobs ── */

export interface CreatePrintOrderInput {
  contactEmail: string;
  externalId: string;
  title: string;
  quantity: number;
  podPackageId: string;
  coverUrl: string; // print-ready cover PDF URL
  interiorUrl: string; // print-ready interior PDF URL
  shippingAddress: ShippingAddressInput;
  shippingLevel: "MAIL" | "PRIORITY_MAIL" | "GROUND" | "EXPEDITED" | "EXPRESS";
}

export async function createPrintOrder(input: CreatePrintOrderInput): Promise<any> {
  return luluFetch("/print-jobs/", {
    method: "POST",
    body: JSON.stringify({
      contact_email: input.contactEmail,
      external_id: input.externalId,
      line_items: [
        {
          external_id: `${input.externalId}-1`,
          title: input.title,
          quantity: input.quantity,
          pod_package_id: input.podPackageId,
          cover: { source_url: input.coverUrl },
          interior: { source_url: input.interiorUrl },
        },
      ],
      shipping_address: {
        name: input.shippingAddress.name,
        street1: input.shippingAddress.street1,
        ...(input.shippingAddress.street2 ? { street2: input.shippingAddress.street2 } : {}),
        city: input.shippingAddress.city,
        ...(input.shippingAddress.state_code ? { state_code: input.shippingAddress.state_code } : {}),
        country_code: input.shippingAddress.country_code,
        postcode: input.shippingAddress.postcode,
        phone_number: input.shippingAddress.phone_number,
      },
      shipping_level: input.shippingLevel,
    }),
  });
}

export async function getPrintJob(printJobId: number | string): Promise<any> {
  return luluFetch(`/print-jobs/${printJobId}/`, { method: "GET" });
}

export async function getOrderStatus(printJobId: number | string): Promise<any> {
  return luluFetch(`/print-jobs/${printJobId}/status/`, { method: "GET" });
}

export async function getPrintJobCosts(printJobId: number | string): Promise<any> {
  return luluFetch(`/print-jobs/${printJobId}/costs/`, { method: "GET" });
}

/* Cancel — only works before the job enters production. */
export async function cancelPrintOrder(printJobId: number | string): Promise<any> {
  return luluFetch(`/print-jobs/${printJobId}/status/`, {
    method: "PUT",
    body: JSON.stringify({ status: "CANCELED" }),
  });
}

/* ── Webhooks ── */

export async function registerLuluWebhook(url: string, topics?: string[]): Promise<any> {
  return luluFetch("/webhooks/", {
    method: "POST",
    body: JSON.stringify({ url, ...(topics ? { topics } : {}) }),
  });
}

export async function listLuluWebhooks(): Promise<any> {
  return luluFetch("/webhooks/", { method: "GET" });
}

export const LULU_INTEGRATION_STATUS = "live" as const;
