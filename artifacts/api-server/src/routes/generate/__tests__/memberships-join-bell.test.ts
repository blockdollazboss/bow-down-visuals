/**
 * Membership-join → creator bell (stack900 lane A2).
 *
 * Until now a landed membership join announced itself ONLY through
 * the lane-20 developer webhook (emitNewMemberWebhook): the creator
 * got no bell and no device ping when a fan joined their club. All
 * three join paths now also ride the one event door (notifyUserEvent)
 * through notifyMembershipJoined, seated in the exact branch the
 * webhook already guards — the brand-new fan_members row insert:
 *
 *   - free join  (POST /memberships/checkout, $0 tier)  → social
 *   - trial join (POST /memberships/join-trial)          → social
 *   - paid join  (POST /memberships/verify)              → money
 *
 * Category ruling (house pattern): a paid join is a money event
 * (money pings are ON by default); free/trial joins are social
 * (OFF by default — the bell lands, the ping stays silent until the
 * creator turns social pings on, exactly the old visible behaviour).
 *
 * Exactly-once is structural, inherited from the webhook's gate — no
 * second counter: checkout 409s an already-active member, verify
 * answers duplicate:true on a replayed session id, join-trial 409s
 * any existing row. The existing-row refresh branch (trial
 * conversion, renewal) is not a join and never bells. The bell is
 * addressed to the creator, never to the fan who joined.
 *
 * Harness mirrors memberships-payments.test.ts: the REAL router with
 * REAL table objects over a fake db, Stripe faked at the
 * lib/stripe-checkout boundary, the bell observed through the
 * __setMembershipJoinEventNotifier test seam.
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
  bellCalls: [] as Array<Record<string, any>>,
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
  buildMembershipJoinEvent,
  notifyMembershipJoined,
  __setMembershipJoinEventNotifier,
} from "../memberships";
import {
  notifyUserEvent,
  PUSH_CATEGORY_DEFAULTS,
  type NotifyDeps,
  type PushPreferenceMap,
  type UserEventInput,
} from "../../../lib/push-events";

const CREATOR = randomUUID();
const FAN = randomUUID();
const FRIEND = randomUUID();
const PURCHASER = randomUUID();

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
  __setMembershipJoinEventNotifier(null);
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

function seedProfile(userId: string, displayName: string): void {
  h.stores.get("creator_profiles")!.push({
    id: randomUUID(),
    user_id: userId,
    display_name: displayName,
    slug: displayName.toLowerCase().replace(/\s+/g, "-"),
    avatar_url: null,
  });
}

function recordBellSeam(): void {
  __setMembershipJoinEventNotifier(async (input) => {
    h.bellCalls.push(input as unknown as Record<string, any>);
  });
}

beforeEach(() => {
  h.stores = new Map([
    ["fan_tiers", []],
    ["fan_members", []],
    ["fan_membership_gifts", []],
    ["creator_profiles", []],
  ]);
  h.checkoutCalls = [];
  h.refundCalls = [];
  h.session = null;
  h.failTables = new Set();
  h.userId = FAN;
  h.userEmail = "fan@example.com";
  h.bellCalls = [];
  recordBellSeam();
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

function membershipMeta(tierId: string, fanUserId: string, purchaserUserId: string, isGift = "false") {
  return {
    purchase_kind: "membership",
    tier_id: tierId,
    creator_user_id: CREATOR,
    fan_user_id: fanUserId,
    purchaser_user_id: purchaserUserId,
    billing_period: "monthly",
    amount_cents: "1000",
    is_gift: isGift,
  };
}

describe("buildMembershipJoinEvent — the bell itself", () => {
  it("paid join: money category, names the fan and the tier", () => {
    expect(
      buildMembershipJoinEvent({ creatorUserId: CREATOR, fanName: "Kai", tierName: "Gold Club", joinKind: "paid" }),
    ).toEqual({
      userId: CREATOR,
      category: "money",
      kind: "membership_join",
      title: `🦈 Kai joined your "Gold Club" membership`,
      body: "A new paying member just joined — say hello.",
      link: "/memberships",
    });
  });

  it("free join: social category", () => {
    expect(
      buildMembershipJoinEvent({ creatorUserId: CREATOR, fanName: "Kai", tierName: "Gold Club", joinKind: "free" }),
    ).toMatchObject({ userId: CREATOR, category: "social", kind: "membership_join", link: "/memberships" });
  });

  it("trial join: social category, trial wording", () => {
    const ev = buildMembershipJoinEvent({
      creatorUserId: CREATOR,
      fanName: "Kai",
      tierName: "Gold Club",
      joinKind: "trial",
    });
    expect(ev.category).toBe("social");
    expect(ev.body).toContain("free trial");
  });
});

describe("one bell per landed join — and only one", () => {
  it("free join bells the creator once (social); a replayed join 409s and never re-bells", async () => {
    seedProfile(FAN, "Kai Fan");
    const tier = seedTier({ price_cents: 0 });
    const co = await call("POST", "/memberships/checkout", { tierId: tier.id });
    expect(co.status).toBe(201);
    expect(h.bellCalls).toHaveLength(1);
    expect(h.bellCalls[0]).toMatchObject({
      userId: CREATOR,
      category: "social",
      kind: "membership_join",
      title: `🦈 Kai Fan joined your "Gold Club" membership`,
      link: "/memberships",
    });

    const again = await call("POST", "/memberships/checkout", { tierId: tier.id });
    expect(again.status).toBe(409);
    expect(h.bellCalls).toHaveLength(1);
  });

  it("paid join bells once (money) at verify — never at checkout — and a replayed verify never re-bells", async () => {
    seedProfile(FAN, "Kai Fan");
    const tier = seedTier();
    const co = await call("POST", "/memberships/checkout", { tierId: tier.id });
    expect(co.status).toBe(200);
    /* The membership does not exist yet: no bell for a checkout start. */
    expect(h.bellCalls).toHaveLength(0);

    h.session = paidSession(membershipMeta(tier.id, FAN, FAN), 1000);
    const v = await call("POST", "/memberships/verify", { sessionId: "cs_test_1" });
    expect(v.status).toBe(200);
    expect(v.data.duplicate).toBe(false);
    expect(h.bellCalls).toHaveLength(1);
    expect(h.bellCalls[0]).toMatchObject({
      userId: CREATOR,
      category: "money",
      kind: "membership_join",
      title: `🦈 Kai Fan joined your "Gold Club" membership`,
    });

    const v2 = await call("POST", "/memberships/verify", { sessionId: "cs_test_1" });
    expect(v2.data.duplicate).toBe(true);
    expect(h.bellCalls).toHaveLength(1);
  });

  it("trial join bells once (social); a second trial attempt 409s and never re-bells", async () => {
    seedProfile(FAN, "Kai Fan");
    const tier = seedTier({ trial_enabled: true });
    const t = await call("POST", "/memberships/join-trial", { tierId: tier.id });
    expect(t.status).toBe(201);
    expect(h.bellCalls).toHaveLength(1);
    expect(h.bellCalls[0]).toMatchObject({ userId: CREATOR, category: "social", kind: "membership_join" });
    expect(h.bellCalls[0]!["body"]).toContain("free trial");

    const again = await call("POST", "/memberships/join-trial", { tierId: tier.id });
    expect(again.status).toBe(409);
    expect(h.bellCalls).toHaveLength(1);
  });

  it("a trial converting to paid refreshes the same row — a conversion, not a join: no second bell", async () => {
    const tier = seedTier({ trial_enabled: true });
    await call("POST", "/memberships/join-trial", { tierId: tier.id });
    expect(h.bellCalls).toHaveLength(1);

    await call("POST", "/memberships/checkout", { tierId: tier.id });
    h.session = paidSession(membershipMeta(tier.id, FAN, FAN), 1000);
    const v = await call("POST", "/memberships/verify", { sessionId: "cs_test_1" });
    expect(v.data.membership.status).toBe("active");
    expect(h.stores.get("fan_members")).toHaveLength(1);
    expect(h.bellCalls).toHaveLength(1);
  });

  it("gifted paid join bells the creator naming the recipient — never the purchaser, never the recipient", async () => {
    seedProfile(FRIEND, "Riley Recipient");
    const tier = seedTier();
    h.userId = PURCHASER;
    const co = await call("POST", "/memberships/checkout", { tierId: tier.id, recipientUserId: FRIEND });
    expect(co.status).toBe(200);
    h.session = paidSession(membershipMeta(tier.id, FRIEND, PURCHASER, "true"), 1000);
    const v = await call("POST", "/memberships/verify", { sessionId: "cs_test_1" });
    expect(v.status).toBe(200);
    expect(h.bellCalls).toHaveLength(1);
    expect(h.bellCalls[0]).toMatchObject({
      userId: CREATOR,
      category: "money",
      title: `🦈 Riley Recipient joined your "Gold Club" membership`,
    });
  });

  it("a fan without a creator profile is still named in plain words", async () => {
    const tier = seedTier({ price_cents: 0 });
    const co = await call("POST", "/memberships/checkout", { tierId: tier.id });
    expect(co.status).toBe(201);
    expect(h.bellCalls).toHaveLength(1);
    expect(h.bellCalls[0]!["title"]).toBe(`🦈 Someone joined your "Gold Club" membership`);
  });

  it("a failing bell never breaks the join that landed", async () => {
    __setMembershipJoinEventNotifier(async () => {
      throw new Error("down");
    });
    const tier = seedTier({ price_cents: 0 });
    const co = await call("POST", "/memberships/checkout", { tierId: tier.id });
    expect(co.status).toBe(201);
    expect(co.data.membership.status).toBe("active");
  });
});

describe("the bell never goes to the joiner", () => {
  it("self-joins are refused before any bell: the creator cannot join their own club", async () => {
    h.userId = CREATOR;
    const tier = seedTier({ price_cents: 0, trial_enabled: true });
    const co = await call("POST", "/memberships/checkout", { tierId: tier.id });
    expect(co.status).toBe(400);
    const t = await call("POST", "/memberships/join-trial", { tierId: tier.id });
    expect(t.status).toBe(400);
    expect(h.bellCalls).toHaveLength(0);
  });

  it("notifyMembershipJoined itself refuses to bell the joiner (guard at the door)", async () => {
    await notifyMembershipJoined({
      creatorUserId: FAN,
      fanUserId: FAN,
      tierName: "Gold Club",
      joinKind: "paid",
    });
    expect(h.bellCalls).toHaveLength(0);
  });
});

describe("the real rail — the ping obeys the creator's category preference", () => {
  const MONEY_OFF: PushPreferenceMap = { money: false, messages: true, live: true, mentions: true, social: false };
  const SOCIAL_ON: PushPreferenceMap = { money: true, messages: true, live: true, mentions: true, social: true };
  const DEFAULTS: PushPreferenceMap = { ...PUSH_CATEGORY_DEFAULTS };

  function fakeLegs(prefs: PushPreferenceMap) {
    const bells: UserEventInput[] = [];
    const pushes: Array<{ userId: string; payload: unknown }> = [];
    const deps: NotifyDeps = {
      getPrefs: async () => prefs,
      insertBell: async (input) => {
        bells.push(input);
      },
      sendPush: async (userId, payload) => {
        pushes.push({ userId, payload });
        return { sent: 1, pruned: 0, failed: 0, skippedReason: null };
      },
    };
    return { bells, pushes, deps };
  }

  function rideRealRail(prefs: PushPreferenceMap) {
    const legs = fakeLegs(prefs);
    __setMembershipJoinEventNotifier(async (input) => notifyUserEvent(input, legs.deps));
    return legs;
  }

  it("paid join, shipped defaults (money on): bell lands AND the creator's devices ping", async () => {
    const legs = rideRealRail(DEFAULTS);
    const tier = seedTier();
    await call("POST", "/memberships/checkout", { tierId: tier.id });
    h.session = paidSession(membershipMeta(tier.id, FAN, FAN), 1000);
    await call("POST", "/memberships/verify", { sessionId: "cs_test_1" });
    expect(legs.bells).toHaveLength(1);
    expect(legs.pushes).toHaveLength(1);
    expect(legs.pushes[0]!.userId).toBe(CREATOR);
  });

  it("paid join, money pings off: bell lands, ping silent", async () => {
    const legs = rideRealRail(MONEY_OFF);
    const tier = seedTier();
    await call("POST", "/memberships/checkout", { tierId: tier.id });
    h.session = paidSession(membershipMeta(tier.id, FAN, FAN), 1000);
    await call("POST", "/memberships/verify", { sessionId: "cs_test_1" });
    expect(legs.bells).toHaveLength(1);
    expect(legs.pushes).toHaveLength(0);
  });

  it("free join, shipped defaults (social off): bell lands, ping silent — the old visible behaviour", async () => {
    const legs = rideRealRail(DEFAULTS);
    const tier = seedTier({ price_cents: 0 });
    await call("POST", "/memberships/checkout", { tierId: tier.id });
    expect(legs.bells).toHaveLength(1);
    expect(legs.pushes).toHaveLength(0);
  });

  it("free join, social on: bell lands AND the ping fires", async () => {
    const legs = rideRealRail(SOCIAL_ON);
    const tier = seedTier({ price_cents: 0 });
    await call("POST", "/memberships/checkout", { tierId: tier.id });
    expect(legs.bells).toHaveLength(1);
    expect(legs.pushes).toHaveLength(1);
  });
});
