/**
 * Feature Verse lifecycle fan-out (stack1100 Y3). The order lifecycle
 * ran silently for both parties. These tests walk it end to end and
 * pin every tell: right party, exactly once, idempotent replays
 * silent, VB amounts named as they moved. Harness mirrors
 * feature-verse.test.ts (pg-mem shim + counted credits rail).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const testState = vi.hoisted(() => ({ db: null as any, userId: "" }));

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
  chargeCredits: vi.fn(async () => 0),
  refundCredits: vi.fn(async () => undefined),
  OutOfCreditsError: errs.OutOfCreditsError,
  LedgerWriteError: errs.LedgerWriteError,
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

import router, { __setFeatureVerseEventNotifier, buildFeatureVerseEvent } from "../feature-verse";
import type { UserEventInput } from "../../lib/push-events";
import { newDb, DataType } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";

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
const PRICE = 2500;

let events: UserEventInput[];

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(async () => {
  __setFeatureVerseEventNotifier(null);
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(async () => {
  const { db } = createFeatureVerseTestDb();
  testState.db = db;
  testState.userId = BUYER;
  events = [];
  __setFeatureVerseEventNotifier(async (input) => {
    events.push(input);
  });
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

const SPLITS = [
  { name: "Buyer", sharePct: 50 },
  { name: "Verse Seller", sharePct: 50 },
];

async function seedListing(): Promise<string> {
  asUser(CREATOR);
  const { status, json } = await req("PUT", "/feature-verse/listings/mine", {
    priceVb: PRICE, title: "Feature verse", creatorName: "Verse Seller",
  });
  expect(status).toBe(200);
  asUser(BUYER);
  return json.listing.id;
}

async function seedOrder(listingId: string, key: string) {
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

describe("buildFeatureVerseEvent", () => {
  it("builds a money event linked to /collabs", () => {
    expect(buildFeatureVerseEvent({ userId: "u", kind: "k", title: "t", body: "b" })).toEqual({
      userId: "u",
      category: "money",
      kind: "k",
      title: "t",
      body: "b",
      link: "/collabs",
    });
  });
});

describe("the happy walk tells each party, once", () => {
  it("create → creator; sign → counterparty ×2; fund → creator; deliver → buyer; confirm → creator (replays silent)", async () => {
    const listingId = await seedListing();
    const orderId = await seedOrder(listingId, "walk-key-1");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: CREATOR, kind: "feature_order_created" });
    expect(events[0]!.body).toContain("2500 VB");

    /* Idempotent create replay: the original order returns, no re-tell. */
    asUser(BUYER);
    const replay = await req("POST", "/feature-verse/orders", {
      listingId,
      trackContext: "Second single, needs a 16-bar feature.",
      usageTerms: "Feature on this track only; both names credited.",
      splits: SPLITS,
      idempotencyKey: "walk-key-1",
    });
    expect(replay.status).toBe(200);
    expect(events).toHaveLength(1);

    asUser(BUYER);
    await req("POST", `/feature-verse/orders/${orderId}/sign`);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ userId: CREATOR, kind: "feature_order_signed", title: "Terms signed" });

    asUser(CREATOR);
    await req("POST", `/feature-verse/orders/${orderId}/sign`);
    expect(events).toHaveLength(3);
    expect(events[2]).toMatchObject({ userId: BUYER, kind: "feature_order_signed", title: "Both parties signed" });

    /* Signing again is a no-op success — and silent. */
    await req("POST", `/feature-verse/orders/${orderId}/sign`);
    expect(events).toHaveLength(3);

    asUser(BUYER);
    expect((await req("POST", `/feature-verse/orders/${orderId}/fund`)).status).toBe(200);
    expect(events).toHaveLength(4);
    expect(events[3]).toMatchObject({ userId: CREATOR, kind: "feature_escrow_funded" });
    expect(events[3]!.body).toContain("2500 VB");

    /* Fund replay: silent. */
    expect((await req("POST", `/feature-verse/orders/${orderId}/fund`)).status).toBe(200);
    expect(events).toHaveLength(4);

    asUser(CREATOR);
    expect((await req("POST", `/feature-verse/orders/${orderId}/deliver`, { deliveryNote: "Verse attached in the project." })).status).toBe(200);
    expect(events).toHaveLength(5);
    expect(events[4]).toMatchObject({ userId: BUYER, kind: "feature_delivered" });

    asUser(BUYER);
    expect((await req("POST", `/feature-verse/orders/${orderId}/confirm`)).status).toBe(200);
    expect(events).toHaveLength(6);
    expect(events[5]).toMatchObject({ userId: CREATOR, kind: "feature_escrow_released" });
    expect(events[5]!.body).toContain("2500 VB");

    /* Confirm replay: silent. */
    expect((await req("POST", `/feature-verse/orders/${orderId}/confirm`)).status).toBe(200);
    expect(events).toHaveLength(6);
  });
});

describe("the exit paths tell the other party", () => {
  it("decline → buyer, naming that no fee was taken", async () => {
    const listingId = await seedListing();
    const orderId = await seedOrder(listingId, "exit-decline");
    events = [];
    asUser(CREATOR);
    expect((await req("POST", `/feature-verse/orders/${orderId}/decline`)).status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: BUYER, kind: "feature_order_declined" });
    expect(events[0]!.body).toContain("No fee was taken");
  });

  it("dispute → creator, naming the held VB; creator-initiated refund → buyer, in full", async () => {
    const listingId = await seedListing();
    const orderId = await seedOrder(listingId, "exit-dispute");
    await signBoth(orderId);
    asUser(BUYER);
    await req("POST", `/feature-verse/orders/${orderId}/fund`);
    asUser(CREATOR);
    await req("POST", `/feature-verse/orders/${orderId}/deliver`, { deliveryNote: "Done." });
    events = [];
    asUser(BUYER);
    expect((await req("POST", `/feature-verse/orders/${orderId}/dispute`, { reason: "Wrong hook." })).status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: CREATOR, kind: "feature_disputed" });
    expect(events[0]!.body).toContain("2500 VB");
    expect(events[0]!.body).toContain("Wrong hook.");

    events = [];
    asUser(CREATOR);
    expect((await req("POST", `/feature-verse/orders/${orderId}/refund`)).status).toBe(200);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ userId: BUYER, kind: "feature_escrow_refunded" });
    expect(events[0]!.body).toContain("refunded in full");
  });
});
