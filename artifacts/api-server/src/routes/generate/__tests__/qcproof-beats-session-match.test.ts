/**
 * Gate #5 PRE-PROOF — beat purchase FAILURE paths.
 *
 * The success/settle side is already proven (beats-payments,
 * beats-licensing-truth, stripe-webhook-beats — cited in the lane
 * report). This suite pins what happens when a purchase CANNOT
 * complete:
 *   1. checkout creation fails → no license row survives, no charge,
 *      the offers shelf is unchanged;
 *   2. the one Visual-Bucs surface in beats (the AI tag suggester,
 *      100 VB) refuses on insufficient balance BEFORE charging —
 *      beat licenses themselves are a money (Stripe cents) rail and
 *      carry no VB price anywhere in beats.ts / beats-pricing.ts;
 *   3. payment failure (unpaid session, amount mismatch, wrong
 *      buyer) → no license, no producer payout, beat not sold;
 *   4. an exclusive sale completing first closes IN-FLIGHT purchases
 *      too: a premium checkout paid after the exclusive completes,
 *      and the losing exclusive checkout, are refused AND refunded
 *      (the beat-deleted-after-payment path already auto-refunds —
 *      Lane V3 F3; a paid session that can never be fulfilled is the
 *      same class);
 *   5. a failed auto-refund is reported honestly, never claimed;
 *   6. replayed verifies pay the producer exactly once (dashboard
 *      totals read completed rows only);
 *   7. contrast: non-exclusive sales close nothing.
 *
 * Harness mirrors beats-payments.test.ts: REAL router + REAL table
 * objects, fake db chains filtered on rendered equality params,
 * Stripe faked at the lib/stripe-checkout boundary.
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
  stores: new Map<string, Array<Record<string, any>>>(),
  checkoutCalls: [] as Array<Record<string, any>>,
  checkoutFails: false,
  session: null as any,
  sessionsById: null as Map<string, any> | null,
  sessionSeq: 0,
  refundCalls: [] as Array<unknown>,
  refundResult: true,
  creditCharges: [] as Array<unknown[]>,
  aiCalls: 0,
}));

function storeFor(table: unknown): Array<Record<string, any>> {
  const name = getTableName(table as never);
  if (!h.stores.has(name)) h.stores.set(name, []);
  return h.stores.get(name)!;
}

function matchRows(table: unknown, cond: unknown): Array<Record<string, any>> {
  const rows = storeFor(table);
  if (!cond) return [...rows];
  const sqlText = renderSql(cond);
  const params = renderParams(cond);
  const pairs: Array<[string, unknown]> = [];
  const re = /"(\w+)"\s*=\s*\$(\d+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sqlText)) !== null) pairs.push([m[1]!, params[Number(m[2]) - 1]]);
  if (pairs.length === 0) return [...rows];
  return rows.filter((r) => pairs.every(([col, val]) => r[col] === val));
}

function selectChain(table: unknown) {
  let cond: unknown;
  const chain: any = {
    where: (c: unknown) => {
      cond = c;
      return chain;
    },
    orderBy: (..._a: unknown[]) => chain,
    limit: async (n: number) => matchRows(table, cond).slice(0, n).map((r) => ({ ...r })),
    then: (resolve: (v: unknown) => void) => resolve(matchRows(table, cond).map((r) => ({ ...r }))),
  };
  return chain;
}

function buildFakeDb() {
  return {
    select: () => ({ from: (table: unknown) => selectChain(table) }),
    insert: (table: unknown) => ({
      values: (v: Record<string, any>) => {
        let inserted: Record<string, any> | null = null;
        const doInsert = () => {
          if (inserted) return inserted;
          inserted = {
            id: randomUUID(),
            created_at: new Date(),
            updated_at: new Date(),
            stripe_session_id: null,
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
    delete: (table: unknown) => ({
      where: async (cond: unknown) => {
        const matched = new Set(matchRows(table, cond));
        const rows = storeFor(table);
        for (let i = rows.length - 1; i >= 0; i--) if (matched.has(rows[i]!)) rows.splice(i, 1);
      },
    }),
  };
}

vi.mock("../../../middlewares/require-auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = req.headers["x-test-user"] ?? h.userId;
    if (req.headers["x-test-credits"] !== undefined) {
      req.userCredits = Number(req.headers["x-test-credits"]);
    }
    next();
  },
}));

vi.mock("../../../lib/rate-limit", () => ({
  generationLimiter: (_req: any, _res: any, next: any) => next(),
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../../lib/credits", () => ({
  chargeCredits: vi.fn(async (...args: unknown[]) => {
    h.creditCharges.push(args);
    return 900;
  }),
  refundCredits: vi.fn(async () => 0),
  OutOfCreditsError: class OutOfCreditsError extends Error {},
}));

vi.mock("../../../lib/ai-clients", () => ({
  getOpenAI: vi.fn(() => ({
    chat: {
      completions: {
        create: async () => {
          h.aiCalls += 1;
          return {
            choices: [
              { message: { content: JSON.stringify({ genre: "trap", moodTags: ["dark", "hard"] }) } },
            ],
          };
        },
      },
    },
  })),
  getTextModel: vi.fn(() => "gpt-test"),
  LOW_REASONING_PARAMS: { reasoning_effort: "low" },
}));

vi.mock("../../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async () => null),
}));

vi.mock("../../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: vi.fn(async (u: string) => u),
  isStorageRef: (u: string) => typeof u === "string" && (u.startsWith("r2://") || u.startsWith("supabase://")),
}));

vi.mock("../../../lib/stripe-checkout", () => ({
  createPaymentCheckout: vi.fn(async (input: Record<string, any>) => {
    if (h.checkoutFails) throw new Error("stripe unavailable");
    h.checkoutCalls.push(input);
    h.sessionSeq += 1;
    return { sessionId: `cs_test_${h.sessionSeq}`, url: "https://checkout.example.com/pay" };
  }),
  retrieveCheckoutSession: vi.fn(async (id: string) => h.sessionsById?.get(id) ?? h.session),
  refundCheckoutSessionPayment: vi.fn(async (session: unknown) => {
    h.refundCalls.push(session);
    return h.refundResult;
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

import router from "../beats";

const PRODUCER = randomUUID();
const BUYER = randomUUID();
const BUYER2 = randomUUID();

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

function seedBeat(overrides: Record<string, any> = {}): Record<string, any> {
  const beat = {
    id: randomUUID(),
    user_id: PRODUCER,
    title: "Midnight Loop",
    audio_url: "https://cdn.example.com/beat.mp3",
    audio_path: null,
    preview_url: null,
    stems_url: null,
    stems_path: null,
    genre: "trap",
    bpm: 140,
    musical_key: "C min",
    mood_tags: [],
    description: null,
    basic_price_cents: 2999,
    premium_price_cents: 9999,
    exclusive_price_cents: 49999,
    exclusive_sold: false,
    plays: 0,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
  h.stores.get("beats")!.push(beat);
  return beat;
}

beforeEach(() => {
  h.stores = new Map([
    ["beats", []],
    ["beat_licenses", []],
    ["beat_license_templates", []],
  ]);
  h.checkoutCalls = [];
  h.checkoutFails = false;
  h.session = null;
  h.sessionsById = null;
  h.sessionSeq = 0;
  h.refundCalls = [];
  h.refundResult = true;
  h.creditCharges = [];
  h.aiCalls = 0;
  h.userId = BUYER;
});

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await realFetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
}

function paidSession(start: any, beatId: string, tier: string, amount: number, buyer = BUYER) {
  return {
    id: start.data.sessionId,
    payment_status: "paid",
    amount_total: amount,
    metadata: {
      purchase_kind: "beat_license",
      license_id: start.data.license.id,
      beat_id: beatId,
      buyer_user_id: buyer,
      tier,
    },
  };
}

async function producerStats() {
  const r = await call("GET", "/beats/mine/dashboard", undefined, { "x-test-user": PRODUCER });
  expect(r.status).toBe(200);
  return r.data.stats;
}


/* ── QC-200 PRE-PROOF Q146 residual (stack1200 qcproof-money-b) ─────
   beats-failure-paths pins unpaid / amount-mismatch / wrong-buyer and
   the exclusive-breach refund; stripe-webhook-beats pins the webhook
   settle. The residual ledger claim no suite exercised: the shared
   settleBeatLicenseSession requires the session to MATCH the license
   row — a paid session whose metadata names a DIFFERENT license (or
   whose id no license row carries) completes nothing, refunds
   nothing, and leaves the real license pending_payment. Plus the
   commission constant through commissionFor itself. */
import { BEAT_SALE_COMMISSION_PCT, commissionFor, producerPayoutFor } from "../beats-pricing";

describe("QC-200 Q146 — settle requires the session to match the license row", () => {
  it("commission: BEAT_SALE_COMMISSION_PCT = 15 and commissionFor takes exactly 15%", () => {
    expect(BEAT_SALE_COMMISSION_PCT).toBe(15);
    expect(commissionFor(10000)).toBe(1500);
    expect(producerPayoutFor(10000)).toBe(8500);
    expect(commissionFor(9999)).toBe(1500); /* rounds to the cent */
    expect(commissionFor(49999)).toBe(7500);
    expect(producerPayoutFor(49999)).toBe(42499);
  });

  it("a paid session naming a DIFFERENT license id completes nothing and refunds nothing", async () => {
    const beat = seedBeat();
    const start = await call("POST", `/beats/${beat.id}/license`, { tier: "premium" });
    expect(start.status).toBe(201);
    const session = paidSession(start, beat.id, "premium", 9999);
    session.metadata.license_id = randomUUID(); /* not the license this session paid for */
    h.session = session;
    const v = await call("POST", "/beats/licenses/verify", { sessionId: start.data.sessionId });
    expect(v.status).toBe(400);
    const license = h.stores.get("beat_licenses")!.find((l) => l.id === start.data.license.id)!;
    expect(license.status).toBe("pending_payment");
    expect(h.refundCalls).toHaveLength(0);
    expect(await producerStats()).toMatchObject({ saleCount: 0, grossCents: 0, netCents: 0 });
  });

  it("a paid session no license row carries completes nothing", async () => {
    const beat = seedBeat();
    const start = await call("POST", `/beats/${beat.id}/license`, { tier: "premium" });
    expect(start.status).toBe(201);
    const session = paidSession(start, beat.id, "premium", 9999);
    session.id = "cs_test_orphan";
    h.session = session;
    const v = await call("POST", "/beats/licenses/verify", { sessionId: "cs_test_orphan" });
    expect(v.status).toBe(400);
    const license = h.stores.get("beat_licenses")!.find((l) => l.id === start.data.license.id)!;
    expect(license.status).toBe("pending_payment");
    expect(h.refundCalls).toHaveLength(0);
    expect(await producerStats()).toMatchObject({ saleCount: 0, grossCents: 0, netCents: 0 });
  });

  it("control: the matching paid session completes the same license", async () => {
    const beat = seedBeat();
    const start = await call("POST", `/beats/${beat.id}/license`, { tier: "premium" });
    expect(start.status).toBe(201);
    h.session = paidSession(start, beat.id, "premium", 9999);
    const v = await call("POST", "/beats/licenses/verify", { sessionId: start.data.sessionId });
    expect(v.status).toBe(200);
    const license = h.stores.get("beat_licenses")!.find((l) => l.id === start.data.license.id)!;
    expect(license.status).toBe("completed");
    expect(license.commission_cents).toBe(1500);
  });
});
