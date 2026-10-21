/**
 * Paid Series (0192) — the MONEY side: series unlocks ride the existing
 * digital store rail (routes/store.ts), unchanged in discipline:
 *   - the creator's typed price_cents is the only price; the platform fee
 *     is the store rail's own 5% knob (STOREFRONT_PLATFORM_FEE_BPS = 500),
 *     split server-side into the Stripe session metadata;
 *   - checkout is idempotent (deterministic key) and refuses a second
 *     purchase while a completed unlock exists — ALREADY_OWNED, no new
 *     session — while a refunded sale never blocks a re-buy;
 *   - verify records the sale through the rail's ON CONFLICT
 *     (stripe_session_id) insert, so a double verify still yields ONE
 *     sale, and mints NO download link — the sale itself unlocks;
 *   - if the series stops being deliverable between payment and verify,
 *     the rail's existing auto-refund fires untouched;
 *   - the buyer lands in the creator's audience surfaces for free: the
 *     purchases + sales dashboards read digital_sales, so series rows
 *     appear with no forked code.
 *
 * Fake-db style mirrors store-pwyw.test.ts (db.execute dispatched on the
 * rendered SQL text) with the Stripe package mocked at the boundary.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";

process.env["STRIPE_SECRET_KEY"] = "sk_test_fake_series";

const CREATOR_USER = "20000000-0000-4000-8000-0000000000c1";
const BUYER_USER = "20000000-0000-4000-8000-0000000000b1";
const CREATOR_PROFILE = "11111111-1111-4111-8111-111111111111";
const SERIES_ID = "31313131-3131-4131-8131-313131313131";
const SALE_ID = "41414141-4141-4141-8141-414141414141";

const h = vi.hoisted(() => ({
  series: {
    priceCents: 1999 as number | null,
    isPublic: true,
    kind: "series",
  },
  sales: [] as Array<Record<string, any>>,
  nextSale: 1,
  stripe: {
    createCalls: [] as Array<{ params: any; options: any }>,
    refundCalls: [] as Array<{ params: any; options: any }>,
    session: null as any,
    sessionId: "cs_test_checkout_series",
  },
}));

const dialect = new PgDialect();

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const user = req.headers["x-test-user"];
    if (typeof user !== "string" || !user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    req.userId = user;
    next();
  },
  optionalAuth: (req: any, _res: any, next: any) => next(),
}));

vi.mock("../generate/storefronts", () => ({
  STOREFRONT_PLATFORM_FEE_BPS: 500,
}));

vi.mock("../../lib/job-notifications", () => ({
  createJobNotification: vi.fn(async () => undefined),
}));

vi.mock("../../lib/email", () => ({
  sendEmail: vi.fn(async () => undefined),
  emailShell: (inner: string) => inner,
  money: (cents: number) => `$${(cents / 100).toFixed(2)}`,
  escapeHtml: (s: string) => s,
  baseUrlForEmail: () => "https://bowdownvisuals.test",
}));

vi.mock("../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: async (v: unknown) => v,
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/logger", () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

vi.mock("stripe", () => ({
  default: class FakeStripe {
    checkout = {
      sessions: {
        create: async (params: any, options: any) => {
          h.stripe.createCalls.push({ params, options });
          return { id: h.stripe.sessionId, url: "https://checkout.stripe.test/pay" };
        },
        retrieve: async (_id: string) => h.stripe.session,
      },
    };
    refunds = {
      create: async (params: any, options: any) => {
        h.stripe.refundCalls.push({ params, options });
        return { id: "re_fake" };
      },
    };
    paymentIntents = { retrieve: async () => ({ latest_charge: null }) };
    charges = { retrieve: async () => ({ receipt_url: null }) };
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();

  function seriesResolveRow() {
    return {
      id: SERIES_ID, profile_id: CREATOR_PROFILE,
      title: "Crown City",
      price_cents: h.series.priceCents, is_public: h.series.isPublic,
      playlist_kind: h.series.kind,
      artwork_url: "https://cdn.example.com/cover.jpg",
      artist_name: "Queen Creator", artist_slug: "queen-creator",
    };
  }

  function listRow(s: Record<string, any>, forSales: boolean) {
    const base = {
      id: s.id, item_kind: s.itemKind, item_id: s.itemId,
      amount_cents: s.amountCents, platform_fee_cents: s.platformFeeCents,
      creator_amount_cents: s.creatorAmountCents,
      currency: "usd", status: s.status,
      created_at: "2026-10-19T00:00:00.000Z",
      item_title: "Crown City",
      artwork_url: "https://cdn.example.com/cover.jpg",
      artist_slug: "queen-creator", artist_name: "Queen Creator",
    };
    return forSales
      ? { ...base, buyer_name: "Fan One", buyer_id: BUYER_USER, identity: "email" }
      : base;
  }

  const fakeDb = {
    execute: async (q: unknown) => {
      const { sql: text, params } = dialect.sqlToQuery(q as never) as {
        sql: string; params: unknown[];
      };

      if (text.includes("INSERT INTO digital_sales")) {
        const [buyer, profileId, kind, itemId, sessionId, amount, fee, creator] = params;
        if (h.sales.some((s) => s.stripeSessionId === sessionId)) {
          return { rows: [] }; // ON CONFLICT (stripe_session_id) DO NOTHING
        }
        const id = `51515151-5151-4151-8151-${String(h.nextSale++).padStart(12, "0")}`;
        h.sales.push({
          id, buyerUserId: buyer, profileId, itemKind: kind, itemId,
          stripeSessionId: sessionId, amountCents: amount,
          platformFeeCents: fee, creatorAmountCents: creator,
          status: "completed", refundedAt: null,
        });
        return { rows: [{ id }] };
      }

      if (text.includes("SELECT id FROM digital_sales WHERE stripe_session_id")) {
        const sale = h.sales.find((s) => s.stripeSessionId === params[0]);
        return { rows: sale ? [{ id: sale.id }] : [] };
      }

      if (text.includes("WHERE ds.id =")) {
        const sale = h.sales.find((s) =>
          s.id === params[0] && s.buyerUserId === params[1] && s.status === "completed");
        return {
          rows: sale
            ? [{ id: sale.id, item_kind: sale.itemKind, item_id: sale.itemId }]
            : [],
        };
      }

      if (text.includes("COUNT(*)::int AS c") && text.includes("status = 'completed'")) {
        /* The series owned-check hardcodes item_kind = 'series' in SQL;
           its params are (buyer, itemId) only. */
        const c = h.sales.filter((s) =>
          s.buyerUserId === params[0] && s.itemKind === "series"
          && s.itemId === params[1] && s.status === "completed").length;
        return { rows: [{ c }] };
      }

      if (text.includes("COUNT(*)::int AS c") && text.includes("amount_cents")) {
        const c = h.sales.filter((s) =>
          s.buyerUserId === params[0] && s.itemKind === params[1]
          && s.itemId === params[2]).length;
        return { rows: [{ c }] };
      }

      if (text.includes("user_id, display_name FROM creator_profiles")) {
        return { rows: [{ user_id: CREATOR_USER, display_name: "Queen Creator" }] };
      }

      if (text.includes("SELECT id, slug FROM creator_profiles")) {
        return { rows: [{ id: CREATOR_PROFILE, slug: "queen-creator" }] };
      }

      if (text.includes("LEFT JOIN playlists")) {
        const forSales = text.includes("WHERE ds.profile_id");
        const rows = h.sales
          .filter((s) => forSales ? s.profileId === params[0] : s.buyerUserId === params[0])
          .map((s) => listRow(s, forSales));
        return { rows };
      }

      if (text.includes("GROUP BY ds.item_kind")) {
        const sold = h.sales.filter((s) => s.status === "completed");
        return {
          rows: sold.length
            ? [{
                item_kind: "series", units: sold.length,
                gross: sold.reduce((a, s) => a + s.amountCents, 0),
                fees: sold.reduce((a, s) => a + s.platformFeeCents, 0),
                creator: sold.reduce((a, s) => a + s.creatorAmountCents, 0),
              }]
            : [],
        };
      }

      if (text.includes("FROM money_entries")) return { rows: [] };

      if (text.includes("FROM playlists")) {
        /* The resolve SELECT carries no kind/public filter in SQL — the
           handler applies those checks to playlist_kind / is_public /
           price_cents off the returned row. */
        return { rows: [seriesResolveRow()] };
      }

      return { rows: [] };
    },
  };

  return { ...actual, db: fakeDb };
});

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

beforeAll(async () => {
  const { default: storeRouter } = await import("../store");
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: () => {}, info: () => {}, warn: () => {} };
    next();
  });
  app.use("/api", storeRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
}, 60_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}, 30_000);

beforeEach(() => {
  h.series.priceCents = 1999;
  h.series.isPublic = true;
  h.series.kind = "series";
  h.sales = [];
  h.nextSale = 1;
  h.stripe.createCalls = [];
  h.stripe.refundCalls = [];
  h.stripe.session = null;
});

async function call(method: string, path: string, opts: { user?: string; body?: unknown } = {}) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.user ? { "x-test-user": opts.user } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

function seedCompletedSale(over: Record<string, any> = {}) {
  h.sales.push({
    id: SALE_ID, buyerUserId: BUYER_USER, profileId: CREATOR_PROFILE,
    itemKind: "series", itemId: SERIES_ID, stripeSessionId: "cs_test_owned",
    amountCents: 1999, platformFeeCents: 100, creatorAmountCents: 1899,
    status: "completed", refundedAt: null, ...over,
  });
}

function paidSession(over: Record<string, any> = {}) {
  return {
    id: "cs_test_paid_1", mode: "payment", payment_status: "paid",
    amount_total: 1999, currency: "usd", payment_intent: "pi_9",
    customer_details: { email: "fan@example.com" },
    metadata: {
      buyer_user_id: BUYER_USER, profile_id: CREATOR_PROFILE,
      item_kind: "series", item_id: SERIES_ID,
      platform_fee_cents: "100", creator_amount_cents: "1899",
    },
    ...over,
  };
}

describe("GET /api/store/item/series/:id", () => {
  it("sells at the creator's typed price with the rail's 5% split shown", async () => {
    const { status, json } = await call("GET", `/store/item/series/${SERIES_ID}`);
    expect(status).toBe(200);
    expect(json.item.kind).toBe("series");
    expect(json.item.priceCents).toBe(1999);
    expect(json.feeSplit.platformFeePct).toBe(5);
    expect(json.feeSplit.platformFee).toBe("$1.00");
    expect(json.feeSplit.creatorAmount).toBe("$18.99");
  });

  it("an unpriced series is not for sale", async () => {
    h.series.priceCents = null;
    const { status } = await call("GET", `/store/item/series/${SERIES_ID}`);
    expect(status).toBe(404);
  });

  it("a private series is not for sale", async () => {
    h.series.isPublic = false;
    const { status } = await call("GET", `/store/item/series/${SERIES_ID}`);
    expect(status).toBe(404);
  });
});

describe("POST /api/store/checkout — series", () => {
  it("creates a session at the typed price, fee split in metadata, idempotent key", async () => {
    const { status, json } = await call("POST", "/store/checkout", {
      user: BUYER_USER, body: { kind: "series", id: SERIES_ID },
    });
    expect(status).toBe(200);
    expect(json.url).toBe("https://checkout.stripe.test/pay");
    expect(h.stripe.createCalls).toHaveLength(1);
    const { params, options } = h.stripe.createCalls[0];
    expect(params.line_items[0].price_data.unit_amount).toBe(1999);
    expect(params.metadata.item_kind).toBe("series");
    expect(params.metadata.platform_fee_cents).toBe("100");
    expect(params.metadata.creator_amount_cents).toBe("1899");
    expect(typeof options.idempotencyKey).toBe("string");
    expect(options.idempotencyKey.length).toBeGreaterThan(0);

    /* Same buyer + item + price state → the retry replays the same key. */
    await call("POST", "/store/checkout", {
      user: BUYER_USER, body: { kind: "series", id: SERIES_ID },
    });
    expect(h.stripe.createCalls[1].options.idempotencyKey)
      .toBe(h.stripe.createCalls[0].options.idempotencyKey);
  });

  it("a completed unlock blocks a second purchase — no session is created", async () => {
    seedCompletedSale();
    const { status, json } = await call("POST", "/store/checkout", {
      user: BUYER_USER, body: { kind: "series", id: SERIES_ID },
    });
    expect(status).toBe(409);
    expect(json.error).toBe("ALREADY_OWNED");
    expect(json.watchUrl).toBe(`/playlist/${SERIES_ID}`);
    expect(h.stripe.createCalls).toHaveLength(0);
  });

  it("a refunded sale never blocks a re-buy", async () => {
    seedCompletedSale({ status: "refunded", refundedAt: new Date() });
    const { status } = await call("POST", "/store/checkout", {
      user: BUYER_USER, body: { kind: "series", id: SERIES_ID },
    });
    expect(status).toBe(200);
    expect(h.stripe.createCalls).toHaveLength(1);
  });
});

describe("POST /api/store/verify — series", () => {
  it("records the unlock once: no download minted, access granted", async () => {
    h.stripe.session = paidSession();
    const { status, json } = await call("POST", "/store/verify", {
      user: BUYER_USER, body: { sessionId: "cs_test_paid_1" },
    });
    expect(status).toBe(200);
    expect(json.download).toBeNull();
    expect(json.access).toEqual({ unlocked: true, watchUrl: `/playlist/${SERIES_ID}` });
    expect(json.item.title).toBe("Crown City");
    expect(h.sales).toHaveLength(1);
    expect(h.sales[0].itemKind).toBe("series");
    expect(h.sales[0].amountCents).toBe(1999);
    expect(h.sales[0].platformFeeCents).toBe(100);
    expect(h.sales[0].creatorAmountCents).toBe(1899);
  });

  it("a double verify still yields exactly one sale (the rail's ON CONFLICT)", async () => {
    h.stripe.session = paidSession();
    await call("POST", "/store/verify", { user: BUYER_USER, body: { sessionId: "cs_test_paid_1" } });
    const second = await call("POST", "/store/verify", {
      user: BUYER_USER, body: { sessionId: "cs_test_paid_1" },
    });
    expect(second.json.duplicate).toBe(true);
    expect(second.json.access.unlocked).toBe(true);
    expect(h.sales).toHaveLength(1);
  });

  it("series pulled after payment → the rail's auto-refund fires untouched", async () => {
    h.stripe.session = paidSession();
    h.series.isPublic = false;
    const { status, json } = await call("POST", "/store/verify", {
      user: BUYER_USER, body: { sessionId: "cs_test_paid_1" },
    });
    expect(status).toBe(400);
    expect(json.refunded).toBe(true);
    expect(h.stripe.refundCalls).toHaveLength(1);
    expect(h.stripe.refundCalls[0].params).toEqual({ payment_intent: "pi_9" });
    expect(h.stripe.refundCalls[0].options).toEqual({ idempotencyKey: "refund:cs_test_paid_1" });
    expect(h.sales).toHaveLength(0);
  });
});

describe("buyer surfaces — the audience parity", () => {
  it("POST /store/token refuses a series sale with the unlock pointer", async () => {
    seedCompletedSale();
    const { status, json } = await call("POST", "/store/token", {
      user: BUYER_USER, body: { saleId: SALE_ID },
    });
    expect(status).toBe(400);
    expect(json.error).toBe("SERIES_UNLOCK");
    expect(json.watchUrl).toBe(`/playlist/${SERIES_ID}`);
  });

  it("the buyer's purchases list shows the series with a watch link", async () => {
    seedCompletedSale();
    const { status, json } = await call("GET", "/store/purchases", { user: BUYER_USER });
    expect(status).toBe(200);
    const row = json.purchases.find((p: any) => p.itemKind === "series");
    expect(row.title).toBe("Crown City");
    expect(row.watchUrl).toBe(`/playlist/${SERIES_ID}`);
  });

  it("the creator's sales dashboard counts the series buyer", async () => {
    seedCompletedSale();
    const { status, json } = await call("GET", "/store/sales", { user: CREATOR_USER });
    expect(status).toBe(200);
    const row = json.sales.find((s: any) => s.itemKind === "series");
    expect(row.itemTitle).toBe("Crown City");
    expect(json.totals.grossCents).toBe(1999);
    expect(json.totals.feeCents).toBe(100);
    expect(json.totals.creatorCents).toBe(1899);
  });
});
