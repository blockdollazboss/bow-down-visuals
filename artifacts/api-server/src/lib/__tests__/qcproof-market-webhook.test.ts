/**
 * qcproof-market-webhook.test.ts — QC-200 Q147 residual: the
 * marketplace-shop branch of the central Stripe webhook.
 *
 * Ledger claim: the webhook applies a marketplace sale ONLY when the
 * amount Stripe collected equals the server-computed gross of the
 * pending shop_events lines; otherwise it refuses (warned 200, no
 * flip). The flip itself (markMarketSalePaid) is proven against real
 * rows in qcproof-market-sale.test.ts and market-checkout.test.ts;
 * here the REAL webhook handler runs with the market-sale module
 * spied, pinning the amount gate at the door: match -> flip attempted
 * once; mismatch -> flip never attempted; no pending lines -> no flip.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  process.env["STRIPE_SECRET_KEY"] = "sk_test_fake";
  process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_fake";

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
    seq: 0,
    grantCalls: 0,
    referralCalls: [] as Array<{ userId: string; credits: number; key: string }>,
    marketRows: [] as Array<{ amount_cents: number }>,
    paidCalls: [] as string[],
    balance: 0,
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
    return (
      strings.find((s) => state.rows.has(s)) ??
      strings.find((s) => s.startsWith("cs_") || s.startsWith("pi_"))
    );
  }

  function wrappedUniqueViolation(): Error {
    const wrapped = new Error(
      'Failed query: insert into "stripe_payments" (...) values (...)\nparams: pi_test_gateproof',
    ) as Error & { cause?: unknown };
    wrapped.cause = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "stripe_payments_stripe_session_id_key"',
      ),
      { code: "23505" },
    );
    return wrapped;
  }

  const db = {
    insert: (_table: unknown) => ({
      values: async (vals: Record<string, unknown>) => {
        const sid = vals["stripeSessionId"] as string;
        if (state.rows.has(sid)) throw wrappedUniqueViolation();
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
            const isReclaim =
              strings.includes("failed") && strings.includes("processing") && dates.length > 0;
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

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(() => ({})),
  addCreditsAtomic: vi.fn(async (_userId: string, amount: number) => {
    h.state.grantCalls++;
    h.state.balance += amount;
    return { newCredits: h.state.balance };
  }),
}));

vi.mock("../stripe-client", () => ({
  createGuardedStripeClient: vi.fn(() => ({
    webhooks: { constructEvent: () => h.event },
  })),
  buildCheckoutSessionIdempotencyKey: vi.fn(() => "k"),
}));

vi.mock("../market-sale", () => ({
  fetchMarketSaleBySession: vi.fn(async () => h.state.marketRows),
  markMarketSalePaid: vi.fn(async (sid: string) => { h.state.paidCalls.push(sid); return { flipped: h.state.marketRows.length, rows: h.state.marketRows }; }),
  markMarketSaleExpired: vi.fn(async () => {}),
}));

vi.mock("../../routes/referrals", () => ({
  awardReferralPayout: vi.fn(async (userId: string, credits: number, key: string) => {
    h.state.referralCalls.push({ userId, credits, key });
    return 0;
  }),
}));

import { stripeWebhookHandler } from "../stripe-webhook";
import { fulfillCreditPurchase } from "../payment-record";
const USER_ID2 = "2596b9a1-bbd0-4bda-8bf2-a22443e6ace8";
void USER_ID2;

function marketEvent(sessionId: string, amountTotal: number) {
  return {
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        payment_status: "paid",
        payment_intent: `pi_for_${sessionId}`,
        amount_total: amountTotal,
        currency: "usd",
        metadata: { type: "marketplace_shop_purchase", shop_id: "shop_qc", checkout_group_id: "grp_qc" },
      },
    },
  };
}

function makeRes() {
  const res = {
    statusCode: 0,
    body: undefined as Record<string, unknown> | undefined,
    status(code: number) { res.statusCode = code; return res; },
    json(body: Record<string, unknown>) { res.body = body; return res; },
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

beforeEach(() => {
  h.state.rows.clear();
  h.state.seq = 0;
  h.state.grantCalls = 0;
  h.state.referralCalls = [];
  h.state.balance = 0;
  h.state.marketRows = [{ amount_cents: 4000 }, { amount_cents: 500 }];
  h.state.paidCalls = [];
  h.event = null;
});

describe("Q147 marketplace webhook — amount gate", () => {
  it("amount equals the server-computed gross (4,500): the paid flip is attempted once for the session", async () => {
    const res = await deliver(marketEvent("cs_qc_market_1", 4500));
    expect(res.statusCode).toBe(200);
    expect(res.body?.["kind"]).toBe("marketplace_shop_purchase");
    expect(h.state.paidCalls).toEqual(["cs_qc_market_1"]);
  });

  it("amount does NOT equal the gross (9,999 or 4,499): the flip is NEVER attempted and nothing is granted", async () => {
    for (const bad of [9999, 4499]) {
      const res = await deliver(marketEvent("cs_qc_market_1", bad));
      expect(res.statusCode).toBe(200);
    }
    expect(h.state.paidCalls).toEqual([]);
    expect(h.state.grantCalls).toBe(0);
  });

  it("no pending lines for the session: no flip attempted", async () => {
    h.state.marketRows = [];
    const res = await deliver(marketEvent("cs_qc_market_unknown", 4500));
    expect(res.statusCode).toBe(200);
    expect(h.state.paidCalls).toEqual([]);
  });
});
