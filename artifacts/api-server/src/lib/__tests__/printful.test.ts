/**
 * Printful integration layer tests — mock mode only (no network, no key).
 * Live mode is exercised manually against the Printful sandbox.
 */
import { describe, expect, it } from "vitest";
import {
  fulfillmentMode,
  isPrintfulConfigured,
  mockCreateOrder,
  mockGetOrder,
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
