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


/* ── QC-200 PRE-PROOF Q145 residual (stack1200 qcproof-money-b) ─────
   The fee split, gift-to-recipient landing, locked-amount check,
   per-session idempotency and tier-deleted auto-refund are pinned by
   membership-join-fee / memberships-payments / stripe-webhook-
   membership. The one claim no suite exercised: the own-fan-club
   refusal at POST /memberships/checkout — for a plain self-join AND
   for a gift addressed to the creator themself — refusing BEFORE any
   checkout session is created or member row written. */
describe("QC-200 Q145 — a creator can't join their own fan club", () => {
  it("self-join: 400 with the ruled refusal, no checkout session, no member row", async () => {
    const tier = seedTier();
    h.userId = CREATOR;
    const res = await call("POST", "/memberships/checkout", { tierId: tier.id });
    expect(res.status).toBe(400);
    expect(res.data.error).toBe("A creator can't join their own fan club.");
    expect(h.checkoutCalls).toHaveLength(0);
    expect(h.stores.get("fan_members")).toHaveLength(0);
  });

  it("a gift addressed to the tier's own creator is refused the same way", async () => {
    const tier = seedTier();
    h.userId = FAN;
    const res = await call("POST", "/memberships/checkout", { tierId: tier.id, recipientUserId: CREATOR });
    expect(res.status).toBe(400);
    expect(res.data.error).toBe("A creator can't join their own fan club.");
    expect(h.checkoutCalls).toHaveLength(0);
    expect(h.stores.get("fan_members")).toHaveLength(0);
    expect(h.stores.get("fan_membership_gifts")).toHaveLength(0);
  });

  it("control: an ordinary fan CAN check out for the same tier", async () => {
    const tier = seedTier();
    h.userId = FAN;
    const res = await call("POST", "/memberships/checkout", { tierId: tier.id });
    expect(res.status).toBe(200);
    expect(h.checkoutCalls).toHaveLength(1);
  });
});
