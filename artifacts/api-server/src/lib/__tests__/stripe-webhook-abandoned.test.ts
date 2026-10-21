/**
 * stripe-webhook-abandoned.test.ts — the abandoned-checkout wiring
 * (migration 0204) at the webhook door.
 *
 * The store + storefront card checkouts write nothing when a checkout
 * starts, so a fan who never pays leaves exactly one trace: the
 * checkout.session.expired event Stripe delivers here. These tests
 * drive the REAL handler into the REAL recorder
 * (lib/email-automations) over a minimal fake @workspace/db that
 * honors the abandoned_checkouts session-unique law:
 *
 *  - an expired storefront / digital-store session is filed once and
 *    answered kind=abandoned_checkout;
 *  - a replayed event files nothing twice (the recorder's
 *    ON CONFLICT DO NOTHING) and still answers 200;
 *  - a paid session in an expiry event records nothing;
 *  - a marketplace expiry keeps its own branch (pending lines
 *    labelled expired) and never reaches the recorder — the shop
 *    pending rows already see it, a second record would double-fire.
 *
 * Stripe signature verification is stubbed the same way as
 * stripe-webhook-branding.test.ts (constructEvent returns the
 * fixture); market-sale is spied, everything else is the real code.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── Hoisted fake @workspace/db ──────────────────────────────────────
   Only the chain the recorder uses:
     db.insert(abandonedCheckoutsTable).values(row)
       .onConflictDoNothing().returning()
   honoring the 0204 unique law on stripe_session_id. (The recorder
   is the only inserter on this path — the insert is identified by
   the stripeSessionId its values always carry.) Any other db use on
   this path throws: the expired branches under test must not touch
   anything else. */
const h = vi.hoisted(() => {
  const rows = new Map<string, Record<string, unknown>>();
  const db = {
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            const key = v["stripeSessionId"];
            if (typeof key !== "string") throw new Error("fake db: unexpected insert (no session id)");
            if (rows.has(key)) return [];
            const row = { id: `rec_${rows.size + 1}`, ...v };
            rows.set(key, row);
            return [row];
          },
        }),
      }),
    }),
    select: () => {
      throw new Error("fake db: unexpected select");
    },
    update: () => {
      throw new Error("fake db: unexpected update");
    },
    execute: async () => ({ rows: [] }),
  };
  return { rows, db, event: null as unknown };
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

vi.mock("../market-sale", () => ({
  fetchMarketSaleBySession: vi.fn(async () => []),
  markMarketSalePaid: vi.fn(async () => ({ flipped: 0, rows: [] })),
  markMarketSaleExpired: vi.fn(async () => {}),
}));

/* The recorder is real; its send-path neighbours are never exercised
   by recording, and are stubbed so the import graph stays light. */
vi.mock("../stripe-connect", () => ({
  getUserEmail: vi.fn(async () => null),
}));

vi.mock("../email", () => ({
  isEmailConfigured: vi.fn(() => false),
  sendEmail: vi.fn(async () => ({ ok: false })),
  baseUrlForEmail: vi.fn(() => "http://localhost"),
}));

import { stripeWebhookHandler } from "../stripe-webhook";
import { markMarketSaleExpired } from "../market-sale";

const PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const BUYER_ID = "33333333-3333-4333-8333-333333333333";

function expiredEvent(object: Record<string, unknown>) {
  return { id: `evt_${Math.random().toString(36).slice(2, 10)}`, type: "checkout.session.expired", data: { object } };
}

function storefrontSession(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    payment_status: "unpaid",
    amount_total: 2500,
    currency: "usd",
    metadata: {
      type: "storefront_purchase",
      buyer_user_id: BUYER_ID,
      profile_id: PROFILE_ID,
      product_id: "44444444-4444-4444-8444-444444444444",
    },
    ...over,
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

beforeEach(() => {
  vi.clearAllMocks();
  h.rows.clear();
  process.env["STRIPE_SECRET_KEY"] = "sk_test_fake";
  process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_fake";
});

describe("checkout.session.expired — abandoned store/storefront checkouts", () => {
  it("files an expired storefront checkout once and answers kind=abandoned_checkout", async () => {
    const res = await deliver(expiredEvent(storefrontSession("cs_test_ab_1")));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, kind: "abandoned_checkout", expired: true });
    expect(h.rows.size).toBe(1);
    expect(h.rows.get("cs_test_ab_1")).toMatchObject({
      stripeSessionId: "cs_test_ab_1",
      rail: "storefront",
      profileId: PROFILE_ID,
      buyerUserId: BUYER_ID,
      amountCents: 2500,
    });
    expect(markMarketSaleExpired).not.toHaveBeenCalled();
  });

  it("files an expired digital-store checkout (no type marker, item metadata)", async () => {
    const res = await deliver(
      expiredEvent({
        id: "cs_test_ab_2",
        payment_status: "unpaid",
        amount_total: 900,
        currency: "usd",
        metadata: {
          buyer_user_id: BUYER_ID,
          profile_id: PROFILE_ID,
          item_kind: "track",
          item_id: "55555555-5555-4555-8555-555555555555",
          platform_fee_cents: "45",
          creator_amount_cents: "855",
        },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, kind: "abandoned_checkout" });
    expect(h.rows.get("cs_test_ab_2")).toMatchObject({ rail: "store", profileId: PROFILE_ID, buyerUserId: BUYER_ID });
  });

  it("a replayed event files nothing twice and still answers 200", async () => {
    const event = expiredEvent(storefrontSession("cs_test_ab_3"));
    const first = await deliver(event);
    expect(first.statusCode).toBe(200);
    expect(first.body).toMatchObject({ kind: "abandoned_checkout" });
    const replay = await deliver(event);
    expect(replay.statusCode).toBe(200);
    expect(h.rows.size).toBe(1);
  });

  it("records nothing for a paid session riding an expiry event", async () => {
    const res = await deliver(expiredEvent(storefrontSession("cs_test_ab_4", { payment_status: "paid" })));
    expect(res.statusCode).toBe(200);
    expect(h.rows.size).toBe(0);
  });

  it("keeps marketplace expiries on their own branch — the recorder never sees them", async () => {
    const res = await deliver(
      expiredEvent({
        id: "cs_test_ab_5",
        payment_status: "unpaid",
        amount_total: 5000,
        currency: "usd",
        metadata: { type: "marketplace_shop_purchase", shop_id: "shop_1", checkout_group_id: "g_1" },
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, kind: "marketplace_shop_purchase", expired: true });
    expect(markMarketSaleExpired).toHaveBeenCalledWith("cs_test_ab_5");
    expect(h.rows.size).toBe(0);
  });
});
