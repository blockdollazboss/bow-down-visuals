/**
 * Printful integration layer tests — mock mode against the real module;
 * live mode with fetch stubbed (no network, no real key). Live coverage
 * is the external_id binding: orders are findable by our own id after a
 * crash, and the lookup distinguishes "no such order" (404) from real
 * failures so callers never submit blind.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPrintfulOrder,
  findExistingOrder,
  findPrintfulOrderByExternalId,
  fulfillmentMode,
  isPrintfulConfigured,
  mockCreateOrder,
  mockGetOrder,
  PrintfulApiError,
  submitOrder,
  refreshOrder,
  toOrderStatus,
} from "../printful";

const recipient = {
  name: "Test User",
  email: "test@example.com",
  address1: "1 Main St",
  city: "Atlanta",
  stateCode: "GA",
  zip: "30301",
  countryCode: "US",
};

const items = [{ product: "tshirt", size: "M", color: "black", quantity: 1 }];

describe("fulfillment mode", () => {
  it("is mock when PRINTFUL_API_KEY is unset", () => {
    expect(process.env["PRINTFUL_API_KEY"]).toBeUndefined();
    expect(isPrintfulConfigured()).toBe(false);
    expect(fulfillmentMode()).toBe("mock");
  });
});

describe("mock orders", () => {
  it("creates an order with a mock id and pending status", () => {
    const order = mockCreateOrder(recipient, items);
    expect(order.mock).toBe(true);
    expect(order.status).toBe("pending");
    expect(order.providerOrderId.startsWith("mock_ord_")).toBe(true);
  });

  it("progresses status on refresh (pending for a fresh order)", () => {
    const order = mockCreateOrder(recipient, items);
    const refreshed = mockGetOrder(order.providerOrderId);
    expect(refreshed.mock).toBe(true);
    expect(refreshed.providerOrderId).toBe(order.providerOrderId);
    expect(refreshed.status).toBe("pending");
  });

  it("returns failed for an unknown mock order id", () => {
    const refreshed = mockGetOrder("mock_ord_nonexistent");
    expect(refreshed.status).toBe("failed");
    expect(refreshed.mock).toBe(true);
  });
});

describe("mode-aware entry points", () => {
  it("submitOrder routes to mock without a key", async () => {
    const order = await submitOrder(recipient, items);
    expect(order.mock).toBe(true);
    expect(order.providerOrderId.startsWith("mock_ord_")).toBe(true);
  });

  it("refreshOrder routes to mock without a key", async () => {
    const order = await submitOrder(recipient, items);
    const refreshed = await refreshOrder(order.providerOrderId);
    expect(refreshed.mock).toBe(true);
    expect(refreshed.status).toBe("pending");
  });
});

describe("toOrderStatus", () => {
  it("maps fulfillment statuses to order-table statuses", () => {
    expect(toOrderStatus("pending")).toBe("pending_fulfillment");
    expect(toOrderStatus("in_production")).toBe("in_production");
    expect(toOrderStatus("shipped")).toBe("shipped");
    expect(toOrderStatus("delivered")).toBe("delivered");
    expect(toOrderStatus("canceled")).toBe("canceled");
    expect(toOrderStatus("failed")).toBe("failed");
  });
});

/* ── Live mode (fetch stubbed) — external_id binding + lookup ──────────
   Orders are created carrying OUR order id as Printful's external_id;
   GET /orders/@<external_id> finds them again. The lookup returns null
   ONLY for a 404 — anything else throws, so a caller deciding whether
   to submit can never mistake "couldn't check" for "doesn't exist". */
describe("live mode — external_id lookup", () => {
  interface RecordedCall {
    url: string;
    method: string;
    body?: Record<string, unknown>;
  }
  const calls: RecordedCall[] = [];
  let handler: (call: RecordedCall) => unknown;

  function pfResponse(status: number, result?: unknown, errorMessage?: string) {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 404 ? "Not Found" : "Status",
      json: async () =>
        status < 400
          ? { code: status, result }
          : { code: status, error: { message: errorMessage ?? "error" } },
    };
  }

  beforeEach(() => {
    calls.length = 0;
    process.env["PRINTFUL_API_KEY"] = "test-key";
    process.env["PRINTFUL_VARIANT_TSHIRT"] = "123";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
        const call: RecordedCall = {
          url,
          method: init?.method ?? "GET",
          ...(init?.body ? { body: JSON.parse(init.body) as Record<string, unknown> } : {}),
        };
        calls.push(call);
        return handler(call);
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env["PRINTFUL_API_KEY"];
    delete process.env["PRINTFUL_VARIANT_TSHIRT"];
  });

  it("finds an existing order by external id, shaped like a fetched order", async () => {
    handler = () =>
      pfResponse(200, {
        id: 777,
        external_id: "bdv-order-1",
        status: "draft",
        shipments: [{ tracking_number: "TRK1", tracking_url: "https://trk.test/1" }],
      });

    const found = await findPrintfulOrderByExternalId("bdv-order-1");
    expect(found).toEqual({
      providerOrderId: "777",
      status: "pending",
      trackingNumber: "TRK1",
      trackingUrl: "https://trk.test/1",
      mock: false,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.printful.com/orders/@bdv-order-1");
    expect(calls[0]?.method).toBe("GET");
  });

  it("returns null on a 404 — and only on a 404", async () => {
    handler = () => pfResponse(404, undefined, "Order not found");
    await expect(findPrintfulOrderByExternalId("bdv-missing")).resolves.toBeNull();
  });

  it("throws on a real API failure (never reports 'not found' when it couldn't check)", async () => {
    handler = () => pfResponse(500, undefined, "Internal error");
    const err = await findPrintfulOrderByExternalId("bdv-order-1").catch(
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(PrintfulApiError);
    expect((err as PrintfulApiError).code).toBe(500);
    expect((err as Error).message).toBe("Printful API error 500: Internal error");
  });

  it("findExistingOrder delegates to the lookup in live mode", async () => {
    handler = () => pfResponse(200, { id: 42, status: "pending" });
    const found = await findExistingOrder("bdv-order-2");
    expect(found?.providerOrderId).toBe("42");
    expect(calls).toHaveLength(1);
  });

  it("createPrintfulOrder binds our id as external_id on the POST", async () => {
    handler = () => pfResponse(200, { id: 900, status: "draft" });

    const created = await createPrintfulOrder(recipient, items, "bdv-order-3");
    expect(created.providerOrderId).toBe("900");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://api.printful.com/orders");
    expect(calls[0]?.body?.["external_id"]).toBe("bdv-order-3");
    expect(calls[0]?.body?.["confirm"]).toBe(false);
  });

  it("createPrintfulOrder without an external id sends none (previous behavior)", async () => {
    handler = () => pfResponse(200, { id: 901, status: "draft" });

    await createPrintfulOrder(recipient, items);
    expect(calls[0]?.body).not.toHaveProperty("external_id");
  });

  it("submitOrder passes the external id through in live mode", async () => {
    handler = () => pfResponse(200, { id: 902, status: "draft" });

    await submitOrder(recipient, items, "bdv-order-4");
    expect(calls[0]?.body?.["external_id"]).toBe("bdv-order-4");
  });
});

describe("findExistingOrder — mock mode", () => {
  it("reports none and makes no provider call without a key", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      await expect(findExistingOrder("bdv-order-1")).resolves.toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
