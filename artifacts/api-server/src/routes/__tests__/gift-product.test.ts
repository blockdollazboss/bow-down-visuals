/**
 * Gift-This-Product (Wave-4 #45). Drives the REAL gift-product router +
 * REAL lib/gift-product over pg-mem; the credits rail is mocked at its
 * module boundary with the same exactly-once contract chargeCredits
 * itself documents (dedupe by idempotency key, OutOfCreditsError on
 * insufficient balance). Pins:
 *  - purchase charges VB exactly once (replay = duplicate, no 2nd charge,
 *    no 2nd gift row, one ledger charge row);
 *  - the price is the product's real listed price and the FLAT 5% fee
 *    split is feeSplit's, unchanged (fee 145 on 2,900; 1,000 on 20,000);
 *  - insufficient balance refuses 402 with no gift row;
 *  - self-gifts, gift-card products and services refuse honestly;
 *  - claim flow: recipient claims → exactly one store_orders row in
 *    THEIR name carrying the recorded split; a replay claims nothing
 *    twice; a non-recipient reads 404;
 *  - scheduled gifts can't be claimed early; the on-read sweep flips
 *    them at delivery and notifies exactly once;
 *  - unclaimed value stays held as the recipient's claimable credit
 *    (claimable_cents = gross, no order, no settlement);
 *  - resend: buyer-only, one per hour, claimed gifts refuse.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID, createHash } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  db: null as any,
  balances: new Map<string, number>(),
  chargedKeys: new Set<string>(),
  chargeCalls: [] as Array<{ userId: string; cost: number; key: string | null }>,
  refunds: [] as Array<{ userId: string; amount: number }>,
  emails: [] as Array<{ to?: unknown; subject?: unknown }>,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = req.headers["x-test-user"];
    req.userEmail = req.headers["x-test-email"];
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/logger", () => ({
  logger: { error: () => undefined, info: () => undefined, warn: () => undefined },
}));

vi.mock("../../lib/email", () => ({
  sendEmail: async (args: { to?: unknown; subject?: unknown }) => { h.emails.push(args); return { ok: true }; },
  emailShell: (_title: string, html: string) => html,
  emailButton: (href: string, label: string) => `<a href="${href}">${label}</a>`,
  money: (cents: number) => `$${(cents / 100).toFixed(2)}`,
  escapeHtml: (s: string) => s,
  baseUrlForEmail: () => "https://example.com",
}));

vi.mock("../../lib/credits", () => {
  class OutOfCreditsError extends Error { readonly status = 402; constructor() { super("out_of_credits"); this.name = "OutOfCreditsError"; } }
  class CreditsDisabledError extends Error { readonly status = 403; constructor() { super("credits_disabled"); this.name = "CreditsDisabledError"; } }
  class LedgerWriteError extends Error { readonly status = 500; constructor() { super("ledger_write_failed"); this.name = "LedgerWriteError"; } }
  return {
    OutOfCreditsError, CreditsDisabledError, LedgerWriteError,
    buildChargeIdempotencyKey: (scope: string, userId: string, clientKey: unknown, intent: unknown) => {
      if (typeof clientKey === "string" && clientKey.trim().length >= 8) return `${scope}:${userId}:client:${clientKey.trim()}`;
      const hash = createHash("sha256").update(JSON.stringify(intent) ?? "").digest("hex").slice(0, 32);
      return `${scope}:${userId}:${hash}`;
    },
    chargeCredits: async (userId: string, cost: number, _record: unknown, opts?: { idempotencyKey?: string | null }) => {
      const key = opts?.idempotencyKey ?? null;
      h.chargeCalls.push({ userId, cost, key });
      if (key && h.chargedKeys.has(key)) return h.balances.get(userId) ?? 0;
      const balance = h.balances.get(userId) ?? 0;
      if (balance < cost) throw new OutOfCreditsError();
      h.balances.set(userId, balance - cost);
      if (key) h.chargedKeys.add(key);
      return balance - cost;
    },
    refundCredits: async (userId: string, amount: number) => {
      h.refunds.push({ userId, amount });
      h.balances.set(userId, (h.balances.get(userId) ?? 0) + amount);
    },
  };
});

import giftProductRouter from "../gift-product";
import { validateGiftInput, giftPriceCredits, effectiveStatus, canResend } from "../../lib/gift-product";
import { createTestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const DDL = `
CREATE TABLE creator_profiles (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text NOT NULL, display_name text NOT NULL
);
CREATE TABLE profiles ( id uuid PRIMARY KEY, email text NOT NULL );
CREATE TABLE store_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL, kind text NOT NULL, title text NOT NULL,
  price_cents integer NOT NULL, inventory integer NOT NULL DEFAULT -1,
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE store_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id uuid, profile_id uuid NOT NULL, product_id uuid,
  product_title text NOT NULL DEFAULT '', product_kind text NOT NULL DEFAULT 'digital',
  quantity integer NOT NULL DEFAULT 1, amount_cents integer NOT NULL,
  platform_fee_cents integer NOT NULL DEFAULT 0, creator_amount_cents integer NOT NULL DEFAULT 0,
  stripe_session_id text UNIQUE, status text NOT NULL DEFAULT 'completed',
  fulfillment_note text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, kind text NOT NULL, title text NOT NULL,
  body text, link text, is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE product_gifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid, profile_id uuid NOT NULL,
  product_title text NOT NULL DEFAULT '', product_kind text NOT NULL DEFAULT 'digital',
  buyer_user_id uuid NOT NULL, recipient_user_id uuid, recipient_email text NOT NULL,
  gift_message text, quantity integer NOT NULL DEFAULT 1,
  amount_cents integer NOT NULL, credits_charged integer NOT NULL,
  platform_fee_cents integer NOT NULL DEFAULT 0, creator_amount_cents integer NOT NULL DEFAULT 0,
  claimable_cents integer NOT NULL, idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'scheduled',
  delivery_at timestamptz NOT NULL DEFAULT now(), delivered_at timestamptz,
  claimed_at timestamptz, claim_order_id uuid,
  resend_count integer NOT NULL DEFAULT 0, last_resent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX product_gifts_idem_ux ON product_gifts (idempotency_key);
CREATE TABLE product_gift_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gift_id uuid NOT NULL, kind text NOT NULL, amount_cents integer NOT NULL DEFAULT 0,
  ref text, idempotency_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX product_gift_ledger_idem_ux ON product_gift_ledger (idempotency_key);`;

let server: any; let baseUrl: string;
const SELLER = randomUUID();
const BUYER = randomUUID();
const RECIPIENT = randomUUID();
const STRANGER = randomUUID();
const PROFILE_ID = randomUUID();
const PRODUCT_ID = randomUUID();
const BIG_PRODUCT_ID = randomUUID();
const CARD_PRODUCT_ID = randomUUID();
const SERVICE_PRODUCT_ID = randomUUID();

const BUYER_H = { "x-test-user": BUYER, "x-test-email": "buyer@example.com", "content-type": "application/json" };
const RECIPIENT_H = { "x-test-user": RECIPIENT, "x-test-email": "fan@example.com", "content-type": "application/json" };
const STRANGER_H = { "x-test-user": STRANGER, "x-test-email": "stranger@example.com", "content-type": "application/json" };

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", giftProductRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

beforeEach(async () => {
  const { db, mem } = createTestDb();
  mem.public.registerFunction({
    name: "gen_random_uuid", args: [], returns: "uuid" as never, impure: true,
    implementation: () => randomUUID(),
  });
  mem.public.none(DDL);
  h.db = db;
  h.balances.clear(); h.chargedKeys.clear(); h.chargeCalls = []; h.refunds = []; h.emails = [];
  h.balances.set(BUYER, 100_000);
  await db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug, display_name) VALUES (${PROFILE_ID}, ${SELLER}, 'queen', 'Queen Creator')`);
  await db.execute(sql`INSERT INTO profiles (id, email) VALUES (${RECIPIENT}, 'fan@example.com')`);
  await db.execute(sql`INSERT INTO store_products (id, profile_id, kind, title, price_cents) VALUES (${PRODUCT_ID}, ${PROFILE_ID}, 'download', 'Midnight Pack', 2900)`);
  await db.execute(sql`INSERT INTO store_products (id, profile_id, kind, title, price_cents) VALUES (${BIG_PRODUCT_ID}, ${PROFILE_ID}, 'merch', 'Gold Hoodie', 10000)`);
  await db.execute(sql`INSERT INTO store_products (id, profile_id, kind, title, price_cents) VALUES (${CARD_PRODUCT_ID}, ${PROFILE_ID}, 'gift_card', 'Store Gift Card', 2500)`);
  await db.execute(sql`INSERT INTO store_products (id, profile_id, kind, title, price_cents) VALUES (${SERVICE_PRODUCT_ID}, ${PROFILE_ID}, 'service', 'Studio Hour', 5000)`);
});

async function post(path: string, headers: Record<string, string>, body: unknown) {
  const res = await fetch(`${baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}
async function get(path: string, headers: Record<string, string>) {
  const res = await fetch(`${baseUrl}${path}`, { headers });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}
async function rows(q: ReturnType<typeof sql>) {
  return (await h.db.execute(q)).rows as Array<Record<string, unknown>>;
}
function buyGift(overrides: Record<string, unknown> = {}) {
  return post("/product-gifts/purchase", BUYER_H, {
    productId: PRODUCT_ID, recipientEmail: "fan@example.com",
    giftMessage: "For you.", idempotencyKey: "gift-intent-0001", ...overrides,
  });
}

describe("purchase", () => {
  it("charges VB exactly once at the real listed price with the flat 5% split recorded", async () => {
    const first = await buyGift();
    expect(first.status).toBe(201);
    expect(first.body.gift.amountCents).toBe(2900);
    expect(first.body.gift.platformFeeCents).toBe(145); // 5% of 2,900 — feeSplit, unchanged
    expect(first.body.gift.creatorAmountCents).toBe(2755);
    expect(first.body.gift.claimableCents).toBe(2900); // held in full for the recipient
    expect(first.body.chargedCredits).toBe(2900);
    expect(h.balances.get(BUYER)).toBe(100_000 - 2900);

    const replay = await buyGift();
    expect(replay.status).toBe(200);
    expect(replay.body.duplicate).toBe(true);
    expect(h.balances.get(BUYER)).toBe(100_000 - 2900); // NOT charged twice
    const gifts = await rows(sql`SELECT * FROM product_gifts`);
    expect(gifts.length).toBe(1);
    const ledger = await rows(sql`SELECT * FROM product_gift_ledger WHERE kind = 'charge'`);
    expect(ledger.length).toBe(1);
  });

  it("fee stays flat 5% on a bigger multi-quantity gift", async () => {
    const r = await post("/product-gifts/purchase", BUYER_H, {
      productId: BIG_PRODUCT_ID, recipientEmail: "fan@example.com", quantity: 2, idempotencyKey: "gift-intent-big",
    });
    expect(r.status).toBe(201);
    expect(r.body.gift.amountCents).toBe(20_000);
    expect(r.body.gift.platformFeeCents).toBe(1_000);
    expect(r.body.gift.creatorAmountCents).toBe(19_000);
  });

  it("refuses on insufficient balance — 402 and no gift row", async () => {
    h.balances.set(BUYER, 100);
    const r = await buyGift({ idempotencyKey: "gift-intent-poor" });
    expect(r.status).toBe(402);
    expect(r.body.error).toBe("out_of_credits");
    expect((await rows(sql`SELECT * FROM product_gifts`)).length).toBe(0);
  });

  it("refuses self-gifts, gift-card products and services honestly", async () => {
    const self = await buyGift({ recipientEmail: "buyer@example.com", idempotencyKey: "gift-intent-self" });
    expect(self.status).toBe(400);
    const card = await buyGift({ productId: CARD_PRODUCT_ID, idempotencyKey: "gift-intent-card" });
    expect(card.status).toBe(400);
    expect(card.body.error).toBe("GIFT_CARD_CHECKOUT");
    const service = await buyGift({ productId: SERVICE_PRODUCT_ID, idempotencyKey: "gift-intent-svc" });
    expect(service.status).toBe(400);
    expect(service.body.error).toBe("NOT_GIFTABLE");
    expect((await rows(sql`SELECT * FROM product_gifts`)).length).toBe(0);
    expect(h.balances.get(BUYER)).toBe(100_000);
  });

  it("delivers immediately: bell notification + gift email to the recipient", async () => {
    const r = await buyGift();
    expect(r.status).toBe(201);
    const notes = await rows(sql`SELECT * FROM notifications WHERE user_id = ${RECIPIENT}`);
    expect(notes.length).toBe(1);
    expect(String(notes[0]!["kind"])).toBe("gift_product");
    expect(h.emails.length).toBe(1);
    expect(String(h.emails[0]!.to)).toBe("fan@example.com");
  });
});

describe("claim flow", () => {
  it("recipient claims into their own orders, exactly once, with the recorded split", async () => {
    const bought = await buyGift();
    const giftId = bought.body.gift.id as string;

    const mine = await get("/product-gifts/mine", RECIPIENT_H);
    expect(mine.body.received.length).toBe(1);
    expect(mine.body.received[0].status).toBe("awaiting_claim");

    const strangerClaim = await post(`/product-gifts/${giftId}/claim`, STRANGER_H, {});
    expect(strangerClaim.status).toBe(404);

    const claim = await post(`/product-gifts/${giftId}/claim`, RECIPIENT_H, {});
    expect(claim.status).toBe(200);
    expect(claim.body.duplicate).toBe(false);
    const orders = await rows(sql`SELECT * FROM store_orders`);
    expect(orders.length).toBe(1);
    expect(String(orders[0]!["buyer_user_id"])).toBe(RECIPIENT);
    expect(Number(orders[0]!["amount_cents"])).toBe(2900);
    expect(Number(orders[0]!["platform_fee_cents"])).toBe(145);
    expect(Number(orders[0]!["creator_amount_cents"])).toBe(2755);
    expect(String(orders[0]!["stripe_session_id"])).toBe(`gift:${giftId}`);

    const again = await post(`/product-gifts/${giftId}/claim`, RECIPIENT_H, {});
    expect(again.body.duplicate).toBe(true);
    expect((await rows(sql`SELECT * FROM store_orders`)).length).toBe(1);
    expect((await rows(sql`SELECT * FROM product_gift_ledger WHERE kind = 'claim_settle'`)).length).toBe(1);
    const giftRow = (await rows(sql`SELECT * FROM product_gifts`))[0]!;
    expect(String(giftRow["status"])).toBe("claimed");
    expect(Number(giftRow["claimable_cents"])).toBe(0); // held value settled by the claim
  });

  it("unclaimed gift holds its full value as claimable credit — no order, no settlement", async () => {
    await buyGift();
    const giftRow = (await rows(sql`SELECT * FROM product_gifts`))[0]!;
    expect(Number(giftRow["claimable_cents"])).toBe(2900);
    expect((await rows(sql`SELECT * FROM store_orders`)).length).toBe(0);
    expect((await rows(sql`SELECT * FROM product_gift_ledger WHERE kind = 'claim_settle'`)).length).toBe(0);
  });
});

describe("pure helpers", () => {
  it("gift price is the listed price at the x100 VB rule", () => {
    expect(giftPriceCredits(2900, 1)).toBe(2900);
    expect(giftPriceCredits(10000, 2)).toBe(20_000);
    expect(giftPriceCredits(0, 5)).toBe(0);
  });
  it("validation rejects bad emails, self-gifts and far-past/far-future dates", () => {
    const now = new Date("2026-11-01T12:00:00.000Z");
    expect(validateGiftInput({ recipientEmail: "nope", buyerEmail: null, quantity: 1 }, now).ok).toBe(false);
    expect(validateGiftInput({ recipientEmail: "a@b.co", buyerEmail: "a@b.co", quantity: 1 }, now).ok).toBe(false);
    expect(validateGiftInput({ recipientEmail: "a@b.co", buyerEmail: null, quantity: 1, deliveryAt: "2025-01-01T00:00:00.000Z" }, now).ok).toBe(false);
    expect(validateGiftInput({ recipientEmail: "a@b.co", buyerEmail: null, quantity: 1, deliveryAt: "2028-01-01T00:00:00.000Z" }, now).ok).toBe(false);
    expect(validateGiftInput({ recipientEmail: " Fan@Example.com ", buyerEmail: null, quantity: 2 }, now)).toMatchObject({ ok: true, recipientEmail: "fan@example.com", quantity: 2 });
  });
  it("status + resend gates follow the clock", () => {
    const now = new Date("2026-11-01T12:00:00.000Z");
    const base = { status: "scheduled", delivery_at: "2026-11-02T12:00:00.000Z", last_resent_at: null, delivered_at: null } as any;
    expect(effectiveStatus(base, now)).toBe("scheduled");
    expect(effectiveStatus({ ...base, delivery_at: "2026-10-31T12:00:00.000Z" }, now)).toBe("awaiting_claim");
    expect(canResend({ ...base, delivery_at: "2026-10-31T12:00:00.000Z" }, now).ok).toBe(true);
    expect(canResend({ ...base, status: "claimed", delivery_at: "2026-10-31T12:00:00.000Z" }, now).ok).toBe(false);
  });
});

describe("scheduled delivery + resend", () => {
  it("a future-dated gift cannot be claimed early; the sweep delivers it once", async () => {
    const future = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const bought = await buyGift({ deliveryAt: future, idempotencyKey: "gift-intent-future" });
    expect(bought.status).toBe(201);
    expect(bought.body.gift.status).toBe("scheduled");
    const giftId = bought.body.gift.id as string;
    expect(h.emails.length).toBe(0); // not delivered yet

    const early = await post(`/product-gifts/${giftId}/claim`, RECIPIENT_H, {});
    expect(early.status).toBe(409);
    expect(early.body.error).toBe("NOT_DELIVERED");

    await h.db.execute(sql`UPDATE product_gifts SET delivery_at = now() - interval '1 minute' WHERE id = ${giftId}`);
    const mine1 = await get("/product-gifts/mine", RECIPIENT_H);
    expect(mine1.body.received[0].status).toBe("awaiting_claim");
    expect(h.emails.length).toBe(1); // delivered exactly once by the sweep
    const mine2 = await get("/product-gifts/mine", RECIPIENT_H);
    expect(mine2.body.received[0].status).toBe("awaiting_claim");
    expect(h.emails.length).toBe(1); // no second delivery

    const claim = await post(`/product-gifts/${giftId}/claim`, RECIPIENT_H, {});
    expect(claim.status).toBe(200);
  });

  it("resend is buyer-only, throttled to one per hour, and stops at claim", async () => {
    const bought = await buyGift();
    const giftId = bought.body.gift.id as string;

    const byRecipient = await post(`/product-gifts/${giftId}/resend`, RECIPIENT_H, {});
    expect(byRecipient.status).toBe(404);

    const resent = await post(`/product-gifts/${giftId}/resend`, BUYER_H, {});
    expect(resent.status).toBe(200);
    expect(resent.body.gift.resendCount).toBe(1);

    const tooSoon = await post(`/product-gifts/${giftId}/resend`, BUYER_H, {});
    expect(tooSoon.status).toBe(409);
    expect(tooSoon.body.error).toBe("CANNOT_RESEND");

    await post(`/product-gifts/${giftId}/claim`, RECIPIENT_H, {});
    const afterClaim = await post(`/product-gifts/${giftId}/resend`, BUYER_H, {});
    expect(afterClaim.status).toBe(409);
  });
});
