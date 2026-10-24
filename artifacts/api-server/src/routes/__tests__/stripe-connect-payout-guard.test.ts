/**
 * Payout double-submit guard — the drizzle error-shape pin (lane 12).
 *
 * POST /api/connect/payout inserts the 'processing' payout row FIRST;
 * the partial unique index creator_payouts_profile_processing_ux is
 * the arbiter against a concurrent second payout, whose INSERT must
 * come back as 409 PAYOUT_IN_FLIGHT.
 *
 * The trap this pins: on the production drizzle path the 23505 arrives
 * wrapped in a DrizzleQueryError (code on .cause, no top-level code),
 * and the route used to read the top-level code — so the guard NEVER
 * fired and the concurrent request got a raw 500 instead of the
 * honest 409. This harness runs the REAL drizzle session over pg-mem
 * with the production index in place, so the error the route catches
 * here is the genuine wrapped production shape, not a hand-made fake.
 * (The unique index itself always blocked the double payout; what
 * broke was the response contract — and any future refactor that
 * trusts the 409 path for control flow.)
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { newDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomUUID } from "node:crypto";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE_ID = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({ db: null as any, transfers: 0 }));

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
  createPayoutTransfer: async () => {
    h.transfers += 1;
    return { id: "tr_test_123" };
  },
  getUserEmail: async () => "creator@example.com",
}));

import router from "../stripe-connect";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

/* Same ledgers as stripe-connect-settlement.test.ts, PLUS the
   production partial unique index (migration P0-10) that settlement's
   DDL omits — without it the guard insert can never fail. */
const DDL = `
  CREATE TABLE creator_profiles (id uuid PRIMARY KEY, user_id uuid NOT NULL);
  CREATE TABLE digital_sales (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL, creator_amount_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'completed');
  CREATE TABLE store_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), profile_id uuid NOT NULL, creator_amount_cents integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'completed');
  CREATE TABLE creator_payouts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id uuid NOT NULL, amount_cents integer NOT NULL CHECK (amount_cents > 0),
    stripe_transfer_id text, status text NOT NULL DEFAULT 'pending',
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX creator_payouts_profile_processing_ux
    ON creator_payouts (profile_id) WHERE status = 'processing';
  CREATE TABLE sponsor_payouts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_user_id text NOT NULL, net_cents integer NOT NULL, status text NOT NULL,
    settled_payout_id uuid, settled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE fan_members (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL, price_cents integer NOT NULL DEFAULT 0, stripe_session_id text,
    status text NOT NULL DEFAULT 'active',
    settled_payout_id uuid, settled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE shop_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL, event_type text NOT NULL,
    amount_cents integer NOT NULL DEFAULT 0, platform_fee_cents integer NOT NULL DEFAULT 0,
    settled_payout_id uuid, settled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  , affiliate_code text, bump_for_product_id uuid);
`;

async function seed() {
  await h.db.execute(`INSERT INTO creator_profiles (id, user_id) VALUES ('${PROFILE_ID}', '${USER_ID}')`);
  await h.db.execute(`INSERT INTO digital_sales (profile_id, creator_amount_cents) VALUES ('${PROFILE_ID}', 500)`);
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
  h.transfers = 0;
  await seed();
});

async function callPayout() {
  const r = await realFetch(`${baseUrl}/connect/payout`, { method: "POST" });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

async function payoutRows(): Promise<Array<Record<string, unknown>>> {
  const r = await h.db.execute(`SELECT id, status FROM creator_payouts ORDER BY created_at`);
  return r.rows as Array<Record<string, unknown>>;
}

describe("POST /connect/payout — the in-flight guard (23505 through drizzle)", () => {
  it("a payout already processing → 409 PAYOUT_IN_FLIGHT, no second row, no transfer", async () => {
    /* An in-flight payout of 300 against 500 pending: the pending
       formula nets in-flight payouts out, leaving 200 ≥ the $1
       minimum — so the request legitimately reaches the guarded
       INSERT, which is exactly where a true concurrent second
       request would land too. */
    await h.db.execute(
      `INSERT INTO creator_payouts (profile_id, amount_cents, status) VALUES ('${PROFILE_ID}', 300, 'processing')`,
    );

    const res = await callPayout();
    expect(res.status).toBe(409);
    expect(res.json.error).toBe("PAYOUT_IN_FLIGHT");

    const rows = await payoutRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("processing");
    expect(h.transfers).toBe(0);
  });

  it("control: no payout in flight → the payout goes through (guard does not over-fire)", async () => {
    const res = await callPayout();
    expect(res.status).toBe(200);
    expect(res.json.payout.amountCents).toBe(500);
    expect(h.transfers).toBe(1);
    const rows = await payoutRows();
    expect(rows).toHaveLength(1);
  });
});
