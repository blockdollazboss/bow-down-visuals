/**
 * Stack 8 #5 — unified earnings view tests.
 * One picture per creator over the existing ledgers, with honest zeros:
 * no rows → 0 with status ok; a failing source → status "error", null
 * totals, partial: true — never a fake 0. Tip units stay separate:
 * stream tips are Visual Bucs (never added to the USD total) and
 * tip-jar intents are pending_payment (never counted as earnings).
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";

const testState = vi.hoisted(() => ({ db: null as any, userId: "", ddl: "" }));

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.userId = testState.userId; next(); },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return testState.db; } };
});

import earningsRouter from "../earnings";
import { __resetTipJarStores } from "../generate/tip-jar";
import { createTestDb } from "../../lib/__tests__/test-db";
import { sql } from "drizzle-orm";

const DDL = `
CREATE TABLE creator_profiles (id uuid PRIMARY KEY, user_id uuid NOT NULL, slug text);
CREATE TABLE store_orders (
  id uuid PRIMARY KEY, profile_id uuid NOT NULL, amount_cents integer NOT NULL DEFAULT 0,
  creator_amount_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'completed'
);
CREATE TABLE shop_events (
  id uuid PRIMARY KEY, shop_id uuid, user_id uuid NOT NULL, event_type text NOT NULL,
  amount_cents integer NOT NULL DEFAULT 0, platform_fee_cents integer NOT NULL DEFAULT 0
);
CREATE TABLE fan_members (
  id uuid PRIMARY KEY, user_id uuid NOT NULL, price_cents integer NOT NULL DEFAULT 0,
  stripe_session_id text, status text NOT NULL DEFAULT 'active'
);
CREATE TABLE live_stream_tips (
  id uuid PRIMARY KEY, creator_user_id uuid NOT NULL, amount_vb integer NOT NULL DEFAULT 0,
  creator_credited_at timestamptz
);
CREATE TABLE sponsor_payouts (
  id uuid PRIMARY KEY, creator_user_id text NOT NULL, net_cents integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'released'
);`;

const realFetch = globalThis.fetch;
let server: any; let baseUrl: string;
const USER = randomUUID();
const OTHER = randomUUID();
const PROFILE = randomUUID();

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => { req.log = { error: () => {}, info: () => {} }; next(); });
  app.use(earningsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((r) => server.close(() => r())); });

function freshDb(ddl = DDL) {
  const { db, mem } = createTestDb();
  mem.public.none(ddl);
  testState.db = db;
  testState.userId = USER;
  __resetTipJarStores();
}

beforeEach(() => freshDb());

async function get() {
  const r = await realFetch(`${baseUrl}/earnings`);
  return { status: r.status, json: (await r.json()) as any };
}

describe("GET /earnings", () => {
  it("honest zeros: a creator with no data reads 0 everywhere, nothing partial", async () => {
    const { status, json } = await get();
    expect(status).toBe(200);
    expect(json.totalCents).toBe(0);
    expect(json.totalTipsVb).toBe(0);
    expect(json.partial).toBe(false);
    expect(json.sources.storeSales).toMatchObject({ status: "ok", totalCents: 0, count: 0 });
    expect(json.sources.memberships).toMatchObject({ status: "ok", totalCents: 0, count: 0 });
    expect(json.sources.brandDeals).toMatchObject({ status: "ok", totalCents: 0, count: 0 });
    expect(json.sources.tips).toMatchObject({ status: "ok", streamTipsVb: 0, tipJarPendingCents: 0 });
  });

  it("aggregates every source for the owner only, units kept separate", async () => {
    const db = testState.db;
    await db.execute(sql`INSERT INTO creator_profiles (id, user_id, slug) VALUES (${PROFILE}, ${USER}, 'me')`);
    await db.execute(sql`INSERT INTO store_orders (id, profile_id, amount_cents, creator_amount_cents, status) VALUES (${randomUUID()}, ${PROFILE}, 10000, 9000, 'completed')`);
    await db.execute(sql`INSERT INTO store_orders (id, profile_id, amount_cents, creator_amount_cents, status) VALUES (${randomUUID()}, ${PROFILE}, 5000, 4500, 'refunded')`);
    await db.execute(sql`INSERT INTO shop_events (id, user_id, event_type, amount_cents, platform_fee_cents) VALUES (${randomUUID()}, ${USER}, 'sale', 2000, 200)`);
    await db.execute(sql`INSERT INTO shop_events (id, user_id, event_type, amount_cents, platform_fee_cents) VALUES (${randomUUID()}, ${USER}, 'view', 0, 0)`);
    await db.execute(sql`INSERT INTO fan_members (id, user_id, price_cents, stripe_session_id) VALUES (${randomUUID()}, ${USER}, 1500, 'cs_1')`);
    await db.execute(sql`INSERT INTO fan_members (id, user_id, price_cents, stripe_session_id) VALUES (${randomUUID()}, ${USER}, 1500, NULL)`);
    await db.execute(sql`INSERT INTO fan_members (id, user_id, price_cents, stripe_session_id) VALUES (${randomUUID()}, ${OTHER}, 9900, 'cs_2')`);
    await db.execute(sql`INSERT INTO live_stream_tips (id, creator_user_id, amount_vb, creator_credited_at) VALUES (${randomUUID()}, ${USER}, 500, now())`);
    await db.execute(sql`INSERT INTO live_stream_tips (id, creator_user_id, amount_vb, creator_credited_at) VALUES (${randomUUID()}, ${USER}, 300, NULL)`);
    await db.execute(sql`INSERT INTO sponsor_payouts (id, creator_user_id, net_cents, status) VALUES (${randomUUID()}, ${USER}, 8500, 'released')`);
    await db.execute(sql`INSERT INTO sponsor_payouts (id, creator_user_id, net_cents, status) VALUES (${randomUUID()}, ${USER}, 1000, 'pending')`);

    const { json } = await get();
    // store: 9000 (completed only) + shop net 1800 = 10800, count 2
    expect(json.sources.storeSales.totalCents).toBe(10800);
    expect(json.sources.storeSales.count).toBe(2);
    expect(json.sources.storeSales.breakdown).toMatchObject({ profileStoreCents: 9000, shopSalesCents: 1800 });
    // memberships: only the paid-checkout row (stripe_session_id set), not the free/manual row, not other users'
    expect(json.sources.memberships).toMatchObject({ totalCents: 1500, count: 1 });
    // brand deals: released net only
    expect(json.sources.brandDeals).toMatchObject({ totalCents: 8500, count: 1 });
    // total USD = 10800 + 1500 + 8500; VB tips NOT folded in
    expect(json.totalCents).toBe(20800);
    // stream tips: only the credited tip counts
    expect(json.totalTipsVb).toBe(500);
    expect(json.sources.tips.streamTipCount).toBe(1);
    expect(json.partial).toBe(false);
  });

  it("a failing source reads as an error state with null totals — never a fake 0", async () => {
    freshDb(DDL.replace(/CREATE TABLE fan_members[\s\S]*?\);/, ""));
    const { status, json } = await get();
    expect(status).toBe(200);
    expect(json.sources.memberships).toEqual({ status: "error", totalCents: null, count: null });
    expect(json.sources.storeSales.status).toBe("ok");
    expect(json.partial).toBe(true);
    expect(json.totalCents).toBe(0); // sum of the sources that DID load (all zero)
  });
});
