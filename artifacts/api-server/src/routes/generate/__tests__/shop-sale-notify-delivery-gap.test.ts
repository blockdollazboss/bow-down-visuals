/**
 * Storefront sale → seller bell/push + undelivered-sale library shim
 * (stack600 lane, Gate Pass 2 follow-up).
 *
 * The Oct 28 gate proved the hole on the live build: a $5.00 embedded
 * purchase completed (Order 1d6b23e3…, fee $0.25 / seller $4.75) and
 * 30+ minutes later the buyer's Library → Purchases still read
 * "Purchases 0" and the seller's bell had NO sale notification —
 * because (1) the Stack500 sale finale was wired on the /api/store
 * rail only; the storefront flip (lib/market-sale) never fired it,
 * and (2) the product ("TEST Digital Download") sat at the physical
 * default with no deliverable file, so no shop_deliveries row could
 * ever be written and my-purchases read deliveries only.
 *
 * Pins:
 *  - the gate scenario verbatim: file-less product, paid verify →
 *    seller notified exactly once (job_notifications landing +
 *    money/sale push event) AND the buyer's library shows the order
 *    as a deliveryMissing record (no fabricated download);
 *  - replays through BOTH doors (verify again, webhook flip again)
 *    never notify twice and never duplicate the library entry;
 *  - webhook-first settle behaves identically;
 *  - a delivered (digital + file) sale shows its download and is NOT
 *    duplicated by the shim;
 *  - a pre-0297 sale row (buyer_user_id NULL) surfaces by checkout
 *    email, and a refunded sale never surfaces;
 *  - the $0 free path records + delivers but fires no "got paid"
 *    finale; the notify helper skips self-purchases and honors the
 *    job_notifications exactly-once gate on its own.
 *
 * Harness mirrors shop-delivery.test.ts (real shops router over
 * pg-mem, Stripe mocked at the lib/stripe-checkout seam), with the
 * job-notifications + push-events seams faked statefully: the fake
 * createJobNotification reproduces the real UNIQUE(job_type, job_id)
 * landing contract (true once per key, false after).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  db: null as any,
  userId: "",
  userPlan: "free",
  userEmail: null as string | null,
  sessions: new Map<string, any>(),
  seq: 0,
  jobNotifs: [] as any[],
  landedKeys: new Set<string>(),
  pushEvents: [] as any[],
}));

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    req.userPlan = h.userPlan;
    req.userEmail = h.userEmail;
    next();
  },
}));

vi.mock("../../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 0),
  refundCredits: vi.fn(async () => 0),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../../lib/ai-clients", () => ({
  getTextModel: vi.fn(() => "gpt-6-sol"),
  getOpenAI: vi.fn(() => { throw new Error("no ai in notify tests"); }),
}));

vi.mock("../../../lib/supabase-admin", () => ({
  getSupabaseAdmin: vi.fn(() => ({
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://files.example.com/${path}` } }),
      }),
    },
  })),
}));

vi.mock("../../../lib/objectStorage", () => ({
  SHOP_PRODUCTS_BUCKET: "shop-products",
  ensureShopProductsBucket: vi.fn(async () => {}),
  refreshSupabaseStorageUrl: vi.fn(async (v: string) => v),
  refreshSupabaseStorageUrlsDeep: vi.fn(async (x: any) => x),
  normalizeToStorageRef: vi.fn((u: string) => u),
  isStorageRef: vi.fn(() => false),
}));

vi.mock("../../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async (v: string | null | undefined) => v ?? null),
}));

vi.mock("../../../lib/stripe-checkout", () => ({
  getCheckoutStripe: vi.fn(() => ({
    checkout: {
      sessions: {
        create: vi.fn(async (params: any) => {
          h.seq += 1;
          const id = `cs_test_${h.seq}`;
          const session = {
            id,
            url: `https://checkout.example.com/pay/${id}`,
            client_secret: `cs_secret_${h.seq}`,
            payment_status: "unpaid",
            amount_total: (params.line_items as any[]).reduce(
              (s: number, li: any) => s + li.price_data.unit_amount * li.quantity, 0),
            metadata: params.metadata,
          };
          h.sessions.set(id, session);
          return session;
        }),
      },
    },
  })),
  retrieveCheckoutSession: vi.fn(async (id: string) => {
    const s = h.sessions.get(id);
    if (!s) throw new Error("no such session");
    return s;
  }),
  checkoutBaseUrl: vi.fn(() => "https://example.com"),
  isCheckoutTestMode: vi.fn(() => true),
}));

/* Stateful fakes for the two notification seams. The fake
   createJobNotification reproduces the real landing contract:
   true the first time a (jobType, jobId) lands, false on repeats. */
vi.mock("../../../lib/job-notifications", () => ({
  createJobNotification: vi.fn(async (input: any) => {
    const key = `${input.jobType}:${input.jobId}`;
    if (h.landedKeys.has(key)) return false;
    h.landedKeys.add(key);
    h.jobNotifs.push(input);
    return true;
  }),
  notifyJobFailed: vi.fn(async () => false),
  notifyJobCompletion: vi.fn(async () => false),
  notifyTerminalExportJobs: vi.fn(async () => {}),
  listPendingNotifications: vi.fn(async () => []),
  getNotifyChannel: vi.fn(() => "relay"),
  __setJobNotificationsDb: vi.fn(),
}));

vi.mock("../../../lib/push-events", () => ({
  notifyUserEvent: vi.fn(async (input: any) => {
    h.pushEvents.push(input);
    return { bellLanded: true, push: null, pushSkippedReason: null };
  }),
  pushIfCategoryEnabled: vi.fn(async () => null),
  getPushPreferences: vi.fn(async () => ({
    money: true, messages: true, live: true, mentions: true, social: false,
  })),
  updatePushPreferences: vi.fn(async () => ({})),
  PUSH_CATEGORY_DEFAULTS: { money: true, messages: true, live: true, mentions: true, social: false },
  PUSH_CATEGORIES: ["money", "messages", "live", "mentions", "social"],
}));

import shopsRouter from "../shops";
import { markMarketSalePaid, notifyStorefrontSaleSafely } from "../../../lib/market-sale";
import { createTestDb } from "../../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const DDL = `
CREATE TABLE shops (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, name text NOT NULL,
  handle text NOT NULL UNIQUE, tagline text, description text,
  banner_color text NOT NULL DEFAULT '#0a0a0a', accent_color text NOT NULL DEFAULT '#d4af37',
  banner_image_url text, custom_domain text, domain_verified boolean NOT NULL DEFAULT FALSE,
  domain_verification_token text, meta_pixel_id text, tiktok_pixel_id text, google_tag_id text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE shop_products (
  id uuid PRIMARY KEY, shop_id uuid NOT NULL, user_id uuid NOT NULL,
  name text NOT NULL, price_cents integer NOT NULL DEFAULT 0, description text,
  image_url text, image_path text, status text NOT NULL DEFAULT 'active', pinned_ugc_ad_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  affiliate_enabled boolean NOT NULL DEFAULT false, affiliate_commission_bps integer,
  image_alt_text text,
  product_type text NOT NULL DEFAULT 'physical', deliverable_url text, deliverable_name text
);
CREATE TABLE shop_events (
  id uuid PRIMARY KEY, shop_id uuid NOT NULL, user_id uuid NOT NULL,
  event_type text NOT NULL, product_id uuid, amount_cents integer NOT NULL DEFAULT 0,
  platform_fee_cents integer NOT NULL DEFAULT 0, buyer_email text, buyer_user_id uuid,
  settled_payout_id uuid, settled_at timestamptz, ip_hash text,
  stripe_session_id text, payment_status text, paid_at timestamptz,
  quantity integer NOT NULL DEFAULT 1, checkout_group_id text, discount_code text, affiliate_code text,
  created_at timestamptz NOT NULL DEFAULT now(), bump_for_product_id uuid
);
CREATE TABLE shop_discount_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), shop_id uuid NOT NULL, code text NOT NULL,
  percent_off integer NOT NULL, max_uses integer NOT NULL DEFAULT -1,
  used_count integer NOT NULL DEFAULT 0, expires_at timestamptz,
  is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text
);
CREATE TABLE users (
  id uuid PRIMARY KEY, email text
);
CREATE TABLE shop_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_event_id uuid NOT NULL UNIQUE,
  shop_id uuid NOT NULL,
  product_id uuid,
  buyer_user_id uuid,
  buyer_email text,
  order_id text NOT NULL,
  product_name text,
  deliverable_url text NOT NULL,
  deliverable_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE gift_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash text NOT NULL, code_last4 text NOT NULL,
  profile_id uuid NOT NULL, product_id uuid,
  buyer_user_id uuid, recipient_email text NOT NULL,
  recipient_name text, message text,
  initial_cents integer NOT NULL, balance_cents integer NOT NULL,
  reserved_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  stripe_session_id text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE gift_card_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_card_id uuid NOT NULL, kind text NOT NULL,
  amount_cents integer NOT NULL, balance_after_cents integer NOT NULL,
  ref text, idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX gift_card_ledger_idem_ux ON gift_card_ledger (idempotency_key);
CREATE TABLE gift_card_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_card_id uuid NOT NULL, rail text NOT NULL, ref text NOT NULL,
  amount_cents integer NOT NULL, status text NOT NULL DEFAULT 'reserved',
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX gift_card_reservations_rail_ref_ux ON gift_card_reservations (rail, ref);`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const SELLER = randomUUID();
const BUYER = randomUUID();
const BUYER_EMAIL = "fan@example.com";
const FILE_URL = "https://files.example.com/beat-pack.zip";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", shopsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error("[shop-sale-notify] unhandled route error:", err?.message ?? err);
    res.status(500).json({ error: "unhandled" });
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

beforeEach(async () => {
  const { db, mem } = createTestDb();
  mem.public.registerFunction({
    name: "gen_random_uuid", args: [], returns: "uuid" as never,
    implementation: () => randomUUID(),
  });
  mem.public.none(DDL);
  h.db = db;
  h.userId = SELLER;
  h.userPlan = "free";
  h.userEmail = "seller@example.com";
  h.sessions = new Map();
  h.seq = 0;
  h.jobNotifs = [];
  h.landedKeys = new Set();
  h.pushEvents = [];
  await h.db.execute(sql`INSERT INTO users (id, email) VALUES (${BUYER}, ${BUYER_EMAIL})`);
  await h.db.execute(sql`INSERT INTO users (id, email) VALUES (${SELLER}, 'seller@example.com')`);
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method, headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

/** The gate product, verbatim in spirit: named like a download,
 *  created with NO type and NO file — the physical default. */
async function seedGateShop() {
  const shopId = randomUUID(); const pid = randomUUID();
  await h.db.execute(sql`INSERT INTO shops (id, user_id, name, handle) VALUES (${shopId}, ${SELLER}, 'TEST Buyer D Shop', ${"gd-" + shopId.slice(0, 8)})`);
  await h.db.execute(sql`
    INSERT INTO shop_products (id, shop_id, user_id, name, price_cents)
    VALUES (${pid}, ${shopId}, ${SELLER}, 'TEST Digital Download — delete pre-launch', 500)
  `);
  return { shopId, pid };
}

async function seedDigitalShop(priceCents = 500) {
  const shopId = randomUUID(); const pid = randomUUID();
  await h.db.execute(sql`INSERT INTO shops (id, user_id, name, handle) VALUES (${shopId}, ${SELLER}, 'DL Shop', ${"dl-" + shopId.slice(0, 8)})`);
  await h.db.execute(sql`
    INSERT INTO shop_products (id, shop_id, user_id, name, price_cents, product_type, deliverable_url, deliverable_name)
    VALUES (${pid}, ${shopId}, ${SELLER}, 'Beat Pack', ${priceCents}, 'digital', ${FILE_URL}, 'beat-pack.zip')
  `);
  return { shopId, pid };
}

async function deliveryCount() {
  const r = await h.db.execute(sql`SELECT COUNT(*)::int AS c FROM shop_deliveries`);
  return Number((r.rows[0] as any).c);
}

async function payAndVerify(shopId: string, pid: string) {
  const co = await req("POST", "/storefronts/checkout", {
    shopId, productId: pid, quantity: 1, buyerEmail: BUYER_EMAIL,
  });
  expect(co.status).toBe(201);
  const session = h.sessions.get(co.json.sessionId);
  session.payment_status = "paid";
  const v = await req("POST", "/storefronts/checkout/verify", { sessionId: co.json.sessionId });
  expect(v.status).toBe(200);
  expect(v.json.paid).toBe(true);
  return { co, v };
}

describe("storefront sale notify + delivery gap (gate Pass 2 follow-up)", () => {
  it("GATE SCENARIO: file-less 'digital download' — seller notified exactly once, buyer library shows the order as deliveryMissing", async () => {
    const { shopId, pid } = await seedGateShop();
    const { v } = await payAndVerify(shopId, pid);

    /* Money math untouched: $5.00 → $0.25 fee / $4.75 net. */
    expect(v.json.platform_fee_cents).toBe(25);
    expect(v.json.seller_net_cents).toBe(475);
    /* No delivery row can exist — the product carries no file. */
    expect(v.json.deliveries).toHaveLength(0);
    expect(await deliveryCount()).toBe(0);

    /* (b) The seller's bell + push fired, exactly once, keyed by the
       checkout group, with the store rail's copy and math. */
    expect(h.jobNotifs).toHaveLength(1);
    expect(h.jobNotifs[0].jobType).toBe("sale");
    expect(h.jobNotifs[0].jobId).toBe(v.json.orderId);
    expect(h.jobNotifs[0].userId).toBe(SELLER);
    expect(h.jobNotifs[0].title).toBe("You just got paid 👑");
    expect(h.jobNotifs[0].message).toContain("TEST Digital Download — delete pre-launch");
    expect(h.jobNotifs[0].message).toContain("$4.75");
    expect(h.pushEvents).toHaveLength(1);
    expect(h.pushEvents[0].userId).toBe(SELLER);
    expect(h.pushEvents[0].category).toBe("money");
    expect(h.pushEvents[0].kind).toBe("sale");

    /* (a) The buyer's library shows the ORDER under their account —
       honestly marked, no fabricated download. */
    h.userId = BUYER; h.userEmail = BUYER_EMAIL;
    const lib = await req("GET", "/shops/my-purchases");
    expect(lib.status).toBe(200);
    expect(lib.json.purchases).toHaveLength(1);
    expect(lib.json.purchases[0].orderId).toBe(v.json.orderId);
    expect(lib.json.purchases[0].productName).toBe("TEST Digital Download — delete pre-launch");
    expect(lib.json.purchases[0].deliveryMissing).toBe(true);
    expect(lib.json.purchases[0].downloadUrl).toBeNull();
  });

  it("replays through both doors never re-notify and never duplicate the library entry", async () => {
    const { shopId, pid } = await seedGateShop();
    const { co, v } = await payAndVerify(shopId, pid);
    expect(h.jobNotifs).toHaveLength(1);

    const v2 = await req("POST", "/storefronts/checkout/verify", { sessionId: co.json.sessionId });
    expect(v2.json.duplicate).toBe(true);
    /* The webhook door re-running the flip is equally inert. */
    await markMarketSalePaid(co.json.sessionId);
    /* …and a direct second flip attempt on the notify key itself. */
    expect(h.jobNotifs).toHaveLength(1);
    expect(h.pushEvents).toHaveLength(1);

    h.userId = BUYER; h.userEmail = BUYER_EMAIL;
    const lib = await req("GET", "/shops/my-purchases");
    expect(lib.json.purchases).toHaveLength(1);
    expect(lib.json.purchases[0].orderId).toBe(v.json.orderId);
  });

  it("webhook-first settle (flip before verify) notifies once and delivers the download; verify after adds nothing", async () => {
    const { shopId, pid } = await seedDigitalShop(500);
    const co = await req("POST", "/storefronts/checkout", {
      shopId, productId: pid, quantity: 1, buyerEmail: BUYER_EMAIL,
    });
    expect(co.status).toBe(201);
    const session = h.sessions.get(co.json.sessionId);
    session.payment_status = "paid";

    /* The webhook door: the flip runs without any buyer verify. */
    const { flipped } = await markMarketSalePaid(co.json.sessionId);
    expect(flipped).toBe(1);
    expect(await deliveryCount()).toBe(1);
    expect(h.jobNotifs).toHaveLength(1);
    expect(h.pushEvents).toHaveLength(1);

    const v = await req("POST", "/storefronts/checkout/verify", { sessionId: co.json.sessionId });
    expect(v.json.duplicate).toBe(true);
    expect(h.jobNotifs).toHaveLength(1);
    expect(h.pushEvents).toHaveLength(1);
    expect(await deliveryCount()).toBe(1);

    /* Delivered sales show the download and are NOT duplicated by
       the undelivered-sale shim. */
    h.userId = BUYER; h.userEmail = BUYER_EMAIL;
    const lib = await req("GET", "/shops/my-purchases");
    expect(lib.json.purchases).toHaveLength(1);
    expect(lib.json.purchases[0].deliveryMissing).toBe(false);
    expect(lib.json.purchases[0].downloadUrl).toBe(FILE_URL);
  });

  it("pre-0297 sale row (buyer id NULL) surfaces by checkout email; a refunded sale never surfaces", async () => {
    const { shopId, pid } = await seedGateShop();
    const groupA = randomUUID(); const groupB = randomUUID();
    await h.db.execute(sql`
      INSERT INTO shop_events (id, shop_id, user_id, event_type, product_id, amount_cents, platform_fee_cents, buyer_email, buyer_user_id, payment_status, paid_at, checkout_group_id)
      VALUES (${randomUUID()}, ${shopId}, ${SELLER}, 'sale', ${pid}, 500, 25, ${BUYER_EMAIL}, NULL, 'paid', now(), ${groupA})
    `);
    await h.db.execute(sql`
      INSERT INTO shop_events (id, shop_id, user_id, event_type, product_id, amount_cents, platform_fee_cents, buyer_email, buyer_user_id, payment_status, paid_at, checkout_group_id)
      VALUES (${randomUUID()}, ${shopId}, ${SELLER}, 'refunded_sale', ${pid}, 500, 25, ${BUYER_EMAIL}, NULL, 'refunded', now(), ${groupB})
    `);
    h.userId = BUYER; h.userEmail = BUYER_EMAIL;
    const lib = await req("GET", "/shops/my-purchases");
    expect(lib.json.purchases).toHaveLength(1);
    expect(lib.json.purchases[0].orderId).toBe(groupA);
    expect(lib.json.purchases[0].deliveryMissing).toBe(true);
  });

  it("FREE product records + delivers with NO 'got paid' finale", async () => {
    const { shopId, pid } = await seedDigitalShop(0);
    const co = await req("POST", "/storefronts/checkout", {
      shopId, items: [{ productId: pid, quantity: 1 }], buyerEmail: BUYER_EMAIL,
    });
    expect(co.status).toBe(201);
    expect(co.json.paid).toBe(true);
    expect(await deliveryCount()).toBe(1);
    expect(h.jobNotifs).toHaveLength(0);
    expect(h.pushEvents).toHaveLength(0);
  });
});

describe("notifyStorefrontSaleSafely (helper discipline)", () => {
  it("skips a self-purchase silently", async () => {
    const fired = await notifyStorefrontSaleSafely({
      sellerId: SELLER, buyerUserId: SELLER, orderKey: randomUUID(),
      lines: [{ productName: "Own Thing", amountCents: 500, platformFeeCents: 25 }],
    });
    expect(fired).toBe(false);
    expect(h.jobNotifs).toHaveLength(0);
    expect(h.pushEvents).toHaveLength(0);
  });

  it("honors the exactly-once landing gate: a second call for the same order never re-pings", async () => {
    const orderKey = randomUUID();
    const input = {
      sellerId: SELLER, buyerUserId: BUYER, orderKey,
      lines: [{ productName: "Beat Pack", amountCents: 500, platformFeeCents: 25 }],
    };
    expect(await notifyStorefrontSaleSafely(input)).toBe(true);
    expect(await notifyStorefrontSaleSafely(input)).toBe(false);
    expect(h.jobNotifs).toHaveLength(1);
    expect(h.pushEvents).toHaveLength(1);
    expect(h.jobNotifs[0].message).toContain("“Beat Pack” just sold for $5.00 — $4.75");
  });

  it("multi-line orders aggregate into one notification", async () => {
    const fired = await notifyStorefrontSaleSafely({
      sellerId: SELLER, buyerUserId: BUYER, orderKey: randomUUID(),
      lines: [
        { productName: "A", amountCents: 500, platformFeeCents: 25 },
        { productName: "B", amountCents: 500, platformFeeCents: 25 },
      ],
    });
    expect(fired).toBe(true);
    expect(h.jobNotifs).toHaveLength(1);
    expect(h.jobNotifs[0].message).toContain("2 items from your shop just sold for $10.00 — $9.50");
  });
});
