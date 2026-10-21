/**
 * Membership payments (0132): join → TEST checkout → verified payment →
 * active membership, free trials, gifted memberships, annual discounts.
 *
 * Fake-db style mirrors drafts.test.ts: the REAL router with REAL table
 * objects (eq/and render real conditions, read back via PgDialect), a
 * fake db implementing only the chains these handlers use, filtering on
 * the rendered `"col" = $n` equality params. Stripe is faked at the
 * lib/stripe-checkout boundary — checkout creation is recorded, session
 * retrieval returns a hoisted session the test controls, exactly the
 * verify path the real checkout uses.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import express from "express";
import type { AddressInfo } from "node:net";
import { PgDialect } from "drizzle-orm/pg-core";
import { getTableName } from "drizzle-orm";

const dialect = new PgDialect();
function renderParams(cond: unknown): unknown[] {
  return dialect.sqlToQuery(cond as never).params as unknown[];
}
function renderSql(cond: unknown): string {
  return dialect.sqlToQuery(cond as never).sql;
}

const h = vi.hoisted(() => ({
  userId: "",
  userEmail: "fan@example.com",
  stores: new Map<string, Array<Record<string, any>>>(),
  checkoutCalls: [] as Array<Record<string, any>>,
  refundCalls: [] as Array<unknown>,
  session: null as any,
  failTables: new Set<string>(),
}));

function storeFor(table: unknown): Array<Record<string, any>> {
  const name = getTableName(table as never);
  if (!h.stores.has(name)) h.stores.set(name, []);
  return h.stores.get(name)!;
}

function matchRows(table: unknown, cond: unknown): Array<Record<string, any>> {
  if (h.failTables.has(getTableName(table as never))) {
    throw new Error(`fake db failure reading ${getTableName(table as never)}`);
  }
  const rows = storeFor(table);
  if (!cond) return [...rows];
  const sqlText = renderSql(cond);
  const params = renderParams(cond);
  const pairs: Array<[string, unknown]> = [];
  const re = /"(\w+)"\s*=\s*\$(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sqlText)) !== null) {
    pairs.push([m[1]!, params[Number(m[2]) - 1]]);
  }
  if (pairs.length === 0) return [...rows];
  return rows.filter((r) => pairs.every(([col, val]) => r[col] === val));
}

function selectChain(table: unknown, fields?: Record<string, any>) {
  let cond: unknown;
  const chain: any = {
    where: (c: unknown) => {
      cond = c;
      return chain;
    },
    orderBy: (..._a: unknown[]) => chain,
    limit: async (n: number) => project(matchRows(table, cond).slice(0, n)),
    then: (resolve: (v: unknown) => void) => resolve(project(matchRows(table, cond))),
  };
  function project(rows: Array<Record<string, any>>) {
    if (!fields) return rows.map((r) => ({ ...r }));
    return rows.map((r) => {
      const out: Record<string, any> = {};
      for (const [key, col] of Object.entries(fields)) {
        out[key] = r[(col as any).name];
      }
      return out;
    });
  }
  return chain;
}

function buildFakeDb() {
  return {
    select: (fields?: Record<string, any>) => ({
      from: (table: unknown) => selectChain(table, fields),
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, any>) => {
        let inserted: Record<string, any> | null = null;
        const doInsert = () => {
          if (inserted) return inserted;
          inserted = {
            id: randomUUID(),
            created_at: new Date(),
            updated_at: new Date(),
            joined_at: new Date(),
            canceled_at: null,
            current_period_start: null,
            current_period_end: null,
            trial_ends_at: null,
            stripe_session_id: null,
            external_ref: null,
            fan_user_id: null,
            is_gift: false,
            gifted_by_user_id: null,
            member_id: null,
            ...v,
          };
          storeFor(table).push(inserted);
          return inserted;
        };
        return {
          returning: async () => [{ ...doInsert() }],
          then: (resolve: (v: unknown) => void) => resolve([doInsert()]),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (v: Record<string, any>) => ({
        where: (cond: unknown) => {
          let done: Array<Record<string, any>> | null = null;
          const apply = () => {
            if (done) return done;
            done = matchRows(table, cond);
            for (const r of done) Object.assign(r, v);
            return done;
          };
          return {
            returning: async () => apply().map((r) => ({ ...r })),
            then: (resolve: (v: unknown) => void) => resolve(apply()),
          };
        },
      }),
    }),
    delete: (_table: unknown) => ({
      where: async () => [],
    }),
  };
}

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = h.userId;
    req.userEmail = h.userEmail;
    next();
  },
}));

vi.mock("../../../lib/rate-limit", () => ({
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
  generationLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(async () => 0),
  refundCredits: vi.fn(async () => 0),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
}));

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(),
  getTextModel: vi.fn(() => "gpt-test"),
}));

vi.mock("../../../lib/stripe-checkout", () => ({
  createPaymentCheckout: vi.fn(async (input: Record<string, any>) => {
    h.checkoutCalls.push(input);
    return { sessionId: `cs_test_${h.checkoutCalls.length}`, url: "https://checkout.example.com/pay" };
  }),
  retrieveCheckoutSession: vi.fn(async () => h.session),
  refundCheckoutSessionPayment: vi.fn(async (session: unknown) => {
    h.refundCalls.push(session);
    return true;
  }),
  checkoutBaseUrl: () => "https://example.com",
  isCheckoutTestMode: () => true,
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    get db() {
      return buildFakeDb();
    },
  };
});

import router, {
  annualPriceCents,
  checkoutChargeCents,
  effectiveMemberStatus,
  membershipPeriodEnd,
  MEMBERSHIP_TRIAL_DAYS,
} from "../memberships";

const CREATOR = randomUUID();
const FAN = randomUUID();
const FRIEND = randomUUID();

let server: ReturnType<typeof express.application.listen>;
let baseUrl = "";
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function seedTier(overrides: Record<string, any> = {}): Record<string, any> {
  const tier = {
    id: randomUUID(),
    user_id: CREATOR,
    name: "Gold Club",
    price_cents: 1000,
    description: "",
    perks: [],
    sort_order: 0,
    is_active: "true",
    trial_enabled: false,
    annual_discount_pct: 0,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
  h.stores.get("fan_tiers")!.push(tier);
  return tier;
}

beforeEach(() => {
  h.stores = new Map([
    ["fan_tiers", []],
    ["fan_members", []],
    ["fan_membership_gifts", []],
  ]);
  h.checkoutCalls = [];
  h.refundCalls = [];
  h.session = null;
  h.failTables = new Set();
  h.userId = FAN;
  h.userEmail = "fan@example.com";
});

async function call(method: string, path: string, body?: unknown) {
  const res = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
}

function paidSession(metadata: Record<string, string>, amountTotal: number) {
  return {
    id: "cs_test_1",
    payment_status: "paid",
    amount_total: amountTotal,
    metadata,
    customer_details: { email: "fan@example.com" },
  };
}

describe("billing math — displayed = charged", () => {
  it("annual price applies the creator discount exactly", () => {
    expect(annualPriceCents(1000, 0)).toBe(12000);
    expect(annualPriceCents(1000, 20)).toBe(9600);
    expect(annualPriceCents(999, 33)).toBe(Math.round(999 * 12 * 0.67));
    expect(checkoutChargeCents({ price_cents: 1000, annual_discount_pct: 20 }, "monthly")).toBe(1000);
    expect(checkoutChargeCents({ price_cents: 1000, annual_discount_pct: 20 }, "annual")).toBe(9600);
  });

  it("period end is +1 month / +1 year", () => {
    const from = new Date("2026-10-16T00:00:00Z");
    expect(membershipPeriodEnd("monthly", from).toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(membershipPeriodEnd("annual", from).toISOString()).toBe("2027-10-16T00:00:00.000Z");
  });

  it("trial length is 7 days and an unconverted trial reads expired", () => {
    expect(MEMBERSHIP_TRIAL_DAYS).toBe(7);
    const past = new Date(Date.now() - 1000);
    expect(
      effectiveMemberStatus({ status: "trialing", fan_user_id: FAN, trial_ends_at: past, current_period_end: past }),
    ).toBe("expired");
    const future = new Date(Date.now() + 60_000);
    expect(
      effectiveMemberStatus({ status: "trialing", fan_user_id: FAN, trial_ends_at: future, current_period_end: future }),
    ).toBe("trialing");
  });
});

describe("POST /memberships/checkout + verify", () => {
  it("charges the displayed monthly price and activates only after paid verify", async () => {
    const tier = seedTier();
    const co = await call("POST", "/memberships/checkout", { tierId: tier.id });
    expect(co.status).toBe(200);
    expect(co.data.amountCents).toBe(1000);
    expect(co.data.url).toContain("checkout");
    expect(h.checkoutCalls[0]!.amountCents).toBe(1000);
    expect(h.checkoutCalls[0]!.metadata.fan_user_id).toBe(FAN);

    /* No membership exists before payment verifies. */
    expect(h.stores.get("fan_members")).toHaveLength(0);

    h.session = paidSession(
      {
        purchase_kind: "membership",
        tier_id: tier.id,
        creator_user_id: CREATOR,
        fan_user_id: FAN,
        purchaser_user_id: FAN,
        billing_period: "monthly",
        amount_cents: "1000",
        is_gift: "false",
      },
      1000,
    );
    const v = await call("POST", "/memberships/verify", { sessionId: "cs_test_1" });
    expect(v.status).toBe(200);
    expect(v.data.success).toBe(true);
    expect(v.data.membership.status).toBe("active");
    expect(v.data.membership.fanUserId).toBe(FAN);
    expect(v.data.membership.priceCents).toBe(1000);
    expect(new Date(v.data.membership.currentPeriodEnd).getTime()).toBeGreaterThan(Date.now());

    /* Idempotent: a second verify returns the same membership, no dupe. */
    const v2 = await call("POST", "/memberships/verify", { sessionId: "cs_test_1" });
    expect(v2.data.duplicate).toBe(true);
    expect(h.stores.get("fan_members")).toHaveLength(1);

    /* The creator sees the paying member. */
    h.userId = CREATOR;
    const members = await call("GET", "/memberships/members");
    expect(members.data.members).toHaveLength(1);
    expect(members.data.members[0].status).toBe("active");
    expect(members.data.members[0].fanUserId).toBe(FAN);
  });

  it("annual checkout charges the discounted annual total in both places", async () => {
    const tier = seedTier({ annual_discount_pct: 25 });
    const co = await call("POST", "/memberships/checkout", { tierId: tier.id, billingPeriod: "annual" });
    expect(co.data.amountCents).toBe(9000);
    expect(h.checkoutCalls[0]!.amountCents).toBe(9000);
  });

  it("F4: a tier price change after checkout does not reject the correctly paid session (locked amount wins)", async () => {
    const tier = seedTier();
    const co = await call("POST", "/memberships/checkout", { tierId: tier.id });
    expect(co.status).toBe(200);
    /* The creator raises the price AFTER the fan paid 1000. */
    h.stores.get("fan_tiers")![0]!.price_cents = 2000;
    h.session = paidSession(
      {
        purchase_kind: "membership",
        tier_id: tier.id,
        creator_user_id: CREATOR,
        fan_user_id: FAN,
        purchaser_user_id: FAN,
        billing_period: "monthly",
        amount_cents: "1000",
        is_gift: "false",
      },
      1000,
    );
    const v = await call("POST", "/memberships/verify", { sessionId: "cs_test_1" });
    expect(v.status).toBe(200);
    expect(v.data.membership.status).toBe("active");
    expect(v.data.membership.priceCents).toBe(1000);
  });

  it("F3: a tier deleted after payment auto-refunds instead of stranding the fan", async () => {
    const tier = seedTier();
    const co = await call("POST", "/memberships/checkout", { tierId: tier.id });
    expect(co.status).toBe(200);
    h.stores.set("fan_tiers", []);
    h.session = paidSession(
      {
        purchase_kind: "membership",
        tier_id: tier.id,
        creator_user_id: CREATOR,
        fan_user_id: FAN,
        purchaser_user_id: FAN,
        billing_period: "monthly",
        amount_cents: "1000",
        is_gift: "false",
      },
      1000,
    );
    const v = await call("POST", "/memberships/verify", { sessionId: "cs_test_1" });
    expect(v.status).toBe(400);
    expect(v.data.refunded).toBe(true);
    expect(v.data.error).toContain("refunded in full");
    expect(h.refundCalls).toHaveLength(1);
    expect(h.stores.get("fan_members") ?? []).toHaveLength(0);
  });

  it("verify refuses unpaid, mismatched, and foreign sessions", async () => {
    const tier = seedTier();
    await call("POST", "/memberships/checkout", { tierId: tier.id });
    const meta = {
      purchase_kind: "membership",
      tier_id: tier.id,
      creator_user_id: CREATOR,
      fan_user_id: FAN,
      purchaser_user_id: FAN,
      billing_period: "monthly",
      amount_cents: "1000",
      is_gift: "false",
    };
    h.session = { ...paidSession(meta, 1000), payment_status: "unpaid" };
    expect((await call("POST", "/memberships/verify", { sessionId: "cs_test_1" })).status).toBe(400);

    h.session = paidSession(meta, 500);
    expect((await call("POST", "/memberships/verify", { sessionId: "cs_test_1" })).status).toBe(400);

    h.session = paidSession({ ...meta, purchaser_user_id: FRIEND }, 1000);
    expect((await call("POST", "/memberships/verify", { sessionId: "cs_test_1" })).status).toBe(403);
    expect(h.stores.get("fan_members")).toHaveLength(0);
  });

  it("a free tier activates with no checkout at all", async () => {
    const tier = seedTier({ price_cents: 0 });
    const co = await call("POST", "/memberships/checkout", { tierId: tier.id });
    expect(co.status).toBe(201);
    expect(co.data.free).toBe(true);
    expect(co.data.membership.status).toBe("active");
    expect(h.checkoutCalls).toHaveLength(0);
  });

  it("an active member cannot double-join", async () => {
    const tier = seedTier({ price_cents: 0 });
    await call("POST", "/memberships/checkout", { tierId: tier.id });
    const again = await call("POST", "/memberships/checkout", { tierId: tier.id });
    expect(again.status).toBe(409);
  });
});

describe("free trials", () => {
  it("join-trial creates a trialing membership with no charge; a paid checkout converts it", async () => {
    const tier = seedTier({ trial_enabled: true });
    const t = await call("POST", "/memberships/join-trial", { tierId: tier.id });
    expect(t.status).toBe(201);
    expect(t.data.chargedCents).toBe(0);
    expect(t.data.membership.status).toBe("trialing");
    expect(t.data.membership.trialEndsAt).toBeTruthy();
    expect(h.checkoutCalls).toHaveLength(0);

    const again = await call("POST", "/memberships/join-trial", { tierId: tier.id });
    expect(again.status).toBe(409);

    /* Convert: pay for real, verify, same row becomes active. */
    const co = await call("POST", "/memberships/checkout", { tierId: tier.id });
    expect(co.status).toBe(200);
    h.session = paidSession(
      {
        purchase_kind: "membership",
        tier_id: tier.id,
        creator_user_id: CREATOR,
        fan_user_id: FAN,
        purchaser_user_id: FAN,
        billing_period: "monthly",
        amount_cents: "1000",
        is_gift: "false",
      },
      1000,
    );
    const v = await call("POST", "/memberships/verify", { sessionId: "cs_test_1" });
    expect(v.data.membership.status).toBe("active");
    expect(v.data.membership.trialEndsAt).toBeNull();
    expect(h.stores.get("fan_members")).toHaveLength(1);
  });

  it("a tier without trials refuses join-trial", async () => {
    const tier = seedTier({ trial_enabled: false });
    const t = await call("POST", "/memberships/join-trial", { tierId: tier.id });
    expect(t.status).toBe(400);
    expect(t.data.error).toBe("TRIAL_NOT_AVAILABLE");
  });
});

describe("gifted memberships", () => {
  it("purchaser pays, recipient becomes the member, both sides see it", async () => {
    const tier = seedTier();
    const co = await call("POST", "/memberships/checkout", { tierId: tier.id, recipientUserId: FRIEND });
    expect(co.status).toBe(200);
    expect(co.data.isGift).toBe(true);
    expect(h.stores.get("fan_membership_gifts")).toHaveLength(1);
    expect(h.stores.get("fan_membership_gifts")![0]!.status).toBe("pending_payment");
    expect(h.stores.get("fan_members")).toHaveLength(0);

    h.session = paidSession(
      {
        purchase_kind: "membership",
        tier_id: tier.id,
        creator_user_id: CREATOR,
        fan_user_id: FRIEND,
        purchaser_user_id: FAN,
        billing_period: "monthly",
        amount_cents: "1000",
        is_gift: "true",
      },
      1000,
    );
    const v = await call("POST", "/memberships/verify", { sessionId: "cs_test_1" });
    expect(v.data.membership.fanUserId).toBe(FRIEND);
    expect(v.data.membership.isGift).toBe(true);
    expect(v.data.membership.giftedByUserId).toBe(FAN);
    expect(h.stores.get("fan_membership_gifts")![0]!.status).toBe("active");

    const mine = await call("GET", "/memberships/mine");
    expect(mine.data.giftsSent).toHaveLength(1);
    expect(mine.data.giftsSent[0].status).toBe("active");

    h.userId = FRIEND;
    const theirs = await call("GET", "/memberships/mine");
    expect(theirs.data.memberships).toHaveLength(1);
    expect(theirs.data.giftsReceived).toHaveLength(1);
  });
});

describe("GET /memberships/public/:creatorUserId — the profile Memberships block's read", () => {
  it("serves only the creator's ACTIVE tiers in the public DTO shape", async () => {
    const live = seedTier({ name: "Gold Club" });
    seedTier({ name: "Retired Club", is_active: "false" });
    seedTier({ user_id: FRIEND, name: "Someone Else's Club" });

    const r = await call("GET", `/memberships/public/${CREATOR}`);

    expect(r.status).toBe(200);
    expect(r.data.creatorUserId).toBe(CREATOR);
    expect(r.data.testMode).toBe(true);
    expect(r.data.tiers).toHaveLength(1);
    expect(r.data.tiers[0].id).toBe(live.id);
    expect(r.data.tiers[0].creatorUserId).toBe(CREATOR);
    expect(r.data.tiers[0].name).toBe("Gold Club");
    expect(r.data.tiers[0].priceCents).toBe(1000);
    expect(r.data.tiers[0].isActive).toBe(true);
  });

  it("400s a non-UUID creator id at the gate (the profile page's old 'undefined')", async () => {
    const r = await call("GET", "/memberships/public/undefined");

    expect(r.status).toBe(400);
    expect(r.data.error).toBe("Invalid creator.");
  });

  it("answers a shaped JSON 500 — never the framework HTML page — when the tiers read fails", async () => {
    h.failTables.add("fan_tiers");

    const r = await call("GET", `/memberships/public/${CREATOR}`);

    expect(r.status).toBe(500);
    expect(typeof r.data.error).toBe("string");
    expect(r.data.error.length).toBeGreaterThan(0);
  });
});
