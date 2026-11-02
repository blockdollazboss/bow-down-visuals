/**
 * stripe-webhook-credit-pack-gateproof.test.ts — Gate #5 pre-proof,
 * credit-pack purchase idempotency / replay family.
 *
 * What was already proven on this tree before this suite (census):
 *  - stripe-webhook-duplicate-delivery.test.ts: the HOSTED
 *    checkout.session.completed rail grants 1,000 VB once, a replayed
 *    delivery is a 200 duplicate, and a session the verify path
 *    completed first is a duplicate for the webhook.
 *  - payment-reversals.test.ts (pg-mem): refund/dispute clawback of a
 *    pack grant — exact, pro-rata, shortfall, referral leg, replay.
 *  - referral-chain.test.ts: the REAL awardReferralPayout pays 25%
 *    (250 of 1,000) exactly once per session.
 *  - embedded-checkout.test.ts: SOURCE-CONTRACT only — it asserts the
 *    embedded (on-site PaymentElement) routes/webhook branch contain
 *    the right strings, but never executes a payment_intent.succeeded
 *    delivery.
 *
 * The gap this suite closes — BEHAVIOURAL proof for the rail a buyer
 * actually rides today (on-site embedded checkout, PaymentIntent):
 *  1. payment_intent.succeeded for an embedded credit pack grants
 *     EXACTLY the pack's VB, once (5,000 VB pack used as the witness);
 *  2. REPLAY: the same PI event delivered again (and again) is a 200
 *     duplicate — balance identical, grant count 1, referral award
 *     attempted exactly once;
 *  3. verify + webhook both fire for the same PI (the embedded verify
 *     route calls fulfillCreditPurchase with idempotencyKey = pi.id,
 *     the identical call simulated here, exactly as
 *     stripe-webhook-duplicate-delivery simulates the hosted verify):
 *     whichever lands second is a duplicate, total granted = once;
 *  4. two DIFFERENT PIs / sessions for the SAME user both credit —
 *     idempotency is per-purchase, never per-user;
 *  5. the full pack table (PACK_MAP in routes/stripe-payments.ts and
 *     routes/embedded-checkout.ts, prices in
 *     artifacts/bow-down-visuals/src/lib/pricing-plans.ts):
 *     1,000 VB/$9, 5,000/$39, 15,000/$99, 50,000/$249 — each pack
 *     granted exactly its VB amount through the session rail.
 *
 * Harness: the same fake @workspace/db as
 * stripe-webhook-duplicate-delivery.test.ts — insert throws the
 * WRAPPED production unique-violation shape (DrizzleQueryError, pg
 * code 23505 on .cause) so the real claim logic runs against the
 * real conflict shape. addCreditsAtomic and awardReferralPayout are
 * counted spies (their own exactly-once behaviour is proven in
 * referral-chain / payment-reversals against real stores).
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

/* The embedded (on-site) pack purchase: a 5,000 VB pack at $39. */
function embeddedPiEvent(piId: string, credits = 5000, amountCents = 3900) {
  return {
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: piId,
        amount: amountCents,
        currency: "usd",
        metadata: {
          source: "embedded_checkout",
          kind: "credit_pack",
          user_id: USER_ID,
          credit_pack: "5,000 Visual Bucs",
          credits_amount: String(credits),
        },
      },
    },
  };
}

function checkoutEvent(sessionId: string, credits: number, amountCents: number, label: string) {
  return {
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        payment_status: "paid",
        payment_intent: `pi_for_${sessionId}`,
        amount_total: amountCents,
        currency: "usd",
        metadata: {
          user_id: USER_ID,
          credit_pack: label,
          credits_amount: String(credits),
        },
      },
    },
  };
}

/* The exact fulfill call POST /embedded-checkout/credit-pack/verify
   makes (routes/embedded-checkout.ts): keyed on the PI id. */
function embeddedVerifyFulfill(piId: string, credits = 5000, amountCents = 3900) {
  return fulfillCreditPurchase({
    idempotencyKey: piId,
    stripePaymentIntentId: piId,
    userId: USER_ID,
    creditPack: "5,000 Visual Bucs",
    creditsAmount: credits,
    amountTotal: amountCents,
    currency: "usd",
  });
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
  h.state.referralCalls = [];
  h.state.balance = 0;
  h.event = null;
});

describe("embedded credit pack — payment_intent.succeeded (Gate #5 packs)", () => {
  it("first delivery grants EXACTLY the pack's 5,000 VB, once, and attempts the referral share once", async () => {
    const res = await deliver(embeddedPiEvent("pi_gate_pack_1"));
    expect(res.statusCode).toBe(200);
    expect(res.body?.["success"]).toBe(true);
    expect(res.body?.["credits"]).toBe(5000);
    expect(h.state.grantCalls).toBe(1);
    expect(h.state.balance).toBe(5000);
    expect(h.state.referralCalls).toEqual([
      { userId: USER_ID, credits: 5000, key: "pi_gate_pack_1" },
    ]);
  });

  it("REPLAY: the same PI event delivered twice more credits nothing — balance identical, no second referral attempt", async () => {
    await deliver(embeddedPiEvent("pi_gate_pack_1"));
    const balanceAfterFirst = h.state.balance;

    for (let i = 0; i < 2; i++) {
      const replay = await deliver(embeddedPiEvent("pi_gate_pack_1"));
      expect(replay.statusCode).toBe(200);
      expect(replay.body?.["duplicate"]).toBe(true);
    }
    expect(h.state.balance).toBe(balanceAfterFirst);
    expect(h.state.balance).toBe(5000);
    expect(h.state.grantCalls).toBe(1);
    expect(h.state.referralCalls).toHaveLength(1);
  });

  it("verify won first: the webhook PI delivery is a duplicate and grants nothing more", async () => {
    const won = await embeddedVerifyFulfill("pi_gate_pack_1");
    expect(won.outcome).toBe("granted");
    expect(h.state.balance).toBe(5000);

    const res = await deliver(embeddedPiEvent("pi_gate_pack_1"));
    expect(res.statusCode).toBe(200);
    expect(res.body?.["duplicate"]).toBe(true);
    expect(h.state.grantCalls).toBe(1);
    expect(h.state.balance).toBe(5000);
  });

  it("webhook won first: the verify path's fulfill is a duplicate and grants nothing more", async () => {
    const res = await deliver(embeddedPiEvent("pi_gate_pack_1"));
    expect(res.statusCode).toBe(200);
    expect(h.state.balance).toBe(5000);

    const verify = await embeddedVerifyFulfill("pi_gate_pack_1");
    expect(verify.outcome).toBe("duplicate");
    expect(h.state.grantCalls).toBe(1);
    expect(h.state.balance).toBe(5000);
  });

  it("two DIFFERENT PIs for the same user both credit — idempotency is per-purchase, not per-user", async () => {
    const a = await deliver(embeddedPiEvent("pi_gate_pack_a", 5000, 3900));
    expect(a.statusCode).toBe(200);
    const b = await deliver(embeddedPiEvent("pi_gate_pack_b", 1000, 900));
    expect(b.statusCode).toBe(200);
    expect(b.body?.["success"]).toBe(true);
    expect(h.state.grantCalls).toBe(2);
    expect(h.state.balance).toBe(6000);
    /* Each distinct purchase attempts its own referral share, keyed
       on its own PI — the real payout's UNIQUE(stripe_session_id)
       then pays each exactly once (proven in referral-chain). */
    expect(h.state.referralCalls.map((c) => c.key)).toEqual(["pi_gate_pack_a", "pi_gate_pack_b"]);
  });
});

describe("hosted session rail — per-session idempotency across the pack table", () => {
  it("two DIFFERENT sessions for the same user both credit", async () => {
    const a = await deliver(checkoutEvent("cs_gate_a", 1000, 900, "1,000 Visual Bucs"));
    expect(a.statusCode).toBe(200);
    const b = await deliver(checkoutEvent("cs_gate_b", 15000, 9900, "15,000 Visual Bucs"));
    expect(b.statusCode).toBe(200);
    expect(b.body?.["success"]).toBe(true);
    expect(h.state.grantCalls).toBe(2);
    expect(h.state.balance).toBe(16000);
  });

  it("every pack in the table grants EXACTLY its VB amount (1,000/$9 · 5,000/$39 · 15,000/$99 · 50,000/$249)", async () => {
    const packs = [
      { session: "cs_gate_pack_10", credits: 1000, cents: 900, label: "1,000 Visual Bucs" },
      { session: "cs_gate_pack_50", credits: 5000, cents: 3900, label: "5,000 Visual Bucs" },
      { session: "cs_gate_pack_150", credits: 15000, cents: 9900, label: "15,000 Visual Bucs" },
      { session: "cs_gate_pack_500", credits: 50000, cents: 24900, label: "50,000 Visual Bucs" },
    ];
    let expected = 0;
    for (const p of packs) {
      const res = await deliver(checkoutEvent(p.session, p.credits, p.cents, p.label));
      expect(res.statusCode).toBe(200);
      expect(res.body?.["success"]).toBe(true);
      expected += p.credits;
      expect(h.state.balance).toBe(expected);
      /* A replay of this pack's session moves nothing before the
         next pack is bought. */
      const replay = await deliver(checkoutEvent(p.session, p.credits, p.cents, p.label));
      expect(replay.body?.["duplicate"]).toBe(true);
      expect(h.state.balance).toBe(expected);
    }
    expect(h.state.grantCalls).toBe(4);
    expect(h.state.balance).toBe(71000);
  });
});
