/**
 * Connect account.updated sync (payfix payout-build).
 *
 * THE Pass 6 regression: seller D completed Stripe TEST onboarding
 * twice (acct created via the v2 API), yet the site kept saying
 * "isn't verified yet". The webhook endpoint is a classic endpoint —
 * it receives v1-shaped account.updated payloads — while the old
 * syncConnectAccountStatus read only the v2 capability shape, so
 * every event synced payouts_enabled=false. Thin v2 events (id only)
 * did the same damage. These tests drive the REAL sync + REAL webhook
 * handler over pg-mem, faking Stripe only at lib/stripe-client:
 *  - v1 payload with payouts_enabled=true flips the stored flags ON
 *  - v2 full payload with active capabilities flips them ON
 *  - thin v2 payload re-fetches live instead of writing false flags
 *  - the webhook handler routes account.updated AND
 *    v2.core.account[requirements].updated into the sync
 *  - an unverified v1 payload (currently_due) stays OFF and parses
 *    to action_needed with Stripe's reason
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { newDb } from "pg-mem";
import { drizzle } from "drizzle-orm/node-postgres";
import { randomUUID } from "node:crypto";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const ACCOUNT_ID = "acct_test_123";

const VERIFIED_V2 = {
  id: ACCOUNT_ID,
  configuration: {
    recipient: {
      capabilities: {
        stripe_balance: {
          stripe_transfers: { status: "active", status_details: [] },
          payouts: { status: "active", status_details: [] },
        },
      },
    },
  },
  requirements: { entries: [] },
};

const h = vi.hoisted(() => {
  process.env["STRIPE_SECRET_KEY"] = "sk_test_fake";
  process.env["STRIPE_WEBHOOK_SECRET"] = "whsec_fake";
  return {
    db: null as any,
    account: null as any,
    event: null as any,
    retrieves: 0,
  };
});

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, get db() { return h.db; } };
});

vi.mock("../supabase-admin", () => ({
  getSupabaseAdmin: () => ({}),
}));

vi.mock("../payment-record", () => ({
  claimStripePayment: async () => "won",
  markPaymentCompleted: async () => {},
  markPaymentFailed: async () => {},
  fulfillCreditPurchase: async () => ({ outcome: "granted", newCredits: 0 }),
}));

vi.mock("../../routes/referrals", () => ({
  awardReferralPayout: async () => false,
}));

vi.mock("../stripe-client", () => ({
  createGuardedStripeClient: () => ({
    webhooks: { constructEvent: () => h.event },
    v2: {
      core: {
        accounts: {
          retrieve: async () => {
            h.retrieves += 1;
            return h.account;
          },
          create: async () => ({ id: "acct_new" }),
        },
        accountLinks: { create: async () => ({ url: "https://example.com/onboard" }) },
      },
    },
    transfers: { create: async () => ({ id: "tr_test" }) },
  }),
  isStripeTestModeKey: () => true,
}));

import { syncConnectAccountStatus, parseConnectAccountState } from "../stripe-connect";
import { stripeWebhookHandler } from "../stripe-webhook";

const DDL = `
  CREATE TABLE creator_profiles (
    id uuid PRIMARY KEY, user_id uuid NOT NULL,
    stripe_connect_account_id text,
    stripe_connect_onboarded boolean NOT NULL DEFAULT false,
    stripe_connect_charges_enabled boolean NOT NULL DEFAULT false,
    stripe_connect_payouts_enabled boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
`;

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
});

beforeEach(async () => {
  await h.db.execute(`DELETE FROM creator_profiles`);
  await h.db.execute(
    `INSERT INTO creator_profiles (id, user_id, stripe_connect_account_id)
     VALUES ('${PROFILE_ID}', '${USER_ID}', '${ACCOUNT_ID}')`,
  );
  h.account = VERIFIED_V2;
  h.event = null;
  h.retrieves = 0;
});

async function storedFlags() {
  const r = await h.db.execute(
    `SELECT stripe_connect_onboarded AS o, stripe_connect_charges_enabled AS c, stripe_connect_payouts_enabled AS p FROM creator_profiles WHERE id = '${PROFILE_ID}'`,
  );
  return r.rows[0] as { o: boolean; c: boolean; p: boolean };
}

function fakeRes() {
  const res: any = { code: 0, payload: null as any };
  res.status = (code: number) => {
    res.code = code;
    return res;
  };
  res.json = (payload: unknown) => {
    res.payload = payload;
    return res;
  };
  return res;
}

async function deliver(event: unknown) {
  h.event = event;
  const res = fakeRes();
  await stripeWebhookHandler(
    { headers: { "stripe-signature": "sig_test" }, body: Buffer.from("{}") } as any,
    res,
  );
  return res;
}

describe("syncConnectAccountStatus — shape tolerance", () => {
  it("v1 account.updated with payouts_enabled=true flips the seller to verified (the Pass 6 regression)", async () => {
    await syncConnectAccountStatus({
      id: ACCOUNT_ID,
      payouts_enabled: true,
      charges_enabled: true,
      details_submitted: true,
      requirements: { currently_due: [] },
    } as any);
    const flags = await storedFlags();
    expect(flags.p).toBe(true);
    expect(flags.c).toBe(true);
    expect(flags.o).toBe(true);
    expect(h.retrieves).toBe(0); // full payload — no refetch needed
  });

  it("v2 full payload with active capabilities flips the seller to verified", async () => {
    await syncConnectAccountStatus(VERIFIED_V2 as any);
    const flags = await storedFlags();
    expect(flags.p).toBe(true);
    expect(flags.c).toBe(true);
  });

  it("thin v2 payload (id only) re-fetches live instead of writing false flags", async () => {
    await syncConnectAccountStatus({ id: ACCOUNT_ID } as any);
    expect(h.retrieves).toBe(1);
    const flags = await storedFlags();
    expect(flags.p).toBe(true);
  });

  it("an unverified v1 payload stays off — no false verify", async () => {
    await syncConnectAccountStatus({
      id: ACCOUNT_ID,
      payouts_enabled: false,
      charges_enabled: false,
      details_submitted: true,
      requirements: { currently_due: ["individual.dob.day"] },
    } as any);
    const flags = await storedFlags();
    expect(flags.p).toBe(false);
    expect(flags.c).toBe(false);
  });

  it("unknown account id is a no-op, not an error", async () => {
    await expect(
      syncConnectAccountStatus({ id: "acct_unknown", payouts_enabled: true } as any),
    ).resolves.toBeUndefined();
  });
});

describe("parseConnectAccountState — the state machine", () => {
  it("v1 currently_due → action_needed with Stripe's field as the reason", () => {
    const s = parseConnectAccountState({
      id: ACCOUNT_ID,
      payouts_enabled: false,
      charges_enabled: false,
      details_submitted: true,
      requirements: { currently_due: ["individual.dob.day"] },
    } as any);
    expect(s.state).toBe("action_needed");
    expect(s.actionNeeded.join(" ")).toContain("individual dob day");
  });

  it("v2 user-owed requirement entries → action_needed with their descriptions", () => {
    const s = parseConnectAccountState({
      id: ACCOUNT_ID,
      configuration: {
        recipient: {
          capabilities: {
            stripe_balance: {
              stripe_transfers: { status: "active" },
              payouts: { status: "pending", status_details: [{ code: "requirements_past_due" }] },
            },
          },
        },
      },
      requirements: {
        entries: [
          { awaiting_action_from: "user", description: "Provide a bank account.", errors: [] },
          { awaiting_action_from: "stripe", description: "Stripe is reviewing.", errors: [] },
        ],
      },
    } as any);
    expect(s.state).toBe("action_needed");
    expect(s.actionNeeded).toContain("Provide a bank account.");
    expect(s.actionNeeded.join(" ")).not.toContain("Stripe is reviewing.");
  });
});

describe("stripeWebhookHandler — Connect event routing", () => {
  it("account.updated (v1 shape) flips the stored flags and answers connect_account", async () => {
    const res = await deliver({
      id: "evt_test_1",
      type: "account.updated",
      data: {
        object: {
          id: ACCOUNT_ID,
          payouts_enabled: true,
          charges_enabled: true,
          details_submitted: true,
          requirements: { currently_due: [] },
        },
      },
    });
    expect(res.code).toBe(200);
    expect(res.payload.kind).toBe("connect_account");
    expect((await storedFlags()).p).toBe(true);
  });

  it("v2.core.account[requirements].updated (thin) also reconciles via live refetch", async () => {
    const res = await deliver({
      id: "evt_test_2",
      type: "v2.core.account[requirements].updated",
      data: { object: { id: ACCOUNT_ID } },
    });
    expect(res.code).toBe(200);
    expect(res.payload.kind).toBe("connect_account");
    expect(h.retrieves).toBe(1);
    expect((await storedFlags()).p).toBe(true);
  });
});
