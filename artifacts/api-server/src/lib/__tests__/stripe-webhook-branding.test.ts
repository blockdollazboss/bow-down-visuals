/**
 * stripe-webhook-branding.test.ts — insert-first claiming for the Stripe
 * webhook's branding-order branch.
 *
 * The credit path got claim-before-grant in the P0-7/P0-9/P0-24 hardening
 * (fulfillCreditPurchase → claimStripePayment). The branding branch kept
 * the old shape: fulfill FIRST (markBrandingOrderPaid →
 * fulfillBrandingOrder → confirmBrandingFulfillment) and record the
 * payment LAST via a plain recordStripePayment INSERT. Its only duplicate
 * guard was fulfillBrandingOrder's check-then-act on provider_order_id:
 *  - concurrent redeliveries could both read provider_order_id = NULL and
 *    both submit a real provider order (Printful POST /orders);
 *  - sequential redeliveries re-ran the unconditional provider confirm
 *    POST and then threw on stripe_payments' UNIQUE stripe_session_id —
 *    a 500 loop, never a clean no-op.
 *
 * The branch now claims the stripe_payments row BEFORE any fulfillment
 * (same claimStripePayment, keyed on the session id, creditsAmount 0,
 * creditPack `branding_order:<id>` — the values the old trailing insert
 * wrote). These tests drive the REAL handler + REAL claim logic over a
 * fake @workspace/db (real schema tables, swapped db handle) with the
 * Stripe constructor, Supabase admin, and branding-fulfillment mocked:
 *
 *  - first delivery: claim → fulfill once → payment row 'completed';
 *  - duplicate delivery after success: 200 {duplicate:true}, fulfillment
 *    functions NOT re-run;
 *  - fresh in-flight claim (concurrent worker): 500, nothing fulfilled;
 *  - stale in-flight claim (crashed worker): reclaimed, fulfilled, 200;
 *  - fulfillment throws: claim marked 'failed' + 500, and Stripe's retry
 *    reclaims the failed row and fulfills exactly one successful pass;
 *  - claim itself fails (DB error): fail closed — 500, no fulfillment.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── Hoisted fake @workspace/db ──────────────────────────────────────────
   Only the chains payment-record's claim flow uses:
     db.insert(stripePaymentsTable).values(row)          (claim + record)
     db.select({status, createdAt}).from(...).where().limit(1)
     db.update(...).set({status}).where(...) [.returning({id})]
   The where conditions are real drizzle expressions over the REAL table
   objects, so the fake extracts their bound params (session id, status
   literals, stale cutoff) by walking the SQL chunk graph. */
const h = vi.hoisted(() => {
  interface PaymentRow {
    id: string;
    stripeSessionId: string;
    stripePaymentIntentId: string | null;
    userId: string;
    creditPack: string | null;
    creditsAmount: number;
    amountTotal: number | null;
    currency: string | null;
    status: string;
    createdAt: Date;
  }
  const state = {
    rows: new Map<string, PaymentRow>(),
    insertThrows: false,
    seq: 0,
  };

  function extractParams(node: unknown): { strings: string[]; dates: Date[] } {
    const out = { strings: [] as string[], dates: [] as Date[] };
    const seen = new Set<unknown>();
    const walk = (n: unknown): void => {
      if (!n || typeof n !== "object" || seen.has(n)) return;
      seen.add(n);
      if (n instanceof Date) {
        out.dates.push(n);
        return;
      }
      for (const v of Object.values(n as Record<string, unknown>)) {
        if (typeof v === "string") out.strings.push(v);
        else if (v instanceof Date) out.dates.push(v);
        else if (v && typeof v === "object") walk(v);
      }
    };
    walk(node);
    return out;
  }

  function sessionIdFrom(cond: unknown): string | undefined {
    const { strings } = extractParams(cond);
    return strings.find((s) => state.rows.has(s)) ?? strings.find((s) => s.startsWith("cs_"));
  }

  const db = {
    insert: (_table: unknown) => ({
      values: async (vals: Record<string, unknown>) => {
        if (state.insertThrows) throw new Error("db down (fake)");
        const sid = vals["stripeSessionId"] as string;
        if (state.rows.has(sid)) {
          throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
        }
        state.rows.set(sid, {
          id: `pay_${++state.seq}`,
          stripeSessionId: sid,
          stripePaymentIntentId: (vals["stripePaymentIntentId"] as string | null) ?? null,
          userId: vals["userId"] as string,
          creditPack: (vals["creditPack"] as string | null) ?? null,
          creditsAmount: vals["creditsAmount"] as number,
          amountTotal: (vals["amountTotal"] as number | null) ?? null,
          currency: (vals["currency"] as string | null) ?? null,
          status: vals["status"] as string,
          createdAt: new Date(),
        });
        return [];
      },
    }),
    select: (_fields?: unknown) => ({
      from: (_table: unknown) => ({
        where: (cond: unknown) => ({
          limit: async (_n: number) => {
            const sid = sessionIdFrom(cond);
            const row = sid ? state.rows.get(sid) : undefined;
            return row ? [row] : [];
          },
        }),
      }),
    }),
    update: (_table: unknown) => ({
      set: (setValues: Record<string, unknown>) => ({
        where: (cond: unknown) => {
          const sid = sessionIdFrom(cond);
          const row = sid ? state.rows.get(sid) : undefined;
          let matched: PaymentRow | undefined;
          if (row) {
            const { strings, dates } = extractParams(cond);
            const isReclaim = strings.includes("failed") && strings.includes("processing") && dates.length > 0;
            const applies = isReclaim
              ? row.status === "failed" ||
                (row.status === "processing" && row.createdAt < dates[0]!)
              : true;
            if (applies) {
              Object.assign(row, setValues);
              matched = row;
            }
          }
          const p = Promise.resolve(matched ? [matched] : []) as Promise<PaymentRow[]> & {
            returning: (_f?: unknown) => Promise<Array<{ id: string }>>;
          };
          p.returning = async () => (matched ? [{ id: matched.id }] : []);
          return p;
        },
      }),
    }),
  };

  return { state, db, event: null as unknown };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@workspace/db")>();
  return { ...real, db: h.db };
});

vi.mock("stripe", () => ({
  default: class FakeStripe {
    webhooks = {
      constructEvent: () => h.event,
    };
  },
}));

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(() => ({})),
  addCreditsAtomic: vi.fn(),
}));

vi.mock("../../routes/referrals", () => ({
  awardReferralPayout: vi.fn(async () => ({ awarded: false })),
}));

vi.mock("../branding-fulfillment", () => ({
  markBrandingOrderPaid: vi.fn(async () => {}),
  fulfillBrandingOrder: vi.fn(async () => ({
    provider: "mock",
    providerOrderId: "mock_order_1",
    status: "pending_fulfillment",
  })),
  confirmBrandingFulfillment: vi.fn(async () => {}),
}));

import { stripeWebhookHandler } from "../stripe-webhook";
import {
  markBrandingOrderPaid,
  fulfillBrandingOrder,
  confirmBrandingFulfillment,
} from "../branding-fulfillment";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "order_1";
const SESSION_ID = "cs_test_branding_1";

function brandingEvent(sessionId = SESSION_ID, orderId = ORDER_ID) {
  return {
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        payment_status: "paid",
        payment_intent: "pi_branding_1",
        amount_total: 12900,
        currency: "usd",
        metadata: { user_id: USER_ID, kind: "branding_order", branding_order_id: orderId },
      },
    },
  };
}

function makeRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

async function deliver(event: unknown) {
  h.event = event;
  const res = makeRes();
  await stripeWebhookHandler(
    { headers: { "stripe-signature": "sig_test" }, body: Buffer.from("{}") } as never,
    res as never,
  );
  return res;
}

function seedRow(status: string, createdAt: Date, sessionId = SESSION_ID) {
  h.state.rows.set(sessionId, {
    id: "pay_seed",
    stripeSessionId: sessionId,
    stripePaymentIntentId: "pi_branding_1",
    userId: USER_ID,
    creditPack: `branding_order:${ORDER_ID}`,
    creditsAmount: 0,
    amountTotal: 12900,
    currency: "usd",
    status,
    createdAt,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.rows.clear();
  h.state.insertThrows = false;
  h.state.seq = 0;
  process.env["STRIPE_SECRET_KEY"] = "sk_test_fake";
  process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_fake";
  // clearAllMocks wipes the factory implementations above; restore them.
  vi.mocked(fulfillBrandingOrder).mockResolvedValue({
    provider: "mock",
    providerOrderId: "mock_order_1",
    status: "pending_fulfillment",
  });
  vi.mocked(markBrandingOrderPaid).mockResolvedValue(undefined);
  vi.mocked(confirmBrandingFulfillment).mockResolvedValue(undefined);
});

describe("stripe webhook — branding order branch claiming", () => {
  it("first delivery: claims first, fulfills once, payment row ends completed", async () => {
    const order: string[] = [];
    vi.mocked(markBrandingOrderPaid).mockImplementation(async () => { order.push("markPaid"); });
    vi.mocked(fulfillBrandingOrder).mockImplementation(async () => {
      order.push("fulfill");
      return { provider: "mock", providerOrderId: "mock_order_1", status: "pending_fulfillment" };
    });
    vi.mocked(confirmBrandingFulfillment).mockImplementation(async () => { order.push("confirm"); });

    const res = await deliver(brandingEvent());

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true, success: true, brandingOrderId: ORDER_ID });
    expect(order).toEqual(["markPaid", "fulfill", "confirm"]);
    expect(markBrandingOrderPaid).toHaveBeenCalledWith(ORDER_ID, SESSION_ID);

    const row = h.state.rows.get(SESSION_ID);
    expect(row).toBeDefined();
    expect(row!.status).toBe("completed");
    expect(row!.creditPack).toBe(`branding_order:${ORDER_ID}`);
    expect(row!.creditsAmount).toBe(0);
    expect(row!.stripePaymentIntentId).toBe("pi_branding_1");
    expect(row!.amountTotal).toBe(12900);
    expect(row!.userId).toBe(USER_ID);
  });

  it("duplicate delivery after success: 200 no-op, fulfillment NOT re-run", async () => {
    const first = await deliver(brandingEvent());
    expect(first.statusCode).toBe(200);

    const second = await deliver(brandingEvent());
    expect(second.statusCode).toBe(200);
    expect(second.body).toEqual({ received: true, duplicate: true });

    expect(markBrandingOrderPaid).toHaveBeenCalledTimes(1);
    expect(fulfillBrandingOrder).toHaveBeenCalledTimes(1);
    expect(confirmBrandingFulfillment).toHaveBeenCalledTimes(1);
    expect(h.state.rows.size).toBe(1);
    expect(h.state.rows.get(SESSION_ID)!.status).toBe("completed");
  });

  it("fresh in-flight claim: 500 and nothing is fulfilled", async () => {
    seedRow("processing", new Date());

    const res = await deliver(brandingEvent());

    expect(res.statusCode).toBe(500);
    expect(markBrandingOrderPaid).not.toHaveBeenCalled();
    expect(fulfillBrandingOrder).not.toHaveBeenCalled();
    expect(confirmBrandingFulfillment).not.toHaveBeenCalled();
    expect(h.state.rows.get(SESSION_ID)!.status).toBe("processing");
  });

  it("stale in-flight claim (crashed worker): reclaimed and fulfilled", async () => {
    seedRow("processing", new Date(Date.now() - 10 * 60 * 1000));

    const res = await deliver(brandingEvent());

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true, success: true, brandingOrderId: ORDER_ID });
    expect(fulfillBrandingOrder).toHaveBeenCalledTimes(1);
    expect(h.state.rows.get(SESSION_ID)!.status).toBe("completed");
  });

  it("fulfillment failure: claim marked failed + 500; retry reclaims and fulfills exactly one successful pass", async () => {
    vi.mocked(fulfillBrandingOrder)
      .mockRejectedValueOnce(new Error("provider submit exploded"))
      .mockResolvedValue({ provider: "mock", providerOrderId: "mock_order_1", status: "pending_fulfillment" });

    const first = await deliver(brandingEvent());
    expect(first.statusCode).toBe(500);
    expect(h.state.rows.get(SESSION_ID)!.status).toBe("failed");
    expect(confirmBrandingFulfillment).not.toHaveBeenCalled();

    const second = await deliver(brandingEvent());
    expect(second.statusCode).toBe(200);
    expect(second.body).toEqual({ received: true, success: true, brandingOrderId: ORDER_ID });
    expect(fulfillBrandingOrder).toHaveBeenCalledTimes(2); // one throw + one success
    expect(confirmBrandingFulfillment).toHaveBeenCalledTimes(1);
    expect(h.state.rows.get(SESSION_ID)!.status).toBe("completed");
  });

  it("claim failure (DB error): fail closed — 500, no fulfillment attempted", async () => {
    h.state.insertThrows = true;

    const res = await deliver(brandingEvent());

    expect(res.statusCode).toBe(500);
    expect(markBrandingOrderPaid).not.toHaveBeenCalled();
    expect(fulfillBrandingOrder).not.toHaveBeenCalled();
    expect(confirmBrandingFulfillment).not.toHaveBeenCalled();
    expect(h.state.rows.size).toBe(0);
  });
});
