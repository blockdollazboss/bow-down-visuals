/**
 * Payout settlement (0142, DE-14/#8): pendingPayoutCents used to see
 * only digital_sales + store_orders. Released brand deals, paid
 * memberships, and shop sales were earned but unpayable. They now
 * count — settled PER ROW via settled_payout_id so a payout claims
 * exactly the rows it paid for:
 *   - a second payout never re-counts claimed rows (idempotency),
 *   - a FAILED payout un-claims its rows automatically (the pending
 *     formula only honors claims by payouts in active states),
 *   - rows created after a payout was computed are not claimed by it.
 * Fee percentages and VB rules are untouched — this widens WHICH
 * ledgers are payable on the existing test-mode Connect rails.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { newDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomUUID } from "node:crypto";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE_ID = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({ db: null as any }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

vi.mock("../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = USER_ID;
    next();
  },
}));

vi.mock("../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../lib/stripe-connect", () => ({
  getConnectStripe: () => ({}),
  isTestMode: () => true,
  getProfileConnectFields: async () => ({
    accountId: "acct_test_123",
    onboarded: true,
    chargesEnabled: true,
    payoutsEnabled: true,
  }),
  createConnectAccount: async () => ({ id: "acct_test_123" }),
  createOnboardingLink: async () => ({ url: "https://example.com/onboard" }),
  getConnectStatus: async () => ({ onboarded: true, chargesEnabled: true, payoutsEnabled: true }),
  createPayoutTransfer: async () => ({ id: "tr_test_123" }),
  getUserEmail: async () => "creator@example.com",
}));

import router, { pendingPayoutCents, markExtensionRowsSettled } from "../stripe-connect";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

const DDL = `
  CREATE TABLE creator_profiles (id uuid PRIMARY KEY, user_id uuid NOT NULL);
  CREATE TABLE digital_sales (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL, creator_amount_cents integer NOT NULL DEFAULT 0);
  CREATE TABLE store_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL, creator_amount_cents integer NOT NULL DEFAULT 0);
  CREATE TABLE creator_payouts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL, amount_cents integer NOT NULL CHECK (amount_cents > 0),
    stripe_transfer_id text, status text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE sponsor_payouts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_user_id text NOT NULL, net_cents integer NOT NULL, status text NOT NULL,
    settled_payout_id uuid, settled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE fan_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL, price_cents integer NOT NULL DEFAULT 0, stripe_session_id text,
    settled_payout_id uuid, settled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE shop_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL, event_type text NOT NULL,
    amount_cents integer NOT NULL DEFAULT 0, platform_fee_cents integer NOT NULL DEFAULT 0,
    settled_payout_id uuid, settled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
`;

async function seed() {
  await h.db.execute(`INSERT INTO creator_profiles (id, user_id) VALUES ('${PROFILE_ID}', '${USER_ID}')`);
  await h.db.execute(`INSERT INTO digital_sales (profile_id, creator_amount_cents) VALUES ('${PROFILE_ID}', 500)`);
  await h.db.execute(`INSERT INTO store_orders (profile_id, creator_amount_cents) VALUES ('${PROFILE_ID}', 300)`);
  // Released brand deal: payable. Escrowed one + another creator's: not.
  await h.db.execute(`INSERT INTO sponsor_payouts (creator_user_id, net_cents, status) VALUES ('${USER_ID}', 2000, 'released')`);
  await h.db.execute(`INSERT INTO sponsor_payouts (creator_user_id, net_cents, status) VALUES ('${USER_ID}', 9999, 'escrow')`);
  await h.db.execute(`INSERT INTO sponsor_payouts (creator_user_id, net_cents, status) VALUES ('99999999-9999-4999-8999-999999999999', 8888, 'released')`);
  // Paid membership: payable. Intent-only row (no session): not.
  await h.db.execute(`INSERT INTO fan_members (user_id, price_cents, stripe_session_id) VALUES ('${USER_ID}', 1500, 'cs_test_paid')`);
  await h.db.execute(`INSERT INTO fan_members (user_id, price_cents, stripe_session_id) VALUES ('${USER_ID}', 777, NULL)`);
  // Shop sale nets amount − fee. Non-sale events: not earnings.
  await h.db.execute(`INSERT INTO shop_events (user_id, event_type, amount_cents, platform_fee_cents) VALUES ('${USER_ID}', 'sale', 1000, 100)`);
  await h.db.execute(`INSERT INTO shop_events (user_id, event_type, amount_cents, platform_fee_cents) VALUES ('${USER_ID}', 'view', 5000, 0)`);
}

beforeAll(async () => {
  const mem = newDb();
  mem.public.registerFunction({
    name: "gen_random_uuid",
    returns: "uuid" as never,
    implementation: () => randomUUID(),
    impure: true,
  });
  const rawPool = mem.adapters.createPg();
  const pool: any = new rawPool.Pool();
  const rawQuery = pool.query.bind(pool);
  pool.query = (config: any, values?: unknown) => {
    if (config && typeof config === "object" && "types" in config) {
      const { types: _t, ...rest } = config;
      return rawQuery(rest, values);
    }
    return rawQuery(config, values);
  };
  h.db = drizzle(pool);
  await h.db.execute(DDL);

  const app = express();
  app.use(express.json());
  app.use("/api", router);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(() => {
  server.closeAllConnections?.();
  server.close();
});

beforeEach(async () => {
  for (const t of ["creator_profiles", "digital_sales", "store_orders", "creator_payouts", "sponsor_payouts", "fan_members", "shop_events"]) {
    await h.db.execute(`DELETE FROM ${t}`);
  }
  await seed();
});

async function call(method: string, path: string) {
  const r = await realFetch(`${baseUrl}${path}`, { method });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

async function settledCount(table: string): Promise<number> {
  const r = await h.db.execute(`SELECT COUNT(*)::int AS n FROM ${table} WHERE settled_payout_id IS NOT NULL`);
  return r.rows[0].n as number;
}

/* Legacy 800 + deals 2000 + memberships 1500 + shop 900 = 5200. */
const EXPECTED = 5200;

describe("pendingPayoutCents — the widened ledgers (0142)", () => {
  it("counts released deals, paid memberships, and shop sales on top of the legacy ledgers", async () => {
    expect(await pendingPayoutCents(PROFILE_ID)).toBe(EXPECTED);
    const { status, json } = await call("GET", "/connect/status");
    expect(status).toBe(200);
    expect(json.pendingCents).toBe(EXPECTED);
  });

  it("payout claims the extension rows; a second payout finds nothing (idempotent)", async () => {
    const first = await call("POST", "/connect/payout");
    expect(first.status).toBe(200);
    expect(first.json.payout.amountCents).toBe(EXPECTED);

    expect(await settledCount("sponsor_payouts")).toBe(1);
    expect(await settledCount("fan_members")).toBe(1);
    expect(await settledCount("shop_events")).toBe(1);
    expect(await pendingPayoutCents(PROFILE_ID)).toBe(0);

    const second = await call("POST", "/connect/payout");
    expect(second.status).toBe(400);
    expect(second.json.error).toBe("MINIMUM_NOT_MET");
  });

  it("a failed payout un-claims its rows — the money becomes payable again", async () => {
    const first = await call("POST", "/connect/payout");
    expect(first.status).toBe(200);
    await h.db.execute(`UPDATE creator_payouts SET status = 'failed'`);
    expect(await pendingPayoutCents(PROFILE_ID)).toBe(EXPECTED);

    const retry = await call("POST", "/connect/payout");
    expect(retry.status).toBe(200);
    expect(retry.json.payout.amountCents).toBe(EXPECTED);
    expect(retry.json.payout.id).not.toBe(first.json.payout.id);
    // Rows re-stamped to the retry payout, and pending is drained again.
    const stamped = await h.db.execute(
      `SELECT COUNT(*)::int AS n FROM sponsor_payouts WHERE settled_payout_id = '${retry.json.payout.id}'`,
    );
    expect(stamped.rows[0].n).toBe(1);
    expect(await pendingPayoutCents(PROFILE_ID)).toBe(0);
  });

  it("markExtensionRowsSettled does not claim rows created after the payout was computed", async () => {
    await h.db.execute(
      `INSERT INTO sponsor_payouts (creator_user_id, net_cents, status, created_at)
       VALUES ('${USER_ID}', 4242, 'released', now() + interval '1 day')`,
    );
    const payoutId = randomUUID();
    await h.db.execute(
      `INSERT INTO creator_payouts (id, profile_id, amount_cents, status) VALUES ('${payoutId}', '${PROFILE_ID}', 100, 'processing')`,
    );
    await markExtensionRowsSettled(USER_ID, payoutId, new Date().toISOString());
    const future = await h.db.execute(
      `SELECT settled_payout_id FROM sponsor_payouts WHERE net_cents = 4242`,
    );
    expect(future.rows[0].settled_payout_id).toBeNull();
    // The pre-existing released row (created before) WAS claimed.
    expect(await settledCount("sponsor_payouts")).toBe(1);
  });
});
