/**
 * Feature Verse Market (Stack-200 N7) — route tests.
 *
 * Real DB semantics via pg-mem (@workspace/db swapped for the
 * in-memory instance); the credits rail is mocked so money moves are
 * counted exactly. Pins: no delivery before BOTH signatures, escrow
 * exactly-once hold/release/refund, declined/unsigned = no fee taken
 * (funding is gated on both signatures), held-fee refund IN FULL,
 * splits validated by the publishing-splits rail, terms frozen once
 * signed, and a creator with no listing is not buyable.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const testState = vi.hoisted(() => ({ db: null as any, userId: "" }));
const money = vi.hoisted(() => ({
  charges: [] as Array<{ userId: string; amount: number; key?: string | null }>,
  credits: [] as Array<{ userId: string; amount: number; action: string }>,
  outOfCredits: false,
}));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = testState.userId;
    next();
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return testState.db; } };
});

const errs = vi.hoisted(() => ({
  OutOfCreditsError: class OutOfCreditsError extends Error {},
  LedgerWriteError: class LedgerWriteError extends Error {},
}));

vi.mock("../../lib/credits", () => ({
  chargeCredits: vi.fn(async (userId: string, amount: number, _rec: unknown, opts?: { idempotencyKey?: string }) => {
    if (money.outOfCredits) throw new errs.OutOfCreditsError();
    money.charges.push({ userId, amount, key: opts?.idempotencyKey ?? null });
    return 0;
  }),
  refundCredits: vi.fn(async (userId: string, amount: number, rec: { action: string }) => {
    money.credits.push({ userId, amount, action: rec.action });
  }),
  OutOfCreditsError: errs.OutOfCreditsError,
  LedgerWriteError: errs.LedgerWriteError,
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

import router from "../feature-verse";
import { newDb, DataType } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";

/* pg-mem shim in the courses-suite pattern: register gen_random_uuid,
   strip drizzle's `types` + `rowMode: 'array'` config (pg-mem can't
   produce array rows) and rebuild array rows from field order. */
function createFeatureVerseTestDb() {
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: DataType.uuid,
    implementation: () => randomUUID(),
    impure: true,
  });
  mem.public.none(DDL);
  const pg = mem.adapters.createPg();
  const pool = new pg.Pool();
  const shim = {
    query: async (config: unknown, values?: unknown[]) => {
      let cfg: unknown = config;
      let wantArray = false;
      if (cfg !== null && typeof cfg === "object" && !Array.isArray(cfg)) {
        const { types: _t, rowMode, ...rest } = cfg as Record<string, unknown>;
        wantArray = rowMode === "array";
        cfg = rest;
      }
      const result = (await (pool as unknown as { query: (c: unknown, v?: unknown[]) => Promise<any> }).query(cfg, values)) as any;
      if (wantArray && Array.isArray(result?.rows) && result.rows.length > 0) {
        const names = Object.keys(result.rows[0]);
        return { ...result, rows: result.rows.map((row: any) => names.map((n: string) => row[n])) };
      }
      return result;
    },
  };
  return { mem, db: drizzle(shim as never) };
}

const DDL = `
CREATE TABLE feature_verse_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_user_id uuid NOT NULL,
  creator_name text NOT NULL DEFAULT 'Creator',
  price_vb integer NOT NULL CHECK (price_vb > 0),
  title text NOT NULL DEFAULT 'Feature verse',
  description text NOT NULL DEFAULT '',
  turnaround_days integer,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX feature_verse_listings_creator_key ON feature_verse_listings (creator_user_id);
CREATE TABLE feature_verse_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL,
  buyer_user_id uuid NOT NULL,
  creator_user_id uuid NOT NULL,
  price_vb integer NOT NULL CHECK (price_vb > 0),
  track_context text NOT NULL DEFAULT '',
  usage_terms text NOT NULL DEFAULT '',
  deadline_ask text,
  splits jsonb NOT NULL,
  status text NOT NULL DEFAULT 'terms_proposed',
  escrow_status text NOT NULL DEFAULT 'none',
  buyer_signed_at timestamptz,
  creator_signed_at timestamptz,
  sign_by timestamptz NOT NULL,
  escrow_held_at timestamptz,
  delivery_note text,
  delivery_url text,
  delivered_at timestamptz,
  dispute_reason text,
  disputed_at timestamptz,
  released_at timestamptz,
  refunded_at timestamptz,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX feature_verse_orders_idempotency_key ON feature_verse_orders (idempotency_key);
CREATE TABLE feature_verse_escrow_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  kind text NOT NULL,
  amount_vb integer NOT NULL CHECK (amount_vb > 0),
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX feature_verse_escrow_ledger_key ON feature_verse_escrow_ledger (idempotency_key);
`;

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;
const BUYER = randomUUID();
const CREATOR = randomUUID();
const STRANGER = randomUUID();
const PRICE = 2500;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

beforeEach(async () => {
  const { db } = createFeatureVerseTestDb();
  testState.db = db;
  testState.userId = BUYER;
  money.charges = [];
  money.credits = [];
  money.outOfCredits = false;
});

async function req(method: string, path: string, body?: unknown) {
  const r = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}
function asUser(id: string) { testState.userId = id; }

async function seedListing(price = PRICE): Promise<string> {
  asUser(CREATOR);
  const { status, json } = await req("PUT", "/feature-verse/listings/mine", {
    priceVb: price, title: "Feature verse", creatorName: "Verse Seller",
  });
  expect(status).toBe(200);
  asUser(BUYER);
  return json.listing.id;
}

const SPLITS = [
  { name: "Buyer", sharePct: 50 },
  { name: "Verse Seller", sharePct: 50 },
];

async function seedOrder(listingId: string, key = "order-key-0001") {
  asUser(BUYER);
  const { status, json } = await req("POST", "/feature-verse/orders", {
    listingId,
    trackContext: "Second single, needs a 16-bar feature.",
    usageTerms: "Feature on this track only; both names credited.",
    splits: SPLITS,
    idempotencyKey: key,
  });
  expect(status).toBe(201);
  return json.order.id as string;
}

async function signBoth(orderId: string) {
  asUser(BUYER);
  expect((await req("POST", `/feature-verse/orders/${orderId}/sign`)).status).toBe(200);
  asUser(CREATOR);
  expect((await req("POST", `/feature-verse/orders/${orderId}/sign`)).status).toBe(200);
}

async function fund(orderId: string) {
  asUser(BUYER);
  return req("POST", `/feature-verse/orders/${orderId}/fund`);
}

async function ledgerCount(kind: string): Promise<number> {
  const { sql } = await import("drizzle-orm");
  const res = await testState.db.execute(sql`SELECT kind FROM feature_verse_escrow_ledger WHERE kind = ${kind}`);
  return res.rows.length;
}

describe("listings", () => {
  it("creator sets their OWN price; no listing = not buyable", async () => {
    const empty = await req("GET", "/feature-verse/listings");
    expect(empty.json.listings).toHaveLength(0);
    const byCreator = await req("GET", `/feature-verse/listings/by-creator/${CREATOR}`);
    expect(byCreator.json.listing).toBeNull();

    const listingId = await seedListing();
    const market = await req("GET", "/feature-verse/listings");
    expect(market.json.listings).toHaveLength(1);
    expect(market.json.listings[0].priceVb).toBe(PRICE);
    expect(market.json.listings[0].id).toBe(listingId);
  });

  it("rejects a non-positive or fractional price", async () => {
    asUser(CREATOR);
    expect((await req("PUT", "/feature-verse/listings/mine", { priceVb: 0 })).status).toBe(400);
    expect((await req("PUT", "/feature-verse/listings/mine", { priceVb: 10.5 })).status).toBe(400);
  });

  it("ordering from a missing listing 404s; self-buy 400s", async () => {
    const missing = await req("POST", "/feature-verse/orders", {
      listingId: randomUUID(), trackContext: "x", usageTerms: "y", splits: SPLITS, idempotencyKey: "k-missing-1",
    });
    expect(missing.status).toBe(404);
    const listingId = await seedListing();
    asUser(CREATOR);
    const self = await req("POST", "/feature-verse/orders", {
      listingId, trackContext: "x", usageTerms: "y", splits: SPLITS, idempotencyKey: "k-self-0001",
    });
    expect(self.status).toBe(400);
  });
});

describe("orders + splits + signing gate", () => {
  it("rejects splits that do not sum to 100 (publishing-splits rail)", async () => {
    const listingId = await seedListing();
    const { status, json } = await req("POST", "/feature-verse/orders", {
      listingId, trackContext: "x", usageTerms: "y",
      splits: [{ name: "Buyer", sharePct: 60 }],
      idempotencyKey: "k-badsplit-1",
    });
    expect(status).toBe(400);
    expect(json.error).toMatch(/total 100%/);
  });

  it("create is idempotent — a retry returns the original order", async () => {
    const listingId = await seedListing();
    const id = await seedOrder(listingId);
    const again = await req("POST", "/feature-verse/orders", {
      listingId, trackContext: "Second single, needs a 16-bar feature.",
      usageTerms: "Feature on this track only; both names credited.",
      splits: SPLITS, idempotencyKey: "order-key-0001",
    });
    expect(again.status).toBe(200);
    expect(again.json.order.id).toBe(id);
  });

  it("NO DELIVERY before both signatures — and no funding either", async () => {
    const listingId = await seedListing();
    const orderId = await seedOrder(listingId);

    asUser(CREATOR);
    const early = await req("POST", `/feature-verse/orders/${orderId}/deliver`, { deliveryNote: "done" });
    expect(early.status).toBe(409);
    expect(early.json.error).toMatch(/No delivery before both parties sign/);

    /* buyer signs alone — still shut */
    asUser(BUYER);
    await req("POST", `/feature-verse/orders/${orderId}/sign`);
    const fundEarly = await req("POST", `/feature-verse/orders/${orderId}/fund`);
    expect(fundEarly.status).toBe(409);
    expect(money.charges).toHaveLength(0);

    asUser(CREATOR);
    const stillEarly = await req("POST", `/feature-verse/orders/${orderId}/deliver`, { deliveryNote: "done" });
    expect(stillEarly.status).toBe(409);
  });

  it("terms freeze once any signature exists", async () => {
    const listingId = await seedListing();
    const orderId = await seedOrder(listingId);
    asUser(BUYER);
    const amend = await req("PATCH", `/feature-verse/orders/${orderId}/terms`, { usageTerms: "Updated terms." });
    expect(amend.status).toBe(200);
    await req("POST", `/feature-verse/orders/${orderId}/sign`);
    const frozen = await req("PATCH", `/feature-verse/orders/${orderId}/terms`, { usageTerms: "Sneaky change." });
    expect(frozen.status).toBe(409);
    expect(frozen.json.error).toMatch(/frozen/);
  });

  it("strangers cannot see or act on an order", async () => {
    const listingId = await seedListing();
    const orderId = await seedOrder(listingId);
    asUser(STRANGER);
    expect((await req("GET", `/feature-verse/orders/${orderId}`)).status).toBe(404);
    expect((await req("POST", `/feature-verse/orders/${orderId}/sign`)).status).toBe(404);
  });
});

describe("escrow lifecycle — exactly once", () => {
  it("full happy path: sign → hold once → deliver → release once", async () => {
    const listingId = await seedListing();
    const orderId = await seedOrder(listingId);
    await signBoth(orderId);

    const funded = await fund(orderId);
    expect(funded.status).toBe(200);
    expect(funded.json.order.status).toBe("escrow_held");
    expect(money.charges).toEqual([{ userId: BUYER, amount: PRICE, key: `feature-verse:${orderId}:hold` }]);
    expect(await ledgerCount("hold")).toBe(1);

    /* fund replay: no second charge, no second ledger row */
    const replay = await fund(orderId);
    expect(replay.status).toBe(200);
    expect(money.charges).toHaveLength(1);
    expect(await ledgerCount("hold")).toBe(1);

    asUser(CREATOR);
    const delivered = await req("POST", `/feature-verse/orders/${orderId}/deliver`, { deliveryNote: "Verse delivered." });
    expect(delivered.status).toBe(200);
    expect(delivered.json.order.status).toBe("delivered");

    asUser(BUYER);
    const released = await req("POST", `/feature-verse/orders/${orderId}/confirm`);
    expect(released.status).toBe(200);
    expect(released.json.order.status).toBe("released");
    expect(money.credits).toEqual([{ userId: CREATOR, amount: PRICE, action: "Feature Verse — escrow release" }]);
    expect(await ledgerCount("release")).toBe(1);

    /* confirm replay: creator is NOT credited twice */
    const again = await req("POST", `/feature-verse/orders/${orderId}/confirm`);
    expect(again.status).toBe(200);
    expect(money.credits).toHaveLength(1);
    expect(await ledgerCount("release")).toBe(1);
  });

  it("insufficient balance: hold fails, no ledger row kept, order stays signed", async () => {
    const listingId = await seedListing();
    const orderId = await seedOrder(listingId);
    await signBoth(orderId);
    money.outOfCredits = true;
    asUser(BUYER);
    const res = await req("POST", `/feature-verse/orders/${orderId}/fund`);
    expect(res.status).toBe(402);
    expect(await ledgerCount("hold")).toBe(0);
  });

  it("dispute keeps the fee held; refund returns it IN FULL, exactly once", async () => {
    const listingId = await seedListing();
    const orderId = await seedOrder(listingId);
    await signBoth(orderId);
    await fund(orderId);
    asUser(CREATOR);
    await req("POST", `/feature-verse/orders/${orderId}/deliver`, { deliveryNote: "Verse delivered." });

    asUser(BUYER);
    const disputed = await req("POST", `/feature-verse/orders/${orderId}/dispute`, { reason: "Wrong verse delivered." });
    expect(disputed.status).toBe(200);
    expect(disputed.json.order.status).toBe("disputed");
    expect(disputed.json.order.escrowStatus).toBe("held");
    expect(money.credits).toHaveLength(0);

    const refunded = await req("POST", `/feature-verse/orders/${orderId}/refund`);
    expect(refunded.status).toBe(200);
    expect(refunded.json.order.status).toBe("refunded");
    expect(money.credits).toEqual([
      { userId: BUYER, amount: PRICE, action: "Feature Verse — escrow refund (full)" },
    ]);
    expect(await ledgerCount("refund")).toBe(1);

    const again = await req("POST", `/feature-verse/orders/${orderId}/refund`);
    expect(again.status).toBe(200);
    expect(money.credits).toHaveLength(1);
    expect(await ledgerCount("refund")).toBe(1);
  });

  it("only the creator delivers, only the buyer confirms/funds", async () => {
    const listingId = await seedListing();
    const orderId = await seedOrder(listingId);
    await signBoth(orderId);
    asUser(CREATOR);
    expect((await req("POST", `/feature-verse/orders/${orderId}/fund`)).status).toBe(403);
    await fund(orderId);
    asUser(BUYER);
    expect((await req("POST", `/feature-verse/orders/${orderId}/deliver`, { deliveryNote: "x" })).status).toBe(403);
    asUser(CREATOR);
    await req("POST", `/feature-verse/orders/${orderId}/deliver`, { deliveryNote: "Verse delivered." });
    expect((await req("POST", `/feature-verse/orders/${orderId}/confirm`)).status).toBe(403);
  });
});

describe("unsigned / declined / expired — no fee ever kept", () => {
  it("declined by the creator: no charge ever happened", async () => {
    const listingId = await seedListing();
    const orderId = await seedOrder(listingId);
    asUser(CREATOR);
    const declined = await req("POST", `/feature-verse/orders/${orderId}/decline`);
    expect(declined.status).toBe(200);
    expect(declined.json.order.status).toBe("declined");
    expect(money.charges).toHaveLength(0);
    expect(money.credits).toHaveLength(0);
    expect(await ledgerCount("hold")).toBe(0);
  });

  it("expired unaccepted: window closes, no fee taken, signing refused", async () => {
    const listingId = await seedListing();
    const orderId = await seedOrder(listingId);
    const { sql } = await import("drizzle-orm");
    await testState.db.execute(sql`UPDATE feature_verse_orders SET sign_by = ${new Date(Date.now() - 1000).toISOString()} WHERE id = ${orderId}`);
    asUser(BUYER);
    const got = await req("GET", `/feature-verse/orders/${orderId}`);
    expect(got.json.order.status).toBe("expired_unaccepted");
    expect(money.charges).toHaveLength(0);
    const sign = await req("POST", `/feature-verse/orders/${orderId}/sign`);
    expect(sign.status).toBe(409);
  });
});
