/**
 * Beat license payments (0132): license → TEST checkout → verified paid
 * session → completed license + download entitlement.
 *
 * Fake-db style mirrors memberships-payments.test.ts: REAL router + REAL
 * table objects, fake db chains filtered on rendered equality params.
 * Stripe is faked at the lib/stripe-checkout boundary — the verify path
 * exercised here is the one the real checkout return uses.
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
  session: null as any,
  sessionSeq: 0,
  refundCalls: [] as Array<unknown>,
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
    // Per-request override so concurrent two-buyer tests can race.
    req.userId = req.headers["x-test-user"] ?? h.userId;
    next();
  },
}));

vi.mock("../../../lib/rate-limit", () => ({
  generationLimiter: (_req: any, _res: any, next: any) => next(),
  publicApiLimiter: (_req: any, _res: any, next: any) => next(),
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

vi.mock("../../../lib/mirrorMedia", () => ({
  mirrorExternalMediaUrl: vi.fn(async () => null),
}));

vi.mock("../../../lib/objectStorage", () => ({
  refreshSupabaseStorageUrl: vi.fn(async (u: string) => u),
  isStorageRef: (u: string) => typeof u === "string" && (u.startsWith("r2://") || u.startsWith("supabase://")),
}));

vi.mock("../../../lib/stripe-checkout", () => ({
  createPaymentCheckout: vi.fn(async (input: Record<string, any>) => {
    h.checkoutCalls.push(input);
    h.sessionSeq += 1;
    return { sessionId: `cs_test_${h.sessionSeq}`, url: "https://checkout.example.com/pay" };
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

import router from "../beats";

const PRODUCER = randomUUID();
const BUYER = randomUUID();

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
  ]);
  h.checkoutCalls = [];
  h.session = null;
  h.sessionSeq = 0;
  h.refundCalls = [];
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

describe("beat license purchase flow", () => {
  it("charges the listed tier price, completes only on verified payment, grants the download", async () => {
    const beat = seedBeat();
    const start = await call("POST", `/beats/${beat.id}/license`, { tier: "premium" });
    expect(start.status).toBe(201);
    expect(start.data.checkoutUrl).toContain("checkout");
    expect(start.data.license.status).toBe("pending_payment");
    expect(start.data.license.priceCents).toBe(9999);
    expect(h.checkoutCalls[0]!.amountCents).toBe(9999);
    const licenseId = start.data.license.id as string;
    const sessionId = start.data.sessionId as string;

    /* Not completed, no entitlement, before payment verifies. */
    const mineBefore = await call("GET", "/beats/licenses/mine");
    expect(mineBefore.data.licenses[0].status).toBe("pending_payment");
    expect(mineBefore.data.licenses[0].downloadUrl).toBeNull();

    h.session = {
      id: sessionId,
      payment_status: "paid",
      amount_total: 9999,
      metadata: { purchase_kind: "beat_license", license_id: licenseId, beat_id: beat.id, buyer_user_id: BUYER, tier: "premium" },
    };
    const v = await call("POST", "/beats/licenses/verify", { sessionId });
    expect(v.status).toBe(200);
    expect(v.data.success).toBe(true);
    expect(v.data.license.status).toBe("completed");
    expect(v.data.downloadUrl).toBe("https://cdn.example.com/beat.mp3");

    const v2 = await call("POST", "/beats/licenses/verify", { sessionId });
    expect(v2.data.duplicate).toBe(true);
    expect(h.stores.get("beat_licenses")).toHaveLength(1);

    const mine = await call("GET", "/beats/licenses/mine");
    expect(mine.data.licenses[0].downloadUrl).toBe("https://cdn.example.com/beat.mp3");
  });

  it("an unpaid session never completes the license", async () => {
    const beat = seedBeat();
    const start = await call("POST", `/beats/${beat.id}/license`, { tier: "basic" });
    h.session = {
      id: start.data.sessionId,
      payment_status: "unpaid",
      amount_total: 2999,
      metadata: { purchase_kind: "beat_license", license_id: start.data.license.id, beat_id: beat.id, buyer_user_id: BUYER, tier: "basic" },
    };
    const v = await call("POST", "/beats/licenses/verify", { sessionId: start.data.sessionId });
    expect(v.status).toBe(400);
    expect(h.stores.get("beat_licenses")![0]!.status).toBe("pending_payment");
  });

  it("exclusive purchase flips exclusive_sold and blocks a second exclusive sale", async () => {
    const beat = seedBeat();
    const start = await call("POST", `/beats/${beat.id}/license`, { tier: "exclusive" });
    expect(start.status).toBe(201);
    h.session = {
      id: start.data.sessionId,
      payment_status: "paid",
      amount_total: 49999,
      metadata: { purchase_kind: "beat_license", license_id: start.data.license.id, beat_id: beat.id, buyer_user_id: BUYER, tier: "exclusive" },
    };
    const v = await call("POST", "/beats/licenses/verify", { sessionId: start.data.sessionId });
    expect(v.data.license.status).toBe("completed");
    expect(h.stores.get("beats")![0]!.exclusive_sold).toBe(true);

    const second = await call("POST", `/beats/${beat.id}/license`, { tier: "exclusive" });
    expect(second.status).toBe(409);
  });

  it("F5: two concurrent exclusive verifies — exactly one completes, the loser gets 409", async () => {
    const beat = seedBeat();
    const BUYER2 = randomUUID();
    // Both buyers open exclusive checkouts before either pays (the
    // creation-side guard cannot see this race; verify must not).
    const startA = await call("POST", `/beats/${beat.id}/license`, { tier: "exclusive" });
    expect(startA.status).toBe(201);
    h.userId = BUYER2;
    const startB = await call("POST", `/beats/${beat.id}/license`, { tier: "exclusive" });
    expect(startB.status).toBe(201);
    h.userId = BUYER;

    const sessions = new Map<string, any>([
      [startA.data.sessionId, {
        id: startA.data.sessionId, payment_status: "paid", amount_total: 49999,
        metadata: { purchase_kind: "beat_license", license_id: startA.data.license.id, beat_id: beat.id, buyer_user_id: BUYER, tier: "exclusive" },
      }],
      [startB.data.sessionId, {
        id: startB.data.sessionId, payment_status: "paid", amount_total: 49999,
        metadata: { purchase_kind: "beat_license", license_id: startB.data.license.id, beat_id: beat.id, buyer_user_id: BUYER2, tier: "exclusive" },
      }],
    ]);
    const sc = await import("../../../lib/stripe-checkout");
    vi.mocked(sc.retrieveCheckoutSession).mockImplementation(async (id: string) => sessions.get(id));

    const [va, vb] = await Promise.all([
      call("POST", "/beats/licenses/verify", { sessionId: startA.data.sessionId }, { "x-test-user": BUYER }),
      call("POST", "/beats/licenses/verify", { sessionId: startB.data.sessionId }, { "x-test-user": BUYER2 }),
    ]);
    expect([va.status, vb.status].sort()).toEqual([200, 409]);
    const loser = va.status === 409 ? va : vb;
    expect(loser.data.error).toContain("sold to someone else first");
    const licenses = h.stores.get("beat_licenses")!;
    expect(licenses.filter((l) => l.status === "completed")).toHaveLength(1);
    expect(h.stores.get("beats")![0]!.exclusive_sold).toBe(true);
  });

  it("F3: a beat deleted after payment auto-refunds instead of stranding the buyer", async () => {
    /* The F5 test replaced the session mock with a per-id map; restore
       the hoisted-session behavior for this test. */
    const sc = await import("../../../lib/stripe-checkout");
    vi.mocked(sc.retrieveCheckoutSession).mockImplementation(async () => h.session);
    const beat = seedBeat();
    const start = await call("POST", `/beats/${beat.id}/license`, { tier: "premium" });
    expect(start.status).toBe(201);
    h.session = {
      id: start.data.sessionId,
      payment_status: "paid",
      amount_total: 9999,
      metadata: { purchase_kind: "beat_license", license_id: start.data.license.id, beat_id: beat.id, buyer_user_id: BUYER, tier: "premium" },
    };
    h.stores.set("beats", []);
    const v = await call("POST", "/beats/licenses/verify", { sessionId: start.data.sessionId });
    expect(v.status).toBe(400);
    expect(v.data.refunded).toBe(true);
    expect(v.data.error).toContain("refunded in full");
    expect(h.refundCalls).toHaveLength(1);
    expect(h.stores.get("beat_licenses")![0]!.status).toBe("pending_payment");
  });

  it("producers cannot license their own beat", async () => {
    const beat = seedBeat();
    h.userId = PRODUCER;
    const start = await call("POST", `/beats/${beat.id}/license`, { tier: "basic" });
    expect(start.status).toBe(400);
    expect(h.checkoutCalls).toHaveLength(0);
  });
});
