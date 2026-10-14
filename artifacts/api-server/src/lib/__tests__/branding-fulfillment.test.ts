/**
 * branding-fulfillment.test.ts — order-level claim inside fulfillment.
 *
 * Commit 15e29c9d gave the Stripe webhook's branding branch an
 * insert-first session claim, but left one residual: fulfillBrandingOrder
 * itself was still check-then-act on provider_order_id. A crash after
 * the provider accepted an order but before the id was persisted left
 * the row NULL, and the retry submitted a SECOND provider order (the
 * PrintKK rug path resubmitted — and re-paid — every item on any
 * mid-loop crash). confirmBrandingFulfillment also re-POSTed the
 * provider confirm unconditionally.
 *
 * The module now claims the order by writing a sentinel token into
 * provider_order_id with one atomic conditional UPDATE (see the claim
 * comment in branding-fulfillment.ts). These tests drive the REAL
 * module over a fake @workspace/db whose execute() interprets the raw
 * SQL statements the module issues (dispatch on the SET clause,
 * positional params extracted from the drizzle chunk graph), with the
 * provider modules mocked and per-statement failure injection:
 *
 *  - happy path: claim → one submit → persist; second call early-returns;
 *  - concurrent deliveries: exactly one submit, the loser sees the live
 *    claim and throws BrandingFulfillmentInProgressError;
 *  - crash-after-submit, transient persist failure: the persist write's
 *    internal retry lands it — an outer retry submits ZERO more times;
 *  - crash-after-submit, hard persist failure: claim HELD (never
 *    released), immediate retry submits nothing; a stale claim is later
 *    reclaimed and the fulfillment completes;
 *  - PrintKK mid-loop crash: per-item provider ids are recorded in the
 *    items jsonb as items complete, the claim is released (provider
 *    call failed), and the retry submits ONLY the missing items;
 *  - PrintKK progress-recording failure: the provider accepted (and was
 *    paid for) an item, so the claim is HELD and an immediate retry
 *    submits nothing;
 *  - PrintKK resume with all items recorded: zero provider calls, the
 *    final state persists from the recorded ids;
 *  - confirm guard: already-confirmed / terminal / mock / unsubmitted
 *    orders never reach the provider confirm; a pending draft does;
 *  - refresh guard: a claim token is never sent to the provider.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* ── Hoisted fake @workspace/db ────────────────────────────────────────
   Interprets the module's db.execute(sql`...`) statements against an
   in-memory branding_orders row. Statement dispatch is by distinctive
   SET-clause substring (checked in an order that keeps the overlapping
   clauses unambiguous); params are positional, matching the fixed SQL
   shapes in branding-fulfillment.ts. */
const h = vi.hoisted(() => {
  interface FakeItem {
    product: string;
    color: string;
    size: string;
    qty: number;
    unitPriceCents: number;
    designUrl?: string;
    providerOrderId?: string;
    designCode?: string;
  }
  interface FakeRow {
    id: string;
    user_id: string;
    items: FakeItem[];
    total_cents: number;
    name: string;
    email: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    status: string;
    provider: string;
    provider_order_id: string | null;
    paid: boolean;
    tracking_number: string | null;
    tracking_url: string | null;
    stripe_session_id: string | null;
  }

  const state = {
    rows: new Map<string, FakeRow>(),
    failPlans: [] as Array<{ match: string; remaining: number }>,
  };

  function parseQuery(q: unknown): { text: string; params: unknown[] } {
    const params: unknown[] = [];
    let text = "";
    const walk = (node: unknown): void => {
      const chunks = (node as { queryChunks?: unknown[] })?.queryChunks;
      if (!Array.isArray(chunks)) return;
      for (const c of chunks) {
        if (
          c &&
          typeof c === "object" &&
          (c as { constructor?: { name?: string } }).constructor?.name === "StringChunk" &&
          Array.isArray((c as { value?: unknown }).value)
        ) {
          text += ((c as { value: string[] }).value).join("");
        } else if (c && typeof c === "object" && Array.isArray((c as { queryChunks?: unknown }).queryChunks)) {
          walk(c);
        } else if (typeof c === "string") {
          params.push(c);
        } else if (c && typeof c === "object" && c.constructor?.name === "String") {
          params.push(String(c));
        } else {
          params.push(c);
        }
      }
    };
    walk(q);
    return { text: text.replace(/\s+/g, " ").trim(), params };
  }

  function cloneRow(row: FakeRow): FakeRow {
    return JSON.parse(JSON.stringify(row)) as FakeRow;
  }

  const db = {
    execute: async (q: unknown): Promise<{ rows: unknown[] }> => {
      const { text, params } = parseQuery(q);
      for (const plan of state.failPlans) {
        if (plan.remaining > 0 && text.includes(plan.match)) {
          plan.remaining--;
          throw new Error(`fake db: injected failure (${plan.match})`);
        }
      }

      if (text.startsWith("SELECT") && text.includes("FROM branding_orders")) {
        const row = state.rows.get(params[0] as string);
        if (!row) return { rows: [] };
        if (text.includes("user_id =")) {
          // refreshBrandingOrder is user-scoped.
          if (row.user_id !== params[1]) return { rows: [] };
        }
        return { rows: [cloneRow(row)] };
      }

      if (text.startsWith("UPDATE branding_orders")) {
        // markBrandingOrderPaid — params: [stripeSessionId, orderId]
        if (text.includes("SET paid = TRUE")) {
          const row = state.rows.get(params[1] as string);
          if (row && !row.paid) {
            row.paid = true;
            row.stripe_session_id = params[0] as string;
          }
          return { rows: [] };
        }
        // PrintKK per-item progress — params: [itemsJson, orderId, claim]
        if (text.includes("SET items =")) {
          const row = state.rows.get(params[1] as string);
          if (row && row.provider_order_id === params[2]) {
            row.items = JSON.parse(params[0] as string) as FakeItem[];
            return { rows: [{ id: row.id }] };
          }
          return { rows: [] };
        }
        // Final persist — params: [provider, providerOrderId, status, trackingNumber, trackingUrl, orderId, claim]
        if (text.includes("SET provider =")) {
          const row = state.rows.get(params[5] as string);
          if (row && row.provider_order_id === params[6]) {
            row.provider = params[0] as string;
            row.provider_order_id = params[1] as string;
            row.status = params[2] as string;
            row.tracking_number = params[3] as string | null;
            row.tracking_url = params[4] as string | null;
            return { rows: [{ id: row.id }] };
          }
          return { rows: [] };
        }
        // Claim release — params: [orderId, claim]
        if (text.includes("SET provider_order_id = NULL")) {
          const row = state.rows.get(params[0] as string);
          if (row && row.provider_order_id === params[1]) {
            row.provider_order_id = null;
          }
          return { rows: [] };
        }
        // Claim / reclaim — params: [token, orderId] (+ [expectedToken] for reclaim)
        if (text.includes("SET provider_order_id =")) {
          const row = state.rows.get(params[1] as string);
          if (!row) return { rows: [] };
          if (text.includes("provider_order_id IS NULL")) {
            if (row.provider_order_id !== null) return { rows: [] };
          } else if (row.provider_order_id !== params[2]) {
            return { rows: [] };
          }
          row.provider_order_id = params[0] as string;
          return { rows: [{ id: row.id }] };
        }
        // refreshBrandingOrder persist — params: [status, trackingNumber, trackingUrl, orderId]
        if (text.includes("SET status =")) {
          const row = state.rows.get(params[3] as string);
          if (row) {
            row.status = params[0] as string;
            row.tracking_number = params[1] as string | null;
            row.tracking_url = params[2] as string | null;
          }
          return { rows: [] };
        }
      }

      throw new Error(`fake db: unhandled query: ${text}`);
    },
  };

  return {
    state,
    db,
    submitOrder: vi.fn(),
    refreshOrder: vi.fn(),
    confirmPrintfulOrder: vi.fn(),
    printkkConfigured: vi.fn(),
    fulfillRugOrder: vi.fn(),
  };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@workspace/db")>();
  return { ...real, db: h.db };
});

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../printful", async (importOriginal) => {
  const real = await importOriginal<typeof import("../printful")>();
  return {
    ...real,
    submitOrder: h.submitOrder,
    refreshOrder: h.refreshOrder,
    confirmPrintfulOrder: h.confirmPrintfulOrder,
  };
});

vi.mock("../printkk", () => ({
  printkkConfigured: h.printkkConfigured,
  fulfillRugOrder: h.fulfillRugOrder,
  PRINTKK_RUG_PRODUCTS: {
    rectangle: { code: "RUG-RECTANGLE", printAreaCode: "FRONT", sizes: ["3x5 ft"] },
  },
}));

import {
  fulfillBrandingOrder,
  confirmBrandingFulfillment,
  refreshBrandingOrder,
  BrandingFulfillmentInProgressError,
} from "../branding-fulfillment";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "order_1";

type FakeRowT = ReturnType<typeof seedOrder>;

function seedOrder(overrides: Record<string, unknown> = {}) {
  const row = {
    id: ORDER_ID,
    user_id: USER_ID,
    items: [
      {
        product: "tshirt",
        color: "black",
        size: "M",
        qty: 1,
        unitPriceCents: 2500,
        designUrl: "https://cdn.test/design.png",
      },
    ],
    total_cents: 2500,
    name: "Test User",
    email: "test@example.com",
    address: "1 Main St",
    city: "Atlanta",
    state: "GA",
    zip: "30301",
    status: "received",
    provider: "mock",
    provider_order_id: null as string | null,
    paid: true,
    tracking_number: null as string | null,
    tracking_url: null as string | null,
    stripe_session_id: "cs_test_1",
    ...overrides,
  };
  h.state.rows.set(ORDER_ID, row as never);
  return row;
}

function rugItems() {
  return [1, 2, 3].map((qty) => ({
    product: "rug",
    color: "red",
    size: "3x5 ft",
    qty,
    unitPriceCents: 9900,
    designUrl: `https://cdn.test/logo-${qty}.png`,
  }));
}

function failNext(match: string, times = 1) {
  h.state.failPlans.push({ match, remaining: times });
}

function storedRow(): FakeRowT {
  return h.state.rows.get(ORDER_ID) as unknown as FakeRowT;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.rows.clear();
  h.state.failPlans.length = 0;
  // Real fulfillmentMode() reads the env at call time; a key makes the
  // provider value 'printful' while submitOrder itself stays mocked.
  process.env["PRINTFUL_API_KEY"] = "test-key";
  h.printkkConfigured.mockReturnValue(false);
  h.submitOrder.mockResolvedValue({ providerOrderId: "pf_100", status: "pending", mock: false });
  h.refreshOrder.mockResolvedValue({ providerOrderId: "pf_100", status: "pending", mock: false });
  h.confirmPrintfulOrder.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env["PRINTFUL_API_KEY"];
});

describe("fulfillBrandingOrder — order-level claim", () => {
  it("happy path: claims, submits once, persists the real provider id; a second call early-returns", async () => {
    seedOrder();

    const first = await fulfillBrandingOrder(ORDER_ID);
    expect(first).toEqual({
      provider: "printful",
      providerOrderId: "pf_100",
      status: "pending_fulfillment",
    });
    expect(h.submitOrder).toHaveBeenCalledTimes(1);

    const row = storedRow();
    expect(row.provider).toBe("printful");
    expect(row.provider_order_id).toBe("pf_100");
    expect(row.status).toBe("pending_fulfillment");

    const second = await fulfillBrandingOrder(ORDER_ID);
    expect(second).toEqual(first);
    expect(h.submitOrder).toHaveBeenCalledTimes(1);
  });

  it("unknown order: throws not-found and never submits", async () => {
    await expect(fulfillBrandingOrder("order_nope")).rejects.toThrow(
      "Branding order not found: order_nope"
    );
    expect(h.submitOrder).not.toHaveBeenCalled();
  });

  it("concurrent deliveries: exactly one provider submit; the loser observes the live claim", async () => {
    seedOrder();
    let resolveSubmit: ((v: unknown) => void) | undefined;
    h.submitOrder.mockImplementation(
      () => new Promise((res) => { resolveSubmit = res as (v: unknown) => void; })
    );

    const p1 = fulfillBrandingOrder(ORDER_ID);
    await vi.waitFor(() => expect(h.submitOrder).toHaveBeenCalledTimes(1));

    // Second delivery while the winner is mid-submit: the claim is held,
    // so it must refuse rather than submit a duplicate provider order.
    await expect(fulfillBrandingOrder(ORDER_ID)).rejects.toBeInstanceOf(
      BrandingFulfillmentInProgressError
    );
    expect(h.submitOrder).toHaveBeenCalledTimes(1);

    resolveSubmit!({ providerOrderId: "pf_race", status: "pending", mock: false });
    const winner = await p1;
    expect(winner.providerOrderId).toBe("pf_race");
    expect(storedRow().provider_order_id).toBe("pf_race");
    expect(h.submitOrder).toHaveBeenCalledTimes(1);
  });

  it("fresh claim already on the row: refuses without submitting", async () => {
    seedOrder({ provider_order_id: `claim:seeded:${Date.now()}` });

    await expect(fulfillBrandingOrder(ORDER_ID)).rejects.toBeInstanceOf(
      BrandingFulfillmentInProgressError
    );
    expect(h.submitOrder).not.toHaveBeenCalled();
    expect(storedRow().provider_order_id).toMatch(/^claim:/);
  });

  it("crash-after-submit, transient persist failure: internal retry lands it — exactly one provider submit across an outer retry", async () => {
    seedOrder();
    // The provider accepts; the first persist UPDATE fails (DB blip).
    failNext("SET provider =", 1);

    const first = await fulfillBrandingOrder(ORDER_ID);
    expect(first.providerOrderId).toBe("pf_100");
    expect(storedRow().provider_order_id).toBe("pf_100");

    const second = await fulfillBrandingOrder(ORDER_ID);
    expect(second.providerOrderId).toBe("pf_100");
    expect(h.submitOrder).toHaveBeenCalledTimes(1);
  });

  it("crash-after-submit, hard persist failure: claim is HELD (not released, not NULL); immediate retry submits nothing", async () => {
    seedOrder();
    failNext("SET provider =", 99);

    await expect(fulfillBrandingOrder(ORDER_ID)).rejects.toThrow("injected failure");
    expect(h.submitOrder).toHaveBeenCalledTimes(1);

    // The row must hold the claim token — the state the old code could
    // never represent (it would have been NULL → guaranteed resubmit).
    const held = storedRow().provider_order_id;
    expect(held).toMatch(/^claim:/);

    await expect(fulfillBrandingOrder(ORDER_ID)).rejects.toBeInstanceOf(
      BrandingFulfillmentInProgressError
    );
    expect(h.submitOrder).toHaveBeenCalledTimes(1);
  });

  it("stale claim (crashed worker): reclaimed, fulfilled once, persisted", async () => {
    seedOrder({
      provider_order_id: `claim:crashed-worker:${Date.now() - 10 * 60 * 1000}`,
    });

    const result = await fulfillBrandingOrder(ORDER_ID);
    expect(result.providerOrderId).toBe("pf_100");
    expect(h.submitOrder).toHaveBeenCalledTimes(1);
    expect(storedRow().provider_order_id).toBe("pf_100");
    expect(storedRow().status).toBe("pending_fulfillment");
  });
});

describe("fulfillBrandingOrder — PrintKK per-item resume", () => {
  beforeEach(() => {
    h.printkkConfigured.mockReturnValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) }))
    );
  });

  /** fulfillRugOrder stub keyed on quantity: throws for qty in failQtys
      on its FIRST attempt for that qty only. Records every call's qty. */
  function stubRugPipeline(failQtys: number[] = []) {
    const calls: number[] = [];
    const failedOnce = new Set<number>();
    h.fulfillRugOrder.mockImplementation(async (...args: unknown[]) => {
      const qty = args[4] as number;
      calls.push(qty);
      if (failQtys.includes(qty) && !failedOnce.has(qty)) {
        failedOnce.add(qty);
        throw new Error("PrintKK order creation failed: 500");
      }
      return { orderId: `kk_${qty}`, designCode: `dc_${qty}` };
    });
    return calls;
  }

  it("mid-loop crash: retry submits only the missing items", async () => {
    seedOrder({ items: rugItems(), total_cents: 9900 * 6 });
    const calls = stubRugPipeline([2]);

    await expect(fulfillBrandingOrder(ORDER_ID)).rejects.toThrow(
      "PrintKK order creation failed: 500"
    );
    expect(calls).toEqual([1, 2]);

    // Item 1's provider id survived the crash in the items jsonb; the
    // claim was released (the provider call failed), so a retry may run.
    let row = storedRow();
    expect(row.items[0]?.providerOrderId).toBe("kk_1");
    expect(row.items[1]?.providerOrderId).toBeUndefined();
    expect(row.items[2]?.providerOrderId).toBeUndefined();
    expect(row.provider_order_id).toBeNull();

    const result = await fulfillBrandingOrder(ORDER_ID);
    expect(result).toEqual({
      provider: "printkk",
      providerOrderId: "kk_3",
      status: "pending_fulfillment",
    });
    // Item 1 was never resubmitted (or re-paid); only 2 and 3 were.
    expect(calls).toEqual([1, 2, 2, 3]);

    row = storedRow();
    expect(row.provider).toBe("printkk");
    expect(row.provider_order_id).toBe("kk_3");
    expect(row.status).toBe("pending_fulfillment");
    expect(row.items.map((i) => i.providerOrderId)).toEqual(["kk_1", "kk_2", "kk_3"]);
  });

  it("progress-recording failure after the provider accepted an item: claim HELD, immediate retry submits nothing", async () => {
    seedOrder({ items: rugItems(), total_cents: 9900 * 6 });
    const calls = stubRugPipeline();
    failNext("SET items =", 99);

    await expect(fulfillBrandingOrder(ORDER_ID)).rejects.toThrow(
      /PrintKK accepted rug item 0/
    );
    // Exactly one item reached the provider; its recording failed, so
    // the claim stays held instead of being released for a resubmit.
    expect(calls).toEqual([1]);
    expect(storedRow().provider_order_id).toMatch(/^claim:/);

    await expect(fulfillBrandingOrder(ORDER_ID)).rejects.toBeInstanceOf(
      BrandingFulfillmentInProgressError
    );
    expect(calls).toEqual([1]);
  });

  it("resume with every item already recorded: zero provider calls, final state persisted from recorded ids", async () => {
    const items = rugItems().map((i) => ({
      ...i,
      providerOrderId: `kk_${i.qty}`,
      designCode: `dc_${i.qty}`,
    }));
    seedOrder({
      items,
      total_cents: 9900 * 6,
      provider_order_id: `claim:crashed-worker:${Date.now() - 10 * 60 * 1000}`,
    });
    const calls = stubRugPipeline();

    const result = await fulfillBrandingOrder(ORDER_ID);
    expect(result).toEqual({
      provider: "printkk",
      providerOrderId: "kk_3",
      status: "pending_fulfillment",
    });
    expect(calls).toEqual([]);
    expect(storedRow().provider_order_id).toBe("kk_3");
    expect(storedRow().status).toBe("pending_fulfillment");
  });
});

describe("confirmBrandingFulfillment — already-confirmed guard", () => {
  it("pending draft: confirms with the provider (unchanged behavior)", async () => {
    seedOrder({ provider: "printful", provider_order_id: "pf_9", status: "pending_fulfillment" });

    await confirmBrandingFulfillment(ORDER_ID);
    expect(h.confirmPrintfulOrder).toHaveBeenCalledTimes(1);
    expect(h.confirmPrintfulOrder).toHaveBeenCalledWith("pf_9");
  });

  it("already confirmed (production/shipping statuses): no provider call", async () => {
    for (const status of ["in_production", "shipped", "delivered"]) {
      h.state.rows.clear();
      seedOrder({ provider: "printful", provider_order_id: "pf_9", status });
      await confirmBrandingFulfillment(ORDER_ID);
    }
    expect(h.confirmPrintfulOrder).not.toHaveBeenCalled();
  });

  it("terminal states: no provider call", async () => {
    for (const status of ["canceled", "failed"]) {
      h.state.rows.clear();
      seedOrder({ provider: "printful", provider_order_id: "pf_9", status });
      await confirmBrandingFulfillment(ORDER_ID);
    }
    expect(h.confirmPrintfulOrder).not.toHaveBeenCalled();
  });

  it("mock-mode order: no-op, as before", async () => {
    seedOrder({ provider: "mock", provider_order_id: "mock_ord_1", status: "pending_fulfillment" });

    await confirmBrandingFulfillment(ORDER_ID);
    expect(h.confirmPrintfulOrder).not.toHaveBeenCalled();
  });

  it("submission still in flight (claim token, no provider order yet): no provider call", async () => {
    seedOrder({
      provider: "printful",
      provider_order_id: `claim:in-flight:${Date.now()}`,
      status: "received",
    });

    await confirmBrandingFulfillment(ORDER_ID);
    expect(h.confirmPrintfulOrder).not.toHaveBeenCalled();
  });
});

describe("refreshBrandingOrder — claim guard", () => {
  it("claim token is never sent to the provider; reports the stored status", async () => {
    seedOrder({ provider_order_id: `claim:in-flight:${Date.now()}`, status: "received" });

    const result = await refreshBrandingOrder(ORDER_ID, USER_ID);
    expect(result).toEqual({ status: "received", trackingNumber: null, trackingUrl: null });
    expect(h.refreshOrder).not.toHaveBeenCalled();
  });
});
