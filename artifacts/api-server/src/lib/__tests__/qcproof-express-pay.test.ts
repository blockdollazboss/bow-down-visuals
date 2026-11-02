/**
 * qcproof-express-pay.test.ts — QC-200 Q142 behavioural pins for the
 * Express Pay rail (Apple Pay / Google Pay, routes/express-pay.ts).
 *
 * Ledger claim: verify and the payment_intent.succeeded webhook share
 * ONE grant via fulfillCreditPurchase keyed on the PI id, so a buyer
 * whose tab closes after the charge still gets their Bucs, and a
 * replay never double-grants. Before this suite the express branch of
 * the webhook had only source-string coverage (stripe-guards) and a
 * mocked-fulfill route test (referral-award-verify); the REAL claim /
 * grant logic is driven here through the REAL webhook handler over
 * the same fake-db harness as stripe-webhook-credit-pack-gateproof
 * (insert throws the wrapped production 23505 shape). The verify door
 * is simulated by the exact fulfillCreditPurchase call
 * POST /payments/express/verify makes (routes/express-pay.ts) — the
 * house pattern for verify/webhook race proofs.
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

vi.mock("../../routes/referrals", () => ({
  awardReferralPayout: vi.fn(async (userId: string, credits: number, key: string) => {
    h.state.referralCalls.push({ userId, credits, key });
    return 0;
  }),
}));

import { stripeWebhookHandler } from "../stripe-webhook";
import { fulfillCreditPurchase } from "../payment-record";
const USER_ID = "1596b9a1-bbd0-4bda-8bf2-a22443e6ace8";

function expressPiEvent(piId: string, credits = 15000, amountCents = 9900, label = "15,000 Visual Bucs") {
  return {
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: piId,
        amount: amountCents,
        currency: "usd",
        metadata: {
          source: "express_pay",
          user_id: USER_ID,
          credit_pack: label,
          credits_amount: String(credits),
          pack_key: "150",
        },
      },
    },
  };
}

function expressVerifyFulfill(piId: string, credits = 15000, amountCents = 9900, label = "15,000 Visual Bucs") {
  return fulfillCreditPurchase({
    idempotencyKey: piId,
    stripePaymentIntentId: piId,
    userId: USER_ID,
    creditPack: label,
    creditsAmount: credits,
    amountTotal: amountCents,
    currency: "usd",
  });
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
  h.event = null;
});

describe("Q142 express pay — payment_intent.succeeded (tab-close rail)", () => {
  it("webhook ALONE grants exactly the pack's VB once — no verify call needed after a tab close", async () => {
    const res = await deliver(expressPiEvent("pi_qc_express_1"));
    expect(res.statusCode).toBe(200);
    expect(res.body?.["success"]).toBe(true);
    expect(res.body?.["credits"]).toBe(15000);
    expect(h.state.grantCalls).toBe(1);
    expect(h.state.balance).toBe(15000);
    expect(h.state.referralCalls).toEqual([
      { userId: USER_ID, credits: 15000, key: "pi_qc_express_1" },
    ]);
  });

  it("REPLAY: the same PI event delivered twice more is a 200 duplicate — balance and referral attempts unchanged", async () => {
    await deliver(expressPiEvent("pi_qc_express_1"));
    for (let i = 0; i < 2; i++) {
      const replay = await deliver(expressPiEvent("pi_qc_express_1"));
      expect(replay.statusCode).toBe(200);
      expect(replay.body?.["duplicate"]).toBe(true);
    }
    expect(h.state.balance).toBe(15000);
    expect(h.state.grantCalls).toBe(1);
    expect(h.state.referralCalls).toHaveLength(1);
  });

  it("verify won first: the webhook delivery is a duplicate and grants nothing more", async () => {
    const won = await expressVerifyFulfill("pi_qc_express_1");
    expect(won.outcome).toBe("granted");
    const res = await deliver(expressPiEvent("pi_qc_express_1"));
    expect(res.statusCode).toBe(200);
    expect(res.body?.["duplicate"]).toBe(true);
    expect(h.state.grantCalls).toBe(1);
    expect(h.state.balance).toBe(15000);
  });

  it("webhook won first: verify's fulfill is a duplicate and grants nothing more", async () => {
    await deliver(expressPiEvent("pi_qc_express_1"));
    const verify = await expressVerifyFulfill("pi_qc_express_1");
    expect(verify.outcome).toBe("duplicate");
    expect(h.state.grantCalls).toBe(1);
    expect(h.state.balance).toBe(15000);
  });

  it("a different express pack grants its exact amount (1,000 VB / $9)", async () => {
    const res = await deliver(expressPiEvent("pi_qc_express_small", 1000, 900, "1,000 Visual Bucs"));
    expect(res.statusCode).toBe(200);
    expect(res.body?.["credits"]).toBe(1000);
    expect(h.state.balance).toBe(1000);
  });

  it("a PI that is neither express_pay nor an embedded credit pack grants nothing", async () => {
    const res = await deliver({
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_qc_other", amount: 900, currency: "usd", metadata: { source: "something_else", user_id: USER_ID, credits_amount: "1000" } } },
    });
    expect(res.statusCode).toBe(200);
    expect(h.state.grantCalls).toBe(0);
    expect(h.state.balance).toBe(0);
  });
});
