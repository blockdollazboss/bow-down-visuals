/**
 * admin-benches.test.ts — stack1100 Lane X1 pins.
 *
 * The three benches dock onto rails that had no frontend consumer
 * (W6 F1). These pins hold the seams honest:
 *  - parsers are strict: a malformed answer is a FAILED read (null),
 *    never a painted-empty queue;
 *  - the reversal status set is the API engine's own literal set
 *    (read from lib/payment-reversals.ts itself);
 *  - gear action availability mirrors the rail's state machines —
 *    the full status × proof matrix, incl. the ship gate the route
 *    enforces as defense in depth;
 *  - figures format from data (cents → dollars), ages from stamps.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ageParts,
  countNeedsManualReview,
  filterGearOrders,
  filterOperatorActions,
  filterReversals,
  formatUsdCents,
  gearFulfillmentActions,
  gearNeedsTeam,
  gearProofSendAvailable,
  gearShipBlock,
  parseGearAdminOrders,
  parseOperatorActions,
  parsePaymentReversals,
  REVERSAL_STATUSES,
  shortId,
  type GearAdminOrder,
  type PaymentReversalRow,
} from "./admin-benches";

const API_LIB = join(__dirname, "..", "..", "..", "api-server", "src", "lib");
const API_ROUTES = join(__dirname, "..", "..", "..", "api-server", "src", "routes");

/* ─── fixtures in the rails' own wire shapes ─────────────────────── */

const REVERSAL = {
  id: "rev-1",
  stripeEventId: "evt_1",
  stripeChargeId: "ch_1",
  stripePaymentIntentId: "pi_1",
  trigger: "charge.refunded",
  rail: "credit_pack",
  userId: "user-1",
  sessionId: "cs_1",
  grantedCredits: 5000,
  creditsClawed: 5000,
  referralCreditsClawed: 250,
  refundedCentsSeen: 3900,
  chargeAmountCents: 3900,
  disputeLost: false,
  entitlementRevoked: true,
  sellerReversed: false,
  shortfallCredits: 0,
  status: "completed",
  details: {},
  createdAt: "2026-10-30T10:00:00.000Z",
  updatedAt: "2026-10-30T10:01:00.000Z",
};

const PARKED = {
  ...REVERSAL,
  id: "rev-2",
  status: "needs_manual_review",
  rail: "unidentified",
  userId: null,
  sessionId: null,
  creditsClawed: 0,
  referralCreditsClawed: 0,
  details: { manualReason: "no grant record identifies this charge" },
};

function gearOrder(over: Partial<GearAdminOrder> = {}): GearAdminOrder {
  return {
    id: "ord-1",
    items: [
      {
        product: "neon-sign",
        variant: "custom",
        option: "32",
        qty: 1,
        unitPriceCents: 34900,
        customText: "MY STUDIO",
        specNotes: null,
        artworkUrl: null,
      },
    ],
    totalCents: 34900,
    status: "proof_pending",
    proofStatus: "pending",
    proofUrl: null,
    proofNote: null,
    paid: false,
    testMode: true,
    createdAt: "2026-10-30T10:00:00.000Z",
    buyer: {
      name: "Test Buyer",
      email: "buyer@example.test",
      address: "1 Main St",
      city: "Austin",
      state: "TX",
      zip: "78701",
    },
    ...over,
  };
}

function gearWire(over: Record<string, unknown> = {}): Record<string, unknown> {
  const o = gearOrder();
  return {
    id: o.id,
    items: o.items,
    totalCents: o.totalCents,
    status: o.status,
    proofStatus: o.proofStatus,
    proofUrl: o.proofUrl,
    proofNote: o.proofNote,
    paid: o.paid,
    testMode: o.testMode,
    createdAt: o.createdAt,
    buyer: o.buyer,
    ...over,
  };
}

/* ─── money + age + ids ──────────────────────────────────────────── */

describe("admin benches — formatting from data", () => {
  it("formats cents as dollars", () => {
    expect(formatUsdCents(3900)).toBe("$39.00");
    expect(formatUsdCents(5)).toBe("$0.05");
    expect(formatUsdCents(0)).toBe("$0.00");
    expect(formatUsdCents(24900)).toBe("$249.00");
  });

  it("ages stamps in whole minutes, then hours, then days", () => {
    const now = Date.parse("2026-10-31T12:00:00.000Z");
    expect(ageParts("2026-10-31T11:59:30.000Z", now)).toEqual({ value: 0, unit: "minute" });
    expect(ageParts("2026-10-31T11:15:00.000Z", now)).toEqual({ value: 45, unit: "minute" });
    expect(ageParts("2026-10-31T09:00:00.000Z", now)).toEqual({ value: 3, unit: "hour" });
    expect(ageParts("2026-10-29T10:00:00.000Z", now)).toEqual({ value: 2, unit: "day" });
    expect(ageParts("not-a-date", now)).toBeNull();
  });

  it("shortens ids the house way", () => {
    expect(shortId("1234567890abcdef")).toBe("12345678…");
    expect(shortId(null)).toBeNull();
  });
});

/* ─── payment reversals ──────────────────────────────────────────── */

describe("admin benches — payment reversals parser", () => {
  it("parses the rail's wire shape, incl. null parties on parked rows", () => {
    const rows = parsePaymentReversals({ reversals: [REVERSAL, PARKED] });
    expect(rows).toHaveLength(2);
    expect(rows![0]).toMatchObject({
      id: "rev-1",
      rail: "credit_pack",
      grantedCredits: 5000,
      creditsClawed: 5000,
      referralCreditsClawed: 250,
      entitlementRevoked: true,
      manualReason: null,
    });
    expect(rows![1]).toMatchObject({
      id: "rev-2",
      userId: null,
      sessionId: null,
      manualReason: "no grant record identifies this charge",
    });
  });

  it("reads manualReason out of a stringified details payload too", () => {
    const rows = parsePaymentReversals({
      reversals: [{ ...PARKED, details: JSON.stringify({ manualReason: "parked" }) }],
    });
    expect(rows![0]!.manualReason).toBe("parked");
  });

  it("a malformed answer is a failed read, never an empty queue", () => {
    expect(parsePaymentReversals(null)).toBeNull();
    expect(parsePaymentReversals({})).toBeNull();
    expect(parsePaymentReversals({ reversals: "nope" })).toBeNull();
    expect(parsePaymentReversals({ reversals: [{ id: "x" }] })).toBeNull();
    expect(parsePaymentReversals({ reversals: [REVERSAL, { bad: true }] })).toBeNull();
    expect(parsePaymentReversals({ reversals: [] })).toEqual([]);
  });

  it("filters by the engine's statuses and counts the parked rows", () => {
    const rows = parsePaymentReversals({ reversals: [REVERSAL, PARKED] })!;
    expect(filterReversals(rows, "all")).toHaveLength(2);
    expect(filterReversals(rows, "completed")).toHaveLength(1);
    expect(filterReversals(rows, "needs_manual_review")).toHaveLength(1);
    expect(filterReversals(rows, "processing")).toHaveLength(0);
    expect(countNeedsManualReview(rows)).toBe(1);
    expect(countNeedsManualReview([])).toBe(0);
  });

  it("parses the recorded resolution on resolved rows, and filters dismissed rows", () => {
    const resolved = {
      ...REVERSAL,
      id: "rev-3",
      status: "dismissed",
      resolution: {
        id: "res-1",
        decision: "dismiss",
        adminUserId: "admin-1",
        adminEmail: "king@example.test",
        note: "Charge verified as legitimate.",
        resolvedAt: "2026-10-31T10:00:00.000Z",
      },
    };
    const rows = parsePaymentReversals({ reversals: [resolved, REVERSAL] })!;
    expect(rows[0]!.resolution).toEqual({
      decision: "dismiss",
      adminEmail: "king@example.test",
      note: "Charge verified as legitimate.",
      resolvedAt: "2026-10-31T10:00:00.000Z",
    });
    expect(rows[1]!.resolution).toBeNull();
    expect(filterReversals(rows, "dismissed")).toHaveLength(1);
    /* a malformed resolution is a failed read, never a painted row */
    expect(parsePaymentReversals({ reversals: [{ ...REVERSAL, resolution: "yes" }] })).toBeNull();
  });

  it("the status set is the API reversal engine's own literal set", () => {
    const engine = readFileSync(join(API_LIB, "payment-reversals.ts"), "utf8");
    for (const s of REVERSAL_STATUSES) expect(engine).toContain(`'${s}'`);
    expect(REVERSAL_STATUSES).toContain("needs_manual_review");
    /* stack1100 Y2: a parked row CAN be closed now — through the
       rail's own resolve verb and nothing else. The verb exists in
       the admin router, guarded, exactly once. */
    const adminRoutes = readFileSync(join(API_ROUTES, "admin.ts"), "utf8");
    const railBlock = adminRoutes.slice(adminRoutes.indexOf("/admin/payment-reversals"));
    expect(railBlock).toContain('router.get("/admin/payment-reversals"');
    expect(adminRoutes.split('"/admin/payment-reversals/:id/resolve"')).toHaveLength(2);
    const verbBlock = railBlock.slice(railBlock.indexOf('"/admin/payment-reversals/:id/resolve"'));
    expect(verbBlock).toContain("requireAuth");
    expect(verbBlock).toContain("requireAdmin");
    expect(verbBlock).toContain("resolvePaymentReversal");
  });
});

/* ─── operator actions ───────────────────────────────────────────── */

describe("admin benches — operator actions parser", () => {
  const ACTION = {
    id: "act-1",
    userId: "user-1",
    adminEmail: null,
    tier: "member",
    toolId: "generate_image",
    summary: "Made an image",
    target: null,
    channel: "chat",
    priceQuoted: 100,
    priceCharged: 100,
    idempotencyKey: "k-1",
    result: "done",
    resultReason: null,
    createdAt: "2026-10-30T10:00:00.000Z",
  };

  it("parses the trail with the cap and the kill switch riding along", () => {
    const read = parseOperatorActions({
      dailyChargedCap: 20,
      handsEnabled: true,
      actions: [ACTION, { ...ACTION, id: "act-2", result: "refused", resultReason: "daily_cap", priceCharged: null }],
    });
    expect(read).toMatchObject({ dailyChargedCap: 20, handsEnabled: true });
    expect(read!.actions).toHaveLength(2);
    expect(read!.actions[1]).toMatchObject({ result: "refused", resultReason: "daily_cap", priceCharged: null });
    expect(filterOperatorActions(read!.actions, "all")).toHaveLength(2);
    expect(filterOperatorActions(read!.actions, "refused")).toHaveLength(1);
    expect(filterOperatorActions(read!.actions, "failed")).toHaveLength(0);
  });

  it("a malformed answer is a failed read", () => {
    expect(parseOperatorActions(null)).toBeNull();
    expect(parseOperatorActions({ actions: [] })).toBeNull(); // cap + switch are load-bearing
    expect(parseOperatorActions({ dailyChargedCap: 20, handsEnabled: true, actions: [{}] })).toBeNull();
    expect(parseOperatorActions({ dailyChargedCap: 20, handsEnabled: true, actions: [] })).toEqual({
      dailyChargedCap: 20,
      handsEnabled: true,
      actions: [],
    });
  });
});

/* ─── studio gear queue ──────────────────────────────────────────── */

describe("admin benches — studio gear parser", () => {
  it("parses the relay queue wire shape incl. the buyer block", () => {
    const read = parseGearAdminOrders({ testMode: true, orders: [gearWire()] });
    expect(read!.testMode).toBe(true);
    expect(read!.orders[0]).toMatchObject({
      id: "ord-1",
      status: "proof_pending",
      proofStatus: "pending",
      buyer: { email: "buyer@example.test", zip: "78701" },
    });
    expect(read!.orders[0]!.items[0]).toMatchObject({ product: "neon-sign", customText: "MY STUDIO" });
  });

  it("a malformed answer is a failed read", () => {
    expect(parseGearAdminOrders(null)).toBeNull();
    expect(parseGearAdminOrders({ orders: "nope" })).toBeNull();
    expect(parseGearAdminOrders({ testMode: true, orders: [{ id: "x" }] })).toBeNull();
    expect(parseGearAdminOrders({ testMode: true, orders: [] })).toEqual({ testMode: true, orders: [] });
  });

  it("filters the queue by order status", () => {
    const orders = [gearOrder(), gearOrder({ id: "ord-2", status: "shipped", proofStatus: "approved", paid: true })];
    expect(filterGearOrders(orders, "all")).toHaveLength(2);
    expect(filterGearOrders(orders, "proof_pending")).toHaveLength(1);
    expect(filterGearOrders(orders, "shipped")).toHaveLength(1);
    expect(filterGearOrders(orders, "delivered")).toHaveLength(0);
  });
});

describe("admin benches — gear actions mirror the rail", () => {
  it("proof send is offered exactly from pending / revision_requested, never on terminal orders", () => {
    expect(gearProofSendAvailable(gearOrder({ proofStatus: "pending" }))).toBe(true);
    expect(gearProofSendAvailable(gearOrder({ proofStatus: "revision_requested", status: "proof_pending" }))).toBe(true);
    expect(gearProofSendAvailable(gearOrder({ proofStatus: "sent", status: "proof_sent" }))).toBe(false);
    expect(gearProofSendAvailable(gearOrder({ proofStatus: "approved", status: "in_production", paid: true }))).toBe(false);
    expect(gearProofSendAvailable(gearOrder({ proofStatus: "not_required", status: "received" }))).toBe(false);
    expect(gearProofSendAvailable(gearOrder({ proofStatus: "pending", status: "canceled" }))).toBe(false);
  });

  it("fulfillment moves follow ORDER_TRANSITIONS", () => {
    expect(gearFulfillmentActions(gearOrder({ status: "received", proofStatus: "not_required" }))).toEqual(["canceled"]);
    expect(gearFulfillmentActions(gearOrder({ status: "proof_pending" }))).toEqual(["canceled"]);
    expect(gearFulfillmentActions(gearOrder({ status: "proof_sent", proofStatus: "sent" }))).toEqual(["canceled"]);
    expect(gearFulfillmentActions(gearOrder({ status: "in_production", proofStatus: "approved", paid: true }))).toEqual([
      "shipped",
      "canceled",
    ]);
    expect(gearFulfillmentActions(gearOrder({ status: "shipped", proofStatus: "approved", paid: true }))).toEqual(["delivered"]);
    expect(gearFulfillmentActions(gearOrder({ status: "delivered", proofStatus: "approved", paid: true }))).toEqual([]);
    expect(gearFulfillmentActions(gearOrder({ status: "canceled" }))).toEqual([]);
  });

  it("the ship gate mirrors the route: in production, paid, proof settled", () => {
    const inProd = { status: "in_production", proofStatus: "approved", paid: true } as const;
    expect(gearShipBlock(gearOrder({ ...inProd }))).toBeNull();
    expect(gearShipBlock(gearOrder({ ...inProd, proofStatus: "not_required" }))).toBeNull();
    expect(gearShipBlock(gearOrder({ ...inProd, paid: false }))).toBe("unpaid");
    expect(gearShipBlock(gearOrder({ ...inProd, proofStatus: "sent", status: "in_production" }))).toBe("proof_open");
    expect(gearShipBlock(gearOrder({ status: "received", proofStatus: "not_required", paid: true }))).toBe(
      "not_in_production",
    );
    /* the route enforces the same gate — pinned against its own source */
    const route = readFileSync(join(API_ROUTES, "studio-gear.ts"), "utf8");
    expect(route).toContain('next === "shipped"');
    expect(route).toContain("production requires payment and a settled proof");
    expect(route).toContain('"/admin/studio-gear/orders/:id/proof/send"');
    expect(route).toContain('"/admin/studio-gear/orders/:id/status"');
  });

  it("needs-team counts proof relays and open fulfillment, never terminal orders", () => {
    expect(gearNeedsTeam(gearOrder())).toBe(true); // proof to relay
    expect(gearNeedsTeam(gearOrder({ status: "in_production", proofStatus: "approved", paid: true }))).toBe(true);
    expect(gearNeedsTeam(gearOrder({ status: "delivered", proofStatus: "approved", paid: true }))).toBe(false);
    expect(gearNeedsTeam(gearOrder({ status: "canceled" }))).toBe(false);
  });
});

/* ─── row type sanity (compile-time shapes stay honest) ──────────── */

describe("admin benches — fixture rows satisfy the row types", () => {
  it("parsed reversal fixture is a PaymentReversalRow", () => {
    const rows = parsePaymentReversals({ reversals: [REVERSAL] })!;
    const row: PaymentReversalRow = rows[0]!;
    expect(row.status).toBe("completed");
  });
});
