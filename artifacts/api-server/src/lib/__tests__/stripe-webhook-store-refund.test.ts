/**
 * stripe-webhook-store-refund.test.ts — the digital store's
 * auto-refund at the webhook door (stack900).
 *
 * The gap: /store/verify was the ONLY refund trigger for a paid
 * purchase whose item turned undeliverable — a buyer who never
 * returned stranded their money. The webhook now asks the store's
 * own probe (routes/store.ts isStoreSessionAutoRefundDue, REAL here)
 * on checkout.session.completed and fires the SAME refund helper
 * verify's rail uses (lib/stripe-checkout refundCheckoutSessionPayment,
 * REAL here). Both paths key the Stripe refund `refund:<sessionId>`
 * — verify's inline create in routes/store.ts uses that identical
 * literal — so the exactly-once guarantee lives in the shared key.
 *
 * The fake Stripe below honors that contract the way Stripe does:
 * a repeat create under a seen idempotency key returns the original
 * refund and creates NOTHING. `refundCreations` therefore counts
 * real money movements, and the ordering tests (webhook-first /
 * verify-first, the verify half driven through the real helper)
 * assert it never exceeds one.
 *
 * The fake @workspace/db dispatches db.execute on the rendered SQL
 * text (the store suites' established style): the probe's sale check
 * reads a hoisted sales set; the item resolution reads a hoisted
 * track row (absent = deleted after payment).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const BUYER_ID = "33333333-3333-4333-8333-333333333333";
const TRACK_ID = "55555555-5555-4555-8555-555555555555";

const h = vi.hoisted(() => ({
  event: null as unknown,
  /* The catalog row resolveSellableItem sees; null = deleted. */
  trackRow: null as Record<string, unknown> | null,
  /* Session ids with a recorded digital_sales row (verify fulfilled). */
  soldSessions: new Set<string>(),
  probeThrows: false,
  queries: [] as string[],
  refundCalls: [] as Array<{ params: unknown; options: unknown }>,
  refundsByKey: new Map<string, { id: string }>(),
  refundCreations: 0,
  /* The buyer tell (join item J1): the claim gate's landed keys and
     every notification call the branch makes. */
  jobNotifClaims: new Set<string>(),
  jobNotifCalls: [] as Array<Record<string, unknown>>,
  userEvents: [] as Array<Record<string, unknown>>,
}));

const dialect = new PgDialect();

vi.mock("@workspace/db", async (importOriginal) => {
  const real = await importOriginal<typeof import("@workspace/db")>();
  const db = {
    execute: async (q: unknown) => {
      const { sql: text, params } = dialect.sqlToQuery(q as never) as {
        sql: string;
        params: unknown[];
      };
      h.queries.push(text);
      if (text.includes("FROM digital_sales") && text.includes("stripe_session_id")) {
        const sessionId = String(params[0]);
        return { rows: h.soldSessions.has(sessionId) ? [{ id: "sale_1" }] : [] };
      }
      if (text.includes("profile_tracks")) {
        if (h.probeThrows) throw new Error("fake db: connection lost");
        return { rows: h.trackRow ? [h.trackRow] : [] };
      }
      return { rows: [] };
    },
  };
  return { ...real, db };
});

vi.mock("stripe", () => ({
  default: class FakeStripe {
    webhooks = {
      constructEvent: () => h.event,
    };
    refunds = {
      create: async (params: { payment_intent: string }, options?: { idempotencyKey?: string }) => {
        h.refundCalls.push({ params, options });
        const key = options?.idempotencyKey;
        if (key && h.refundsByKey.has(key)) return h.refundsByKey.get(key);
        const refund = { id: `re_${h.refundCreations + 1}` };
        if (key) h.refundsByKey.set(key, refund);
        h.refundCreations += 1;
        return refund;
      },
    };
    charges = { retrieve: async () => ({}) };
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

/* routes/store.ts neighbours the probe never exercises — stubbed so
   the real store module's import graph stays light (the store
   suites' own pattern). */
vi.mock("../../routes/generate/storefronts", () => ({
  STOREFRONT_PLATFORM_FEE_BPS: 500,
}));

vi.mock("../job-notifications", () => ({
  /* The UNIQUE(job_type, job_id) gate, faked faithfully: the first
     claim for a key lands (true), every later one does not (false). */
  createJobNotification: vi.fn(
    async (input: { jobType: string; jobId: string }) => {
      h.jobNotifCalls.push(input as Record<string, unknown>);
      const key = `${input.jobType}:${input.jobId}`;
      if (h.jobNotifClaims.has(key)) return false;
      h.jobNotifClaims.add(key);
      return true;
    },
  ),
}));

vi.mock("../push-events", () => ({
  notifyUserEvent: vi.fn(async (input: Record<string, unknown>) => {
    h.userEvents.push(input);
    return { bellLanded: true, push: null, pushSkippedReason: null };
  }),
}));

vi.mock("../objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
}));

vi.mock("../email", () => ({
  sendEmail: vi.fn(async () => undefined),
  emailShell: (inner: string) => inner,
  emailButton: (href: string, label: string) => `<a href="${href}">${label}</a>`,
  emailDetailBox: (html: string) => html,
  money: (cents: number) => `$${(cents / 100).toFixed(2)}`,
  escapeHtml: (s: string) => s,
  baseUrlForEmail: () => "http://localhost",
}));

import { stripeWebhookHandler } from "../stripe-webhook";
import { refundCheckoutSessionPayment } from "../stripe-checkout";
import { logger } from "../logger";

function deliverableTrackRow() {
  return {
    id: TRACK_ID,
    profile_id: PROFILE_ID,
    title: "Midnight Run",
    download_price_cents: 1000,
    is_published: true,
    pwyw_enabled: false,
    pwyw_min_cents: 0,
    file_url: "https://cdn.example.com/midnight-run.mp3",
    artwork_url: null,
    artist_name: "Queen Creator",
    artist_slug: "queen-creator",
  };
}

function storeSession(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    payment_status: "paid",
    amount_total: 1050,
    currency: "usd",
    payment_intent: "pi_store_1",
    metadata: {
      buyer_user_id: BUYER_ID,
      profile_id: PROFILE_ID,
      item_kind: "track",
      item_id: TRACK_ID,
      platform_fee_cents: "50",
      creator_amount_cents: "1000",
      gift_card_reservation_id: "",
      gift_card_applied_cents: "0",
      bump_item_kind: "",
      bump_item_id: "",
      bump_amount_cents: "0",
    },
    ...over,
  };
}

function completedEvent(object: Record<string, unknown>) {
  return {
    id: `evt_${Math.random().toString(36).slice(2, 10)}`,
    type: "checkout.session.completed",
    data: { object },
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
  h.trackRow = deliverableTrackRow();
  h.soldSessions.clear();
  h.probeThrows = false;
  h.queries = [];
  h.refundCalls = [];
  h.refundsByKey.clear();
  h.refundCreations = 0;
  h.jobNotifClaims.clear();
  h.jobNotifCalls = [];
  h.userEvents = [];
  process.env["STRIPE_SECRET_KEY"] = "sk_test_fake";
  process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_fake";
});

describe("checkout.session.completed — digital store auto-refund", () => {
  it("deliverable item → NO refund; the session is left to verify", async () => {
    const res = await deliver(completedEvent(storeSession("cs_store_ok")));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, kind: "digital_store" });
    expect(h.refundCalls).toHaveLength(0);
    expect(h.refundCreations).toBe(0);
  });

  it("item deleted after payment → exactly one refund, keyed refund:<sessionId> against the session's payment intent", async () => {
    h.trackRow = null;
    const res = await deliver(completedEvent(storeSession("cs_store_gone")));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, kind: "digital_store", refunded: true });
    expect(h.refundCreations).toBe(1);
    expect(h.refundCalls).toHaveLength(1);
    expect(h.refundCalls[0]!.params).toMatchObject({ payment_intent: "pi_store_1" });
    expect(h.refundCalls[0]!.options).toMatchObject({ idempotencyKey: "refund:cs_store_gone" });
  });

  it("item unpublished after payment → exactly one refund", async () => {
    h.trackRow = { ...deliverableTrackRow(), is_published: false };
    const res = await deliver(completedEvent(storeSession("cs_store_unpub")));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ refunded: true });
    expect(h.refundCreations).toBe(1);
  });

  it("webhook first, then verify's refund attempt → still exactly one refund", async () => {
    h.trackRow = null;
    const session = storeSession("cs_store_order_a");
    const res = await deliver(completedEvent(session));
    expect(res.body).toMatchObject({ refunded: true });
    expect(h.refundCreations).toBe(1);
    /* Verify lands second and reaches its own refund branch — through
       the real helper, under the shared key (verify's inline create
       in routes/store.ts uses the identical `refund:<sessionId>`). */
    const verifyRefunded = await refundCheckoutSessionPayment(session as never);
    expect(verifyRefunded).toBe(true);
    expect(h.refundCreations).toBe(1);
  });

  it("verify first, then the webhook → still exactly one refund", async () => {
    h.trackRow = null;
    const session = storeSession("cs_store_order_b");
    /* The buyer returned first: verify's refund already landed. */
    const verifyRefunded = await refundCheckoutSessionPayment(session as never);
    expect(verifyRefunded).toBe(true);
    expect(h.refundCreations).toBe(1);
    const res = await deliver(completedEvent(session));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ kind: "digital_store", refunded: true });
    expect(h.refundCreations).toBe(1);
  });

  it("a replayed webhook event → no second refund", async () => {
    h.trackRow = null;
    const event = completedEvent(storeSession("cs_store_replay"));
    const first = await deliver(event);
    expect(first.body).toMatchObject({ refunded: true });
    const replay = await deliver(event);
    expect(replay.statusCode).toBe(200);
    expect(replay.body).toMatchObject({ refunded: true });
    expect(h.refundCreations).toBe(1);
  });

  it("sale already recorded by verify, item since deleted → NO refund (never refund a delivered purchase)", async () => {
    h.trackRow = null;
    h.soldSessions.add("cs_store_sold");
    const res = await deliver(completedEvent(storeSession("cs_store_sold")));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, kind: "digital_store" });
    expect(h.refundCreations).toBe(0);
  });

  it("probe failure (DB down) → no refund, no 500, logged loudly — verify still owns the session", async () => {
    h.probeThrows = true;
    const res = await deliver(completedEvent(storeSession("cs_store_probe_fail")));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ kind: "digital_store", warning: "auto-refund probe failed" });
    expect(h.refundCreations).toBe(0);
    expect(vi.mocked(logger.error).mock.calls.some((c) => String(c[1] ?? "").includes("auto-refund probe failed"))).toBe(true);
  });

  it("an unpaid store session never reaches the probe or the refund", async () => {
    h.trackRow = null;
    const res = await deliver(completedEvent(storeSession("cs_store_unpaid", { payment_status: "unpaid" })));
    expect(res.statusCode).toBe(200);
    expect(h.queries.some((q) => q.includes("profile_tracks"))).toBe(false);
    expect(h.refundCreations).toBe(0);
  });

  it("a storefront session (product_id, no item metadata) is untouched by the branch", async () => {
    const res = await deliver(
      completedEvent({
        id: "cs_storefront_1",
        payment_status: "paid",
        amount_total: 2500,
        currency: "usd",
        payment_intent: "pi_storefront_1",
        metadata: {
          type: "storefront_purchase",
          buyer_user_id: BUYER_ID,
          profile_id: PROFILE_ID,
          product_id: "44444444-4444-4444-8444-444444444444",
          product_kind: "digital",
        },
      }),
    );
    expect(res.statusCode).toBe(200);
    /* Falls through to the legacy flow exactly as before this lane. */
    expect(res.body).toMatchObject({ received: true, warning: "Missing user_id in metadata" });
    expect(h.queries.some((q) => q.includes("profile_tracks"))).toBe(false);
    expect(h.refundCreations).toBe(0);
  });

  /* ── The buyer tell (stack900 join — L4 join item J1) ──────────────
     The auto-refund exists for the buyer who never came back; until
     this item they were never told. The tell rides the refund's own
     idempotency key space through the job-notifications UNIQUE gate:
     jobType "sale", jobId refund:<sessionId> — claimed at most once,
     and only a landed claim fires the bell/push. */
  it("buyer tell: a webhook refund tells the buyer once, on the money channel, naming the item by kind when its row is gone", async () => {
    h.trackRow = null;
    const res = await deliver(completedEvent(storeSession("cs_store_tell_gone")));
    expect(res.body).toMatchObject({ refunded: true });
    expect(h.jobNotifCalls).toHaveLength(1);
    expect(h.jobNotifCalls[0]).toMatchObject({
      jobType: "sale",
      jobId: "refund:cs_store_tell_gone",
      userId: BUYER_ID,
      status: "completed",
      title: "Your payment was refunded",
    });
    expect(String(h.jobNotifCalls[0]!["message"])).toContain("Your track is no longer for sale");
    expect(h.userEvents).toHaveLength(1);
    expect(h.userEvents[0]).toMatchObject({
      userId: BUYER_ID,
      category: "money",
      kind: "refund",
      title: "Your payment was refunded",
      link: "/library",
    });
    expect(String(h.userEvents[0]!["body"])).toContain("refunded in full");
  });

  it("buyer tell: an unpublished item is named by its title", async () => {
    h.trackRow = { ...deliverableTrackRow(), is_published: false };
    const res = await deliver(completedEvent(storeSession("cs_store_tell_named")));
    expect(res.body).toMatchObject({ refunded: true });
    expect(h.userEvents).toHaveLength(1);
    expect(String(h.userEvents[0]!["body"])).toContain("“Midnight Run” is no longer for sale");
  });

  it("buyer tell: a replayed webhook event never tells twice (the claim gate, not the refund result, decides)", async () => {
    h.trackRow = null;
    const event = completedEvent(storeSession("cs_store_tell_replay"));
    await deliver(event);
    await deliver(event);
    /* refundCheckoutSessionPayment answered true BOTH times (the
       idempotent replay) — yet the tell fired exactly once, because
       the second claim did not land. */
    expect(h.jobNotifCalls).toHaveLength(2);
    expect(h.userEvents).toHaveLength(1);
  });

  it("buyer tell: no refund, no tell — deliverable purchase and sold session stay silent", async () => {
    const ok = await deliver(completedEvent(storeSession("cs_store_tell_ok")));
    expect(ok.body).toMatchObject({ kind: "digital_store" });
    h.trackRow = null;
    h.soldSessions.add("cs_store_tell_sold");
    const sold = await deliver(completedEvent(storeSession("cs_store_tell_sold")));
    expect(sold.body).toMatchObject({ kind: "digital_store" });
    expect(h.jobNotifCalls).toHaveLength(0);
    expect(h.userEvents).toHaveLength(0);
  });

  it("a session with no store metadata at all is untouched by the branch", async () => {
    const res = await deliver(
      completedEvent({
        id: "cs_other_1",
        payment_status: "paid",
        amount_total: 500,
        currency: "usd",
        payment_intent: "pi_other_1",
        metadata: {},
      }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ received: true, warning: "Missing user_id in metadata" });
    expect(h.refundCreations).toBe(0);
  });
});
