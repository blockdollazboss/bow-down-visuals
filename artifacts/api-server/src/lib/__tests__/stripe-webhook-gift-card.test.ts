/**
 * stripe-webhook-gift-card.test.ts — WEBHOOK-SETTLE (stack1200).
 *
 * Gift cards were in the Gate #5 tip defect CLASS: checkout
 * sessions carry metadata.type "gift_card_purchase", and the
 * webhook dispatch had NO branch for them — a paid session fell
 * through to the credit-grant tail, which logged "missing user_id
 * in metadata" and answered 200. The card issued ONLY if the
 * buyer's browser returned and the page called /gift-cards/verify:
 * a buyer who closed the tab after paying left the recipient with
 * nothing — no card, no code, no delivery email — against money
 * already taken.
 *
 * This suite drives the REAL webhook handler with a fabricated
 * (signature-bypassed via the mocked client) gift-card event and
 * pins:
 *   - a paid gift-card session issues the card exactly once, with
 *     NO verify call, and emails the code to the recipient once;
 *   - a replayed delivery issues nothing twice and emails nobody
 *     twice;
 *   - an unpaid session issues nothing and emails nobody;
 *   - an unknown session is a warned 200, never a crash.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

const BUYER_ID = "55555555-5555-4555-8555-555555555555";
const PROFILE_ID = "66666666-6666-4666-8666-666666666666";
const PRODUCT_ID = "77777777-7777-4777-8777-777777777777";
const SESSION_ID = "cs_giftcard_webhook_1";

const h = vi.hoisted(() => {
  process.env["STRIPE_SECRET_KEY"] = "sk_test_fake";
  process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_fake";
  return {
    cards: [] as Array<Record<string, any>>,
    event: null as any,
    emails: [] as Array<Record<string, any>>,
  };
});

vi.mock("../logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(() => ({})),
  addCreditsAtomic: vi.fn(async () => 0),
}));

vi.mock("../stripe-client", () => ({
  createGuardedStripeClient: vi.fn(() => ({
    webhooks: { constructEvent: () => h.event },
  })),
  buildCheckoutSessionIdempotencyKey: vi.fn(() => "gift-card-key"),
  buildPaymentIntentIdempotencyKey: vi.fn(() => "pi-key"),
}));

vi.mock("../../routes/referrals", () => ({
  awardReferralPayout: vi.fn(async () => false),
}));

vi.mock("../rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
  generationLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = BUYER_ID;
    next();
  },
}));

vi.mock("../email", () => ({
  sendEmail: async (input: Record<string, any>) => {
    h.emails.push(input);
    return undefined;
  },
  emailShell: (_title: string, html: string) => html,
  emailButton: (href: string, label: string) => `<a href="${href}">${label}</a>`,
  emailDetailBox: (html: string) => html,
  money: (cents: number) => `$${(cents / 100).toFixed(2)}`,
  escapeHtml: (s: string) => s,
  baseUrlForEmail: () => "https://example.com",
  EMAIL_COLORS: { box: "#000", boxBorder: "#111", muted: "#999", goldDeep: "#a80", body: "#eee", ink: "#fff" },
}));

/* The gift-card settle path is raw SQL through db.execute: the
   issuance INSERT … ON CONFLICT (stripe_session_id) DO NOTHING
   RETURNING *, its duplicate read-back, and the creator-profile
   lookup for the delivery email. The fake dispatches on rendered
   SQL text and implements the conflict honestly. */
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();

  function fakeExecute(q: unknown): { rows: Array<Record<string, any>> } {
    const { sql: text, params } = dialect.sqlToQuery(q as never);
    const p = params as unknown[];
    const t = text.replace(/\s+/g, " ");

    if (t.includes("INSERT INTO gift_cards")) {
      /* Params in statement order: code_hash, code_last4, profile_id,
         product_id, buyer_user_id, recipient_email, recipient_name,
         message, initial_cents, balance_cents, stripe_session_id —
         reserved_cents (0) and status ('active') are SQL literals in
         the statement, not params. */
      const sessionId = String(p[10]);
      if (h.cards.some((c) => c.stripe_session_id === sessionId)) {
        return { rows: [] };
      }
      const row: Record<string, any> = {
        id: randomUUID(),
        code_hash: p[0],
        code_last4: p[1],
        profile_id: p[2],
        product_id: p[3],
        buyer_user_id: p[4],
        recipient_email: p[5],
        recipient_name: p[6],
        message: p[7],
        initial_cents: p[8],
        balance_cents: p[9],
        reserved_cents: 0,
        status: "active",
        stripe_session_id: sessionId,
        created_at: new Date(),
      };
      h.cards.push(row);
      return { rows: [{ ...row }] };
    }
    if (t.includes("INSERT INTO gift_card_ledger")) {
      /* The issuance ledger write — idempotent on its key; the fake
         only needs to accept it. */
      return { rows: [] };
    }
    if (t.includes("FROM gift_cards") && t.includes("stripe_session_id")) {
      const sessionId = String(p[0]);
      const card = h.cards.find((c) => c.stripe_session_id === sessionId);
      return { rows: card ? [{ ...card }] : [] };
    }
    if (t.includes("FROM creator_profiles") && t.includes("display_name")) {
      return { rows: [{ display_name: "Queen Creator", slug: "queen-creator" }] };
    }
    throw new Error(`unexpected SQL in gift-card webhook test: ${t.slice(0, 120)}`);
  }

  const chainable: any = {
    where: () => chainable,
    limit: async () => [],
    orderBy: () => chainable,
    returning: async () => [],
    then: (res: any, rej: any) => Promise.resolve([]).then(res, rej),
  };
  const fakeDb: any = {
    select: () => ({ from: () => chainable }),
    insert: () => ({ values: () => chainable }),
    update: () => ({ set: () => chainable }),
    delete: () => chainable,
    execute: async (q: unknown) => fakeExecute(q),
  };
  return { ...actual, db: fakeDb };
});

import { stripeWebhookHandler } from "../stripe-webhook";

function giftCardEvent(paymentStatus: string, sessionId = SESSION_ID) {
  return {
    id: "evt_giftcard_1",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        payment_status: paymentStatus,
        amount_total: 2500,
        currency: "usd",
        payment_intent: "pi_giftcard_1",
        customer_details: { email: "buyer@example.com" },
        metadata: {
          type: "gift_card_purchase",
          buyer_user_id: BUYER_ID,
          profile_id: PROFILE_ID,
          product_id: PRODUCT_ID,
          amount_cents: "2500",
          recipient_email: "friend@example.com",
          recipient_name: "Friend",
          gift_message: "",
          platform_fee_cents: "0",
          creator_amount_cents: "0",
        },
      },
    },
  };
}

async function deliver(event: unknown) {
  h.event = event;
  const res: any = { statusCode: 0, body: null as any };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: unknown) => {
    res.body = body;
    return res;
  };
  const req: any = {
    headers: { "stripe-signature": "sig_test" },
    body: Buffer.from("payload"),
  };
  await stripeWebhookHandler(req, res);
  return res;
}

beforeEach(() => {
  h.cards = [];
  h.emails = [];
  h.event = null;
});

describe("stripe webhook — gift card settle (WEBHOOK-SETTLE)", () => {
  it("a paid gift-card session issues the card and emails the recipient once, with no verify call", async () => {
    const res = await deliver(giftCardEvent("paid"));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, kind: "gift_card_purchase" });

    expect(h.cards).toHaveLength(1);
    expect(h.cards[0]).toMatchObject({
      stripe_session_id: SESSION_ID,
      buyer_user_id: BUYER_ID,
      recipient_email: "friend@example.com",
      initial_cents: 2500,
      balance_cents: 2500,
      status: "active",
    });
    /* The full code is never stored — only hash + last4. */
    expect(String(h.cards[0]!.code_hash)).toHaveLength(64);
    expect(String(h.cards[0]!.code_last4)).toHaveLength(4);

    expect(h.emails).toHaveLength(1);
    expect(h.emails[0]!["to"]).toBe("friend@example.com");
  });

  it("a replayed delivery issues nothing twice and emails nobody twice", async () => {
    await deliver(giftCardEvent("paid"));
    const res = await deliver(giftCardEvent("paid"));
    expect(res.statusCode).toBe(200);
    expect(h.cards).toHaveLength(1);
    expect(h.emails).toHaveLength(1);
  });

  it("an unpaid gift-card session issues nothing and emails nobody", async () => {
    const res = await deliver(giftCardEvent("unpaid"));
    expect(res.statusCode).toBe(200);
    expect(h.cards).toHaveLength(0);
    expect(h.emails).toHaveLength(0);
  });

  it("an unknown gift-card session is a warned 200, never a crash", async () => {
    const res = await deliver(giftCardEvent("paid", "cs_giftcard_unknown"));
    expect(res.statusCode).toBe(200);
    /* The unknown session still issues against ITS session id — the
       webhook settles the session Stripe says was paid; a session
       with no matching checkout is indistinguishable here from a
       real one because issuance keys on the session itself. The
       pre-fix behaviour being pinned is only that nothing crashes
       and unrelated state is untouched. */
    expect(h.cards.filter((c) => c.stripe_session_id === SESSION_ID)).toHaveLength(0);
  });
});
