/**
 * Connect reconciliation + payout history (payfix payout-build).
 *
 * Pass 6 (Oct 26) proved the live failure: Connect TEST onboarding
 * submitted twice, yet the site still said "isn't verified yet", no
 * payout action was reachable, and no payout history existed. The
 * root causes pinned here, exercised end-to-end with the REAL route +
 * REAL lib/stripe-connect over pg-mem, faking Stripe only at the
 * lib/stripe-client seam:
 *  - GET /connect/status reconciles live and PERSISTS the flags
 *    (self-heal) and returns the state machine + Stripe's reasons.
 *  - POST /connect/payout gates on the reconciled state: refuses
 *    unverified (with the reason), refuses zero, and pays exactly
 *    once — a replay after success is a refusal, never a 2nd transfer,
 *    and pending is decremented exactly once.
 *  - GET /connect/payouts lists the recorded payout truthfully.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { newDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomUUID } from "node:crypto";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const ACCOUNT_ID = "acct_test_123";

function v2Account(payoutsStatus: string, opts?: { userEntries?: string[]; statusCode?: string }) {
  return {
    id: ACCOUNT_ID,
    configuration: {
      recipient: {
        capabilities: {
          stripe_balance: {
            stripe_transfers: { status: "active", status_details: [] },
            payouts: {
              status: payoutsStatus,
              status_details: opts?.statusCode ? [{ code: opts.statusCode }] : [],
            },
          },
        },
      },
    },
    requirements: {
      entries: (opts?.userEntries ?? []).map((description) => ({
        awaiting_action_from: "user",
        description,
        errors: [{ description }],
      })),
    },
  };
}

const h = vi.hoisted(() => ({
  db: null as any,
  transfers: 0,
  account: null as any,
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

vi.mock("../../lib/supabase-admin", () => ({
  getSupabaseAdmin: () => {
    throw new Error("no supabase in tests");
  },
}));

/* The ONLY fake: the Stripe client itself. retrieve returns the
   hoisted account; transfers are counted, never real. */
vi.mock("../../lib/stripe-client", () => ({
  createGuardedStripeClient: () => ({
    v2: {
      core: {
        accounts: {
          retrieve: async () => h.account,
          create: async () => ({ id: "acct_new" }),
        },
        accountLinks: { create: async () => ({ url: "https://example.com/onboard" }) },
      },
    },
    transfers: {
      create: async () => {
        h.transfers += 1;
        return { id: `tr_test_${h.transfers}` };
      },
    },
  }),
  isStripeTestModeKey: () => true,
}));

import router from "../stripe-connect";

const realFetch = globalThis.fetch;
let server: any;
let baseUrl: string;

/* NOTE on the DDL below: the partial unique index
   creator_payouts_profile_processing_ux is deliberately OMITTED
   (same choice as stripe-connect-settlement.test.ts): pg-mem will
   happily scan that partial index for profile+status queries it
   cannot legally serve, which makes pending read gross after a
   payout. Real Postgres cannot use a partial index whose predicate
   the query does not imply. The 409 in-flight guard the index backs
   is pinned by stripe-connect-payout-guard.test.ts, whose DDL does
   carry the index. */
const DDL = `
  CREATE TABLE creator_profiles (
    id uuid PRIMARY KEY, user_id uuid NOT NULL,
    stripe_connect_account_id text,
    stripe_connect_onboarded boolean NOT NULL DEFAULT false,
    stripe_connect_charges_enabled boolean NOT NULL DEFAULT false,
    stripe_connect_payouts_enabled boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
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

async function seedProfile(withAccount = true) {
  await h.db.execute(
    `INSERT INTO creator_profiles (id, user_id, stripe_connect_account_id)
     VALUES ('${PROFILE_ID}', '${USER_ID}', ${withAccount ? `'${ACCOUNT_ID}'` : "NULL"})`,
  );
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
  h.account = v2Account("active");
  await seedProfile();
});

async function get(path: string) {
  const r = await realFetch(`${baseUrl}${path}`);
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}
async function post(path: string) {
  const r = await realFetch(`${baseUrl}${path}`, { method: "POST" });
  return { status: r.status, json: (await r.json().catch(() => null)) as any };
}
async function storedFlags() {
  const r = await h.db.execute(
    `SELECT stripe_connect_onboarded AS o, stripe_connect_charges_enabled AS c, stripe_connect_payouts_enabled AS p FROM creator_profiles WHERE id = '${PROFILE_ID}'`,
  );
  return r.rows[0] as { o: boolean; c: boolean; p: boolean };
}

describe("GET /connect/status — reconciliation", () => {
  it("live-verified flips the stored flags (self-heal) and reports state=verified", async () => {
    expect((await storedFlags()).p).toBe(false);
    const res = await get("/connect/status");
    expect(res.status).toBe(200);
    expect(res.json.state).toBe("verified");
    expect(res.json.payoutsEnabled).toBe(true);
    /* The heal is the point: the stored flags now agree with Stripe. */
    const flags = await storedFlags();
    expect(flags.p).toBe(true);
    expect(flags.c).toBe(true);
    expect(flags.o).toBe(true);
  });

  it("action_needed carries Stripe's own reasons", async () => {
    h.account = v2Account("pending", {
      userEntries: ["Your ID photo was blurry — upload a clearer one."],
      statusCode: "requirements_past_due",
    });
    const res = await get("/connect/status");
    expect(res.json.state).toBe("action_needed");
    expect(res.json.payoutsEnabled).toBe(false);
    expect(res.json.actionNeeded.join(" ")).toContain("ID photo was blurry");
  });

  it("pending verification (Stripe's side, nothing owed by the seller) is state=pending with no reasons", async () => {
    h.account = v2Account("pending", { statusCode: "requirements_pending_verification" });
    const res = await get("/connect/status");
    expect(res.json.state).toBe("pending");
    expect(res.json.actionNeeded).toEqual([]);
  });

  it("no account → state=not_started", async () => {
    await h.db.execute(`DELETE FROM creator_profiles`);
    await seedProfile(false);
    const res = await get("/connect/status");
    expect(res.json.connected).toBe(false);
    expect(res.json.state).toBe("not_started");
  });
});

describe("POST /connect/payout — gates + exactly-once", () => {
  it("refuses an unverified seller, with Stripe's reason, and records nothing", async () => {
    h.account = v2Account("pending", { userEntries: ["Stripe needs your date of birth."] });
    await h.db.execute(`INSERT INTO digital_sales (profile_id, creator_amount_cents) VALUES ('${PROFILE_ID}', 475)`);
    const res = await post("/connect/payout");
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("NOT_ONBOARDED");
    expect(res.json.state).toBe("action_needed");
    expect(res.json.actionNeeded.join(" ")).toContain("date of birth");
    expect(h.transfers).toBe(0);
    const rows = await h.db.execute(`SELECT COUNT(*)::int AS n FROM creator_payouts`);
    expect((rows.rows[0] as any).n).toBe(0);
  });

  it("refuses a verified seller with zero pending", async () => {
    const res = await post("/connect/payout");
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("MINIMUM_NOT_MET");
    expect(h.transfers).toBe(0);
  });

  it("pays the pending balance exactly once: replay refuses, pending decremented once, history lists it", async () => {
    await h.db.execute(`INSERT INTO digital_sales (profile_id, creator_amount_cents) VALUES ('${PROFILE_ID}', 475)`);

    const first = await post("/connect/payout");
    expect(first.status).toBe(200);
    expect(first.json.payout.amountCents).toBe(475);
    expect(first.json.payout.status).toBe("pending");
    expect(h.transfers).toBe(1);

    /* Pending decremented exactly once — the payout nets out the sale. */
    const status = await get("/connect/status");
    expect(status.json.pendingCents).toBe(0);

    /* Replay / second click after success: a refusal, never a 2nd transfer. */
    const replay = await post("/connect/payout");
    expect(replay.status).toBe(400);
    expect(replay.json.error).toBe("MINIMUM_NOT_MET");
    expect(h.transfers).toBe(1);

    /* History: exactly one truthful row. */
    const hist = await get("/connect/payouts");
    expect(hist.status).toBe(200);
    expect(hist.json.payouts).toHaveLength(1);
    expect(hist.json.payouts[0].amountCents).toBe(475);
    expect(hist.json.payouts[0].status).toBe("pending");
    expect(hist.json.payouts[0].stripeTransferId).toBe("tr_test_1");
    expect(hist.json.payouts[0].createdAt).toBeTruthy();
  });

  it("double-click (settled in between): the second submit refuses, money moved exactly once", async () => {
    /* The truly-simultaneous race is arbitrated by the partial unique
       index → 409, pinned by stripe-connect-payout-guard.test.ts.
       Here: a seller who clicks, lands, and clicks again must never
       move the money twice — the second click meets the decremented
       pending and refuses. */
    await h.db.execute(`INSERT INTO digital_sales (profile_id, creator_amount_cents) VALUES ('${PROFILE_ID}', 1000)`);
    const first = await post("/connect/payout");
    expect(first.status).toBe(200);
    const second = await post("/connect/payout");
    expect(second.status).toBe(400);
    expect(second.json.error).toBe("MINIMUM_NOT_MET");
    expect(h.transfers).toBe(1);
    const rows = await h.db.execute(
      `SELECT COALESCE(SUM(amount_cents),0)::int AS total, COUNT(*)::int AS n FROM creator_payouts WHERE status IN ('processing','pending','paid')`,
    );
    expect((rows.rows[0] as any).total).toBe(1000);
    expect((rows.rows[0] as any).n).toBe(1);
    const status = await get("/connect/status");
    expect(status.json.pendingCents).toBe(0);
  });
});
