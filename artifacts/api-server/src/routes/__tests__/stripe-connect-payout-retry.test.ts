/**
 * Payout retry reconciliation (money-hardening round 2, area 2) —
 * a transfer that landed at Stripe while its response was lost must
 * be ADOPTED on the next payout attempt, never paid a second time.
 *
 * The hole this pins: POST /connect/payout flips a payout row to
 * 'failed' when createPayoutTransfer throws — including when Stripe
 * processed the transfer and only the RESPONSE was lost. The row
 * then carries no transfer id, the earnings read payable again, and
 * a seller retry minted a NEW payout row with a NEW Stripe
 * idempotency key: the same earnings paid twice. Nothing anywhere
 * reconciled 'failed' rows against Stripe (no job, no transfer
 * webhook).
 *
 * The fix rides three pieces: the transfer now carries its payout id
 * in Stripe metadata; before minting anything, the payout route asks
 * Stripe (findTransferForPayout) about every failed payout whose
 * outcome is unknown (no transfer id recorded) and adopts a landed
 * transfer; and if Stripe can't be asked, the route fails closed
 * (503) instead of sending money it cannot prove wasn't sent.
 *
 * The fake lib below keeps a transfer registry exactly like Stripe:
 * a create that "loses its response" still records the transfer.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { newDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomUUID } from "node:crypto";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE_ID = "22222222-2222-4222-8222-222222222222";

const h = vi.hoisted(() => ({
  db: null as any,
  transfers: new Map<string, { id: string; amount: number }>(),
  transferSeq: 0,
  loseNextResponse: false,
  failNextClean: false,
  lookupThrows: false,
}));

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
  persistConnectFlags: async () => undefined,
  connectStateFromStored: (f: any) => ({
    onboarded: f.onboarded, chargesEnabled: f.chargesEnabled, payoutsEnabled: f.payoutsEnabled,
    state: "verified", actionNeeded: [],
  }),
  getUserEmail: async () => "creator@example.com",
  createPayoutTransfer: async (_accountId: string, amount: number, _key: string, metadata?: { payoutId: string }) => {
    if (h.failNextClean) {
      h.failNextClean = false;
      throw new Error("Stripe rejected the transfer (nothing landed)");
    }
    const id = `tr_test_${++h.transferSeq}`;
    if (metadata?.payoutId) h.transfers.set(metadata.payoutId, { id, amount });
    if (h.loseNextResponse) {
      h.loseNextResponse = false;
      throw new Error("network: response lost after Stripe processed the transfer");
    }
    return { id };
  },
  findTransferForPayout: async (_accountId: string, payoutId: string) => {
    if (h.lookupThrows) throw new Error("Stripe unreachable");
    const t = h.transfers.get(payoutId);
    return t ? { id: t.id } : null;
  },
}));

import router from "../stripe-connect";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

/* Same ledgers as stripe-connect-payout-guard.test.ts, MINUS the
   production partial unique index: pg-mem does not maintain partial
   index entries on UPDATE (a row flipped processing → failed stays
   visible to the planner only through its stale 'processing' entry,
   so profile-scoped SELECTs silently miss it — proven in isolation
   during this lane). Real Postgres maintains the index correctly;
   the arbiter behavior the index exists for is owned by the
   payout-guard suite, which keeps it. */
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
  h.transfers.clear();
  h.transferSeq = 0;
  h.loseNextResponse = false;
  h.failNextClean = false;
  h.lookupThrows = false;
  await seed();
});

async function callPayout() {
  const r = await realFetch(`${baseUrl}/connect/payout`, { method: "POST" });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}

async function payoutRows(): Promise<Array<Record<string, unknown>>> {
  const r = await h.db.execute(`SELECT id, amount_cents, status, stripe_transfer_id FROM creator_payouts ORDER BY created_at`);
  return r.rows as Array<Record<string, unknown>>;
}

describe("POST /connect/payout — retry reconciliation", () => {
  it("a transfer that landed while its response was lost is ADOPTED on retry — never paid twice", async () => {
    h.loseNextResponse = true;
    const first = await callPayout();
    expect(first.status).toBe(500);
    let rows = await payoutRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!["status"]).toBe("failed");
    expect(rows[0]!["stripe_transfer_id"]).toBeNull();
    expect(h.transfers.size).toBe(1); // the money DID move at Stripe

    const retry = await callPayout();
    expect(retry.status).toBe(200);
    expect(retry.json.recovered).toBe(true);
    expect(retry.json.payout.id).toBe(String(rows[0]!["id"]));
    expect(retry.json.payout.stripeTransferId).toBe(h.transfers.get(String(rows[0]!["id"]))!.id);

    rows = await payoutRows();
    expect(rows).toHaveLength(1); // no second payout row
    expect(rows[0]!["status"]).toBe("pending");
    expect(rows[0]!["stripe_transfer_id"]).not.toBeNull();
    expect(h.transfers.size).toBe(1); // and no second transfer — the double-pay is closed
  });

  it("a transfer that truly never landed retries clean — one new payout, one transfer total", async () => {
    h.failNextClean = true;
    const first = await callPayout();
    expect(first.status).toBe(500);
    expect(h.transfers.size).toBe(0);

    const retry = await callPayout();
    expect(retry.status).toBe(200);
    expect(retry.json.payout.amountCents).toBe(500);
    const rows = await payoutRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]!["status"]).toBe("failed");
    expect(rows[1]!["status"]).toBe("pending");
    expect(h.transfers.size).toBe(1);
  });

  it("when Stripe can't be asked about an unknown-outcome failure, the route fails closed — no new money moves", async () => {
    /* An earlier attempt failed with an unknown outcome, and its
       transfer IS sitting at Stripe — but the lookup itself is down. */
    const orphanId = randomUUID();
    await h.db.execute(
      `INSERT INTO creator_payouts (id, profile_id, amount_cents, status) VALUES ('${orphanId}', '${PROFILE_ID}', 500, 'failed')`,
    );
    h.transfers.set(orphanId, { id: "tr_orphan", amount: 500 });
    h.lookupThrows = true;

    const res = await callPayout();
    expect(res.status).toBe(503);
    expect(res.json.error).toBe("PAYOUT_VERIFY_FAILED");
    const rows = await payoutRows();
    expect(rows).toHaveLength(1); // nothing new was minted
    expect(rows[0]!["status"]).toBe("failed");
    expect(h.transfers.size).toBe(1); // and nothing new was sent
  });

  it("control: a clean payout stamps its payout id on the transfer (the handle adoption reads)", async () => {
    const res = await callPayout();
    expect(res.status).toBe(200);
    const rows = await payoutRows();
    expect(rows).toHaveLength(1);
    expect(h.transfers.get(String(rows[0]!["id"]))!.id).toBe(res.json.payout.stripeTransferId);
  });
});
