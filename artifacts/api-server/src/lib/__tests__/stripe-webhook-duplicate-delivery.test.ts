/**
 * stripe-webhook-duplicate-delivery.test.ts — D6, webhook side.
 *
 * Live evidence (Stripe dashboard, Oct 21 2026): several
 * checkout.session.completed deliveries were answered 500
 * "Credit grant failed" even though the credits had landed exactly
 * once. The grant had been won by the other path (dashboard return
 * /checkout/verify) — or by an earlier delivery of the same event —
 * and the losing delivery's insert-first claim collided on
 * stripe_payments' UNIQUE stripe_session_id. The claim was supposed to
 * report "duplicate" (→ 200) but its unique-violation detector checked
 * only `err.code`, while drizzle-orm/node-postgres wraps driver errors
 * in a DrizzleQueryError whose pg error (with the code) sits on
 * `.cause` — so the conflict was rethrown as a hard failure.
 *
 * This suite drives the REAL webhook handler + REAL claim logic over a
 * fake @workspace/db whose insert throws the WRAPPED production error
 * shape on conflict, and pins:
 *
 *   - first delivery: 200 success, exactly one grant, one referral;
 *   - redelivery of the same event (Stripe retry): 200 duplicate,
 *     still exactly one grant and one referral — never a 500;
 *   - verify-won-first (row already completed): the webhook delivery
 *     is a 200 duplicate and grants nothing more.
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
    referralCalls: 0,
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

  /* The production conflict shape: drizzle's DrizzleQueryError —
     message "Failed query: …", pg error (code 23505) on `.cause`,
     no `.code` on the wrapper itself. */
  function wrappedUniqueViolation(): Error {
    const wrapped = new Error(
      'Failed query: insert into "stripe_payments" (...) values (...)\nparams: cs_test_dup',
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
  awardReferralPayout: vi.fn(async () => {
    h.state.referralCalls++;
    return { awarded: false };
  }),
}));

import { stripeWebhookHandler } from "../stripe-webhook";
import { fulfillCreditPurchase } from "../payment-record";

const USER_ID = "1596b9a1-bbd0-4bda-8bf2-a22443e6ace8";
const SESSION_ID = "cs_test_dup_delivery";

function checkoutEvent(sessionId = SESSION_ID) {
  return {
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        payment_status: "paid",
        payment_intent: "pi_dup_delivery",
        amount_total: 900,
        currency: "usd",
        metadata: {
          user_id: USER_ID,
          credit_pack: "1,000 Visual Bucs",
          credits_amount: "1000",
        },
      },
    },
  };
}

function makeRes() {
  const res = {
    statusCode: 0,
    body: undefined as Record<string, unknown> | undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: Record<string, unknown>) {
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

beforeEach(() => {
  h.state.rows.clear();
  h.state.seq = 0;
  h.state.grantCalls = 0;
  h.state.referralCalls = 0;
  h.state.balance = 0;
  h.event = null;
});

describe("checkout.session.completed — duplicate deliveries (D6)", () => {
  it("first delivery grants once and answers 200", async () => {
    const res = await deliver(checkoutEvent());
    expect(res.statusCode).toBe(200);
    expect(res.body?.["success"]).toBe(true);
    expect(h.state.grantCalls).toBe(1);
    expect(h.state.referralCalls).toBe(1);
    expect(h.state.balance).toBe(1000);
  });

  it("redelivery of the same event answers 200 duplicate — never 500, never a second grant", async () => {
    const first = await deliver(checkoutEvent());
    expect(first.statusCode).toBe(200);

    const second = await deliver(checkoutEvent());
    expect(second.statusCode).toBe(200);
    expect(second.body?.["duplicate"]).toBe(true);
    expect(h.state.grantCalls).toBe(1);
    expect(h.state.referralCalls).toBe(1);
    expect(h.state.balance).toBe(1000);

    const third = await deliver(checkoutEvent());
    expect(third.statusCode).toBe(200);
    expect(third.body?.["duplicate"]).toBe(true);
    expect(h.state.grantCalls).toBe(1);
  });

  it("verify won first (row completed): the webhook delivery is a 200 duplicate and grants nothing", async () => {
    // The dashboard return path granted via the same funnel.
    const won = await fulfillCreditPurchase({
      idempotencyKey: SESSION_ID,
      stripePaymentIntentId: "pi_dup_delivery",
      userId: USER_ID,
      creditPack: "1,000 Visual Bucs",
      creditsAmount: 1000,
      amountTotal: 900,
      currency: "usd",
    });
    expect(won.outcome).toBe("granted");
    expect(h.state.grantCalls).toBe(1);

    const res = await deliver(checkoutEvent());
    expect(res.statusCode).toBe(200);
    expect(res.body?.["duplicate"]).toBe(true);
    expect(h.state.grantCalls).toBe(1);
    expect(h.state.balance).toBe(1000);
  });
});
